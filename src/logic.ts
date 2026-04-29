/**
 * Pure logic module — no VS Code imports.
 * All regex matching, position calculation and name extraction lives here
 * so it can be unit-tested without a VS Code extension host.
 */

export interface LineCol {
  line: number;
  character: number;
  /** Populated when scanning all symbols (no specific name requested). */
  name?: string;
}

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Convert a flat character offset in text into a {line, character} pair.
 */
export function offsetToLineCol(text: string, offset: number): LineCol {
  const safeOffset = Math.min(offset, text.length);
  let line = 0;
  let col = 0;
  for (let i = 0; i < safeOffset; i++) {
    if (text[i] === "\n") {
      line++;
      col = 0;
    } else {
      col++;
    }
  }
  return { line, character: col };
}

/**
 * Within the matched substring (starting at `matchOffset` in the full text),
 * find the character offset of `name`.
 */
export function findKeyStart(
  matchStr: string,
  name: string,
  matchOffset: number
): number {
  const idx = matchStr.indexOf(name);
  return idx >= 0 ? matchOffset + idx : matchOffset;
}

// ---------------------------------------------------------------------------
// Method definition patterns
// ---------------------------------------------------------------------------

/**
 * Regex patterns that match a method key `name` inside Meteor.methods({...}).
 *
 * Supported styles (all may have `async` prefix):
 *   1. Shorthand:        name(
 *   2. Quoted shorthand: 'name'(  or  "name"(
 *   3. Property:         name:
 *   4. Quoted property:  'name':  or  "name":
 */
export function buildMethodPatterns(name: string): RegExp[] {
  const esc = escapeRegex(name);
  return [
    // async? shorthand: name(
    new RegExp(`(?:^|[,{\\n\\r])\\s*(?:async\\s+)?${esc}\\s*\\(`, "gm"),
    // async? quoted shorthand: 'name'( or "name"(
    new RegExp(`(?:^|[,{\\n\\r])\\s*(?:async\\s+)?['"]${esc}['"]\\s*\\(`, "gm"),
    // property: name:
    new RegExp(`(?:^|[,{\\n\\r])\\s*${esc}\\s*:`, "gm"),
    // quoted property: 'name': or "name":
    new RegExp(`(?:^|[,{\\n\\r])\\s*['"]${esc}['"]\\s*:`, "gm"),
  ];
}

/**
 * Walk backwards from `matchIndex` in `text` to verify the match is inside
 * a `Meteor.methods({...})` block.
 */
export function isInsideMeteorMethods(
  text: string,
  matchIndex: number
): boolean {
  const lookback = text.slice(Math.max(0, matchIndex - 8000), matchIndex);
  const methodsIdx = lookback.lastIndexOf("Meteor.methods");
  if (methodsIdx < 0) return false;

  const between = lookback.slice(methodsIdx);
  let depth = 0;
  let inStr: string | null = null;
  for (const ch of between) {
    if (inStr) {
      if (ch === inStr) inStr = null;
    } else if (ch === "'" || ch === '"' || ch === "`") {
      inStr = ch;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth < 0) return false;
    }
  }
  return depth > 0;
}

/**
 * Scan `text` for all definitions of method `name` inside Meteor.methods blocks.
 * Returns an array of {line, character} positions (0-based).
 */
export function matchMethodsInText(text: string, name: string): LineCol[] {
  if (!text.includes("Meteor.methods")) return [];

  const patterns = buildMethodPatterns(name);
  const results: LineCol[] = [];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const afterMatch = match.index + match[0].length;
      if (!isInsideMeteorMethods(text, afterMatch)) continue;
      const keyOffset = findKeyStart(match[0], name, match.index);
      results.push(offsetToLineCol(text, keyOffset));
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Publish definition patterns
// ---------------------------------------------------------------------------

/**
 * Regex patterns for Meteor.publish("name", ...) and
 * Meteor.publish({ name() {} }) shorthand.
 */
export function buildPublishPatterns(name: string): RegExp[] {
  const esc = escapeRegex(name);
  return [
    // Meteor.publish("name", ...
    new RegExp(`Meteor\\s*\\.\\s*publish\\s*\\(\\s*['"]${esc}['"]`, "g"),
    // Meteor.publish({ async? name(
    new RegExp(
      `Meteor\\s*\\.\\s*publish\\s*\\(\\s*\\{[^}]{0,200}(?:async\\s+)?${esc}\\s*\\(`,
      "gs"
    ),
    // Meteor.publish({ 'name'( or "name"(
    new RegExp(
      `Meteor\\s*\\.\\s*publish\\s*\\(\\s*\\{[^}]{0,200}['"]${esc}['"]\\s*\\(`,
      "gs"
    ),
  ];
}

/**
 * Scan `text` for all Meteor.publish definitions of `name`.
 * Returns an array of {line, character} positions (0-based).
 */
export function matchPublishInText(text: string, name: string): LineCol[] {
  if (!text.includes("Meteor.publish")) return [];

  const patterns = buildPublishPatterns(name);
  const results: LineCol[] = [];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const keyOffset = findKeyStart(match[0], name, match.index);
      results.push(offsetToLineCol(text, keyOffset));
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Call-site name extraction
// ---------------------------------------------------------------------------

export type CallKind = "method" | "publish";

export interface ExtractedCall {
  name: string;
  kind: CallKind;
}

/**
 * Given a single line of source, the cursor column, and a lookback string
 * (the preceding lines + current line up to just before the opening quote),
 * determine whether the cursor is on the first string argument of a
 * Meteor.call / Meteor.callAsync / Meteor.subscribe call.
 *
 * Returns the extracted name and kind, or undefined if not applicable.
 */
export function extractCallNameFromLine(
  lineText: string,
  col: number,
  lookback: string
): ExtractedCall | undefined {
  // Walk backwards from cursor to find the opening quote
  let quoteChar: string | undefined;
  let nameStart = -1;
  for (let i = col; i >= 0; i--) {
    const ch = lineText[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      quoteChar = ch;
      nameStart = i + 1;
      break;
    }
    if (ch === "(" || ch === ",") return undefined;
  }
  if (!quoteChar || nameStart < 0) return undefined;

  // Walk forwards to find the closing quote
  let nameEnd = -1;
  for (let i = nameStart; i < lineText.length; i++) {
    if (lineText[i] === quoteChar) {
      nameEnd = i;
      break;
    }
  }
  if (nameEnd < 0 || col > nameEnd) return undefined;

  const name = lineText.slice(nameStart, nameEnd);
  if (!name) return undefined;

  const methodCallRe = /Meteor\s*\.\s*(?:call|callAsync)\s*\(\s*['"`]$/;
  const subscribeRe = /Meteor\s*\.\s*subscribe\s*\(\s*['"`]$/;

  // lookback should end with the opening quote character
  const lookbackWithQuote = lookback.endsWith(quoteChar)
    ? lookback
    : lookback + quoteChar;

  if (methodCallRe.test(lookbackWithQuote)) {
    return { name, kind: "method" };
  }
  if (subscribeRe.test(lookbackWithQuote)) {
    return { name, kind: "publish" };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Scan-all helpers (for the sidebar panel)
// ---------------------------------------------------------------------------

/**
 * Regex that captures a key name from inside a Meteor.methods / Meteor.publish
 * object literal. Group 1 = optional quote, group 2 = the name.
 */
const ALL_KEY_RE =
  /(?:^|[,{\n\r])\s*(?:async\s+)?(['"]?)([\w][\w/:-]*)\1\s*(?:\(|:)/gm;

/**
 * Scan `text` for ALL method definitions inside every `Meteor.methods` block.
 * Returns LineCol entries with `name` populated.
 */
export function matchAllMethodsInText(text: string): LineCol[] {
  if (!text.includes("Meteor.methods")) return [];

  const results: LineCol[] = [];
  ALL_KEY_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = ALL_KEY_RE.exec(text)) !== null) {
    const name = match[2];
    // Skip common JS keywords / identifiers that aren't method names
    if (
      [
        "return",
        "if",
        "else",
        "const",
        "let",
        "var",
        "function",
        "async",
      ].includes(name)
    )
      continue;
    const afterMatch = match.index + match[0].length;
    if (!isInsideMeteorMethods(text, afterMatch)) continue;

    const nameOffset = findKeyStart(match[0], name, match.index);
    results.push({ ...offsetToLineCol(text, nameOffset), name });
  }

  return results;
}

/**
 * Scan `text` for ALL Meteor.publish definitions.
 * Returns LineCol entries with `name` populated.
 */
export function matchAllPublishInText(text: string): LineCol[] {
  if (!text.includes("Meteor.publish")) return [];

  const results: LineCol[] = [];

  // Standard form: Meteor.publish("name", ...)
  const stdRe = /Meteor\s*\.\s*publish\s*\(\s*(['"])([\w][\w/:-]*)\1/g;
  stdRe.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = stdRe.exec(text)) !== null) {
    const name = match[2];
    const nameOffset = text.indexOf(name, match.index + match[0].indexOf(name));
    results.push({ ...offsetToLineCol(text, nameOffset), name });
  }

  // Object shorthand form: Meteor.publish({ name() {} })
  // Find the block start then extract keys
  const objRe = /Meteor\s*\.\s*publish\s*\(\s*\{/g;
  objRe.lastIndex = 0;
  while ((match = objRe.exec(text)) !== null) {
    const blockStart = match.index + match[0].length;
    // Extract keys from the object block
    const keyRe =
      /(?:^|[,{\n\r])\s*(?:async\s+)?(['"]?)([\w][\w/:-]*)\1\s*\(/gm;
    keyRe.lastIndex = blockStart;
    let keyMatch: RegExpExecArray | null;
    while ((keyMatch = keyRe.exec(text)) !== null) {
      const name = keyMatch[2];
      if (
        [
          "return",
          "if",
          "else",
          "const",
          "let",
          "var",
          "function",
          "async",
        ].includes(name)
      )
        continue;
      // Stop if we've gone past the closing brace of this publish block
      const lookback = text.slice(
        blockStart,
        keyMatch.index + keyMatch[0].length
      );
      let depth = 0;
      for (const ch of lookback) {
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth < 0) break;
        }
      }
      if (depth < 0) break;
      const nameOffset = findKeyStart(keyMatch[0], name, keyMatch.index);
      results.push({ ...offsetToLineCol(text, nameOffset), name });
    }
  }

  return results;
}

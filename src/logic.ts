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

// Keywords to skip when scanning for method/publish names
const SKIP_KEYWORDS = new Set([
  "return",
  "if",
  "else",
  "const",
  "let",
  "var",
  "function",
  "async",
  "await",
  "new",
  "this",
  "true",
  "false",
  "null",
  "undefined",
  "typeof",
  "instanceof",
]);

/**
 * Returns the brace depth of `matchIndex` relative to the nearest preceding
 * `Meteor.methods` call, or -1 if not inside any Meteor.methods block.
 *
 * depth == 1 → directly inside the methods object literal (a property key)
 * depth >  1 → inside a method body or nested structure
 */
export function depthInMeteorMethods(
  text: string,
  matchIndex: number
): number {
  const lookback = text.slice(Math.max(0, matchIndex - 8000), matchIndex);
  const methodsIdx = lookback.lastIndexOf("Meteor.methods");
  if (methodsIdx < 0) return -1;

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
      if (depth < 0) return -1;
    }
  }
  return depth;
}

/**
 * Walk backwards from `matchIndex` in `text` to verify the match is inside
 * a `Meteor.methods({...})` block.
 */
export function isInsideMeteorMethods(
  text: string,
  matchIndex: number
): boolean {
  return depthInMeteorMethods(text, matchIndex) > 0;
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

  // Also handle: functions defined externally and registered via shorthand
  // e.g.  async function insertTask() {}  →  Meteor.methods({ insertTask })
  if (isRegisteredAsExternalMethod(text, name)) {
    results.push(...matchExternalFunctionInText(text, name));
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
    if (SKIP_KEYWORDS.has(name)) continue;
    const afterMatch = match.index + match[0].length;
    if (!isInsideMeteorMethods(text, afterMatch)) continue;

    const nameOffset = findKeyStart(match[0], name, match.index);
    results.push({ ...offsetToLineCol(text, nameOffset), name });
  }

  // Also scan for shorthand external references: Meteor.methods({ insertTask, removeTask })
  // where the value is NOT followed by `:` or `(` (i.e. shorthand property).
  const externalRe = /(?:^|[,{\n\r])\s*([\w][\w$]*)\s*(?=[,}\n\r])/gm;
  const seenExternal = new Set<string>();
  externalRe.lastIndex = 0;
  while ((match = externalRe.exec(text)) !== null) {
    const name = match[1];
    if (SKIP_KEYWORDS.has(name) || seenExternal.has(name)) continue;
    const afterMatch = match.index + match[0].length;
    // Must be at depth exactly 1 — a direct property of the methods object,
    // not a variable reference inside a method body.
    if (depthInMeteorMethods(text, afterMatch) !== 1) continue;
    seenExternal.add(name);
    // Navigate to function definition in same file if available; otherwise
    // use the reference position inside Meteor.methods so the entry still appears.
    const defs = matchExternalFunctionInText(text, name);
    if (defs.length > 0) {
      for (const def of defs) results.push({ ...def, name });
    } else {
      const nameOffset = findKeyStart(match[0], name, match.index);
      results.push({ ...offsetToLineCol(text, nameOffset), name });
    }
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

// ---------------------------------------------------------------------------
// External function registration support
// ---------------------------------------------------------------------------

/**
 * Returns true if `name` appears as a **shorthand property reference** (no `:` or `(`)
 * inside any `Meteor.methods({ ... })` block in `text`.
 *
 * This handles the pattern:
 *   async function insertTask() { ... }
 *   Meteor.methods({ insertTask, removeTask });
 */
export function isRegisteredAsExternalMethod(
  text: string,
  name: string
): boolean {
  if (!text.includes("Meteor.methods")) return false;
  const esc = escapeRegex(name);
  // Match the bare identifier not preceded by a quote (to avoid quoted property keys)
  // and not followed by `:` or `(` (to distinguish from inline method definitions).
  const re = new RegExp(
    `(?:^|[,{\\s\\n\\r])${esc}(?=\\s*[,}\\n\\r])`,
    "gm"
  );
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const afterMatch = match.index + match[0].length;
    if (depthInMeteorMethods(text, afterMatch) === 1) return true;
  }
  return false;
}

/**
 * Find all top-level function definitions for `name` in `text`.
 * Matches:
 *   - async function name(
 *   - function name(
 *   - export async function name(
 *   - const/let/var name = ...  (covers arrow functions and function expressions)
 */
export function matchExternalFunctionInText(
  text: string,
  name: string
): LineCol[] {
  const esc = escapeRegex(name);
  const patterns = [
    // (export) async function name
    new RegExp(
      `(?:^|\\n)(?:export\\s+(?:default\\s+)?)?async\\s+function\\s+${esc}\\b`,
      "gm"
    ),
    // (export) function name
    new RegExp(
      `(?:^|\\n)(?:export\\s+(?:default\\s+)?)?function\\s+${esc}\\b`,
      "gm"
    ),
    // (export) const/let/var name =
    new RegExp(
      `(?:^|\\n)(?:export\\s+)?(?:const|let|var)\\s+${esc}\\s*=`,
      "gm"
    ),
  ];

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

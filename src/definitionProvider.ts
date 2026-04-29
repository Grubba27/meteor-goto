import * as vscode from "vscode";
import { extractCallNameFromLine } from "./logic";
import { findMethodDefinition, findPublishDefinition } from "./finder";
import { log } from "./logger";

/**
 * Build the lookback string: up to 3 lines before the current line plus the
 * current line up to (and including) the opening quote character at `endCol`.
 */
function buildLookback(
  document: vscode.TextDocument,
  lineIndex: number,
  endCol: number
): string {
  const parts: string[] = [];
  const startLine = Math.max(0, lineIndex - 3);
  for (let i = startLine; i < lineIndex; i++) {
    parts.push(document.lineAt(i).text);
  }
  parts.push(document.lineAt(lineIndex).text.slice(0, endCol + 1));
  return parts.join("\n");
}

export class MeteorDefinitionProvider implements vscode.DefinitionProvider {
  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): Promise<vscode.Location[] | undefined> {
    const lineText = document.lineAt(position.line).text;
    const col = position.character;

    // Walk back to find the opening quote position
    let quoteCol = -1;
    for (let i = col; i >= 0; i--) {
      const ch = lineText[i];
      if (ch === "'" || ch === '"' || ch === "`") {
        quoteCol = i;
        break;
      }
      if (ch === "(" || ch === ",") break;
    }
    if (quoteCol < 0) return undefined;

    const lookback = buildLookback(document, position.line, quoteCol);
    const detected = extractCallNameFromLine(lineText, col, lookback);
    if (!detected) return undefined;

    const { name, kind } = detected;
    log(
      `Go-to-definition triggered: "${name}" (${kind}) in ${
        document.fileName
      }:${position.line + 1}`
    );

    if (kind === "method") {
      return findMethodDefinition(name);
    } else {
      return findPublishDefinition(name);
    }
  }
}

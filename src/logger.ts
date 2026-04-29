import * as vscode from "vscode";

let channel: vscode.OutputChannel | undefined;

export function initLogger(c: vscode.OutputChannel): void {
  channel = c;
}

function isDebug(): boolean {
  return (
    vscode.workspace.getConfiguration("meteor-goto").get<boolean>("debug") ??
    false
  );
}

export function log(msg: string): void {
  if (!isDebug()) return;
  channel?.appendLine(`[${new Date().toISOString().slice(11, 23)}] ${msg}`);
}

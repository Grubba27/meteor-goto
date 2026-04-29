import * as vscode from "vscode";
import { MeteorDefinitionProvider } from "./definitionProvider";
import { MeteorSymbolsProvider } from "./symbolsProvider";
import { initLogger, log } from "./logger";

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel("Meteor");
  initLogger(outputChannel);
  log("Meteor Go-to-Definition activated");

  // --- Definition provider ---
  const defProvider = new MeteorDefinitionProvider();
  const languages = [
    "javascript",
    "typescript",
    "javascriptreact",
    "typescriptreact",
  ];
  for (const lang of languages) {
    context.subscriptions.push(
      vscode.languages.registerDefinitionProvider(
        { language: lang, scheme: "file" },
        defProvider
      )
    );
  }

  // --- Symbols tree view ---
  const symbolsProvider = new MeteorSymbolsProvider();
  const treeView = vscode.window.createTreeView("meteorSymbols", {
    treeDataProvider: symbolsProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // Refresh command
  context.subscriptions.push(
    vscode.commands.registerCommand("meteor-goto.refreshSymbols", () => {
      log("Refreshing symbols…");
      symbolsProvider.refresh();
    })
  );

  // Auto-refresh when JS/TS files change
  const watcher = vscode.workspace.createFileSystemWatcher(
    "**/*.{js,ts,jsx,tsx,mjs,cjs}"
  );
  const refreshOnChange = () => symbolsProvider.refresh();
  watcher.onDidChange(refreshOnChange);
  watcher.onDidCreate(refreshOnChange);
  watcher.onDidDelete(refreshOnChange);
  context.subscriptions.push(watcher);

  log("Extension ready");
}

export function deactivate(): void {}

import * as vscode from "vscode";
import * as path from "path";
import { matchAllMethodsInText, matchAllPublishInText, LineCol } from "./logic";

// ---------------------------------------------------------------------------
// Tree item types
// ---------------------------------------------------------------------------

export type SymbolKind = "method" | "publish";

export class CategoryItem extends vscode.TreeItem {
  constructor(public readonly kind: SymbolKind, count: number) {
    const label = kind === "method" ? "Methods" : "Publications";
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.description = `${count}`;
    this.iconPath = new vscode.ThemeIcon(
      kind === "method" ? "symbol-function" : "broadcast"
    );
    this.contextValue = "category";
  }
}

export class FileItem extends vscode.TreeItem {
  constructor(
    public readonly uri: vscode.Uri,
    public readonly kind: SymbolKind,
    count: number
  ) {
    super(path.basename(uri.fsPath), vscode.TreeItemCollapsibleState.Expanded);
    this.description = vscode.workspace.asRelativePath(
      path.dirname(uri.fsPath)
    );
    this.resourceUri = uri;
    this.iconPath = vscode.ThemeIcon.File;
    this.tooltip = uri.fsPath;
    this.description = `${count} — ${vscode.workspace.asRelativePath(uri)}`;
    this.contextValue = "file";
  }
}

export class SymbolItem extends vscode.TreeItem {
  constructor(
    public readonly name: string,
    public readonly uri: vscode.Uri,
    public readonly loc: LineCol,
    public readonly kind: SymbolKind
  ) {
    super(name, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(
      kind === "method" ? "symbol-method" : "symbol-event"
    );
    this.description = `line ${loc.line + 1}`;
    this.tooltip = `${vscode.workspace.asRelativePath(uri)}:${loc.line + 1}`;
    this.command = {
      command: "vscode.open",
      title: "Open",
      arguments: [
        uri,
        {
          selection: new vscode.Range(
            loc.line,
            loc.character,
            loc.line,
            loc.character + name.length
          ),
        } satisfies vscode.TextDocumentShowOptions,
      ],
    };
    this.contextValue = "symbol";
  }
}

type AnyItem = CategoryItem | FileItem | SymbolItem;

// ---------------------------------------------------------------------------
// Scan result types
// ---------------------------------------------------------------------------

interface SymbolEntry {
  name: string;
  uri: vscode.Uri;
  loc: LineCol;
  kind: SymbolKind;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const FILE_GLOB = "**/*.{js,ts,jsx,tsx,mjs,cjs}";
const EXCLUDE_GLOB =
  "{**/node_modules/**,**/.meteor/**,**/dist/**,**/build/**,**/_build/**}";

/**
 * Scan all workspace JS/TS files and extract Meteor method and publication
 * names with their locations.
 */
async function scanWorkspace(): Promise<SymbolEntry[]> {
  const files = await vscode.workspace.findFiles(FILE_GLOB, EXCLUDE_GLOB);
  const results: SymbolEntry[] = [];

  await Promise.all(
    files.map(async (uri) => {
      let text: string;
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        text = Buffer.from(bytes).toString("utf8");
      } catch {
        return;
      }

      for (const loc of matchAllMethodsInText(text)) {
        results.push({ name: loc.name!, uri, loc, kind: "method" });
      }
      for (const loc of matchAllPublishInText(text)) {
        results.push({ name: loc.name!, uri, loc, kind: "publish" });
      }
    })
  );

  return results;
}

export class MeteorSymbolsProvider implements vscode.TreeDataProvider<AnyItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    AnyItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private symbols: SymbolEntry[] = [];
  private loading = false;
  private loaded = false;

  refresh(): void {
    this.symbols = [];
    this.loaded = false;
    this.loading = false;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: AnyItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: AnyItem): Promise<AnyItem[]> {
    if (!element) {
      // Root — load data if needed
      if (!this.loaded && !this.loading) {
        this.loading = true;
        try {
          this.symbols = await scanWorkspace();
          this.loaded = true;
        } finally {
          this.loading = false;
        }
      }

      const methods = this.symbols.filter((s) => s.kind === "method");
      const pubs = this.symbols.filter((s) => s.kind === "publish");
      const items: AnyItem[] = [];
      if (methods.length > 0)
        items.push(new CategoryItem("method", methods.length));
      if (pubs.length > 0) items.push(new CategoryItem("publish", pubs.length));
      return items;
    }

    if (element instanceof CategoryItem) {
      // Group by file
      const entries = this.symbols.filter((s) => s.kind === element.kind);
      const byFile = new Map<
        string,
        { uri: vscode.Uri; symbols: SymbolEntry[] }
      >();
      for (const s of entries) {
        const key = s.uri.fsPath;
        if (!byFile.has(key)) byFile.set(key, { uri: s.uri, symbols: [] });
        byFile.get(key)!.symbols.push(s);
      }
      return Array.from(byFile.values()).map(
        (f) => new FileItem(f.uri, element.kind, f.symbols.length)
      );
    }

    if (element instanceof FileItem) {
      return this.symbols
        .filter(
          (s) => s.uri.fsPath === element.uri.fsPath && s.kind === element.kind
        )
        .map((s) => new SymbolItem(s.name, s.uri, s.loc, s.kind));
    }

    return [];
  }
}

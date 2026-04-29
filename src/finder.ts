import * as vscode from "vscode";
import { matchMethodsInText, matchPublishInText } from "./logic";
import { log } from "./logger";

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  locations: vscode.Location[];
}

const methodCache = new Map<string, CacheEntry>();
const publishCache = new Map<string, CacheEntry>();
let watcher: vscode.FileSystemWatcher | undefined;

function ensureWatcher(): void {
  if (watcher) return;
  watcher = vscode.workspace.createFileSystemWatcher(
    "**/*.{js,ts,jsx,tsx,mjs,cjs}"
  );
  const invalidate = (): void => {
    methodCache.clear();
    publishCache.clear();
    log("Cache invalidated (file changed)");
  };
  watcher.onDidChange(invalidate);
  watcher.onDidCreate(invalidate);
  watcher.onDidDelete(invalidate);
}

// ---------------------------------------------------------------------------
// File scanning helpers
// ---------------------------------------------------------------------------

const FILE_GLOB = "**/*.{js,ts,jsx,tsx,mjs,cjs}";
const EXCLUDE_GLOB =
  "{**/node_modules/**,**/.meteor/**,**/dist/**,**/build/**,**/_build/**}";

async function getWorkspaceFiles(): Promise<vscode.Uri[]> {
  return vscode.workspace.findFiles(FILE_GLOB, EXCLUDE_GLOB);
}

async function readFileText(uri: vscode.Uri): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(bytes).toString("utf8");
}

// ---------------------------------------------------------------------------
// Method definition search
// ---------------------------------------------------------------------------

export async function findMethodDefinition(
  name: string
): Promise<vscode.Location[]> {
  ensureWatcher();

  if (methodCache.has(name)) {
    const cached = methodCache.get(name)!.locations;
    log(`Cache hit for method "${name}" → ${cached.length} result(s)`);
    return cached;
  }

  const files = await getWorkspaceFiles();
  log(`Scanning ${files.length} file(s) for method "${name}"…`);

  const locations: vscode.Location[] = [];

  await Promise.all(
    files.map(async (uri) => {
      let text: string;
      try {
        text = await readFileText(uri);
      } catch {
        return;
      }

      const hits = matchMethodsInText(text, name);
      if (hits.length > 0) {
        log(`  Found ${hits.length} match(es) in ${uri.fsPath}`);
        for (const lc of hits) {
          locations.push(
            new vscode.Location(uri, new vscode.Position(lc.line, lc.character))
          );
        }
      }
    })
  );

  log(`Total results for method "${name}": ${locations.length}`);
  methodCache.set(name, { locations });
  return locations;
}

// ---------------------------------------------------------------------------
// Publish definition search
// ---------------------------------------------------------------------------

export async function findPublishDefinition(
  name: string
): Promise<vscode.Location[]> {
  ensureWatcher();

  if (publishCache.has(name)) {
    const cached = publishCache.get(name)!.locations;
    log(`Cache hit for publication "${name}" → ${cached.length} result(s)`);
    return cached;
  }

  const files = await getWorkspaceFiles();
  log(`Scanning ${files.length} file(s) for publication "${name}"…`);

  const locations: vscode.Location[] = [];

  await Promise.all(
    files.map(async (uri) => {
      let text: string;
      try {
        text = await readFileText(uri);
      } catch {
        return;
      }

      const hits = matchPublishInText(text, name);
      if (hits.length > 0) {
        log(`  Found ${hits.length} match(es) in ${uri.fsPath}`);
        for (const lc of hits) {
          locations.push(
            new vscode.Location(uri, new vscode.Position(lc.line, lc.character))
          );
        }
      }
    })
  );

  log(`Total results for publication "${name}": ${locations.length}`);
  publishCache.set(name, { locations });
  return locations;
}

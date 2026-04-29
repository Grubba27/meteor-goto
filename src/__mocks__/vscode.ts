// Minimal VS Code API mock for Jest tests.
// Only the symbols actually used by finder.ts / definitionProvider.ts are mocked.

export class Position {
  constructor(
    public readonly line: number,
    public readonly character: number
  ) {}
}

export class Location {
  constructor(public readonly uri: Uri, public readonly position: Position) {}
}

export class Uri {
  static file(path: string): Uri {
    return new Uri(path);
  }
  constructor(public readonly fsPath: string) {}
}

export const workspace = {
  findFiles: jest.fn().mockResolvedValue([]),
  fs: {
    readFile: jest.fn().mockResolvedValue(Buffer.from("")),
  },
  createFileSystemWatcher: jest.fn().mockReturnValue({
    onDidChange: jest.fn(),
    onDidCreate: jest.fn(),
    onDidDelete: jest.fn(),
  }),
};

export const languages = {
  registerDefinitionProvider: jest.fn(),
};

export const CancellationToken = {};

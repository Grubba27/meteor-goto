# Meteor Go-to-Definition

[![VS Code Marketplace](https://img.shields.io/badge/VS%20Code-Marketplace-blue?logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=grubba.meteor-goto)

Jump directly from a `Meteor.call` or `Meteor.subscribe` to the method or publication that handles it — with a single **Cmd+Click** (macOS) or **Ctrl+Click** (Windows/Linux), or by pressing **F12** (Go to Definition).

No more grepping for method names or manually searching across files.

![demo](https://github.com/Grubba27/meteor-goto/blob/main/example.png)

---

## Features

### Go to Method Definition

Place your cursor on the name string inside `Meteor.call` or `Meteor.callAsync` and press **Cmd+Click** / **F12**:

```js
Meteor.call("createInvoice", data);         // Cmd+Click "createInvoice"
Meteor.callAsync("createInvoice", data);    // works too
```

Navigates to:

```js
Meteor.methods({
  async createInvoice(data) {   // ← lands here
    // ...
  }
});
```

### Go to Publication Definition

Place your cursor on the name string inside `Meteor.subscribe` and press **Cmd+Click** / **F12**:

```js
Meteor.subscribe("invoices", filters);      // Cmd+Click "invoices"
```

Navigates to:

```js
Meteor.publish("invoices", function (filters) {   // ← lands here
  return InvoicesCollection.find(filters);
});
```

### Methods & Publications Panel

A **Meteor** icon appears in the Activity Bar (sidebar). Click it to open the **Methods & Publications** panel — a tree view of every method and publication found in the workspace, organised by file. Click any entry to jump to its definition.

The panel refreshes automatically when files change. Use the **↺** button in the panel header to force a manual refresh.

---

## Supported Syntax

### Callers

| Expression | Navigates to |
|---|---|
| `Meteor.call("name", ...)` | Method definition |
| `Meteor.callAsync("name", ...)` | Method definition |
| `Meteor.subscribe("name", ...)` | Publication definition |

### Method definition styles (all recognised)

```js
Meteor.methods({
  // Modern async shorthand
  async myMethod(arg) { },

  // Classic shorthand
  myMethod(arg) { },

  // Quoted names (e.g. with slashes)
  async 'accounts/resetPassword'(token) { },
  'accounts/resetPassword'(token) { },

  // Property assignment
  myMethod: async function(arg) { },
  myMethod: function(arg) { },

  // Quoted property assignment
  'accounts/resetPassword': async function(token) { },
});
```

### Publication definition styles (all recognised)

```js
// Standard form
Meteor.publish("myPub", async function() { ... });
Meteor.publish("myPub", function() { ... });

// Object shorthand
Meteor.publish({
  async myPub() { ... },
  myPub() { ... },
});
```

---

## Installation

### From the Marketplace

Search for **Meteor Go-to-Definition** in the VS Code Extensions panel, or install via the command palette:

```
ext install meteor.meteor-goto
```

### From source

```bash
git clone https://github.com/meteor/meteor-goto
cd meteor-goto
npm install
npm run compile
npm run package          # produces meteor-goto-x.y.z.vsix
```

Then in VS Code: **Extensions → Install from VSIX…** and select the generated file.

---

## Configuration

| Setting | Default | Description |
|---|---|---|
| `meteor-goto.debug` | `false` | Write diagnostic logs to the **Meteor** output channel (View → Output → Meteor) |

Enable debug mode in `settings.json`:

```json
"meteor-goto.debug": true
```

---

## How it works

The extension registers a VS Code **Definition Provider** for JavaScript, TypeScript, JSX, and TSX files. When Go to Definition is triggered on a string literal:

1. The provider checks whether the cursor is on the **first argument** of `Meteor.call`, `Meteor.callAsync`, or `Meteor.subscribe` — ignoring all other strings.
2. It scans every JS/TS file in the workspace (excluding `node_modules`, `.meteor`, `dist`, `build`) using regex patterns that match all supported definition styles.
3. A brace-depth heuristic confirms each candidate is actually inside a `Meteor.methods({...})` block.
4. Results are cached per name and invalidated automatically whenever any JS/TS file changes.

All matching logic is pure TypeScript with no runtime dependencies, keeping the extension lightweight.

---

## Contributing

```bash
npm test          # run the Jest unit test suite (27 tests, no VS Code host required)
npm run compile   # type-check and compile
npm run watch     # watch mode during development
```

Press **F5** inside VS Code with this folder open to launch the Extension Development Host and test live.

## Todo

- [X] Page for where the methods/publications are being created
  -[ ] Be able to add extra methods to the tree view (e.g. createMethod)
- [ ] Page for where the methods/publications are being called
  - Being able to add extra methods to the tree view (e.g. useSubscribe)

---

## License

MIT

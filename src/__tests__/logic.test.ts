import {
  extractCallNameFromLine,
  matchMethodsInText,
  matchPublishInText,
  offsetToLineCol,
  isInsideMeteorMethods,
  isRegisteredAsExternalMethod,
  matchExternalFunctionInText,
} from "../logic";

// ---------------------------------------------------------------------------
// offsetToLineCol
// ---------------------------------------------------------------------------

describe("offsetToLineCol", () => {
  it("returns line 0 col 0 for offset 0", () => {
    expect(offsetToLineCol("hello", 0)).toEqual({ line: 0, character: 0 });
  });

  it("counts columns correctly on first line", () => {
    expect(offsetToLineCol("hello world", 6)).toEqual({
      line: 0,
      character: 6,
    });
  });

  it("increments line at newline and resets col", () => {
    const text = "abc\ndef";
    expect(offsetToLineCol(text, 4)).toEqual({ line: 1, character: 0 });
    expect(offsetToLineCol(text, 5)).toEqual({ line: 1, character: 1 });
  });

  it("clamps to end of text for oversized offset", () => {
    const text = "hi";
    const result = offsetToLineCol(text, 1000);
    expect(result.line).toBe(0);
    expect(result.character).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// isInsideMeteorMethods
// ---------------------------------------------------------------------------

describe("isInsideMeteorMethods", () => {
  it("returns true when match is inside Meteor.methods block", () => {
    const text = `Meteor.methods({\n  myMethod() {\n  }\n});`;
    const idx = text.indexOf("myMethod");
    expect(isInsideMeteorMethods(text, idx)).toBe(true);
  });

  it("returns false when match is outside Meteor.methods block", () => {
    const text = `Meteor.methods({\n  myMethod() {}\n});\n\nmyMethod();`;
    const idx = text.lastIndexOf("myMethod");
    expect(isInsideMeteorMethods(text, idx)).toBe(false);
  });

  it("returns false when no Meteor.methods in lookback", () => {
    const text = `function foo() { myMethod(); }`;
    const idx = text.indexOf("myMethod");
    expect(isInsideMeteorMethods(text, idx)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchMethodsInText
// ---------------------------------------------------------------------------

describe("matchMethodsInText", () => {
  it("finds shorthand method definition", () => {
    const text = `Meteor.methods({\n  hello() {\n    return 1;\n  }\n});`;
    const results = matchMethodsInText(text, "hello");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].line).toBe(1);
  });

  it("finds async shorthand method definition", () => {
    const text = `Meteor.methods({\n  async hello() {\n    return 1;\n  }\n});`;
    const results = matchMethodsInText(text, "hello");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].line).toBe(1);
  });

  it("finds quoted shorthand method definition with slash", () => {
    const text = `Meteor.methods({\n  async 'tinytest/run'() {\n  }\n});`;
    const results = matchMethodsInText(text, "tinytest/run");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].line).toBe(1);
  });

  it("finds property-style method definition", () => {
    const text = `Meteor.methods({\n  changePassword: async function(old, next) {\n  }\n});`;
    const results = matchMethodsInText(text, "changePassword");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].line).toBe(1);
  });

  it("does not find method defined outside Meteor.methods block", () => {
    const text = `function hello() {}\nMeteor.methods({ other() {} });`;
    const results = matchMethodsInText(text, "hello");
    expect(results).toHaveLength(0);
  });

  it("returns empty array when name not present at all", () => {
    const text = `Meteor.methods({ foo() {} });`;
    expect(matchMethodsInText(text, "bar")).toHaveLength(0);
  });

  it("returns empty array when no Meteor.methods in file", () => {
    const text = `function hello() { return 42; }`;
    expect(matchMethodsInText(text, "hello")).toHaveLength(0);
  });

  it("finds multiple definitions of the same name in different blocks", () => {
    const text = [
      `Meteor.methods({ a() {} });`,
      `Meteor.methods({ a() {} });`,
    ].join("\n");
    const results = matchMethodsInText(text, "a");
    expect(results.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// matchPublishInText
// ---------------------------------------------------------------------------

describe("matchPublishInText", () => {
  it("finds standard Meteor.publish with string name", () => {
    const text = `Meteor.publish("myPub", async function() { this.stop(); });`;
    const results = matchPublishInText(text, "myPub");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].line).toBe(0);
  });

  it("finds Meteor.publish with single-quoted name", () => {
    const text = `Meteor.publish('myPub', function() {});`;
    const results = matchPublishInText(text, "myPub");
    expect(results.length).toBeGreaterThan(0);
  });

  it("finds shorthand object-form Meteor.publish", () => {
    const text = `Meteor.publish({\n  async myPub() {\n    this.stop();\n  }\n});`;
    const results = matchPublishInText(text, "myPub");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].line).toBeGreaterThanOrEqual(0);
  });

  it("returns empty when name does not match", () => {
    const text = `Meteor.publish("otherPub", function() {});`;
    expect(matchPublishInText(text, "myPub")).toHaveLength(0);
  });

  it("returns empty when no Meteor.publish in file", () => {
    const text = `function myPub() {}`;
    expect(matchPublishInText(text, "myPub")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// extractCallNameFromLine
// ---------------------------------------------------------------------------

describe("extractCallNameFromLine", () => {
  function makeLookback(line: string, quoteCol: number): string {
    return line.slice(0, quoteCol + 1);
  }

  it("extracts method name from Meteor.call", () => {
    const line = `  Meteor.call("myMethod", arg1);`;
    const quoteCol = line.indexOf('"');
    const col = quoteCol + 3; // cursor inside string
    const result = extractCallNameFromLine(
      line,
      col,
      makeLookback(line, quoteCol)
    );
    expect(result).toEqual({ name: "myMethod", kind: "method" });
  });

  it("extracts method name from Meteor.callAsync", () => {
    const line = `Meteor.callAsync('doThing', 1);`;
    const quoteCol = line.indexOf("'");
    const col = quoteCol + 2;
    const result = extractCallNameFromLine(
      line,
      col,
      makeLookback(line, quoteCol)
    );
    expect(result).toEqual({ name: "doThing", kind: "method" });
  });

  it("extracts publication name from Meteor.subscribe", () => {
    const line = `Meteor.subscribe("myPub", extra);`;
    const quoteCol = line.indexOf('"');
    const col = quoteCol + 2;
    const result = extractCallNameFromLine(
      line,
      col,
      makeLookback(line, quoteCol)
    );
    expect(result).toEqual({ name: "myPub", kind: "publish" });
  });

  it("handles slash in method name", () => {
    const line = `Meteor.call('tinytest/run', runId);`;
    const quoteCol = line.indexOf("'");
    const col = quoteCol + 6;
    const result = extractCallNameFromLine(
      line,
      col,
      makeLookback(line, quoteCol)
    );
    expect(result).toEqual({ name: "tinytest/run", kind: "method" });
  });

  it("returns undefined for second argument string", () => {
    const line = `Meteor.call("method", "secondArg");`;
    const secondQuoteCol = line.indexOf('"', line.indexOf('"') + 1);
    const col = secondQuoteCol + 2;
    // lookback includes the comma — the walk-back hits ',' before a quote
    const result = extractCallNameFromLine(
      line,
      col,
      makeLookback(line, secondQuoteCol)
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined for unrelated string", () => {
    const line = `const x = "hello";`;
    const quoteCol = line.indexOf('"');
    const col = quoteCol + 2;
    const result = extractCallNameFromLine(
      line,
      col,
      makeLookback(line, quoteCol)
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined when cursor is outside the string (past closing quote)", () => {
    const line = `Meteor.call("foo", bar);`;
    const quoteCol = line.indexOf('"');
    // Place cursor after the closing quote
    const closingQuote = line.indexOf('"', quoteCol + 1);
    const col = closingQuote + 2; // past the closing quote
    const result = extractCallNameFromLine(
      line,
      col,
      makeLookback(line, quoteCol)
    );
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// isRegisteredAsExternalMethod
// ---------------------------------------------------------------------------

describe("isRegisteredAsExternalMethod", () => {
  it("returns true for shorthand reference in Meteor.methods", () => {
    const text = [
      `async function insertTask() {}`,
      `Meteor.methods({ insertTask });`,
    ].join("\n");
    expect(isRegisteredAsExternalMethod(text, "insertTask")).toBe(true);
  });

  it("returns true for shorthand in multi-name Meteor.methods", () => {
    const text = [
      `async function insertTask() {}`,
      `async function removeTask() {}`,
      `Meteor.methods({ insertTask, removeTask });`,
    ].join("\n");
    expect(isRegisteredAsExternalMethod(text, "removeTask")).toBe(true);
  });

  it("returns false for inline method definition (has parens)", () => {
    const text = `Meteor.methods({ insertTask() {} });`;
    expect(isRegisteredAsExternalMethod(text, "insertTask")).toBe(false);
  });

  it("returns false for property-style method definition (has colon)", () => {
    const text = `Meteor.methods({ insertTask: async function() {} });`;
    expect(isRegisteredAsExternalMethod(text, "insertTask")).toBe(false);
  });

  it("returns false when no Meteor.methods in file", () => {
    const text = `async function insertTask() {}`;
    expect(isRegisteredAsExternalMethod(text, "insertTask")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchExternalFunctionInText
// ---------------------------------------------------------------------------

describe("matchExternalFunctionInText", () => {
  it("finds async function declaration", () => {
    const text = `async function insertTask({ description }) {\n  return 1;\n}`;
    const results = matchExternalFunctionInText(text, "insertTask");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].line).toBe(0);
  });

  it("finds regular function declaration", () => {
    const text = `function removeTask({ taskId }) {\n  return Tasks.removeAsync(taskId);\n}`;
    const results = matchExternalFunctionInText(text, "removeTask");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].line).toBe(0);
  });

  it("finds const arrow function", () => {
    const text = `const toggleTaskDone = async ({ taskId }) => {\n  return 1;\n};`;
    const results = matchExternalFunctionInText(text, "toggleTaskDone");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].line).toBe(0);
  });

  it("finds const function expression", () => {
    const text = `const insertTask = function({ description }) {\n  return 1;\n};`;
    const results = matchExternalFunctionInText(text, "insertTask");
    expect(results.length).toBeGreaterThan(0);
  });

  it("returns empty for unrelated function name", () => {
    const text = `async function insertTask() {}`;
    expect(matchExternalFunctionInText(text, "removeTask")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// matchMethodsInText — external function pattern (end-to-end)
// ---------------------------------------------------------------------------

describe("matchMethodsInText — external function registration", () => {
  const sampleText = [
    `async function insertTask({ description }) {`,
    `  return Tasks.insertAsync({ description });`,
    `}`,
    `async function removeTask({ taskId }) {`,
    `  return Tasks.removeAsync(taskId);`,
    `}`,
    `async function toggleTaskDone({ taskId }) {`,
    `  return Tasks.updateAsync(taskId, {});`,
    `}`,
    `Meteor.methods({ insertTask, removeTask, toggleTaskDone });`,
  ].join("\n");

  it("navigates to async function definition via shorthand registration", () => {
    const results = matchMethodsInText(sampleText, "insertTask");
    expect(results.length).toBeGreaterThan(0);
    // Should point to the function definition on line 0, not the Meteor.methods line
    expect(results[0].line).toBe(0);
  });

  it("finds second external method", () => {
    const results = matchMethodsInText(sampleText, "removeTask");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].line).toBe(3);
  });

  it("finds third external method", () => {
    const results = matchMethodsInText(sampleText, "toggleTaskDone");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].line).toBe(6);
  });

  it("returns empty for a name not registered in Meteor.methods", () => {
    const results = matchMethodsInText(sampleText, "notAMethod");
    expect(results).toHaveLength(0);
  });
});

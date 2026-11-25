import { test } from "node:test";
import assert from "node:assert/strict";
import { iniFolds, objFolds } from "../src/folding";

test("INI folds keep the next header and trailing blank lines visible", () => {
  assert.deepEqual(iniFolds(["[Empty]", "[Textures]", "Map=a.png", "", "[Next]", "A=1", ""]),
    [{ startLine: 1, endLine: 2 }, { startLine: 4, endLine: 5 }]);
});

test("OBJ groups nest within objects and end at the next header", () => {
  const lines = ["v 0 0 0", "o First", " g Face", "f 1 2 3", "", "g", "# detail", "o Empty", "o Last", "v 1 1 1"];
  assert.deepEqual(objFolds({ lineCount: lines.length, lineAt: i => ({ text: lines[i] }) }),
    [[1, 6], [2, 3], [5, 6], [8, 9]].map(([startLine, endLine]) => ({ startLine, endLine })));
});

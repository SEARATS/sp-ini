import { test } from "node:test";
import assert from "node:assert/strict";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { buildCatalog } from "../src/catalog";
import { parse } from "../src/ini";
import { completions, exact, inspect, diagnostics, symbols } from "../src/features";

test("indexes stock and mod definitions, including extensions and overlapping unit IDs", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "seapower-ini-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const roots = ["Local", "Workshop", "Vanilla"].map(source => ({ source, dir: path.join(dir, source) }));
  for (const root of roots) {
    await fs.mkdir(path.join(root.dir, "vessels"), { recursive: true });
    await fs.writeFile(path.join(root.dir, "vessels", root.source + ".ini"), "[General]\nUnitType=Vessel\n");
    await fs.writeFile(path.join(root.dir, "vessels/shared.ini"), "[General]\nUnitType=Vessel\n");
  }
  await fs.writeFile(path.join(roots[0].dir, "patch.ini"), "#!extend vessels/shared.ini\n[General]\nLocalKey=7");
  await fs.writeFile(path.join(roots[0].dir, "layout.ini"), "[Nations]\nCustom_Nation=Custom Nation");
  await fs.writeFile(path.join(roots[2].dir, "nations.ini"), "[Nations]\nSouth_Africa=South Africa");
  const catalog = await buildCatalog(roots);
  const uri = "file:///missions/demo.ini";
  const mission = parse("[Taskforce1Vessel42]\r\nType=shared // comment\r\nType=missing");
  const lookup = (doc, line, character) => inspect(doc, uri, { line, character }, catalog);
  for (const [name,file] of [["South_Africa","nations.ini"],["Custom_Nation","layout.ini"]]) {
    const squadron = parse("[Squadron1]\n# nations are referenced in the layout.ini file:\nNation="+name);
    const info = lookup(squadron,2,8);
    assert.equal(exact(info)[0].file.rel,file);
    const suggestions = completions(info,{line:2,character:8});
    assert.ok((Array.isArray(suggestions) ? suggestions : suggestions.items).some(item=>item.label===name));
    assert.equal(diagnostics(squadron,catalog).length,0);
  }
  assert.deepEqual(exact(lookup(mission, 1, 7)).map(r => r.file.source), ["Local", "Workshop", "Vanilla"]);
  assert.deepEqual(diagnostics(mission, catalog).map(d => d.message), [
    "Type has a different value on line 2 of this section.", "Unit ID 'missing' was not found in the indexed content folders."
  ]);
  const typePos = { line: 1, character: 5 };
  const items = completions(lookup(mission, 1, 5), typePos);
  assert.ok(Array.isArray(items));
  assert.deepEqual(items.map(c => c.label).sort(), ["Local", "Vanilla", "Workshop", "shared"]);
  const patch = parse("#!extend vessels/shared.ini\n[General]\nLoc");
  assert.equal(completions(lookup(patch, 2, 3), { line: 2, character: 3 })[0].textEdit.newText, "LocalKey=");
  assert.equal(exact(lookup(patch, 0, 15)).length, 3);
  assert.equal(symbols(mission)[0].children.length, 2);
});

test("preserves URLs and equals in values and reports incomplete constructs", () => {
  const doc = parse("\uFEFF[Workshop]\nUrl=https://example.org/?id=7\n[--- Units ---]\n#!repeat i=1-3\n[Broken\n; comment");
  assert.equal(doc.entries[0].value, "https://example.org/?id=7");
  assert.deepEqual(doc.sections.map(s => s.name), ["Workshop"]);
  assert.deepEqual(doc.issues.map(d => d.line), [4, 3]);
});

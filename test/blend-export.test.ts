import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { exportBlend } from "../src/blend-export";

test("a failed Blender export restores the previous OBJ and material library", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sp-ini-export-test-"));
  try {
    const obj = join(dir, "ship.obj"), mtl = join(dir, "ship.mtl");
    await writeFile(obj, "old mesh");
    await writeFile(mtl, "old material");
    await assert.rejects(exportBlend(join(dir, "missing-blender"), join(dir, "ship.blend"), obj, "obj"), {code:"ENOENT"});
    assert.equal(await readFile(obj, "utf8"), "old mesh");
    assert.equal(await readFile(mtl, "utf8"), "old material");
    assert.deepEqual((await readdir(dir)).sort(), ["ship.mtl","ship.obj"]);
  } finally { await rm(dir, {recursive:true, force:true}); }
});

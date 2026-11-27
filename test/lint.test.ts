import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { analyze } from "../src/analysis";

test("bulk analysis checks nested saved files once and respects inline suppressions", async () => {
  const dir=await mkdtemp(path.join(tmpdir(),"sp-ini-analysis-"));
  try {
    const sub=path.join(dir,"nested");
    await mkdir(sub);
    await writeFile(path.join(sub,"test.INI"),"[Example]\nKey=1\nKey=1 ; sp-ini-ignore duplicate-key\nKey=2");
    const findings=[];
    const options={search:{game:false,installedMods:false,userMods:false,workshop:false}};
    const {summary,exitCode}=await analyze([dir,sub],options,(file,issues)=>findings.push([file,issues.map(d=>d.code)]));
    assert.equal(exitCode,1);
    assert.deepEqual(findings,[[path.join(sub,"test.INI"),["conflicting-duplicate-key"]]]);
    assert.match(summary,/Analyzed 1 INIs: 1 errors, 0 warnings/);
    await writeFile(path.join(sub,"test.INI"),"[Example]\nKey=1");
    assert.equal((await analyze([dir],options,()=>{})).exitCode,0);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

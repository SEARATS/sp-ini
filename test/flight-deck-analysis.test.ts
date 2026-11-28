import test from "node:test";
import assert from "node:assert/strict";
import { Catalog } from "../src/catalog";
import { diagnostics, documentLinks, exact, inspect } from "../src/features";
import { parse } from "../src/ini";
import { unitHints } from "../src/unit-hints";

const uri="file:///mod/vessels/carrier.ini";
test("deck hints use seconds, knots and the coordinate system of each path", async()=>{
  const doc=parse("[FlightDeck]\nSpawnInterval=1\nForwardsTaxiVelocity=10\nHoldWaypoints=0,500,1|2,600,1\n[RecoveryPoint4]\nLandingInterval=100\nRotation=180\n[TaxiPath1]\nWaypoints=0,1,2|4,5,6\n[Other]\nLandingInterval=100");
  const hints=await unitHints(doc,uri,{start:{line:0,character:0},end:{line:20,character:0}});
  assert.deepEqual(hints.map(h=>h.label),["s","kt","nmi, ft, nmi","s","°","Unity units"]);
  assert.equal(hints[3].position.character,"LandingInterval=100".length);
});

test("deck count diagnostics distinguish negative, clipped and missing numbered sections",()=>{
  const check=(text:string)=>diagnostics(parse(text),new Catalog(),uri).map(d=>d.code);
  for (const name of ["Elevator","LaunchPoint","RecoveryPoint","TaxiPoint","TaxiPath","DeckZone"]) {
    const prop="[FlightDeck]\nNumberOf"+name+"s=";
    assert.ok(check(prop+"-1").includes("negative-count"));
    assert.ok(check(prop+"1.5").includes("invalid-value"));
    assert.ok(check(prop+"2147483648").includes("count-overflow"));
    assert.deepEqual(check(prop+"1\n["+name+"1]"),[]);
    assert.deepEqual(check(prop+"2\n["+name+"1]\n["+name+"3]").sort(),["count-too-large","count-too-small"]);
    assert.ok(!check("#!copy vessels/base.ini\n"+prop+"3").includes("count-too-large"));
  }
  assert.deepEqual(check("[DeckZone1]\nNumberOfPoints=3\nPoint1=0,0,0"),["count-too-large"]);
});

test("each elevator launch index gets its own clickable range and definition",()=>{
  const catalog=new Catalog();
  const text="[FlightDeck]\nNumberOfLaunchPoints=5\n[Elevator1]\nAssociatedLaunchPoints=3, 4,5\n"+
    [1,2,3,4,5].map(n=>"[LaunchPoint"+n+"]").join("\n");
  function links(text:string){
    const doc=parse(text);
    return documentLinks(doc,uri,catalog).filter(l=>l.range.start.line===3).map(l=>{
      const {line,character}=l.range.start;
      const ref=exact(inspect(doc,uri,{line,character},catalog))[0];
      assert.equal(l.target,uri+"#L"+(ref.line+1));
      return [doc.lines[line].slice(character,l.range.end.character),doc.lines[ref.line]];
    });
  }
  assert.deepEqual(links(text),[["3","[LaunchPoint3]"],["4","[LaunchPoint4]"],["5","[LaunchPoint5]"]]);
  assert.deepEqual(links(text.replace("[LaunchPoint2]","")), [["3","[LaunchPoint4]"],["4","[LaunchPoint5]"]]);
  assert.deepEqual(links(text.replace("3, 4,5","-1")),[]);
});

import assert from "node:assert/strict";
import test from "node:test";
import { Group, Mesh, MeshPhongMaterial, Texture } from "three";
import { markMissingMaps, missingTextureColors } from "../src/missing-textures";
import { applyDisplay } from "../src/preview-display";

test("only failed diffuse maps follow the selected missing texture color", () => {
  const solid = new MeshPhongMaterial({color:0x246802, normalMap:new Texture()});
  const loaded = new MeshPhongMaterial({map:new Texture({width:1,height:1} as ImageData)});
  const missing = new MeshPhongMaterial({map:new Texture(), vertexColors:true});
  const model = new Group().add(new Mesh(undefined, [solid, loaded, missing]));
  markMissingMaps(model);
  for (const color of ["black","grey","magenta"] as const) {
    applyDisplay(model, new Map(), new Set(), {meshes:true, colliders:true, meshWireframe:false, colliderWireframe:true, missingTextureColor:color});
    assert.equal(missing.color.getHex(), missingTextureColors[color]);
    assert.equal(missing.map, null);
    assert.equal(missing.vertexColors, false);
    assert.equal(solid.color.getHex(), 0x246802);
    assert.ok(loaded.map?.image);
    assert.equal(loaded.color.getHex(), 0xffffff);
  }
});

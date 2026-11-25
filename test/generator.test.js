const {test} = require("node:test");
const assert = require("node:assert/strict");
const {generate,snippet,hierarchy,selectParent} = require("../src/hierarchy");
const {isColliderName} = require("../src/mesh-names");
const source = `Objects: {
 Model: 1, "Model::Hull", "Null" {
 }
 Model: 2, "Model::House", "Mesh" {
  Properties70: {
   P: "Lcl Translation","Lcl Translation","","A",1,2,3
  }
 }
 Model: 3, "Model::Antenna", "Mesh" {
  Properties70: {
   P: "Lcl Translation","Lcl Translation","","A",4,5,6
  }
 }
 Model: 4, "Model::Hull_Col", "Mesh" {
 }
 Geometry: 5, "Geometry::Hull_Col", "Mesh" {
 }
}
Connections: {
 C: "OO",2,1
 C: "OO",3,2
 C: "OO",4,1
 C: "OO",5,4
}`;
test("FBX subtree regeneration preserves manual INI text and child-local offsets",()=>{
  const parent = selectParent(hierarchy(Buffer.from(source)),"Hull");
  const original="[Colliders]\r\nNumberOfMeshColliders=1 ; existing\r\nMeshCollider1=Hand\r\n[Hand]\r\nCollider=Handwritten\r\n";
  const text=generate(original,"ship.fbx",parent);
  assert.match(text,/NumberOfMeshColliders=2 ; existing/);
  assert.match(text,/Parent=House\r\nPosition=-4,5,6/);
  assert.match(text,/MeshCollider2=Hull_Col/);
  assert.match(text,/Collider=Handwritten/);
  assert.equal(generate(text,"ship.fbx",parent),text);
  const paste=snippet("ship.fbx",parent,{"/Hull/House":"Skip"});
  assert.match(paste,/Parent=Hull\nPosition=-5,7,9/);
  assert.match(paste,/Collider=Hull_Col/);
  assert.doesNotMatch(paste,/sp-ini|Handwritten/);
  assert.equal(isColliderName("Hull_Col"),true);
  assert.equal(isColliderName("Hull"),false);
});

import test from "node:test";
import assert from "node:assert/strict";
import { unityPropertyDiagnostics } from "../src/material-properties";
import { diagnostics } from "../src/features";
import { parse } from "../src/ini";

test("Sea Power material properties validate the loader's typed argument and known shader bounds", () => {
  const doc = (text:string,shader="Standard") => parse("[Shader]\nPath="+shader+"\n[Properties]\n"+text);
  const check = (text:string,shader?:string) => diagnostics(doc(text,shader),undefined,"file:///mod/paint.ini");
  const body = "_Bad=Float, oops\n_Fraction=Int,1.5\n_Big=Int,2147483648\n_Metallic=Float,1.1\n_Typo=float,0\n_Extra=Float,1,2";
  const issues = check(body);
  assert.deepEqual(issues.map(d=>d.code),["material-property-value","material-property-value","material-property-value","material-property-range","material-property-type","ignored-material-argument"]);
  assert.equal(issues[0].range.start.character,12);
  assert.equal(issues[3].severity,2);
  assert.deepEqual(check("_Cutoff=Float,2","Custom/Unbounded"),[]);
  assert.deepEqual(check("_HDR=Float,6.5\n_Bias=Float,-1e-4\n_ID=Int,-2147483648\n_Color=Color,{*}ffaa00\n_Metallic=Float,1"),[]);
  assert.deepEqual(check("_Bad=Float,Nope ; sp-ini-ignore material-property-value"),[]);
  assert.equal(check("_Overflow=Float,1e60")[0].code,"material-property-value");
});

test("Unity material diagnostics highlight numeric YAML scalars, including texture transforms and HDR colors", () => {
  const text = ["%YAML 1.1","%TAG !u! tag:unity3d.com,2011:","--- !u!21 &2100000","Material:",
    "  m_Shader: {fileID: 46, guid: 0000000000000000f000000000000000, type: 0}","  m_SavedProperties:",
    "    m_Floats:","    - _Metallic: 1.5","    - _Bias: -0.003","    - _Missing:","    m_Ints:","    - _Layer: 2.5",
    "    m_Colors:","    - _EmissionColor: {r: 4.2, g: nope, b: 0, a: 1}","    m_TexEnvs:","    - _MainTex:",
    "        m_Scale: {x: -2, y: bad}","        m_Offset: {x: .5, y: 0}","--- !u!114 &1","MonoBehaviour: {}"].join("\r\n");
  const issues = unityPropertyDiagnostics(text);
  const lines = text.split("\r\n");
  assert.deepEqual(issues.map(d=>[d.code,lines[d.range.start.line].slice(d.range.start.character,d.range.end.character)]),
   [["material-property-value","2.5"],["material-property-range","1.5"],["material-property-value",""],["material-property-value","nope"],["material-property-value","bad"]]);
  assert.equal(unityPropertyDiagnostics(text.replace("0000000000000000f000000000000000","abcdef")).some(d=>d.code==="material-property-range"),false);
  assert.deepEqual(unityPropertyDiagnostics("MATLAB 5.0 MAT-file"),[]);
});

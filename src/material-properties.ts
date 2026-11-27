import { isMap, isSeq, isScalar, parseDocument, type Node } from "yaml";
import { DiagnosticSeverity, Range, type Diagnostic } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { ignoredRules } from "./ini-edits";
import { type IniEntry, type parse } from "./ini";
import { materialBody } from "./unity-material";

const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const standardSliders = new Set(["_Metallic","_Glossiness","_GlossMapScale","_Cutoff","_OcclusionStrength"]);
function numericIssue(name: string, type: "Int" | "Float", raw: string, standard = false) {
  const n = Number(raw);
  const valid = type === "Int" ? /^[+-]?\d+$/.test(raw) && n >= -2147483648 && n <= 2147483647
    : decimal.test(raw) && Number.isFinite(Math.fround(n));
  if (!valid) return {severity:DiagnosticSeverity.Error, code:"material-property-value",
    message:name+" expects "+(type === "Int" ? "a signed 32-bit integer." : "a finite 32-bit float.")};
  if (standard && standardSliders.has(name) && (n < 0 || n > 1))
    return {severity:DiagnosticSeverity.Warning, code:"material-property-range", message:name+" is outside the Standard shader's slider range (0 to 1)."};
}

export function materialProperties(doc: ReturnType<typeof parse>): Diagnostic[] {
  const sections = doc.sections.filter(s => /^properties$/i.test(s.name));
  if (!sections.length) return [];
  const shader = doc.sections.find(s => /^shader$/i.test(s.name));
  const material = shader || doc.sections.some(s => /^textures$/i.test(s.name));
  const standard = /^Standard(?: \(Specular setup\))?$/.test(shader?.keys.find(k => /^path$/i.test(k.name))?.value ?? "");
  return sections.flatMap(s => s.keys.flatMap(k => {
    if (!material && !/^(?:float|int|color)\s*,/i.test(k.value) && !k.name.startsWith("_")) return [];
    const issue = iniMaterialProperty(k, standard);
    return issue && !ignoredRules(doc.lines[k.line]).includes(String(issue.code)) ? [issue] : [];
  }));
}

function iniMaterialProperty(entry: IniEntry, standard: boolean): Diagnostic | undefined {
  const comma = entry.value.indexOf(",");
  const type = (comma < 0 ? entry.value : entry.value.slice(0,comma)).trim();
  const token = comma < 0 ? "" : entry.value.slice(comma+1).split(",",1)[0];
  let issue, start = entry.valueStart, length = type.length;
  if (!["Float","Int","Color"].includes(type) || comma < 0) {
    issue = {severity:DiagnosticSeverity.Error, code:"material-property-type", message:entry.name+" expects Float,value, Int,value or Color,value."};
  } else {
    const value = token.trim();
    if (/\{[^}]+\}/.test(value) && !value.includes("{*}")) return;
    start += comma + 1 + token.length - token.trimStart().length;
    length = value.length;
    if (type === "Color") {
      if (!/^(?:(?:\{\*\}|#)(?:[a-f\d]{3,4}|[a-f\d]{6}|[a-f\d]{8})|red|cyan|blue|darkblue|lightblue|purple|yellow|lime|fuchsia|white|silver|grey|black|orange|brown|maroon|green|olive|navy|teal|aqua|magenta)$/i.test(value))
        issue = {severity:DiagnosticSeverity.Error,code:"material-property-value",message:entry.name+" expects an HTML color, for example Color,{*}FF8040."};
    } else issue = numericIssue(entry.name,type as "Float"|"Int",value,standard);
  }
  if (!issue && entry.value.indexOf(",",comma+1) >= 0) {
    start = entry.valueStart + entry.value.indexOf(",",comma+1);
    length = entry.valueStart + entry.value.length - start;
    issue = {severity:DiagnosticSeverity.Warning,code:"ignored-material-argument",message:"Sea Power reads only the first value after "+type+"."};
  }
  if (issue) return {...issue,source:"Sea Power INI",range:Range.create(entry.line,start,entry.line,start+length)};
}

export function unityPropertyDiagnostics(text: string): Diagnostic[] {
  const body = materialBody(text);
  if (!body) return [];
  const doc = parseDocument(body.text,{schema:"failsafe"});
  const saved = doc.getIn(["Material","m_SavedProperties"],true);
  if (!isMap(saved)) return [];
  const shader = doc.getIn(["Material","m_Shader"],true);
  const standard = isMap(shader) && shader.get("guid") === "0000000000000000f000000000000000" && shader.get("fileID") === "46";
  const source = TextDocument.create("","yaml",0,text);
  const issues: Diagnostic[] = [];
  function check(node: unknown, name: string, type: "Int"|"Float", useShader = false) {
    if (!node || !(node as Node).range) return;
    const issue = numericIssue(name,type,isScalar(node) ? String(node.value ?? "") : "",useShader && standard);
    if (issue) {
      const [a,b] = (node as Node).range;
      issues.push({...issue,source:"Sea Power INI",range:{start:source.positionAt(body.offset+a),end:source.positionAt(body.offset+b)}});
    }
  }
  for (const key of ["m_Ints","m_Floats","m_Colors","m_TexEnvs"]) {
    const group = saved.get(key,true);
    for (const row of isSeq(group) ? group.items : [group]) {
      if (!isMap(row)) continue;
      for (const {key:property,value} of row.items) {
        const name = String(property);
        if (key === "m_Ints" || key === "m_Floats") check(value,name,key === "m_Ints" ? "Int" : "Float",true);
        else if (isMap(value)) {
          if (key === "m_Colors") {
            for (const component of ["r","g","b","a"]) check(value.get(component,true),name+"."+component,"Float");
          } else {
            for (const field of ["m_Scale","m_Offset"]) {
              const vector = value.get(field,true);
              if (isMap(vector)) for (const axis of ["x","y"]) check(vector.get(axis,true),name+"."+field+"."+axis,"Float");
            }
          }
        }
      }
    }
  }
  return issues;
}

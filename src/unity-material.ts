import { parse as parseYaml } from "yaml";
import { parse } from "./ini";

type SavedProperties = Record<string, unknown> | Record<string, unknown>[];
interface UnityMaterial {
  stringTagMap?: {RenderType?: string};
  m_SavedProperties?: Record<string, SavedProperties>;
}
function entries(properties?: SavedProperties) {
  return Array.isArray(properties) ? properties.flatMap(row => Object.entries(row ?? {})) : Object.entries(properties ?? {});
}

// Unity writes each serialized object as a tagged YAML document. A .mat may also contain editor metadata.
export function materialBody(text: string) {
  const match = /^\uFEFF?Material:[^\S\n]*$/m.exec(text);
  if (!match) return;
  const offset = match.index + (match[0].startsWith("\uFEFF") ? 1 : 0);
  return {offset,text:text.slice(offset).split(/^---/m,1)[0]};
}
export function unityMaterial(text: string) {
  const body = materialBody(text);
  if (!body) return;
  let material: UnityMaterial;
  try {
    // Keep all-digit GUIDs and leading zeroes intact.
    material = parseYaml(body.text, {schema:"failsafe", maxAliasCount:0}).Material;
  } catch { return; }
  const saved = material?.m_SavedProperties;
  if (!saved) return;
  const properties = new Map<string,string>();
  for (const [key,value] of [...entries(saved.m_Ints), ...entries(saved.m_Floats)]) {
    if (typeof value === "string") properties.set(key,value);
  }
  for (const [key,value] of entries(saved.m_Colors)) {
    const rgba = ["r","g","b","a"].map(channel => Number(value?.[channel] ?? (channel === "a" ? 1 : NaN)));
    if (rgba.every(Number.isFinite)) properties.set(key, "{*}" + rgba.map(n => Math.round(255*Math.min(1,Math.max(0,n))).toString(16).padStart(2,"0")).join(""));
  }
  const renderType = material.stringTagMap?.RenderType;
  const shader = Number(properties.get("_AlphaClip")) === 1 ? "Cutout" : Number(properties.get("_Surface")) === 1 ? "Transparent" : renderType || "Standard";
  const doc = parse(["[Shader]", "Path="+shader, "[Properties]", ...[...properties].map(([k,v])=>k+"="+v)].join("\n"));
  const maps = entries(saved.m_TexEnvs).flatMap(([name,slot]) => {
    const ref = (slot as {m_Texture?: {guid?:string; fileID?:string}})?.m_Texture;
    if (typeof ref?.guid !== "string" || !ref.guid || ref.fileID === "0") return [];
    return [{name,guid:ref.guid.toLowerCase()}];
  });
  return {doc,maps};
}

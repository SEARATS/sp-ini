import { CompletionItemKind, Range, type CompletionItem } from "vscode-languageserver/node";
import type { IniEntry } from "./ini";

export class MaterialFolders {
  private children = new Map<string,Map<string,{path:string; source:string; rank:number}>>();

  add(relative: string, source: string, rank: number) {
    const parts = relative.replaceAll("\\","/").replace(/^\.\//,"").replace(/\/$/,"").split("/");
    if (parts.some(s=>!s || s === "." || s === ".." || /[:#;{}]/.test(s))) return;
    let parent = "";
    for (const part of parts) {
      const key = part.toLowerCase(), full = parent+part+"/";
      let siblings = this.children.get(parent.toLowerCase());
      if (!siblings) {
        siblings = new Map();
        this.children.set(parent.toLowerCase(),siblings);
      }
      const existing = siblings.get(key);
      if (!existing || rank < existing.rank) siblings.set(key,{path:full,source,rank});
      parent = full;
    }
  }

  complete({value,valueStart,line}: IniEntry, character: number): CompletionItem[] {
    const offset = character-valueStart;
    if (offset < 0 || offset > value.length) return [];
    const prefix = value.slice(0,offset).replaceAll("\\","/").toLowerCase();
    const parent = prefix.slice(0,prefix.lastIndexOf("/")+1);
    const siblings = this.children.get(parent);
    if (!siblings) return [];
    const nextSlash = value.slice(offset).search(/[/\\]/);
    const end = nextSlash < 0 ? valueStart+value.length : character+nextSlash+1;
    const range = Range.create(line,valueStart,line,end);
    return [...siblings.values()].filter(f=>f.path.toLowerCase().startsWith(prefix)).map(f=>({
      label:f.path, kind:CompletionItemKind.Folder, detail:f.source,
      sortText:String(f.rank).padStart(4,"0")+f.path.toLowerCase(),
      textEdit:{range,newText:f.path}
    }));
  }
}

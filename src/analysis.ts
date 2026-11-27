import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { buildCatalog, excluded } from "./catalog";
import { diagnostics } from "./features";
import { parse } from "./ini";
import { roots, type SearchOptions } from "./roots";
import type { Diagnostic } from "vscode-languageserver";

async function* iniFiles(directory: string): AsyncGenerator<string> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((a,b) => a.name.localeCompare(b.name))) {
    const file = path.join(directory, entry.name);
    if (entry.isFile() && /\.ini$/i.test(entry.name)) yield file;
    else if (entry.isDirectory() && !entry.name.startsWith(".") && !excluded.has(entry.name)) yield* iniFiles(file);
  }
}

export async function analyze(args: string[], settings: SearchOptions, report: (file: string, issues: Diagnostic[]) => void,
  cancelled = () => false) {
  const vanilla = args.length === 1 && args[0] === "--vanilla";
  if (!vanilla && (!args.length || args.some(a => a.startsWith("--"))))
    throw Error("Usage: pnpm run analyze --vanilla | <project-directory> [...]");
  let directories = vanilla ? [] : args.map(d => path.resolve(d));
  const search = vanilla ? { ...settings, search: { game:true, installedMods:false, workshop:false, userMods:false, localMods:false } } : settings;
  const content = await roots(search, directories.map(d => ({uri:pathToFileURL(d).href})));
  if (vanilla) directories = content.filter(r => r.source === "Vanilla").map(r => r.dir);
  if (!directories.length) throw Error("Cannot find the vanilla original directory. Set seapowerIni.gameDirectory in VS Code or SEA_POWER_DIR in the terminal.");
  const catalog = await buildCatalog(content);
  const seen = new Set<string>(), totals = [0,0,0,0,0];
  let skipped = 0;
  for (const directory of directories) {
    for await (const file of iniFiles(directory)) {
      if (cancelled()) throw Error("Analysis cancelled.");
      if (seen.has(file)) continue;
      seen.add(file);
      let text: string;
      try { text = await fs.readFile(file, "utf8"); }
      catch (error) {
        skipped++;
        report(file,[{ range:{start:{line:0,character:0},end:{line:0,character:0}}, severity:1, code:"read-file", source:"Sea Power INI", message:error.message }]);
        continue;
      }
      const issues = diagnostics(parse(text),catalog,pathToFileURL(file).href);
      for (const issue of issues) totals[issue.severity]++;
      if (issues.length) report(file, issues);
    }
  }
  return { exitCode:skipped ? 2 : totals[1] ? 1 : 0,
    summary:`Analyzed ${seen.size-skipped} INIs: ${totals[1]} errors, ${totals[2]} warnings, ${totals[3]} informational, ${totals[4]} hints. Skipped ${skipped} unreadable files.` };
}

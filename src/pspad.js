const fs = require("node:fs/promises");
const path = require("node:path");
const { fileURLToPath, pathToFileURL } = require("node:url");
const { roots } = require("./roots");
const { buildCatalog } = require("./catalog");
const { parse } = require("./ini");
const { diagnostics, exact, inspect } = require("./features");
const { tokens, isMesh, meshColliderSections } = require("./references");
const { MeshFiles } = require("./meshes");

async function modDirectory(file) {
  const parent = path.dirname(file);
  for (let dir = parent; dir !== path.dirname(dir); dir = path.dirname(dir)) {
    if ((await fs.stat(path.join(dir, "_info.ini")).catch(() => null))?.isFile()) return dir;
  }
  return parent;
}

async function main(args) {
  const [input, lineText, workspace] = args;
  if (!input || args.length > 3 || (lineText !== undefined && !/^[1-9]\d*$/.test(lineText)))
    throw Error("Usage: node pspad.js <file.ini> [line-number [mod-folder]]");
  const file = path.resolve(input), uri = pathToFileURL(file).href;
  const doc = parse(await fs.readFile(file, "utf8"));
  const dir = workspace ? path.resolve(workspace) : await modDirectory(file);
  const catalog = await buildCatalog(await roots({}, [{ uri: pathToFileURL(dir).href }]));
  const line = Number(lineText) - 1;
  const entry = doc.entries.find(k => k.line === line);
  const directive = doc.modifiers.find(m => m.line === line);
  const items = entry ? tokens(entry.value, entry.valueStart) : directive ? tokens(directive.args, directive.argsStart) : [];
  const emit = (name, row, col, message) => console.log(name + "|" + (row + 1) + "|" + (col + 1) + "| " + message);
  for (const token of items) {
    const refs = entry && isMesh(entry, meshColliderSections(doc)) ? await new MeshFiles().resolve(doc, uri, entry, catalog) :
      exact(inspect(doc, uri, { line, character: token.start }, catalog));
    for (const ref of refs) {
      if (ref.file) emit(fileURLToPath(ref.file.uri), ref.line, ref.start, "Definition of " + token.name);
    }
  }
  const issues = diagnostics(doc, catalog, uri);
  const labels = ["", "Error", "Warning", "Information", "Hint"];
  for (const issue of issues) emit(file, issue.range.start.line, issue.range.start.character, labels[issue.severity] + ": " + issue.message);
  console.log(issues.length + " diagnostics.");
  return issues.some(issue => issue.severity === 1) ? 1 : 0;
}
main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
  console.error(error.message);
  process.exitCode = 2;
});

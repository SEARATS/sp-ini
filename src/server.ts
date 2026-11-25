import { createConnection, TextDocuments, TextDocumentSyncKind } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import * as path from "node:path";
import { StockAssets, stockHover } from "./stock-assets";
import { roots } from "./roots";
import { Catalog, buildCatalog, uriKey } from "./catalog";
import { MeshFiles, objectHeader } from "./meshes";
import { isMesh, meshColliderSections, referenceContext } from "./references";
import { meshHover } from "./mesh-hover";
import { isColliderName } from "./mesh-names";
import { Materials } from "./materials";
import { colliderSection, primitiveHover } from "./colliders";
import { parse } from "./ini";
import { entityAssets } from "./entity-assets";
import { selectEntity, type PreviewRequest } from "./entity-selection";
import { iniFolds, objFolds } from "./folding";
import { completions, diagnostics, documentLinks, exact, inspect, location, source, symbols } from "./features";

const connection = createConnection();
const documents = new TextDocuments(TextDocument);
const parsed = new Map();
const openModels = new Map();
const stock = new StockAssets();
connection.onShutdown(() => stock.close());
process.on('exit', () => stock.close());
const meshes = new MeshFiles(uri => openModels.get(uriKey(uri)));
const materials = new Materials(uri => {
  for (const [key, doc] of parsed) if (uriKey(key) === uriKey(uri)) return doc;
});
let catalog = new Catalog(), options, folders;
let building, requested = 0;

function publish(uri) {
  if (parsed.has(uri)) connection.sendDiagnostics({ uri, version: documents.get(uri)?.version, diagnostics: diagnostics(parsed.get(uri), catalog, uri) });
}

function refresh() {
  requested++;
  if (!building) building = (async () => {
    let summary;
    do {
      const revision = requested;
      const content = await roots(options, folders);
      const next = await buildCatalog(content);
      const vanilla = content.find(r => r.source === "Vanilla");
      stock.directory = vanilla && path.resolve(vanilla.dir, "../..");
      if (revision !== requested) continue;
      catalog = next;
      parsed.forEach((_, uri) => publish(uri));
      const total = [...next.counts.values()].reduce((sum, count) => sum + count, 0);
      summary = "Indexed " + total + " INIs and " + next.units.size + " unit IDs.";
      if (next.skipped) summary += " Skipped " + next.skipped + " unreadable files.";
      connection.console.info(summary);
    } while (!summary);
    return summary;
  })().finally(() => { building = undefined; });
  return building;
}

connection.onInitialize(params => {
  options = params.initializationOptions || {};
  folders = params.workspaceFolders || (params.rootUri ? [{ uri: params.rootUri }] : []);
  return { capabilities: { textDocumentSync: TextDocumentSyncKind.Incremental,
    completionProvider: { triggerCharacters: ["[", "=", "/", "!"] }, hoverProvider: true,
    definitionProvider: true, documentLinkProvider: {}, documentSymbolProvider: true, foldingRangeProvider: true } };
});
connection.onInitialized(() => refresh().catch(error => connection.console.error(String(error))));
connection.onRequest("seapower/entityPreview", async (request: PreviewRequest, token) => {
  await building;
  const {sourceText,sourceUri,paint,...choices} = await selectEntity(request,catalog,materials);
  if (!request.render) return choices;
  if (!sourceText) throw Error("Missing model definition for "+choices.entities.find(e=>e.id === choices.entity)?.label);
  return entityAssets(sourceText,sourceUri,catalog,meshes,materials,stock,paint,()=>token.isCancellationRequested);
});
connection.onRequest("seapower/rebuild", params => {
  if (params) { options = params.options; folders = params.folders; }
  return refresh();
});
documents.onDidChangeContent(({ document }) => {
  if (document.languageId === "wavefront-obj") {
    openModels.set(uriKey(document.uri), document);
    return;
  }
  parsed.set(document.uri, parse(document.getText()));
  publish(document.uri);
});
documents.onDidClose(({ document }) => {
  if (document.languageId === "wavefront-obj") {
    const key = uriKey(document.uri);
    if (openModels.get(key) === document) openModels.delete(key);
    return;
  }
  parsed.delete(document.uri);
  connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
});

async function context(params) {
  await building;
  const uri = params.textDocument.uri;
  const doc = parsed.get(uri);
  return doc && inspect(doc, uri, params.position, catalog);
}
async function meshAt(params) {
  const uri = params.textDocument.uri;
  const doc = parsed.get(uri);
  const { line, character } = params.position;
  const entry = doc?.entries.find(e => e.line === line);
  if (!entry || /\.(obj|fbx)$/i.test(entry.value) || character < entry.valueStart || character > entry.valueStart + entry.value.length || !isMesh(entry, meshColliderSections(doc))) return;
  await building;
  return meshes.resolve(doc, uri, entry, catalog);
}
connection.onCompletion(async p => {
  const info = await context(p), uri = p.textDocument.uri, doc = parsed.get(uri);
  const entry = doc?.entries.find(e => e.line === p.position.line);
  if (entry && isMesh(entry, meshColliderSections(doc)) && p.position.character >= entry.valueStart &&
      p.position.character <= entry.valueStart + entry.value.length) {
    const refs = await meshes.resolve(doc, uri, entry, catalog, undefined, undefined, true);
    const items = refs.map(r => ({ ...r, sortText: (isColliderName(r.name) ? "0" : "1") + r.name.toLowerCase() }))
      .sort((a,b) => a.sortText.localeCompare(b.sortText));
    return completions({ raw: doc.lines[entry.line], start: entry.valueStart, end: entry.valueStart + entry.value.length,
      kind: 18, suffix: "", items }, p.position);
  }
  return completions(info, p.position);
});
connection.onDefinition(async p => (await meshAt(p) ?? exact(await context(p))).filter(ref => ref.file).map(location));
connection.onFoldingRanges(p => {
  const obj = openModels.get(uriKey(p.textDocument.uri));
  if (!obj) return iniFolds(parsed.get(p.textDocument.uri)?.lines || []);
  const lines = obj.getText().split(/\r\n|\r|\n/);
  return objFolds({ lineCount: lines.length, lineAt: i => ({ text: lines[i] }) });
});
connection.onDocumentLinks(async p => {
  await building;
  const uri = p.textDocument.uri, doc = parsed.get(uri);
  if (!doc) return [];
  const links = documentLinks(doc, uri, catalog);
  const ctx = referenceContext(doc, uri, catalog), models = new Map();
  for (const entry of doc.entries.filter(e => isMesh(e, ctx.meshColliders))) {
    const refs = await meshes.resolve(doc, uri, entry, catalog, ctx, models);
    if (refs.length !== 1) continue;
    const ref = refs[0];
    links.push({ range: { start: { line: entry.line, character: entry.valueStart },
      end: { line: entry.line, character: entry.valueStart + entry.value.length } },
      target: /\.fbx$/i.test(ref.file.rel) ? ref.file.uri : ref.file.uri + "#L" + (ref.line + 1) + "," + (ref.start + 1), tooltip: "Open mesh " + ref.name });
  }
  return links;
});
async function objectHover(file, model, object, doc?, uri?, entry?) {
  if (options.imagePreviews === false) return { contents: { kind: "plaintext" as const, value: object.name + " � " + object.faces.length + " faces" } };
  let material;
  function assigned(document, id, mesh) {
    const key = /^resourcesmesh$/i.test(mesh.name) ? "resourcesmaterial" : "material";
    const field = mesh.section?.keys.find(e => e.name.toLowerCase() === key);
    return materials.materialFile(field, document, id, catalog);
  }
  if (entry) material = assigned(doc, uri, entry);
  if (!material && file) {
    const name = file.rel.split("/").pop().toLowerCase();
    for (const owner of catalog.objOwners.get(name) || []) {
      const candidate = await materials.readIni(owner);
      for (const e of candidate?.entries || []) {
        if (!/^(resourcesmesh|mesh)$/i.test(e.name) || e.value !== object.name) continue;
        const refs = await meshes.resolve(candidate, owner.uri, e, catalog);
        if (refs.some(r => uriKey(r.file.uri) === uriKey(file.uri))) material = assigned(candidate, owner.uri, e);
        if (material) break;
      }
      if (material) break;
    }
  }
  const textures = new Map();
  if (!material) return meshHover(model, object, await materials.objTextures(file, model, object, catalog));
  const diffuse = await materials.diffuse(material, catalog);
  if (diffuse) textures.set("", diffuse);
  return meshHover(model, object, textures);
}

connection.onHover(async p => {
  const uri = p.textDocument.uri;
  const obj = openModels.get(uriKey(uri));
  if (obj) {
    const { line, character } = p.position;
    const raw = obj.getText({ start: { line, character: 0 }, end: { line: line + 1, character: 0 } }).trimEnd();
    const header = objectHeader.exec(raw);
    if (!header || character > raw.split("#", 1)[0].trimEnd().length) return null;
    const model = await meshes.model({ uri });
    const object = model?.objects.find(o => o.line === line);
    if (!object) return null;
    await building;
    return objectHover(catalog.filesByUri.get(uriKey(uri)), model, object);
  }
  const refsToMesh = await meshAt(p);
  const doc = parsed.get(uri), entry = doc?.entries.find(e => e.line === p.position.line);
  if (refsToMesh) {
    const ref = refsToMesh[0];
    return ref ? objectHover(ref.file, ref.model, ref.object, doc, uri, entry) :
      await stockHover(stock,materials,doc,uri,entry,catalog,options.imagePreviews !== false,true) ??
      { contents: { kind: "plaintext" as const, value: "No OBJ object declaration was found for " + entry.value + "." } };
  }
  const collider = doc && colliderSection(doc, p.position, entry);
  if (collider) {
    const shape = primitiveHover(collider, options.imagePreviews !== false);
    if (shape) return shape;
    const field = collider.keys.find(k => /^collider$/i.test(k.name));
    await building;
    const [ref] = await meshes.resolve(doc, uri, field, catalog);
    if (ref) return objectHover(ref.file, ref.model, ref.object, doc, uri, field);
    if (field) return await stockHover(stock,materials,doc,uri,field,catalog,options.imagePreviews !== false,true) ?? { contents: { kind: "plaintext" as const, value: "No OBJ geometry was found for collider " + field.value + "." } };
  }
  if (entry && p.position.character >= entry.valueStart && p.position.character <= entry.valueStart + entry.value.length) {
    await building;
    const file = materials.materialFile(entry, doc, uri, catalog);
    if (file) return materials.hover(file, catalog, options.imagePreviews !== false);
    const packed = await stockHover(stock,materials,doc,uri,entry,catalog,options.imagePreviews !== false);
    if (packed) return packed;
  }
  const refs = exact(await context(p));
  if (!refs.length) return null;
  const first = refs[0];
  const lines = [first.name + (first.example ? "=" + first.example : ""), ...refs.map(ref => ref.detail || source(ref))];
  return { contents: { kind: "plaintext" as const, value: lines.join("\n") } };
});
connection.onDocumentSymbol(p => {
  const doc = parsed.get(p.textDocument.uri);
  return doc ? symbols(doc) : [];
});
documents.listen(connection);
connection.listen();

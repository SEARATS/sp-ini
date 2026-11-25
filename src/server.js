const { createConnection, TextDocuments, TextDocumentSyncKind } = require("vscode-languageserver/node");
const { TextDocument } = require("vscode-languageserver-textdocument");
const { roots } = require("./roots");
const { Catalog, buildCatalog } = require("./catalog");
const { parse } = require("./ini");
const { iniFolds } = require("./folding");
const { completions, diagnostics, documentLinks, exact, inspect, location, source, symbols } = require("./features");

const connection = createConnection();
const documents = new TextDocuments(TextDocument);
const parsed = new Map();
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
      const next = await buildCatalog(await roots(options, folders));
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
connection.onRequest("seapower/rebuild", params => {
  if (params) { options = params.options; folders = params.folders; }
  return refresh();
});
documents.onDidChangeContent(({ document }) => {
  parsed.set(document.uri, parse(document.getText()));
  publish(document.uri);
});
documents.onDidClose(({ document }) => {
  parsed.delete(document.uri);
  connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
});

async function context(params) {
  await building;
  const uri = params.textDocument.uri;
  const doc = parsed.get(uri);
  return doc && inspect(doc, uri, params.position, catalog);
}
connection.onCompletion(async p => completions(await context(p), p.position));
connection.onDefinition(async p => exact(await context(p)).filter(ref => ref.file).map(location));
connection.onFoldingRanges(p => iniFolds(parsed.get(p.textDocument.uri)?.lines || []));
connection.onDocumentLinks(async p => {
  await building;
  const uri = p.textDocument.uri, doc = parsed.get(uri);
  return doc ? documentLinks(doc, uri, catalog) : [];
});
connection.onHover(async p => {
  const refs = exact(await context(p));
  if (!refs.length) return null;
  const first = refs[0];
  const lines = [first.name + (first.example ? "=" + first.example : ""), ...refs.map(ref => ref.detail || source(ref))];
  return { contents: { kind: "plaintext", value: lines.join("\n") } };
});
connection.onDocumentSymbol(p => {
  const doc = parsed.get(p.textDocument.uri);
  return doc ? symbols(doc) : [];
});
documents.listen(connection);
connection.listen();

import { build } from "esbuild";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { watch } from "node:fs";
import { buildFbx } from "./build-fbx";
import { generateIcon } from "./icon";
const root = path.resolve(__dirname, "..");
process.chdir(root);

async function compile() {
  await Promise.all([
    generateIcon(),
    buildFbx(),
    build({ entryPoints: ["src/extension.ts", "src/server.ts", "src/pspad.ts", "src/generate.ts", "src/lint.ts"], outdir: "dist",
      bundle: true, platform: "node", target: "node18", external: ["vscode"] }),
    build({ entryPoints: ["test/preview-smoke.ts", "test/stock-smoke.ts", "test/vscode-smoke.ts", "scripts/gallery/capture.ts"],
      outdir: "dist/dev", entryNames: "[name]", bundle: true, platform: "node", target: "node18", external: ["vscode"] }),
    build({ entryPoints: ["src/obj-viewer.ts","src/unit-card-viewer.ts"], outdir: "dist", bundle: true, minify: true, target: "chrome114" })
  ]);
  const licenses = [];
  for (const name of ["diff","three","yaml"]) {
    const root = path.join("node_modules", name);
    const file = (await fs.readdir(root)).find(f => /^licen[sc]e(?:$|[.-])/i.test(f));
    if (file) licenses.push(name+"\n"+await fs.readFile(path.join(root,file),"utf8"));
  }
  await fs.writeFile("dist/third-party-licenses.txt",licenses.join("\n\n"));
  await fs.copyFile("node_modules/three/LICENSE", "dist/three-LICENSE.txt");
  await fs.copyFile("node_modules/pngjs/LICENSE", "dist/pngjs-LICENSE.txt");
  await fs.copyFile("node_modules/jpeg-js/LICENSE", "dist/jpeg-js-LICENSE.txt");
}

async function main() {
  if (!process.argv.includes("--watch")) return compile();
  let timer, running = false, pending = false;
  async function rebuild() {
    pending = true;
    if (running) return;
    running = true;
    do {
      pending = false;
      try {
        await compile();
        await fs.writeFile("dist/.dev-build", String(Date.now()));
      } catch (error) { console.error(error.message); }
    } while (pending);
    running = false;
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(rebuild, 180); }
  watch("src", { recursive: true }, schedule);
  watch(".", (_, file) => {
    if (["language.json", "syntax.json", "package.json", "pnpm-lock.yaml"].includes(file)) schedule();
  });
  await rebuild();
}
main().catch(error => { console.error(error); process.exitCode = 1; });

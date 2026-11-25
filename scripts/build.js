const { build } = require("esbuild");
const fs = require("node:fs/promises");
const path = require("node:path");
const { watch } = require("node:fs");
const root = path.resolve(__dirname, "..");
process.chdir(root);

async function compile() {
  await Promise.all([
    build({ entryPoints: ["src/extension.js", "src/server.js", "src/pspad.js"], outdir: "dist",
      bundle: true, platform: "node", target: "node18", external: ["vscode"] }),
    build({ entryPoints: ["src/obj-viewer.js"], outdir: "dist", bundle: true, minify: true, target: "chrome114" })
  ]);
  await fs.copyFile("node_modules/three/LICENSE", "dist/three-LICENSE.txt");
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

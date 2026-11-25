const path = require("node:path");
const fs = require("node:fs/promises");
const { roots } = require("./roots");

async function referencePatterns(options) {
  const patterns = {};
  for (const { dir, source } of await roots(options)) {
    if (source !== "Vanilla" && !source.startsWith("Workshop ")) continue;
    const workshop = source.startsWith("Workshop ");
    const base = workshop ? path.dirname(dir) : dir;
    if (!workshop && !(await fs.stat(base).catch(() => null))?.isDirectory()) continue;
    const literal = base.split(path.sep).join("/").replace(/[[\]*?{}]/g, ch => "[" + ch + "]");
    patterns[literal + (workshop ? "/*" : "") + "/**/*.[iI][nN][iI]"] = true;
  }
  return patterns;
}

module.exports = { referencePatterns };

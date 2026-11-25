const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { fileURLToPath } = require("node:url");

async function children(dir) {
  try { return await fs.readdir(dir, { withFileTypes: true }); }
  catch (error) {
    if (["ENOENT", "ENOTDIR", "EACCES", "EPERM", "EBUSY"].includes(error.code)) return [];
    throw error;
  }
}

async function roots(options = {}, folders = []) {
  const result = [];
  const add = (dir, source) => {
    if (dir && path.isAbsolute(dir)) result.push({ dir: path.resolve(dir), source });
  };
  const addChildren = async (dir, label, accept = () => true) => {
    for (const item of await children(dir)) {
      if (item.isDirectory() && accept(item.name)) add(path.join(dir, item.name), label + " " + item.name);
    }
  };
  for (const folder of folders) {
    if (folder.uri.startsWith("file:")) add(fileURLToPath(folder.uri), "Workspace");
  }
  for (const dir of options.localModDirectories || []) add(dir, "Local " + path.basename(dir));

  const steam = [process.env.STEAM_DIR, process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Steam"),
    path.join(os.homedir(), ".steam/steam"), path.join(os.homedir(), ".local/share/Steam"),
    path.join(os.homedir(), "Library/Application Support/Steam")].filter(Boolean);
  const libraries = new Set(steam);
  for (const dir of steam) {
    const vdf = await fs.readFile(path.join(dir, "steamapps/libraryfolders.vdf"), "utf8").catch(() => "");
    for (const match of vdf.matchAll(/"path"\s*"([^"]+)"/gi)) libraries.add(match[1].replaceAll("\\\\", "\\"));
  }
  const explicit = options.gameDirectory || process.env.SEA_POWER_DIR;
  const games = explicit ? [explicit] : [...libraries].map(dir => path.join(dir, "steamapps/common/Sea Power"));
  const vanilla = [];
  const workshops = new Set(options.workshopDirectories || []);
  for (const game of games) {
    const assets = path.join(game, "Sea Power_Data/StreamingAssets");
    await addChildren(assets, "Local", name => name.toLowerCase() !== "original");
    vanilla.push(path.join(assets, "original"));
    workshops.add(path.resolve(game, "../../workshop/content/1286220"));
  }
  if (process.env.USERPROFILE) await addChildren(path.join(process.env.USERPROFILE, "AppData/LocalLow/Triassic Games/Sea Power/Mods"), "Local");
  for (const lib of libraries) workshops.add(path.join(lib, "steamapps/workshop/content/1286220"));
  for (const dir of workshops) await addChildren(dir, "Workshop", name => /^\d+$/.test(name));
  vanilla.forEach(dir => add(dir, "Vanilla"));
  return result;
}

module.exports = { children, roots };

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

const defaultOrder = ["projectRoot","data","resources","mirror","localMods","installedMods","userMods","workshop","game"] as const;
type SourceId = typeof defaultOrder[number];
type SearchSources = Partial<Record<SourceId,boolean>> & {order?: string[]};
export function orderedSources(order?: string[]): SourceId[] {
  const known: readonly string[] = defaultOrder;
  const overrides = Array.isArray(order) ? order.filter((id): id is SourceId=>known.includes(id)) : [];
  return [...new Set([...overrides,...defaultOrder])];
}
export interface SearchOptions {
  search?: SearchSources;
  searchPaths?: {directory?: string; resourcesSubdirectory?: string; dataSubdirectory?: string};
  localModDirectories?: string[];
  workshopDirectories?: string[];
  gameDirectory?: string;
}
export interface ContentRoot {
  dir: string;
  source: string;
  omit?: string[];
  origin?: SourceId;
}

async function children(dir) {
  try { return await fs.readdir(dir, { withFileTypes: true }); }
  catch (error) {
    if (["ENOENT", "ENOTDIR", "EACCES", "EPERM", "EBUSY"].includes(error.code)) return [];
    throw error;
  }
}

async function roots(options: SearchOptions = {}, folders: {uri:string}[] = []) {
  const search = options.search || {}, result: ContentRoot[] = [];
  const workspaces = folders.filter(f => f.uri.startsWith("file:")).map(f => fileURLToPath(f.uri));
  const resolvePaths = (parents: string[], setting: string) => path.isAbsolute(setting)
    ? [path.resolve(setting)] : parents.map(dir => path.resolve(dir,setting));
  const settings = options.searchPaths || {};
  const parents = resolvePaths(workspaces,settings.directory?.trim() || "Assets");
  const resources = new Set(resolvePaths(parents,settings.resourcesSubdirectory?.trim() || "Resources"));
  const data = new Set(resolvePaths(parents,settings.dataSubdirectory?.trim() || "StreamingAssets"));
  const projectPaths = [...new Set([...resources,...data,...resolvePaths(workspaces,"Assets/Resources"),...resolvePaths(workspaces,"Assets/StreamingAssets")])];
  const order = orderedSources(search.order);
  const sorted = () => result.sort((a,b)=>order.indexOf(a.origin)-order.indexOf(b.origin));
  const add = (dir: string, source: string, origin: SourceId) => {
    if (dir && path.isAbsolute(dir)) result.push({dir:path.resolve(dir), source,origin});
  };
  const addChildren = async (dir, label, origin: SourceId, accept: (name:string) => boolean = () => true) => {
    for (const item of await children(dir)) {
      if (item.isDirectory() && accept(item.name)) add(path.join(dir, item.name), label + " " + item.name, origin);
    }
  };
  for (const dir of workspaces) {
    if (search.projectRoot !== false) result.push({dir,source:"Workspace",origin:"projectRoot",omit:projectPaths});
    if (search.mirror !== false) result.push({dir,source:"Unity mirror",origin:"mirror",omit:projectPaths});
  }
  if (search.data !== false) for (const dir of data) add(dir,"Data","data");
  if (search.resources !== false) for (const dir of resources) add(dir,"Resources","resources");
  if (search.localMods !== false) for (const dir of options.localModDirectories || []) add(dir, "Local " + path.basename(dir),"localMods");
  const addUserMods = async () => {
    if (search.userMods !== false && process.env.USERPROFILE)
      await addChildren(path.join(process.env.USERPROFILE, "AppData/LocalLow/Triassic Games/Sea Power/Mods"), "User mod","userMods");
  };
  if (search.game === false && search.workshop === false && search.installedMods === false) {
    await addUserMods();
    return sorted();
  }

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
    if (search.installedMods !== false) await addChildren(assets, "Installed mod","installedMods", name => name.toLowerCase() !== "original");
    const original = path.join(assets,"original");
    if (search.game !== false && (await fs.stat(original).catch(()=>undefined))?.isDirectory()) vanilla.push(original);
    workshops.add(path.resolve(game, "../../workshop/content/1286220"));
  }
  await addUserMods();
  if (search.workshop !== false) {
    for (const lib of libraries) workshops.add(path.join(lib, "steamapps/workshop/content/1286220"));
    for (const dir of workshops) await addChildren(dir, "Workshop","workshop", name => /^\d+$/.test(name));
  }
  vanilla.forEach(dir => add(dir, "Vanilla","game"));
  return sorted();
}

export { children, roots };

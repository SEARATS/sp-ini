import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, mkdtemp, readdir, rename, rm, rmdir } from "node:fs/promises";
import { basename, delimiter, dirname, extname, isAbsolute, join } from "node:path";

export const blendScales = {fbx: 1.45329, obj: 0.68810} as const;
export type ExportFormat = keyof typeof blendScales;

export async function findBlender(configured?: string) {
  const windows = process.platform === "win32";
  const executable = windows ? "blender.exe" : "blender";
  const candidates = (process.env.PATH ?? "").split(delimiter).filter(isAbsolute).map(dir => join(dir, executable));
  if (windows && process.env.ProgramFiles) {
    const root = join(process.env.ProgramFiles, "Blender Foundation");
    const versions = await readdir(root).catch(() => [] as string[]);
    versions.sort((a,b) => b.localeCompare(a, undefined, {numeric:true}));
    candidates.push(...versions.filter(v => /^Blender \d/i.test(v)).map(v => join(root, v, executable)));
  }
  if (process.platform === "darwin") candidates.push("/Applications/Blender.app/Contents/MacOS/Blender");
  for (const file of configured ? [configured] : candidates) {
    if (isAbsolute(file) && await access(file, constants.X_OK).then(() => true, () => false)) return file;
  }
  throw Error("Blender executable not found. Set Sea Power INI: Blender Path to the full path to Blender.");
}

export function outputStat(file: string) {
  return lstat(file).catch(error => {
    if (error.code !== "ENOENT") throw error;
    return undefined;
  });
}

export function materialPath(obj: string) { return obj.slice(0, -extname(obj).length) + ".mtl"; }

function runBlender(blender: string, source: string, target: string, format: ExportFormat) {
  // Blender's exit code alone does not distinguish a cancelled operator or a failed file load.
  const script = [
    "import bpy, os, sys",
    "source, target = sys.argv[sys.argv.index('--') + 1:]",
    "if not bpy.data.filepath or not os.path.samefile(bpy.data.filepath, source): raise RuntimeError('Could not open the selected .blend file')",
    `result = bpy.ops.${format === "fbx" ? "export_scene.fbx" : "wm.obj_export"}(filepath=target, global_scale=${blendScales[format]}, check_existing=False, path_mode='RELATIVE')`,
    "if 'FINISHED' not in result: raise RuntimeError('Blender cancelled the export')"
  ].join("\n");
  return new Promise<void>((resolve, reject) => {
    const child = spawn(blender, ["--background", "--factory-startup", "--disable-autoexec", source,
      "--python-exit-code", "1", "--python-expr", script, "--", source, target], {windowsHide:true, stdio:["ignore","pipe","pipe"]});
    let log = "";
    const capture = (chunk: Buffer) => { log = (log + chunk.toString()).slice(-4096); };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(Error(log.trim() || "Blender exited before exporting the model.")));
  });
}

const active = new Set<string>();
export async function exportBlend(blender: string, source: string, target: string, format: ExportFormat) {
  if (extname(source).toLowerCase() !== ".blend" || extname(target).toLowerCase() !== "." + format)
    throw Error("Choose a .blend source and a ." + format + " destination.");
  const key = process.platform === "win32" ? target.toLowerCase() : target;
  if (active.has(key)) throw Error("An export to this file is already running.");
  active.add(key);
  // Export in the destination directory so Blender writes correct relative texture paths.
  const outputs = format === "obj" ? [target, materialPath(target)] : [target];
  let backup: string;
  const originals = new Map<string,string>();
  let started = false, cleanBackup = false;
  try {
    for (const file of outputs) {
      const stat = await outputStat(file);
      if (!stat) continue;
      if (!stat.isFile()) throw Error("Expected a regular output file: " + file);
      backup ??= await mkdtemp(join(dirname(target), ".sp-ini-export-"));
      const saved = join(backup, basename(file));
      await rename(file, saved);
      originals.set(file, saved);
    }
    started = true;
    await runBlender(blender, source, target, format);
    if (!(await lstat(target)).size) throw Error("Blender produced an empty file.");
    for (const [file, saved] of originals) {
      // Some scenes produce no MTL. Preserve any existing sidecar in that case.
      const written = await outputStat(file);
      if (!written) { await rename(saved, file); originals.delete(file); }
    }
    cleanBackup = true;
  } catch (error) {
    if (started) for (const file of outputs) await rm(file, {force:true});
    for (const [file, saved] of originals) await rename(saved, file);
    cleanBackup = true;
    throw error;
  } finally {
    active.delete(key);
    if (backup && cleanBackup) {
      for (const saved of originals.values()) await rm(saved, {force:true});
      await rmdir(backup);
    }
  }
}

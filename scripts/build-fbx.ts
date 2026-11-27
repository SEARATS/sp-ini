import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

export const ufbxRevision = "5955c5c0b042ac2dc6f32955ab206aaec0620cfc";
const sources = {
  "ufbx.c": "4a956c26a708e40d82ecb0aeaee54da709d5ba7c144c9642174970059bda7e1d",
  "ufbx.h": "f787be529af577efc04f3e3e735844a08556718dbb613d1211c2b313d72895dc",
  LICENSE: "0dd48ebadf52273c736256325c8f078c03c8bb4facee22a4122de0ad3f615391"
};
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export async function buildFbx() {
  const cache = resolve("node_modules/.cache/ufbx"), bridge = resolve("reader/fbx.c");
  mkdirSync(cache, {recursive:true});
  mkdirSync("dist", {recursive:true});
  const stamp = join(cache, "build-key");
  const key = [ufbxRevision, hash(readFileSync(bridge)), hash(readFileSync(__filename))].join("/");
  if (existsSync(stamp) && readFileSync(stamp,"utf8") === key &&
      existsSync("dist/fbx-reader.wasm") && existsSync("dist/fbx-LICENSE.txt")) return;

  await Promise.all(Object.entries(sources).map(async ([name, digest]) => {
    const file = join(cache, name);
    if (existsSync(file) && hash(readFileSync(file)) === digest) return;
    const response = await fetch(`https://raw.githubusercontent.com/ufbx/ufbx/${ufbxRevision}/${name}`);
    if (!response.ok) throw Error(`Fetching ${name}: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (hash(bytes) !== digest) throw Error("Unexpected digest for " + name);
    writeFileSync(file, bytes);
  }));
  const toolchain = join(cache, "toolchain");
  const zig = process.env.SP_INI_ZIG || join(toolchain, "ziglang", process.platform === "win32" ? "zig.exe" : "zig");
  if (!existsSync(zig) && !process.env.SP_INI_ZIG)
    execFileSync(process.platform === "win32" ? "python" : "python3",
      ["-m","pip","install","--target",toolchain,"ziglang==0.13.0"], {stdio:"inherit"});
  if (execFileSync(zig, ["version"], {encoding:"utf8"}).trim() !== "0.13.0") throw Error("FBX build requires Zig 0.13.0.");
  execFileSync(zig, ["cc","-target","wasm32-wasi","-mexec-model=reactor","-O2","-g0","-DNDEBUG","-DUFBX_NO_STDIO",
    "-I",cache,join(cache,"ufbx.c"),bridge,"-Wl,--export=malloc","-Wl,--export=free","-Wl,--export=decode",
    "-Wl,-z,stack-size=1048576","-o",resolve("dist/fbx-reader.wasm")], {stdio:"inherit"});
  const lib = JSON.parse(execFileSync(zig, ["env"], {encoding:"utf8"})).lib_dir;
  const libc = join(lib, "libc/wasi");
  const notices = [join(cache,"LICENSE"), ...["LICENSE","LICENSE-APACHE","LICENSE-APACHE-LLVM","LICENSE-MIT",
    "libc-bottom-half/cloudlibc/LICENSE","libc-top-half/musl/COPYRIGHT"].map(file=>join(libc,file))];
  writeFileSync("dist/fbx-LICENSE.txt", notices.map(file=>readFileSync(file,"utf8")).join("\n\n"));
  writeFileSync(stamp, key);
}
if (require.main === module) buildFbx().catch(error => { console.error(error); process.exitCode = 1; });

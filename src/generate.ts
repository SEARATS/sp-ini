import { readFileSync, writeFileSync, realpathSync, renameSync, rmSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { changes, generate, hierarchy, selectParent, snippet } from "./hierarchy";
import { readMeshTags } from "./mesh-sidecar";
try {
  const { values } = parseArgs({ options: { model:{type:"string"}, parent:{type:"string"}, ini:{type:"string"},
    clipboard:{type:"boolean"}, stdout:{type:"boolean"}, roles:{type:"string"}, "dry-run":{type:"boolean"} } });
  if (!values.model || !values.parent || [values.ini,values.clipboard,values.stdout].filter(Boolean).length!==1) throw Error("Usage: node generate.js --model file.fbx --parent name-or-path (--ini target.ini | --clipboard | --stdout) [--roles roles.json] [--dry-run]");

  const root = selectParent(hierarchy(readFileSync(values.model), readMeshTags(values.model)),values.parent);
  const roles = values.roles ? JSON.parse(readFileSync(values.roles,"utf8")) : {};
  if (values.clipboard || values.stdout) {
    const text = snippet(basename(values.model),root,roles);
    if (values.stdout || values["dry-run"]) process.stdout.write(text);
    else {
      const [cmd,...args] = process.platform==="win32" ? ["powershell.exe","-NoProfile","-STA","-Command",
        "[Console]::InputEncoding=[Text.UTF8Encoding]::new($false); Set-Clipboard -Value ([Console]::In.ReadToEnd())"] :
        process.platform==="darwin" ? ["pbcopy"] : process.env.WAYLAND_DISPLAY ? ["wl-copy"] : ["xclip","-selection","clipboard"];
      const copy = spawnSync(cmd,args,{input:text,encoding:"utf8",windowsHide:true});
      if (copy.error || copy.status!==0) throw Error(copy.error?.message || copy.stderr || "Clipboard write failed");
    }
  } else {
    const target = realpathSync(values.ini);
    const before = readFileSync(target,"utf8");
    const after = generate(before,basename(values.model),root,roles);
    if (values["dry-run"]) process.stdout.write(changes(basename(target),before,after));
    else if (before !== after) {
      const temp = target + "." + randomUUID() + ".tmp";
      try {
        writeFileSync(temp,after,{mode:statSync(target).mode,flag:"wx"});
        if (readFileSync(target,"utf8")!==before) throw Error("The INI changed during generation.");
        renameSync(temp,target);
      } finally { rmSync(temp,{force:true}); }
    }
  }
} catch (e) { console.error(String(e)); process.exitCode=1; }

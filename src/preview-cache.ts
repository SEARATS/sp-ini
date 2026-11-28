import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { deserialize, serialize } from "node:v8";

// Cache only derived assets. INI hierarchy, source resolution and diagnostics stay live.
export class PreviewCache {
  private writes = 0;
  private pruning?: Promise<void>;
  private memory = new Map<string,{value:unknown;size:number}>();
  private memorySize=0;
  constructor(readonly directory?: string, readonly budget = 256 * 1024 * 1024) {}

  private remember<T>(key:string,value:T,size:number) {
    const limit=this.budget/4;
    if (size>limit) return value;
    this.memorySize-=this.memory.get(key)?.size ?? 0;
    this.memory.delete(key);
    this.memory.set(key,{value,size});
    this.memorySize+=size;
    while (this.memorySize>limit) {
      const oldest=this.memory.keys().next().value;
      this.memorySize-=this.memory.get(oldest).size;
      this.memory.delete(oldest);
    }
    return value;
  }

  async get<T>(key: unknown[], build: () => Promise<T>): Promise<T> {
    if (!this.directory) return build();
    const name = createHash("sha256").update(JSON.stringify(key)).digest("hex");
    const hit=this.memory.get(name);
    if (hit) return this.remember(name,hit.value as T,hit.size);
    const file = join(this.directory,name);
    try {
      const bytes = await fs.readFile(file);
      return this.remember(name,deserialize(bytes) as T,bytes.length);
    } catch { /* A missing or unreadable entry is rebuilt from the asset. */ }
    const result = await build();
    if (result === undefined) return result;
    const temp = file + "." + randomUUID() + ".tmp";
    try {
      const bytes = serialize(result);
      if (bytes.length > this.budget / 4) return result;
      this.remember(name,result,bytes.length);
      await fs.mkdir(this.directory,{recursive:true});
      await fs.writeFile(temp,bytes);
      await fs.rename(temp,file);
      if (++this.writes % 16 === 1 || bytes.length > this.budget / 16) {
        this.pruning ??= this.prune().finally(()=>{this.pruning=undefined;});
        await this.pruning;
      }
    } catch { /* The preview still works with full or read-only storage. */ }
    finally { await fs.unlink(temp).catch(()=>{}); }
    return result;
  }

  private async prune() {
    const entries = (await fs.readdir(this.directory)).filter(name=>/^[0-9a-f]{64}$/.test(name));
    const files = await Promise.all(entries.map(async name=>{
      const file = join(this.directory,name);
      const stat = await fs.stat(file).catch(()=>undefined);
      return {file,size:stat?.size ?? 0,time:stat?.mtimeMs ?? 0};
    }));
    let total = 0;
    for (const item of files.sort((a,b)=>b.time-a.time)) {
      total += item.size;
      if (total > this.budget) await fs.unlink(item.file).catch(()=>{});
    }
  }
}

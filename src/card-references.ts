import {Catalog} from "./catalog";
import {readEntityDefinition} from "./entity-selection";
import {field} from "./entity-model";
import type {IniSection,IniSource,parse} from "./ini";
import type {Materials} from "./materials";

export interface CardItem {text:string; topic?:string}
export interface CardRow {label:string; topic?:string; values:CardItem[]}
type Domain="ammunition"|"sensors"|"weapons"|"aircraft"|"decoys";
interface Topic {
  title:string; domain:Domain; id:string; description?:string; source?:IniSource; appearance?:string;
  facts:{label:string;value:string}[];
}
export class CardReferences {
  readonly topics:Record<string,Topic>=Object.create(null);
  private readonly ranges=new Map<string,{label:string;nm:number;sensor:boolean;topic:string}>();
  constructor(private catalog:Catalog,private materials:Materials) {}

  item(domain:Domain,id:string,title:string,source?:IniSource,description?:string,appearance?:string):CardItem {
    if (!id) return {text:title || ""};
    const topic=[domain,id,appearance || ""].join("/").toLowerCase();
    this.topics[topic]??={title,domain,id,source,description,appearance,facts:[]};
    return {text:title,topic};
  }

  async resolve() {
    const docs=new Map<string,Promise<ReturnType<typeof parse>>>();
    await Promise.all(Object.entries(this.topics).map(async ([key,topic])=>{
      const {domain,id}=topic;
      const refs=domain==="aircraft" ? this.catalog.units.get(id.toLowerCase())?.filter(r=>r.kinds.some(k=>/^(aircraft|helicopter|vtol)$/i.test(k))) :
        this.catalog.references.get(domain)?.get(id.toLowerCase());
      const ref=this.catalog.ordered(refs || [])[0];
      if (!ref) return;
      if (!docs.has(ref.file.uri)) docs.set(ref.file.uri,readEntityDefinition(ref.file,this.catalog,this.materials));
      const doc=await docs.get(ref.file.uri);
      if (!doc) return;
      const find=(name:string)=>doc.sections.find(s=>s.name.toLowerCase()===name.toLowerCase());
      const definition=find(domain==="ammunition" || domain==="aircraft" ? "General" : id);
      if (!definition) return;
      topic.source=domain==="aircraft" ? {uri:ref.file.uri,line:ref.line,header:definition.name} :
        definition.source || {uri:ref.file.uri,line:definition.line,header:definition.name};
      const value=(name:string,section:IniSection=definition)=>field(section,name.toLowerCase())?.value;
      const fact=(label:string,v:string)=>{if(v) topic.facts.push({label,value:v});};
      fact("Type",value("Type") || value("UnitType") || value("ModuleType"));
      const addRange=(label:string,nm:number,sensor=false)=>{
        if (!Number.isFinite(nm) || nm<=0) return;
        const previous=this.ranges.get(label);
        if (!previous || previous.nm<nm || previous.nm===nm && key<previous.topic)
          this.ranges.set(label,{label,nm,sensor,topic:key});
      };
      if (domain==="ammunition") {
        const nm=Number(field(find("Guidance"),"maxlaunchrange")?.value);
        fact("Role",value("TargetType")); if (nm>0) fact("Configured reach",nm+" nm");
        const labels={aaw:"Anti-air",asuw:"Anti-surface",asw:"Anti-submarine"};
        for (const role of [value("TargetType"),value("SecondaryTargetType")]) {
          const label=labels[role?.toLowerCase()]; if (label) addRange(label,nm);
        }
      } else if (domain==="sensors") {
        const kind=value("Kind"),role=value("Role") || "";
        fact("Kind",kind); fact("Role",role);
        if (/^radar$/i.test(kind) && /^search$/i.test(value("Type"))) {
          const nm=Number(value("MaxRange"))/1.852;
          if (/air/i.test(role)) addRange("Air search",nm,true);
          if (/surface/i.test(role)) addRange("Surface search",nm,true);
          if (/land/i.test(role)) addRange("Land search",nm,true);
        } else if (/sonar/i.test(kind)) addRange("Passive sonar",Number(value("PassiveRange"))/1.852,true);
      }
    }));
    return ["Air search","Surface search","Land search","Passive sonar","Anti-air","Anti-surface","Anti-submarine"]
      .flatMap(label=>this.ranges.has(label) ? [this.ranges.get(label)] : []);
  }
}

import {posix as path} from "node:path";
import {PNG} from "pngjs";
import {Catalog, normalize} from "./catalog";
import {entityDocument, selectEntity, type PreviewRequest} from "./entity-selection";
import {field} from "./entity-model";
import {Materials} from "./materials";
import {StockAssets} from "./stock-assets";

async function artwork(resource:string, catalog:Catalog, materials:Materials, stock:StockAssets) {
  if (!resource) return;
  const stem=normalize(resource).replace(/\.(?:png|jpe?g)$/,"");
  const files=["png","jpg","jpeg"].flatMap(ext=>[stem,"assets/resources/"+stem].flatMap(key=>catalog.assets.get(key+"."+ext) || []));
  const file=catalog.ordered(files)[0]?.file;
  return catalog.withPacked(file,async()=>{
    const image=await materials.texture(file,1024);
    return image && PNG.sync.write(image).toString("base64");
  },async()=>(await stock.read("ResourceTexture",path.basename(stem),stem))?.png);
}

export async function unitCard(request:PreviewRequest, catalog:Catalog, materials:Materials, stock:StockAssets) {
  const {sourceText,sourceUri,paint,...choices}=await selectEntity(request,catalog,materials);
  if (!sourceText) return {...choices,error:"Could not find the selected unit's definition."} as const;
  const copySources:string[]=[];
  const doc=await entityDocument(sourceText,sourceUri,catalog,materials,new Set(),copySources);
  const sections=new Map(doc.sections.map(s=>[s.name.toLowerCase(),s]));
  const read=(section:string,key:string)=>field(sections.get(section),key)?.value;
  const kind=read("general","unittype")?.toLowerCase();
  const file=path.basename(decodeURIComponent(new URL(sourceUri).pathname)).replace(/\.ini$/i,"");
  const id=(sourceUri===request.uri ? choices.entity : file).toLowerCase();
  const air=["aircraft","helicopter","vtol"].includes(kind);
  const dictionary=air ? "aircraft_names" : kind==="landunit" ? "land_units_names" : kind==="biologic" ? "biologic_names" : "vessel_names";
  const locale=(request.locale || "en").toLowerCase().split("-")[0];
  const lang=({zh:"cn",vi:"vn"} as Record<string,string>)[locale] || locale;
  function local(dict:string,section:string,key:string) {
    for (const code of new Set([lang,"en"])) {
      const value=catalog.cardDictionaries.get("language_"+code+"/"+dict)?.get(section)?.get(key);
      if (value) return value;
    }
  }
  const name=(key:string)=>local(dictionary,id,key);
  const variant=choices.appearance?.toLowerCase() || "default";
  const nation=(field(paint.selected,"nation") || field(paint.defaults,"nation"))?.value || read("general","nation");
  if (!kind && !name("default")) throw Error("This INI has no unit definition to preview.");
  const facts:{label:string;value:string}[]=[];
  function fact(label:string,value:string,unit:string) {
    if (value && Number.isFinite(Number(value))) facts.push({label,value:Number(value)+" "+unit});
  }
  fact("Length",read("general","length"),"m");
  fact(air ? "Wingspan" : "Beam",air ? read("performance","wingspan") : read("general","beam"),"m");
  fact("Max Speed",air ? read(kind==="helicopter" ? "physics" : "performance","maxspeedatsealevel") : read("physics","maxforwardvelocity"),"kts");
  if (air) fact("Empty Mass",read(kind==="helicopter" ? "physics" : "performance","emptymass"),"kg");
  else if (kind==="landunit") fact("Mass",read("physics","mass"),"kg");
  else fact("Displacement",read("physics","displacement"),"t");
  if (!air) fact("Range",read("general","range") || "0","nm");
  const groups:{label:string;values:string[]}[]=[];
  function group(label:string,names:string[]) {
    const values=[...new Set(names.filter(Boolean))];
    groups.push({label,values:values.length ? values : ["None"]});
  }
  function systems(system:string) {
    const count=Number(read(system+"s","numberof"+system+"s") || 0);
    const pattern=new RegExp("^"+system+"(\\d+)$","i");
    return doc.sections.filter(s=>{
      const match=pattern.exec(s.name);
      return match && +match[1]>=1 && +match[1]<=count;
    });
  }
  const systemName=(id:string)=>id && (local("systemgroups","systemnames",id.toLowerCase())?.split("|")[0] || id);
  function ammoName(id:string) {
    const names=local("ammunition_names","ammunitionnames",id.toLowerCase())?.split(",");
    return names ? [...new Set(names.slice(0,2).map(n=>n.trim()).filter(Boolean))].join(" ") : id;
  }
  function equipment(s:(typeof doc.sections)[number]) {
    const mount=systemName(field(s,"systemname")?.value);
    if (/^(gun|ciws)$/i.test(field(s,"type")?.value)) return [mount];
    const ammo=field(s,"ammunition")?.value;
    const magazine=sections.get(field(s,"associatedmagazine")?.value.toLowerCase());
    const count=Number(field(magazine,"numberofammunitiontypes")?.value);
    const ids=ammo ? [ammo] : (magazine?.keys || []).filter(k=>{
      const index=/^ammunition(\d+)$/i.exec(k.name);
      return index && +index[1]>=1 && +index[1]<=count;
    }).map(k=>k.value);
    return ids.length ? ids.map(ammoName) : [mount];
  }
  const mounts=systems("weaponsystem");
  const isDefence=(s:(typeof doc.sections)[number])=>/^(chaff|noisemaker)$/i.test(field(s,"type")?.value);
  group("Weapons",mounts.filter(s=>!isDefence(s)).flatMap(equipment));
  group("Sensors",systems("sensorsystem").map(s=>systemName(field(s,"systemname")?.value)));
  group("Defences",[...mounts.filter(isDefence).flatMap(equipment),...systems("decoysystem").map(s=>systemName(field(s,"systemname")?.value))]);
  const customAir=field(paint.selected,"customairgroup")?.value.toLowerCase()==="true";
  const airGroup=customAir ? paint.selected : sections.get("airgroup");
  group("Aircraft",(airGroup?.keys || []).filter(k=>!customAir || /^\w+,\d+$/.test(k.value)).map(k=>{
    const [squadron,count]=k.value.split(",").map(v=>v.trim());
    const aircraft=k.name.toLowerCase();
    const label=local("aircraft_names",aircraft,squadron.toLowerCase()) || local("aircraft_names",aircraft,"default") || k.name;
    return [count && count+" ×",label.split(",")[0]].filter(Boolean).join(" ");
  }));
  const flagPath=catalog.cardDictionaries.get("ui/default/settings_ui_general")?.get("nationflags")?.get(nation?.toLowerCase());
  async function profileArt() {
    const index=/^(?:variant|squadron)([1-9]\d*)$/.exec(variant)?.[1];
    for (const unit of [id,...copySources]) {
      const base="ui/profiles/"+unit.replaceAll("/","_");
      for (const candidate of index ? [base+"_"+index,base] : [base]) {
        const image=await artwork(candidate,catalog,materials,stock);
        if (image) return image;
      }
    }
  }
  const [profile,flag]=await Promise.all([profileArt(),artwork(flagPath,catalog,materials,stock)]);
  return {...choices,title:(name(variant) || name("default") || file).split(",")[0],
    classification:name("type")?.split(",").at(-1)?.trim() || read("general","unittype"),
    description:(name(variant+"description") || name("defaultdescription"))?.replaceAll("\\n","\n"),
    nation:nation && (local("nations","nations",nation.toLowerCase()) || nation), profile,flag,facts,groups};
}

import type {CardItem,CardRow} from "./card-references";
import type {unitCard} from "./unit-card";
type Card=Awaited<ReturnType<typeof unitCard>>;
declare function acquireVsCodeApi(): {postMessage(data:unknown):void;getState():{entity?:string;appearance?:string;tab?:string}|undefined;setState(data:unknown):void};
const vscode=acquireVsCodeApi();
const el=<T extends HTMLElement=HTMLElement>(selector:string)=>document.querySelector<T>(selector);
const entity=el<HTMLSelectElement>("#entity"), appearance=el<HTMLSelectElement>("#appearance");
function options(select:HTMLSelectElement,choices:Card["entities"],value:string) {
  if (choices.length!==select.length || choices.some((c,i)=>select.options[i].value!==c.id || select.options[i].text!==c.label))
    select.replaceChildren(...choices.map(c=>new Option(c.label,c.id)));
  select.value=value || "";
  select.parentElement.hidden=choices.length<2;
}
function picture(id:string,png:string,alt:string) {
  const img=el<HTMLImageElement>(id);
  img.hidden=!png;
  img.alt=alt;
  if (png) img.src="data:image/png;base64,"+png;
  else img.removeAttribute("src");
}
let active:Exclude<Card,{error:string}>, revision=0, detail:string, opener:HTMLElement;
const post=(type:string,topic?:string)=>vscode.postMessage({type,topic,revision,tab:tabId});
function itemNode(item:CardItem) {
  const topic=active?.topics[item.topic];
  if (!topic?.source) return document.createTextNode(item.text);
  const button=document.createElement("button");
  button.type="button"; button.className="entry-link"; button.textContent=item.text;
  button.dataset.topic=item.topic;
  button.onclick=()=>{
    if (topic.domain==="aircraft") {post("aircraft",item.topic);return;}
    opener=button; detail=item.topic; showDetail(); el("#back-entry").focus();
  };
  return button;
}
function showDetail() {
  const topic=active?.topics[detail];
  el("#entry").hidden=!topic; el("article").hidden=!!topic;
  el("nav").hidden=!!topic || (entity.parentElement.hidden && appearance.parentElement.hidden);
  if (!topic) return;
  el("#entry-title").textContent=topic.title;
  el("#entry-kind").textContent=({ammunition:"Ammunition",weapons:"Mount",sensors:"Sensor",decoys:"Decoy",aircraft:"Aircraft"})[topic.domain];
  el("#entry-description").textContent=topic.description || "";
  rows("#entry-facts",topic.facts.map(f=>({label:f.label,values:[{text:f.value}]})));
}
el("#back-entry").onclick=()=>{
  detail=undefined; showDetail();
  if (opener?.isConnected) opener.focus();
  else el<HTMLElement>('[role="tab"][aria-selected="true"]').focus();
};
el("#entry-source").onclick=()=>post("source",detail);
el("#back-unit").onclick=()=>post("back");
function rows(id:string,items:CardRow[]) {
  const list=el(id);
  list.hidden=!items.length;
  list.replaceChildren(...items.map(({label,topic,values})=>{
    const row=document.createElement("div"), term=document.createElement("dt"), text=document.createElement("dd");
    term.append(itemNode({text:label,topic}),":");
    for (const value of values) {
      const item=document.createElement("span");
      item.append(itemNode(value)); text.append(item);
    }
    row.append(term,text); return row;
  }));
}
const tabs=Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
let tabId=vscode.getState()?.tab || "overview";
function selectTab(id:string) {
  tabId=tabs.some(t=>!t.hidden && t.getAttribute("aria-controls")===id) ? id : "overview";
  for (const tab of tabs) {
    const panel=tab.getAttribute("aria-controls"), selected=panel===tabId;
    tab.setAttribute("aria-selected",String(selected)); tab.tabIndex=selected ? 0 : -1;
    document.getElementById(panel).hidden=!selected;
  }
  vscode.setState({entity:entity.value,appearance:appearance.value,tab:tabId});
}
for (const tab of tabs) {
  tab.onclick=()=>selectTab(tab.getAttribute("aria-controls"));
  tab.onkeydown=event=>{
    const visible=tabs.filter(t=>!t.hidden), index=visible.indexOf(tab);
    const next={Home:0,End:visible.length-1,ArrowLeft:(index+visible.length-1)%visible.length,ArrowRight:(index+1)%visible.length}[event.key];
    if (next===undefined) return;
    event.preventDefault(); visible[next].focus(); visible[next].click();
  };
}
entity.onchange=()=>vscode.postMessage({type:"select",entity:entity.value});
appearance.onchange=()=>vscode.postMessage({type:"select",entity:entity.value,appearance:appearance.value});
window.addEventListener("message",({data}:{data:{card?:Card;error?:string;canBack?:boolean;tab?:string;revision:number}})=>{
  const card=data.card, status=el('[role="status"]');
  status.hidden=!!card; status.textContent=data.error || "";
  revision=data.revision; el("#back-unit").hidden=!data.canBack; el("#entry").hidden=true;
  if (!card) {el("article").hidden=true; return;}
  options(entity,card.entities,card.entity); options(appearance,card.appearances,card.appearance);
  el("nav").hidden=entity.parentElement.hidden && appearance.parentElement.hidden;
  el("#appearance-label").textContent=card.appearances.some(c=>/^squadron/i.test(c.id)) ? "Squadron" : "Variant";
  if ("error" in card) {
    status.hidden=false; status.textContent=card.error; el("article").hidden=true; return;
  }
  active=card; if (data.tab) {tabId=data.tab;detail=undefined;}
  el("article h1").textContent=card.title; el("#classification").textContent=card.classification;
  picture("#flag",card.flag,card.nation || ""); el("#flag").title=card.nation || "";
  el("#nation").textContent=card.nation || ""; el("#nation").hidden=!!card.flag || !card.nation;
  picture("#profile",card.profile,card.title+" side profile"); el("#missing").hidden=!!card.profile;
  rows("#facts",card.facts.map(f=>({label:f.label,values:[{text:f.value}]})));
  el("#service").textContent=card.serviceYears || ""; el("#service").hidden=!card.serviceYears;
  const weapons=card.groups.filter(g=>g.label==="Weapons" || g.label==="Defences");
  rows("#overview dl",weapons); rows("#armament dl",weapons);
  el("#mount-list").hidden=!card.installedMounts.length; rows("#mount-list dl",card.installedMounts);
  rows("#sensors dl",card.groups.filter(g=>g.label==="Sensors"));
  const wing=card.groups.filter(g=>g.label==="Aircraft" && g.values.some(v=>v.text!=="None"));
  el("#tab-air-wing").hidden=!wing.length; rows("#air-wing dl",wing);
  el("#description").textContent=card.description || ""; el("#description").hidden=!card.description;
  el("#reach").hidden=!card.reach.length;
  el("#reach-bars").replaceChildren(...card.reach.map(r=>{
    const row=document.createElement("div"), label=document.createElement("span"), bar=document.createElement("progress");
    row.className="reach-row"+(r.sensor ? " sensor" : "");
    const range=r.nm.toLocaleString(undefined,{maximumFractionDigits:1})+" nm";
    label.textContent=r.label; bar.max=Math.log1p(1000); bar.value=Math.log1p(r.nm);
    bar.setAttribute("aria-label",r.label+" "+range);
    row.title=card.topics[r.topic].title+" · Configured game range, before situational limits";
    row.append(label,bar,itemNode({text:range,topic:r.topic})); return row;
  }));
  selectTab(tabId);showDetail();
});
vscode.postMessage({type:"ready",...vscode.getState()});

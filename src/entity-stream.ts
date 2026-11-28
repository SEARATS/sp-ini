import { BufferGeometry, Group, LoadingManager, Mesh, MeshPhongMaterial, TextureLoader } from "three";
import type { EntityChunk, EntityScene } from "./entity-model";
import { applyEntityTexture, entityGeometry, entityTexture, partNode } from "./entity-viewer";
import { previewLayer, type DisplaySettings } from "./preview-display";

// Keep a completed view interactive during an edit. On first open, draw arriving assets
// on the full transform hierarchy so a child can arrive before its parent's geometry.
export class EntityStream {
  readonly cachedGeometry = new Map<string,EntityScene["geometry"][number]>();
  readonly cachedTextures = new Map<string,EntityScene["textures"][number]>();
  readonly geometry:EntityScene["geometry"] = [];
  readonly textures:EntityScene["textures"] = [];
  readonly group = new Group();
  readonly buffers:BufferGeometry[] = [];
  readonly maps:ReturnType<typeof entityTexture>[] = [];
  private readonly nodes = new Map<string,Group>();
  private readonly surfaces = new Map<string,Mesh<BufferGeometry,MeshPhongMaterial>>();
  private readonly loader:TextureLoader;
  texturesSettled=false;
  constructor(readonly parts:EntityScene["parts"], readonly display:boolean, readonly manager:LoadingManager) {
    this.loader = new TextureLoader(manager);
    manager.onStart=()=>{this.texturesSettled=false;};
    manager.onLoad=()=>{this.texturesSettled=true;};
    if (!display) return;
    for (const part of parts) this.nodes.set(part.id,partNode(part));
    for (const part of parts) (this.nodes.get(part.parent) ?? this.group).add(this.nodes.get(part.id));
  }

  append(chunk:Exclude<EntityChunk,{kind:"parts"}>, settings:DisplaySettings, hidden:Set<string>,
      previous?:Pick<EntityStream,"cachedGeometry"|"cachedTextures">) {
    const {index} = chunk;
    if (chunk.kind==="geometry") {
      if (chunk.digest || chunk.data) {
        this.geometry[index]=chunk.data ?? previous.cachedGeometry.get(chunk.digest);
        if (chunk.digest) this.cachedGeometry.set(chunk.digest,this.geometry[index]);
      }
      if (!this.display) return;
      const shape=this.buffers[index] ??= entityGeometry(this.geometry[index]);
      const part=this.parts.find(p=>p.id===chunk.part);
      const surface=new Mesh(shape,new MeshPhongMaterial({color:0xaaaaaa,wireframe:part.collider ? settings.colliderWireframe : settings.meshWireframe}));
      surface.layers.set(part.collider ? previewLayer.collider : previewLayer.mesh);
      surface.visible=part.visible && !hidden.has(part.id) && (part.collider ? settings.colliders : settings.meshes);
      this.nodes.get(part.id).add(surface);
      this.surfaces.set(part.id,surface);
      return surface.visible;
    }
    if (chunk.digest || chunk.data) {
      this.textures[index]=chunk.data ?? previous.cachedTextures.get(chunk.digest);
      if (chunk.digest) this.cachedTextures.set(chunk.digest,this.textures[index]);
    }
    if (!this.display) return;
    const map=this.maps[index] ??= entityTexture(this.loader,this.textures[index]);
    const surface=this.surfaces.get(chunk.part);
    if (surface) applyEntityTexture(surface.material,map,this.textures[index]);
  }

  dispose(transferAssets=false) {
    this.group.removeFromParent();
    this.surfaces.forEach(mesh=>mesh.material.dispose());
    if (!transferAssets) {
      this.buffers.forEach(g=>g.dispose());
      this.maps.forEach(t=>t.dispose());
    }
  }
}

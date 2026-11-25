"""Index exported FBXs, textures and fallback meshes for a local Unity project."""
import json
import re
import struct
from collections import Counter
from pathlib import Path

def object_names(path):
    """Read names in binary FBX Objects without decoding vertex buffers."""
    with path.open("rb") as f:
        if not f.read(23).startswith(b"Kaydara FBX Binary"):
            raise ValueError(f"Expected a binary AssetStudio FBX: {path}")
        wide = struct.unpack("<I", f.read(4))[0] >= 7500
        fmt = "<QQQB" if wide else "<IIIB"
        size = struct.calcsize(fmt)
        def nodes(limit):
            while f.tell() + size <= limit:
                end, _, plen, n = struct.unpack(fmt, f.read(size))
                if not end:
                    break
                name = f.read(n)
                if name == b"Objects":
                    f.seek(plen, 1)
                    yield from nodes(end)
                elif name in (b"Model", b"Geometry"):
                    data = f.read(plen)
                    if data[:1] == b"L" and data[9:10] == b"S":
                        length = struct.unpack("<I", data[10:14])[0]
                        label = data[14:14+length].split(b"\0",1)[0].decode("utf8",errors="replace")
                        if label:
                            yield label.casefold()
                f.seek(end)
        yield from nodes(path.stat().st_size)

def standalone_fbx(mesh, target):
    """Create an FBX for a mesh with no recoverable prefab binding."""
    body = mesh.export()
    if not body:
        raise ValueError("Empty mesh")
    vertex, normals, uv, indices, texidx, normidx = [], [], [], [], [], []
    for raw in body.splitlines():
        parts = raw.split()
        if not parts: continue
        tag, vals = parts[0], parts[1:]
        if tag == "v": vertex.extend(vals)
        elif tag == "vt": uv.extend(vals)
        elif tag == "vn": normals.extend(vals)
        elif tag == "f":
            for i,point in enumerate(vals):
                v,t,n = (point+"//").split("/")[:3]
                indices.append(str(-int(v) if i==len(vals)-1 else int(v)-1))
                texidx.append(str(int(t or 1)-1))
                normidx.append(str(int(n or 1)-1))
    def arr(name, values, indent="\t\t"):
        return indent+name+": *"+str(len(values))+" {\n"+indent+"\ta: "+",".join(values)+"\n"+indent+"}"
    label = mesh.m_Name.replace('"',"'").replace("\n"," ").replace("\r"," ")
    lines = ['; FBX 7.4.0 project file','FBXHeaderExtension: {','\tFBXHeaderVersion: 1003','\tFBXVersion: 7400','}',
             'Objects: {',f'\tGeometry: 1, "Geometry::{label}", "Mesh" {{',arr("Vertices",vertex),arr("PolygonVertexIndex",indices)]
    for layer,key,index,values,lookup in [("Normal","Normals","NormalsIndex",normals,normidx),("UV","UV","UVIndex",uv,texidx)]:
        if values:
            lines.extend([f'\t\tLayerElement{layer}: 0 {{','\t\t\tVersion: 101','\t\t\tMappingInformationType: "ByPolygonVertex"',
                          '\t\t\tReferenceInformationType: "IndexToDirect"',arr(key,values,"\t\t\t"),arr(index,lookup,"\t\t\t"),'\t\t}'])
    lines.extend(['\t}',f'\tModel: 2, "Model::{label}", "Mesh" {{','\t\tVersion: 232','\t}','}',
                  'Connections: {','\tC: "OO",1,2','\tC: "OO",2,0','}'])
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("\n".join(lines)+"\n",encoding="utf8")

def index_project(project, data, workspace):
    import UnityPy
    assets = project / "Assets"
    models, textures, standalone, errors = {}, {}, {}, []
    for meta in assets.rglob("*.meta"):
        if meta.name.lower().split(".")[-2] not in ("png","jpg","jpeg"): continue
        with meta.open(encoding="utf8") as src:
            guid = re.search(r"^guid: ([0-9a-f]+)",src.read(256),re.M)
        if guid: textures[guid[1]] = meta.with_suffix("").relative_to(project).as_posix()
    for archive in sorted(data.glob("*.assets")):
        known = set()
        for fbx in (assets/"SeaPowerFBX"/archive.stem).rglob("*.fbx"):
            models[fbx.relative_to(project).as_posix()] = fbx.stem
            known.update(object_names(fbx))
        env = UnityPy.load(str(archive))
        meshes = [(obj,(obj.peek_name() or "")) for obj in env.objects if obj.type.name == "Mesh"]
        counts = Counter(name.casefold() for _,name in meshes)
        for obj,name in meshes:
            if name.casefold() in known and counts[name.casefold()] == 1: continue
            stem = re.sub(r"[^A-Za-z0-9_.-]", "_",name)[:96] or "mesh"
            target = assets/"SeaPowerLooseMeshes"/archive.stem/f"{obj.path_id}_{stem}.fbx"
            try:
                standalone_fbx(obj.read(),target)
                standalone[target.relative_to(project).as_posix()] = {"archive":archive.name,"pathID":obj.path_id,"name":name}
            except Exception as exc:
                errors.append({"archive":archive.name,"pathID":obj.path_id,"name":name,"error":str(exc)})
    (project/"sp-ini-models.json").write_text(json.dumps({"models":models,"textures":textures,"standalone":standalone,
        "unrecoverable":errors},indent=2),encoding="utf8")
    (workspace/"Sea Power.code-workspace").write_text(json.dumps({"folders":[{"path":project.relative_to(workspace).as_posix()}],
        "settings":{"files.associations":{"*.ini":"seapower-ini"},"seapowerIni.gameDirectory":str(data.parent)}},indent=2),encoding="utf8")
    print(f"{len(models)} hierarchy FBXs, {len(standalone)} standalone meshes, {len(textures)} textures, {len(errors)} unreadable meshes.")

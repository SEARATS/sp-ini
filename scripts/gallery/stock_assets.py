# /// script
# requires-python = ">=3.10"
# dependencies = ["UnityPy==1.25.4"]
# ///
"""Prepare a disposable OBJ-based copy of the stock Spruance VLS for VS Code screenshots."""

from collections import Counter
from pathlib import Path
import argparse
import re

import UnityPy


def export_parts(parts, output):
    # Faces in the combined OBJ must index vertices, UVs and normals across objects.
    counts = Counter()
    with output.open("x", encoding="utf-8", newline="\n") as dest:
        for name, part in parts.items():
            dest.write(f"o {name}\n")
            offsets = counts.copy()
            for line in part.read().export().splitlines():
                fields = line.split()
                if not fields:
                    continue
                kind = fields[0]
                if kind in ("v", "vt", "vn"):
                    counts[kind] += 1
                elif kind == "f":
                    def adjust(corner):
                        return "/".join(str(int(n) + offsets[k]) if n and int(n) > 0 else n
                                        for k, n in zip(("v", "vt", "vn"), corner.split("/")))
                    line = "f " + " ".join(map(adjust, fields[1:]))
                dest.write(line + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("game", type=Path)
    parser.add_argument("workspace", type=Path)
    args = parser.parse_args()
    data = args.game / "Sea Power_Data"
    folder = args.workspace / "ships/usn_dd_spruance_vls"
    folder.mkdir(parents=True)
    vessels = args.workspace / "vessels"
    vessels.mkdir()
    ini = (data / "StreamingAssets/original/vessels/usn_dd_spruance_vls.ini").read_text(encoding="utf-8-sig")
    ini = re.sub(r"(?im)^(ResourcesRoot=usn_dd_spruance_vls)[ \t]*$", r"\1.obj", ini)
    ini = re.sub(r"(?im)^((?:ResourcesMaterial|Material)=usn_dd_spruance_vls_deck_mat)[ \t]*$", r"\1.ini", ini)
    (vessels / "usn_dd_spruance_vls.ini").write_text(ini, encoding="utf-8")

    env = UnityPy.load(str(data / "resources.assets"))
    names = ["usn_dd_spruance_vls", "usn_dd_spruance_vls_deck", "usn_dd_spruance_vls_parts", "usn_dd_spruance_vls_coll_hull_1"]
    meshes, material = {}, None
    for asset in env.objects:
        if asset.type.name == "Mesh" and (name := asset.peek_name()) in names:
            meshes[name] = asset
        if asset.type.name == "Material" and asset.peek_name() == "usn_dd_spruance_vls_deck_mat":
            material = asset.read()
    if set(meshes) != set(names) or material is None:
        raise ValueError("The installed archive is missing a Spruance VLS mesh or material needed for the gallery.")
    export_parts({name: meshes[name] for name in names}, folder / "usn_dd_spruance_vls.obj")
    # The collision hull is for inspection in source and is invisible on the ship.
    export_parts({name: meshes[name] for name in names if "_coll_" not in name}, folder / "spruance_vls_exterior.obj")

    shader = material.m_Shader.read().m_ParsedForm.m_Name
    fields = ["[Shader]", f"Path={shader}", "", "[Textures]"]
    for name, slot in material.m_SavedProperties.m_TexEnvs:
        if not slot.m_Texture.m_PathID:
            continue
        texture = slot.m_Texture.read()
        filename = texture.m_Name + ".png"
        if Path(filename).name != filename:
            raise ValueError("Unexpected texture name in the archive")
        texture.image.save(folder / filename)
        fields.append(f"{name}=ships/usn_dd_spruance_vls/{filename}")
    (folder / "usn_dd_spruance_vls_deck_mat.ini").write_text("\n".join(fields), encoding="utf-8")


if __name__ == "__main__":
    main()

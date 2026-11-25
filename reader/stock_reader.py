"""Read named meshes and thumbnail-sized material maps from a local Unity player."""
import base64
from collections import defaultdict
import io
import json
from pathlib import Path
import sys

# UnityPy eagerly imports its audio exporter, which loads FMOD even for meshes.
# This reader only imports the mesh and image exporters.
from types import ModuleType
sys.modules["UnityPy.export.AudioClipConverter"] = ModuleType("UnityPy.export.AudioClipConverter")

import UnityPy
from PIL import Image


class StockArchive:
    def __init__(self, data):
        env = UnityPy.load(str(data / "resources.assets"))
        self.env = env
        self.names = defaultdict(list)
        self.paths = defaultdict(set)
        for asset in env.objects:
            if asset.type.name in ("Mesh", "Material", "Texture2D"):
                self.names[(asset.type.name, (asset.peek_name() or "").casefold())].append(asset)
        managers = UnityPy.load(str(data / "globalgamemanagers"))
        for obj in managers.objects:
            if obj.type.name != "ResourceManager":
                continue
            for name, ptr in obj.read().m_Container:
                if ptr.m_FileID and obj.assets_file.externals[ptr.m_FileID - 1].path.lower().endswith("resources.assets"):
                    self.paths[name.casefold()].add(ptr.m_PathID)

    def find(self, kind, name, scope):
        candidates = self.names.get((kind, name.casefold()), [])
        if len(candidates) != 1:
            ids = self.paths.get(scope.strip("/").casefold(), ())
            candidates = [a for a in candidates if a.path_id in ids]
        return candidates[0].read() if len(candidates) == 1 else None

    @staticmethod
    def image(texture):
        image = texture.image.convert("RGBA")
        image.thumbnail((384, 384), Image.Resampling.LANCZOS)
        encoded = io.BytesIO()
        image.save(encoded, "PNG")
        return {"name": texture.m_Name, "png": base64.b64encode(encoded.getvalue()).decode("ascii")}

    def read(self, query):
        kind, name = query["kind"], query["name"]
        item = self.find(kind, name, query.get("scope", ""))
        if item is None:
            return None
        if kind == "Mesh":
            return {"obj": "o " + item.m_Name + "\n" + item.export()}
        if kind == "Texture2D":
            return self.image(item)
        maps = {}
        for slot, value in item.m_SavedProperties.m_TexEnvs:
            if value.m_Texture.m_PathID and len(maps) < 16:
                texture = value.m_Texture.read()
                if value.m_Texture.type.name == "Texture2D":
                    maps[slot] = self.image(texture)
        return {"shader": item.m_Shader.read().m_ParsedForm.m_Name,
                "floats": dict(item.m_SavedProperties.m_Floats), "maps": maps}


def main():
    if sys.argv[1:] == ["--self-test"]:
        from UnityPy.export import MeshExporter, Texture2DConverter
        return
    archive = StockArchive(Path(sys.argv[1]))
    for line in sys.stdin:
        query = json.loads(line)
        try:
            reply = {"id": query["id"], "value": archive.read(query)}
        except Exception as error:
            reply = {"id": query["id"], "error": str(error)}
        print(json.dumps(reply, separators=(",", ":")), flush=True)


if __name__ == "__main__":
    main()

"""Convert the gallery's stock exterior OBJ to FBX using Blender in background mode."""

from pathlib import Path
import sys

import bpy

source = Path(sys.argv[sys.argv.index("--") + 1])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.obj_import(filepath=str(source))
bpy.ops.export_scene.fbx(filepath=str(source.with_suffix(".fbx")), object_types={"MESH"}, bake_anim=False)

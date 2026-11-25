# /// script
# requires-python = ">=3.10"
# dependencies = ["UnityPy==1.25.4"]
# ///
"""List or export selected meshes from a local Sea Power installation."""

import argparse
from fnmatch import fnmatchcase
from pathlib import Path
import re

import UnityPy


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("game", type=Path, help="Sea Power installation directory or resources.assets file")
    parser.add_argument("--mesh", required=True, action="append", help="Mesh name or wildcard; repeat for multiple names")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--list", action="store_true", help="Print matching names and Unity path IDs")
    mode.add_argument("--out", type=Path, help="Write one OBJ per matching mesh into this folder")
    args = parser.parse_args()
    archive = args.game / "Sea Power_Data/resources.assets" if args.game.is_dir() else args.game
    if not archive.is_file():
        parser.error(f"Asset archive does not exist: {archive}")
    if args.out and archive.parent in (args.out.resolve(), *args.out.resolve().parents):
        parser.error("Choose an output folder outside the game's asset directory.")

    env = UnityPy.load(str(archive.resolve()))
    count = 0
    for asset in env.objects:
        if asset.type.name != "Mesh":
            continue
        name = asset.peek_name() or ""
        if not any(fnmatchcase(name.casefold(), pattern.casefold()) for pattern in args.mesh):
            continue
        count += 1
        if args.list:
            print(f"{asset.path_id}\t{name}")
            continue
        # The path ID distinguishes meshes with identical names across the archive.
        stem = re.sub(r'[^a-zA-Z0-9_.-]', "_", name)[:140].strip(".") or "mesh"
        target = args.out / f"{stem}_{asset.path_id}.obj"
        args.out.mkdir(parents=True, exist_ok=True)
        if target.exists():
            print(f"Already exists: {target}")
            continue
        body = asset.read().export()
        header = name.replace("\r", " ").replace("\n", " ")
        with target.open("x", encoding="utf-8", newline="\n") as output:
            output.write(f"o {header}\n")
            output.write(body.replace("\r\n", "\n"))
        print(target)
    if not count:
        parser.exit(1, "No matching meshes found.\n")


if __name__ == "__main__":
    main()

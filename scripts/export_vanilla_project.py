"""Export a local Sea Power installation for editing with AssetRipper and AssetStudioModCLI."""
import argparse
from mirror_index import index_project
from pathlib import Path
import shutil
import socket
import subprocess
import time
import urllib.parse
import urllib.request


def extract_project(ripper, data, output):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    url = f"http://127.0.0.1:{port}"
    with (output / "unity-export.log").open("w", encoding="utf8") as log:
        process = subprocess.Popen([ripper, "--headless", "--port", str(port)],
                                   cwd=output, stdout=log, stderr=subprocess.STDOUT)
        try:
            for _ in range(120):
                if process.poll() is not None:
                    raise RuntimeError("AssetRipper stopped; see unity-export.log")
                try:
                    with urllib.request.urlopen(url, timeout=1):
                        break
                except OSError:
                    time.sleep(0.5)
            else:
                raise RuntimeError("AssetRipper did not start")
            archives = [data / "globalgamemanagers", *sorted(data.glob("*.assets")),
                        *sorted(p for p in data.glob("level*") if p.is_file() and p.name[5:].isdigit())]
            for endpoint, paths in [("/LoadFile", archives), ("/Export/UnityProject", [output / "Unity"])]:
                fields = urllib.parse.urlencode([("Path", str(p)) for p in paths]).encode()
                with urllib.request.urlopen(url + endpoint, data=fields) as response:
                    response.read()
        finally:
            process.terminate()
            process.wait()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["game", "output", "ripper", "studio"]:
        parser.add_argument(name if name in ("game", "output") else "--" + name, type=Path,
                            **({"required": True} if name in ("ripper", "studio") else {}))
    parser.add_argument("--index-only", action="store_true", help="Rebuild mappings and standalone meshes after the hierarchy export")
    args = parser.parse_args()
    game, output = args.game.resolve(), args.output.resolve()
    data = game / "Sea Power_Data"
    if not (data / "resources.assets").is_file() or output.is_relative_to(game) or game.is_relative_to(output):
        parser.error("Choose a Sea Power installation and a separate output folder")
    output.mkdir(parents=True, exist_ok=True)
    project = output / "Unity" / "ExportedProject"
    if args.index_only:
        if not (project / "Assets" / "SeaPowerFBX").is_dir(): parser.error("Missing hierarchy export")
        index_project(project, data, output)
        return
    if any(output.iterdir()):
        parser.error("Use an empty output folder")
    extract_project(args.ripper.resolve(strict=True), data, output)
    project = output / "Unity" / "ExportedProject"
    assets = project / "Assets"
    if not assets.is_dir():
        raise RuntimeError("Missing exported Unity project; see unity-export.log")
    shutil.copytree(data / "StreamingAssets" / "original", assets / "StreamingAssets" / "original", dirs_exist_ok=True)
    models = assets / "SeaPowerFBX"
    for archive in sorted(data.glob("*.assets")):
        with (output / "fbx-export.log").open("a", encoding="utf8") as log:
            subprocess.run([args.studio.resolve(strict=True), archive, "-m", "splitObjects", "-o",
                            models / archive.stem, "--fbx-animation", "skip"], stdout=log, stderr=subprocess.STDOUT, check=True)
    index_project(project, data, output)


if __name__ == "__main__":
    main()

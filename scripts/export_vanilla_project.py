"""Export a local Sea Power installation for editing with AssetRipper and AssetStudioModCLI."""
import argparse
import os
import re
import tempfile
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


def stage_archive(src, dest):
    import UnityPy
    patches = []
    if src.suffix.lower() == ".assets":
        env = UnityPy.load(str(src))
        for obj in env.objects:
            if obj.type.name != "Texture2D":
                continue
            name = (obj.peek_name() or "").encode("utf8")
            safe = name.replace(b"/", b"_").replace(b"\\", b"_")
            if safe != name:
                patches.append((obj.byte_start, name, safe))
    if patches:
        # AssetStudio uses texture names as output filenames. Edit only this private copy.
        shutil.copyfile(src, dest)
        with dest.open("r+b") as archive:
            for start, name, safe in patches:
                archive.seek(start)
                length = int.from_bytes(archive.read(4), "little")
                if length != len(name) or archive.read(length) != name:
                    raise ValueError(f"Unexpected texture header in {src.name} at {start}")
                archive.seek(start + 4)
                archive.write(safe)
        return
    try:
        os.link(src, dest)
    except OSError:
        try:
            dest.symlink_to(src)
        except OSError:
            shutil.copyfile(src, dest)


def export_models(studio, data, output, models, retry=None):
    # Loading archives separately makes AssetStudio export their shared dependencies repeatedly.
    system_temp = Path(tempfile.gettempdir())
    stage_base = system_temp if system_temp.drive.casefold() == data.drive.casefold() else output
    with tempfile.TemporaryDirectory(dir=stage_base, prefix="fbx-input-") as stage:
        for src in data.iterdir():
            if not src.is_file() or not (src.name.startswith(("level", "globalgamemanagers")) or
                    src.suffix.lower() in (".assets", ".ress", ".resource")):
                continue
            stage_archive(src, Path(stage) / src.name)
        log_path = output / ("fbx-retry.log" if retry else "fbx-export.log")
        command = [studio, stage, "-m", "splitObjects", "-o", models / "prefabs", "--fbx-animation", "skip"]
        if retry:
            command.extend(["--filter-by-name", "^" + re.escape(retry) + "$", "--filter-with-regex"])
        with log_path.open("w", encoding="utf8") as log:
            subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, check=True)
        report = log_path.read_text(encoding="utf8", errors="replace")
        if "Export GameObject:" in report or "Finished exporting [" not in report:
            raise RuntimeError(f"AssetStudio could not export all model roots; see {log_path}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["game", "output", "ripper", "studio"]:
        parser.add_argument(name if name in ("game", "output") else "--" + name, type=Path,
                            **({"required": True} if name in ("ripper", "studio") else {}))
    parser.add_argument("--index-only", action="store_true", help="Rebuild mappings and standalone meshes after the hierarchy export")
    parser.add_argument("--finish", action="store_true", help="Resume from a completed Unity project export")
    parser.add_argument("--retry-model", help="Retry one failed model in an existing export")
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
    if not (args.finish or args.retry_model) and any(output.iterdir()):
        parser.error("Use an empty output folder")
    if not (args.finish or args.retry_model):
        extract_project(args.ripper.resolve(strict=True), data, output)
    assets = project / "Assets"
    if not assets.is_dir():
        raise RuntimeError("Missing exported Unity project; see unity-export.log")
    models = assets / "SeaPowerFBX"
    if args.finish and models.exists() and next(models.rglob("*.fbx"), None):
        parser.error("FBXs already exist. Use --index-only, or --retry-model for a failed root.")
    if not args.retry_model:
        shutil.copytree(data / "StreamingAssets" / "original", assets / "StreamingAssets" / "original", dirs_exist_ok=True)
    export_models(args.studio.resolve(strict=True), data, output, models, args.retry_model)
    index_project(project, data, output)


if __name__ == "__main__":
    main()

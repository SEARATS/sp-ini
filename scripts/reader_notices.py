"""Collect notices for the bundled Python reader from the installed distributions."""
from importlib import metadata
from pathlib import Path
import sys

from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

def main(output):
    notices = []
    interpreter_license = Path(sys.base_prefix) / "LICENSE.txt"
    if interpreter_license.is_file():
        notices.append(interpreter_license.read_text(encoding="utf8"))
    pending = ["UnityPy", "Pillow", "PyInstaller"]
    seen = {"fmod-toolkit", "pyfmodex"}
    while pending:
        name = canonicalize_name(pending.pop())
        if name in seen:
            continue
        seen.add(name)
        dist = metadata.distribution(name)
        for raw in dist.requires or ():
            req = Requirement(raw)
            if req.marker is None or req.marker.evaluate():
                pending.append(req.name)
        contents = []
        for entry in dist.files or ():
            filename = str(entry).lower()
            if ".dist-info/" not in filename or not any(word in filename for word in ["license","copying","notice"]):
                continue
            file = dist.locate_file(entry)
            if file.is_file():
                contents.append(file.read_text(encoding="utf8",errors="replace"))
        if not contents and dist.metadata.get("License"):
            contents.append(dist.metadata["License"])
        notices.append(f"{dist.metadata['Name']} {dist.version}\n" + "\n".join(contents))
    Path(output).write_text("\n\n".join(notices),encoding="utf8")

if __name__ == "__main__":
    main(sys.argv[1])

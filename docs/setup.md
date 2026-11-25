# Editor setup

Install the VSIX using **Extensions: Install from VSIX...**. To select the language for every INI in a mod workspace, add this to its settings:

```json
{ "files.associations": { "*.ini": "seapower-ini" } }
```

The extension finds the game through Steam. For a custom installation, set `seapowerIni.gameDirectory` to the folder containing `Sea Power_Data`. Add other mod folders to `seapowerIni.localModDirectories` and other Workshop `content/1286220` folders to `seapowerIni.workshopDirectories`. After updating external content, run **Sea Power INI: Rebuild Content Index**.

The VS Code FBX viewer opens binary and ASCII FBX models, including hierarchy transforms. Explicit FBX file paths in INIs open the model. Named mesh and collider definitions in OBJ files also support jumping to a source line.

## Generate submodels and colliders

Start from the FBX hierarchy, a model reference in an INI, or **Sea Power INI: Generate Submodels and Colliders…** in the Command Palette. Pick a parent, then choose **INI file** or **Clipboard**. Change each object's role if needed. File mode previews a diff and applies it as an undoable edit. Clipboard mode previews plain INI text for manual pasting. When pasting into existing lists, continue their numbering.

The generator download runs with Node.js 18 or newer.

```powershell
node generate.js --model ship.fbx --parent /Hull --ini ship.ini --dry-run
node generate.js --model ship.fbx --parent /Hull --clipboard
```

Omit `--dry-run` to update the INI. Use `--stdout` for a pipeline or `--roles roles.json` to override defaults with a JSON object keyed by hierarchy path. Accepted roles are `Submodel`, `Collider` and `Skip`. Regeneration uses the FBX filename and parent path to identify its entries.

## Mirror the vanilla project

On Windows, install Python 3.12 with UnityPy 1.25.4. Download [AssetRipper](https://github.com/AssetRipper/AssetRipper/releases) and [AssetStudioModCLI](https://github.com/aelurum/AssetStudioMod/releases). Use an empty output directory on a drive with room for the extracted game.

```powershell
python scripts/export_vanilla_project.py "C:\Games\Sea Power" "D:\SeaPowerMirror" --ripper "C:\Tools\AssetRipper.GUI.Free.exe" --studio "C:\Tools\AssetStudioModCLI.exe"
code "D:\SeaPowerMirror\Sea Power.code-workspace"
```

AssetRipper restores Unity resources and prefabs. AssetStudio exports FBX hierarchies. It reads staged copies for archives with slashes in texture names so it can write the texture files. The script copies the stock INIs, exports remaining meshes individually and records inferred FBX paths, texture GUIDs and unreadable meshes in `sp-ini-models.json`. The manifest lists candidate resource paths for each FBX by prefab name. Keep the generated project local.

The stock Spruance VLS check resolved the deck to its FBX and its material to the Unity `.mat`, rendered the FBX in VS Code, and displayed a textured 303-face mesh plus the three material maps. To repeat it, run `./test/stock.ps1 -Mirror D:/SeaPowerMirror` from the checkout. Run it without `-Mirror` to test the installed archive.

## Build

With Node.js 22.13 or newer and pnpm, run `pnpm install --frozen-lockfile`, `pnpm test` and `pnpm run package`. Other LSP editors can run `node dist/server.js --stdio` with language ID `seapower-ini`. The PSPad download includes its setup instructions.

To bundle Windows stock previews when packaging locally, install `UnityPy==1.25.4` and `pyinstaller==6.16.0` with Python 3.12 and run `./scripts/build-reader.ps1` before packaging. CI builds the reader for releases.

On Windows, run `./scripts/dev-window.ps1 <mod-folder>` from the checkout to test local changes. The development window reloads after each successful rebuild.

## Export a stock mesh

The optional exporter reads a local installation with Python 3.10+ and UnityPy 1.25.4. Run it with `uv run`, or install `UnityPy==1.25.4` in a Python environment and invoke the script with Python.

```powershell
uv run scripts/export_game_obj.py "C:\Program Files (x86)\Steam\steamapps\common\Sea Power" --mesh "usn_dd_spruance_vls*" --list
uv run scripts/export_game_obj.py "C:\Program Files (x86)\Steam\steamapps\common\Sea Power" --mesh usn_dd_spruance_vls --out "$env:TEMP\sp-ini-objects"
```

Each OBJ contains the mesh's geometry, normals and UVs where supplied. Materials and textures are separate game resources.

## Regenerate the feature screenshots

The [public gallery](https://github.com/SEARATS/binaries/tree/main/sp-ini) lives in the SEARATS binaries repository.

On Windows, install the project dependencies with `pnpm install --frozen-lockfile`. The capture script uses VS Code's `code` command and either `uv` or Python 3.12 with UnityPy 1.25.4 and PyInstaller 6.16.0.

```powershell
./scripts/screenshots.ps1 -OutputDirectory "$env:TEMP\sp-ini-feature-gallery"
```

Blender adds a screenshot of the same stock exterior in FBX format. Pass `-BlenderPath` if it is installed outside the default location.

The entity preview screenshots use the installed ship INI. The script hovers over the ship and a sphere collider, then follows links from the viewport and hierarchy to their INI sections.

Pass `-GameDirectory` for a different Steam library. The script opens an isolated VS Code window, exports selected stock Spruance VLS meshes and textures into a temporary workspace, and exercises the extension on a copy of the ship INI. It crops the rendered widgets and relevant source lines, then writes the PNGs, a Markdown gallery and `index.html` to the output folder.

## Release

Bump `version` in `package.json` and push to `main`. After tests pass, CI builds all three downloads, tags the commit and publishes them to GitHub Releases. Further pushes at the same version run the build checks. With the repository variable `PUBLISH_MARKETPLACE=true`, it also publishes the same VSIX under the SEARATS Marketplace publisher.

Run **Publish editor releases** manually on `main` to check Marketplace authentication without releasing a version. The Trusted Publishing policy names `SEARATS/sp-ini` and `marketplace.yml`. [Microsoft's publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#publish-with-github-actions-and-trusted-publishing)

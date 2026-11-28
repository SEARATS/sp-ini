# Editor setup

Install the VSIX using **Extensions: Install from VSIX...**. To select the language for every INI in a mod workspace, add this to its settings:

```json
{ "files.associations": { "*.ini": "seapower-ini" } }
```

The extension finds the game through Steam. For a custom installation, set `seapowerIni.gameDirectory` to the folder containing `Sea Power_Data`. Add other mod folders to `seapowerIni.localModDirectories` and other Workshop `content/1286220` folders to `seapowerIni.workshopDirectories`. After updating external content, run **Sea Power INI: Rebuild Content Index**.

## Analyze saved INIs

Run **Sea Power INI: Analyze INI Files…** from the Command Palette. Choose **Vanilla game** to check the installed `original` directory in isolation, or **Entire workspace** to check your project's saved INIs using your configured reference sources. Select a finding in **Problems** to jump to its line. Each scan replaces the previous scan's results. Open editors continue to check unsaved text.

From a checkout of sp-ini, run `pnpm run analyze --vanilla` or `pnpm run analyze "path/to/mod"`. Redirect output to save a report. Exit codes are 0 for a completed scan without errors, 1 for lint errors, and 2 for file or setup failures.

In VS Code Settings, filter by `@ext:searats.seapower-ini search`. Each source starts enabled. Changes rebuild the index and refresh open entity previews.

Edit **Search: Order** to put preferred sources first. For example, `["workshop", "game"]` searches Workshop ahead of vanilla and then checks the remaining sources in their default order. The **Project Root** checkbox controls loose files under the workspace independently of the two subdirectories. Go to Definition opens the highest-priority match. It can list multiple definitions at the same priority.

```json
{
  "seapowerIni.searchPaths.directory": "Assets",
  "seapowerIni.searchPaths.resourcesSubdirectory": "Resources",
  "seapowerIni.searchPaths.dataSubdirectory": "StreamingAssets"
}
```

A relative parent starts at each workspace folder. Set the parent to an absolute path to share one asset tree across workspaces, or to `.` if you opened the Assets folder itself.

| Setting under `seapowerIni.search` | Where it looks |
| --- | --- |
| `projectRoot` | Loose files and mod INIs under each open project root |
| `resources` | The Resources subdirectory under the search directory |
| `data` | The Data subdirectory, with content directly inside it or under `original` and mod folders |
| `mirror` | The generated Unity project's model and texture manifest |
| `localMods` | The folders listed in `seapowerIni.localModDirectories` |
| `installedMods` | Mod folders beside `StreamingAssets/original` |
| `userMods` | The Sea Power Mods folder in the Windows user profile |
| `workshop` | Detected and configured Steam Workshop libraries |
| `game` | Vanilla INIs and packed assets in the game installation |

For example, `ResourcesMaterialFolder=ships/materials/` and `Material=usn_parts` can resolve to `Assets/Resources/ships/materials/usn_parts.mat`. Set `seapowerIni.search.resources` to `false` to skip that lookup while keeping the configured path.

After `ResourcesMaterialFolder=`, use **Ctrl+Space** and accept a folder with **Tab**. Paths start at the configured Resources folder. When that folder is missing or its search is disabled, suggestions come from enabled mod and game content folders and the material paths declared in their INIs.

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

The entity preview screenshots use the installed Spruance INI. The script captures the hierarchy, system markers, sphere detail and overlapping collider highlights. It follows links from the viewport and hierarchy to their INI sections.

To regenerate just the Spruance radar GIF, run `./scripts/screenshots.ps1 -AnimationOnly` with FFmpeg on your PATH.

Pass `-GameDirectory` for a different Steam library. The script opens an isolated VS Code window, exports selected stock Spruance VLS meshes and textures into a temporary workspace, and exercises the extension on a copy of the ship INI. It crops the rendered widgets and relevant source lines, then writes the PNGs, a Markdown gallery and `index.html` to the output folder.

## Material preview

Hover over `Material=` in a unit INI, or right-click a material `.mat` or `.ini` file and choose **Open With… → Sea Power Material Preview**. For text-serialized Unity materials, keep each texture's `.meta` beside the texture. The preview finds it by GUID across enabled search folders and can display PNG, JPEG and TGA maps.

The **Properties** list shows saved material values. Problems in typed INI properties and Unity numeric fields appear in the preview and in VS Code. **Analyze INI Files…** also checks saved Unity materials.

## INI preview model sources

In the entity preview hierarchy, **Model source** lists same-name files in the referenced model folder. **Auto** tries FBX, OBJ, then Blender. Choose a file to pin that model to it. A single available file appears as plain text. Blender files appear when Blender is installed.

## Blender scenes

Open a local `.blend` file or right-click it and choose **Preview Blender Scene**. The preview shows the saved scene at its original scale. Use the hierarchy to toggle objects and switch between shaded and wireframe views. Saving in Blender refreshes the preview. Procedural shaders and animations are outside the scope of the static preview.

Right-click a `.blend` file in the VS Code Explorer and choose **Export Blender Scene as FBX…** or **Export Blender Scene as OBJ…**. Choose where to save the model. The FBX export uses a global scale of `1.45329` and OBJ uses `0.68810`. Blender runs in the background. Set **Sea Power INI: Blender Path** if your Blender installation is outside the standard locations and PATH.

## FBX models

Open an FBX in VS Code for the 3D preview. The extension includes its own reader for older FBX exports and big-endian files. You can inspect the mesh hierarchy and copy submodels or colliders directly from an FBX 2009 export.

Run `pnpm run test:fbx` to check geometry, mesh lookup and hierarchy export against public Max and Maya files and other exporter samples. The first source build uses Python and pip to install Zig 0.13.0 in the build cache and compile the pinned ufbx reader. Installed editor packages include the compiled reader.

## Missing textures

In a 3D preview, **Missing texture** sets the color for a diffuse map that fails to load. Choose **Black**, **Magenta**, or **Grey** (default). The dropdown saves `seapowerIni.missingTextureColor` for the project folder and updates its open previews. With no project open, the choice lasts for that VS Code window.

## Export INI data

Right-click an OBJ, FBX or Blender model in Explorer or its preview and choose **Export INI Data…**. The panel starts with every object selected. Toggle **Meshes**, **Colliders** and **Transform helpers**, or change an object's export role. The planned INI updates as you edit. Copy it, open it in a new INI tab, or choose an existing INI to review and apply a diff. Applying leaves the edit open for saving or undo.

The exporter reads the model's collider overrides. Role changes in the export panel apply to that export. OBJ objects use model-space vertices and export at zero offset. FBX and Blender use local hierarchy positions.

**Rig preview** shows the parts and parent positions in the planned INI. Meshes are shaded, colliders are wireframe, and **Parent links** shows pivots and connections. Drag to orbit or scroll to zoom. Collapse **Rig preview** for more room to read the INI. The export panel remembers this choice.

## Mesh flags

Search Settings for `seapowerIni.meshFlags` and choose **Edit in settings.json**. Each flag has a label, a Codicon name and a list of literal `substrings` or regex `patterns`. The model and entity hierarchies show every match against the object or mesh name, ignoring case. Hover an icon to read its label.

For example, add `{ "label": "Flight deck", "icon": "tag", "substrings": ["flight_deck"], "patterns": ["_helipad[0-9]*$"] }` to the list. Set `"enabled": false` on any flag to hide it.

Hover a mesh in an OBJ, FBX or Blender preview and choose its pencil button to edit tags. Uncheck an inferred tag to disable it for that mesh, or select **Add custom tag…** to create one. Changing **Collider** also changes its preview category and its default role in FBX hierarchy export.

The first edit creates a sidecar beside the model. For example, `ship.obj`, `ship.fbx` and `ship.blend` in one folder share `ship.meshes.yaml`. Names are exact and case-sensitive. FBX and Blender use the geometry name first and the object name as a fallback. OBJ face groups can override the enclosing object. You can also edit the YAML directly. Remove an override to restore automatic detection.

```yaml
meshes:
  Hull:
    type: mesh
    add: [Painted]
    disable: [Damaged]
  BowVolume:
    type: collider
```

## Release

Merges to `main` never publish. Each one adds its notes under `## Unreleased` in `CHANGELOG.md` and leaves `version` in `package.json` alone. Pull requests are built and tested by **Build editor releases**.

A release is a deliberate snapshot, described step by step in [release-process.md](release-process.md). In short: one PR "Release x.y.z" turns `## Unreleased` into `## x.y.z - <date>` and sets `version` in `package.json`; after it is merged, push the tag `vx.y.z` on that commit. The tag starts **Publish editor releases**: it builds, checks that the tag matches `package.json`, creates the GitHub release with that CHANGELOG section as its notes and, when `PUBLISH_MARKETPLACE=true`, publishes to the VS Code Marketplace. A tag without a matching CHANGELOG section fails before anything is published.

Run **Publish editor releases** manually on `main` to check Marketplace authentication without releasing a version. The Trusted Publishing policy names `SEARATS/sp-ini` and `marketplace.yml`. [Microsoft's publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#publish-with-github-actions-and-trusted-publishing)

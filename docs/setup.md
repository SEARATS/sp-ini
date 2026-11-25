# Editor setup

Install the VSIX using **Extensions: Install from VSIX...**. To select the language for every INI in a mod workspace, add this to its settings:

```json
{ "files.associations": { "*.ini": "seapower-ini" } }
```

The extension finds the game through Steam. For a custom installation, set `seapowerIni.gameDirectory` to the folder containing `Sea Power_Data`. Add other mod folders to `seapowerIni.localModDirectories` and other Workshop `content/1286220` folders to `seapowerIni.workshopDirectories`. After updating external content, run **Sea Power INI: Rebuild Content Index**.

The VS Code FBX viewer opens binary and ASCII FBX models, including hierarchy transforms. Explicit FBX file paths in INIs open the model. Named mesh and collider definitions in OBJ files also support jumping to a source line.

## Build

With Node.js 22.13 or newer and pnpm, run `pnpm install --frozen-lockfile`, `pnpm test` and `pnpm run package`. Other LSP editors can run `node dist/server.js --stdio` with language ID `seapower-ini`. The PSPad download includes its setup instructions.

On Windows, run `./scripts/dev-window.ps1 <mod-folder>` from the checkout to test local changes. The development window reloads after each successful rebuild.

## Export a stock mesh

The optional exporter reads a local installation with Python 3.10+ and UnityPy 1.25.4. Run it with `uv run`, or install `UnityPy==1.25.4` in a Python environment and invoke the script with Python.

```powershell
uv run scripts/export_game_obj.py "C:\Program Files (x86)\Steam\steamapps\common\Sea Power" --mesh "usn_dd_spruance_vls*" --list
uv run scripts/export_game_obj.py "C:\Program Files (x86)\Steam\steamapps\common\Sea Power" --mesh usn_dd_spruance_vls --out "$env:TEMP\sp-ini-objects"
```

Each OBJ contains the mesh's geometry, normals and UVs where supplied. Materials and textures are separate game resources.

## Regenerate the feature screenshots

On Windows, install the project dependencies with `pnpm install --frozen-lockfile`. With VS Code's `code` command on PATH and either `uv` or Python with UnityPy 1.25.4, run:

```powershell
./scripts/screenshots.ps1 -OutputDirectory "$env:TEMP\sp-ini-feature-gallery"
```

Blender adds a screenshot of the same stock exterior in FBX format. Pass `-BlenderPath` if it is installed outside the default location.

Pass `-GameDirectory` for a different Steam library. The script opens an isolated VS Code window, exports selected stock Spruance VLS meshes and textures into a temporary workspace, and exercises the extension on a copy of the ship INI. It crops the rendered widgets and relevant source lines, then writes the PNGs, a Markdown gallery and `index.html` to the output folder.

## Release

Push a tag matching the version in `package.json`, for example `v0.3.0`. GitHub Actions tests the code and publishes the VSIX and the PSPad and Notepad++ ZIPs to GitHub Releases. With the repository variable `PUBLISH_MARKETPLACE=true`, it also publishes the same VSIX under the SEARATS Marketplace publisher.

Run **Publish editor releases** manually on `main` to check Marketplace authentication without releasing a version. The Trusted Publishing policy names `SEARATS/sp-ini` and `marketplace.yml`. [Microsoft's publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#publish-with-github-actions-and-trusted-publishing)

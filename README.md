# Sea Power INI

A VS Code extension and standalone language server for Sea Power's INI files. It reads the installed game's `Sea Power_Data/StreamingAssets/original` folder for vanilla definitions. It also indexes local mods, subscribed Steam Workshop items for app `1286220`, and INIs in the open workspace.

## Use in VS Code

Install the VSIX with **Extensions: Install from VSIX...**. Open a stock mission or Workshop INI and start typing. For a local source file, select **Sea Power INI** in the language picker. To use it for every INI in a mod workspace, add this to the workspace settings:

```json
{ "files.associations": { "*.ini": "seapower-ini" } }
```

- Type `[` for section names or press Ctrl+Space inside a section for keys observed in matching files. Hover over a key to see an example and its source.
- In a numbered mission unit section such as `[Taskforce1Vessel1]`, complete `Type=` with indexed unit IDs. F12 opens the definition. If several mods define the same ID, VS Code lists the matches.
- Complete file paths in `#!extend`, `#!prepend`, `#!alias` and `#!copy` directives. F12 opens the target. Within a mission, F12 on a `HomeBase` reference jumps to the named section.
- Use the Outline for sections and keys. The Problems panel reports malformed assignments and section headers, unmatched repeat blocks, and mission unit IDs missing from the index.

The index includes installed Workshop items regardless of their Mod Manager selection. For suggestions with the same spelling, it prefers workspace examples, then local mods, Workshop and vanilla. This order helps locate editable source files. The game decides runtime load order. Custom keys are welcome, and an unrecognized unit ID is informational.

## Content folders

The extension searches standard Steam locations and the libraries in `steamapps/libraryfolders.vdf`. For a custom install, set `seapowerIni.gameDirectory` to the folder containing `Sea Power_Data`. Extra local content roots go in `seapowerIni.localModDirectories`. Extra Workshop roots go in `seapowerIni.workshopDirectories`, with each root pointing to a `content/1286220` folder containing item directories.

Workspace INI changes trigger a rebuild. After installing or updating content outside the workspace, run **Sea Power INI: Rebuild Content Index**. The **Sea Power INI** output channel reports the file and unit counts.

## Build

Use Node.js 22.13 or newer and pnpm. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm run package
```

This creates `seapower-ini-0.1.0.vsix`. The package includes both the client and the server. Game and Workshop data stay on the user's machine.

## Other editors

Build with `pnpm run build`, then configure an LSP client to run:

```sh
node /path/to/seapower-ini/dist/server.js --stdio
```

Use language ID `seapower-ini`. Supply workspace folders through LSP initialization. The optional initialization fields `gameDirectory`, `localModDirectories`, and `workshopDirectories` accept the same paths as the VS Code settings.

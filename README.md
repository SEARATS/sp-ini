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
- Unit files get type checks for fields read by the vanilla loader. For example, `ArmorType=Heavyd` is an error and Ctrl+Space lists the four armor classes. Fields with a consistent number, boolean or vector format across multiple vanilla files get advisory checks. Duplicate keys and likely misspellings also appear in Problems.
- Use F12 on individual items in lists such as `AssociatedSensors` and `Views`, on system names, ammunition IDs, nation names, mission variants, or file paths. The server resolves models and materials through `[Models] ResourcesFolder`. It also links indexed texture files. F12 shows all matching definitions when multiple content packs supply a name.

The index includes installed Workshop items regardless of their Mod Manager selection. For suggestions with the same spelling, it prefers workspace examples, then local mods, Workshop and vanilla. This order helps locate editable source files. The game decides runtime load order. Custom keys are welcome, and an unrecognized unit ID is informational.

## Content folders

To browse source definitions safely, run **Sea Power INI: Enable Read-Only Reference Previews in Workspace**. F12 opens a reusable preview tab. VS Code protects INIs inside the vanilla and Workshop folders from edits, even when you double-click to keep a tab open. Your mod source stays editable. The command sets `files.readonlyInclude` for the discovered paths and enables preview tabs for code navigation throughout this workspace. Run it again after moving a Steam library.

The extension searches standard Steam locations and the libraries in `steamapps/libraryfolders.vdf`. For a custom install, set `seapowerIni.gameDirectory` to the folder containing `Sea Power_Data`. Extra local content roots go in `seapowerIni.localModDirectories`. Extra Workshop roots go in `seapowerIni.workshopDirectories`, with each root pointing to a `content/1286220` folder containing item directories.

Workspace INI changes trigger a rebuild. After installing or updating content outside the workspace, run **Sea Power INI: Rebuild Content Index**. The **Sea Power INI** output channel reports the file and unit counts.

## Build

Use Node.js 22.13 or newer and pnpm. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm run package
```

This creates `seapower-ini-0.3.0.vsix`. The package includes the client, the server and the PSPad tool. Game and Workshop data stay on the user's machine.

## PSPad

PSPad can check a saved INI and list definitions for the references on the cursor line. After building, select the INI highlighter under **Settings → Highlighter Settings → Compiler** and enter:

| Field | Value |
| --- | --- |
| Compiler | Full path to `node.exe` |
| Parameters | `"C:\path\to\seapower-ini\dist\pspad.js" "%File%" %Line%` |
| Capture Program Output Window | Enabled |
| LOG parser | `%F\|%L\|%C\|` |

Save the INI and run **Compile**. Double-click a definition or diagnostic in the log to open its file and line. The tool indexes the nearest enclosing mod folder with an `_info.ini`, plus the installed game and Workshop folders. You can pass an explicit mod folder as a final argument for source trees with another layout.

## Other editors

Build with `pnpm run build`, then configure an LSP client to run:

```sh
node /path/to/seapower-ini/dist/server.js --stdio
```

Use language ID `seapower-ini`. Supply workspace folders through LSP initialization. The optional initialization fields `gameDirectory`, `localModDirectories`, and `workshopDirectories` accept the same paths as the VS Code settings.

## Releases

Use the extension version in `package.json` for both editors. Once the version is committed on `main`, tag that commit and push the tag. For version 0.3.0:

```sh
git tag v0.3.0
git push origin v0.3.0
```

**Build editor releases** checks the tag, runs the tests and attaches two files to a draft GitHub release. The VSIX installs through **Extensions: Install from VSIX...**. The PSPad ZIP contains the bundled checker and setup instructions. Review the notes and click **Publish release** to make both downloads available. To test packaging without creating a tag or release, choose **Actions → Build editor releases → Run workflow** on `main`.

For automatic VS Code Marketplace updates, sign in to [Manage publishers](https://marketplace.visualstudio.com/manage) and create or select the publisher with ID `searats`. Under **Trusted Publishing**, create a policy for owner `SEARATS`, repository `seapower-ini`, workflow `marketplace.yml`, with the environment field empty. Set the GitHub repository Actions variable `PUBLISH_MARKETPLACE` to `true` before publishing the first stable GitHub release. Publishing that release triggers the Marketplace job, which uploads the same VSIX using OpenID Connect. [Microsoft's publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#publish-with-github-actions-and-trusted-publishing)

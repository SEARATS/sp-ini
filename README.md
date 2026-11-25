# Sea Power INI

Autocomplete, error checking and Go to Definition for Sea Power INI files. Reads units and systems from the game, your mod and installed Workshop items.

Press **Ctrl+Space** for keys and values. Press **F12** on a unit, sensor, weapon, model or file path to open its definition. **Problems** lists errors as you type.

Open an OBJ or FBX to see its 3D preview. Drag to rotate and scroll to zoom. To change the default, run **Reopen Editor With…** and choose **Configure default editor for '*.obj'…**. Enable `seapowerIni.obj.openSourceBeside` to see the source alongside the preview.

OBJ source opens with each object (`o`) collapsed. Click the arrow beside a name to expand it. Fold arrows also work for OBJ groups (`g`) and INI sections.

Ctrl+click an underlined mesh or mesh collider to open its OBJ declaration. Hover over the INI value or OBJ name to see the wireframe and, when UVs and a diffuse map are available, the textured mesh. Material hovers show a lit plane covering the full texture, followed by each texture. The swatch approximates lighting and supports PNG and JPEG textures.

Hover over a collider reference to see its shape. `ContainerBase` and numbered `Gun` references link to the unit's declared model parts.

Right-click an INI line and choose **Suppress Diagnostic on This Line** to append a comment such as `; sp-ini-ignore invalid-value`. **Comment or Uncomment INI Section** toggles the entire section, including its header.

Repeating a key in the same section gives a warning for the same value and an error for conflicting values.

Open a mod folder in VS Code and select **Sea Power INI** in the language picker. To protect game and Workshop files while browsing, run **Sea Power INI: Enable Read-Only Reference Previews in Workspace**.

[Downloads](https://github.com/SEARATS/sp-ini/releases) · [Editor setup](docs/setup.md) · [PSPad](pspad/README.txt) � [Notepad++](notepadpp/README.md)

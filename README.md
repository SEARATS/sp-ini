# Sea Power INI

[Downloads](https://github.com/SEARATS/sp-ini/releases) | [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=SEARATS.seapower-ini) | [Editor setup](https://github.com/SEARATS/sp-ini/blob/main/docs/setup.md) | [PSPad](https://github.com/SEARATS/sp-ini/blob/main/pspad/README.txt) | [Notepad++](https://github.com/SEARATS/sp-ini/blob/main/notepadpp/README.md)

Autocomplete, error checking and Go to Definition for Sea Power INI files. Reads units and systems from the game, your mod and installed Workshop items.

[![Wireframe and textured mesh][mesh-hover]][mesh-hover]

Press **Ctrl+Space** for keys and values. Press **F12** on a unit, sensor, weapon, model or file path to open its definition. **Problems** lists errors as you type.

Entity and scenario INIs open as text. Choose **Sea Power INI: Preview Entity** to see the assembled model beside the editor. In a scenario, use **Entity** to switch between units. Open a unit, `_variants.ini`, or `_squadrons.ini` and use **Variant** or **Squadron** to compare liveries and markings.

The preview uses the intact model, declared submodels, parent transforms, and diffuse textures. Enable **Colliders** to inspect collision shapes. **Preview notes** lists missing assets. The preview updates as you edit the open INI.

Hover over a mesh or collider in the viewport or hierarchy to see its name and source. Ctrl+click (⌘+click on macOS) opens its INI section. Sphere colliders use fewer triangles at smaller in-game sizes and keep the same detail as you zoom.

Open an OBJ or FBX to see its 3D preview. Drag to rotate and scroll to zoom. To change the default, run **Reopen Editor With…** and choose **Configure default editor for '*.obj'…**. Enable `seapowerIni.obj.openSourceBeside` to see the source alongside the preview.

OBJ source opens with each object (`o`) collapsed. Click the arrow beside a name to expand it. Fold arrows also work for OBJ groups (`g`) and INI sections.

Expand **Model hierarchy** in an FBX preview to check each object's parent. In an OBJ preview, **Objects and groups** shows group membership. OBJ files have no transform hierarchy.

A box icon marks likely colliders. Use the row checkboxes to show or hide parts. **Meshes** and **Colliders** filter the tree and the 3D view. Meshes start shaded and colliders start in wireframe. Each filter has its own render mode dropdown.

Ctrl+click an underlined mesh or mesh collider to open its OBJ declaration. Hover over the INI value or OBJ name to see the wireframe and, when UVs and a diffuse map are available, the textured mesh. Material hovers show a lit plane covering the full texture, followed by each texture. The swatch approximates lighting and supports PNG and JPEG textures.

The Windows x64 extension reads stock meshes and materials directly from your installed game. Loose overrides take priority. Mesh names containing `coll` anywhere (case-insensitive) or tagged `_col` appear orange in the OBJ viewer and rank first among matching mesh suggestions.

Right-click an FBX in the Explorer or its 3D preview and choose **Copy Hierarchy as INI** to copy submodels and colliders. For custom object roles, right-click a parent in **FBX hierarchy** and choose **Generate Submodels and Colliders…**. Review object roles, then apply the diff to an INI or copy the generated text to your clipboard.

Choose **Copy Colliders as INI** to copy just the mesh collider definitions. Right-click a tree row to limit the picker to that branch. The picker preselects likely colliders by object or mesh name. You can change the selection before copying. Each collider keeps its FBX parent and local position.

Hover over a collider reference to see its shape. `ContainerBase` and numbered `Gun` references link to the unit's declared model parts.

Right-click an INI line and choose **Suppress Diagnostic on This Line** to append a comment such as `; sp-ini-ignore invalid-value`. **Comment or Uncomment INI Section** toggles the entire section, including its header.

Repeating a key in the same section gives a warning for the same value and an error for conflicting values.

`Nation=` offers completion and Go to Definition for nation IDs such as `South_Africa` in indexed `nations.ini`, `layout.ini`, and `nations_reference.ini` files.

VS Code selects **Sea Power INI** for files inside a mod with an `_info.ini`, including mods nested in the open folder. For other folders, use the language picker. To protect game and Workshop files while browsing, run **Sea Power INI: Enable Read-Only Reference Previews in Workspace**.

## Screenshots

The examples use the stock Spruance VLS destroyer. Select a screenshot to view it at full size.

| INI editing | Diagnostics and quick fixes |
| --- | --- |
| Value completion<br>[![Value completion][completion]][completion] | Duplicate warning and conflicting-value error<br>[![Duplicate warning and conflicting-value error][duplicate-diagnostics]][duplicate-diagnostics] |
| Collapsed INI section<br>[![Collapsed INI section][ini-folding]][ini-folding] | Diagnostic quick fix<br>[![Diagnostic quick fix][quick-fix]][quick-fix] |
| Commented INI section<br>[![Commented INI section][section-toggle]][section-toggle] | Same-line diagnostic suppression<br>[![Same-line diagnostic suppression][inline-suppression]][inline-suppression] |

| Go to Definition | Reference files |
| --- | --- |
| Mesh and material links<br>[![Mesh and material links][mesh-links]][mesh-links] | Read-only stock reference<br>[![Read-only stock reference][read-only-reference]][read-only-reference] |
| Mount and barrel definitions<br>[![Mount and barrel definitions][model-part-links]][model-part-links] | Object preview in OBJ source<br>[![Object preview in OBJ source][obj-source-hover]][obj-source-hover] |

| Geometry | Materials and models |
| --- | --- |
| Mesh collider geometry<br>[![Mesh collider geometry][mesh-collider]][mesh-collider] | Lit material and texture maps<br>[![Lit material and texture maps][material-hover]][material-hover] |
| Box collider shape and dimensions<br>[![Box collider shape and dimensions][box-collider]][box-collider] | Spruance VLS in the 3D preview<br>[![Spruance VLS in the 3D preview][obj-preview]][obj-preview] |
| Collapsed OBJ objects<br>[![Collapsed OBJ objects][obj-folding]][obj-folding] | Spruance VLS in the FBX viewer<br>[![Spruance VLS in the FBX viewer][fbx-preview]][fbx-preview] |

[mesh-links]: https://raw.githubusercontent.com/SEARATS/binaries/7f281d9a58b1003a9c2528a4332b457e20e195e7/sp-ini/01-mesh-links.png
[mesh-hover]: https://raw.githubusercontent.com/SEARATS/binaries/7f281d9a58b1003a9c2528a4332b457e20e195e7/sp-ini/02-mesh-hover.png
[material-hover]: https://raw.githubusercontent.com/SEARATS/binaries/7f281d9a58b1003a9c2528a4332b457e20e195e7/sp-ini/03-material-hover.png
[mesh-collider]: https://raw.githubusercontent.com/SEARATS/binaries/7f281d9a58b1003a9c2528a4332b457e20e195e7/sp-ini/04-mesh-collider.png
[box-collider]: https://raw.githubusercontent.com/SEARATS/binaries/7f281d9a58b1003a9c2528a4332b457e20e195e7/sp-ini/05-box-collider.png
[model-part-links]: https://raw.githubusercontent.com/SEARATS/binaries/7f281d9a58b1003a9c2528a4332b457e20e195e7/sp-ini/06-model-part-links.png
[obj-source-hover]: https://raw.githubusercontent.com/SEARATS/binaries/7f281d9a58b1003a9c2528a4332b457e20e195e7/sp-ini/07-obj-source-hover.png
[obj-folding]: https://raw.githubusercontent.com/SEARATS/binaries/7f281d9a58b1003a9c2528a4332b457e20e195e7/sp-ini/08-obj-folding.png
[obj-preview]: https://raw.githubusercontent.com/SEARATS/binaries/7f281d9a58b1003a9c2528a4332b457e20e195e7/sp-ini/09-obj-preview.png
[ini-folding]: https://raw.githubusercontent.com/SEARATS/binaries/7f281d9a58b1003a9c2528a4332b457e20e195e7/sp-ini/10-ini-folding.png
[completion]: https://raw.githubusercontent.com/SEARATS/binaries/7f281d9a58b1003a9c2528a4332b457e20e195e7/sp-ini/11-completion.png
[duplicate-diagnostics]: https://raw.githubusercontent.com/SEARATS/binaries/7f281d9a58b1003a9c2528a4332b457e20e195e7/sp-ini/12-duplicate-diagnostics.png
[quick-fix]: https://raw.githubusercontent.com/SEARATS/binaries/7f281d9a58b1003a9c2528a4332b457e20e195e7/sp-ini/13-quick-fix.png
[inline-suppression]: https://raw.githubusercontent.com/SEARATS/binaries/7f281d9a58b1003a9c2528a4332b457e20e195e7/sp-ini/14-inline-suppression.png
[section-toggle]: https://raw.githubusercontent.com/SEARATS/binaries/7f281d9a58b1003a9c2528a4332b457e20e195e7/sp-ini/15-section-toggle.png
[read-only-reference]: https://raw.githubusercontent.com/SEARATS/binaries/7f281d9a58b1003a9c2528a4332b457e20e195e7/sp-ini/16-read-only-reference.png
[fbx-preview]: https://raw.githubusercontent.com/SEARATS/binaries/7f281d9a58b1003a9c2528a4332b457e20e195e7/sp-ini/17-fbx-preview.png

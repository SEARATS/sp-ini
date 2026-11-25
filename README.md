# Sea Power INI

[Downloads](https://github.com/SEARATS/sp-ini/releases) | [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=SEARATS.seapower-ini) | [Editor setup](https://github.com/SEARATS/sp-ini/blob/main/docs/setup.md) | [PSPad](https://github.com/SEARATS/sp-ini/blob/main/pspad/README.txt) | [Notepad++](https://github.com/SEARATS/sp-ini/blob/main/notepadpp/README.md)

Ctrl+click an underlined INI value to open its source. Hover over a mesh to see its wireframe and, when it has UVs and a diffuse map, its textured preview. Hover over a collider to see its shape or wireframe. Material tooltips show the full texture on a lit plane, followed by the individual texture maps.

[![Wireframe and textured mesh][mesh-hover]][mesh-hover]

## Visual previews

Click **Preview Entity** in the upper-right corner of the INI editor to open the selected unit beside its source. Hover over a mesh or collider in the preview to see where it comes from. Ctrl+click it to open its INI section.

Open an OBJ or FBX for a 3D preview. Use the tree to show or hide parts and switch between shaded and wireframe views. You can collapse branches in the FBX hierarchy and fold objects and groups in OBJ text view.

Mesh names containing `coll` or tagged `_col` are marked as likely colliders. Matching is case-insensitive.

## Export from FBX

Right-click an FBX in the Explorer or its 3D preview and choose **Copy Hierarchy as INI** to copy submodels and colliders. To set custom object roles, right-click a parent in the **FBX hierarchy** and choose **Generate Submodels and Colliders…**. Review the changes, then apply them to an INI or copy the generated text to your clipboard.

Choose **Copy Colliders as INI** to copy just the mesh collider definitions. Right-click a tree row to limit the picker to that branch. The picker preselects likely colliders by object or mesh name. You can change the selection before copying. Each collider keeps its FBX parent and local position.

## Error checking

The **Problems** panel lists INI issues. Repeating a key in the same section gives a warning when the values match and an error when they differ.

To suppress an issue, right-click its line in the INI editor and choose **Suppress Diagnostic on This Line**. This adds a comment to that line. To comment out or restore a whole section, including its header, right-click anywhere in it and choose **Comment or Uncomment INI Section**.

## Screenshots

The examples use the stock Spruance VLS destroyer. Select a screenshot to view it at full size.

| Entity preview | Go to INI section |
| --- | --- |
| Hover over an assembled mesh<br>[![Mesh tooltip on the Spruance][entity-mesh]][entity-mesh] | Ctrl+click a hierarchy row to open its repeat template<br>[![Repeated mesh and its INI template][hierarchy-definition]][hierarchy-definition] |
| Sphere colliders at different in-game sizes<br>[![Sphere wireframes and collider tooltip][sphere-colliders]][sphere-colliders] | Ctrl+click a collider to open its definition<br>[![Selected collider section beside the preview][preview-definition]][preview-definition] |

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

[mesh-links]: https://raw.githubusercontent.com/SEARATS/binaries/805eca8818285cc83fa79d1179ae11178758f3d7/sp-ini/01-mesh-links.png
[mesh-hover]: https://raw.githubusercontent.com/SEARATS/binaries/805eca8818285cc83fa79d1179ae11178758f3d7/sp-ini/02-mesh-hover.png
[material-hover]: https://raw.githubusercontent.com/SEARATS/binaries/805eca8818285cc83fa79d1179ae11178758f3d7/sp-ini/03-material-hover.png
[mesh-collider]: https://raw.githubusercontent.com/SEARATS/binaries/805eca8818285cc83fa79d1179ae11178758f3d7/sp-ini/04-mesh-collider.png
[box-collider]: https://raw.githubusercontent.com/SEARATS/binaries/805eca8818285cc83fa79d1179ae11178758f3d7/sp-ini/05-box-collider.png
[model-part-links]: https://raw.githubusercontent.com/SEARATS/binaries/805eca8818285cc83fa79d1179ae11178758f3d7/sp-ini/06-model-part-links.png
[obj-source-hover]: https://raw.githubusercontent.com/SEARATS/binaries/805eca8818285cc83fa79d1179ae11178758f3d7/sp-ini/07-obj-source-hover.png
[obj-folding]: https://raw.githubusercontent.com/SEARATS/binaries/805eca8818285cc83fa79d1179ae11178758f3d7/sp-ini/08-obj-folding.png
[obj-preview]: https://raw.githubusercontent.com/SEARATS/binaries/805eca8818285cc83fa79d1179ae11178758f3d7/sp-ini/09-obj-preview.png
[ini-folding]: https://raw.githubusercontent.com/SEARATS/binaries/805eca8818285cc83fa79d1179ae11178758f3d7/sp-ini/10-ini-folding.png
[completion]: https://raw.githubusercontent.com/SEARATS/binaries/805eca8818285cc83fa79d1179ae11178758f3d7/sp-ini/11-completion.png
[duplicate-diagnostics]: https://raw.githubusercontent.com/SEARATS/binaries/805eca8818285cc83fa79d1179ae11178758f3d7/sp-ini/12-duplicate-diagnostics.png
[quick-fix]: https://raw.githubusercontent.com/SEARATS/binaries/805eca8818285cc83fa79d1179ae11178758f3d7/sp-ini/13-quick-fix.png
[inline-suppression]: https://raw.githubusercontent.com/SEARATS/binaries/805eca8818285cc83fa79d1179ae11178758f3d7/sp-ini/14-inline-suppression.png
[section-toggle]: https://raw.githubusercontent.com/SEARATS/binaries/805eca8818285cc83fa79d1179ae11178758f3d7/sp-ini/15-section-toggle.png
[read-only-reference]: https://raw.githubusercontent.com/SEARATS/binaries/805eca8818285cc83fa79d1179ae11178758f3d7/sp-ini/16-read-only-reference.png
[fbx-preview]: https://raw.githubusercontent.com/SEARATS/binaries/805eca8818285cc83fa79d1179ae11178758f3d7/sp-ini/17-fbx-preview.png
[entity-mesh]: https://raw.githubusercontent.com/SEARATS/binaries/805eca8818285cc83fa79d1179ae11178758f3d7/sp-ini/18-entity-mesh-hover.png
[sphere-colliders]: https://raw.githubusercontent.com/SEARATS/binaries/805eca8818285cc83fa79d1179ae11178758f3d7/sp-ini/19-sphere-colliders.png
[preview-definition]: https://raw.githubusercontent.com/SEARATS/binaries/805eca8818285cc83fa79d1179ae11178758f3d7/sp-ini/20-preview-definition.png
[hierarchy-definition]: https://raw.githubusercontent.com/SEARATS/binaries/805eca8818285cc83fa79d1179ae11178758f3d7/sp-ini/21-hierarchy-definition.png

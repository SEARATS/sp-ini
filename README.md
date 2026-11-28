# Sea Power INI

[Downloads](https://github.com/SEARATS/sp-ini/releases) | [Changelog](CHANGELOG.md) | [How releases work](docs/release-process.md) | [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=SEARATS.seapower-ini) | [Editor setup](https://github.com/SEARATS/sp-ini/blob/main/docs/setup.md) | [PSPad](https://github.com/SEARATS/sp-ini/blob/main/pspad/README.txt) | [Notepad++](https://github.com/SEARATS/sp-ini/blob/main/notepadpp/README.md)

Ctrl+click an underlined INI value to open its source. 
Collider tooltips show its shape / wireframe. 
Mesh tooltips also show its textured preview. 
Material tooltips show the full texture on a lit plane, followed by the individual textures.

[![Wireframe and textured mesh][mesh-hover]][mesh-hover]

## Visual previews

Click **Preview Entity** in the upper-right corner of a unit INI to see the assembled model beside its source.

[![Spruance VLS with wireframe colliders and system arcs][entity-overview]][entity-overview]

Use the **Meshes**, **Colliders**, and **Objects** trees to show or hide parts. 
Tooltips list the colliders under your pointer. 
Ctrl+click a mesh or system to open its INI section. 
On a collider, Shift+click opens its definition. 

Firing and elevation arcs are displayed.

Use **Preview Unit Card** to see the unit's profile, specifications and equipment.

[![Spruance VLS unit reference card][unit-card]][unit-card]

OBJ and FBX files open in a 3D preview with shaded and wireframe views. 
Text view,  now allows you to fold FBX branches and OBJ objects or groups. 
Mesh names containing `coll` or tagged `_col` are marked as likely colliders.

## Export from FBX

Right-click an OBJ, FBX or Blend file and choose **Export INI Data…** to review object roles, the rig and the generated INI.

[![Export INI window with mesh tags, rig preview and planned INI][export-ini]][export-ini]

Add a **Box collider** or **Sphere collider** tag to fit a collider around a mesh. The mesh keeps its visual role.

[![Spruance deck and port propeller with their generated box and sphere colliders off and on][wrapped-colliders]][wrapped-colliders]

Right-click an FBX in the Explorer or its 3D preview and choose **Copy Hierarchy as INI** to copy submodels and colliders. 
To set custom object roles, right-click a parent in the **FBX hierarchy** and choose **Generate Submodels and Colliders…**.

Choose **Copy Colliders as INI** to copy just the mesh collider definitions. 
Right-click a tree row to limit the picker to that branch.

## Error checking

The **Problems** panel lists INI issues. 

Repeating a key in the same section gives a warning when the values match and an error when they differ.
Keys that are ingnored by seapower in specfic section. 

To suppress an issue, right-click its line in the INI editor and choose **Suppress Diagnostic on This Line**. This adds a comment to that line. 
To comment out or restore a whole section, including its header, right-click anywhere in it and choose **Comment or Uncomment INI Section**.

## Screenshots

The examples use the stock Spruance VLS destroyer. Select a screenshot to view it at full size.

| Entity preview | Go to INI section |
| --- | --- |
| Hover over an assembled mesh<br>[![Mesh tooltip on the Spruance][entity-mesh]][entity-mesh] | Ctrl+click a hierarchy row to open its repeat template<br>[![Repeated mesh and its INI template][hierarchy-definition]][hierarchy-definition] |
| Sphere colliders at different in-game sizes<br>[![Sphere wireframes and collider tooltip][sphere-colliders]][sphere-colliders] | Shift+click a collider to open its definition<br>[![Selected collider section beside the preview][preview-definition]][preview-definition] |
| Search radars in motion<br>[![Spruance VLS radar animation in the INI hierarchy preview][radar-animation]][radar-animation] | Follow a unit card link to its sensor and source INI<br>[![SPS-40 sensor reference][sensor-card]][sensor-card] |

| System markers | Collider highlights |
| --- | --- |
| Meshes, colliders and objects in the hierarchy<br>[![Spruance hierarchy and system markers][entity-trees]][entity-trees] | Hover over overlapping colliders<br>[![Highlighted colliders with the weapon system first in the tooltip][collider-highlight]][collider-highlight] |

| INI editing | Diagnostics and quick fixes |
| --- | --- |
| Value completion<br>[![Value completion][completion]][completion] | Duplicate warning and conflicting-value error<br>[![Duplicate warning and conflicting-value error][duplicate-diagnostics]][duplicate-diagnostics] |
| Collapsed INI section<br>[![Collapsed INI section][ini-folding]][ini-folding] | Diagnostic quick fix<br>[![Diagnostic quick fix][quick-fix]][quick-fix] |
| Commented INI section<br>[![Commented INI section][section-toggle]][section-toggle] | Same-line diagnostic suppression<br>[![Same-line diagnostic suppression][inline-suppression]][inline-suppression] |
| Units beside values in the stock Victor K2 INI<br>[![Inline units on the Victor K2][unit-hints]][unit-hints] | **Analyze INI Files… → Entire workspace** lists issues across files in Problems<br>[![Conflicting values in three stock aircraft INIs][workspace-analysis]][workspace-analysis] |

| Go to Definition | Reference files |
| --- | --- |
| Mesh and material links<br>[![Mesh and material links][mesh-links]][mesh-links] | Read-only stock reference<br>[![Read-only stock reference][read-only-reference]][read-only-reference] |
| Mount and barrel definitions<br>[![Mount and barrel definitions][model-part-links]][model-part-links] | Object preview in OBJ source<br>[![Object preview in OBJ source][obj-source-hover]][obj-source-hover] |

| Geometry | Materials and models |
| --- | --- |
| Mesh collider geometry<br>[![Mesh collider geometry][mesh-collider]][mesh-collider] | Lit material and texture maps<br>[![Lit material and texture maps][material-hover]][material-hover] |
| Mesh wireframe and textured hover<br>[![Mesh wireframe and textured preview][mesh-hover]][mesh-hover] | Open a Unity `.mat` to preview its lit surface and texture maps<br>[![Spruance VLS deck material with normal, diffuse and specular maps][unity-material]][unity-material] |
| Box collider shape and dimensions<br>[![Box collider shape and dimensions][box-collider]][box-collider] | Spruance VLS in the 3D preview<br>[![Spruance VLS in the 3D preview][obj-preview]][obj-preview] |
| Collapsed OBJ objects<br>[![Collapsed OBJ objects][obj-folding]][obj-folding] | Spruance VLS in the FBX viewer<br>[![Spruance VLS in the FBX viewer][fbx-preview]][fbx-preview] |

[radar-animation]: https://raw.githubusercontent.com/SEARATS/binaries/d8a8609151211bd93fe7750bcc68adbda2f5b8fb/sp-ini/33-radar-animation.gif
[mesh-links]: https://raw.githubusercontent.com/SEARATS/binaries/e91f936c5d8f2e3addd7dbca97da93c60213503a/sp-ini/01-mesh-links.png
[mesh-hover]: https://raw.githubusercontent.com/SEARATS/binaries/e91f936c5d8f2e3addd7dbca97da93c60213503a/sp-ini/02-mesh-hover.png
[material-hover]: https://raw.githubusercontent.com/SEARATS/binaries/e91f936c5d8f2e3addd7dbca97da93c60213503a/sp-ini/03-material-hover.png
[mesh-collider]: https://raw.githubusercontent.com/SEARATS/binaries/e91f936c5d8f2e3addd7dbca97da93c60213503a/sp-ini/04-mesh-collider.png
[box-collider]: https://raw.githubusercontent.com/SEARATS/binaries/e91f936c5d8f2e3addd7dbca97da93c60213503a/sp-ini/05-box-collider.png
[model-part-links]: https://raw.githubusercontent.com/SEARATS/binaries/e91f936c5d8f2e3addd7dbca97da93c60213503a/sp-ini/06-model-part-links.png
[obj-source-hover]: https://raw.githubusercontent.com/SEARATS/binaries/e91f936c5d8f2e3addd7dbca97da93c60213503a/sp-ini/07-obj-source-hover.png
[obj-folding]: https://raw.githubusercontent.com/SEARATS/binaries/e91f936c5d8f2e3addd7dbca97da93c60213503a/sp-ini/08-obj-folding.png
[obj-preview]: https://raw.githubusercontent.com/SEARATS/binaries/e91f936c5d8f2e3addd7dbca97da93c60213503a/sp-ini/09-obj-preview.png
[ini-folding]: https://raw.githubusercontent.com/SEARATS/binaries/e91f936c5d8f2e3addd7dbca97da93c60213503a/sp-ini/10-ini-folding.png
[completion]: https://raw.githubusercontent.com/SEARATS/binaries/e91f936c5d8f2e3addd7dbca97da93c60213503a/sp-ini/11-completion.png
[duplicate-diagnostics]: https://raw.githubusercontent.com/SEARATS/binaries/e91f936c5d8f2e3addd7dbca97da93c60213503a/sp-ini/12-duplicate-diagnostics.png
[quick-fix]: https://raw.githubusercontent.com/SEARATS/binaries/e91f936c5d8f2e3addd7dbca97da93c60213503a/sp-ini/13-quick-fix.png
[inline-suppression]: https://raw.githubusercontent.com/SEARATS/binaries/e91f936c5d8f2e3addd7dbca97da93c60213503a/sp-ini/14-inline-suppression.png
[section-toggle]: https://raw.githubusercontent.com/SEARATS/binaries/e91f936c5d8f2e3addd7dbca97da93c60213503a/sp-ini/15-section-toggle.png
[read-only-reference]: https://raw.githubusercontent.com/SEARATS/binaries/e91f936c5d8f2e3addd7dbca97da93c60213503a/sp-ini/16-read-only-reference.png
[fbx-preview]: https://raw.githubusercontent.com/SEARATS/binaries/e91f936c5d8f2e3addd7dbca97da93c60213503a/sp-ini/17-fbx-preview.png
[entity-mesh]: https://raw.githubusercontent.com/SEARATS/binaries/e91f936c5d8f2e3addd7dbca97da93c60213503a/sp-ini/18-entity-mesh-hover.png
[sphere-colliders]: https://raw.githubusercontent.com/SEARATS/binaries/c7fa4552f83481e42155c44ee9926fe21dc8ac26/sp-ini/19-sphere-colliders.png
[preview-definition]: https://raw.githubusercontent.com/SEARATS/binaries/e91f936c5d8f2e3addd7dbca97da93c60213503a/sp-ini/20-preview-definition.png
[hierarchy-definition]: https://raw.githubusercontent.com/SEARATS/binaries/e91f936c5d8f2e3addd7dbca97da93c60213503a/sp-ini/21-hierarchy-definition.png
[entity-trees]: https://raw.githubusercontent.com/SEARATS/binaries/8e825c667761c3d323d7b1facdc1870f76e1d300/sp-ini/22-entity-trees.png
[collider-highlight]: https://raw.githubusercontent.com/SEARATS/binaries/c7fa4552f83481e42155c44ee9926fe21dc8ac26/sp-ini/23-collider-highlight.png
[unit-card]: https://raw.githubusercontent.com/SEARATS/binaries/d3c7f1d94c0459cdf9137c0940ae3e925cf5837e/sp-ini/24-unit-card.png
[unit-hints]: https://raw.githubusercontent.com/SEARATS/binaries/9ba4ee59a3e5e838c6eccb9c7b9363c87011f765/sp-ini/28-unit-hints.png
[sensor-card]: https://raw.githubusercontent.com/SEARATS/binaries/d3c7f1d94c0459cdf9137c0940ae3e925cf5837e/sp-ini/27-sensor-card.png
[entity-overview]: https://raw.githubusercontent.com/SEARATS/binaries/8e825c667761c3d323d7b1facdc1870f76e1d300/sp-ini/26-entity-preview.png
[workspace-analysis]: https://raw.githubusercontent.com/SEARATS/binaries/e48f085259a2f17d6eeb9b465746c18ab0ef3c5e/sp-ini/31-workspace-analysis.png
[unity-material]: https://raw.githubusercontent.com/SEARATS/binaries/e48f085259a2f17d6eeb9b465746c18ab0ef3c5e/sp-ini/32-unity-material.png
[export-ini]: https://raw.githubusercontent.com/SEARATS/binaries/e48f085259a2f17d6eeb9b465746c18ab0ef3c5e/sp-ini/29-export-ini.png
[wrapped-colliders]: https://raw.githubusercontent.com/SEARATS/binaries/e48f085259a2f17d6eeb9b465746c18ab0ef3c5e/sp-ini/30-wrapped-colliders.png

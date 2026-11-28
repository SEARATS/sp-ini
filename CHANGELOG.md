# Changelog

## Unreleased

- Select a flight path or deck point to highlight its full route in the hierarchy and follow one aircraft cube. Selecting an elevator path highlights every connected launch and recovery branch. Clear the selection with Escape to see concurrent operations. Toggle the cubes with **Aircraft**. Each elevator set to **Animate** carries its aircraft during launch and recovery. Cubes use the carrier’s taxi speeds and the embarked aircraft’s performance when available.
- Flight-deck traffic shares taxi routes. Departing aircraft free the elevator as they clear it. Returning aircraft wait in the holding pattern for deck clearance.
- Unit hints abbreviate Unity units as `uu`.

- Flight-deck values show unit hints. Ctrl-click an elevator’s launch-point numbers to open their definitions. Static analysis checks flight-deck counts against numbered sections and deck-zone points.

- The INI preview draws meshes while textures load in the background. It caches unchanged assets across reloads and watches the model, material and texture files used by each open preview.
- Taxi, holding and approach paths use a darker blue than deck points.

- Recovery taxi paths continue down the elevator to `DespawnPosition`, or `SpawnPosition` when omitted. The descent follows the platform’s configured lowering animation.

- Toggle individual taxi, holding and approach paths in the hierarchy. Routes are visible from either side of the hull. Hover highlights flight points and paths ahead of the deck underneath. Clicking selects the first item in the tooltip.
- Expand **Elevators** to set each platform independently. Lifts with timed animations cycle by default and appear in blue. Choose a pose to park a lift or inspect a keyframe. Preview notes identify broken animation references.
- Launch and recovery squares rotate with the point’s `Rotation`. A tapered pointer marks the forward edge.
- The INI preview draws deck points as dark blue squares and connects taxi paths through their waypoints. Flight systems are blue, sensors yellow, and weapon arcs orange.
- Search radars and helicopter rotors turn in the INI hierarchy preview. Use **Animations** to pause them.
- The INI preview can filter system markers, colliders and arcs by weapons, flight, sensors or propulsion.

- The INI preview matches Sea Power's X orientation for loose OBJ mounts, including models that use `CORRECT_OBJ_ORIENTATION`.
- Model previews use daylight and authored OBJ normals. Assembled units cast shadows and respect `CastShadows=False`.
- Releases are deliberate: merges collect here, only a pushed `v*` tag publishes ([release-process.md](docs/release-process.md))
- Release notes come from this file instead of GitHub's generated list

## 0.9.31 - 2026-11-27

- INI export, fitted colliders and editor previews; earlier versions: [GitHub releases](https://github.com/SEARATS/sp-ini/releases)

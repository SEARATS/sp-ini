# Changelog

## Unreleased

- Toggle individual taxi, holding and approach paths in the hierarchy. Routes are visible from either side of the hull. Hover highlights flight points and paths ahead of the deck underneath. Clicking selects the first item in the tooltip.
- Expand **Elevators** to set each platform independently. Lifts with timed animations cycle by default and appear in blue. Choose a pose to park a lift or inspect a keyframe. Preview notes identify broken animation references.
- Launch and recovery squares rotate with the point’s `Rotation`. A short line marks the forward edge.
- The INI preview draws deck points as dark blue squares and connects taxi paths through their waypoints. Flight systems are blue, sensors yellow, and weapon arcs orange.
- Search radars and helicopter rotors turn in the INI hierarchy preview. Use **Animations** to pause them.
- The INI preview can filter system markers, colliders and arcs by weapons, flight, sensors or propulsion.

- The INI preview matches Sea Power's X orientation for loose OBJ mounts, including models that use `CORRECT_OBJ_ORIENTATION`.
- Model previews use daylight and authored OBJ normals. Assembled units cast shadows and respect `CastShadows=False`.
- Releases are deliberate: merges collect here, only a pushed `v*` tag publishes ([release-process.md](docs/release-process.md))
- Release notes come from this file instead of GitHub's generated list

## 0.9.31 - 2026-11-27

- INI export, fitted colliders and editor previews; earlier versions: [GitHub releases](https://github.com/SEARATS/sp-ini/releases)

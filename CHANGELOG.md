# Changelog

## Unreleased

- Deck taxi paths and airborne holding and approach paths have separate visibility controls. Paths are dark blue. Taxi routes meet raised elevators, and deck points take priority when picking overlapping objects.
- The INI preview draws deck points as dark blue squares and connects taxi paths through their waypoints. Flight systems are blue, sensors yellow, and weapon arcs orange.
- Search radars and helicopter rotors turn in the INI hierarchy preview. Use **Animations** to pause them.
- The INI preview can filter system markers, colliders and arcs by weapons, flight, sensors or propulsion.

- The INI preview matches Sea Power's X orientation for loose OBJ mounts, including models that use `CORRECT_OBJ_ORIENTATION`.
- Model previews use daylight and authored OBJ normals. Assembled units cast shadows and respect `CastShadows=False`.
- Releases are deliberate: merges collect here, only a pushed `v*` tag publishes ([release-process.md](docs/release-process.md))
- Release notes come from this file instead of GitHub's generated list

## 0.9.31 - 2026-11-27

- INI export, fitted colliders and editor previews; earlier versions: [GitHub releases](https://github.com/SEARATS/sp-ini/releases)

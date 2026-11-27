# Releases: merge often, release on purpose

The same process as [Keel](https://github.com/SEARATS/RatsSeaPowerKeel/blob/main/docs/community/releases.md) and Flotilla in the SEARATS org. Merging only collects work; a release is a snapshot we choose to make.

## Every merge

- Merge into `main` as often as needed. Nothing is published.
- Each PR adds its bullets under `## Unreleased` at the top of [CHANGELOG.md](../CHANGELOG.md).
- No version bump in a PR: `version` in `package.json` stays at the last release.
- **Build editor releases** builds and tests every PR.

## Release day

One release owner runs it, start to finish.

| # | Step | What |
|---|---|---|
| 1 | Decide | "Today we release", who owns it, the number (table below) |
| 2 | Snapshot | PR "Release x.y.z": `## Unreleased` becomes `## x.y.z - <date>`, `version` in `package.json` set, a fresh empty `## Unreleased` above it; merge it |
| 3 | Tag | `git tag vx.y.z <merge commit>` and `git push origin vx.y.z` |
| 4 | Build + publish | the tag starts **Publish editor releases**: build and tests, tag must match `package.json`, GitHub release with the CHANGELOG section as notes, Marketplace when `PUBLISH_MARKETPLACE=true` |
| 5 | Virus scan | the release's `stock-reader.exe` and other program files through VirusTotal; a flagged file is pulled and fixed before anyone is pointed at it |
| 6 | Tell people | the release owner posts (Discord, wherever the users are) |

A tag whose version has no `## x.y.z` section in the CHANGELOG fails before anything is published.

## Which number

| Bump | When |
|---|---|
| x.y.**z+1** | only fixes |
| x.**y+1**.0 | new features |
| **x+1**.0.0 | breaks something for users (settings, file formats, editor support dropped) |

## Never

- Bump `version` in a normal PR.
- Publish from anything but a release tag.
- Skip the virus scan on release day.

# Releases: merge often, release on purpose (proposal)

Proposal to use the same release process as Keel and Flotilla ([Keel's releases.md](https://github.com/SEARATS/RatsSeaPowerKeel/blob/main/docs/community/releases.md), with a diagram). Nothing here is decided: change it or close the PR if it does not fit this repo.

## Every merge

- Merge into `main` as often as needed; nothing ships.
- Each PR adds its bullets under `## Unreleased` at the top of a `CHANGELOG.md`.
- No version bump in a PR: the version stays at the last release.

## Release day

One release owner runs it, start to finish.

| # | Step | What |
|---|---|---|
| 1 | Decide | "Today we release", who owns it, the number (x.y.z+1 fixes, x.y+1.0 features, x+1.0.0 breaking) |
| 2 | Snapshot | `## Unreleased` becomes `## x.y.z - <date>`; version set; PR "Release x.y.z"; tag `vx.y.z` |
| 3 | Build + checks from the tag | build, tests, virus scan of the program files (VirusTotal) |
| 4 | Notes once | from the CHANGELOG bullets: GitHub release and any post |
| 5 | Ship | the release workflow builds and publishes from the tag (Marketplace / Open VSX and the GitHub release) |
| 6 | After | `main` gets a fresh empty `## Unreleased` |

## What would change here

- Today `marketplace.yml` publishes after 60 quiet minutes on `main`, so every burst of merges becomes a release.
- With this process it would publish only from a `v*` tag or a manual run (`workflow_dispatch`); the quiet-period job on `main` would go.
- No workflow is changed in this PR: only the proposal.

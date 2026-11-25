# Editor setup

Install the VSIX using **Extensions: Install from VSIX...**. To select the language for every INI in a mod workspace, add this to its settings:

```json
{ "files.associations": { "*.ini": "seapower-ini" } }
```

The extension finds the game through Steam. For a custom installation, set `seapowerIni.gameDirectory` to the folder containing `Sea Power_Data`. Add other mod folders to `seapowerIni.localModDirectories` and other Workshop `content/1286220` folders to `seapowerIni.workshopDirectories`. After updating external content, run **Sea Power INI: Rebuild Content Index**.

## Build

With Node.js 22.13 or newer and pnpm, run `pnpm install --frozen-lockfile`, `pnpm test` and `pnpm run package`. Other LSP editors can run `node dist/server.js --stdio` with language ID `seapower-ini`. The PSPad download includes its setup instructions.

## Release

Push a tag matching the version in `package.json`, for example `v0.3.0`. GitHub Actions tests the code and publishes the VSIX and PSPad ZIP to GitHub Releases. With the repository variable `PUBLISH_MARKETPLACE=true`, it also publishes the same VSIX under the SEARATS Marketplace publisher.

Run **Publish editor releases** manually on `main` to check Marketplace authentication without releasing a version. The Trusted Publishing policy names `SEARATS/seapower-ini` and `marketplace.yml`. [Microsoft's publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#publish-with-github-actions-and-trusted-publishing)

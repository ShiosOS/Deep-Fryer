# Develop Deep Fryer on Windows

## Start the app

Use Windows x64, Git, Node.js 24, and npm. CI uses Node.js 24. The build tools require Node.js 22.12 or newer. The installed release includes its own runtime.

```powershell
git clone https://github.com/ShiosOS/Deep-Fryer.git
cd Deep-Fryer
npm ci
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm run dev
```

The last command opens Electron with the development renderer. `ELECTRON_RUN_AS_NODE` must be unset for Electron to launch the app. Stop the development process with `Ctrl+C` when finished.

## Check a change

Run these commands from the repository root:

```powershell
npm run docs:check
npm run typecheck
npm test
npm run build
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm run test:e2e
```

The documentation checker validates local Markdown links, image paths, full and collapsed reference links, and ATX heading anchors. It reports missing targets with their file and line. To check external HTTP links as well, run `node scripts/check-doc-links.mjs --remote`. External checks need network access and can fail because of server rate limits. Remote URL fragments are not validated.

The checker also supports autolinks and HTML `href` and `src` attributes. It ignores fenced code blocks and inline code. It is not a full Markdown renderer. To check specific files, pass their paths after the script name, for example `node scripts/check-doc-links.mjs README.md SUPPORT.md`.

Electron tests use real IPC, image decoding, rendering, history, recovery, and filesystem operations. Most journeys stub native file selection. A passing source run does not establish installer, installed-offline, native-dialog, or upgrade behavior. See [verification](verification.md).

## Build the Windows installer

```powershell
npm run package:win
node scripts/verify-package.mjs
Get-ChildItem -LiteralPath release -Filter '*.exe'
```

`package:win` builds the app and runs `electron-builder --win nsis --publish never`. The command creates a local installer under `release` and disables publishing for that invocation. It does not create a GitHub release. Without a configured signing identity, the installer is unsigned.

The package verifier checks bundled help media, runtime icons, and executable icon pixels against the source icon. Local build hashes can differ from the published release. Use the published checksum only for the exact downloaded release asset.

## Refresh product screenshots

Use the [verification skill](../.agents/skills/verify/SKILL.md) to capture the real Electron app with a disposable profile. Keep the build log with a fresh capture directory:

```powershell
New-Item -ItemType Directory -Force .artifacts | Out-Null
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Remove-Item Env:DEEP_FRYER_EXECUTABLE -ErrorAction SilentlyContinue
Remove-Item Env:ELECTRON_EXECUTABLE_PATH -ErrorAction SilentlyContinue
$env:ELECTRON_RENDERER_URL = ''
npm run build *> .artifacts/product-readme-NEW.build.log
if ($LASTEXITCODE -ne 0) { throw 'Build failed. Read the build log.' }
node scripts/capture-product.mjs --output .artifacts/product-readme-NEW
if ($LASTEXITCODE -ne 0) { throw 'Capture failed. Read its manifest.' }
```

Make no source changes between build and capture. Keep the build log with the capture evidence, outside the disposable profile. For an existing package, follow the skill's packaged launch and retain its build provenance and executable hash.

Require `passed: true`, no errors, confirmed process exit, and profile removal in `manifest.json`. Inspect the PNGs before copying selected files into `docs/images`. The helper captures Look, Effects, and editable Captions in both themes at normal and minimum window sizes. It also captures the original and Crispy color canvases side by side before captions are added.

Label README screenshots with the captured source version while that version is unpublished. Keep download links and checksums tied to the published release. This helper intercepts Open and leaves the clipboard untouched; it does not verify installation, offline operation, or native file dialogs.

## Update help media

```powershell
npm run build
npm run assets:render
npm run assets:capture
npm run build
```

`assets:render` uses the production engine to create effect examples and records their parameters and SHA-256 hashes in the [manifest](../src/renderer/src/assets/help/manifest.json). It also rasterizes the approved SVG into runtime PNG and multiresolution Windows ICO files. `assets:capture` captures the implemented Electron editor and point overlay. Inspect the resulting images before committing them. Rebuild to include changed assets in the app.

The [architecture guide](architecture.md) describes ownership. The [contribution guide](../CONTRIBUTING.md) describes change scope and evidence.

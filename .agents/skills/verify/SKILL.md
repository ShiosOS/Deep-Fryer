---
name: verify
description: Drive and capture the real Deep Fryer Electron desktop app after editor changes, with disposable profiles and explicit native, packaged, and offline evidence limits.
---

# Verify Deep Fryer

Run from the repository root on Windows. Use the built Electron application, not a browser preview. Read the [feature index](features/README.md), then the map for the behavior being checked.

## Launch

Use Node 24 and the lockfile's dependencies. `npm.cmd ci` installs them in a normal checkout. In a prepared worktree, reuse an existing `node_modules` junction only after confirming its target and dependency versions. Do not reinstall through a shared junction.

```powershell
git status --short
git rev-parse HEAD
node --version
node -p "require('@playwright/test/package.json').version"
node -p "require('electron/package.json').version"
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Remove-Item Env:DEEP_FRYER_EXECUTABLE -ErrorAction SilentlyContinue
Remove-Item Env:ELECTRON_EXECUTABLE_PATH -ErrorAction SilentlyContinue
$env:ELECTRON_RENDERER_URL = ''
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
node scripts/capture-product.mjs
if ($LASTEXITCODE -ne 0) { throw 'Capture failed. Read its manifest.' }
```

The helper prints the manifest path. It creates a fresh temporary `deep-fryer-product-*` profile and uses `--user-data-dir`; it never attaches to a running personal instance. Usable means the empty heading is visible, Export is disabled, then loading the image enables Export. The helper exercises the import map through **Choose an image**, selects **Crispy color**, sets **Noise pattern** to `3328622589` for repeatable pixels, and captures light, dark, minimum window, and export panel states.

## Doctor

The helper's read-only `app.evaluate` receipt records actual PID, version, `app.isPackaged`, user-data path, and renderer URL. It requires the exact disposable profile, expected packaged mode, and a `file:` renderer. The manifest records HEAD, working-tree status, and a hash of the tracked diff. A dirty capture is evidence for those local edits, not the committed revision alone. When a run looks wrong, inspect `manifest.json` and `electron-stderr.log` first. Require `errors: []` and `passed: true`. Record the tested HEAD separately from any later commit.

Minimum size is the BrowserWindow outer size, currently 900 × 620. On Windows at 100% scaling its captured content is 884 × 581. The manifest records both sizes and device scale; it validates every screenshot's decoded PNG dimensions against the real content viewport.

## Drive

For an existing feature journey, use its map's exact Playwright command. For a narrow import proof:

```powershell
node node_modules/@playwright/test/cli.js test editor.spec.ts --grep 'open, cancel' --workers=1 --output .artifacts/import-proof/test-results
if ($LASTEXITCODE -ne 0) { throw 'Import journey failed.' }
```

Existing specs create disposable profiles and fixtures. They launch `out/main/index.js` through the repository's package entrypoint and intercept native chooser results. Their pixel/file assertions still exercise renderer, preload, main IPC, and disk writes. Inspect the chosen spec before running a broad suite. Keep native clipboard tests on disposable Windows CI; never set `CI=true` locally to enable them. Local copy tests intercept the final `clipboard.write`; local paste tests intercept `clipboard.read`. The capture helper never invokes either clipboard action.

For new drive steps, use `tests/e2e/ui.ts` helpers `fileAction`, `controls`, `ready`, and `openOutput`. Await Export enabled after each render-triggering action. Await `ready` before enumerating replacement effect cards. Use accessible names from the map, not internal application setters. For ad hoc scripts, copy the disposable launch and `finally` teardown from `scripts/capture-product.mjs`.

## Evidence

Use a new output directory per run:

```powershell
node scripts/capture-product.mjs --output .artifacts/product-after-integration
```

An existing destination is rejected before launch, so choose another name on reruns. The helper prefers `src/renderer/src/assets/demo/toast-cat.png` when available, otherwise it reads the existing cat photograph `assets/help/source.jpg`. It clicks the named **Crispy color** button when present and falls back to the released 0.4.0 Preset select. Filename checks allow an unsaved marker. The helper writes six viewport screenshots, `before.png`, `after.png`, `before-after.png`, `electron-stderr.log`, and `manifest.json`. The before/after files are full-resolution canvas observations, not exported files. The comparison places Original on the left and Crispy color on the right. Changed pixel hashes prove a real preset render. The input image hash must remain unchanged. Existing help assets are inputs only; keep `assets:capture` and `assets:render` out of verification because they regenerate shipped assets.

For feature proofs, retain the exact command, exit code, source/head identity, screenshots, Playwright output, and any file/pixel assertions. Existing specs reuse some `.artifacts` filenames; copy those receipts into the run directory before another journey overwrites them. Expected injected errors in fault specs are distinct from unexpected runtime errors. Raw Electron stderr remains reviewable even when renderer error checks pass.

## Cleanup

The helper closes its own Electron application, confirms the launcher and recorded Electron process PIDs exited, removes only its fresh profile, and writes teardown results to the persistent manifest. Evidence lives outside the temporary profile and survives cleanup. A failed close fails the run. A surviving process leaves the profile intact for diagnosis; inspect the recorded PIDs before cleaning it manually. Never kill by executable name.

Only during teardown, the helper intercepts native message boxes whose buttons contain **Discard**, **Discard changes**, or **Don't save**, choosing that explicit button. Unknown prompts fail. This handles the unsaved-close guard for its disposable edit. It does not verify the guard's UX or prove that a prompt occurred. Teardown failure still produces a manifest; retain failed receipts.

## Packaged and native gates

To run the same capture against an already-built unpacked or installed application:

```powershell
$env:DEEP_FRYER_EXECUTABLE = (Resolve-Path 'release/win-unpacked/Deep Fryer.exe').Path
try {
  node scripts/capture-product.mjs --output .artifacts/product-packaged
  if ($LASTEXITCODE -ne 0) { throw 'Packaged capture failed.' }
} finally { Remove-Item Env:DEEP_FRYER_EXECUTABLE -ErrorAction SilentlyContinue }
```

Supply an actual app executable, not the NSIS installer. Packaged mode omits the repository launch argument and still uses a disposable profile. Packaged capture retains the open-chooser interception and does not enforce offline operation.

Treat these as separate gates in every report:

- Built desktop: local feature specs and capture helper.
- Packaged desktop: actual executable path, version, hash, and run receipt. `scripts/verify-package.mjs` checks package contents/icon only.
- Installed offline: `.github/workflows/windows.yml` job `installed-offline` installs into runner temp and enforces a per-program outbound firewall block. Local capture is not this proof.
- Native clipboard: CI-only journeys in `copy-image.spec.ts` and `documents.spec.ts` write/read the actual Windows clipboard on disposable runners. Local intercepted bytes do not prove native clipboard behavior.
- Native chooser: existing `scripts/verify-native-dialog.mjs` drives a real Windows Save chooser but intercepts Open. Review its selectors against current UI before invoking it; this capture does not exercise a native chooser.
- Upgrade: workflow job `package-upgrade` verifies previous/candidate/return phases. Source and unpacked runs do not prove install or upgrade behavior.

## Helpers

`scripts/capture-product.mjs` is the repeatable capture and cleanup helper. It accepts only optional `--output NEW_DIRECTORY`, `DEEP_FRYER_EXECUTABLE` for packaged apps, and `ELECTRON_EXECUTABLE_PATH` for an alternate development Electron binary. UI integration requires rebuilding and a new capture run. Use `/maintain-verification-skill` when journeys change, or update the matching map and rerun its commands directly.

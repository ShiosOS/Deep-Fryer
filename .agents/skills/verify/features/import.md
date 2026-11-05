# Import images

Open a PNG or JPEG and retain the current edit when a replacement is canceled or rejected.

## Sub-features

- I1: Empty state, PNG/JPEG decoding, orientation, and full-resolution preview.
- I2: Canceled, corrupt, and oversized replacement preserves the current image.
- I3: Paste and file drop create an editable source.
- I4: Export refuses existing source paths and hard-link aliases.

## How to get to it (user POV)

Use **Choose an image** from the empty state, **File → Open image**, or Ctrl+O. Paste with **File → Paste image** or Ctrl+V. Drop an image file onto the application. Export protection is reached through **Export → Save image…**.

## Driving it with Playwright Electron

Preconditions: Build and clear launch overrides as described in the skill. Fixtures and profiles come from each spec.

- I1 through empty-state entry: `node scripts/capture-product.mjs --output .artifacts/import-cat` clicks `getByRole('button', { name: 'Choose an image', exact: true })`. Require `.filename` to contain the selected source basename recorded in the manifest, Export enabled, changed preset pixel hashes, unchanged source hash, and successful teardown.
- I1, I2, I4 through keyboard/menu: `node node_modules/@playwright/test/cli.js test editor.spec.ts --grep 'open, cancel' --output .artifacts/import/test-results`. The journey opens with Ctrl+O, retries through `fileAction(page, 'Open image')`, checks retained filename/error states, rejects source/alias overwrite, and decodes saved PNGs including EXIF-oriented JPEG output.
- I3 with intercepted clipboard: `node node_modules/@playwright/test/cli.js test documents.spec.ts --grep 'paste uses stubbed' --output .artifacts/import-paste/test-results`. The spec replaces Electron `clipboard.read`, uses `fileAction(page, 'Paste image')`, and performs a Chromium file drop through the real file-path bridge. Require the resulting filenames, edited canvas pixels, and unchanged source bytes.
- I1 via keyboard traversal: `node node_modules/@playwright/test/cli.js test keyboard.spec.ts --output .artifacts/import-keyboard/test-results` drives Ctrl+O and subsequent keyboard-only editing/export. Retain its final file/pixel assertions.

## Gotchas

The capture intercepts only `dialog.showOpenDialog` during the journey. It proves file loading, not the native chooser. The editor journey also intercepts Save selection but writes real files. The local paste spec substitutes read contents; native paste remains the CI-only test `a disposable CI machine pastes an actual Windows clipboard image without stubbing Electron`. Capture does not paste or copy. Paste shortcut coverage is a separate entry point from menu paste and must be reported accordingly.

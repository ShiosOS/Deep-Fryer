# Inspect and output

Inspect the image at full resolution, save the requested format and dimensions, or copy the full edited PNG independently of export settings.

## Sub-features

- O1: Fit, 100%, zoom, pan, Original/Edited comparison, and resize stability.
- O2: PNG/JPEG/WebP dimensions, quality, transparency background, inspected bytes, and stale output.
- O3: Frozen delayed saves and honest cancellation.
- O4: Copy image button/shortcut, acknowledgement, duplicate blocking, and byte validation.
- O5: Caption composition in every output path. Use [caption journeys](captions.md) for exact bytes/pixels, transparency, orientation, scaling, and caption-stale inspection.

## How to get to it (user POV)

Use the image toolbar's **Fit**, **100%**, **Zoom in/out**, **Original**, and **Edited**. Drag the preview to pan; focus it for arrow keys and zoom keys. Open **Export** or Ctrl+Shift+S, set format/size, then **Inspect final output**, **Save inspected snapshot**, or **Save image…**. Use **Copy image** or Ctrl+Shift+C for a full-size edited PNG.

## Driving it with Playwright Electron

Preconditions: Build and select the intended executable. All local copy specs below install a final-writer interception before copying.

- O1: `node node_modules/@playwright/test/cli.js test inspection.spec.ts --output .artifacts/inspect/test-results`. Require stable transforms through comparison/resize, 1:1 small-image dimensions, sampled Original/Edited pixels, and full Edited export while Original is displayed. It retains `.artifacts/inspection-*.png`.
- O2/O3: `node node_modules/@playwright/test/cli.js test output.spec.ts --output .artifacts/output/test-results`. It drives **Output format**, **Output width/height**, **Output quality**, and **JPEG output background**. Require `Decoded final output at 100 percent` dimensions and exact saved encoded bytes, stale-inspection blocking, frozen delayed save, and no success notice after cancellation.
- O4 pixels: `node node_modules/@playwright/test/cli.js test copy-image.spec.ts --grep 'button and shortcut' --output .artifacts/copy/test-results`. It replaces `clipboard.write` with a byte capture. Require decoded full-size PNG pixels including alpha/orientation, independent export drafts, unchanged history/recovery/source, and the `Image copied` acknowledgement. Preserve `.artifacts/copy-image/` receipts.
- O4 failure boundaries: `node node_modules/@playwright/test/cli.js test copy-image.spec.ts --grep 'deferred Help|copy waits|main rejects|pending preview' --output .artifacts/copy-failures/test-results`. Require input focus preserved across deferred modal close, acknowledgement ordering, guarded shortcuts, retry, rejected invalid senders/bytes, and no late write after teardown.
- O2 panel capture: `node scripts/capture-product.mjs --output .artifacts/export-panel` captures the real Export dialog with the cat's full image dimensions. It closes the panel without saving or copying.

## Gotchas

The helper's before/after canvas PNGs are observations, not proof of the Save path. Output specs intercept the native Save chooser and then write actual files. Copy interception proves submitted bytes and acknowledgement behavior only. Native `clipboard.write`/read/decode runs exclusively in the disposable Windows CI test; never enable it on a personal machine. Preview scaling and Original comparison do not select export/copy pixels. Source preservation and exact saved bytes matter more than a success screenshot.

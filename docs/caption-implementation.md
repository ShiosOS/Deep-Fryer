# Caption implementation decisions

The bounded feature adds editable top and bottom meme captions without another app. Crop, ordinary overwrite saving, and a layer editor are outside this change.

## Ownership and design

The renderer owns the image, history, document baseline, and asynchronous revision acceptance. Main validates IPC, reads embedded image bytes, writes files exclusively, and owns two recovery generations. Output freezes settings before decoding or encoding. These boundaries protect original sources and keep delayed output independent of later editing.

`Preset` remains a reusable image treatment. `EditState { preset, composition: { captions } }` owns every editable value. One history snapshots complete edits; document save and recovery use those same snapshots. `renderEdit(pixels, edit, frame)` applies effects then captions. A null composition bypasses font work and keeps the old pixel path. Font or layout failures affect render readiness, never the validity or retention of text.

The considered alternative was a caption effect in the ordered preset stack. That would put words in reusable presets and require special rules around named looks, randomization, and effect order. Separate composition gives those operations one stable boundary: replace only the preset.

## UI comparison

Before production UI, two throwaway controls were inserted into the real base editor. Screenshots are in `.artifacts/caption-base/stacked.png` and `tabbed.png`, with the untouched editor in `actual-editor.png`. BrowserWindow outer size was 900 by 620; actual content was 884 by 581. Stacked fields keep both captions visible and editable together. Tabs save vertical space but hide text. The implementation uses stacked fields, a caption disclosure, and a collapsed size control within the existing 272-pixel sidebar.

## Work sequence and limits

The throughput checkpoint is one owner and five verifiable units: immutable compatibility capture; complete edit/storage migration; bounded font renderer; UI/output integration; desktop and package evidence plus docs. The migration is the serial bottleneck because every document caller must adopt the complete state together. No children or independent review run here, as requested. Coordinator review remains separate from implementation checks.

The initial capture generated its files and screenshots, then failed because `app.process()` was called after Playwright had closed the connection (`TypeError: Cannot read properties of undefined (reading '_object')`). No Electron process remained. The helper now retains its process handle before closure. Historical captures were not regenerated.

Base verification passed: one fixture hash/unit test and one Electron legacy journey covering all three fixture sets and both project and preset flows. The capture's disposable profile remains at `C:/Users/emofo/AppData/Local/Temp/deep-fryer-caption-base-UaCtm3`; automatic command review rejected its cleanup command. No application process remains attached to it.

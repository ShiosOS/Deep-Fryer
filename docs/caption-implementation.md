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

## Delivered commits

Base: `e2276f3109077299c94698f2f87747a8901c322d`. Branch: `feat/top-bottom-captions` in the isolated `t3-7240051f` worktree. Apply these in order after resolving the ordinary Save integration described below:

1. `427bde26abd1fda059597534a92e84433984b535` — immutable v2 project, preset, source, reference RGBA, frozen reader, and actual-window prototype capture.
2. `0a67a02231ce6128bd37d6e4d6f19f26200734cc` — complete EditState ownership in history, baseline, recovery, output, IPC, and explicit project v3; preset files remain v2.
3. `8342232e6eea09065ca8377f2aedfbf13515f449` — bundled font, bounded layout, caption controls, error retention, tests, Help, and product documentation.

The following report-only commit records verification and merge guidance. No ordinary file-target saving was implemented or imported. No crop, installation, push, PR, child agent, personal clipboard write, root checkout edit, audit score/log edit, or final README screenshot refresh was performed.

## Final behavior and bounds

Each field stores at most 512 UTF-16 units. The requested size is 4–16% of the shorter output edge; bounded autofit can reduce it to 2.5%. Each caption occupies at most three rendered lines within its own 30% top or bottom band. Layout uses normalized coordinates, a 3.5% margin, word wrapping, then grapheme wrapping for long words. Case and explicit newlines are preserved. Rendering normalizes canonical Unicode equivalents and line endings; the saved text remains unchanged. Two whitespace-only fields canonicalize to null.

The unmodified official Anton font is pinned to Google Fonts commit `cee74d7ca45d66d5c1878c828645c862f2788d2d`. The checked [provenance](../src/renderer/src/assets/fonts/provenance.json) contains URLs and SHA-256 values for the TTF, metadata, and complete OFL. The generated coverage contains 978 supported code points. Each rendering worker loads the same bundled bytes before measuring; there is no system-font fallback, network font, or user-supplied font path. Help → Licenses contains the complete copyright and license offline.

Unsupported glyphs, excess rendered lines, and a missing or delayed font never delete validated text. These conditions leave project save and recovery available, preserve the current edit, show an actionable error, and prevent finished output until a valid render exists. An incomplete IME composition or invalid local draft blocks save/close with the draft still visible. A stopped caption preview retains the edit and offers Retry preview. Caption-free cancellation keeps its existing rollback behavior.

One field session produces one document history gesture; a focused textarea retains native selection, text undo, and composition behavior. Header Undo finishes the gesture. Captions select Edited, participate in dirty/baseline comparison, and survive look selection, randomization, Fry changes, and preset loading. PresetControls observes preset content, and caption-only history restoration does not increment its preset restore version. The desktop journey verifies both the matching look label and the relative Fry baseline, including returning from 60% to 100% with the original rendered pixels.

Main preview, candidate project opening, Copy, Export, and output inspection use the composition renderer. Output freezes complete edits before awaiting work; inspection identity includes words. Captions render after effects. Glyph compositing leaves original pixels outside glyph coverage unchanged, including transparent pixels. Existing JPEG flattening is retained. Null captions bypass font work and preserve the exact historical image-treatment path.

## Verification receipts

Final application and test sources were present for these runs and were then committed unchanged in `8342232e6eea09065ca8377f2aedfbf13515f449`. The receipts record the earlier HEAD because the final feature was still in the working tree when tested. The package verifier script was added after the full source run and was exercised separately. This report changes documentation only.

Dependencies were reused through a worktree-local junction to the existing `E:/Dev/Deep-Fryer/node_modules`; no dependency installation ran. The checked lockfile matched Electron 45.0.0 and Playwright 1.64.1. Commands used Node 24.16.0.

- `npm run typecheck`: passed; `.artifacts/caption-final-typecheck-1.txt`.
- `npm test`: 51 passed, zero failed or skipped; `.artifacts/caption-final-unit-1.txt`.
- `npm run build`: passed; `.artifacts/caption-final-build-1.txt`.
- Full source Electron suite: 59 passed, 3 skipped, zero failed, 62 total, 3.7 minutes; `.artifacts/caption-full-source-1.txt` and `.artifacts/caption-full-source-1/`.
- Documentation links after this report: 94 links in 29 Markdown files; 12 external URLs intentionally not checked by the local link command. Receipt: `.artifacts/caption-final-docs-2.txt`. The earlier 93-link receipt remains in `.artifacts/caption-final-docs-1.txt`.
- Source diff whitespace check passed excluding the byte-preserved upstream OFL. The unmodified OFL contains CRLF and one upstream trailing space; the raw check's expected warnings are retained in `.artifacts/caption-final-diff-check.txt`. Font integrity verification passed after staging. Existing v1 and v1-rich fixture directories have no diff from the base.

The four caption journeys cover real Electron typing, Clear, native text undo, document undo/redo, Chromium IME composition, caption-only dirty state, canceled save, close cancellation, restart recovery, look/Fry baseline retention, and a real 900×620 outer window. Native decision responses and file selections are intercepted; the actual Electron close/IPC flow runs. The font failure and delay are injected inside the persistent rendering worker, followed by retry and stale revision rejection.

Output proof covers a 240×160 transparent PNG and an EXIF-oriented JPEG displayed as 160×240, original and proportional half dimensions, and unlocked 180×280 output. It compares Copy and exported PNG pixels, inspected decoded pixels, exact inspected/saved bytes, and unchanged embedded source bytes. A caption edit stales inspection. The existing 6000×4000 (24 MP) journey additionally checks caption Stop preview, retry, and undo/redo against a pixel hash. Frozen v1 and v2 readers reject newly written v3; three historical fixture sets reopen with exact expected RGBA through both project and preset paths.

The three skipped full-suite journeys are native Windows clipboard copy, native Windows clipboard paste, and installed upgrade. The native Save chooser script and upgrade script were updated for project v3 and caption retention but were not run in those environments. No CI flag was set to enable personal clipboard writes.

### Packaged Windows journey

Built an unpacked Windows package using the existing Electron runtime, with no installation or publishing:

```text
node node_modules/electron-builder/cli.js --dir --win --publish never --config.directories.output=.artifacts/caption-package --config.electronDist=E:/Dev/Deep-Fryer/node_modules/electron/dist --config.npmRebuild=false
node scripts/verify-caption-package.mjs ".artifacts/caption-package/win-unpacked/Deep Fryer.exe" ".artifacts/caption-packaged-proof-2"
```

Both commands passed. Build receipt: `.artifacts/caption-package-build-1.txt`. Journey receipt: `.artifacts/caption-packaged-proof-2/manifest.json`, with actual `app.isPackaged=true`, version 0.5.0, the renderer loaded from `app.asar`, zero page errors, and clean process exit. Its temporary profile was removed after exit. Captions changed full-resolution RGBA, the archived TTF matched the pinned hash, and the displayed license matched the complete bundled OFL. Screenshots `captions.png` and `license.png` show actual outer 900×620/content 884×581. This proves local packaged asset use; it does not establish installed or firewall-enforced offline acceptance.

- Executable SHA-256: `d8cdf6b06ec880a6393549bf203bee4e6f87d17b676425785bd78349ac7bce91`.
- `app.asar` SHA-256: `d6c4b1aacb30e1b685c208f59375996fa04b4f87199841ea550ea3ccad924a13`.
- Bundled TTF SHA-256: `a4ba3a92350ebb031da0cb47630ac49eb265082ca1bc0450442f4a83ab947cab`.

### Preserved failed receipts

Earlier unsuccessful attempts remain separate from the final passing evidence:

- Initial base capture completed all historical files and prototype screenshots, then failed while retrieving a closed Playwright process handle. The helper now captures the handle before closing; baseline files were not regenerated. The temporary profile cleanup was rejected by automatic approval review with `blocked by policy`, without a more specific reason; the rejection was not bypassed.
- `.artifacts/caption-ui-1.txt`: sending a multi-million-element pixel array through Playwright timed out and left the test process running. Only the verified owned test/Electron process tree was stopped. The journey now hashes pixels inside the renderer. The disposable `deep-fryer-captions-7aaY2m` profile was retained.
- `.artifacts/caption-ui-2.txt`: the recovery assertion read before its asynchronous checkpoint existed. The bounded poll now treats ENOENT as pending.
- `.artifacts/caption-ui-3.txt`: two passed and two failed. One Save As modal was not visible during the initial clean save; it did not reproduce in the isolated recovery run or final suite. No causal product repair is claimed for that transient failure. The other failure showed that the first font interception did not reach the worker; the verifier now injects into the actual worker fetch. Traces and error contexts remain alongside the receipt.
- `.artifacts/caption-recovery-4.txt` and `.artifacts/caption-font-4.txt`: the subsequent isolated recovery and worker-font journeys each passed.
- `.artifacts/caption-packaged-proof-1.txt` and `.artifacts/caption-packaged-proof/manifest.json`: the initial package verifier failed because its ASAR font path retained a leading slash. The corrected verifier passed in `caption-packaged-proof-2`; the initial failed manifest remains intact.
- Intermediate migration/typecheck/unit receipts remain in `.artifacts/caption-*`; they were not rewritten as final evidence.

## Ordinary Save integration handoff

Read-only comparison used Save commits `3793758c15ba16b8f0593da7ac710e8f5d8d29ce` and `a87db69be2dcb0ec1fb788d4461d96456fe28e77`. Neither was cherry-picked. Save should be integrated first, then this branch. The following are concrete overlap points for the coordinator; they are not implemented target APIs in this branch.

1. In `src/main/document-files.ts`, retain Save's exported `CURRENT_PROJECT_VERSION` and set it to 3. Use it for the current project schema and writer; keep explicit version 1 and 2 readers and the separate preset v1/v2 version gate. Do not replace every literal 2: presets and the frozen v2 decoder must stay v2. `ProjectTargets` already compares the original file version with this constant. With 3, v1/v2 opens receive `target: null`; first ordinary Save must create a Save As copy without changing legacy source bytes.
2. In `src/shared/documents.ts`, keep Save's target ID, opened-project wrapper, result unions, and bridge methods. Change the wrapped `EditableDocument` to this branch's `{ source, edit }`. Its registry remains generic over that shared type; no second caption registry is needed.
3. In renderer `document-files.ts`, keep Save's `snapshotDocument`, target-bearing baseline, capability release/adoption paths, and save result handling. Deep-copy source bytes and use `snapshotEdit(document.edit)`; migrate `current()`, dirty comparison, publish, recovery, and new-image creation to complete edits. Preserve its snapshot-before-await semantics. Remove imports of the deleted `preset-history` module instead of adding aliases.
4. Preserve caption `finishGesture()` validation and error handling before save, history actions, and close. Validated captions remain savable during font/layout failure and pending render. Merge the caption `saveBusy` distinction into both ordinary Save and Save As controls; an unready preview must not strand valid text. Keep Save's ordinary Ctrl+S routing, intentional Save As routing, conflict messages, and target release logic.
5. Expected overlapping UI/docs files are `App.vue`, `DocumentControls.vue`, `HelpDialog.vue`, README, architecture, file storage, and the documents verification map. Retain Save's overwrite/capability explanation while changing projects to v3, keeping presets v2, and explaining legacy first-save copies. This branch alone still uses exclusive Save As; do not carry its blanket new-filename wording into the integrated ordinary Save UI.
6. Migrate Save's new test documents from `{ source, preset }` to `{ source, edit: newEdit(preset) }`. Update only current-project assertions to 3. Preserve immutable v1/v2 fixtures and preset version 2. Caption tests deliberately leave unrelated copy-shortcut expectations alone; their only existing copy-test migration reads recovery from `edit.preset`.

After merging, verify: v2 open has no target and Ctrl+S produces a distinct v3 copy with original bytes unchanged; caption-only ordinary Save establishes a clean complete baseline; a delayed save freezes complete edits; cancellation/conflicts preserve text and baseline; rejected opens release unused targets; font/layout failure still permits saving valid captions; and caption-only undo leaves a matching look and relative Fry baseline intact. Run the integrated source suite and the separate disposable CI/native/installed gates. This branch's results do not prove the combined Save implementation.

## Review principles applied

Model the domain: composition belongs to complete editable document state while reusable presets remain image treatment. Type-system discipline: shared schemas own serialization, input bounds, and snapshots, with private historical decoders. Experience first: compare actual minimum-window prototypes and preserve native field behavior. Sequence verifiable units: freeze compatibility artifacts before migration and preserve failed receipts. Prove it works: distinguish source, packaged, and deferred installed/native evidence. Deslop/no-comments: self-reviewed the new modules and migration without adding compatibility aliases or a second caption history; no independent review is claimed.

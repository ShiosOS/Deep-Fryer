# Projects, presets, and recovery

Move an editable project without its source, reuse presets, and recover interrupted work without touching another profile.

## Sub-features

- D1: Portable project, reusable preset, incompatible file rejection, and original protection.
- D2: Independent project/preset/export names and canceled name/chooser dialogs.
- D3: Recovery after interruption, fallback from corruption, discard, and profile ownership.
- D4: Historical v1 compatibility and installed upgrade/return compatibility.
- D5: Save project, Discard, or Cancel before replacing or closing unsaved work.

## How to get to it (user POV)

Use **File → Open project** or **Save project as…**. Use **Preset actions → Load preset** or **Save preset as…**. Replacing unsaved work or closing the native window offers **Save project**, **Discard**, and **Cancel**. A restarted interrupted profile offers **Restore work** and **Discard recovery**. Recovery is local to that profile.

## Driving it with Playwright Electron

Preconditions: Each spec supplies writable disposable paths. Recovery tests deliberately interrupt only processes they launch.

- D1: `node node_modules/@playwright/test/cli.js test documents.spec.ts --grep 'portable project' --output .artifacts/documents-portable/test-results`. `fileAction(page, 'Save project as…')` and the preset equivalent drive named saves. Require the project to reopen after its source moves, preset scaling on a second image, identical source bytes, and retained edits after incompatible files.
- D2: `node node_modules/@playwright/test/cli.js test redesign.spec.ts --grep 'project, preset and export names' --output .artifacts/document-names/test-results`. Drive **Project name**, **Preset name**, **Export file name**, and **Save as…**. Require independent save suggestions, correct saved content, and retained current edit after cancellation.
- D3: `node node_modules/@playwright/test/cli.js test documents.spec.ts --grep 'unexpected process stop|second application' --output .artifacts/recovery/test-results`. Require valid-generation restore, corrupted-latest fallback, removal of both disposable recovery copies after **Discard recovery**, and a second app unable to own/delete the live profile's recovery.
- D4 source compatibility: `node node_modules/@playwright/test/cli.js test legacy-files.spec.ts --output .artifacts/legacy/test-results`. Require historical fixtures to reopen with baseline full-resolution pixels, including ordering, JPEG, alpha, and points.
- D4 installed upgrade is the `package-upgrade` workflow job, which runs `package-upgrade.spec.ts` against actual previous/candidate/return installations. Retain each installer hash and phase receipt; a local legacy-fixture run does not cover installation.
- D5: `node node_modules/@playwright/test/cli.js test unsaved-work.spec.ts --output .artifacts/unsaved-work/test-results`. Require canceled replacement to retain pixels/history, project save before replacement to write the old snapshot, discard to reset history, and native close/quit choices to preserve or save edits and recovery as claimed. The spec intercepts exact native message-box choices while driving real renderer/main flows.

## Gotchas

The ordinary document specs intercept Open/Save chooser results. They prove serialization, IPC, real disk writes, and reload behavior, not the Windows chooser. Keep fixtures read-only and save into each run's temporary directory. Use `chooseUnsaved` for deliberate replacement choices and `closeDiscardingChanges` for disposable test teardown. A graceful capture teardown discards its temporary edit and removes that profile; it is not a recovery or guard UX proof. The demo recovery journey retains its forced process exit before relaunch.

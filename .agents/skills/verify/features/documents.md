# Projects, presets, and recovery

Move an editable project without its source, reuse presets, and recover interrupted work without touching another profile.

## Sub-features

- D1: Portable project, reusable preset, incompatible file rejection, and original protection.
- D2: Independent project/preset/export names and canceled name/chooser dialogs.
- D3: Recovery after interruption, fallback from corruption, discard, and profile ownership.
- D4: Historical v1/v2 compatibility, v3 project rejection by older readers, and installed upgrade/return compatibility.
- D5: Save project, Discard, or Cancel before replacing or closing unsaved work.
- D6: Ordinary Save, target switching, external conflicts, and legacy first-save copies.

## How to get to it (user POV)

Use **File → Open project**, **Save project**, or **Save project as…**. `Ctrl+S` updates an authorized project without another chooser. A targetless first save asks for a new file. Explicit Save As always creates a copy. Use **Preset actions → Load preset** or **Save preset as…**. Replacing unsaved work or closing the native window offers **Save project**, **Discard**, and **Cancel**. A restarted interrupted profile offers **Restore work** and **Discard recovery**. Recovery is local to that profile.

## Driving it with Playwright Electron

Preconditions: Each spec supplies writable disposable paths. Recovery tests deliberately interrupt only processes they launch.

- D1: `node node_modules/@playwright/test/cli.js test documents.spec.ts --grep 'portable project' --output .artifacts/documents-portable/test-results`. `fileAction(page, 'Save project as…')` and the preset equivalent drive named saves. Require the project to reopen after its source moves, preset scaling on a second image, identical source bytes, and retained edits after incompatible files.
- D2: `node node_modules/@playwright/test/cli.js test redesign.spec.ts --grep 'project, preset and export names' --output .artifacts/document-names/test-results`. Drive **Project name**, **Preset name**, **Export file name**, and **Save as…**. Require independent save suggestions, correct saved content, and retained current edit after cancellation.
- D3: `node node_modules/@playwright/test/cli.js test documents.spec.ts process-exit.spec.ts --grep 'unexpected process stop|second application|recovery interruption' --output .artifacts/recovery/test-results`. Require valid-generation restore, corrupted-latest fallback, removal of both disposable recovery copies after **Discard recovery**, and a second app unable to own/delete the live profile's recovery. The interruption helper must return only after the launcher exits with code 19 and the recorded Electron main, renderer, and utility PIDs stop.
- D4 source compatibility: `node node_modules/@playwright/test/cli.js test legacy-files.spec.ts --output .artifacts/legacy/test-results`. Require historical fixtures to reopen with baseline full-resolution pixels, including ordering, JPEG, alpha, and points.
- D4 installed upgrade is the `package-upgrade` workflow job, which runs `package-upgrade.spec.ts` against actual previous/candidate/return installations. Retain each installer hash and phase receipt; a local legacy-fixture run does not cover installation.
- D5: `node node_modules/@playwright/test/cli.js test unsaved-work.spec.ts --output .artifacts/unsaved-work/test-results`. Require canceled replacement to retain pixels/history, project save before replacement to write the old snapshot, discard to reset history, and native close/quit choices to preserve or save edits and recovery as claimed. The spec intercepts exact native message-box choices while driving real renderer/main flows.
- D6: `node node_modules/@playwright/test/cli.js test ordinary-save.spec.ts --output .artifacts/ordinary-save/test-results`. Require repeated Ctrl+S without another chooser, native Open authorization, successful Save As target switching, exact reopened documents, undo-to-saved cleanliness, Save A while B is pending, retained A on cancel/failure/invalid B, and same-size/missing/read-only conflicts. The v1 journey must create a current-version copy and preserve the legacy bytes.
- D6 filesystem faults: `node --import tsx --test tests/project-targets.test.ts tests/project-baseline.test.ts`. Require unknown/released/session capabilities, hardlink/symlink protection, native Windows read-only and rename behavior, write/sync/close/rename failures, cleanup causes, uncertain post-rename outcomes, and exact submitted snapshot acknowledgement.

## Gotchas

The ordinary document specs intercept Open/Save chooser results. They prove serialization, IPC, real disk writes, and reload behavior, not the Windows chooser. Keep fixtures read-only and save into each run's temporary directory. Use `chooseUnsaved` for deliberate replacement choices and `closeDiscardingChanges` for disposable test teardown. A graceful capture teardown discards its temporary edit and removes that profile; it is not a recovery or guard UX proof. Use `interruptForRecovery` before reusing an interrupted profile: `app.exit(19)` can return while the previous launch still runs. The helper retains the forced exit and recovery files, then drains that launch before relaunch or filesystem changes. Cleanup failures remain failures; there is no filesystem retry.

The ordinary-save spec records its disposable profile and process, verifies exit, and removes that profile. Save As and export must retain exclusive creation. Atomic replacement is not filesystem compare-and-swap or absolute power-loss proof. Keep the narrow fault tests and actual Windows permission tests separate from packaged, installed, offline, and native-chooser evidence.

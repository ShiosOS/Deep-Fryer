# Projects, presets, and recovery

Move an editable project without its source, reuse presets, and recover interrupted work without touching another profile.

## Sub-features

- D1: Portable project, reusable preset, incompatible file rejection, and original protection.
- D2: Independent project/preset/export names and canceled name/chooser dialogs.
- D3: Recovery after interruption, focused accepted edits, fallback from corruption, discard, and profile ownership.
- D4: Historical v1/v2 compatibility, v3 project rejection by older readers, and installed upgrade/return compatibility.
- D5: Save project, Discard, or Cancel before replacing or closing unsaved work.

## How to get to it (user POV)

Use **File → Open project** or **Save project as…**. Use **Preset actions → Load preset** or **Save preset as…**. Replacing unsaved work or closing the native window offers **Save project**, **Discard**, and **Cancel**. A restarted interrupted profile offers **Restore work** and **Discard recovery**. Recovery is local to that profile.

## Driving it with Playwright Electron

Preconditions: Each spec supplies writable disposable paths. Recovery tests deliberately interrupt only processes they launch.

- D1: `node node_modules/@playwright/test/cli.js test documents.spec.ts --grep 'portable project' --output .artifacts/documents-portable/test-results`. `fileAction(page, 'Save project as…')` and the preset equivalent drive named saves. Require the project to reopen after its source moves, preset scaling on a second image, identical source bytes, and retained edits after incompatible files.
- D2: `node node_modules/@playwright/test/cli.js test redesign.spec.ts --grep 'project, preset and export names' --output .artifacts/document-names/test-results`. Drive **Project name**, **Preset name**, **Export file name**, and **Save as…**. Require independent save suggestions, correct saved content, and retained current edit after cancellation.
- D3: `node node_modules/@playwright/test/cli.js test documents.spec.ts process-exit.spec.ts --grep 'unexpected process stop|second application|recovery interruption' --output .artifacts/recovery/test-results`. Require valid-generation restore, corrupted-latest fallback, removal of both disposable recovery copies after **Discard recovery**, and a second app unable to own/delete the live profile's recovery. The interruption helper must return only after the launcher exits with code 19 and the recorded Electron main, renderer, and utility PIDs stop. The failure-injection journey must retain the profile when a recorded PID appears live, even after `app.close()` returns. It restores the liveness probe and independently proves actual process exit before removing its fixture.
- D3 focused edits: `node node_modules/@playwright/test/cli.js test focused-recovery.spec.ts --output .artifacts/recovery-focused/test-results`. Require actual disk brightness 50 while the numeric input retains focus, restoration of the same pixels after forced exit, and identical original source bytes. Focusing without changing a value must preserve a pending checkpoint. A paused slider must checkpoint without splitting its undo group. Invalid numeric drafts must preserve the last accepted schema-valid preset. Injected pending, failed, and stale full responses must leave the earlier checkpoint intact; a later matching full response must permit checkpointing. These cases reuse `RecoveryEvidence` launch ownership, failure capture, and exit proof. They do not exercise IME composition handling.
- D4 source compatibility: `node node_modules/@playwright/test/cli.js test legacy-files.spec.ts --output .artifacts/legacy/test-results`. Require historical fixtures to reopen with baseline full-resolution pixels, including ordering, JPEG, alpha, and points.
- D4 installed upgrade is the `package-upgrade` workflow job, which runs `package-upgrade.spec.ts` against actual previous/candidate/return installations. Retain each installer hash and phase receipt; a local legacy-fixture run does not cover installation.
- D5: `node node_modules/@playwright/test/cli.js test unsaved-work.spec.ts --output .artifacts/unsaved-work/test-results`. Require canceled replacement to retain pixels/history, project save before replacement to write the old snapshot, discard to reset history, and native close/quit choices to preserve or save edits and recovery as claimed. The spec intercepts exact native message-box choices while driving real renderer/main flows.

## Gotchas

The ordinary document specs intercept Open/Save chooser results. They prove serialization, IPC, real disk writes, and reload behavior, not the Windows chooser. Keep fixtures read-only and save into each run's temporary directory. Use `chooseUnsaved` for deliberate replacement choices and `closeDiscardingChanges` for disposable test teardown. A graceful capture teardown discards its temporary edit and removes that profile; it is not a recovery or guard UX proof. Use `interruptForRecovery` before reusing an interrupted profile: `app.exit(19)` can return while the previous launch still runs. The helper retains the forced exit and recovery files, then drains that launch before relaunch or filesystem changes. `closeDiscardingChanges` shares that app's original interruption result, including failure. Await it before deleting a disposable profile, and never catch its error before deletion. Failed exit proof leaves the profile intact without another cleanup attempt. This harness contract does not establish the cause of historical CI failures.

The original unexpected-stop journey uses `recovery-evidence.ts`. Before each launch's actions it retains the launcher and main/metrics PIDs and wraps Electron's private checkpoint IPC handler with a bounded scalar request/ack/error ledger. This adds setup IPC, console events, and a Promise reaction, so it can affect scheduling. It adds no observations between the brightness fill/blur/ready actions and the original five-second actual-file poll. Queue depth, renderer timers/revisions, gestures, and rename completion remain unobserved.

Recovery eligibility follows the last valid edit and its matching full render, independently of focus and undo gesture completion. Actual edits still cancel the previous checkpoint timer. Document locks, unresolved recovery offers, readiness, and timer-fire checks still gate writes. Check the actual recovery generation instead of the revision-independent **Recovery saved** notice. Close and replacement guards have separate D5 journeys.

On the first failure it copies the actual synthetic latest/previous files to Playwright output before graceful close can erase them, records stat/scalar brightness and public DOM state, and attempts a screenshot. Copies are sequential, not an atomic disk snapshot. Capture errors are diagnostic attachments and preserve the primary error. Failed journeys retain the profile; pre-close output copies preserve recovery bytes even when graceful close clears the profile's recovery folder. All retained launchers and recorded PIDs must exit before successful cleanup removes the profile. A cleanup failure fails a passing journey and retains the profile. These receipts prepare the next natural failure for diagnosis; a passing journey does not fix issue #36 or clear the PR28 landing failure.

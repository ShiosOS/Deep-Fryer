# Held Save and caption integration

The goal is ordinary Save for the complete caption editor without losing editable text, legacy source files, or the saved baseline. This candidate is held for the separate Windows ACL repair in issue #29 and fresh independent security review. Passing integration checks do not establish ACL safety or release acceptance.

## Scope and provenance

The isolated branch is `feat/save-caption-integration` in `C:/Users/emofo/.t3/worktrees/Deep-Fryer/t3-cf0fe3c2`. Its exact base is `028f32e5baed7e3c36f95ed0d1d6bade3c325b26`.

The implementation cherry-picked `3793758c15ba16b8f0593da7ac710e8f5d8d29ce` as `db53902b220bc88a3db5e3c7caa247248c8a54ff`, resolving the existing caption seams. It then cherry-picked documentation commit `a87db69be2dcb0ec1fb788d4461d96456fe28e77` as `9892415cd9ae65b3fdc71280990123dda624f1a8`, retaining the caption documentation and recording the hold. The integration did not rewrite `ProjectTargets` or change its ACL behavior. Its Git blob remains `58324a12b6a722927adf90c67d33f6b78920e805`, identical to the first supplied Save commit.

No child agents, root checkout edits, pushes, pull requests, installs, personal clipboard access, or ACL repair ran. No independent reviewer ran here. The coordinator owns the security review and release decision.

## Ownership and conflict resolution

The shared document remains `{ source, edit }`. `EditState` owns the preset and caption composition together. Main owns opaque project targets and filesystem validation. The renderer owns the complete saved baseline and adopts a new target only after publication succeeds.

The implementation retains the Save commit's snapshot and target lifecycle. `snapshotDocument` copies source bytes and calls `snapshotEdit` before the first save await. A successful acknowledgement establishes that exact submitted edit as the baseline. Later edits remain dirty. Opening B retains A's target until the replacement decision and publication finish. Canceled or rejected B releases only B. Successful publication adopts B before releasing A.

The alternative of keeping a separate caption snapshot beside Save's preset-only baseline would duplicate document ownership. The chosen integration instead migrates Save's existing baseline to the complete shared type. This follows Model the Domain and Type System Discipline without introducing another registry or compatibility alias.

`CURRENT_PROJECT_VERSION` is exported as 3 and controls the current project schema, writer, and overwrite authorization. Explicit v1 and v2 readers remain. Both legacy versions open without an overwrite capability. Their first ordinary Save creates a separate v3 copy. Presets still write version 2. Frozen readers, projects, presets, source images, and reference pixels were not regenerated.

Both ordinary Save and explicit Save As retain `finishGesture()` validation and the caption-aware busy distinction. Valid text can save during font or layout errors and pending rendering. Incomplete IME composition and invalid local drafts block saving and close. The modal focus repair, ready copy, caption controls, looks, and relative Fry behavior remain in place.

The throughput checkpoint used one owner and four sequential units: inspect ownership and runtime; cherry-pick and resolve seams; verify units and Electron journeys; commit the held candidate. Shared document migration was the dependency for verification. There was no parallel agent work.

## Runtime and commands

All verification commands use the supplied Node executable, confirmed as `v24.22.2`:

```powershell
$n = 'C:/Users/emofo/.t3/worktrees/Deep-Fryer/t3-b61d1ba0/.artifacts/ci-copy-diagnosis/runtime/node_modules/node-win-x64/bin/node.exe'
```

The worktree initially had no `node_modules`. A local junction points to `E:/Dev/Deep-Fryer/node_modules`. Its checked versions matched the lockfile: Electron 45.0.0, Playwright 1.64.1, Vue 3.5.44, Zod 4.6.7, tsx 4.23.15, TypeScript 5.9.3, electron-vite 6.0.0, and vue-tsc 3.3.13. No installation ran through that junction.

```powershell
& $n node_modules/vue-tsc/bin/vue-tsc.js --noEmit
& $n --import tsx --test tests/project-baseline.test.ts tests/project-targets.test.ts tests/captions.test.ts tests/caption-fixtures.test.ts tests/legacy-files.test.ts tests/documents.test.ts
& $n node_modules/electron-vite/bin/electron-vite.js build
& $n node_modules/@playwright/test/cli.js test ordinary-save.spec.ts captions.spec.ts legacy-files.spec.ts unsaved-work.spec.ts --workers=1 --global-timeout=240000 --output .artifacts/save-caption-integration/electron-1
```

Electron runs remove `ELECTRON_RUN_AS_NODE`, `DEEP_FRYER_EXECUTABLE`, `ELECTRON_EXECUTABLE_PATH`, and `CI` from the child environment and set `ELECTRON_RENDERER_URL` empty. Each journey uses a disposable profile. Native file choices and unsaved decisions are intercepted. The caption output journey intercepts `clipboard.write` before invoking Copy and never writes the personal clipboard.

The new ordinary-save teardown bounds app closure at ten seconds, requires process exit before deleting its own disposable folder, and writes a teardown receipt. A failed close retains the folder. No blocked cleanup is retried.

## Evidence and limits

Receipts live in `.artifacts/save-caption-integration/`. The targeted unit run passed 42 tests with zero failures or skips, exit 0. Six typechecks and both application builds passed, exit 0. `tested-head.txt` records `9892415cd9ae65b3fdc71280990123dda624f1a8`. `tested-changes.patch` records the initial test changes, and `build-provenance.txt` records that patch and the main/preload bundle hashes. `final-test-changes.patch` records the final test changes before the focused run, SHA-256 `b991467a255b28f287e7039b8e578645bf9f700fce5d4a152ddc9e7111114e49`. Later documentation changes do not change the tested application.

The final focused Electron command was:

```powershell
& $n node_modules/@playwright/test/cli.js test ordinary-save.spec.ts unsaved-work.spec.ts --grep 'caption-only ordinary|delayed Save As|unrenderable captions|incomplete IME|v2 Ctrl|close queued while candidate|close queued during preset load' --workers=1 --global-timeout=150000 --output .artifacts/save-caption-integration/combined-final-5
```

It finished with six passes and one failure, exit 1. Passing journeys cover caption-only ordinary Save and clean reopening, delayed Save As, unrenderable text saving and reopening, IME/invalid-draft protection, v2 first Save preserving legacy bytes, and close queued during preset loading. The pending-B journey reached and passed its A caption, A preset, unchanged B bytes, and closed-window assertions, then failed the ten-second `app.close()` teardown. It remains a failed journey. Its trace and retained profile `C:/Users/emofo/AppData/Local/Temp/deep-fryer-ordinary-save-lZAWd0` are preserved. Clean process teardown for that path is unresolved.

The initial `electron-1` run passed all four caption journeys and the frozen v1/v2 pixel journey. It also passed the combined Save journeys except pending B, whose first attempt stopped before its disk assertions while waiting for launcher exit. That complete run ended at its 240-second bound with 32 passes, three failures, 15 unrun tests, and two suite timeout errors, exit 1. This is not a passing source suite.

Additional failed diagnostics remain separate:

- `close-2` ran `ordinary-save.spec.ts --grep 'same-size target|native close uses|close queued' --global-timeout=90000`. One passed and two timed out in teardown, exit 1. Tests now observe native window closure before releasing Playwright and accept either launcher exit code or termination signal. They also verify recorded application PIDs before deleting their disposable directory.
- `close-3` used the same command after a test-only debugger hook. All three failed because `require` was unavailable in Playwright evaluation, exit 1. This was a verifier defect, not a product failure.
- `ordinary-4` ran `ordinary-save.spec.ts --global-timeout=180000` with the hook using `process.getBuiltinModule`. Ten passed, five failed teardown, five did not run, and two suite timeout errors occurred, exit 1. The hook did not resolve teardown failures and was removed. It is absent from the final candidate.

The logs show main-process debugger shutdown waits in the initial native-close failures. Local Playwright code also disconnects its debugger during `app.close()`. These observations do not establish the cause of every timeout. No application close repair is claimed. Failed receipts and profiles were not deleted or retried as cleanup targets. Prove It Works requires retaining these failures separately from successful behavioral assertions.

The normal product capture runs once after rebuilding:

```powershell
& $n scripts/capture-product.mjs --output .artifacts/save-caption-integration/product-capture
& $n scripts/check-doc-links.mjs
git diff --check
```

The capture passed, exit 0, with `passed: true`, `errors: []`, changed rendered pixels, unchanged source bytes, and six verified screenshots. The minimum window was 900 by 620 outer and 884 by 581 content. Its launcher exited with code 0, all four recorded application PIDs exited, and its disposable profile was removed. The manifest and raw Electron stderr remain in `product-capture/`. The minimum-window screenshot was visually inspected. This capture does not verify the pending-B close path.

A later read-only audit found no surviving processes with the recorded test identities. Any live reuse of their PIDs had a start time after the corresponding runtime receipt. Those unrelated processes were untouched. `recorded-process-audit-2.json` records that distinction. Failed profiles remain retained, and the later exit observation does not change the failed teardown verdicts.

Documentation link checking and whitespace checking passed. The independent security review remains blocked by the explicit no-children scope and belongs to the coordinator, as does the separate ACL repair. The implementation and its evidence are committed for review while these holds remain open.

These are local source and built Electron checks. Packaged, installed, offline, native clipboard, native Windows chooser, upgrade, CI, ACL repair, and fresh independent security acceptance remain separate gates. No claim of shipping readiness is made.

## Changed files

Relative to the exact base, the candidate changes these files:

```text
.agents/skills/verify/features/documents.md
README.md
docs/architecture.md
docs/files-and-storage.md
docs/save-caption-integration.md
src/main/document-actions.ts
src/main/document-files.ts
src/main/project-targets.ts
src/preload/index.ts
src/renderer/src/App.vue
src/renderer/src/DocumentControls.vue
src/renderer/src/HelpDialog.vue
src/renderer/src/document-files.ts
src/shared/documents.ts
tests/e2e/captions.spec.ts
tests/e2e/ordinary-save.spec.ts
tests/e2e/ui.ts
tests/e2e/unsaved-work.spec.ts
tests/project-baseline.test.ts
tests/project-targets.test.ts
```

# Export aspect ratio

Base commit: `98d79878ef3c2aa73d8e8edce51f308ac6abf421`.

The dialog owns width and height drafts, source replacement resets, and inspection invalidation. The output worker freezes validated options and renders those dimensions. The source bitmap is already decoded with EXIF orientation applied.

## Design comparison before implementation

1. A pure coupled-dimension function takes the original oriented source dimensions, the edited dimension, and its numeric value. It returns both dimensions with the other side rounded to the nearest integer. The dialog keeps its independent input drafts and applies this function only while locked. Existing option validation rejects invalid dimensions and excessive pixel counts.
2. One scale ratio would derive both dimensions from the source. Unlocked inputs would still need independent drafts, plus conversion when switching modes and handling invalid input. That adds state and transitions for this dialog.

Choose the pure function. Keep edited raw input in the dialog so empty and fractional drafts stay invalid. Do not clamp derived dimensions into the allowed range. A rounded zero or an oversized side remains invalid under the existing schema. Re-lock using width as the anchor. Each source replacement restores the lock and original dimensions. Toggling the lock alone does not invalidate identical output bytes; dimension changes use the existing inspection key.

## Throughput checkpoint

- Blocking first steps: inspect source decoding, draft ownership, schemas, and existing Electron output tests before edits.
- Independent workstreams: not applicable. This is one coupled dialog and its verification.
- Shared mutable state: dialog drafts remain local. No new worker or main-process state.
- Smallest safe decomposition: one implementation owner, one pure helper, unit checks, then real Electron journeys. No children, push, or PR per task instructions.

## Verification plan

Run typecheck, all local units, build, and Electron output journeys. Check width and height edits, rounding from the source rather than the rounded draft, explicit keyboard unlock, re-lock, source replacement including EXIF orientation, invalid inputs and both dimension limits, inspection staleness, and exact inspected/saved bytes. Update existing deliberate stretching tests to unlock explicitly. Review the final diff with deslop before committing.

## Verified result

- `npm run typecheck` passed.
- `npm test` passed all 36 tests, including two new coupled-dimension units.
- `npm run build` passed.
- After clearing inherited `ELECTRON_RUN_AS_NODE`, `npx playwright test tests/e2e/output.spec.ts tests/e2e/copy-image.spec.ts tests/e2e/keyboard.spec.ts` passed eight actual Electron journeys. The disposable Windows CI native clipboard test was skipped by its existing environment gate.
- The new journey saved width-led `49 x 33`, height-led `38 x 25`, explicitly unlocked `40 x 17`, and EXIF-oriented replacement `20 x 30` PNGs. Every saved file matched the worker's inspected encoded bytes and the inspection canvas pixels. Source files stayed byte-identical and there were no renderer errors.
- Empty, zero, negative, fractional, oversized, and excessive-pixel drafts disabled inspection and saving. `6000 x 4000` and unlocked `16384 x 1` stayed valid. A portrait width of `12000` derived an invalid `18000` height and disabled both actions.
- Re-lock restored proportional height from width and made the old inspection stale. Replacing an unlocked landscape with an EXIF-oriented portrait restored the checked lock, oriented source dimensions, default name, and stale inspection behavior.
- Local proof is in `.artifacts/export-aspect-ratio/proof.json`, with saved PNGs and screenshots beside it. Inspected `.artifacts/export-aspect-ratio/unlocked-settings.png` to check the checkbox layout.
- Deslop review found no added comments, casts, unrelated styles, compatibility layers, or broad refactoring. `git diff --check` passed. README, App, PresetControls, rendering, naming, and frozen-output implementation are unchanged.

Model the Domain kept independent input drafts and isolated proportional calculation in one pure function. Type System Discipline derives the dimension shape from `OutputOptions` and retains existing schema validation at the output boundary.

## Limits

This proves the locally built Electron app, not an installer or installed/offline release. Open/save chooser results were intercepted; encoded rendering, inspection, IPC, disk writing, and file decoding ran for real. Copy journeys intercepted the final clipboard writer and did not touch the personal clipboard. No children, push, PR, or independent review ran in this implementation task. Rounded zero dimensions are rejected rather than clamped. Large valid boundary dimensions were validated without rendering a 24-million-pixel output.

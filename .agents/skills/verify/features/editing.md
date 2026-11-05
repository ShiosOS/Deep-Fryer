# Edit effects and history

Build a layered fry, compare candidates, and recover previous rendered pixels with Undo and Redo.

## Sub-features

- E1: Named presets, randomization locks, Fry level, and five-candidate selection.
- E2: Independent color controls, ordered Noise/JPEG layers, enable/mix/duplicate/remove, and 5× intensity.
- E3: Point placement, drag, numeric distortion controls, Undo, and Redo.
- E4: Replacement readiness and cancellation of pending rendering.

## How to get to it (user POV)

Open an image and choose a named look through **Preset** in released 0.4.0, or its named button in the upcoming gallery UI. Use **Add effect** for another layer. Expand an effect card to adjust its controls. Use **Randomize**, **Randomization locks**, **Fry level**, and **Compare 5** for variations. Use **Place point** or add Bulge for distortion. Use toolbar Undo/Redo or Ctrl+Z, Ctrl+Shift+Z, and Ctrl+Y.

## Driving it with Playwright Electron

Preconditions: An actual built Electron app; each journey supplies its own image. Use `controls(page)` after `ready(page)` before locating fields in replacement cards.

- E1: `node node_modules/@playwright/test/cli.js test preset-looks.spec.ts --output .artifacts/edit-looks/test-results`. `getByRole('combobox', { name: 'Preset', exact: true }).selectOption('Crispy color')` must set Contrast to `1.5`. Undo/Redo restore exact pixel arrays. Randomization retains locked values. `getByRole('dialog', { name: 'Choose a fry level' })` has five radios, Escape preserves the edit, and **Apply selected level** commits the selection.
- E2 color: `node node_modules/@playwright/test/cli.js test editor.spec.ts --grep 'independent color' --output .artifacts/edit-color/test-results`. The spec checks combined grayscale pixels, alpha, invalid input, failure retention, reset, source bytes, and exported pixels.
- E2 layers/intensity: `node node_modules/@playwright/test/cli.js test effects.spec.ts intensity.spec.ts --grep 'ordered texture|5x controls' --output .artifacts/edit-layers/test-results`. Drive **Add effect**, **Duplicate Noise**, **Move JPEG damage up**, and **Enable Noise**. Require reordered/mixed pixel results and corresponding decoded output, rather than control values alone.
- E3: `node node_modules/@playwright/test/cli.js test bulge-history.spec.ts keyboard.spec.ts --output .artifacts/edit-points/test-results`. Require point position/strength, Undo/Redo state, and exported pixels. Keyboard journey uses accessible spinbuttons such as **Bulge strength value**.
- E4: `node node_modules/@playwright/test/cli.js test disclosure.spec.ts --output .artifacts/edit-replacement/test-results` proves replacement readiness. For the expensive maximum-image cancellation path, run `effects.spec.ts --grep 'maximum supported'` through the same CLI with a fresh output path; its assertions require latest pixels and **Cancel pending changes** restoring the last confirmed state.

## Gotchas

Export enabled is the existing render-ready acknowledgement. Enumerating cards before readiness can capture old UI during replacement. A selected preset name alone is insufficient evidence of rendered output. The capture helper compares actual full-resolution pixels before/after Crispy color with a fixed Noise pattern. It uses a named button when present and the released select otherwise. The feature specs above describe baseline 98d7987; rerun migrated `chooseLook` journeys after UI integration before claiming gallery acceptance. Large-image rendering has a separate longer spec timeout; do not substitute a small fixture and claim that path passed.

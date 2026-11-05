# Edit effects and history

Caption fields share the complete edit history. [Caption journeys](captions.md) check native text gestures and ensure caption-only changes preserve the active look and relative Fry baseline.

Build a layered fry, compare candidates, and recover previous rendered pixels with Undo and Redo.

## Sub-features

- E1: Named presets, randomization locks, Fry level, and five-candidate selection.
- E2: Independent color controls, ordered Noise/JPEG layers, enable/mix/duplicate/remove, and 5× intensity.
- E3: Point placement, drag, numeric distortion controls, Undo, and Redo.
- E4: Replacement readiness and cancellation of pending rendering.
- E5: Image-based look previews, selection state, thumbnail failure, and cancellation on source replacement.
- E6: Focused Look, Effects, and Captions sections, guarded drafts, keyboard selection, and native minimum-window reachability.

## How to get to it (user POV)

Open an image in **Look** and choose a named button such as **Crispy color** in the collapsible gallery. Selection stays in Look and returns focus to **Choose a look**. Choose **Effects** at the top of the inspector to adjust the ordered layers or use **Add effect**. **Randomize**, **Randomization locks**, **Fry level**, **Compare 5**, and **Preset actions** remain in Look. **Captions** directly exposes both text fields. Use Tab between section buttons and Enter or Space to select one. A selected canvas distortion point opens and reveals its Effects card without moving keyboard focus away from the handle. Use toolbar Undo/Redo or Ctrl+Z, Ctrl+Shift+Z, and Ctrl+Y.

## Driving it with Playwright Electron

Preconditions: An actual built Electron app; each journey supplies its own image. `section(page, 'Look' | 'Effects' | 'Captions')` drives the public navigation. `controls(page)` awaits render readiness, deliberately selects Effects, and expands current cards and More controls. `fileAction` selects Look before preset actions. Select the needed section explicitly before subsequent Look or caption interactions.

- E1, E5: `node node_modules/@playwright/test/cli.js test preset-looks.spec.ts --output .artifacts/edit-looks/test-results`. Await `.look-grid[aria-busy=false]`, then click `getByRole('button', { name: 'Crispy color', exact: true })`. Require Contrast `1.5`, `aria-pressed=true`, and preview pixels matching the chosen render. Undo/Redo restore exact pixel arrays. Randomization retains locked values. `getByRole('dialog', { name: 'Choose a fry level' })` has five radios, Escape preserves the edit, and **Apply selected level** commits the selection.
- E2 color: `node node_modules/@playwright/test/cli.js test editor.spec.ts --grep 'independent color' --output .artifacts/edit-color/test-results`. The spec checks combined grayscale pixels, alpha, invalid input, failure retention, reset, source bytes, and exported pixels.
- E2 layers/intensity: `node node_modules/@playwright/test/cli.js test effects.spec.ts intensity.spec.ts --grep 'ordered texture|5x controls' --output .artifacts/edit-layers/test-results`. Drive **Add effect**, **Duplicate Noise**, **Move JPEG damage up**, and **Enable Noise**. Require reordered/mixed pixel results and corresponding decoded output, rather than control values alone.
- E3: `node node_modules/@playwright/test/cli.js test bulge-history.spec.ts keyboard.spec.ts --output .artifacts/edit-points/test-results`. Require point position/strength, Undo/Redo state, and exported pixels. Keyboard journey uses accessible spinbuttons such as **Bulge strength value**.
- E3 recovery during gestures: `node node_modules/@playwright/test/cli.js test focused-recovery.spec.ts --grep 'paused slider|invalid numeric' --output .artifacts/edit-recovery/test-results`. Require a checkpoint during a held slider gesture, then one Undo back to the gesture's starting value and one Redo to its final value. Invalid numeric drafts must retain the accepted pixels and actual disk preset while focused.
- E4: `node node_modules/@playwright/test/cli.js test disclosure.spec.ts --output .artifacts/edit-replacement/test-results` proves replacement readiness. For the expensive maximum-image cancellation path, run `effects.spec.ts --grep 'maximum supported'` through the same CLI with a fresh output path; its assertions require latest pixels and **Cancel pending changes** restoring the last confirmed state.
- E5: `node node_modules/@playwright/test/cli.js test demo-gallery.spec.ts --output .artifacts/edit-gallery/test-results`. Require custom Fry level to clear `aria-pressed`, `.look-gallery summary` to collapse previews without hiding editing, a visible thumbnail error with enabled look buttons, and explicit **Discard** on source replacement to terminate pending look workers.
- E6: `node node_modules/@playwright/test/cli.js test inspector-sections.spec.ts --output .artifacts/editor-sections/test-results`. Real BrowserWindow outer bounds are 900×620 and 1120×760, in both themes. Both first-effect heading edges must be in the upper inspector, with a visible primary adjustment, canvas, dimensions, status, and Export. The original crowded inspector fails the same geometry gate. Journeys cover caption→look→effect navigation, physical keyboard focus, full effect order, locks, closed hidden menus, canvas point reveal, IME refusal, invalid numeric/seed/coordinate drafts, one Undo per completed gesture, saved and recovered complete edits, unchanged source bytes, and navigation without dirtying files or changing recovery bytes. New fixtures retain launcher/PIDs before driver disposal, prove exit before removal, and retain failures.

## Gotchas

Export enabled is the existing render-ready acknowledgement. Enumerating cards before readiness can capture old UI during replacement. Gallery readiness is separate; await `.look-grid` with `aria-busy=false` before screenshots. A selected preset name alone is insufficient evidence of rendered output. The capture helper uses current section buttons and compares actual full-resolution pixels before/after Crispy color with a fixed Noise pattern. Hidden sections stay mounted, retaining drafts and Look state. Correct invalid drafts or complete composition before leaving; section errors keep the draft visible and focus recoverable. Navigation is presentation state, outside project/history/recovery. Large-image rendering has a separate longer spec timeout; do not substitute a small fixture and claim that path passed.

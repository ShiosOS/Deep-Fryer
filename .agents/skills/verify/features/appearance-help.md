# Appearance and help

Help also contains Captions and Licenses tabs. [Caption journeys](captions.md) compare the full offline Anton license with the shipped file, including packaged runs.

Choose a usable palette, retain it across restart, and read illustrated help with keyboard focus and reduced motion.

## Sub-features

- A1: Light/Dark/System modes, selected palettes, and six independent custom colors.
- A2: Unreadable-settings defaults, explicit reset, and edit/recovery independence.
- A3: Seven Help tabs, engine-rendered images/animation, focus return, and minimum sizing.

## How to get to it (user POV)

Open **Settings**, choose **Light**, **Dark**, or **System**, choose a palette or **Custom colors**, and finish with **Done**. Open **Help**, use **Quick start**, **Effects**, **Layering**, **Points**, **Saving & export**, **Captions**, and **Licenses**. Use arrow keys between tabs and Escape to close.

## Driving it with Playwright Electron

Preconditions: Fresh disposable profile; source fixture is supplied where editing is needed. Settings persistence intentionally restarts only that profile.

- A1/A2: `node node_modules/@playwright/test/cli.js test redesign.spec.ts --grep 'appearance persists|unreadable settings' --output .artifacts/appearance/test-results`. Drive theme buttons, **Custom colors**, **Accent color**, **Canvas color**, **Panels color**, and **Reset saved settings**. Require the persisted palette JSON after restart, `html[data-appearance]` following System changes, intact unreadable settings until explicit reset, and unchanged edit/recovery checkpoint.
- A3: `node node_modules/@playwright/test/cli.js test redesign.spec.ts --grep 'Help tabs' --output .artifacts/help/test-results`. It sets a 900 × 620 content viewport, requires seven tabs, uses **Choose an effect**, and checks complete nonzero image dimensions. It checks reduced-motion poster, explicit **Play animation/Pause animation**, nonempty tab panels, Escape closing, and focus returning to Help.
- A1/A3 actual native size: `node scripts/capture-product.mjs --output .artifacts/appearance-capture` captures both themes and sets BrowserWindow to its true minimum outer size. Require decoded PNG/content dimensions to match the manifest and inspect `05-minimum-light.png` for clipped controls or unwanted overflow.

## Gotchas

The existing Help test's 900 × 620 content viewport is distinct from the native 900 × 620 outer-window minimum. The capture records the smaller real Windows content size. Passing dimension checks do not establish visual polish; inspect the screenshots. Theme changes should affect neither history nor recovery. Existing `assets:capture`/`assets:render` regenerate tracked help media; use the safe capture helper for verification instead.

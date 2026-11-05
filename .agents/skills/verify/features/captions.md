# Editable meme captions

## Sub-features

- C1: Top and Bottom fields, case/newlines, native text undo and IME, grouped document undo/redo, Clear, and minimum window layout.
- C2: Caption-only dirty baseline, failed/canceled saves, native close cancellation, and recovery restart with unrenderable text.
- C3: Transparent and oriented output, proportional and unlocked resize, identical copied/exported PNG pixels, exact inspected bytes, and stale inspection after caption edits.
- C4: Missing/delayed worker font, draft preservation, retry, and stale render rejection.
- C5: Pinned font/license integrity and offline Help → Licenses.

## How to get to it (user POV)

Open an image or Try demo, then open **Captions** above the look gallery. Type in **Top** or **Bottom**. **Text size** reveals the size slider. **Clear** removes both fields. Use header Undo/Redo for complete edits; focused fields keep native text undo. Captions remain when selecting a look, changing Fry level, randomizing, or loading a preset. Font/layout errors leave the text editable and project saves available. **Retry preview** retries failed font loading.

## Driving it with Playwright Electron

Build first, then run `node node_modules/@playwright/test/cli.js test captions.spec.ts --output .artifacts/caption-proof-NEW`. The four journeys cover C1–C5. They intercept native file choices and final clipboard writes, and use Chromium's IME protocol for composition. The minimum-window check sets BrowserWindow outer size to 900×620 and captures the actual viewport. C4 injects failure and delay into the persistent worker's font fetch; window font readiness is insufficient.

Run `node scripts/verify-caption-font.mjs` to verify the official font, license, metadata, and generated cmap coverage. This also runs in the unit suite. With `DEEP_FRYER_EXECUTABLE` set to a built package, the same caption journeys exercise bundled workers/assets and offline license text. Retain the executable hash and package mode separately. This does not install a package or enforce a firewall rule.

## Gotchas

Each field accepts 512 UTF-16 units. Arbitrary unsupported glyphs and too many rendered lines remain valid project text. Expect an actionable error and disabled finished output, not data deletion or a fallback font. After a caption-only edit/undo, the active look and relative Fry baseline must remain intact. Caption error previews may show the last good frame; never report them as current output. A stopped caption preview retains the edit and requires retry. Native clipboard, installed-offline, and upgrade acceptance remain separate disposable CI gates. Do not refresh README screenshots as part of this feature check.

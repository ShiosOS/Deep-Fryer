# Deep Fryer

A local desktop image editor. Open or paste a PNG or JPEG, choose a preset, and adjust eight ordered effects: brightness, contrast, saturation, color levels, noise, sharpening, JPEG damage, and bulge/pinch points. Contrast and saturation reach 5×; each effect has a separate blend strength. Images stay on your computer.

The compact inspector includes randomization locks, five draft comparisons, and undo/redo. The canvas supports original comparison, fit/actual size, zoom/pan, and editable distortion points. Help in the header explains the controls with real engine examples, an optional animation, and screenshots of the actual editor. Settings provides light, dark, System, and separate custom palettes for each appearance.

## Run

Requires Node.js 22.12 or newer and npm:

```powershell
npm ci
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm run dev
```

Ctrl+O opens an image, Ctrl+S names a project, and Ctrl+Shift+S opens export options. Native file choosers select destinations. Project, preset, and export names are independent.

Copy image beside Export, or Ctrl+Shift+C, copies the edited image as a PNG at its original oriented dimensions with transparency. These shortcuts also accept Command. Copy uses the edit even while Original is visible and ignores export settings. The header shows Image copied after the clipboard accepts the image.

## Files and safety

- `.deepfryer` projects contain the original source bytes and the editable preset.
- `.frypreset` presets contain ordered effects, relative points, and a saved seed without an image.
- PNG, JPEG, and WebP exports are rendered at the chosen output dimensions. Final inspection decodes the encoded output; saving that inspection writes the exact inspected bytes. Changing only its name preserves the inspection.

Current project and preset files use outer version 2. Projects have `{ format: "deep-fryer-project", version: 2, source: { name, mime, base64 }, preset }`; presets have `{ format: "deep-fryer-preset", version: 2, preset }`. The in-memory preset is unversioned. The private legacy codec reads original v1 files with their original ranges and semantics. Old applications reject v2 files.

All user saves create new files exclusively. Existing destinations, including the source and hard links to it, remain protected even when a native chooser offers replacement. A failed open leaves the current edit intact. Input limits are 64 MiB, 16,384 pixels per side, and 24 million pixels. Export preserves decoded pixels rather than source metadata.

Recovery retains two completed edits locally for up to seven days after an interruption. Clean exit or Discard removes recovery copies. Appearance is saved separately in the application data directory, outside projects, presets, recovery, and undo history. Unreadable or future appearance files remain untouched until an explicit reset.

## Verify

```powershell
npm run typecheck
npm test
npm run build
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm run test:e2e
npm run package:win
node scripts/verify-package.mjs
```

Electron journeys use real IPC, decoding, rendering, history, recovery, and filesystem operations with native open/save selection stubbed. Immutable v1 fixtures compare every reopened RGBA byte with pixels captured by the old application. Settings restart, Help keyboard/media, 5× intensity, invalid files, naming cancellation, and frozen exports have dedicated coverage. Ordinary copy tests intercept Electron's final clipboard write and compare the PNG Blob against exported pixels. Native clipboard round trips run only in disposable CI to avoid replacing a personal clipboard. The staged installer-upgrade test requires its documented environment variables and installations; it is not part of an ordinary local run.

Use `DEEP_FRYER_EXECUTABLE` for a packaged application or `ELECTRON_EXECUTABLE_PATH` for an alternative Electron runtime. `scripts/verify-native-dialog.mjs` exercises an actual Windows Save dialog using observed UI Automation handles, while stubbing only project opening. `scripts/verify-package.mjs` checks packaged media, runtime icons, and the actual executable icon pixels.

## Help media and icons

`npm run assets:render` renders examples through the production engine and converts the approved SVG into runtime PNG and multiresolution Windows ICO files. `npm run assets:capture` captures the implemented editor for Help. Rebuild after generating assets. The media manifest records parameters and hashes. Windows packaging includes the icon in the executable, installer, uninstaller, and application resources.

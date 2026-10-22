# Deep Fryer

Open a PNG or JPEG, preview the oriented image, and export a full resolution PNG to a new file. Existing paths are refused, including the source and hard links to it. Images stay on your computer.

Requires Node.js 22.12 or newer and npm. Run `npm install`, then `npm run dev`. Use **Open image** or Ctrl+O. Use **Export PNG** or Ctrl+Shift+S. This first slice has no effects yet.

Run `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e` to check the app. The Electron smoke test stubs native OS file selection and runs the real file IPC, image decoder, canvas, and PNG export. Set `ELECTRON_EXECUTABLE_PATH` to test with a particular Electron executable. Its screenshot is `.artifacts/first-slice.png`.

The limits are 64 MiB per file, 16,384 pixels per side, and 24 million pixels. Export preserves the decoded canvas pixels, not source metadata. A failed open keeps the previous image. A failed disk write can leave a partial new file. Choose another name after resolving the disk problem.

`npm run package:win` builds an NSIS installer. Installer creation and signing are not part of this slice.

[Product brief in Notion](https://app.notion.com/p/4019c0510118810b911cd64ff485274e). [First slice](https://app.notion.com/p/4019c051011881a48559ee6ff578df01).

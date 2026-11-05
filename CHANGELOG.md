# Changelog

Published installers are listed on the [releases page](https://github.com/ShiosOS/Deep-Fryer/releases). An unreleased source change is not part of an older installer.

## 0.5.0, unreleased

- Try an original bundled demo without opening a personal image. Browse real draft previews of each named look on your current image.
- Read larger inspector labels and processing or error feedback outside the scrolling controls.
- Save, discard, or cancel before replacing or closing an unsaved project. Only a successful project save marks the edit saved. Undo to saved values restores that state.
- Close cancels unfinished output preparation and waits for a native write that has already started. Unresolved recovery copies remain available.
- Export dimensions keep the original oriented aspect ratio by default. Unlock the ratio to stretch an image deliberately.
- Toggling the ratio lock without changing dimensions preserves the inspected output.
- Failed image writes remove their incomplete new destination. Existing files and source images remain protected.
- The repository includes an MIT license, installation and checksum guidance, contribution and support docs, issue forms, and a private security reporting channel.
- Packaging explicitly disables publishing during verification. Documentation links have a repeatable check in Windows CI.
- A project-local verification skill captures the real Electron app with disposable profiles and records pixels, screenshots, runtime errors, and cleanup.

## 0.4.0

The published Windows release includes the pastel pink editor, Copy image, Help media, light and dark appearance settings, and branded application and installer icons. See the [0.4.0 release](https://github.com/ShiosOS/Deep-Fryer/releases/tag/v0.4.0) for its installer and checksum.

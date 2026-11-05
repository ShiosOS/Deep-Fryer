# Caption integration checkpoint

Coordinator source head `028f32e5baed7e3c36f95ed0d1d6bade3c325b26`, source tree `5a3eef182808c3731f62b9972fbc809f688c8747`. The following documentation and image commit leaves that source tree unchanged. Ordinary Save is not included.

## Observed locally

Node 24.22.2 with the lockfile dependencies. Receipts are retained under `.artifacts/caption-integration/` in the coordinator checkout.

- Integrated predecessor `10ad58b` passed typecheck, 51 unit tests, build, and the entire Electron suite with 60 passed and three environment-gated skips. Receipts `typecheck.log`, `unit.log`, `build.log`, and `desktop.log`.
- The completion message then changed from color-specific wording to complete-edit wording. At `028f32e`, typecheck/build and all seven caption/editor/inspection journeys passed. Receipts `polish-typecheck.log`, `polish-build.log`, and `polish-desktop.log`.
- A fresh unpacked Windows package at `028f32e` passed the bundled font/license journey and ten caption/copy/historical-file journeys, with native clipboard skipped. Receipts `final-package.log`, `final-packaged-font/manifest.json`, and `packaged-desktop.log`.
- `packaged-byte-match.json` verifies all 27 built/resource files against the packaged ASAR. ASAR SHA-256 `05eef3154070a9f082c1ec03e16bb5b8dc5b9eb1966a0ded3b85923f811ee905`. Executable SHA-256 `49431bbb870a6ceadb76a1edecc9072d3e98600dc40b319616c3be7daa9f2585`. Font SHA-256 `a4ba3a92350ebb031da0cb47630ac49eb265082ca1bc0450442f4a83ab947cab`.
- `gallery-capture/manifest.json` records a clean tracked tree, actual packaged mode, changed pixels, unchanged original image bytes, zero recorded renderer errors, and successful teardown. The three gallery images were copied byte-for-byte to `docs/images/`. `fried-product-caption/manifest.json` records the caption screenshot from the same package at 900×620 outer size and 884×581 content. Its capture script is retained as `capture-fried-meme.mjs`.
- Local documentation check passed 96 links. External URLs were not refreshed by this check.

The first byte-comparison attempt assumed slash-separated ASAR paths and failed with `out/renderer/index.html was not found in this archive`. Listing the archive showed Windows separators. The corrected checker used the native path and matched all files. This was a verification-script correction, with no product change.

## Independent evidence

Terra reviewed the caption range `d2cdcfd..42e1494` before its clean rebase onto the modal correction. Its fresh build, 22 focused units, five Electron journeys, and extra unsupported-text reopen/unfinished-IME close checks passed. It reported no reproduced defect. The synthetic overlength-draft close check timed out and remains unverified. Its stopped disposable profile was retained. Author and coordinator checks do not replace that independent limit.

Sol reviewed the separate modal range `d2cdcfd..3f0e61f`. The permanent regression failed on a fresh base build with expected zero writer calls versus one actual call, then passed on head. Five copy journeys, two Settings/Help journeys, and eight focused restoration probes passed. No actionable finding was reported.

## Separate hosted gates

Compact-parent CI run `41956548235`, attempt 1, at `5b9f30a` passed build-and-test and installer upgrade. Installed-offline reported 57 passed, one failed, and one skipped. Its failure was an `EBUSY` unlink of the disposable profile's `DIPS-wal` file in the second-instance journey. That run remains failed. Diagnosis is separate from caption acceptance, and neither this local package nor a later passing run establishes its historical cause.

Local selections and clipboard writes were intercepted. These checks do not establish installed-offline behavior, native chooser behavior, installer upgrade, native clipboard, or a released 0.5.0 product. The published installer remains 0.4.0 and unsigned. No installation, publishing, or personal clipboard writes occurred.

## Hosted checkpoint after this report

Caption head `291a2a4738783854dcfc1ce8962f070cbc563162` passed all three jobs in run `41958138926`, attempt 1. Build-and-test and installed-offline each passed 62 Electron journeys, with the dedicated upgrade journey skipped in those suites. Both actual Windows clipboard copy and paste passed on disposable runners. Previous, candidate, and return installer-upgrade phases each passed their dedicated journey. The coordinator retained the full hosted log in `.artifacts/caption-integration/ci-291a2a4.log`.

This later hosted evidence is specific to `291a2a4`. It does not relabel failed compact-parent run `41956548235` or prove its historical file-lock owner. A subsequent parent merge adds the separately reviewed interrupted-launch harness correction. Review found a cleanup-after-failed-exit error path in that harness; its acceptance remains held for repair, independently of the passing caption application checkpoint.

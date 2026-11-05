# Compatibility evidence

`v2` and `v2-reader` were captured before caption migration from `e2276f3109077299c94698f2f87747a8901c322d`. `v2/manifest.json` binds the frozen reader, project, preset, source, PNG, and raw RGBA reference by SHA-256. The fixture preserves rich v1 ordering, identities, alpha, noise, JPEG, and points, with contrast 450 and saturation 375 exercising v2's expanded range. Never regenerate these with a later writer or renderer. `scripts/capture-caption-base.mjs` refuses any other HEAD.

`v1` and `v1-rich` are immutable real files and reference pixels captured with the old application at commit `24d28bda0195c64937e576b23f66275bc551e16d`. They were copied from the approved implementation artifacts (`legacy` and `legacy-rich`). The second fixture includes JPEG passes, effect ordering and blending, seeded noise, transparency, and distortion points. `original.png` contains the project’s embedded source bytes.

Do not regenerate these fixtures with the new writer or renderer. `manifest.json` records their SHA-256 hashes. The Electron compatibility journey checks every reopened pixel and its RGBA hash for both project and preset flows.

`v1-reader/src` is a frozen copy of the original reader and its imports from that same commit, unchanged apart from checkout line endings. The unit test opens historical files with both readers and proves that the original reader refuses newly written v2 files. Legacy UI labels used by the optional staged installer test live in `legacy-ui.ts`.

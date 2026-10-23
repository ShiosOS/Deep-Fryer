# Compatibility evidence

`v1` and `v1-rich` are immutable real files and reference pixels captured with the old application at commit `24d28bda0195c64937e576b23f66275bc551e16d`. They were copied from the approved implementation artifacts (`legacy` and `legacy-rich`). The second fixture includes JPEG passes, effect ordering and blending, seeded noise, transparency, and distortion points. `original.png` contains the project’s embedded source bytes.

Do not regenerate these fixtures with the new writer or renderer. `manifest.json` records their SHA-256 hashes. The Electron compatibility journey checks every reopened pixel and its RGBA hash for both project and preset flows.

`v1-reader/src` is a frozen copy of the original reader and its imports from that same commit, unchanged apart from checkout line endings. The unit test opens historical files with both readers and proves that the original reader refuses newly written v2 files. Legacy UI labels used by the optional staged installer test live in `legacy-ui.ts`.

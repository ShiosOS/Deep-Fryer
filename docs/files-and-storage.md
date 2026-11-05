# File formats and local storage

## Saved files

| File | Contents | Purpose |
| --- | --- | --- |
| `.deepfryer` | Original source bytes, source name and type, ordered effects, relative points, and noise seed | Resume an edit |
| `.frypreset` | Ordered effects, relative points, and seed without an image | Reuse a look on another image |
| PNG, JPEG, or WebP | Rendered output pixels | Share a finished image |

Saving always creates a new file. Existing destinations remain protected, including hard links to the original file. Canceling a chooser saves nothing. A failed open leaves the current edit intact.

PNG keeps transparency. JPEG replaces it with the selected background. WebP export uses lossy color compression and supports transparency. JPEG damage inside an effect stack can also replace transparency with its configured background.

Export resizes the decoded source before applying effects. Noise, sharpening, and compression therefore follow the output pixel grid. Final inspection decodes the encoded image, and **Save inspected snapshot** writes those same bytes. Changing the image, effects, or output settings requires a new inspection. Renaming alone preserves the inspection.

Copy creates a PNG at the source's oriented dimensions. It uses the edited image independently of the selected view and export options.

## Compatibility

Current projects have this outer structure:

```json
{
  "format": "deep-fryer-project",
  "version": 2,
  "source": { "name": "photo.png", "mime": "image/png", "base64": "..." },
  "preset": { "seed": 123, "effects": [] }
}
```

Current presets use `{ "format": "deep-fryer-preset", "version": 2, "preset": { ... } }`. The in-memory preset has no version field. The source schemas and codecs are in [shared documents](../src/shared/documents.ts) and [document files](../src/main/document-files.ts).

The private [legacy codec](../src/main/legacy-document-codec.ts) reads original v1 projects and recipes with their original parameter meanings. Older applications reject v2 files. [Historical compatibility fixtures](../tests/fixtures/README.md) preserve original files and reference pixels.

## Recovery and appearance

The app uses Electron's per-user application data directory. Recovery offers display the actual directory so you can locate your copies without assuming a particular Windows profile path.

Recovery stores `latest.deepfryer` and `previous.deepfryer` under `recovery`. Each contains an embedded source image. Checkpoints older than seven days are removed when examined, rather than by a background deletion timer. A clean exit or **Discard recovery** removes both copies. Recovery is for interruptions and does not replace saving a project.

`appearance.json` stores theme settings outside projects, presets, recovery, and undo history. An unreadable or future settings file remains untouched until an explicit reset.

## Privacy boundaries

The editor processes images locally without an upload service, account, telemetry, or automatic updater. Files remain subject to your operating system, backup software, and any sync service configured for their folders.

A project contains the original source bytes, including any embedded metadata. An export encodes decoded pixels instead of copying the source metadata. Copy puts a PNG on the system clipboard. Other applications and Windows clipboard history or sync can retain it.

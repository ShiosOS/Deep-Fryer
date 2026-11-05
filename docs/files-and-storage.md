# File formats and local storage

## Saved files

| File | Contents | Purpose |
| --- | --- | --- |
| `.deepfryer` | Original source bytes, source name and type, ordered effects, relative points, noise seed, and editable captions | Resume an edit |
| `.frypreset` | Ordered effects, relative points, and seed without an image or captions | Reuse a look on another image |
| PNG, JPEG, or WebP | Rendered output pixels | Share a finished image |

**Save project** and `Ctrl+S` update the current project after a successful native Open or Save As. The first save of an image, restored recovery, or legacy project creates a new file. **Save project as…** always creates a new file and switches later saves to that copy. Image exports and preset saves also create new files. Their exclusive-create rule protects existing files, including hard links to the original. Canceling a chooser saves nothing. A failed open leaves the current edit intact.

Ordinary Save refuses a missing, externally changed, read-only, linked, or no-longer-authorized destination. It checks file identity and a hash of the exact previously read or saved bytes, including same-size edits. A refusal retains your edits, undo history, and saved baseline. Reopen the project after resolving the problem or use Save As to keep a separate copy.

On Windows, ordinary Save creates an exclusive temporary file with the project's owner, group, and DACL supplied at creation. A native handle verifies its security and identity before any project or embedded image bytes are written. After writing and syncing, Save rechecks the destination and uses the retained temporary handle to replace it. It verifies the resulting permissions, identity, and exact bytes before acknowledging. It never deletes the destination to make replacement work. Failed temporary cleanup reports the surviving temporary filename and original failure. A surviving content-bearing temporary retains the project's permissions. If replacement may have happened but verification fails, the app reports an uncertain outcome, retains the old baseline, and requires reopening or a separate Save As.

**Held candidate:** ordinary Save remains blocked from release pending independent security review of the issue #29 repair and integrated desktop acceptance. The checks below describe the implementation; they do not establish shipping readiness.

The helper uses the installed Windows PowerShell and .NET Framework without network access, installation, or privilege elevation. It preserves DACL ACE order, masks, inheritance flags, protection, owner, and group. Windows auto-inheritance bookkeeping flags are normalized for comparison. Unsupported permissions, explicit integrity labels, resource attributes or central access policies, encrypted files, non-NTFS or remote volumes, linked ancestor directories, or an unavailable helper cause ordinary Save to refuse before writing a temporary. Open and exclusive Save As remain available. Permission changes since Open or the last Save also cause refusal.

These checks are best-effort conflict detection, not filesystem compare-and-swap. The helper pins local ancestor directories and temporary identity, but another authorized process can change destination content or permissions between the final check and replacement, or change a file's permissions while it exists. Save cannot isolate concurrent administrators or principals already allowed to alter those permissions. File sync and atomic replacement do not guarantee power-loss durability. Replacement creates new filesystem identity and timestamps. Alternate data streams, audit SACLs, and other filesystem metadata are not copied; no preservation claim is made for them.

PNG keeps transparency. JPEG replaces it with the selected background. WebP export uses lossy color compression and supports transparency. JPEG damage inside an effect stack can also replace transparency with its configured background.

Export resizes the decoded source before applying effects. Noise, sharpening, and compression therefore follow the output pixel grid. Final inspection decodes the encoded image, and **Save inspected snapshot** writes those same bytes. Changing the image, captions, effects, or output settings requires a new inspection. Renaming alone preserves the inspection.

Copy creates a PNG at the source's oriented dimensions. It uses the edited image independently of the selected view and export options.

## Compatibility

Current projects have this outer structure:

```json
{
  "format": "deep-fryer-project",
  "version": 3,
  "source": { "name": "photo.png", "mime": "image/png", "base64": "..." },
  "edit": {
    "preset": { "seed": 123, "effects": [] },
    "composition": { "captions": null }
  }
}
```

Current presets use `{ "format": "deep-fryer-preset", "version": 2, "preset": { ... } }`. The in-memory preset has no version field. The source schemas and codecs are in [shared documents](../src/shared/documents.ts) and [document files](../src/main/document-files.ts).

The private [v1 codec](../src/main/legacy-document-codec.ts) and [v2 codec](../src/main/v2-document-codec.ts) read historical files with their original parameter meanings. Both adapt to a null caption composition. Older applications reject v3 projects. Only `CURRENT_PROJECT_VERSION`, currently 3, permits ordinary updates. V1 and v2 projects open clean without overwrite authority. Their first Save creates a separate v3 file and leaves the original unchanged. Presets still write v2 and never include captions. [Historical compatibility fixtures](../tests/fixtures/README.md) preserve original files and reference pixels.

Captions use `{ "kind": "top-bottom-v1", "font": "anton-regular-v1", "top": "Hello", "bottom": "World", "size": 0.1 }`. Each text field accepts at most 512 UTF-16 units; size ranges from 0.04 to 0.16 of the shorter image edge. Whitespace-only caption pairs become `null`. Text remains valid and savable even when it cannot render in three lines or includes unsupported glyphs. Output is blocked with an explanation until the text can render. No font paths or URLs are accepted in a project. The pinned bundled font and full offline Help → Licenses text have [recorded provenance](../src/renderer/src/assets/fonts/provenance.json).

Captions render after effects. Proportional output scales their normalized placement; unlocking the aspect ratio lays them out within the new frame. Caption edits invalidate a previous final inspection. Crop is deferred.

## Recovery and appearance

The app uses Electron's per-user application data directory. Recovery offers display the actual directory so you can locate your copies without assuming a particular Windows profile path.

Recovery stores `latest.deepfryer` and `previous.deepfryer` under `recovery`. Each contains an embedded source image. Checkpoints older than seven days are removed when examined, rather than by a background deletion timer. A completed clean exit or **Discard recovery** removes both copies. Recovery is for interruptions and does not replace saving a project.

The 0.5.0 source tracks the exact document last saved as a project. Opening a saved project starts clean. Imports, pasted images, and restored recovery start unsaved. Copying, exporting, and saving a preset do not save an editable project. Before replacing or closing unsaved work, the app offers Save project, Discard, or Cancel. A canceled or failed save retains the edit. Closing with an unresolved recovery offer, failed recovery lookup, or failed renderer preserves the existing copies.

`appearance.json` stores theme settings outside projects, presets, recovery, and undo history. An unreadable or future settings file remains untouched until an explicit reset.

## Privacy boundaries

The editor processes images locally without an upload service, account, telemetry, or automatic updater. Files remain subject to your operating system, backup software, and any sync service configured for their folders.

A project contains the original source bytes, including any embedded metadata. An export encodes decoded pixels instead of copying the source metadata. Copy puts a PNG on the system clipboard. Other applications and Windows clipboard history or sync can retain it.

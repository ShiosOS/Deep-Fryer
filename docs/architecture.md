# Deep Fryer architecture

Deep Fryer separates desktop file access from image editing. Electron's main process owns native dialogs, validated file operations, recovery, and appearance storage. The Vue renderer owns the current edit and preview. A narrow preload bridge connects them.

## Process boundaries

[The main entry point](../src/main/index.ts) creates a sandboxed window with context isolation, no renderer Node integration, denied permissions, and blocked navigation and child windows. IPC handlers check the calling window and frame before file actions. File actions are serialized while a native operation is active.

[The preload bridge](../src/preload/index.ts) exposes image, document, and appearance operations. Shared Zod schemas validate data crossing those boundaries. It does not expose arbitrary filesystem or IPC access to the renderer.

## Editing and rendering

[App.vue](../src/renderer/src/App.vue) coordinates the active source, complete edit, history, canvas, and asynchronous work. [EditState](../src/shared/edit.ts) contains a reusable preset and a composition. The [composition schema](../src/shared/composition.ts) owns nullable top/bottom captions, text bounds, font identity, and size. A [preset](../src/shared/preset.ts) contains a seed and an ordered list of effects. Effects have stable identities, enabled state, blend strength, and kind-specific settings. Point coordinates are relative to the image.

[The composition renderer](../src/renderer/src/render-edit.ts) applies the effect stack, then readable captions. Preview, candidate project opening, Copy, Export, and inspection use it. Null captions bypass font loading and preserve the historical effect path. [The preview worker](../src/renderer/src/effects-worker.ts) returns source and revision identities so stale results cannot replace newer edits. Reduced previews use the full frame's aspect ratio for caption layout.

[Edit history](../src/renderer/src/edit-history.ts) snapshots the complete edit, with one gesture per caption field session. Appearance stays outside that history. Looks, Fry level, randomization, and preset loading change only the preset. Caption-only snapshots do not reset the selected look or relative Fry baseline.

[Caption rendering](../src/renderer/src/caption-rendering.ts) loads the same pinned font bytes in each worker before measurement. [Layout](../src/renderer/src/caption-layout.ts) uses a normalized shorter side of 1,000 units, separate 30% top/bottom bands, three rendered lines per field, and a bounded 12-step fit search from the requested size down to 2.5%. It wraps words, then graphemes, preserving case and explicit newlines. NFC normalization applies only during layout; saved text stays as entered. Glyph coverage comes from the pinned TTF's Unicode cmap. Unsupported glyphs, missing fonts, and failed fitting block finished output while keeping validated text savable and recoverable. The last good preview remains visible with the error.

## Copy and export

[Output preparation](../src/renderer/src/output.ts) freezes the source, complete edit, and output options before asynchronous rendering. It resizes the source, applies effects and captions at output dimensions, encodes the selected format, and decodes those bytes for inspection. Inspection identity includes caption text and size. The inspection and save paths share the prepared output, so saving an inspected snapshot writes the inspected bytes. Caption glyphs composite over existing alpha; pixels outside the glyphs are untouched. JPEG flattening follows composition.

[Copy image](../src/renderer/src/copy-image.ts) prepares a PNG independently of export options and the Original view. [The main clipboard handler](../src/main/image-clipboard.ts) validates the request and writes the native image.

## Documents and durable writes

[Document actions](../src/main/document-actions.ts) coordinate native selection, validation, and recovery. [Document codecs](../src/main/document-files.ts) write explicit v3 projects and v2 presets. The private [v1](../src/main/legacy-document-codec.ts) and [v2](../src/main/v2-document-codec.ts) readers preserve their historical schemas and adapt into complete edits with null captions. Existing files remain protected by exclusive writes.

[The renderer document owner](../src/renderer/src/document-files.ts) compares the active document with its last successful project snapshot. It owns replacement decisions and serializes document transitions. Main authenticates a close request and its matching reply before destroying the window. Preparation can be canceled before output is submitted. An admitted file or clipboard action settles before the close decision continues.

[ProjectTargets](../src/main/project-targets.ts) keeps session-scoped opaque capabilities in main. Only a validated native Open of `CURRENT_PROJECT_VERSION` or successful exclusive Save As issues one. Renderer receives an ID and basename, never the target path. Unknown, released, and previous-window IDs cannot write. Window destruction clears the registry. Legacy projects have no update capability.

The saved renderer baseline pairs an exact document snapshot with its optional target. Opening candidate B leaves A's target available while the unsaved guard decides whether to save A. Cancel or failed publication releases B. Successful publication adopts B and then releases A. Image imports and restored recovery release the former target only after publication succeeds. Save captures source bytes and preset values before IPC; only a successful acknowledgement installs that submitted snapshot and its target. It does not reset history. The replacement and close guards call the same ordinary-save routine.

Ordinary Save checks regular-file identity, link count, writable access, metadata, and SHA-256 content against the authorized snapshot. It syncs and closes an exclusive same-directory temporary file, checks again, and renames over the destination. It verifies the resulting identity and bytes before acknowledging. A narrow filesystem dependency permits fault tests without production test flags. Rename refusal never triggers destination deletion. Uncertain replacement outcomes revoke the capability. See the [storage contract and filesystem limits](files-and-storage.md) for race, durability, and metadata limits.

[Image file operations](../src/main/image-files.ts) inspect supported file signatures, enforce bounds, and create output files exclusively. They refuse existing destinations. [RecoveryStore](../src/main/recovery.ts) serializes checkpoints and retains two generations. [AppearanceStore](../src/main/appearance-store.ts) stores theme settings separately and protects unreadable files until reset.

For storage behavior, see [file formats and local storage](files-and-storage.md). For the evidence each test provides, see [verification coverage and limits](verification.md).

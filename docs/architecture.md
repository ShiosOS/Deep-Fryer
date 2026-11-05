# Deep Fryer architecture

Deep Fryer separates desktop file access from image editing. Electron's main process owns native dialogs, validated file operations, recovery, and appearance storage. The Vue renderer owns the current edit and preview. A narrow preload bridge connects them.

## Process boundaries

[The main entry point](../src/main/index.ts) creates a sandboxed window with context isolation, no renderer Node integration, denied permissions, and blocked navigation and child windows. IPC handlers check the calling window and frame before file actions. File actions are serialized while a native operation is active.

[The preload bridge](../src/preload/index.ts) exposes image, document, and appearance operations. Shared Zod schemas validate data crossing those boundaries. It does not expose arbitrary filesystem or IPC access to the renderer.

## Editing and rendering

[App.vue](../src/renderer/src/App.vue) coordinates the active source, preset, history, canvas, and asynchronous work. A [preset](../src/shared/preset.ts) contains a seed and an ordered list of effects. Effects have stable identities, enabled state, blend strength, and kind-specific settings. Point coordinates are relative to the image.

[The effect engine](../src/renderer/src/effects.ts) applies the stack in order. [The preview worker](../src/renderer/src/effects-worker.ts) renders source revisions without running the full image pipeline on the UI thread. [Preset history](../src/renderer/src/preset-history.ts) tracks edits separately from appearance settings.

## Copy and export

[Output preparation](../src/renderer/src/output.ts) freezes the source, preset, and output options before asynchronous rendering. It resizes the source, applies effects at output dimensions, encodes the selected format, and decodes those bytes for inspection. The inspection and save paths share the prepared output, so saving an inspected snapshot writes the inspected bytes.

[Copy image](../src/renderer/src/copy-image.ts) prepares a PNG independently of export options and the Original view. [The main clipboard handler](../src/main/image-clipboard.ts) validates the request and writes the native image.

## Documents and durable writes

[Document actions](../src/main/document-actions.ts) coordinate native selection, validation, and recovery. [Document codecs](../src/main/document-files.ts) own versioned project and preset envelopes. [The legacy codec](../src/main/legacy-document-codec.ts) preserves original v1 semantics without making the in-memory model versioned.

[The renderer document owner](../src/renderer/src/document-files.ts) compares the active document with its last successful project snapshot. It owns replacement decisions and serializes document transitions. Main authenticates a close request and its matching reply before destroying the window. Preparation can be canceled before output is submitted. An admitted file or clipboard action settles before the close decision continues.

[Image file operations](../src/main/image-files.ts) inspect supported file signatures, enforce bounds, and create output files exclusively. They refuse existing destinations. [RecoveryStore](../src/main/recovery.ts) serializes checkpoints and retains two generations. [AppearanceStore](../src/main/appearance-store.ts) stores theme settings separately and protects unreadable files until reset.

For storage behavior, see [file formats and local storage](files-and-storage.md). For the evidence each test provides, see [verification coverage and limits](verification.md).

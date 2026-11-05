# Deep Fryer feature map

Start with [the verification skill](../SKILL.md) for safe environment setup, disposable launch, capture, and cleanup. Each map pairs current user entry points with existing actual Electron journeys. A passing journey proves only the entry points it drives; report the others as untested.

- [Import images](import.md): chooser, keyboard, paste boundary, file drop, invalid replacement, and original protection.
- [Edit effects and history](editing.md): named looks, color/texture layers, 5× controls, points, variation selection, undo, and redo.
- [Inspect and output](output.md): zoom/pan/compare, output formats and dimensions, inspected snapshots, and intercepted Copy image.
- [Projects, presets, and recovery](documents.md): portable files, independent names, legacy compatibility, interrupted work, and profile ownership.
- [Appearance and help](appearance-help.md): persisted palettes, theme modes, illustrated help, keyboard focus, and window sizing.

Run commands from the repository root after building. All map commands use `node node_modules/@playwright/test/cli.js` and the checked-in Playwright configuration. They inherit the executable selection established in the skill. Keep `CI` unset locally, and retain the native clipboard skip rather than enabling it. Output directories below are examples for one run; choose fresh names for subsequent runs and preserve the command and exit code alongside artifacts.

When extending a map, inspect the named spec and current component first. Keep each feature's four sections. Add every new entry point to its proof scope, and report missing preconditions without weakening the journey.

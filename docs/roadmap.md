# Roadmap candidates

Deep Fryer 0.4.0 provides a single-image Windows editor with ordered effects, reusable presets, projects, Copy image, export inspection, illustrated Help, and appearance settings. See the [README](../README.md) for current capabilities and limits.

The items below are candidates for future work. They have no promised release date or assigned delivery commitment. An accepted issue and an implemented change are separate from this list.

## Refine the current workflow

Prioritize reported problems in opening images, effect adjustment, point editing, copying, and exporting. Improve keyboard access, error recovery, and clarity where actual usage demonstrates friction. Preserve original-file protection and the distinction between projects, presets, and exports.

## Make releases easier to trust

Evaluate Windows code signing, clearer release provenance, and repeatable package verification. Signing requires a real signing identity and a maintained release process. The current 0.4.0 installer remains unsigned.

## Reuse presets across multiple images

Consider batch processing when repeated single-image export becomes a demonstrated need. A useful implementation needs explicit output naming, collision handling, progress, cancellation, and per-image failures before it can replace manual work.

## Expand only with a clear use case

Additional input formats, creative effects, or platform packages need representative files, usable controls, and verification on the target platform. This roadmap does not imply current support for captions, animation, video, or non-Windows installers.

Use the [feature request form](https://github.com/ShiosOS/Deep-Fryer/issues/new/choose) to describe a task that the current editor cannot complete. Include the current workaround and the expected result.

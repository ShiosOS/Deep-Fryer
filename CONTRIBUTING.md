# Contribute to Deep Fryer

Start with the [developer guide](docs/development.md). Use [GitHub issues](https://github.com/ShiosOS/Deep-Fryer/issues) to check for an existing report or discuss a substantial behavior change before implementation.

## Prepare a focused change

1. Describe the user-visible problem and expected result. Include a small reproducible example for a bug.
2. Keep the change limited to that problem. Avoid unrelated formatting, dependency updates, or generated media changes.
3. Check the relevant behavior in the actual Electron app. Add a regression test when it can demonstrate the failure and corrected result.
4. Run the applicable checks from the developer guide. For documentation changes, run `npm run docs:check` and inspect the Markdown and images.
5. Explain the resulting behavior, verification commands, and any skipped checks in the pull request.

## Preserve the editor's guarantees

Keep operating-system access in the main process behind the preload bridge. Validate external data at boundaries. Keep original-file protection, project compatibility, and inspected-output bytes intact.

Do not regenerate [historical fixtures](tests/fixtures/README.md) with the new implementation. Update user help and verification instructions when observable behavior changes. Check generated images before committing them.

Report source tests, unpacked app checks, installer checks, and installed-offline checks separately. A compile or unit test result does not establish a desktop journey. Preserve a failed result when a later run passes.

## Share safe examples

Use images that you have permission to share. Remove personal data from logs and screenshots. Projects embed original image bytes and can contain metadata. Never attach credentials or private images to a public issue.

Contributions are distributed under the repository's [MIT license](LICENSE). Bundled dependencies and third-party assets retain their own license requirements.

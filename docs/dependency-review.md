# Packaging dependency review

Reviewed on 2026-11-04 against base `96ce7d8ab403fef3de1ffc8bc08d2a36eb16681d`.

The baseline `npm audit --json` reports six moderate aggregate findings. All trace
to [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), which
affects minimatch `>=7.0.0 <11.0.1`. The patched version is `11.0.1`. This concerns
the developer packaging toolchain. This review does not demonstrate an exploit
in the running editor.

Two overrides replace only minimatch `10.2.6` below `app-builder-lib@26.15.3` and
minimatch `9.0.9` below `@electron/universal@2.0.3`. Both the parent version and
child version are explicit because npm overrides also apply to descendants.
The unaffected minimatch `3.1.5` and `5.1.9` copies stay unchanged. The lockfile
adds v11's required `@isaacs/nonrecursive-glob-match` dependency and removes
Universal's unused older brace-expansion dependencies.

A builder upgrade alone does not resolve this advisory. Registry metadata for
`electron-builder@26.18.0` still selects `app-builder-lib@26.18.0`, whose dependencies
include minimatch `^10.2.5` and Universal `2.0.3`. The suggested forced downgrade
to builder `25.1.0` is outside this repair. Revisit the overrides when either
parent changes, and remove them when upstream dependencies resolve patched versions.

The [minimatch v11 API](https://github.com/isaacs/minimatch/tree/v11.0.1) retains
the consumers' CommonJS exports. Builder uses `Minimatch`, `.set`, `.negate`, and
`.match(path, partial)`. Its magic check distinguishes strings from non-strings,
so v11's replacement of regular expressions with matcher objects in `.set` does
not break that check. Universal uses `minimatch(path, pattern, { matchBase: true })`.
Neither consumer uses the removed regular-expression conversion APIs. Version
`11.0.1` declares Node `18 || 20 || >=22`, which includes CI's Node 24 and this
review's Node `26.8.1`.

Local verification with npm `12.0.2` used an isolated worktree with its own
`node_modules` directory. Clean `npm ci` passed before and after the change.
Audit findings fell from six moderate to zero. All 42 consumer checks matched
the baseline, including ordered exclusions, reinclusion, dotfiles, braces,
partial directory traversal, Windows paths, and Universal's `matchBase` calls.
`npm run package:win` built the Windows x64 NSIS installer with `--publish never`.
`node scripts/verify-package.mjs` passed the media and icon checks. An additional
ASAR inventory check confirmed all 25 built and resource files byte-for-byte and
excluded the checked development paths. Local logs and replayable probes remain
in `.artifacts/dependency-review/`. The installer and executable are unsigned.
This verifies local packaging, not editor journeys, installation, offline use,
macOS Universal merging, CI, or every possible glob pattern.

# Verification coverage and limits

The [Windows workflow](../.github/workflows/windows.yml) has three jobs. The [README badge](../README.md) reports the workflow status for `main`, not a guarantee about every released binary.

## Source and Electron journeys

`build-and-test` installs dependencies, checks documentation links and types, runs unit tests, builds the app, runs Electron journeys, and creates a Windows installer. It uploads the installer and available check output.

The journeys cover editing, documents, presets, history, appearance restart, Help, keyboard interaction, output inspection, and image copying. They use real Electron IPC and filesystem operations, with native open and save selection usually stubbed. They do not prove an actual Windows chooser interaction.

The 0.5.0 journeys also cover unsaved Save, Discard, and Cancel decisions, close during processing, admitted native writes, interrupted demo recovery, live look previews, and proportional export dimensions. Native decision boxes are intercepted with explicit choices in those local journeys. Their control flow is exercised, while actual operating-system interaction remains a separate evidence class. Use the [maintained desktop verification skill](../.agents/skills/verify/SKILL.md) for launch, capture, feature maps, and cleanup.

Original v1 fixtures and base-v2 fixtures contain files and pixels captured before migration. The v2 capture is bound to `e2276f3109077299c94698f2f87747a8901c322d`. Compatibility journeys compare reopened RGBA pixels against those fixtures, and frozen readers reject v3 projects. Do not regenerate the baseline using the current renderer. See [fixture provenance](../tests/fixtures/README.md).

`captions.spec.ts` drives text editing and IME completion, native close cancellation, caption-only dirty baselines, failed-layout recovery, look/Fry baseline preservation, and font-failure retention. Its output journey compares copied and exported PNG pixels, exact inspected bytes, transparency, orientation, proportional resize, and unlocked aspect ratios. Font fault injection runs inside the actual rendering worker. `node scripts/verify-caption-font.mjs` checks pinned asset hashes and regenerated Unicode coverage. Local clipboard writes remain intercepted. These source journeys are separate from packaged, installed-offline, native clipboard, and installer-upgrade evidence.

## Installed and offline behavior

`installed-offline` installs the candidate in a disposable Windows runner and blocks outbound traffic for its executable with Windows Firewall. It runs the Electron journeys against that installed executable. This checks those journeys under the stated network block. It is not a claim that every machine, format, or OS configuration has been tested.

## Installer upgrade

`package-upgrade` downloads the pinned 0.2.0 installer, verifies its recorded SHA-256, and tests installation, candidate upgrade, restart, and return to the older package. The [upgrade journey](../tests/e2e/package-upgrade.spec.ts) uses files shared across staged installations.

This journey needs `DEEP_FRYER_UPGRADE_DIRECTORY`, `DEEP_FRYER_EXECUTABLE`, and `DEEP_FRYER_UPGRADE_PHASE` set for each installation phase. An ordinary local test run skips it. Use the workflow as the procedure for a disposable Windows environment. Do not run installation or rollback stages against a personal installation.

## Clipboard and native dialogs

Ordinary copy tests intercept Electron's final clipboard write and compare the prepared PNG with exported pixels. Native clipboard round trips run in disposable CI to avoid replacing a personal clipboard. Those are separate checks.

`node scripts/verify-native-dialog.mjs` exercises a real Windows Save dialog using observed UI Automation handles while stubbing project opening. It writes local artifacts and is a separate manual verification command, not a step in the Windows workflow. Read the [script](../scripts/verify-native-dialog.mjs) before running it on an interactive desktop.

## Alternative executables

Set `DEEP_FRYER_EXECUTABLE` to exercise a packaged executable. Set `ELECTRON_EXECUTABLE_PATH` for an alternative Electron runtime. Record the executable, commit, command, and skipped checks when reporting results. A successful unpacked run does not replace installing and exercising an installer.

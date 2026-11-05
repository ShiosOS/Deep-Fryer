# Verification coverage and limits

The [Windows workflow](../.github/workflows/windows.yml) has three jobs. The [README badge](../README.md) reports the workflow status for `main`, not a guarantee about every released binary.

## Source and Electron journeys

`build-and-test` installs dependencies, checks documentation links and types, runs unit tests, builds the app, runs Electron journeys, and creates a Windows installer. It uploads the installer and available check output.

The journeys cover editing, documents, presets, history, appearance restart, Help, keyboard interaction, output inspection, and image copying. They use real Electron IPC and filesystem operations, with native open and save selection usually stubbed. They do not prove an actual Windows chooser interaction.

Original v1 fixtures contain files and pixels captured by the old application. Compatibility journeys compare reopened RGBA pixels against those fixtures. Do not regenerate the baseline using the current renderer. See [fixture provenance](../tests/fixtures/README.md).

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

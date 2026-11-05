# Security policy

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/ShiosOS/Deep-Fryer/security/advisories/new) for sensitive details. Private reporting is enabled for this repository.

If that form is unavailable, open a [public issue](https://github.com/ShiosOS/Deep-Fryer/issues/new/choose) that asks for a private reporting channel. Do not include exploit instructions, credentials, private images, or sensitive files in the public issue. No separate security email address or response deadline is published.

Include the affected version, Windows version, how the app was installed, the suspected impact, and minimal reproduction steps in the private report. Use a harmless sample where possible.

## Supported versions and limits

There is no published backport or long-term support commitment. Check the [official releases page](https://github.com/ShiosOS/Deep-Fryer/releases) for available updates and their release notes.

The 0.4.0 Windows installer is unsigned. A matching published checksum identifies the release bytes but does not authenticate a signing identity. The app validates image and document bounds and isolates renderer access, but no security audit or immunity from malformed-file bugs is claimed.

Projects embed the original image bytes, and recovery stores local copies. Clipboard history, backups, and folder sync remain outside the editor's control. See [local storage and privacy](docs/files-and-storage.md).

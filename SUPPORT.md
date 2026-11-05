# Get help with Deep Fryer

Open **Help** in the app for illustrated instructions on effects, points, and saving. The [README](README.md) covers installation, a first edit, and current limits.

## Troubleshoot common problems

- If an image will not open, use PNG or JPEG within 64 MiB, 16,384 pixels per side, and 24 million pixels total. Renaming an unsupported file does not convert it.
- If Save As, a preset save, or image export reports that a file exists, choose a new name. These actions create new files even when the Windows chooser offers replacement. In the 0.5.0 source, ordinary **Save project** can update the project opened or saved in this session. If that save refuses a changed or unsupported destination, use **Save project as…** to keep a separate copy.
- If an edit looks different after export, inspect the final output at its chosen dimensions. Effects run after resizing, and JPEG or WebP compression changes pixels.
- If pasted output differs from export settings, use Export instead. Copy image always creates a PNG at the source's oriented dimensions.
- If interrupted work is offered on restart, choose **Restore work** to resume it. Recovery is temporary. Save a project to retain an edit after a clean exit.
- If Windows warns about the installer, read the [unsigned-release and checksum guidance](README.md#download-for-windows). A checksum does not remove the warning or establish publisher identity.

## Report a bug or request a feature

Search [existing issues](https://github.com/ShiosOS/Deep-Fryer/issues), then use the [issue forms](https://github.com/ShiosOS/Deep-Fryer/issues/new/choose). Include the app version, Windows version, exact steps, expected result, actual result, and any error text. Mention whether you used the installer or a development build.

For image-related failures, include dimensions and file type. Attach a small non-sensitive sample only when you have permission to share it. Projects contain the original source bytes. Public issues are visible to everyone.

GitHub issues have no guaranteed response time. Feature requests do not imply a delivery commitment. See the [security policy](SECURITY.md) before reporting a vulnerability.

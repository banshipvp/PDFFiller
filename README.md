# PDF Filler

A local desktop PDF filling app for adding and exporting common document markups without sending files to a server.

## Features

- Open and render multi-page PDFs.
- Windows desktop app with installer, shortcuts, PDF file association support, and in-place updates.
- Page thumbnails in the left sidebar.
- Ctrl-scroll zooms the PDF canvas instead of the whole application.
- Click detected form fields or underline-style fill areas to create a focused input box.
- Add movable and resizable text boxes.
- Click with the text tool to start typing immediately.
- Detect editable PDF text runs and convert them into movable/editable overlay text boxes.
- Add date stamps.
- Create and save multiple signatures.
- Create and save multiple initials.
- Place signatures and initials anywhere on the PDF.
- Draw freehand ink marks.
- Add whiteout boxes for erasing/covering existing content.
- Add highlights.
- Add checkboxes.
- Add checkmarks, radio buttons, comments, sticky notes, arrows, circles, rectangles, tables, images, watermarks, and page numbers.
- Edit selected annotation text, color, size, bold state, checkbox state, and opacity.
- Save, export, and print.
- Export a flattened filled PDF.
- Save and reload annotation templates as JSON.
- Use prefill entries such as `Name = Alex Smith`; matching real PDF form fields are also populated on export.

PDFs that contain real selectable text can have text detected and converted into editable overlays. Scanned/image-only PDFs need OCR before their printed text can become editable.

## Run

### Desktop App

The packaged Windows app is in `desktop-release`.

- Installer: `desktop-release/PDF-Filler-Setup-1.0.13.exe`
- Unpacked app: `desktop-release/win-unpacked/PDF Filler.exe`

Use the installer once if you want desktop/start-menu shortcuts, PDF file association registration, and automatic in-place updates. After that, open `PDF Filler` from the desktop shortcut, Start menu, or by double-clicking a PDF.

### Development

```bash
npm install
npm run dev
```

Then open `http://127.0.0.1:5173`.

To run the desktop app from source:

```bash
npm run desktop
```

## Build

```bash
npm run build
```

To rebuild the Windows installer:

```bash
npm run dist:win
```

The installed app is replaced in place when you install a newer version or when auto-update installs a GitHub Release. A portable EXE can still be built for testing with `npm run dist:win:portable`, but portable builds are not the recommended everyday app.

## Windows Startup

Open the desktop app, go to the `Desktop` section in the right panel, and turn on `Start with Windows`.

## Auto Updates

The updater is configured for GitHub Releases at `banshipvp/PDFFiller`.

To release an update:

```bash
npm run release:patch
```

That bumps the version, creates a git tag, and pushes the source/tag to GitHub. GitHub Actions then builds the Windows installer and uploads it to the GitHub Release. Installed copies of PDF Filler check that release feed on startup and can also check manually from the `Check Updates` button.

You can still use a normal website folder by choosing `Website folder` and uploading `latest.yml`, the installer, and the blockmap from `desktop-release`.

## Default PDF App

Install PDF Filler with `desktop-release/PDF-Filler-Setup-1.0.13.exe`, then set it as your PDF default in Windows:

1. Open `Settings`.
2. Go to `Apps`.
3. Go to `Default apps`.
4. Choose `PDF Filler`, or search for `.pdf`.
5. Set `.pdf` to `PDF Filler`.

Windows requires the user to choose the final default app. The installer registers PDF Filler as a PDF-capable app, and the app has a `Default Apps` button that opens the right Windows settings page.

# Changelog

All notable changes to the live texture editing branch are documented here.

## 1.5.1 — Photoshop modal-scope fix

- Moved the Photoshop composite pixel read into a short
  `core.executeAsModal()` operation, as required by the Photoshop host.
- Copied and disposed the Imaging API pixel buffer before leaving modal scope.
- Kept Doom palette conversion and WebView messaging outside modal scope.

## 1.5.0 — Layered Photoshop texture editing

- Added **Open Texture**, **Apply Texture**, and **Restore original** controls
  for the `COMPUTE2` wall texture.
- Opened the texture as an 8-bit RGB Photoshop document with separate
  **Original** and **Your edits** layers.
- Read the editable document composite without flattening, converting,
  closing, or saving it.
- Quantized applied RGB pixels to Doom's original PLAYPAL palette.
- Updated the existing cached Three.js texture without reloading the game,
  map, or WebView.

## 1.4.0 — Live replacement proof

- Added the first in-place `COMPUTE2` wall-texture replacement.
- Added Apply and Restore controls for a generated checker texture.
- Preserved and restored the original WAD texture pixels.

## 1.3.0 — Offline Photoshop WebView build

- Embedded the shareware WAD in the generated browser bundle to avoid local
  WebView fetch and CORS failures.
- Added visible startup diagnostics and a selectable, copyable boot log.
- Kept Doom, Three.js, and all runtime assets local to the plugin.

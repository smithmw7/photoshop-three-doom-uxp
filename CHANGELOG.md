# Changelog

All notable changes to the live texture editing branch are documented here.

## 1.6.2 — Current-map texture visibility

- Added the current map's live mesh count to every texture entry.
- Sorted textures used by the current map before unused WAD textures.
- Marked picker cards as `LIVE` or `OFF MAP`.
- Reported a zero-mesh Apply as stored but not visible in the current map,
  instead of implying that an on-screen wall was updated.
- Confirmed that the previously reported `BIGDOOR1` selection has zero meshes
  in E1M1, while `COMPUTE2` and `BROWN1` each update a live E1M1 mesh.
- Confirmed the complete Select, Open, Apply, and Restore workflow in the real
  Photoshop 2026 UXP host.

## 1.6.1 — Stable texture toolbar height

- Shortened the texture editor's secondary status messages.
- Reduced the status font to 9 px and fixed the line height at 11 px.
- Capped visible status text at 44 characters with an ellipsis.
- Preserved the full uncropped message in the tooltip and Boot log.
- Prevented long status and error text from wrapping or changing the panel
  layout.

## 1.6.0 — Wall-texture browser

- Added a **Select Texture** button and an in-game scrolling thumbnail grid.
- Listed all 125 wall textures defined by the shareware WAD.
- Added a thumbnail, name, and dimensions for every texture.
- Made Open, Apply, and Restore target the current selection instead of the
  fixed `COMPUTE2` texture.
- Preserved previously opened Photoshop documents when changing selections
  while safely detaching them from the editor controls.
- Kept selection and texture updates inside the existing local UXP WebView
  message bridge.

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

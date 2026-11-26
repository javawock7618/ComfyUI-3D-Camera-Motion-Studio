# ComfyUI-3D-Camera-Motion-Studio

A lightweight, camera-motion-focused 3D scene and keyframe studio custom node for ComfyUI. Designed to be simple, fast, and practical for pre-visualization and video generation workflows such as `MiniMax-H3 Ref2VA ControlNet`.

## Concept

* **Simple & Lightweight**: Fast browser-based 3D viewport powered by Three.js without heavy scene bloat.
* **Multi-Keyframe Control**: Smoothly choreograph multi-point camera paths, per-interval easing, FOV transitions, and keyframed object motion.
* **Camera Motion First**: Built specifically for framing, camera trajectories, and exportable image sequences for downstream video pipelines.

## Key Features

* **3D Viewport & Models**:
  * Load `.glb` models with animation clip selection and frame-synced playback (`GLB Motion` + `Sync`).
  * One-click primitive shape buttons (`Box`, `Sphere`, `Cylinder`, `Plane`, `Cone`).
  * Interactive RGB gizmo (`Move (XYZ)` / `Rotate`), numeric/drag transform inputs (`Position`, `Rotation`, `Scale`), and `Reset`.
* **Keyframes & Editing Tempo**:
  * Add (`◆ Add KF`), overwrite (`✎ Upd`), delete (`✕ Del`), reset (`↺ Reset`), and jump between keyframes (`◀` / `▶`).
  * Drag keyframe diamond markers (`◆`) horizontally on the timeline to adjust frame timing with automatic collision avoidance.
  * Per-interval easing (`Linear`, `Ease In`, `Ease Out`, `Ease In-Out`), camera vertical `FOV` (`30°`–`75°`), and `◎ Tgt` quick target snapping.
  * `Undo` (`↶` / `Ctrl+Z`) and `Redo` (`↷` / `Ctrl+Y` or `Ctrl+Shift+Z`) history stack.
  * Keyframed transforms for both camera and 3D objects/shapes, plus optional `Path` guide overlay.
* **Export & Presets**:
  * Export render mode selector (`Out`: `Standard`, `Wireframe`, `Depth`, `Normal`) and `Grid` toggle for `Export Images`.
  * Save and restore scene, model transforms, and keyframe presets via JSON (`Save JSON` / `Load JSON`).
  * Compatible with ComfyUI Nodes 1.0 and 2.0 with persistent node window sizing.

## Installation

1. Clone or extract this repository into `ComfyUI/custom_nodes/ComfyUI-3D-Camera-Motion-Studio`.
2. Install Python requirements if needed (`pip install -r requirements.txt` — `numpy` and `Pillow` are standard in ComfyUI).
3. Restart ComfyUI and hard-refresh your browser (`Ctrl+F5` / `Cmd+Shift+R`).

## Release

* Current version: `v0.1`

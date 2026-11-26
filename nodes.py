import base64
import io
import json
import os
import numpy as np
import torch
from PIL import Image
import folder_paths


class Camera3DStudioNode:
    """
    Render batch IMAGES from camera keyframes over a 3D scene (.glb).
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "width": ("INT", {"default": 512, "min": 64, "max": 2048, "step": 8}),
                "height": ("INT", {"default": 512, "min": 64, "max": 2048, "step": 8}),
                "total_frames": ("INT", {"default": 24, "min": 2, "max": 300, "step": 1}),
                "fps": ("FLOAT", {"default": 24.0, "min": 1.0, "max": 120.0, "step": 0.1}),
            },
            "optional": {
                "frames_payload": ("STRING", {"default": "", "multiline": False}),
            },
        }

    RETURN_TYPES = ("IMAGE", "INT", "FLOAT")
    RETURN_NAMES = ("images", "frame_count", "fps")
    FUNCTION = "render_batch"
    CATEGORY = "3D / Camera Studio"

    def _decode_b64_image(self, b64_str: str, width: int, height: int) -> np.ndarray:
        if "," in b64_str:
            b64_str = b64_str.split(",", 1)[1]
        img_bytes = base64.b64decode(b64_str)
        pil_img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        if pil_img.size != (width, height):
            pil_img = pil_img.resize((width, height), Image.Resampling.LANCZOS)
        return np.array(pil_img, dtype=np.float32) / 255.0

    def _find_batch_file(self, rel_or_name: str):
        temp_dir = folder_paths.get_temp_directory()
        clean = rel_or_name.lstrip("/\\")
        candidates = [
            os.path.join(temp_dir, "camera_3d_studio", os.path.basename(clean)),
            os.path.join(temp_dir, clean),
            os.path.join(temp_dir, os.path.basename(clean)),
        ]
        for path in candidates:
            if os.path.isfile(path):
                return path
        return None

    def render_batch(self, width: int, height: int, total_frames: int, fps: float = 24.0, frames_payload: str = ""):
        images = []

        if frames_payload:
            try:
                raw = frames_payload.strip()
                if ":" in raw and raw.split(":", 1)[0].startswith("studio_batch"):
                    payload_ref = raw.split(":", 1)[1].strip()
                    batch_file = self._find_batch_file(payload_ref)
                    if batch_file:
                        with open(batch_file, "r", encoding="utf-8") as f:
                            data = json.load(f)
                        for b64_str in data.get("frames", []):
                            images.append(self._decode_b64_image(b64_str, width, height))
                    else:
                        print(f"[3D Camera Motion Studio] Batch file not found for ref: {payload_ref}")
                else:
                    data = json.loads(raw)
                    for b64_str in data.get("frames", []):
                        images.append(self._decode_b64_image(b64_str, width, height))
            except Exception as e:
                print(f"[3D Camera Motion Studio] Payload parse error: {e}")

        if not images:
            print("[3D Camera Motion Studio] Warning: No decoded frames; returning blank fallback frames.")
            blank = np.zeros((height, width, 3), dtype=np.float32)
            images = [blank for _ in range(max(1, total_frames))]

        batch_tensor = torch.from_numpy(np.stack(images, axis=0))
        return (batch_tensor, batch_tensor.shape[0], float(fps))


NODE_CLASS_MAPPINGS = {
    "Camera3DStudioNode": Camera3DStudioNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "Camera3DStudioNode": "3D Camera Motion Studio",
}

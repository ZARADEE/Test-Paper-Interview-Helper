"""Normalize body scale across clips without frame-by-frame resizing."""
import json
import statistics
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "frontend/public/assets"
SCRATCH = ROOT / "frontend/out/pet-source-frames"
SIZE, PADDING = 256, 12


def read_clips(pack):
    clips = {}
    for action in (("idle", "walk", "click") if pack == "maid" else ("idle", "walk", "click", "special")):
        if pack == "maid":
            frames = [Image.open(p).convert("RGBA") for p in sorted((SCRATCH / action).glob("*.png"))]
            durations = [50] * len(frames)
        else:
            frames, durations = [], []
            with Image.open(ASSETS / pack / (action + ".gif")) as image:
                for i in range(image.n_frames):
                    image.seek(i)
                    frames.append(image.convert("RGBA").copy())
                    durations.append(image.info.get("duration", 80))
        if not frames:
            raise ValueError("Missing source frames: " + pack + "/" + action)
        boxes = []
        for frame in frames:
            alpha = frame.getchannel("A").point(lambda v: 0 if v < 20 else v)
            frame.putalpha(alpha)
            boxes.append(alpha.getbbox())
        bounds = (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))
        clips[action] = (frames, durations, boxes, bounds)
    return clips


def build(pack):
    clips = read_clips(pack)
    # Use median body height instead of each clip's maximum gesture bounds.
    # Keep a single scale inside each clip, preserving its original motion.
    medians = {a: statistics.median(b[3] - b[1] for b in item[2]) for a, item in clips.items()}
    target_height = min((SIZE - 2 * PADDING) * medians[a] / max(item[3][2] - item[3][0], item[3][3] - item[3][1]) for a, item in clips.items())
    metadata = {}
    for action, (frames, durations, boxes, bounds) in clips.items():
        scale = target_height / medians[action]
        width, height = bounds[2] - bounds[0], bounds[3] - bounds[1]
        target = (round(width * scale), round(height * scale))
        normalized = []
        for frame in frames:
            canvas = Image.new("RGBA", (SIZE, SIZE))
            crop = frame.crop(bounds).resize(target, Image.Resampling.LANCZOS)
            canvas.alpha_composite(crop, ((SIZE - target[0]) // 2, SIZE - PADDING - target[1]))
            normalized.append(canvas)
        directory = ASSETS / pack
        destination = directory / (action + ".webp")
        normalized[0].save(destination, save_all=True, append_images=normalized[1:], duration=durations, loop=0, quality=86, method=4)
        normalized[0].save(destination.with_suffix(".png"))
        new_boxes = [f.getchannel("A").getbbox() for f in normalized]
        union = [min(b[0] for b in new_boxes), min(b[1] for b in new_boxes), max(b[2] for b in new_boxes), max(b[3] for b in new_boxes)]
        metadata[action] = dict(bounds=union, durationMs=sum(durations), medianBodyHeight=statistics.median(b[3]-b[1] for b in new_boxes), scale=scale)
        if pack == "doro" and action == "walk":
            normalized[0].resize((48,48),Image.Resampling.LANCZOS).save(directory/"icon.png")
    if pack == "maid":metadata["special"] = metadata["click"]
    (ASSETS / pack / "bounds.json").write_text(json.dumps({a:v["bounds"] for a,v in metadata.items()}))
    print(pack, metadata, flush=True)
    return metadata


if __name__ == "__main__":
    result = {pack:build(pack) for pack in ("maid", "doro")}
    (ROOT / "frontend/src/petAnimations.json").write_text(json.dumps(result,indent=2))

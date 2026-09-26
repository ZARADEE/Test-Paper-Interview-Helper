"""Build consistent transparent 256px desktop animation canvases from source frames."""
from pathlib import Path
import json
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "frontend/public/assets"
SCRATCH = ROOT / "frontend/out/pet-source-frames"
SIZE = 256
PADDING = 12


def normalize(frames, durations, destination):
    cleaned = []
    bounds = None
    for frame in frames:
        frame = frame.convert("RGBA")
        alpha = frame.getchannel("A").point(lambda value: 0 if value < 20 else value)
        frame.putalpha(alpha)
        box = alpha.getbbox()
        if box:
            bounds = box if bounds is None else (min(bounds[0], box[0]), min(bounds[1], box[1]), max(bounds[2], box[2]), max(bounds[3], box[3]))
        cleaned.append(frame)
    if bounds is None:
        raise ValueError(f"Empty animation: {destination}")
    width, height = bounds[2] - bounds[0], bounds[3] - bounds[1]
    scale = min((SIZE - 2 * PADDING) / width, (SIZE - 2 * PADDING) / height)
    target = (round(width * scale), round(height * scale))
    normalized = []
    for frame in cleaned:
        frame = frame.crop(bounds).resize(target, Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", (SIZE, SIZE))
        canvas.alpha_composite(frame, ((SIZE - target[0]) // 2, SIZE - PADDING - target[1]))
        normalized.append(canvas)
    destination.parent.mkdir(parents=True, exist_ok=True)
    normalized[0].save(destination, save_all=True, append_images=normalized[1:], duration=durations, loop=0, quality=86, method=4)
    normalized[0].save(destination.with_suffix(".png"))
    hitbox = normalized[0].getchannel("A").getbbox()
    for frame in normalized[1:]:
        box = frame.getchannel("A").getbbox()
        hitbox = (min(hitbox[0], box[0]), min(hitbox[1], box[1]), max(hitbox[2], box[2]), max(hitbox[3], box[3]))
    metadata = destination.parent / "bounds.json"
    boxes = json.loads(metadata.read_text()) if metadata.exists() else {}
    boxes[destination.stem] = list(hitbox)
    metadata.write_text(json.dumps(boxes))
    print(destination.relative_to(ROOT), len(normalized), "frames", "source bounds", bounds, "target", target)
    return normalized[0]


for action in ("idle", "walk", "click"):
    folder = SCRATCH / action
    frames = [Image.open(path).convert("RGBA") for path in sorted(folder.glob("*.png"))]
    normalize(frames, [50] * len(frames), ASSETS / "maid" / f"{action}.webp")

for action in ("idle", "walk", "click", "special"):
    with Image.open(ASSETS / "doro" / f"{action}.gif") as source:
        frames, durations = [], []
        for index in range(source.n_frames):
            source.seek(index)
            frames.append(source.convert("RGBA").copy())
            durations.append(source.info.get("duration", 80))
    first = normalize(frames, durations, ASSETS / "doro" / f"{action}.webp")
    if action == "walk":
        first.resize((48, 48), Image.Resampling.LANCZOS).save(ASSETS / "doro/icon.png")

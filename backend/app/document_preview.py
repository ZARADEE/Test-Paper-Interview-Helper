from __future__ import annotations

import io
import textwrap
from pathlib import Path
from typing import Any

from .extractors import extract_document
from .paired_pdf_import import render_source_preview


def _wrap_text(text: str, width: int = 52) -> list[str]:
    lines: list[str] = []
    for paragraph in text.splitlines():
        stripped = paragraph.strip()
        if not stripped:
            lines.append("")
            continue
        if len(stripped) <= width:
            lines.append(stripped)
            continue
        wrapped = textwrap.wrap(
            stripped,
            width=width,
            break_long_words=True,
            break_on_hyphens=False,
        )
        lines.extend(wrapped or [stripped])
    return lines or [text.strip()]


def render_text_image(text: str, *, title: str = "文档预览") -> bytes:
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError as error:  # pragma: no cover - environment dependent
        raise RuntimeError("缺少 Pillow，无法渲染文本预览。") from error

    font = ImageFont.load_default()
    body_lines = _wrap_text(text.strip() or "（空文档）")
    all_lines = [title, "", *body_lines]
    line_height = 16
    width = 1100
    height = max(240, 28 + len(all_lines) * line_height + 24)
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    y = 18
    draw.rectangle((12, 12, width - 12, height - 12), outline="black", width=2)
    draw.text((28, y), title, fill="black", font=font)
    y += 28
    for line in body_lines[:220]:
        draw.text((28, y), line, fill="black", font=font)
        y += line_height
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def render_document_preview(path: Path, regions: list[dict[str, Any]] | None = None) -> bytes:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return render_source_preview(path, regions or [])
    if suffix in {".png", ".jpg", ".jpeg", ".bmp", ".gif", ".webp"}:
        try:
            from PIL import Image
        except ImportError as error:  # pragma: no cover - environment dependent
            raise RuntimeError("缺少 Pillow，无法渲染图片预览。") from error
        with Image.open(path) as image:
            converted = image.convert("RGB")
            buffer = io.BytesIO()
            converted.save(buffer, format="PNG")
            return buffer.getvalue()
    pages = extract_document(path)
    text = "\n\n".join(page.text for page in pages if page.text.strip())
    return render_text_image(text or path.name, title=path.name)

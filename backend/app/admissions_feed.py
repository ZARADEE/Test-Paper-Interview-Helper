from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache
from datetime import date, datetime, timedelta, timezone
from html import unescape
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen


DATE_PATTERN = re.compile(r"20\d{2}-\d{2}-\d{2}")
BLOCK_TAGS = {"li", "tr", "p", "dd", "dt"}


@dataclass(frozen=True)
class FeedSource:
    label: str
    url: str


SOURCES = [
    FeedSource("研招资讯", "https://yz.chsi.com.cn/kyzx/"),
    FeedSource("院校政策", "https://yz.chsi.com.cn/kyzx/yxzc/"),
    FeedSource("政策导航", "https://yz.chsi.com.cn/kyzx/zcdh/"),
]

SCORELINE_INDEX_URL = "https://yz.chsi.com.cn/kyzx/fsfsx34/"
SCORELINE_PAGE_STARTS = [index * 80 for index in range(9)]


class _BlockParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.blocks: list[dict[str, Any]] = []
        self._depth = 0
        self._current: dict[str, Any] | None = None
        self._current_anchor: dict[str, Any] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in BLOCK_TAGS:
            self._depth += 1
            if self._depth == 1:
                self._current = {"text": [], "anchors": []}
            return
        if self._depth and tag == "a" and self._current is not None:
            href = dict(attrs).get("href") or ""
            self._current_anchor = {"href": href, "text": []}

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._current_anchor is not None and self._current is not None:
            text = "".join(self._current_anchor["text"]).strip()
            if text:
                self._current["anchors"].append({"href": self._current_anchor["href"], "text": text})
            self._current_anchor = None
            return
        if tag in BLOCK_TAGS and self._depth:
            self._depth -= 1
            if self._depth == 0 and self._current is not None:
                text = "".join(self._current["text"]).strip()
                if text or self._current["anchors"]:
                    self.blocks.append(self._current)
                self._current = None

    def handle_data(self, data: str) -> None:
        if not self._depth or self._current is None:
            return
        text = unescape(data)
        if self._current_anchor is not None:
            self._current_anchor["text"].append(text)
        self._current["text"].append(text)


def _fetch_html(url: str, timeout: int = 12) -> str:
    request = Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
            )
        },
    )
    with urlopen(request, timeout=timeout) as response:
        raw = response.read()
        charset = response.headers.get_content_charset() or "utf-8"
    return raw.decode(charset, errors="ignore")


def _fetch_bytes(url: str, timeout: int = 20) -> bytes:
    request = Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
            )
        },
    )
    with urlopen(request, timeout=timeout) as response:
        return response.read()


def _select_title(anchors: list[dict[str, Any]], text: str, date_text: str) -> tuple[str, str]:
    candidates: list[tuple[int, str, str]] = []
    for anchor in anchors:
        href = str(anchor.get("href") or "").strip()
        title = str(anchor.get("text") or "").strip()
        if not title:
            continue
        if title in {"更多", "查看更多"}:
            continue
        candidates.append((len(title), href, title))
    if candidates:
        _, href, title = max(candidates, key=lambda item: item[0])
        return title, href

    compact = re.sub(r"\s+", " ", text).strip()
    compact = compact.replace(date_text, "").strip(" ·|-—|")
    return compact, ""


def _parse_blocks(html_text: str, base_url: str, category: str) -> list[dict[str, Any]]:
    parser = _BlockParser()
    parser.feed(html_text)
    items: list[dict[str, Any]] = []
    for block in parser.blocks:
        text = re.sub(r"\s+", " ", "".join(block["text"])).strip()
        if not text:
            continue
        date_match = DATE_PATTERN.search(text)
        if not date_match:
            continue
        published_at = date.fromisoformat(date_match.group(0))
        title, href = _select_title(block["anchors"], text, date_match.group(0))
        if not title:
            continue
        items.append(
            {
                "title": title,
                "url": urljoin(base_url, href) if href else base_url,
                "category": category,
                "published_at": published_at.isoformat(),
                "source": "研招网",
            }
        )
    return items


def fetch_recent_official_feed(max_age_days: int = 365, per_source_limit: int = 6, total_limit: int = 18) -> dict[str, Any]:
    cutoff = date.today() - timedelta(days=max_age_days)
    collected: list[dict[str, Any]] = []
    errors: list[str] = []
    for source in SOURCES:
        try:
            html_text = _fetch_html(source.url)
            items = _parse_blocks(html_text, source.url, source.label)
            collected.extend(
                item for item in items if date.fromisoformat(item["published_at"]) >= cutoff
            )
        except Exception as error:  # pragma: no cover - network/runtime dependent
            errors.append(f"{source.label}: {error}")

    collected.sort(key=lambda item: (item["published_at"], item["title"]), reverse=True)

    grouped: list[dict[str, Any]] = []
    seen: dict[str, int] = {}
    for item in collected:
        if len(grouped) >= total_limit:
            break
        category = item["category"]
        count = seen.get(category, 0)
        if count >= per_source_limit:
            continue
        seen[category] = count + 1
        grouped.append(item)

    return {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "max_age_days": max_age_days,
        "items": grouped,
        "errors": errors,
    }


def _parse_scoreline_title(title: str) -> tuple[str, int | None]:
    match = re.search(r"(20\d{2})年", title)
    if not match:
        return title.strip(), None
    school = title[: match.start()].strip(" ·|-—、")
    return (school or title.strip(), int(match.group(1)))


def _parse_scoreline_list_page(html_text: str, base_url: str) -> list[dict[str, Any]]:
    parser = _BlockParser()
    parser.feed(html_text)
    items: list[dict[str, Any]] = []
    for block in parser.blocks:
        text = re.sub(r"\s+", " ", "".join(block["text"])).strip()
        if not text:
            continue
        date_match = DATE_PATTERN.search(text)
        if not date_match:
            continue
        title, href = _select_title(block["anchors"], text, date_match.group(0))
        if not title:
            continue
        school, year = _parse_scoreline_title(title)
        if year is None:
            continue
        items.append(
            {
                "school": school,
                "title": title,
                "url": urljoin(base_url, href) if href else base_url,
                "published_at": date.fromisoformat(date_match.group(0)).isoformat(),
                "year": year,
                "source": "研招网",
            }
        )
    return items


def fetch_scoreline_index(target_year: int | None = None) -> dict[str, Any]:
    if target_year is None:
        target_year = date.today().year - 1
    collected: list[dict[str, Any]] = []
    errors: list[str] = []
    for start in SCORELINE_PAGE_STARTS:
        page_url = SCORELINE_INDEX_URL if start == 0 else f"{SCORELINE_INDEX_URL}?start={start}"
        try:
            html_text = _fetch_html(page_url)
            collected.extend(
                item for item in _parse_scoreline_list_page(html_text, page_url) if item["year"] == target_year
            )
        except Exception as error:  # pragma: no cover - network/runtime dependent
            errors.append(f"第{start // 80 + 1}页: {error}")

    deduped: dict[str, dict[str, Any]] = {}
    for item in collected:
        school = item["school"]
        current = deduped.get(school)
        if current is None or item["published_at"] > current["published_at"]:
            deduped[school] = item

    items = sorted(deduped.values(), key=lambda item: (item["published_at"], item["school"]), reverse=True)
    return {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "target_year": target_year,
        "items": items,
        "errors": errors,
    }


class _ScorelineDetailParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._capturing = False
        self._depth = 0
        self._parts: list[str] = []
        self.image_urls: list[str] = []
        self.pdf_urls: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_map = {name: value or "" for name, value in attrs}
        class_names = set(str(attrs_map.get("class") or "").split())
        if not self._capturing and tag == "div" and "detail" in class_names and str(attrs_map.get("id") or "").startswith("article_"):
            self._capturing = True
            self._depth = 1
            return
        if not self._capturing:
            return
        self._depth += 1
        if tag == "a":
            href = str(attrs_map.get("href") or "").strip()
            if href.lower().endswith(".pdf"):
                self.pdf_urls.append(href)
        elif tag == "img":
            src = str(attrs_map.get("src") or attrs_map.get("data-src") or "").strip()
            if src:
                self.image_urls.append(src)
        elif tag == "br":
            self._parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if not self._capturing:
            return
        if tag in {"p", "div", "li", "tr", "section", "article"}:
            self._parts.append("\n")
        self._depth -= 1
        if self._depth <= 0:
            self._capturing = False

    def handle_data(self, data: str) -> None:
        if self._capturing:
            text = unescape(data)
            if text:
                self._parts.append(text)

    def text(self) -> str:
        raw = "".join(self._parts)
        raw = re.sub(r"[ \t\r\f\v]+", " ", raw)
        raw = re.sub(r"\n{3,}", "\n\n", raw)
        return raw.strip()


def _extract_pdf_text(pdf_bytes: bytes) -> str:
    try:
        import fitz
    except Exception:
        return ""
    try:
        document = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception:
        return ""
    parts: list[str] = []
    try:
        for page in document:
            text = page.get_text("text").strip()
            if text:
                parts.append(text)
    finally:
        document.close()
    combined = "\n".join(parts).strip()
    combined = re.sub(r"[ \t\r\f\v]+", " ", combined)
    combined = re.sub(r"\n{3,}", "\n\n", combined)
    return combined


def _extract_scoreline_sections(text: str) -> list[str]:
    sections: list[str] = []
    if not text:
        return sections
    keywords = (
        "统考生",
        "单考生",
        "专项计划",
        "学术学位",
        "专业学位",
        "全日制",
        "非全日制",
        "报考",
        "复试",
    )
    for raw_line in text.splitlines():
        line = re.sub(r"\s+", " ", raw_line).strip(" ：:、。-—")
        if not line or len(line) > 48:
            continue
        if any(keyword in line for keyword in keywords):
            sections.append(line)
            continue
        match = re.match(r"^(?:[一二三四五六七八九十]+|\d+)[、.．]\s*(.+)$", line)
        if match:
            candidate = match.group(1).strip()
            if candidate and len(candidate) <= 32:
                sections.append(candidate)
    deduped: list[str] = []
    seen: set[str] = set()
    for section in sections:
        if section not in seen:
            seen.add(section)
            deduped.append(section)
    return deduped[:12]


def _validate_scoreline_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("只支持研招网复试分数线页面。")
    if parsed.netloc != "yz.chsi.com.cn":
        raise ValueError("只支持研招网复试分数线页面。")
    if not parsed.path.startswith("/kyzx/fsfsx34/"):
        raise ValueError("只支持研招网复试分数线页面。")
    return parsed.geturl()


@lru_cache(maxsize=128)
def fetch_scoreline_detail(url: str) -> dict[str, Any]:
    normalized_url = _validate_scoreline_url(url)
    html_text = _fetch_html(normalized_url)
    parser = _ScorelineDetailParser()
    parser.feed(html_text)
    content = parser.text() or "暂无正文。"
    content = re.sub(r"\n?----\n?点击下载:[^\n]+", "", content).strip()
    pdf_url = urljoin(normalized_url, parser.pdf_urls[0]) if parser.pdf_urls else None
    image_url = urljoin(normalized_url, parser.image_urls[0]) if parser.image_urls else None
    if pdf_url:
        try:
            pdf_text = _extract_pdf_text(_fetch_bytes(pdf_url))
            if len(pdf_text) > len(content):
                content = pdf_text
        except Exception:
            pass
    sections = _extract_scoreline_sections(content)
    return {
        "url": normalized_url,
        "pdf_url": pdf_url,
        "image_url": image_url,
        "sections": sections,
        "content": content,
    }

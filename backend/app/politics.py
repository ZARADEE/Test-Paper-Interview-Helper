from __future__ import annotations

import re
from typing import Iterable


POLITICS_SUBJECT = "考研政治"
POLITICS_MAJORS = (
    "马克思主义基本原理",
    "毛泽东思想和中国特色社会主义理论体系",
    "中国近现代史纲要",
    "思想道德与法治",
    "形势与政策以及当代世界经济与政治",
)
GENERIC_SUBTAGS = {
    "题目",
    "答案",
    "答案解析",
    "解析",
    "综合",
    "综合题",
    "政治",
    "考研政治",
}

MAJOR_HINTS: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        POLITICS_MAJORS[0],
        (
            "马克思主义",
            "辩证唯物主义",
            "历史唯物主义",
            "认识论",
            "政治经济学",
            "资本",
            "商品",
            "剩余价值",
            "共产主义",
            "科学社会主义",
            "唯物",
            "矛盾",
        ),
    ),
    (
        POLITICS_MAJORS[1],
        (
            "毛泽东",
            "新民主主义",
            "社会主义建设",
            "改革开放",
            "中国特色社会主义",
            "习近平新时代",
            "中国化时代化",
            "三个代表",
            "科学发展观",
        ),
    ),
    (
        POLITICS_MAJORS[2],
        (
            "近现代史",
            "鸦片战争",
            "辛亥革命",
            "抗日战争",
            "解放战争",
            "中国共产党历史",
            "五四运动",
            "新中国成立",
            "历史",
        ),
    ),
    (
        POLITICS_MAJORS[3],
        (
            "思想道德",
            "理想信念",
            "中国精神",
            "社会主义核心价值观",
            "道德",
            "法律",
            "法治",
            "宪法",
            "人生价值",
        ),
    ),
    (
        POLITICS_MAJORS[4],
        (
            "国际",
            "世界",
            "外交",
            "联合国",
            "全球",
            "形势与政策",
            "台湾",
            "一带一路",
            "和平发展",
            "时政",
        ),
    ),
)


def _clean_tag(value: str) -> str:
    value = re.sub(r"^[\s\-·•,，、:：]+|[\s\-·•,，、:：]+$", "", value)
    return re.sub(r"\s+", " ", value).strip()[:80]


def classify_major(text: str, hint: str = "") -> str:
    haystack = f"{hint}\n{text}"
    for major in POLITICS_MAJORS:
        if major in hint:
            return major
    for major, keywords in MAJOR_HINTS:
        if any(keyword in haystack for keyword in keywords):
            return major
    return POLITICS_MAJORS[4]


def classify_subtag(text: str, chapter: str = "", knowledge_points: Iterable[str] = ()) -> str:
    for value in knowledge_points:
        cleaned = _clean_tag(value)
        if cleaned and cleaned not in GENERIC_SUBTAGS:
            return cleaned
    cleaned_chapter = _clean_tag(chapter)
    if cleaned_chapter and cleaned_chapter not in GENERIC_SUBTAGS:
        return cleaned_chapter
    fallback = (
        ("哲学", ("哲学", "辩证", "认识", "唯物")),
        ("政治经济学", ("商品", "资本", "剩余价值", "经济")),
        ("中国化理论成果", ("毛泽东", "中国特色社会主义", "改革开放")),
        ("中国近现代史", ("鸦片", "革命", "抗日", "历史")),
        ("思想道德修养", ("道德", "理想", "人生", "精神")),
        ("法治中国", ("法律", "法治", "宪法")),
        ("国际形势与政策", ("国际", "世界", "外交", "全球")),
    )
    for tag, keywords in fallback:
        if any(keyword in text for keyword in keywords):
            return tag
    return ""


def normalize_politics_tags(
    text: str,
    chapter: str = "",
    knowledge_points: Iterable[str] = (),
    major_hint: str = "",
) -> tuple[str, str]:
    points = list(knowledge_points)
    major = classify_major(text, major_hint)
    subtag = classify_subtag(text, chapter, points)
    return major, subtag

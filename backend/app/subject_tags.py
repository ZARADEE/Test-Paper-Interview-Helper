"""Subject-aware classification; never rewrite other banks as mathematics."""
from .math_one import normalize_tag_pair


def normalize_question_tags(question):
    tags = question.get("tags") or []
    chapter = question.get("chapter") or ""
    points = question.get("knowledge_points") or []
    if question.get("subject") == "考研数学一":
        return normalize_tag_pair(tags, chapter, points)
    return list(dict.fromkeys(str(tag).strip() for tag in tags if str(tag).strip())) or ([chapter] if chapter else [])

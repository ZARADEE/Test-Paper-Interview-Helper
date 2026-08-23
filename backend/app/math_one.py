from __future__ import annotations

import re
from collections import Counter
from typing import Any


SUBJECT = "考研数学一"

MAJOR_GROUPS = (
    "高等数学",
    "线性代数",
    "概率论与数理统计",
)

POLITICS_MAJOR_GROUPS = (
    "马克思主义基本原理",
    "毛泽东思想和中国特色社会主义理论体系",
    "中国近现代史纲要",
    "思想道德与法治",
    "形势与政策以及当代世界经济与政治",
)

CHAPTERS: tuple[dict[str, Any], ...] = (
    {
        "name": "函数、极限与连续",
        "group": "高等数学",
        "keywords": ("极限", "连续", "无穷小", "间断点", "等价无穷小", "函数"),
    },
    {
        "name": "一元函数微分学",
        "group": "高等数学",
        "keywords": ("导数", "微分", "中值定理", "单调", "极值", "拐点", "切线", "泰勒"),
    },
    {
        "name": "一元函数积分学",
        "group": "高等数学",
        "keywords": ("不定积分", "定积分", "积分", "原函数", "变限积分", "反常积分"),
    },
    {
        "name": "多元函数微分学",
        "group": "高等数学",
        "keywords": ("偏导", "全微分", "方向导数", "梯度", "极值", "隐函数", "多元函数"),
    },
    {
        "name": "重积分与曲线曲面积分",
        "group": "高等数学",
        "keywords": ("二重积分", "三重积分", "曲线积分", "曲面积分", "格林", "高斯", "斯托克斯"),
    },
    {
        "name": "空间解析几何",
        "group": "高等数学",
        "keywords": ("空间解析几何", "空间直角坐标", "方向余弦", "直线方程", "平面方程"),
    },
    {
        "name": "重积分及其应用",
        "group": "高等数学",
        "keywords": ("重积分及其应用", "二重积分", "三重积分", "柱坐标", "球坐标"),
    },
    {
        "name": "曲线积分与曲面积分",
        "group": "高等数学",
        "keywords": ("曲线积分与曲面积分", "曲线积分", "曲面积分", "格林", "高斯", "斯托克斯"),
    },
    {
        "name": "微分方程",
        "group": "高等数学",
        "keywords": ("微分方程", "齐次方程", "伯努利", "二阶", "通解", "初值问题"),
    },
    {
        "name": "无穷级数",
        "group": "高等数学",
        "keywords": ("级数", "幂级数", "收敛", "发散", "傅里叶"),
    },
    {
        "name": "行列式与矩阵",
        "group": "线性代数",
        "keywords": ("行列式", "矩阵", "逆矩阵", "秩", "初等变换"),
    },
    {
        "name": "向量与线性方程组",
        "group": "线性代数",
        "keywords": ("向量", "线性相关", "线性无关", "方程组", "解空间", "基础解系"),
    },
    {
        "name": "特征值、特征向量与二次型",
        "group": "线性代数",
        "keywords": ("特征值", "特征向量", "相似", "二次型", "正定", "正惯性指数"),
    },
    {
        "name": "随机事件与概率",
        "group": "概率论与数理统计",
        "keywords": ("随机事件", "概率", "条件概率", "独立", "贝叶斯", "全概率"),
    },
    {
        "name": "随机变量及其分布",
        "group": "概率论与数理统计",
        "keywords": ("随机变量", "分布函数", "概率密度", "二项分布", "泊松分布", "正态分布"),
    },
    {
        "name": "多维随机变量",
        "group": "概率论与数理统计",
        "keywords": ("二维", "多维", "联合分布", "边缘分布", "协方差", "相关系数"),
    },
    {
        "name": "数字特征与大数定律",
        "group": "概率论与数理统计",
        "keywords": ("数学期望", "方差", "协方差", "大数定律", "中心极限定理"),
    },
    {
        "name": "数理统计",
        "group": "概率论与数理统计",
        "keywords": ("样本", "统计量", "抽样分布", "参数估计", "假设检验", "置信区间"),
    },
)

_CHAPTER_LOOKUP = {item["name"]: item for item in CHAPTERS}
_GROUP_ALIASES = {
    "高等数学": "高等数学",
    "高数": "高等数学",
    "线性代数": "线性代数",
    "线代": "线性代数",
    "概率论": "概率论与数理统计",
    "概率统计": "概率论与数理统计",
    "概率论与数理统计": "概率论与数理统计",
}


def normalize_group(value: str | None) -> str:
    if not value:
        return ""
    for alias, group in _GROUP_ALIASES.items():
        if alias in value:
            return group
    return value


def normalize_tag_pair(
    tags: list[str] | None,
    chapter: str | None = "",
    knowledge_points: list[str] | None = None,
) -> list[str]:
    """Return the canonical [major subject, subcategory] tag pair."""
    values: list[str] = []
    for value in tags or []:
        cleaned = str(value).strip()
        if cleaned and cleaned not in values:
            values.append(cleaned)

    # Politics uses the same two-slot tag contract but has a different major
    # catalog. Keep those values intact before applying the math fallback.
    politics_major = next(
        (
            value
            for value in [*values, chapter or ""]
            if value in POLITICS_MAJOR_GROUPS
        ),
        "",
    )
    if politics_major:
        subcategory = next(
            (
                value
                for value in values
                if value != politics_major and value not in POLITICS_MAJOR_GROUPS
            ),
            "",
        )
        if not subcategory:
            subcategory = next(
                (
                    str(point).strip()
                    for point in (knowledge_points or [])
                    if str(point).strip() and str(point).strip() not in POLITICS_MAJOR_GROUPS
                ),
                "",
            )
        return [politics_major, subcategory]

    major = ""
    for value in [*values, chapter or ""]:
        normalized = normalize_group(value)
        if normalized in MAJOR_GROUPS:
            major = normalized
            break
    if not major:
        major = chapter_group(chapter, values)

    subcategory = ""
    for value in values:
        if normalize_group(value) != major:
            subcategory = value
            break
    if not subcategory and chapter and normalize_group(chapter) != major:
        subcategory = chapter.strip()
    if not subcategory and major in POLITICS_MAJOR_GROUPS:
        subcategory = ""
    elif not subcategory:
        subcategory = next(
            (str(point).strip() for point in (knowledge_points or []) if str(point).strip()),
            "综合题",
        )
    return [major, subcategory]


def chapter_group(chapter: str | None, tags: list[str] | None = None) -> str:
    for value in [chapter or "", *(tags or [])]:
        normalized = normalize_group(value)
        if normalized in MAJOR_GROUPS:
            return normalized
        item = _CHAPTER_LOOKUP.get(value)
        if item:
            return item["group"]
    return "高等数学"


def question_type_from_text(text: str, section_hint: str = "") -> str:
    combined = f"{section_hint}\n{text}"
    if "选择题" in combined or re.search(r"(?m)^\s*[A-DＡ-Ｄ][.．、]\s+", text):
        return "choice"
    if "填空题" in combined or re.search(r"_{2,}|（\s*）|\(\s*\)", text):
        return "fill"
    return "solution"


def chapter_from_text(text: str) -> tuple[str, float]:
    scores: Counter[str] = Counter()
    for item in CHAPTERS:
        for keyword in item["keywords"]:
            if keyword in text:
                scores[item["name"]] += 1
    if not scores:
        return "综合题", 0.3
    chapter, score = scores.most_common(1)[0]
    total_keywords = sum(scores.values())
    confidence = min(0.95, 0.42 + score * 0.12 + (0.08 if score == total_keywords else 0))
    return chapter, confidence


def knowledge_points_from_text(text: str, chapter: str) -> list[str]:
    points: list[str] = []
    for keyword in _CHAPTER_LOOKUP.get(chapter, {}).get("keywords", ()):
        if keyword in text and keyword not in points:
            points.append(keyword)
    return points[:5]


def classify_math_one_text(text: str, section_hint: str = "") -> dict[str, Any]:
    question_type = question_type_from_text(text, section_hint)
    chapter, chapter_confidence = chapter_from_text(text)
    group = chapter_group(chapter)
    score = {"choice": 5, "fill": 5, "solution": 10}[question_type]
    options = []
    for match in re.finditer(r"(?m)^\s*([A-DＡ-Ｄ])[.．、]\s*(.+)$", text):
        key = match.group(1).translate(str.maketrans("ＡＢＣＤ", "ABCD"))
        options.append({"key": key, "text": match.group(2).strip()})

    return {
        "type": question_type,
        "subject": SUBJECT,
        "options": options,
        "tags": [group, chapter],
        "chapter": chapter,
        "knowledge_points": knowledge_points_from_text(text, chapter),
        "difficulty": "medium",
        "score": score,
        "confidence": chapter_confidence,
    }


def split_markdown_questions(text: str, year: int, source_name: str) -> list[dict[str, Any]]:
    section_pattern = re.compile(r"(?m)^#+\s*(一|二|三)[、.．]\s*([^\n]+)")
    number_pattern = re.compile(r"(?m)^\s*(\d{1,2})\s*[.．、]\s*")
    sections = list(section_pattern.finditer(text))
    questions: list[dict[str, Any]] = []

    for section_index, section_match in enumerate(sections):
        section_start = section_match.end()
        section_end = sections[section_index + 1].start() if section_index + 1 < len(sections) else len(text)
        section_text = text[section_start:section_end]
        section_hint = section_match.group(2).strip()
        matches = list(number_pattern.finditer(section_text))
        seen_numbers: set[int] = set()
        for question_index, match in enumerate(matches):
            raw_start = match.start()
            raw_end = matches[question_index + 1].start() if question_index + 1 < len(matches) else len(section_text)
            raw = section_text[raw_start:raw_end].strip()
            if not raw:
                continue
            number = int(match.group(1))
            if number in seen_numbers:
                continue
            seen_numbers.add(number)
            answer_match = re.search(r"\n\s*【答案】\s*", raw)
            analysis_match = re.search(r"\n\s*【解析】\s*", raw)
            stem_end = answer_match.start() if answer_match else (analysis_match.start() if analysis_match else len(raw))
            stem = raw[:stem_end].strip()
            answer = ""
            analysis = ""
            if answer_match:
                answer_end = analysis_match.start() if analysis_match else len(raw)
                answer = raw[answer_match.end():answer_end].strip()
            if analysis_match:
                analysis = raw[analysis_match.end():].strip()

            classified = classify_math_one_text(stem, section_hint)
            classified["id"] = f"math-one-{year}-{classified['type']}-{number:02d}"
            classified["stem_markdown"] = stem
            classified["answer_markdown"] = answer
            classified["analysis_markdown"] = analysis
            classified["scoring_points"] = []
            classified["source_name"] = source_name
            classified["source_year"] = year
            classified["source_question_number"] = number
            classified["review_status"] = "pending"
            questions.append(classified)
    return questions

"""Shared constraints for manual, deterministic and agent composition."""
from __future__ import annotations

import math
from typing import Any
from .practice import question_answer_mode


def template_errors(template: dict[str, Any]) -> list[str]:
    errors = []
    sections = template.get("sections", [])
    if not sections:
        errors.append("至少配置一个题型分区。")
    ids = [section.get("id") for section in sections]
    if any(not isinstance(value, str) or not value for value in ids) or len({str(value) for value in ids}) != len(ids):
        errors.append("分区 ID 必须非空且唯一。")
    total = 0.0
    for section in sections:
        count, score = section.get("count", 0), section.get("score", 0)
        if type(count) is not int or not 1 <= count <= 100:
            errors.append("每个分区题量必须为 1–100 的整数。")
        if type(score) not in (int, float) or not math.isfinite(score) or score <= 0:
            errors.append("每题分值必须为正数。")
        else:
            total += score * count if type(count) is int else 0
        if section.get("type") not in ("choice", "fill", "solution", "short_answer"):
            errors.append("不支持的题型。")
        filters = section.get("filters") or {}
        if not isinstance(filters, dict):
            errors.append("分区筛选必须是对象。")
        else:
            for key in ("tags", "knowledge_points"):
                if key in filters and (not isinstance(filters[key], list) or any(not isinstance(v, str) for v in filters[key])):
                    errors.append("标签和知识点筛选必须是字符串数组。")
            if filters.get("difficulty", "") not in ("", "easy", "medium", "hard"):
                errors.append("不支持的难度。")
            if filters.get("answer_mode", "") not in ("", "single", "multiple"):
                errors.append("不支持的选择题模式。")
    if abs(total - template.get("total_score", 0)) > 0.01:
        errors.append(f"分区合计 {total:g} 分，与模板总分不一致。")
    rules = template.get("distribution_rules", {})
    distribution = rules.get("chapter_distribution", [])
    if not isinstance(distribution, list) or any(not isinstance(rule, dict) for rule in distribution):
        return errors + ["科目占比必须是规则数组。"]
    if distribution:
        labels = [r.get("label") for r in distribution]
        if any(not isinstance(label, str) or not label.strip() for label in labels) or len({str(label) for label in labels}) != len(labels):
            errors.append("科目名称必须非空且唯一。")
        if any(type(r.get("tolerance", 0.08)) not in (int, float) or not math.isfinite(r.get("tolerance", 0.08)) or not 0 <= r.get("tolerance", 0.08) <= 1 for r in distribution):
            errors.append("科目容差必须在 0 到 1 之间。")
        ratios = [r.get("ratio", 0) for r in distribution]
        if any(type(r) not in (int, float) or not math.isfinite(r) or r < 0 for r in ratios):
            errors.append("科目占比必须为非负有限数字。")
        elif abs(sum(ratios) - 1) > 0.001:
            errors.append("科目占比合计必须为 100%。")
    if type(rules.get("agent_enabled", False)) is not bool:
        errors.append("Agent 开关必须为布尔值。")
    # Credentials belong to a compose request, never a saved template.
    def contains_secret(value: Any) -> bool:
        if isinstance(value, dict):
            return any(k.lower().replace("_", "") in ("apikey", "authorization", "token", "secret") or contains_secret(v) for k, v in value.items())
        return isinstance(value, list) and any(contains_secret(v) for v in value)
    if contains_secret(template):
        errors.append("模板中不能保存 API Key。请在组卷弹窗中填写。")
    return errors


def matches_section(question: dict, section: dict, required_tags: list[str]) -> bool:
    filters = section.get("filters") or {}
    return (
        question["type"] == section["type"]
        and set(required_tags + filters.get("tags", [])).issubset(question.get("tags", []))
        and (not filters.get("chapter") or filters["chapter"] == question.get("chapter"))
        and (not filters.get("difficulty") or filters["difficulty"] == question.get("difficulty"))
        and set(filters.get("knowledge_points", [])).issubset(question.get("knowledge_points", []))
        and (not filters.get("answer_mode") or filters["answer_mode"] == question_answer_mode(question.get("answer_markdown", "")))
    )

# 组卷助手设计文档

## 1. 项目定位

组卷助手是一个本地单用户桌面应用，用于将 PDF、Word 和结构化题库整理为可检索题目，并按照考试模板和分布规则自动生成试卷。

核心产品名为“组卷助手”，技术仓库名为 `Test-Paper-Interview-Helper`。

## 2. 目标与边界

### 目标

- 从 PDF、DOCX、DOC 中提取题目候选。
- 让用户在入库前审核和修正题目。
- 通过 tag、章节、知识点、难度和题型组织题库。
- 按模板和规则自动组卷。
- 生成题卷版和答案版。
- 导出 PDF 和 DOCX。
- 使用 Windows 一键脚本启动前后端。

### 首版边界

- 单用户、本地运行，不包含账号、权限和云端协作。
- 首版题型为选择题、填空题和解答题。
- 首版采用纯规则引擎，不接入大模型。
- 扫描 PDF 的 OCR 只保留接口，不阻塞文本 PDF 和 Word 流程。
- DOC 通过 LibreOffice 转为 DOCX 后解析。

## 3. 技术架构

```text
Electron Main Process
        |
        +-- preload / local desktop bridge
        |
Electron Renderer: React + TypeScript + Vite
        |
        | HTTP localhost
        v
FastAPI
        |
        +-- SQLite store
        +-- document extractors
        +-- deterministic composition engine
        +-- PDF/DOCX exporters
        |
        +-- backend/data/documents
        +-- backend/data/questions
        +-- backend/data/exports
```

### 前端

- Electron 负责桌面窗口和本地启动。
- React + TypeScript 负责工作台界面。
- Vite 负责开发服务器和构建。
- Lucide 图标用于工具按钮和导航。

### 后端

- FastAPI 提供本地 HTTP API。
- SQLite 作为运行时主存储。
- `PyMuPDF` 处理文本 PDF。
- `python-docx` 处理 DOCX。
- LibreOffice 负责 DOC 转 DOCX。
- `reportlab` 负责基础 PDF 导出。

## 4. 前端设计方向

使用 `new-brutalist-ai-ui` skill，设计命题为：

> 一台暴露结构的试卷装配台：左侧是功能轨道，中间是题目和模板工作区，右侧是规则检查与导出控制。

视觉约束：

- 2 到 4 像素高对比边框。
- 方角或近似方角，默认 `border-radius: 0`。
- 采用实体偏移阴影，不使用柔和阴影。
- 采用黄、青、蓝、红、紫和纸张色块表达状态。
- 不使用渐变、玻璃、模糊、光晕和装饰性背景。
- 首屏是工作界面，不是 landing page。
- 文本、按钮和题干在窄窗口下必须换行或收缩，不允许覆盖。

## 5. 页面结构

### 5.1 考研组卷

- 模板选择和试卷标题。
- 组卷随机种子。
- 科目、题型、章节、知识点、难度和 tag 约束。
- 当前规则摘要。
- 候选题目池。
- 已选题目和分区。
- 自动组卷、重新组卷、替换题目和锁定题目。
- 规则校验结果。
- 题卷版/答案版预览。
- PDF/DOCX 导出。

### 5.2 试题导入

- 文件选择和拖放区域。
- 导入文件列表。
- 抽取状态和错误提示。
- 待审核题目队列。
- 题干、选项、答案、解析、评分点编辑。
- tag 选择和即时新建 tag。
- 审核通过、跳过和删除。

### 5.3 试卷模板

- 模板列表。
- 中央结构画布。
- 题型分区拖拽和排序。
- 右侧属性检查器。
- 分区标题、题型、数量、分值和约束编辑。
- 模板合法性检查。
- 试卷结构预览。
- 保存、复制和新建模板。

## 6. 数据模型

### Question

```text
id
type: choice | fill | solution
subject
stem_markdown
options: [{key, text}]
answer_markdown
analysis_markdown
scoring_points: [{label, score}]
tags
chapter
knowledge_points
difficulty: easy | medium | hard
score
source_document_id
source_page
review_status
created_at
updated_at
```

题目正文和公式使用 Markdown/LaTeX 保存。题目运行时存于 SQLite，同时可以导出为 `backend/data/questions/*.json`。

### Tag

```text
id
name
color
created_at
```

### SourceDocument

```text
id
filename
file_type
file_path
sha256
page_count
status
created_at
```

### ReviewItem

```text
id
source_document_id
raw_text
parsed_question
confidence
status: pending | approved | rejected
review_notes
```

### PaperTemplate

```text
id
name
subject
duration_minutes
total_score
sections
distribution_rules
version
```

### Paper

```text
id
template_id
title
seed
questions
validation_result
created_at
```

## 7. 内置数学一模板

首个内置模板采用可修改默认值：

- 总分：150。
- 时长：180 分钟。
- 选择题：10 题，每题 5 分。
- 填空题：6 题，每题 5 分。
- 解答题：6 题，总分 70。
- 高等数学默认分布：60%。
- 线性代数默认分布：20%。
- 概率论与数理统计默认分布：20%。

这些值只作为模板初始配置，不写死在组卷算法中。后续可以按具体考试年份和资料修改。

## 8. 组卷算法

组卷请求包含：

- `template_id`
- `subject`
- `seed`
- `locked_question_ids`
- `required_tags`
- `excluded_tags`
- `difficulty_distribution`
- `chapter_distribution`

算法流程：

1. 读取模板分区和约束。
2. 为每个分区建立候选题集合。
3. 过滤题型、科目、tag、章节和审核状态。
4. 排除已锁定题目之外的重复题目。
5. 按固定 seed 进行确定性排序。
6. 逐个分区选择满足硬约束的题目。
7. 根据软约束计算分布偏差。
8. 生成校验结果和缺口说明。
9. 保存试卷及题目快照。

题库不足时不生成伪造题目，返回具体缺口。

## 9. 导入流程

```text
选择文件
  -> 保存源文件
  -> 计算 sha256
  -> 提取文本和页码
  -> 题号/题型规则切分
  -> 生成 ReviewItem
  -> 用户修正并选择 tag
  -> 审核通过
  -> 写入 Question
  -> 导出 JSON 镜像
```

抽取器接口：

```python
class DocumentExtractor(Protocol):
    def can_handle(self, filename: str) -> bool: ...
    def extract(self, path: Path) -> list[DocumentPage]: ...
```

首版实现：

- `PdfTextExtractor`
- `DocxExtractor`
- `DocConverterExtractor`
- `OcrExtractor` 接口占位

## 10. 导出流程

题卷版隐藏答案、解析和评分点。答案版包含答案、解析、分值和评分点。

- PDF：生成排版后的 PDF。
- DOCX：生成可编辑 Word 文档。
- LaTeX 公式：统一转成 SVG/PNG 后嵌入文档，优先保证两种格式的视觉一致性。
- 生成文件记录到 `ExportJob`。

## 11. API

```text
GET    /api/health

POST   /api/documents/import
GET    /api/reviews
PATCH  /api/reviews/{id}
POST   /api/reviews/{id}/approve

GET    /api/questions
POST   /api/questions
PATCH  /api/questions/{id}
GET    /api/questions/export-json
POST   /api/questions/import-json

GET    /api/tags
POST   /api/tags

GET    /api/templates
POST   /api/templates
PATCH  /api/templates/{id}
POST   /api/templates/{id}/validate

POST   /api/papers/compose
GET    /api/papers/{id}
POST   /api/papers/{id}/export
```

## 12. 一键启动

`start.bat` 负责：

1. 检查 Node.js、npm、Python 和 LibreOffice。
2. 创建 `.venv`。
3. 安装后端依赖。
4. 安装前端依赖。
5. 启动 FastAPI。
6. 等待 `/api/health` 成功。
7. 启动 Electron。
8. Electron 关闭后清理后端进程。

启动失败需要输出中文原因，不允许静默退出。

## 13. 测试计划

### 后端

- PDF、DOCX、DOC 抽取。
- 题型识别和待审核队列。
- tag 创建和关联。
- JSON 导入导出。
- 模板校验。
- 固定 seed 组卷复现。
- 分值、题量和分布校验。
- 题库不足错误。
- PDF/DOCX 输出文件生成。

### 前端

- 三个导航页切换。
- 文件导入和审核。
- 新建 tag。
- 模板分区编辑和排序。
- 规则组卷。
- 锁定和替换题目。
- 题卷版/答案版切换。
- 导出状态和错误状态。

### 视觉

- Electron 桌面尺寸。
- 980px 最小窗口。
- 长题干和长 tag。
- 复杂公式占位。
- 模板画布横向滚动。
- 无文字重叠、无横向溢出、无渐变和玻璃效果。


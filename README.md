# 组卷助手

`Test-Paper-Interview-Helper` 是一个前后端分离的本地组卷工作台，面向考研和其他结构化考试场景。

当前实现方向：

- Electron + TypeScript + React 前端
- FastAPI + Python 后端
- SQLite 运行时数据库
- PDF、DOCX、DOC 题目导入
- 待审核题目队列
- 题型、章节、难度和 tag 规则组卷
- 考研数学一内置模板
- 题卷版和答案版 PDF/DOCX 导出
- Windows `start.bat` 一键启动

## 启动

双击根目录的 `start.bat`。脚本会检查 Node.js、Python 和 LibreOffice，创建虚拟环境，安装依赖并启动 FastAPI 与 Electron。

手动启动：

```powershell
.\scripts\start-backend.ps1
cd frontend
npm install
npm run dev
```

## 目录

```text
backend/       FastAPI、SQLite、文档解析和导出
frontend/      Electron + React + TypeScript
docs/          产品和技术设计文档
scripts/       Windows 启动辅助脚本
start.bat      一键启动入口
```

## 当前页面

左侧导航提供三个工作台：

1. 考研组卷
2. 试题导入
3. 试卷模板

前端使用新粗野主义设计：硬边框、实体阴影、平面色块和明确的结构分区。首屏直接进入可工作的组卷台，不使用营销型首页。

## 数据位置

运行时数据默认位于 `backend/data/`：

- `paper_helper.sqlite3`：SQLite 数据库
- `documents/`：导入源文件
- `questions/`：题目 JSON 交换文件
- `exports/`：导出的 PDF/DOCX 文件

## 设计文档

完整设计说明见 [`docs/design.md`](docs/design.md)。

数学一题源与本地题目册配对导入说明见 [`docs/math-one-sources.md`](docs/math-one-sources.md)。

# 组卷助手

Test-Paper-Interview-Helper 是一个本地运行的考研学习工作台，集成题库管理、自动组卷、刷题、待办、番茄钟和桌面陪伴。桌面端使用 Electron + React + TypeScript，后端使用 FastAPI + SQLite。

仓库随附 **2,319 道已入库题目**、题库分类与模板，以及可独立使用的题面 / 解析图片。首次启动空数据库时自动加载，克隆项目后即可使用。

## 学习首页

- **番茄钟**：专注、短休息、长休息及自定义时长。
- **今日待办**：按日期查看、批量添加、完成状态和时间提醒。
- **工作台面板**：调整面板顺序，集中查看目标院校、题库概览与资讯。
- **桌面陪伴**：选择角色，设置大小与自动漫游，一键进入桌宠或悬浮球。

界面沿用硬边框、实体阴影和平面色块；顶部陪伴区统一为紧凑的角色选择和操作栏。

![学习首页与桌面陪伴](docs/screenshots/00-home.png)

## 桌宠与悬浮球

提供 **Doro、蓝发女仆、纸盒猫、专注机器人** 四套可替换外观。

- 关闭主窗口后进入上次使用的桌宠 / 悬浮球模式，系统托盘可恢复窗口。
- 透明动画包含待机、行走、特殊动作与点击互动，行走之间会休息。
- 自动二维移动，碰到屏幕工作区边缘反弹；拖动、互动和隐藏时暂停位移。
- 拖动只改变位置，禁止通过边框缩放；小 / 中 / 大为 160 / 220 / 280 DIP。
- 双击桌宠、单击悬浮球可回到学习台；右键切换角色、模式、大小或退出。
- 保存角色、模式、位置、大小和漫游开关；已检查 Windows 100% / 150% 双屏缩放。

![Doro 桌宠](docs/screenshots/05-desktop-pet.png)

浏览器可以预览角色，独立桌宠窗口需要 Electron 客户端。参数、素材来源与操作说明见 [桌面陪伴文档](docs/desktop-pet.md)。

## 题库与练习

### 当前随附数据

已按题目 ID 核对本地数据库和仓库 JSON，合计 **2,319 道**，含项目原有演示题。

| 题库 | 题目数 | 主要分类 |
| --- | ---: | --- |
| 考研数学一 | 856 | 高等数学、线性代数、概率论与数理统计 |
| 考研政治 | 1,463 | 马原、毛中特、史纲、思法、时政 |
| 合计 | 2,319 | 两个题库独立管理 |

其中 **2,103 道**有原版题面与解析裁切图，共 **4,206 张**；其他题目以结构化文本展示。图片使用无损 WebP 保存，预览及 PDF / DOCX 导出时转换为 PNG，不依赖本机原始整册 PDF。

- [题目 JSON](backend/data/questions)：题干、选项、答案、解析、标签、来源区域。
- [题库清单](backend/data/bundled/manifest.json)：数量、分类、模板、来源元数据与文件校验值。
- [题面和解析图片](backend/data/bundled/previews)：按题目 ID 区分 question / analysis。

**首次启动会自动加载到空数据库。** 已有数据库保留原内容，不覆盖修改，也不会每次启动重新恢复已删除的题目。请完整下载 questions 和 bundled 两个目录。

### 考研组卷

按关联模板、题型分区、复式 tag 和随机种子选题；可指定必须包含的大类 / 小类标签，生成后查看题型结构与校验状态。数学与政治使用独立题库 ID，避免混卷。

![考研组卷工作台](docs/screenshots/01-compose.png)

### 小题狂练

支持按题库、学科、大类和小类标签筛选，进行单选 / 多选自动判题、连续随机刷题、持久化错题记录、错题删除，以及错题和答案 PDF 导出。

![小题狂练工作台](docs/screenshots/02-practice.png)

### 导入与审核

PDF、DOCX、DOC 中抽取的题目先进入审核队列。可查看原版题面、解析匹配情况，修订题型、章节和标签，再单题或批量审核入库。导入脚本位于 scripts/。

![试题导入工作台](docs/screenshots/03-import.png)

题目采用大类 / 小类复式标签，例如：["高等数学", "函数、极限与连续"]。

### 模板与导出

模板与题库关联，支持总分、时长、题型分区、题目数、分值和大类占比。内置数学一和政治模板。

![试卷模板工作台](docs/screenshots/04-templates.png)

组卷支持题卷版 / 答案版 PDF 和 DOCX；题卷显示原版题面，答案、解析和评分信息放在答案版。小题狂练可单独导出错题 PDF。

## 快速启动

### Windows 一键启动

双击项目根目录的 start.bat。脚本检查 Python、Node.js 和依赖，创建或复用 .venv，随后启动 FastAPI 和 Electron。

环境要求：Python 3.11+、Node.js 20+；涉及部分 Word 转换和导出流程时需要 LibreOffice。图片处理依赖 Pillow，已列入后端依赖。

### 手动启动

准备依赖（首次运行）：

```powershell
py -3 -m venv .venv
./.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
cd frontend
npm install
```

在项目根目录启动后端：

```powershell
./scripts/start-backend.ps1
```

另开终端启动前端：

```powershell
cd frontend
npm run dev
```

默认前端地址为 http://127.0.0.1:5173，后端 API 为 http://127.0.0.1:8000/api。

启动日志会显示局域网访问地址。移动端浏览器使用同一主机的 8000 端口访问 API。可用 PAPER_HELPER_API_HOST、PAPER_HELPER_API_PORT、PAPER_HELPER_FRONTEND_PORT 调整监听配置；更换后端端口时需同时配置 VITE_API_BASE_URL。

## 更新随附题库

在本地完成题目审核入库后，运行：

```powershell
./.venv/Scripts/python.exe scripts/package_question_bundle.py
```

脚本从本地 SQLite 一致性快照读取题目，更新 JSON，按原有来源区域生成无损题面 / 解析图片，并写入清单和 SHA-256 校验值。已有且来源未改变的图片会复用；生成新图片需要原始 PDF。

提交更新时包括 backend/data/questions 与 backend/data/bundled。随附数据只包含题目、模板、题库元数据及相关裁切图片；个人错题、练习记录、待办、运行数据库和整册原始文档仍保留在本地。

## 数据与代码位置

```text
backend/
  app/
    main.py                 API、导入、审核、预览与导出
    db.py                   SQLite 初始化与迁移
    question_bundle.py      随附题库加载与原版图片读取
    composer.py              自动组卷
    practice.py              刷题与答案识别
  data/
    questions/              随仓库发布的题目 JSON
    bundled/                随仓库发布的清单与题面图片
    paper_helper.sqlite3    本地运行数据库
    documents/              本地导入原始文件
    exports/                本地 PDF / DOCX 导出
frontend/
  electron/                 桌面窗口、托盘与漫游逻辑
  src/components/           首页、桌宠、组卷、练习等界面
  public/assets/            角色素材及来源说明
scripts/
  start-backend.ps1
  package_question_bundle.py
  normalize-pet-assets.py
  capture-screenshots.cjs
```

.gitignore 仅对白名单中的 questions 与 bundled 开放数据跟踪，其他运行时数据保持忽略。桌宠设置保存到 Electron 用户数据目录的 desktop-pet.json；首页待办与番茄钟状态保存在客户端本地。

## 校验与截图

前端构建和桌宠验证，在 frontend 目录执行：

```powershell
npm run build
node --test pet-physics.test.mjs
npm run smoke:pet
```

桌宠回归覆盖连续拖动、固定尺寸、四边反弹、双屏切换、四套角色、动画、显隐、三档大小和设置保存；使用独立临时用户数据。截图输出到 frontend/out/pet-smoke。

题库恢复与图片验证，在项目根目录执行：

```powershell
./.venv/Scripts/python.exe -m unittest discover -s backend/tests -v
```

README 截图来自真实 Electron 窗口。已有业务页面截图脚本位于 scripts/capture-screenshots.cjs，运行前需启动前后端；生成目录为 docs/screenshots。

## 文档与素材

- [项目设计](docs/design.md)
- [数学一题源说明](docs/math-one-sources.md)
- [桌宠操作、参数与来源](docs/desktop-pet.md)
- [Doro 来源与处理说明](frontend/public/assets/doro/SOURCE.md)

题目与图片保留各自的来源信息，原始整册 PDF / Word 不随仓库发布。第三方角色素材的许可证和来源说明保留在对应 assets 子目录；项目代码目前未单独声明开源许可证。

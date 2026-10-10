# Windows 一键配置与排错

日期：2026-10-10。适用于完整源码目录的首次配置，以及已有环境缺少依赖时的修复。

## 别人电脑上的使用步骤

1. 下载包含本次修复的完整项目并解压。应能同时看到 `setup.bat`、`start.bat`、`scripts/`、`frontend/package.json`、`frontend/package-lock.json` 和 `backend/requirements.txt`。不要在压缩包窗口中直接运行，也不要只复制两个 BAT 文件。
2. 首次使用双击 **setup.bat**。缺少 Python / Node.js 时，会尝试调用 WinGet 安装 Python 3.11 和 Node.js LTS；系统可能显示安装授权窗口。未提供 WinGet 的电脑按提示安装这两个运行环境，再双击配置文件。
3. 等待依赖安装、Electron 下载和前端构建全部通过。看到 `Environment ready` 和 `Setup passed` 表示本次配置成功。安装日志保存在 `logs/setup-日期时间.log`。
4. 双击 **start.bat**。它会先检查环境，成功后启动后端及 Electron。日后通常只用这一个入口。

已在 Python 3.11.9、Node.js 22.16.0、Windows PowerShell 5.1 上实测。基础依赖自动安装不包含可选 LibreOffice / OCR，也不要求填写 AI Key。Key 仍只在应用内部手动启用 Agent 时填写。

2026-10-11 增加到期复习后，配置流程也会安装固定版本 FSRS 与本地优化器（含 PyTorch、NumPy、pandas）、Windows 时区数据。首次下载体积增加，请等待安装完成；无需填写 Key。依赖核验会实际实例化优化器，防止只有调度器可用却遗漏训练依赖。功能与新增验证记录见 [到期复习更新](spaced-review-update.md)。

## 本次截图错误的原因与修复

截图中 npm 在项目根目录寻找 `package.json`，而实际文件在 `frontend/`；安装没有完成，随后启动便出现 `electron-vite 不是内部或外部命令`。旧检查只判断 Electron 文件是否存在，也可能漏过依赖不完整或更新后新增依赖。

新流程使用脚本位置确定绝对项目路径，进入 `frontend` 后再带绝对 `--prefix` 调用 npm；不依赖用户当前终端在哪个目录。前端按锁文件执行 `npm ci --include=dev --ignore-scripts=false`，包含开发启动必需的 electron-vite / TypeScript。

所有外部命令都检查退出码，安装失败立即返回失败；不启动后端或 Electron，也不写成功标记。完成后验证依赖版本、关键启动命令、Electron 二进制和依赖树。锁文件或 package.json 变化会重新配置，不再只检查一个 electron.exe。

## 网络与下载

Electron 二进制默认使用 `https://npmmirror.com/mirrors/electron/`，解决部分网络直连 GitHub 下载长期等待的问题；沿用 Electron 安装包自带校验值，不关闭 TLS 验证。已有 `ELECTRON_MIRROR` 设置会优先使用，不改机器全局配置。安装过程显示 postinstall 输出。

需要指定官方源时，在 PowerShell 中运行：

```powershell
$env:ELECTRON_MIRROR='https://github.com/electron/electron/releases/download/'
.\setup.bat
```

如提示 `ELECTRON_SKIP_BINARY_DOWNLOAD is set`，表示当前环境禁止下载桌面运行时，请在当前终端执行 `$env:ELECTRON_SKIP_BINARY_DOWNLOAD=$null` 后重试。npm / pip 下载失败时，先按日志处理网络、代理或磁盘权限，再运行 setup.bat；脚本不会自动关闭证书校验。

## 环境与数据

- 换电脑不要复制 `.venv` 和 `frontend/node_modules`，让 setup.bat 在新机器创建。检测到不可用的虚拟环境，会先改名保存到 `.venv.broken-时间-随机ID` 再新建，不删除旧环境。
- 不修改全局 npm 配置，不强制全局 Python 包版本。依赖只装在项目环境内。
- 配置不会初始化或清空题库数据库；日常启动仍保留既有数据迁移机制。
- 检测到端口占用时明确失败，不冒用占用端口的另一项服务，也不会停止不属于本次启动的进程。后端输出与错误分别保存到 `logs/backend-*.out.log` 和 `logs/backend-*.err.log`。
- `PAPER_HELPER_API_PORT` / `PAPER_HELPER_FRONTEND_PORT` 可调整端口。更改 API 端口后，仍需同步设置现有前端配置 `VITE_API_BASE_URL`；只读本机时 API 地址使用 `127.0.0.1`，局域网设备则需填写主机可达地址。

## 只检查，不安装

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/setup-environment.ps1 -CheckOnly
```

它只检查现有 Python / Node、精确依赖与依赖树，不安装、不构建、不改数据库。开发者测试另需 `backend/requirements-dev.txt`：

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt
.\.venv\Scripts\python.exe -B -m unittest discover -s backend/tests -v
python -B scripts/test_setup.py
cd frontend
npm run build
```

## 本次验证范围

- Python 源码语法、PowerShell 解析、TypeScript 严格类型检查及生产构建。
- 原有与新增后端共 33 项回归。
- 临时目录回归：中文、空格、括号、`&`、`[]`、`!` 路径；错误退出码；失败后重试；重复配置；锁文件变化；缺少 electron-vite 的修复；不完整项目；端口占用。
- 在本机真实运行安装流程，成功安装锁文件依赖并下载 Electron，随后构建成功。
- 使用临时 SQLite 数据库实际启动 FastAPI，通过健康检查并清理测试进程。

没有在另一台全新 Windows 机器上实测 WinGet 的系统级安装，也没有把这些检查描述为“所有电脑绝对无 bug”。如果某台电脑仍失败，保留 `logs/` 中对应本次运行的日志即可定位。

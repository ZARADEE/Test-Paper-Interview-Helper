# 本轮 GitHub 研究证据与复查

日期：2026-10-15。主报告见 [竞品功能对比](../github-competitor-comparison-2026-10-15.md)。

## 可交付证据

- `github-competitor-snapshot-2026-10-15.json`：10 个仓库的官方 API 元数据、Stars、Forks、默认分支、固定 commit、官方 README 路径及 SHA-256。
- `github-competitor-code-evidence-2026-10-15.json`：抽查的源码/许可路径、固定 commit、URL、保存结果与 SHA-256。
- 完整上游文件在本机 `docs/research/github-competitors-2026-10-15/`，是已忽略的审阅缓存，不进入应用运行逻辑或公开发行包。索引的 `saved_file` 指向本地缓存，其他人未采集时该路径可能不存在；应以固定提交 URL 与校验值复查。

## 搜索与排除

GitHub REST 搜索采用 AI tutor、topic:ai-tutor、learning platform、flashcards、study flashcard、mock interview 等组合，按 Stars 排序并人工过滤。主池取至少 1,000 Stars、能识别实际学习产品能力的项目；并以已知能力标杆补充候选。

纯教程、纯提示词、题解集合及无关关键词命中不算完整产品。Anki/FSRS 等已研究对象保留作基线。面试方向的 liftoff 维护较旧、offerPilot 未达门槛；不据此声称不存在更好的面试竞品。搜索并非全站穷举。

## 时间口径

`pushed_at` 是 GitHub 返回的仓库最近推送时间；不是最近产品发行时间。`updated_at` 也不直接等于代码活跃时间。Stars 是保存 API 响应当时的值，之后可能变化。

元数据在 2026-10-15 本轮会话内取得，首次抓取时刻未单独保存；提交与 README 于北京时间约 15:09 汇总。采集器第二次使用缓存元数据，因此 `observed_at_utc` 是组装证据的时刻；`metadata_cache_written_at_utc` 只记录缓存文件写入时间。无法准确还原首次抓取时刻，`metadata_collected_at_utc` 留空并附说明，不根据仓库 `updated_at` 猜测采集时间。默认分支 HEAD 不保证是稳定版。

## 访问失败与恢复

内置搜索在本轮没有返回可引用结果，因此主要证据来自 GitHub 官方 REST 和固定提交 raw 文件。初期 raw 请求超时，README 改用 Contents/Readme API 成功；后续 API 限流，Moodle 和 PageLM 的补充文件使用同 commit 的 raw 路径补齐。最终完整性以 JSON 索引及校验结果为准，不用推测值填充失败字段。

曾尝试读取 Moodle 全量递归目录但响应过大并超时，之后改为局部目录与指定文件；不把失败的目录扫描当成完成的全仓库审计。

## 复查方式

在仓库根目录运行：

```powershell
python -X utf8 scripts/research_github_competitors.py
python -X utf8 scripts/research_github_competitors.py --supplements
```

默认命令在历史快照已存在时直接退出，不覆盖历史数据；只有没有快照时才采集当时的默认分支状态。复核本报告应打开索引里已经固定 SHA 的官方 URL，不能将新版本冒充旧版。补充命令按现有索引的固定提交工作并优先读取缓存；README 缓存缺失时按 `readme_source_url` 获取并核对 SHA-256。

没有逐个安装竞品、执行商业版、调用付费模型或做长周期用户试验。报告标记 D/C/L/P 以区分官方声明、源码抽查、本地事实与规划。后续 R0 阶段应完成可运行任务核对，补足当前未知项。

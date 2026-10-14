# GitHub 题库补充

本批用于用户请求的本地备考题库补充，保留题源和原始解析，不将 GitHub 可访问等同于题库版权已转让。

|题库|来源|范围|许可说明|
|---|---|---|---|
|数学一|https://github.com/PondFish-me/fish.888.moe|1987–2026 数学一；不混入数学二、数学三|仓库未声明统一许可，来源与解析保留署名|
|政治|https://github.com/mrwoov/kyzz|2010–2024 选择题及答案|仓库未声明统一许可；旧时政按当年背景理解|
|408|https://github.com/lij768423-svg/408-|四科章节选择题及答案|软件 ISC；第三方试题权利不因软件许可证改变|

去重基于同题库规范化题干，跳过记录保存在 manifest.json 的 excluded 中。不会覆盖已有题目或用户修改；重启不会恢复用户删除的题目。

数学题按高等数学、线性代数、概率论与数理统计及章节关键词归类；政治按原卷分区及内容关键词归类；408 采用题源学科与章节。年份、题号、原始路径与分类依据另存逐题 origin，并在解析中显示来源。分类是可修订的自动初分，原题答案没有经过逐题人工重解。

难度缺少一致定义，统一初始化为中等；分值是练习默认值，正式组卷采用模板分值。证明题无独立答案字段但有完整证明解析时，将源解析作为答案。数学一源数据中的判断题暂不导入，因为现有判题器没有对应题型。

为确保公式和配图离线可读，带公式/图形题生成题面与答案解析预览；不执行题源脚本，公式使用本地 KaTeX（保留其许可）。清单记录源压缩包 SHA-256 和每张预览校验值。

重建：scripts/import_github_banks.py → frontend/render-github-bank.cjs → scripts/finalize_github_banks.py。检查：backend/tests/test_github_bundle.py。本次发布包含运行题包、来源说明及无损预览；原始下载压缩包与生成中间文件保留在本地。

## 408 ???????

???https://github.com/kaichan-kc/408-questions ??? 408_questions_full ? 2009?2025 ???????????? 117 ????????? 33???????? 33????? 34?????? 17?????????????????? ID ???????????????????????

2012 ?? 44 ??2020 ?? 41 ?????????????????????????????? backend/data/bundled/github/solutions408.json???????????????????????

???????????????????40 ??? + 5 ???????????????????????????????????

## 408 模拟卷

来源：https://github.com/43aquarius/cs408 ，src/data/mocks 下 10 套自创模拟卷，共 400 道选择题、70 道综合解答题。每题保留答案、解析、原始分值、难度、知识点及卷名，并添加“模拟题”标签。TypeScript 数据通过语法树只读取字面量，不执行源代码。讲解动画的原始结构保存在 origin.visual，当前展示文字解答与离线预览，未接入上游动画播放器。

题源声明模拟题为自创学习资料；代码 MIT 不等于题库权利转让。原参考解答未逐题人工重解，可在使用中继续勘误。使用“模拟题”标签可以只从模拟题抽卷，默认不额外安装模板。

## 政治分析题补充（2026-10-15）

新增 30 道考研政治分析题，来源为 [xyzxyq/kaoyanzhengzhi](https://github.com/xyzxyq/kaoyanzhengzhi) 与 [TsekaLuk/Kaoyan-Politics-Papers](https://github.com/TsekaLuk/Kaoyan-Politics-Papers)。使用固定提交下载，仅导入核对过材料、小问和对应参考答案的条目；重复题号、材料缺失/错配、答案孤块、明显 OCR 损坏和分值矛盾记录均排除。不是把源仓库宣传的年份范围视为全部题目均已提供。

大类和子类沿用原政治题库：马原/哲学 8 道，毛中特/中国化理论成果 7 道，史纲/中国近现代史 4 道，思法/思想道德修养 6 道，形策/国际形势与政策 5 道。原卷年份与题号直接展示，历史时政按当年语境理解。

题包：backend/data/bundled/github/politics-solutions.json；导入与重建：scripts/import_politics_solutions.py；逐条来源、文件校验、转写修正和排除原因见题包及 docs/politics-solutions-import-report.json。详情见[使用与验收记录](politics-solutions-update-2026-10-15.md)。

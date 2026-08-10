# 小康康的物理世界

一个面向核物理科研的公开情报网站，每日自动汇总论文、新闻与官方通知，并在 GitHub Pages 上发布。

## 内容范围

- 实验与理论核物理
- 核结构、核衰变与放射性、核反应与奇异核
- 高能核物理与重离子碰撞
- 核天体物理
- 探测器、核电子学、DAQ、加速器与束流
- 核聚变与等离子体
- AI 与科学计算交叉
- 核数据、核技术应用与其他重要物理前沿

## 数据源

数据管线优先使用官方 RSS/API 和出版元数据，包括：

- arXiv：`nucl-ex`、`nucl-th`、`hep-ex`、`hep-ph`、`hep-lat`、`astro-ph.HE`、`astro-ph.SR`、`physics.ins-det`、`physics.acc-ph`、`physics.plasm-ph`、`cs.AI`、`cs.LG`
- 核物理与粒子物理：PRC、PRD、PRL、PLB、Nuclear Physics A/B、EPJ A、J. Phys. G、Chinese Physics C、NST、PTEP、IJMPE、PPNP、ARNPS、RMP
- 探测器、束流与核数据：NIMA、NIMB、JINST、Review of Scientific Instruments、IEEE TNS、PRAB、Radiation Measurements、Nuclear Data Sheets、Atomic Data and Nuclear Data Tables
- 聚变与核应用：Nuclear Fusion、Physics of Plasmas、PPCF、Fusion Engineering and Design、Annals of Nuclear Energy
- 核天体与交叉：ApJ、MNRAS、A&A、Nature、Nature Physics、Nature Astronomy、MLST 等
- 新闻和通知：APS Physics、Nature、IAEA、CERN、NSFC、FRIB、FAIR、ITER 等官方页面

具体源和筛选策略在 [`config/sources.json`](config/sources.json)中维护。分类与关键词在 [`config/topics.json`](config/topics.json)中维护。

## 自动更新

GitHub Actions 在每天北京时间 10:17 左右执行（预留 arXiv 冬令时公告发布余量）：

1. 获取最新元数据；
2. 按 DOI、arXiv ID 和标题去重；
3. 执行主题、方法与技术标签分类，优先核实验、核理论、核结构、核衰变和核探测器；
4. 不抓取或展示论文图片，将站点流量与版面聚焦在题目、完整摘要和原始链接；
5. 保留历史数据；
6. 运行测试；
7. 提交当日快照并重新发布 GitHub Pages。

## 网站功能

- 首页以科研简报和论文流为主，去掉重复的速览栏；“重点”仅作为论文内部选项；
- 今日核物理、今日全部、近 7 日、自定义起止日期和历史全部时间视图；
- 按研究领域、期刊/来源、自定义搜索字段、关键词、发布日期和重要性筛选排序；
- 论文列表默认展示数据源提供的完整摘要，不展示论文图片；
- 每日简报内整合历史论文、最新日论文、官方新闻和数据源状态；
- 以北京时间每日更换一套稳定、温暖的页面背景；
- 文献关联推荐、可解释重要性评分和数据源健康状态；
- 收藏时必须设置至少一个关键词；“我的论文”列出全部收藏关键词及篇数并可筛选；
- “我的”包含我的论文、我的代码、参考资料三类，支持保存个人 GitHub 项目和常用资料链接；
- 最新核心论文提供 12 篇由 Codex 完成的中文题目与完整摘要译文，可随时切回英文原文；
- 每篇论文都有独立笔记入口，并支持未读/在读/已读与个人关注词；私人笔记只留在浏览器，不进入公开收藏快照；
- 一键导出 Zotero 可导入的 RIS；每篇论文及右侧“论文信息”提供 Cite，可复制或下载 BibTeX 与 GB/T 7714—2025，并在来源提供时包含卷、期、页码、总页数、月份与出版社；
- 桌面端、平板和手机端响应式布局。

工作流也支持在 GitHub Actions 页面使用 `workflow_dispatch` 立即更新。

## 本地运行

```bash
python3 scripts/update_content.py --days 30
python3 scripts/build_site.py
python3 -m http.server 4173 --directory site
```

打开 `http://127.0.0.1:4173`。

## 检查

```bash
python3 -m unittest discover -s tests -v
node --check site/app.js
```

## 收藏与 GitHub 同步

- 浏览器使用 `localStorage` 保存收藏、阅读状态、笔记和待同步队列；
- `config/runtime.json` 中启用 `favorite_sync_endpoint` 后，网页会把待同步收藏发送到安全中转端点；
- 每日任务通过 `FAVORITE_SYNC_EXPORT_URL` 拉取快照，写入 `data/personal/favorites.json`；
- 当前公开站点尚未部署中转端点，因此收藏只在当前浏览器保留，并支持 JSON 导出/导入；跨电脑每日同步需后续部署安全中转服务后才会生效；
- 后续可用 DOI/arXiv ID 无损对接 Zotero。

## 证据与版权边界

- 网站展示题目、作者、发布日期、分类、可公开摘要和原始链接；
- 不镜像受版权保护的论文全文；
- 站点不展示或镜像论文图片，图表与全文均请通过原始链接查看；
- 摘要缺失时明确显示“数据源未提供可公开摘要”；
- 通知截止日期和实验信息始终以官方原始页面为准；
- 本项目是独立的非官方学术情报项目。

Thank you to arXiv for use of its open access interoperability.

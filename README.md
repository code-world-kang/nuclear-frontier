# 核视界·核物理前沿情报

一个面向核物理科研的公开情报网站，每日自动汇总论文、新闻与官方通知，并在 GitHub Pages 上发布。

## 内容范围

- 实验与理论核物理
- 核结构、核反应与奇异核
- 高能核物理与重离子碰撞
- 核天体物理
- 探测器、核电子学、DAQ、加速器与束流
- 核聚变与等离子体
- AI 与科学计算交叉
- 核数据、核技术应用与其他重要物理前沿

## 数据源

数据管线优先使用官方 RSS/API 和出版元数据，包括：

- arXiv：`nucl-ex`、`nucl-th`、`hep-ex`、`hep-ph`、`astro-ph.HE`、`physics.ins-det`、`physics.plasm-ph`、`cs.AI`、`cs.LG`
- 核物理与粒子物理：PRC、PRD、PRL、PLB、Nuclear Physics A、EPJ A、J. Phys. G、Chinese Physics C、NST
- 探测器与核数据：NIMA、JINST、Review of Scientific Instruments、IEEE TNS、Nuclear Data Sheets、Atomic Data and Nuclear Data Tables
- 聚变与核应用：Nuclear Fusion、Physics of Plasmas、PPCF、Fusion Engineering and Design、Annals of Nuclear Energy
- 核天体与交叉：ApJ、MNRAS、A&A、Nature、Nature Physics、Nature Astronomy、MLST 等
- 新闻和通知：APS Physics、Nature、IAEA、CERN、NSFC、FRIB、FAIR、ITER 等官方页面

具体源和筛选策略在 [`config/sources.json`](config/sources.json)中维护。分类与关键词在 [`config/topics.json`](config/topics.json)中维护。

## 自动更新

GitHub Actions 在每天北京时间 08:17 左右执行：

1. 获取最新元数据；
2. 按 DOI、arXiv ID 和标题去重；
3. 执行多标签分类和可解释重要性评分；
4. 保留历史数据；
5. 运行测试；
6. 提交当日快照并重新发布 GitHub Pages。

## 网站功能

- 今日核心、今日全部、近 7 日和历史全部四级时间视图；
- 按研究领域、期刊/来源、关键词、发布日期和重要性筛选排序；
- 每日简报、主题分布、来源分布与优先阅读列表；
- 文献关联推荐、可解释重要性评分和数据源健康状态；
- 收藏、未读/在读/已读、私人笔记和个人关键词；
- 一键导出 Zotero 可导入的 RIS，单篇文献可导出 BibTeX；
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
- 中转端点未部署时，收藏仍会在当前浏览器保留，并支持 JSON 导出/导入；
- 后续可用 DOI/arXiv ID 无损对接 Zotero。

## 证据与版权边界

- 网站展示题目、作者、发布日期、分类、可公开摘要和原始链接；
- 不镜像受版权保护的论文全文；
- 摘要缺失时明确显示“数据源未提供可公开摘要”；
- 通知截止日期和实验信息始终以官方原始页面为准；
- 本项目是独立的非官方学术情报项目。

Thank you to arXiv for use of its open access interoperability.

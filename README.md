# 小康康的物理世界

一个面向核物理科研的公开情报网站，每日自动汇总论文、新闻与官方通知。GitHub Pages 保留静态镜像，EdgeOne Makers 中国站承载动态同步。

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
4. 对缺失摘要的 DOI 记录，依次尝试期刊官网元数据、官方 Cite/RIS/BibTeX/EndNote 导出、OpenAlex、Semantic Scholar 和 INSPIRE，并保留摘要来源与查询记录；
5. 不抓取或展示论文图片，将站点流量与版面聚焦在题目、完整摘要和原始链接；
6. 每天从 2001 年 1 月起自动回填六个尚未完成的月份，并保留每月独立检查点；
7. 生成按月论文分片、按年轻量搜索索引和月度统计；
8. 运行测试；
9. 提交当日快照并重新发布 GitHub Pages。

## 网站功能

- 首页以科研简报和论文流为主，去掉重复的速览栏；“重点”仅作为论文内部选项；
- 今日核物理、今日全部、近 7 日、自定义起止日期和历史全部时间视图；
- 按研究领域、期刊/来源、自定义搜索字段、关键词、发布日期和重要性筛选排序；
- 在论文页选择任一“我的关键词”，可跨全部已建索引年份检索；搜索只逐年读取轻量索引，完整论文按月分批加载，并提供逐月命中统计；
- 论文、新闻、通知分别使用独立的左侧分类与数量统计，不把三类内容混入同一组筛选项；
- 论文列表默认展示数据源提供的完整摘要，不展示论文图片；
- 新闻优先展示官方简介；订阅源缺少简介时给出明确的来源说明，并可在右侧查看新闻信息和收藏；
- 每日通知分为“会议通知、科研基金、束流申请”，列表显示官方原文节选，支持原位展开、收藏，并在右侧查看完整详情；
- 每日简报内整合历史论文、最新日论文、官方新闻和数据源状态；
- 以北京时间每日更换一套稳定、温暖的页面背景；
- 文献关联推荐、可解释重要性评分和数据源健康状态；
- 收藏时必须设置至少一个关键词；“我的论文”列出全部收藏关键词及篇数并可筛选；
- “我的”包含我的论文、我的代码、参考资料三类，支持保存个人 GitHub 项目和常用资料链接；
- 论文、新闻与通知统一进入开放模型中文翻译队列；已有译文默认优先显示中文题目与完整摘要，并可随时切回原文；Google 翻译按钮仅打开官方预填页面，不尝试被禁止的浏览器跨域请求；
- 每篇论文都有网页内嵌笔记框，并支持未读/在读/已读与个人关注词；在 EdgeOne 站点中，笔记、收藏、关键词、指定译法和排列可自动写入云端，GitHub Pages 继续保留 Issue 同步备选；
- 一键导出 Zotero 可导入的 RIS；每篇论文提供 Cite，可复制或下载 BibTeX 与 GB/T 7714—2025，并在来源提供时包含卷、期、页码、总页数、月份与出版社；
- 每篇论文可一键保存到本机 Zotero：保存前必须选择 Zotero 收藏夹和至少一个研究分类，分类同时写入 Zotero 标签；保存完整元数据、网站笔记、备注和收藏关键词，并优先下载公开 PDF，失败时再交给 Zotero 的开放获取解析器；
- 桌面端、平板和手机端响应式布局。
- 每日自动生成适合微信公众号编辑器的中文科研简报，公众号负责推送，网站保留完整数据库与交互功能。

## 微信公众号

当前发布策略已调整为“公众号简报 + GitHub Pages 完整网站”：

- 公众号固定入口：<https://code-world-kang.github.io/nuclear-frontier/wechat-entry/>
- 公众号底部菜单可直接打开论文、新闻、通知和“我的科研”，不需要每天发布文章。
- 公众号每日简报预览：<https://code-world-kang.github.io/nuclear-frontier/wechat-digest/>
- 可复制的发布稿：[`wechat-official-account/index.html`](wechat-official-account/index.html)
- 简报每次数据更新与网站构建时自动生成，只作为可选周报、月报或特别推送，不自动发布到公众号。
- 小程序代码继续保留，暂不作为当前首发渠道。

已接入可选的公众号自动发布流程：每日数据更新后可自动复用封面、写入草稿箱并提交发布，同时检查同名草稿与已发布记录以防止重复。此功能只在账户具备素材、草稿箱和发布 API 权限且 GitHub Secrets 明确启用时运行。`AppSecret` 只能放在 GitHub Actions Secrets 中，不得写入公开仓库。

工作流也支持在 GitHub Actions 页面使用 `workflow_dispatch` 立即更新。

## 2001 年以来的历史库

- 核心回填源包括 PRC、PRL、Nuclear Physics A、Physics Letters B、NIMA、EPJ A、J. Phys. G 与 Nuclear Fusion；期刊配置可在 [`config/history_sources.json`](config/history_sources.json)继续增加。
- 数据保存为 `data/history/papers/YYYY/MM.json`，站点构建后生成 `site/data/history/papers/`、`search/`、`stats/` 与 `manifest.json`。
- 回填采用逐月检查点；某个来源临时失败时该月不会标记完成，下一次自动任务会优先重试。
- 页面会明确显示当前连续完成到哪个月份，因此“2001 年至今”指目标覆盖范围，不会把尚未回填的月份误报为已收录。
- 如需手动补一个范围，可运行：`python3 scripts/backfill_history.py --from-month 2001-01 --to-month 2001-03`。

## 本地运行

```bash
python3 scripts/update_content.py --days 30
python3 scripts/build_site.py
python3 -m http.server 4173 --directory site
```

打开 `http://127.0.0.1:4173`。

## EdgeOne Makers 中国站

- 项目根目录为仓库根目录，静态输出目录为 `site`；
- `cloud-functions/api/health.js` 提供云函数健康检查；
- `cloud-functions/api/personal-state.js` 使用 EdgeOne Blob 强一致读取保存个人状态；
- 云函数区域固定为北京 `ap-beijing`，香港作为境外区域；
- EdgeOne 控制台必须配置 `PERSONAL_SYNC_SECRET`，值不得写入公开仓库；
- 同步密码只保留在当前页面内存中，个人内容保存成功后会清理本地安全副本。

## Zotero 本机连接

网站是公开的静态页面，不保存 Zotero API Key。macOS 上需要一次性启用只监听本机回环地址的轻量桥：

```bash
chmod +x zotero_bridge/install.sh zotero_bridge/uninstall.sh
./zotero_bridge/install.sh
```

安装器会把“小康康 Zotero 桥”加入 macOS 登录项，以后不需要手动运行。只要 Zotero 桌面端已打开，点击论文卡片或右侧论文信息中的“保存到 Zotero”，网页内会直接出现收藏夹和研究分类选择区，不弹出新窗口。本机桥只允许正式 GitHub Pages 和本地开发站点访问，不记录论文题名或个人笔记，不绕过付费墙。

## 检查

```bash
python3 -m unittest discover -s tests -v
node --check site/app.js
```

## GitHub 公开同步

- GitHub 是个人数据的最终来源；浏览器仅保留一份未提交的安全副本，防止刷新或误关页面后丢失，GitHub 同步成功后自动丢弃该副本；
- 网页源码不保存 Token、密码或其他秘密；
- 修改收藏、笔记、关键词或排列后，点击“提交到 GitHub”会打开预填好的 Issue；用户只需确认创建；
- GitHub Actions 仅接受仓库所有者创建的 `[个人数据同步]` Issue，校验 JSON 模式后更新 `data/personal/state.json`、重新发布网站并自动关闭 Issue；
- 同步内容是公开数据，不应写入密码、Token、未公开实验数据或其他敏感信息；
- 后续可用 DOI/arXiv ID 对接 Zotero。

## 证据与版权边界

- 网站展示题目、作者、发布日期、分类、可公开摘要和原始链接；
- 不镜像受版权保护的论文全文；
- 站点不展示或镜像论文图片，图表与全文均请通过原始链接查看；
- 摘要只从明确的官方元数据或引用导出字段中提取，不从页面正文猜测；仍缺失时明确标注数据源状态；
- 新闻简介缺失时只给出可核验的来源说明，不杜撰新闻内容；
- 通知截止日期和实验信息始终以官方原始页面为准；
- 本项目是独立的非官方学术情报项目。

Thank you to arXiv for use of its open access interoperability.

## 2026-09 科研工作台可靠性更新

- **收录与推荐分离**：核结构、团簇结构、实验、理论、反应、衰变、探测器、核天体、高能核物理、核数据、加速器及聚变均可分类。`nucl-ex`、`nucl-th` 和核心核物理专刊全量接收；综合期刊仍按涉核内容筛选。新增 Science、Nature Communications，Crossref 使用分页而非只读前 500 条。这里的“全量”指配置来源在指定时间窗返回的数据，不是保证全球零漏收。
- **历史检索**：旧论文构建索引时补充团簇标签，识别 `8B`、`⁸B`、`B-8` 和 `52,54Ca` 等写法。历史完整性以月度索引覆盖为准，不把仍未回填的月份称为已覆盖。
- **内容清洗**：访问验证页不充当新闻介绍；通知去掉明确的网页导航前缀；列表使用官网声明的标题，避免把预览和日期拼进题目。英文主题按词匹配，防止 `International` 被 `RNA` 规则误删；测试会议排除，学术例会标明类型；通用基金标明须核对申请资格。
- **翻译透明**：原生中文、题目、摘要/介绍、部分译文和原文缺失分开统计。无服务时只建立待译队列。GitHub Models 已退休，不再使用其接口和权限，也不把其他模型的结果标成 Codex。默认每日在 GitHub runner 内运行 Qwen3 开放模型，不用商业 API、订阅凭据或个人电脑；可选 API 后端仍只接受显式配置的 HTTPS 服务。机器初译与人工校对分开，不声称整库已译完。
- **个人数据保护**：保存过程中发生的新编辑继续排队；失败保留未提交副本；旧副本不因云端时间较新而直接删除。EdgeOne 覆盖前留存历史快照并拒绝已知的过时写入。当前 Blob 时间戳检查不是原子事务，尚不承诺多设备同时编辑无冲突。
- **GitHub 备份**：每日流程预留 `PERSONAL_STATE_URL`（国内主站 HTTPS `/api/personal-state` 地址）。未配置时不连接未知站点，不修改个人数据；有效快照才备份，拒绝缺字段及旧快照。EdgeOne 保存成功和 GitHub 备份成功是两个独立状态。跨设备及真实云端写入仍需在实际主站验证。
- **验证**：Python 测试、JavaScript 语法检查和 `node --test tests/*.test.mjs`。包含真实函数执行的核素识别、空译文统计、保存期间继续编辑、旧副本保留和云端冲突保护测试；这些测试不代替手机及真实跨设备验收。


## 自动中文初译（开放模型）

- 日更计划仍是北京时间 **06:00**（GitHub 可能延迟）；在同一次 Actions 内采集、翻译、构建和发布，不创建 Codex 独立任务。
- 默认采用 [Qwen3-4B-Instruct-2507](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507) 的 [Unsloth Q4_K_M 量化版本](https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF)，Apache-2.0；使用 [llama.cpp](https://github.com/ggml-org/llama.cpp) 官方发行版，MIT。两个下载均固定版本与 SHA-256。模型约 2.5 GB，缓存在 runner，不打包进网页或 Git 仓库。
- CPU 推理只绑定 `127.0.0.1`，任务结束即关闭；不上传资料给在线翻译服务，不使用 API Key，不扣 ChatGPT 订阅额度。公开仓库标准 runner 的免费政策以 GitHub 为准，不开通付费 runner。
- 每次日更最多尝试 120 条、约 45 分钟预算（在文章边界停止）；论文优先，同时给新闻和通知留配额。代码推送时仅尝试 6 条，避免长时间阻塞更新。积压会分批消化，历史月库暂不纳入翻译总进度。
- 先校验数学表达式、数字和缩写的原样保留，失败才使用保护标记重试，完整处理题目及已获取的摘要/介绍；输出截断、保护项变化、数字不一致或明显过短都会拒绝写入，失败按 1—7 天退避重试。**自动校验不代表语义准确，不是人工精校。** 无原文摘要的文章只译题目。
- `config/translation-glossary.json` 是核物理词表；已同步到 `data/personal/state.json` 的个人指定译法也会读入后续翻译。浏览器里尚未成功同步的词表不会被云端任务凭空读取。
- `data/translation-run.json` 记录最近一批尝试、写入、失败与剩余数量；`data/translation-retries.json` 保存失败条目的退避状态；首页展示真实批次结果。已有完整译文不重复覆盖，补摘要时保留有效中文题目。
- Argos 模型的首轮实验在核物理术语上出现明显误译，未采用为默认服务，也未把该轮结果写入网站。

本机人工测试（不是日常运行要求）：

```sh
python3 scripts/translate_content.py --backend offline --limit 6 --max-minutes 8
python3 scripts/build_site.py
```

国内收藏同步仍需有效的腾讯云登录以及真实主站验证；未取得合法访问时不修改密码、不替换云存储，不把静态站误报为已经跨设备同步。2026-09-05 从旧部署记录找回的地址为 `https://nuclear-frontier-402lzxdr.edgeone.cool`，当日首页及 `/api/personal-state` 均返回 EdgeOne 401（访问受限或授权失效），不是有效公开快照，因此没有盲目配置备份地址。

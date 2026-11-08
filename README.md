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

日常库与 `data/history/papers/YYYY/MM.json` 中的论文共用翻译队列，按同一 GitHub 提交读取，沿用论文身份归并及源文哈希检查。历史论文译文仍写入现有译文库，不改写原始论文分片或个人数据；网站载入历史结果时可直接使用对应译文。

在已登录 Codex ChatGPT 和 GitHub CLI 的本机执行下列命令，可只推进论文（包括历史论文），每轮最多 100 篇，完成后提交译文并等待网站发布：

```bash
python3 scripts/run_local_translation.py --scheduled --papers-only --limit 100 --batch-size 4 --max-minutes 30 --deploy-timeout 480
```

每轮优先恢复尚未发布的结果。`pending_papers` 表示全库尚需翻译的论文数，`pending` 包含论文、新闻和通知；失败重试退避中的论文也计入待译数。缺失摘要的论文只翻译题目，不补写摘要；长摘要按段落、句子或单词边界分段，所有分段成功后才保存完整结果，不能安全分段时保留待处理。机器译文不等于人工校对。命令本身只执行一轮，不安装定时任务。

公开 `translation-queue.json` 的 `pending` 和 `counts` 统计全部待译资料，`items` 仅预览前 1000 条，`listed` 和 `items_truncated` 明确标记预览范围。翻译程序始终从全量源文计算下一批，不会受预览数量限制。

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
- **翻译透明**：原生中文、题目、摘要/介绍、部分译文和原文缺失分开统计。无服务时只建立待译队列。GitHub Models 已退休，不再使用其接口和权限，也不把其他模型的结果标成 Codex。旧 GitHub runner Qwen3 翻译已停用，Sol 改为可信机器的独立 CLI 分批执行；本机每 15 分钟自动翻译与发布已接通，电脑睡眠或关机时不执行。可选 API 后端仍只接受显式配置的 HTTPS 服务。机器初译与人工校对分开，不声称整库已译完。
- **个人数据保护**：保存过程中发生的新编辑继续排队；失败保留未提交副本；旧副本不因云端时间较新而直接删除。EdgeOne 覆盖前留存历史快照并拒绝已知的过时写入。当前 Blob 时间戳检查不是原子事务，尚不承诺多设备同时编辑无冲突。
- **GitHub 备份**：每日流程预留 `PERSONAL_STATE_URL`（国内主站 HTTPS `/api/personal-state` 地址）。未配置时不连接未知站点，不修改个人数据；有效快照才备份，拒绝缺字段及旧快照。EdgeOne 保存成功和 GitHub 备份成功是两个独立状态。跨设备及真实云端写入仍需在实际主站验证。
- **验证**：Python 测试、JavaScript 语法检查和 `node --test tests/*.test.mjs`。包含真实函数执行的核素识别、空译文统计、保存期间继续编辑、旧副本保留和云端冲突保护测试；这些测试不代替手机及真实跨设备验收。


## 中文初译（Codex Sol 独立 worker）

- **旧 Qwen 日更翻译已停用**，采集、历史回填、个人数据备份、构建及发布仍保留每天北京时间 **06:00** 的计划（GitHub 可能延迟）。不新增 Codex 侧边栏定时任务。
- `scripts/translate_codex.py` 使用 **gpt-5.6-sol / low**，调用可信机器上已登录 ChatGPT 的 Codex CLI。使用订阅额度，不等于无限免费；未配置新的付费 API。登录凭据绝不能放入公开仓库、Actions Secrets 或公开 CI。
- **已配置本机每 15 分钟翻译与自动发布**：通过 Codex 当前聊天关联的 heartbeat 任务运行，不反复创建独立聊天，通知仅限失败。每轮最多 100 条、每批 4 条、翻译预算 30 分钟；需电脑开机、联网并保持 Codex 运行。电脑睡眠或关机时不执行，下次按待译队列继续。不是云端翻译，也没有迁移到 Myservers。
- 已用 5 篇 NIMA 论文验证完整通道，并于 2026-11-06 首次定时完成 24 条翻译（0 失败）及自动发布。现已调高到每轮最多 100 条，新配额的整轮运行尚待验证；达到翻译时间预算会留待下一轮继续，不保证每轮恰好完成 100 条。`config/translation-worker.json` 描述配置状态，不是单靠修改该文件就能创建任务。
- 每批最多 5 条，默认每次 100 条、30 分钟预算；论文、新闻、通知按 4:1:1 配额交替。新资料优先，同日论文优先 NIMA。旧 Qwen 的失败记录不影响 Sol 首次尝试。
- 独立临时工作目录、只读沙箱、关闭 shell/子代理/搜索，源内容仅作为数据。按用户要求采用直接翻译：不再因数字、公式、单位、缩写、术语、中文比例或长度差异拦截译文。仅保留调用完成、JSON/文章 ID、非空结果及源文未变化等基础运行检查，防止写错文章或损坏数据。长原文不截断，调用失败按 1—7 天退避；旧内容校验失败立即重新进入待译队列。重复启动用文件锁防止竞争，每批原子保存，成功结果可断点续跑。
- 用户术语优先于默认核物理词表；补摘要尽量保留已有有效中文题目。用户术语仍作为翻译提示，不再逐条验收。新产出标注直接机器初译、未经内容校验或人工校对；不修改已有译文的历史来源标记。
- `scripts/translate_codex.py` 是仅翻译入口；`scripts/run_local_translation.py` 是本机翻译并发布入口。后者自动读取 GitHub 最新数据，在临时目录翻译，只提交译文、翻译队列、批次报告及重试记录这四类文件，不改收藏、笔记、个人配置或当前工作区。
- 本机发布程序通过 GitHub CLI 已有登录创建非强推提交；遇到并发更新先读取最新版本再合并，不覆盖别人已完成的译文。调用独立的 `deploy_only` 发布模式，不重新抓取文章、不重复发布公众号。只有 GitHub Pages 作业成功后才记录已发布。
- 正常完成后清理本轮临时译文，只留运行状态；上传或发布失败时，在忽略的 `output/local-translation/pending.json` 保留待重传内容，下次优先补传，不再次消耗模型额度翻译相同内容。登录凭据始终留在本机，不上传 GitHub。

在可信且已有 CLI 登录的机器上：

```sh
python3 scripts/translate_codex.py --dry-run --limit 12
python3 scripts/translate_codex.py --limit 100 --batch-size 4 --max-minutes 30
python3 scripts/build_site.py

# 翻译并自动更新网站，不需要再手动提交。
python3 scripts/run_local_translation.py --limit 100 --batch-size 4 --max-minutes 30
# 定时任务会额外传入 --scheduled，便于区分计划运行和人工测试。
# 如当前网络需要本机代理，可仅为本次命令设置 HTTPS_PROXY，不修改全局配置。
```

本机运行状态在忽略的 `output/local-translation/status.json`，包含提交编号与发布记录链接；待重传数据只在失败时保留。当前环境使用已有的本机代理连接 GitHub，不修改系统代理配置。

`data/translation-run.json` 记录真实批次结果；`data/translation-sol-retries.json` 记录 Sol 重试状态。保留旧离线脚本仅用于人工比较，不再自动启动。

国内收藏同步仍需有效的腾讯云登录以及真实主站验证；未取得合法访问时不修改密码、不替换云存储，不把静态站误报为已经跨设备同步。2026-09-05 从旧部署记录找回的地址为 `https://nuclear-frontier-402lzxdr.edgeone.cool`，当日首页及 `/api/personal-state` 均返回 EdgeOne 401（访问受限或授权失效），不是有效公开快照，因此没有盲目配置备份地址。


## 论文版本关联（2026-11）

- 日常采集与全历史索引共用归并规则：相同 DOI、去版本号的 arXiv ID、Crossref 明确的 `has-preprint` / `is-preprint-of` 关系优先；无强标识时只允许标准化题目完全相同且作者吻合，不进行模糊标题自动合并。不同期刊 DOI 的勘误、评论等保持独立。
- 每日采集按轮转队列检查最多 120 条预印本的 arXiv 官方发表关联；使用单连接和不少于 3 秒的请求间隔，7 天复查间隔。来源未提供 DOI 时不会猜测已发表；查不到或请求失败不删除原记录。字段依据 [arXiv API 手册](https://info.arxiv.org/help/api/user-manual.html) 与 [Crossref 关联元数据](https://www.crossref.org/documentation/schema-library/markup-guide-metadata-segments/relationships/)。
- 已发表版本优先展示期刊元数据，保留 `record_aliases`、预印本原始题目/摘要、两种版本链接及各自日期。Cite 默认期刊版，可在下方切换预印本；期刊缺摘要时保留已有预印本摘要并标注来源，不将两个摘要拼接。
- 收藏、关键词、笔记、忽略和阅读状态按旧 ID 兼容读取；两份不同笔记同时显示，直到用户主动编辑合并。构建过程不改写个人数据。历史原始分片保留，发布索引按合并后的论文计数。
- 相同源文才复用旧 ID 的译文；正式版本源文变化会重新排队，旧译文不冒充新摘要。新译文写入前，上一版按源文哈希归档到翻译数据的 `versions` 中；右侧预印本展开区可显示对应旧译文。只做源文对应保护，不恢复数字、公式、术语等内容质量拦截。
- 每日统计把“新入库论文”与“预印本转正式发表”分开；历史去重清理不冒充当日新增。采集与元数据不完整时仍可能存在未识别版本，不保证零遗漏。

### 重点文献期刊范围

重点文献统一使用 `config/featured-journals.json`：NIMA、PRL、Nature 系列、Science 系列、SB / Science Bulletin（含中文《科学通报》）。首页和论文“重点”选项共用该范围，NIMA 仍保留最多四个首页优先位置；这里只是个人关注范围，不代表文章质量评价。

在原有 Nature、Nature Physics、Nature Astronomy、Nature Communications、Science 和 Science Bulletin 来源基础上，新增已核对 Crossref ISSN 的 Communications Physics、Nature Materials、Nature Photonics、Nature Computational Science、npj Quantum Information、Science Advances 和中文《科学通报》。新来源从下一次每日采集开始获取文章，仍执行物理相关性筛选；未宣称全系列所有期刊、全部历史文章都已抓取。名单可继续在上述配置及 `config/sources.json` 扩展。


### 论文收录范围（2026-11-08）

- 纯粒子物理论文只保留已经正式发表于 PRL、Nature 系列、Science 系列的记录；Science Bulletin 不属于 Science 系列例外。核物理交叉、探测器及实验装置按研究主题判断，不因出现粒子名称直接排除。
- 预印本仅收录核物理、物理实验和探测/束流装置相关内容；其他方向要求有正式期刊版本，或可核对的期刊引用和正式 DOI 关系。arXiv DOI、投稿或接收声明本身不算正式发表。纯粒子物理限制优先于“实验”例外。
- `scripts/paper_scope.py` 在采集、日常展示、全部历史检索、简报以及翻译选取/重传中共用。优先依据题目、摘要与来源，不把旧的宽泛分类标签当作确定的研究重心；元数据不足或跨学科内容仍可能存在误判。
- 现有日常和历史源文、已有译文及个人收藏笔记保留；不符合范围的记录从公开论文列表/检索和后续翻译队列排除。预印本与正式版本先归并再判断，不因有 arXiv 链接排除已发表论文。
- 本机当前任务按每 15 分钟续跑，每轮最多 100 篇；待译总数只统计符合本节范围的论文。

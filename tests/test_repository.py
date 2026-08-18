from __future__ import annotations

import json
import unittest
import urllib.parse
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class RepositoryTests(unittest.TestCase):
    def test_required_json_is_valid(self):
        for path in [
            ROOT / "config" / "topics.json",
            ROOT / "config" / "sources.json",
            ROOT / "config" / "runtime.json",
            ROOT / "config" / "notice_portals.json",
            ROOT / "config" / "history_sources.json",
            ROOT / "data" / "papers.json",
            ROOT / "data" / "news.json",
            ROOT / "data" / "notices.json",
            ROOT / "data" / "status.json",
            ROOT / "data" / "translations.zh-CN.json",
            ROOT / "data" / "reference-resources.json",
            ROOT / "data" / "personal" / "state.json",
            ROOT / "site" / "data" / "translations.zh-CN.json",
            ROOT / "site" / "data" / "personal-state.json",
            ROOT / "site" / "data" / "notice-portals.json",
            ROOT / "site" / "data" / "reference-resources.json",
            ROOT / "site" / "data" / "history" / "manifest.json",
        ]:
            with self.subTest(path=path):
                json.loads(path.read_text(encoding="utf-8"))

    def test_note_github_urls_are_available_in_my_references(self):
        payload = json.loads((ROOT / "data" / "reference-resources.json").read_text(encoding="utf-8"))
        self.assertEqual(payload["source_repository"], "https://github.com/code-world-kang/Note_github")
        self.assertEqual(payload["source_file"], "网址记录.md")
        self.assertGreaterEqual(len(payload["items"]), 64)
        ids = [item["id"] for item in payload["items"]]
        self.assertEqual(len(ids), len(set(ids)))
        titles = {item["title"] for item in payload["items"]}
        self.assertTrue({"CERN ROOT 官网", "Geant4 官网", "NNDC核数据库", "Nature Physics", "ChatGPT", "OpenAI Developers"}.issubset(titles))
        groups = {item["group"] for item in payload["items"]}
        self.assertTrue({"official", "collaborations", "chatgpt", "data-analysis", "github-following"}.issubset(groups))
        for item in payload["items"]:
            with self.subTest(id=item["id"]):
                parsed = urllib.parse.urlsplit(item["url"])
                self.assertIn(parsed.scheme, {"http", "https"})
                self.assertTrue(parsed.hostname)
                self.assertTrue(item["description"])
                self.assertTrue(item["keywords"])
                self.assertTrue(item["group"])
        app = (ROOT / "site" / "app.js").read_text(encoding="utf-8")
        self.assertIn("reference-resources", app)
        self.assertIn("state.referenceResources", app)
        self.assertIn("REFERENCE_GROUPS", app)
        self.assertIn("function renderReferenceGroups", app)

    def test_every_paper_has_traceable_source(self):
        papers = json.loads((ROOT / "data" / "papers.json").read_text(encoding="utf-8"))
        for paper in papers:
            with self.subTest(id=paper.get("id")):
                self.assertTrue(paper.get("id"))
                self.assertTrue(paper.get("title"))
                self.assertTrue(paper.get("source"))
                self.assertTrue(paper.get("url"))
                self.assertIsInstance(paper.get("categories"), list)
                self.assertEqual(len(paper.get("categories", [])), len(set(paper.get("categories", []))))

    def test_figure_records_are_license_gated_and_bounded(self):
        papers = json.loads((ROOT / "data" / "papers.json").read_text(encoding="utf-8"))
        for paper in papers:
            figures = paper.get("figures", [])
            with self.subTest(id=paper.get("id")):
                self.assertLessEqual(len(figures), 2)
                if figures:
                    license_url = paper.get("license", "").lower()
                    self.assertTrue(
                        "creativecommons.org/licenses/by/" in license_url
                        or "creativecommons.org/publicdomain/zero/" in license_url
                    )
                    self.assertEqual(paper.get("rights_status"), "reusable")
                    for figure in figures:
                        self.assertTrue(figure.get("url"))
                        self.assertTrue(figure.get("caption"))
                        self.assertTrue(figure.get("source_url"))
                        parsed = urllib.parse.urlsplit(figure["url"])
                        self.assertEqual(parsed.scheme, "https")
                        self.assertIn(parsed.hostname, {"arxiv.org", "export.arxiv.org"})

    def test_core_nuclear_taxonomy_is_present(self):
        topics = json.loads((ROOT / "config" / "topics.json").read_text(encoding="utf-8"))
        ids = {item["id"] for item in topics["categories"]}
        for category in [
            "experimental-nuclear", "theoretical-nuclear", "nuclear-structure",
            "nuclear-decay", "nuclear-reactions", "detectors-daq",
        ]:
            self.assertIn(category, ids)

    def test_codex_translations_match_existing_records(self):
        records = []
        for filename in ["papers.json", "news.json", "notices.json"]:
            records.extend(json.loads((ROOT / "data" / filename).read_text(encoding="utf-8")))
        translations = json.loads((ROOT / "data" / "translations.zh-CN.json").read_text(encoding="utf-8"))
        record_ids = {record["id"] for record in records}
        self.assertEqual(translations.get("provider"), "Codex")
        self.assertGreaterEqual(len(translations.get("items", {})), 1)
        for record_id, item in translations["items"].items():
            with self.subTest(id=record_id):
                self.assertIn(record_id, record_ids)
                if item.get("title_zh") and item.get("abstract_zh"):
                    self.assertTrue(item.get("title_zh"))
                    self.assertTrue(item.get("abstract_zh"))
                elif item.get("title_zh"):
                    self.assertIn("未提供 abstract/summary", item.get("note", ""))
                    self.assertFalse(item.get("abstract_zh"))
                else:
                    self.assertIn("跳过翻译", item.get("note", ""))

    def test_site_entrypoint_exists(self):
        index = (ROOT / "site" / "index.html").read_text(encoding="utf-8")
        self.assertIn('id="cardList"', index)
        self.assertIn('id="scopeSelect"', index)
        self.assertIn('value="custom"', index)

        self.assertIn('id="customDateRange"', index)

        self.assertIn('id="dateFrom"', index)
        self.assertIn('id="dateTo"', index)
        self.assertNotIn('id="homeHubGrid"', index)
        self.assertIn('class="metrics briefing-metrics"', index)
        self.assertIn('id="homeDashboard"', index)
        self.assertIn('id="dailyPaperCount"', index)
        self.assertIn('id="homeNewsList"', index)
        self.assertIn('id="homeNoticeList"', index)
        self.assertIn('id="homeFeaturedList"', index)
        self.assertIn('id="noticePortalDialog"', index)
        self.assertIn('id="noticePortalSearch"', index)
        self.assertIn('id="dailyNoticeDashboard"', index)
        self.assertIn('id="dailyNoticeCategories"', index)
        self.assertIn('id="deadlineList"', index)
        self.assertIn('id="dailyNoticeList"', index)
        self.assertIn('Nature Communications', index)
        self.assertEqual(index.count('id="paperCount"'), 1)
        self.assertIn('id="paperCountHint"', index)
        self.assertNotIn('class="paper-figures"', index)
        self.assertNotIn('id="noteDialog"', index)
        self.assertIn('id="cloudSyncBar"', index)
        self.assertIn('id="submitGitHubSync"', index)
        self.assertIn('id="favoriteDialog"', index)
        self.assertIn('id="myKeywordList"', index)
        self.assertIn('id="mySpaceNav"', index)
        self.assertIn('id="myItemDialog"', index)
        self.assertIn('data-my-section="translations"', index)
        self.assertIn('id="translationShelfPanel"', index)
        self.assertIn('id="referenceGroupPanel"', index)
        self.assertIn('id="referenceGroupList"', index)
        self.assertIn('id="translationGlossaryDialog"', index)
        self.assertIn('id="historyKeywordPanel"', index)
        self.assertIn('id="historyMonthStats"', index)
        self.assertIn('id="citationDialog"', index)
        self.assertIn("小康康的物理世界", index)
        self.assertIn("window.location.protocol === 'file:'", index)
        self.assertIn('dataset.dayTheme', index)
        self.assertIn('src="./app.js?v=', index)

    def test_publisher_abstract_provenance_and_push_retry_are_wired(self):
        app = (ROOT / "site" / "app.js").read_text(encoding="utf-8")
        self.assertIn("function abstractSourceLabel", app)
        self.assertIn("期刊 Cite 导出", app)
        self.assertIn("期刊官网元数据", app)
        for workflow_name in ["update-and-deploy.yml", "sync-personal.yml"]:
            workflow = (ROOT / ".github" / "workflows" / workflow_name).read_text(encoding="utf-8")
            self.assertIn("git rebase origin/main", workflow)
            self.assertIn("for attempt in 1 2 3", workflow)

    def test_monthly_history_index_is_reconciled_and_lazy(self):
        manifest = json.loads((ROOT / "site" / "data" / "history" / "manifest.json").read_text(encoding="utf-8"))
        status = json.loads((ROOT / "data" / "history" / "status.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["start_month"], "2001-01")
        self.assertGreaterEqual(manifest["indexed_papers"], 1)
        self.assertGreaterEqual(manifest["indexed_months"], 1)
        self.assertGreaterEqual(manifest["backfill_complete_through"], "2001-03")
        self.assertTrue(all(status["months"][month]["complete"] for month in ["2001-01", "2001-02", "2001-03"]))
        yearly_count = 0
        for year in manifest["years"]:
            search = json.loads((ROOT / "site" / "data" / "history" / "search" / f"{year['year']}.json").read_text(encoding="utf-8"))
            stats = json.loads((ROOT / "site" / "data" / "history" / "stats" / f"{year['year']}.json").read_text(encoding="utf-8"))
            self.assertEqual(search["count"], len(search["items"]))
            self.assertEqual(stats["count"], sum(month["count"] for month in stats["months"]))
            yearly_count += search["count"]
        self.assertEqual(yearly_count, manifest["indexed_papers"])
        app = (ROOT / "site" / "app.js").read_text(encoding="utf-8")
        self.assertIn("async function searchAllHistory", app)
        self.assertIn("async function loadHistoryMonths", app)
        self.assertIn("state.historyMonthQueue.slice(0, 6)", app)
        self.assertNotIn("Promise.all(years", app)
        workflow = (ROOT / ".github" / "workflows" / "update-and-deploy.yml").read_text(encoding="utf-8")
        self.assertIn("backfill_history.py --next 6", workflow)

    def test_home_featured_papers_reuse_paper_page_cards(self):
        index = (ROOT / "site" / "index.html").read_text(encoding="utf-8")
        app = (ROOT / "site" / "app.js").read_text(encoding="utf-8")
        styles = (ROOT / "site" / "styles.css").read_text(encoding="utf-8")
        self.assertIn("const article = cardFor(item);", app)
        self.assertIn("article.classList.add('home-featured-paper-card');", app)
        self.assertIn("const featured = [...state.papers]", app)
        self.assertIn('id="translationProgressTrack"', index)
        self.assertIn("translationProgressPercent", app)
        self.assertIn(".home-featured-list {", styles)
        self.assertIn(".home-translation-progress", styles)
        self.assertIn("display: grid", styles)

    def test_papers_can_be_ignored_and_restored(self):
        index = (ROOT / "site" / "index.html").read_text(encoding="utf-8")
        app = (ROOT / "site" / "app.js").read_text(encoding="utf-8")
        sync = (ROOT / "scripts" / "sync_github_issue.py").read_text(encoding="utf-8")
        self.assertIn("ignoredItems", app)
        self.assertIn("function toggleIgnored", app)
        self.assertIn("state.view === 'ignored'", app)
        self.assertIn('data-view="ignored"', index)
        self.assertIn('"ignoredItems"', sync)

    def test_google_translation_uses_prefilled_official_page(self):
        app = (ROOT / "site" / "app.js").read_text(encoding="utf-8")
        self.assertIn("function googleTranslationPageUrl", app)
        self.assertIn("Google 翻译官网 ↗", app)
        self.assertIn("https://translate.google.com/", app)
        self.assertNotIn("https://translate.googleapis.com/translate_a/single", app)
        self.assertNotIn("function requestGoogleTranslation", app)

    def test_reader_ui_is_text_first_and_notes_are_inline_and_public(self):
        index = (ROOT / "site" / "index.html").read_text(encoding="utf-8")
        app = (ROOT / "site" / "app.js").read_text(encoding="utf-8")
        runtime = json.loads((ROOT / "config" / "runtime.json").read_text(encoding="utf-8"))
        self.assertEqual(runtime.get("figure_enrichment_limit"), 0)
        self.assertNotIn("appendFigureGallery", app)
        self.assertNotIn("论文关键图", index + app)
        self.assertIn("function inlineNoteEditorFor", app)
        self.assertIn("function saveInlineNote", app)
        self.assertIn("function submitGitHubSync", app)
        self.assertIn("GitHub 公开同步", index)
        self.assertIn("nuclear-frontier-personal-state:v1", app)
        self.assertNotIn("localStorage", app)
        self.assertNotIn("OneDrive", index + app)
        self.assertIn("state.scope === 'custom'", app)

    def test_paper_information_panel_omits_title_and_reading_actions(self):
        app = (ROOT / "site" / "app.js").read_text(encoding="utf-8")
        styles = (ROOT / "site" / "styles.css").read_text(encoding="utf-8")
        panel = app.split("function renderAssistantPaperDetail(item) {", 1)[1].split(
            "function renderPaperAssistant", 1
        )[0]
        self.assertNotIn('<h3>${text(item.title)}</h3>', panel)
        self.assertNotIn('<span>阅读操作</span>', panel)
        self.assertNotIn('id="assistantReadAction"', panel)
        self.assertIn("paper-assistant-available", app)
        self.assertIn("@media (min-width: 561px)", styles)
        self.assertIn("body.paper-assistant-available main { padding-right: var(--assistant-sidebar-width); }", styles)
        self.assertIn("transform: none", styles)

    def test_translation_collection_and_custom_glossary_are_persistent(self):
        index = (ROOT / "site" / "index.html").read_text(encoding="utf-8")
        app = (ROOT / "site" / "app.js").read_text(encoding="utf-8")
        styles = (ROOT / "site" / "styles.css").read_text(encoding="utf-8")
        self.assertIn("translationFavorites", app)
        self.assertIn("translationGlossary", app)
        self.assertIn("function applyTranslationGlossary", app)
        self.assertIn("function toggleTranslationFavorite", app)
        self.assertIn("function saveTranslationGlossary", app)
        self.assertIn('id="translationPhraseSource"', index)
        self.assertIn('id="translationPhraseTarget"', index)
        self.assertIn(".translation-shelf-panel", styles)

    def test_single_paper_citation_supports_bibtex_and_gbt_7714_2025(self):
        index = (ROOT / "site" / "index.html").read_text(encoding="utf-8")
        app = (ROOT / "site" / "app.js").read_text(encoding="utf-8")
        styles = (ROOT / "site" / "styles.css").read_text(encoding="utf-8")
        self.assertIn('value="bibtex"', index)
        self.assertIn('value="gbt7714-2025"', index)
        self.assertIn("function toBibTeX", app)
        self.assertIn("function toGBT7714_2025", app)
        self.assertIn("function openCitationDialog", app)
        self.assertIn("function citationPanelFor", app)
        self.assertIn("function toggleInlineCitation", app)
        self.assertIn("function toggleCitationPanelInHost", app)
        self.assertNotIn("cite.addEventListener('click', () => openCitationDialog(item))", app)
        self.assertIn("function enrichCitationMetadata", app)
        self.assertIn("Object.keys(state.translations).forEach", app)
        self.assertIn("function localizedTitle", app)
        self.assertNotIn("renderDailyNoticeDashboard", app)
        self.assertIn("Google 翻译官网", app)
        self.assertIn("data-assistant-cite", app)
        self.assertIn("data-assistant-citation", app)
        self.assertIn("[PP/OL]", app)
        self.assertIn("[J/OL]", app)
        self.assertIn("item.volume", app)
        self.assertIn("item.numpages", app)
        self.assertIn(".paper-actions .cite-button", styles)
        self.assertIn(".assistant-cite-button", styles)
        self.assertIn(".inline-citation-panel", styles)
        self.assertIn("localeCompare(b[0], 'en'", app)
        self.assertIn("std.samr.gov.cn/gb/search/gbDetailed", index)

    def test_notice_portal_is_official_categorized_and_searchable(self):
        payload = json.loads((ROOT / "config" / "notice_portals.json").read_text(encoding="utf-8"))
        categories = {item["id"] for item in payload["categories"]}
        required = {
            "funding-national", "funding-local", "talent", "beam-domestic",
            "beam-international", "meetings-nuclear", "funding-international",
        }
        self.assertTrue(required.issubset(categories))
        self.assertGreaterEqual(len(payload["entries"]), 45)
        ids = [item["id"] for item in payload["entries"]]
        self.assertEqual(len(ids), len(set(ids)))
        searchable_text = " ".join(
            " ".join([item["name"], item.get("scope", ""), *(item.get("tags") or [])])
            for item in payload["entries"]
        )
        for keyword in ["国家自然科学基金", "博士后", "CSC", "RIBLL", "NUSYS", "核电子学", "核结构"]:
            self.assertIn(keyword, searchable_text)
        for item in payload["entries"]:
            with self.subTest(id=item["id"]):
                self.assertIn(item["category"], categories)
                self.assertTrue(item["name"])
                self.assertTrue(item["description"])
                parsed = urllib.parse.urlsplit(item["url"])
                self.assertEqual(parsed.scheme, "https")
                self.assertTrue(parsed.hostname)

    def test_notice_portal_only_scrolls_vertically(self):
        styles = (ROOT / "site" / "styles.css").read_text(encoding="utf-8")
        app = (ROOT / "site" / "app.js").read_text(encoding="utf-8")
        self.assertIn(".notice-portal-list", styles)
        self.assertIn("overflow-x: hidden", styles)
        self.assertIn("overflow-y: auto", styles)
        self.assertIn("function renderNoticePortal", app)
        self.assertIn("noticePortalQuery", app)

    def test_daily_notice_sources_and_ui_are_categorized(self):
        sources = json.loads((ROOT / "config" / "sources.json").read_text(encoding="utf-8"))["notice_pages"]
        monitored = [item for item in sources if item.get("kind", "notice") == "notice"]
        self.assertGreaterEqual(len(monitored), 30)
        categories = {item.get("notice_category") for item in monitored}
        self.assertTrue({
            "funding-national", "funding-local", "talent", "beam-domestic",
            "beam-international", "meetings-nuclear", "funding-international",
        }.issubset(categories))
        app = (ROOT / "site" / "app.js").read_text(encoding="utf-8")
        styles = (ROOT / "site" / "styles.css").read_text(encoding="utf-8")
        self.assertIn("function renderDailyNotices", app)
        self.assertIn("function deadlineState", app)
        self.assertIn(".daily-notice-list", styles)
        self.assertIn("overflow-x: hidden", styles)

    def test_nuclear_meeting_series_are_monitored_and_visible(self):
        sources = json.loads((ROOT / "config" / "sources.json").read_text(encoding="utf-8"))["notice_pages"]
        names = {item.get("name") for item in sources}
        self.assertTrue({
            "中国核学会会议（官方承办单位）", "全国先进气体探测器 Indico",
            "北京大学 Indico 核物理会议", "近代物理所 Indico 全量", "高能所 Indico 核物理全量",
        }.issubset(names))
        searchable = " ".join(
            " ".join([item.get("name", ""), item.get("scope", ""), *(item.get("include") or [])])
            for item in sources if item.get("notice_category") == "meetings-nuclear"
        )
        for keyword in ["中国核学会", "气体探测器", "RIBLL", "HIAF", "核物理及核数据中的机器学习", "全国核物理大会", "全国核结构大会", "全国重点实验室"]:
            self.assertIn(keyword, searchable)
        indico_sources = [item for item in sources if item.get("format") == "indico-json"]
        self.assertGreaterEqual(len(indico_sources), 6)
        self.assertTrue(all("/export/categ/" in item["url"] for item in indico_sources))

        app = (ROOT / "site" / "app.js").read_text(encoding="utf-8")
        styles = (ROOT / "site" / "styles.css").read_text(encoding="utf-8")
        self.assertIn("function noticeLabelBadges", app)
        self.assertIn("function noticeEventDate", app)
        self.assertIn("...(item.organizations || [])", app)
        self.assertIn(".notice-organization", styles)

    def test_papers_news_and_notices_have_separate_left_classifications(self):
        index = (ROOT / "site" / "index.html").read_text(encoding="utf-8")
        app = (ROOT / "site" / "app.js").read_text(encoding="utf-8")
        styles = (ROOT / "site" / "styles.css").read_text(encoding="utf-8")
        self.assertIn('id="researchFieldTitle"', index)
        self.assertIn('id="dailyNoticeCategories"', index)
        self.assertIn('id="noticeDetailPanel"', index)
        self.assertIn("const categoryItems = state.view === 'news' ? state.news", app)
        self.assertIn("state.view === 'papers' && state.globalKeyword ? state.historyResults : state.papers", app)
        self.assertIn("state.categorySelections[state.view === 'news' ? 'news' : 'papers']", app)
        self.assertIn("NOTICE_GROUPS", app)
        self.assertIn("会议通知", app)
        self.assertIn("科研基金", app)
        self.assertIn("束流申请", app)
        self.assertIn("function renderAssistantNewsDetail", app)
        self.assertIn("function renderNoticeDetail", app)
        self.assertIn("function localizedDescription", app)
        self.assertIn(".daily-notice-layout", styles)
        self.assertIn(".notice-detail-panel", styles)
        self.assertIn(".notice-original-preview", styles)

    def test_published_notice_feed_excludes_non_physics_fields(self):
        notices = json.loads((ROOT / "data" / "notices.json").read_text(encoding="utf-8"))
        self.assertGreater(len(notices), 0)
        forbidden = [
            "生物", "医学", "医疗", "疾病", "癌症", "肿瘤", "药物", "细胞", "基因", "化学", "化工",
            "biology", "biomedical", "medicine", "medical", "chemistry", "chemical",
        ]
        for item in notices:
            with self.subTest(title=item.get("title")):
                # 核物理会议的承办单位可能合法包含“核物理与化学研究所”，
                # 所以主题排除以标题为准，不因机构全称误删核物理会议。
                title_value = item.get("title", "").lower()
                self.assertFalse(any(term in title_value for term in forbidden))

        index = (ROOT / "site" / "index.html").read_text(encoding="utf-8")
        self.assertIn("只展示物理领域通知", index)
        self.assertIn("自动排除生物、医学和化学主题", index)

    def test_papers_can_be_saved_to_local_zotero_with_notes_and_pdf(self):
        app = (ROOT / "site" / "app.js").read_text(encoding="utf-8")
        styles = (ROOT / "site" / "styles.css").read_text(encoding="utf-8")
        bridge = (ROOT / "zotero_bridge" / "bridge.py").read_text(encoding="utf-8")
        self.assertIn("function saveToZotero", app)
        self.assertIn("function zoteroPayload", app)
        self.assertIn("function zoteroClassificationPanelFor", app)
        self.assertIn("确认分类并保存", app)
        self.assertIn("classification: [...draft.classification]", app)
        self.assertIn("data-zotero-save", app)
        self.assertIn("X-Nuclear-Frontier-Bridge", app)
        self.assertIn("http://127.0.0.1:43119", app)
        self.assertIn(".zotero-button", styles)
        self.assertIn(".zotero-classification-panel", styles)
        self.assertIn('"/connector/getSelectedCollection"', bridge)
        self.assertIn('"/connector/saveItems"', bridge)
        self.assertIn('"/connector/updateSession"', bridge)
        self.assertIn('"/connector/saveAttachment"', bridge)
        self.assertIn('"/connector/saveAttachmentFromResolver"', bridge)
        self.assertIn("ALLOWED_ORIGINS", bridge)
        self.assertIn('BRIDGE_HOST = "127.0.0.1"', bridge)
        self.assertNotIn("api_key", bridge.lower())
        self.assertNotIn("localStorage", app)


if __name__ == "__main__":
    unittest.main()

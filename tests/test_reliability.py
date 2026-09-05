import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import update_content as pipeline
import translate_content as translation
import backup_cloud_personal as backup


class ReliabilityTests(unittest.TestCase):
    def setUp(self):
        self.classifier = pipeline.Classifier(json.loads((ROOT / "config/topics.json").read_text()))

    def test_cluster_scope_and_chinese_nuclear_structure(self):
        for title in ['Alpha-cluster structure and the Hoyle state', '原子核的团簇结构与壳演化']:
            categories, _ = self.classifier.classify(title, '', 'Physical Review Letters')
            self.assertIn('nuclear-clusters', categories)
            self.assertTrue(self.classifier.relevant(title, '', 'filtered'))
        self.assertIn('nuclear-structure', self.classifier.classify('核结构与形状共存', '')[0])
        self.assertNotIn('nuclear-clusters', self.classifier.classify('Cluster structure of galaxies', '')[0])

    def test_rna_does_not_match_international(self):
        self.assertTrue(pipeline.notice_is_physics_relevant('8th International Workshop on Nuclear Dynamics in Heavy-ion Reactions (IWND2026)', notice_category='meetings-nuclear'))
        self.assertFalse(pipeline.notice_is_physics_relevant('RNA biology international meeting', notice_category='meetings-nuclear'))

    def test_general_funding_without_physics_word_is_kept(self):
        for title in ['关于开展中国博士后科学基金申报工作的通知', '北京市自然科学基金项目申请指南']:
            self.assertTrue(pipeline.notice_is_physics_relevant(title, notice_category='funding-local'))
        self.assertFalse(pipeline.notice_is_physics_relevant('临床医学专项申报指南', notice_category='funding-national'))

    def test_indico_rejects_test_event_not_detector_testbeam(self):
        self.assertTrue(pipeline.notice_is_test('IWND2026-test1'))
        self.assertFalse(pipeline.notice_is_test('Workshop on detector test beams'))
        self.assertFalse(pipeline.notice_is_test('测试束流与先进探测器会议'))

    def test_body_extraction_excludes_navigation(self):
        parser = pipeline.ArticleBodyParser()
        parser.feed('<nav>当前位置 首页 字号</nav><div class="TRS_Editor"><p>' + '关于本年度核物理基金项目申报的通知。' * 5 + '</p></div><footer>联系我们 隐私政策</footer>')
        self.assertIn('核物理基金', parser.body)
        self.assertNotIn('当前位置', parser.body)
        self.assertNotIn('隐私政策', parser.body)

    def test_blocked_news_is_not_an_abstract(self):
        item = {'id': 'safe-id', 'title': 'New experiment', 'summary': 'Client Challenge: enable javascript', 'content': ''}
        self.assertTrue(pipeline.clean_record_content(item))
        self.assertEqual(item['summary'], '')
        self.assertEqual(item['id'], 'safe-id')
        with patch.object(pipeline, 'fetch', return_value=b'<title>Client Challenge</title><p>Please enable javascript</p>'):
            with self.assertRaises(ValueError):
                pipeline.news_detail_metadata('https://example.org/news')

    def test_indico_actual_title_and_fixture_filter(self):
        source = {'name': 'test', 'url': 'https://example.org/export/categ/0.json', 'include': ['IWND'], 'notice_category': 'meetings-nuclear'}
        events = [{'id': '492', 'title': 'International Nuclear Dynamics (IWND2026)', 'url': 'https://example.org/event/492/'}, {'id': '491', 'title': 'IWND2026-test1'}]
        with patch.object(pipeline, 'fetch', return_value=json.dumps({'results': events}).encode()):
            records, status = pipeline.fetch_indico_notices(source, self.classifier)
        self.assertTrue(status.ok)
        self.assertEqual([r['url'] for r in records], ['https://example.org/event/492/'])

    def test_crossref_reads_more_than_one_page(self):
        source = {'name': 'Physical Review C', 'short': 'PRC', 'issn': '2469-9985', 'mode': 'all', 'weight': 5}
        pages = [{'message': {'total-results': 2, 'next-cursor': 'next', 'items': [{'title': ['Paper A'], 'DOI': '10.1/a'}]}}, {'message': {'total-results': 2, 'items': [{'title': ['Paper B'], 'DOI': '10.1/b'}]}}]
        with patch.object(pipeline, 'fetch', side_effect=[json.dumps(p).encode() for p in pages]) as fetch:
            records, result = pipeline.fetch_crossref(source, self.classifier, '2026-01-01', '2026-01-31')
        self.assertTrue(result.ok)
        self.assertEqual(len(records), 2)
        self.assertEqual(fetch.call_count, 2)
        self.assertNotIn('sort=published', fetch.call_args.args[0])

    def test_distinct_doi_and_recurring_notice_not_merged(self):
        records = [{'id': 'a', 'title': 'Same title', 'type': 'paper', 'doi': '10.1/a'}, {'id': 'b', 'title': 'Same title', 'type': 'paper', 'doi': '10.1/b'}]
        self.assertEqual(len(pipeline.merge_records(records[:1], records[1:], 10)), 2)
        notices = [{'id': 'a', 'title': '年度会议', 'type': 'notice', 'url': 'https://example.org/1'}, {'id': 'b', 'title': '年度会议', 'type': 'notice', 'url': 'https://example.org/2'}]
        self.assertEqual(len(pipeline.merge_records(notices[:1], notices[1:], 10)), 2)

    def test_empty_translation_is_pending_and_chinese_body_is_not(self):
        item = {'id': 'a', 'title': 'Nuclear experiment', 'abstract': 'This is an original abstract.'}
        self.assertTrue(translation.needs_translation(item, {'a': {'title_zh': '', 'abstract_zh': ''}}))
        self.assertTrue(translation.needs_translation(item, {'a': {'title_zh': '原子核实验'}}))
        self.assertFalse(translation.needs_translation({'id': 'b', 'title': '核物理实验论文', 'summary': '这里是原本中文的完整实验介绍'}, {}))
        self.assertEqual(len(translation.source_text({'abstract': 'a' * 9000})), 9000)

    def test_retired_or_unconfigured_translator_is_never_default(self):
        self.assertEqual(translation.DEFAULT_ENDPOINT, '')
        self.assertEqual(translation.queue_payload([], '')['service_status'], 'not_configured')

    def test_incomplete_cloud_backup_is_rejected(self):
        for payload in [{}, {'version': 1, 'personal': {}}, {'error': 'unavailable'}]:
            with self.assertRaises(ValueError):
                backup.validated_snapshot(payload)

    def test_strip_only_clear_notice_navigation_prefix(self):
        text = '题目 当前位置：首页 字号：大中小 打印 ' + '申请核物理项目请查阅以下说明。' * 6
        self.assertNotIn('当前位置', pipeline.strip_notice_chrome(text))
        self.assertTrue(pipeline.strip_notice_chrome(text).startswith('申请'))
        self.assertEqual(pipeline.strip_notice_chrome('使用三维打印制作核探测器'), '使用三维打印制作核探测器')

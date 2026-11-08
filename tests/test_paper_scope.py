import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from paper_scope import eligible_paper, exclusion_reason
from translation_catalog import source_records
import build_history
import update_content as collect
import run_local_translation as local
import translate_codex as sol


def paper(title, source='arXiv hep-ph', kind='preprint', **extra):
    return dict(dict(id='p', type='paper', title=title, source=source, source_type=kind,
                     abstract='', published='2025-01-01'), **extra)


class PaperScopeTests(unittest.TestCase):
    def test_pure_particles_require_selected_published_journal(self):
        for source in ('Physical Review D', 'Physics Letters B', 'Science Bulletin', 'Science China Physics'):
            with self.subTest(source=source):
                self.assertFalse(eligible_paper(paper('Higgs boson couplings', source, 'journal')))
        for source in ('Physical Review Letters', 'PRL', 'Phys. Rev. Lett.', 'Nature', 'Nature Physics',
                       'Nature Communications', 'npj Quantum Information', 'Communications Physics',
                       'Scientific Reports', 'Science', 'Science Advances', 'Sci. Adv.'):
            with self.subTest(source=source):
                self.assertTrue(eligible_paper(paper('Higgs boson couplings', source, 'journal')))
        self.assertFalse(eligible_paper(paper('Higgs boson couplings', 'PRL')))
        # 接收声明、通用 published 状态或 arXiv DOI 都不替代期刊证据。
        self.assertFalse(eligible_paper(paper('Quantum computing', doi='10.48550/arXiv.2601.12345',
                                             publication_status='published', journal_ref='Accepted by Nature')))

    def test_particle_experiment_does_not_bypass_journal_rule(self):
        item = paper('Measurement of Higgs production with ATLAS', abstract='Silicon detectors and nuclear targets are used.',
                     categories=['experimental-nuclear', 'detectors-daq', 'high-energy-nuclear'])
        self.assertFalse(eligible_paper(item))
        self.assertFalse(eligible_paper(paper('Search for dark matter using a silicon detector')))
        self.assertFalse(eligible_paper(paper('Heavy-meson bag parameters using gradient flow',
                                             'arXiv hep-lat', categories=['theoretical-nuclear'])))
        self.assertFalse(eligible_paper(paper('Probing baryon oscillations with lattice QCD')))

    def test_nuclear_and_instrumentation_are_retained_across_sources(self):
        examples = (
            ('Nuclear structure of calcium isotopes', 'arXiv nucl-th'),
            ('Alpha-cluster dynamics in nuclei', 'arXiv nucl-ex'),
            ('Neutrino interactions with nuclei', 'arXiv hep-ph'),
            ('Quark-gluon plasma in heavy-ion collisions', 'arXiv hep-ph'),
            ('Nucleon structure from lattice QCD', 'arXiv hep-lat'),
            ('Short-range correlations in the deuteron with meson exchange', 'Physical Review C'),
            ('Neutrino exchange in double-β decay', 'arXiv nucl-th'),
            ('Hadronic rescattering in high-energy nuclear collisions', 'arXiv hep-ph'),
            ('Neutron star equation of state', 'arXiv astro-ph.HE'),
            ('CMS ECAL VFE Production Qualification', 'arXiv physics.ins-det'),
            ('Silicon detector readout for ATLAS', 'arXiv hep-ex'),
            ('Machine learning for nuclear reactions', 'arXiv cs.LG'),
            ('Beam dynamics of a new linac', 'arXiv physics.acc-ph'),
            ('Experimental measurement of plasma turbulence', 'arXiv physics.plasm-ph'),
        )
        for title, source in examples:
            with self.subTest(title=title):
                self.assertTrue(eligible_paper(paper(title, source)))

    def test_other_directions_require_publication(self):
        for title in ('A new neural network for scientific computing', 'Black hole thermodynamics',
                      'Quantum entanglement entropy', 'Numerical models of tokamak turbulence'):
            with self.subTest(title=title):
                self.assertEqual(exclusion_reason(paper(title, 'arXiv')), 'requires-journal-publication')
                self.assertTrue(eligible_paper(paper(title, 'Physical Review D', 'journal')))
        self.assertTrue(eligible_paper(dict(type='news', title='Higgs discovery')))

    def test_verified_journal_relation_allows_preprint_copy(self):
        item = paper('Quantum entanglement entropy', 'arXiv', journal_ref='Physical Review A 100, 123456',
                     publication_links=[dict(relation='is-preprint-of', id_type='doi', id='10.1103/PhysRevA.100.123456')])
        self.assertTrue(eligible_paper(item))
        item.update(title='Higgs couplings', journal_ref='Phys. Rev. Lett. 100, 123456')
        self.assertTrue(eligible_paper(item))
        item['journal_ref'] = 'Physical Review D 100, 123456'
        self.assertFalse(eligible_paper(item))

    def test_history_translation_and_public_index_share_policy_without_erasing_sources(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data = root / 'data'
            shard = data / 'history/papers/2025/01.json'
            shard.parent.mkdir(parents=True)
            keep = paper('Nuclear structure of 52Ca', 'arXiv nucl-th')
            excluded = {**paper('Higgs boson couplings'), 'id': 'excluded'}
            pre = {**paper('Quantum entanglement entropy', 'arXiv', arxiv_id='2501.00001'), 'id': 'pre'}
            journal = {**paper('Quantum entanglement entropy', 'Nature Physics', 'journal',
                               arxiv_id='2501.00001'), 'id': 'journal'}
            (data / 'papers.json').write_text(json.dumps([keep, excluded, pre]))
            shard.write_text(json.dumps([journal, excluded]))
            before = {p: p.read_bytes() for p in (data / 'papers.json', shard)}
            selected = source_records(root)
            self.assertEqual({p['id'] for p in selected}, {'p', 'pre'})
            self.assertIn('journal', next(p for p in selected if p['id'] == 'pre')['record_aliases'])
            with patch.object(build_history, 'DATA', data), patch.object(build_history, 'PUBLIC', root / 'public'):
                history = build_history.all_history_records()
                self.assertEqual({p['id'] for p in history}, {'p', 'pre'})
                manifest = build_history.build_history_site([*history, excluded])
                self.assertEqual(manifest['indexed_papers'], 2)
            self.assertEqual({p: p.read_bytes() for p in before}, before)
            # 政策变更时旧待传结果不会被发布，也不会修改现存译文。
            old_translation = {'title_zh': '已存旧译文'}
            sol.write_json(data / 'translations.zh-CN.json', {'items': {'excluded': old_translation}})
            record = sol.translation_record(excluded, {'title_zh': '新译文', 'abstract_zh': ''}, {})
            report = local.merge_bundle(root, {'records': {'excluded': record}, 'retries': {},
                                               'report': {'automatic': True, 'failed': 0}})
            self.assertEqual(report['completed'], 0)
            self.assertEqual(sol.read(data / 'translations.zh-CN.json')['items']['excluded'], old_translation)

    def test_new_collection_applies_policy_before_records_enter_catalog(self):
        config = json.loads((Path(__file__).resolve().parents[1] / 'config/topics.json').read_text())
        classifier = collect.Classifier(config)
        source = dict(name='arXiv hep-ex', category='hep-ex', mode='all', weight=3)
        feed = [dict(title=title, summary='', creator='A. Physicist', published='2026-01-01',
                     url=f'https://arxiv.org/abs/2601.0000{index}') for index, title in enumerate(
                         ['Measurement of Higgs production with ATLAS', 'Silicon detector readout for ATLAS'])]
        with patch.object(collect, 'fetch_arxiv_feed_items', return_value=feed):
            records, status = collect.fetch_arxiv(source, classifier)
        self.assertTrue(status.ok)
        self.assertEqual([row['title'] for row in records], ['Silicon detector readout for ATLAS'])
        source = dict(name='Physics Letters B', short='PLB', issn='0370-2693', mode='all', weight=3)
        payload = dict(message={'total-results': 2, 'items': [
            dict(title=[title], DOI=f'10.1016/j.physletb.{i}', published={'date-parts': [[2026, 1, 1]]})
            for i, title in enumerate(['Higgs boson couplings', 'Nuclear reactions of halo nuclei'])]})
        with patch.object(collect, 'fetch', return_value=json.dumps(payload).encode()):
            records, status = collect.fetch_crossref(source, classifier, '2026-01-01', '2026-01-02')
        self.assertTrue(status.ok)
        self.assertEqual([row['title'] for row in records], ['Nuclear reactions of halo nuclei'])

    def test_policy_does_not_mutate_metadata(self):
        item = paper('Nuclear structure', versions=[dict(source_type='journal', source='Physical Review C')])
        before = copy.deepcopy(item)
        self.assertTrue(eligible_paper(item))
        self.assertEqual(item, before)


if __name__ == '__main__':
    unittest.main()

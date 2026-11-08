"""统一论文收录范围。只读元数据；不删除源文、已有译文或个人记录。"""
from functools import lru_cache
import re
import unicodedata


# 不沿用宽泛的 particle-cross / high-energy-nuclear 标签：它们包含来源回退值。
NUCLEAR = (
    'nuclear physics', 'nuclear structure', 'nuclear reaction', 'nuclear decay',
    'nuclear matter', 'nuclear medium', 'nuclear collision', 'nuclear force', 'nuclear symmetry', 'nuclear equation',
    'deuteron', 'deuterium', 'triton', 'tritium', 'helion', 'subnucleonic',
    'double electron capture', 'double-β', 'double β', 'ββ', 'β β', 'beta beta',
    'quasi-elastic', 'quasielastic', 'short-range correlation', 'ultraperipheral',
    'ultra-peripheral', 'quark matter', 'hadronic matter', 'quark star', 'hadronic star',
    'quark and gluon fluid', 'bjorken flow', 'baryon-baryon', 'dibaryon',
    'au+au', 'au + au', 'pb+pb', 'pb + pb', 'pb-pb', 'pbpb', 'p-pb', 'd + au',
    'nuclear cluster', 'nuclear spectroscopy', 'nuclear data', 'nuclear astrophysics',
    'nucleus', 'nuclei', 'nuclide', 'isotope', 'isotopic', 'isotopes', 'isotopic chain',
    'nucleon', 'nucleons', 'nucleon-nucleon', 'neutron-rich', 'proton-rich', 'neutron skin',
    'neutron star', 'neutron stars', 'neutron-star', 'nucleosynthesis', 'r-process',
    's-process', 'rp-process', 'stellar reaction', 'neutron capture', 'radiative capture',
    'fission', 'alpha decay', 'beta decay', 'beta-decay', 'double beta', 'double-beta',
    'alpha cluster', 'alpha-cluster', 'hoyle state', 'hypernuclear', 'hypernucleus',
    'hypernuclei', 'dineutron', 'tetraneutron', 'drip line', 'drip-line', 'shell evolution',
    'heavy-ion', 'heavy ion', 'quark-gluon plasma', 'quark gluon plasma', 'qgp',
    'jet quenching', 'elliptic flow', 'nuclear modification', 'color glass condensate',
    '核物理', '原子核', '核结构', '核反应', '核衰变', '核团簇', '同位素', '重离子',
)
PARTICLE = (
    'particle physics', 'high energy physics', 'high-energy physics',
    'standard model', 'beyond the standard model', 'higgs', 'supersymmetry',
    'supersymmetric', 'leptogenesis', 'baryogenesis', 'lepton', 'leptons', 'leptonic',
    'neutrino', 'neutrinos', 'dark matter', 'dark photon', 'axion', 'axions',
    'axion-like', 'quark', 'quarks', 'meson', 'mesons', 'baryon', 'baryons',
    'hadron', 'hadrons', 'hadronic', 'qcd', 'qed', 'electroweak', 'smeft',
    'seesaw', 'ckm', 'cp violation', 'flavor physics', 'flavour physics',
    'charmonium', 'bottomonium', 'quarkonium', 'tetraquark', 'pentaquark',
    'lhcb', 'besiii', 'belle', 'belle ii', 'atlas', 'cms', 'muon', 'muons',
    '粒子物理', '中微子', '暗物质', '夸克', '希格斯',
)
INSTRUMENT = (
    'detector', 'detectors', 'detection system', 'instrumentation', 'spectrometer',
    'calorimeter', 'calorimeters', 'scintillator', 'scintillators', 'scintillation',
    'data acquisition', 'daq', 'readout', 'electronics', 'digitizer', 'trigger system',
    'photomultiplier', 'sipm', 'silicon photomultiplier', 'time projection chamber',
    'gem chamber', 'gem chambers', 'micromegas', 'pixel sensor', 'tracking system',
    'beam diagnostic', 'beam diagnostics', 'beam line', 'beamline', 'beam dynamics',
    'accelerator', 'accelerators', 'cyclotron', 'synchrotron', 'linac', 'ion source',
    'storage ring', 'radiofrequency cavity', 'ecal', 'hcal', 'vfe',
    '探测器', '探测装置', '数据获取', '加速器', '束流',
)
EXPERIMENT = (
    'experiment', 'experimental', 'experiments', 'measurement', 'measurements',
    'measured', 'laboratory', 'test beam', '实验', '测量',
)
NUCLEAR_SOURCES = (
    'physical review c', 'nuclear physics a', 'the european physical journal a',
    'european physical journal a', 'international journal of modern physics e',
    'nuclear data sheets', 'atomic data and nuclear data tables',
)
INSTRUMENT_SOURCES = (
    'nuclear instruments and methods', 'journal of instrumentation',
    'review of scientific instruments', 'ieee transactions on nuclear science',
    'physical review accelerators and beams',
)
PARTICLE_SOURCES = (
    'physical review d', 'physics letters b', 'nuclear physics b',
    'journal of high energy physics', 'european physical journal c',
    'the european physical journal c',
)
# 这些标题明确不是纯粒子物理；不能仅凭 PRD/PLB 来源把它们剔除。
OTHER_PHYSICS = (
    'black hole', 'black holes', 'gravitational', 'gravity', 'cosmology',
    'inflation', 'cosmic', 'quantum information', 'quantum entanglement',
    'condensed matter', 'superconductivity', 'superconductor', 'topological',
    'plasma', 'tokamak', 'stellarator', 'fusion', 'machine learning', 'neural network',
    'scientific computing', 'artificial intelligence', 'quantum state', 'large language model',
    'large-language-model',
)


def normalized(value):
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFKC', str(value or '')).casefold()
                  .replace('–', '-').replace('−', '-').replace('‐', '-')).strip()


@lru_cache(maxsize=None)
def matcher(terms):
    return re.compile(r'(?<![a-z0-9])(?:' + '|'.join(re.escape(term) + (r's?' if term[-1].isascii() and term[-1].isalpha() and not term.endswith('s') else '') for term in terms) + r')(?![a-z0-9])')


def hits(text, terms):
    return bool(matcher(terms).search(text))


def sources(item):
    return ' '.join(normalized(item.get(key)) for key in ('source', 'source_short', 'journal_abbrev'))


def journal_versions(item):
    return [row for row in [item, *item.get('versions', [])] if row.get('source_type') == 'journal']


def published(item):
    if journal_versions(item):
        return True
    # arXiv DOI 本身不等于正式发表。预印本须同时有期刊引用和正式 DOI 关系。
    links = [link.get('id', '') for link in item.get('publication_links', [])
             if link.get('relation') == 'is-preprint-of' and link.get('id_type') == 'doi']
    dois = [item.get('doi', ''), *links]
    return bool(item.get('journal_ref') and any(
        re.match(r'^(?:https?://(?:dx\.)?doi\.org/)?10\.(?!48550/)[0-9]{4,9}/', normalized(doi))
        for doi in dois))


def exceptional_journal(item):
    if not published(item):
        return False
    rows = journal_versions(item)
    names = [normalized(row.get(key)).replace('.', '') for row in rows
             for key in ('source', 'source_short', 'journal_abbrev') if row.get(key)]
    # 期刊引用可能附带卷页，只有完整期刊名/明确缩写前缀才匹配。
    if item.get('journal_ref'):
        names.append(normalized(item['journal_ref']).replace('.', ''))
    pattern = (r'^(?:physical review letters|phys rev lett|prl|nature(?:\s+[^,;\d]+)?|'
               r'nat\s+[^,;\d]+|npj\s+[^,;\d]+|scientific reports|sci rep|'
               r'communications (?:physics|materials|chemistry|biology|earth.*)|'
               r'science(?: advances|robotics|immunology|translational medicine)?|'
               r'sci adv|sci robot)(?:$|[,;\s]+\d)')
    return any(re.match(pattern, name) for name in names)


def exclusion_reason(item):
    """空字符串表示收录；其余值是可审查的排除原因。纯粒子规则优先。"""
    if item.get('type', 'paper') != 'paper':
        return ''
    title = normalized(item.get('title'))
    body = normalized(item.get('abstract'))
    source = sources(item)
    particle_title = hits(title, PARTICLE)
    nuclear_title = hits(title, NUCLEAR)
    instrument = (hits(title, INSTRUMENT)
                  or any(name in source for name in INSTRUMENT_SOURCES)
                  or 'physics.ins-det' in source or 'physics.acc-ph' in source)
    if particle_title and re.search(r'\b(search for|measurement of|observation of|constraints on)\b', title):
        # 物理结果标题顺带提到探测器，不等于研究装置本身。
        instrument = instrument and hits(title, (
            'design', 'construction', 'performance', 'calibration', 'characterisation',
            'characterization', 'readout', 'upgrade', 'response', 'efficiency', 'electronics',
        ))
    # 粒子论文摘要中的核靶/探测器背景不改变论文重心；优先看题目。
    nuclear = (nuclear_title or 'nucl-ex' in source or 'nucl-th' in source
               or (not particle_title and (hits(body, NUCLEAR)
                   or any(name in source for name in NUCLEAR_SOURCES))))
    particle = (particle_title or hits(body, PARTICLE)
                or (not hits(title + ' ' + body, OTHER_PHYSICS)
                    and (any(name in source for name in PARTICLE_SOURCES)
                         or any(name in source for name in ('hep-ph', 'hep-ex', 'hep-lat', 'hep-th')))))
    if particle and not nuclear and not instrument and not exceptional_journal(item):
        return 'pure-particle-outside-selected-journals'
    if published(item):
        return ''
    experimental = hits(title, EXPERIMENT)
    if nuclear or instrument or (experimental and not particle):
        return ''
    return 'requires-journal-publication'


def eligible_paper(item):
    return not exclusion_reason(item)

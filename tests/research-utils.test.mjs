import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { scientificText, nuclidesIn, searchText, translationCoverage, isChinese, isNimaPaper, translationForRecord } from '../site/research-utils.js';

test('核素：单字母、双字母、上标、连字符及合写', () => {
  assert.deepEqual(nuclidesIn('8B and B-8, ⁸B, 52,54Ca and $^{53,55}$Sc'), ['8B', '52Ca', '54Ca', '53Sc', '55Sc']);
  assert.deepEqual(nuclidesIn('52 MeV, 42 AI and 2026 Sep'), []);
  assert.match(searchText('B-8'), /8b/);
  assert.equal(scientificText('\\texorpdfstring{$\\alpha$}{}-decay'), 'α-decay');
});

test('翻译统计：空条目、原生中文、仅译标题、缺正文分开', () => {
  const records = [
    { id: 'a', title: 'Empty translation', abstract: 'Original body' },
    { id: 'b', title: '原生中文标题', summary: '原生中文的完整介绍' },
    { id: 'c', title: 'Title translated', abstract: 'Original body' },
    { id: 'd', title: 'Missing abstract' },
  ];
  const stats = translationCoverage(records, { a: {}, c: { title_zh: '已翻译标题' }, d: { title_zh: '缺少摘要的论文' } });
  assert.deepEqual(stats, { total: 3, complete: 1, native: 1, titleDone: 2, titleTotal: 3, bodyDone: 0, bodyTotal: 2, missingBody: 1, partial: 1 });
});

test('通知只有日期时不因没有汉字而显示正文待译', () => {
  const stats = translationCoverage([{ id: 'n', title: 'CEPC meeting', summary: '2026-09-11 — 2026-09-11' }], { n: { title_zh: 'CEPC 会议' } });
  assert.equal(stats.complete, 1);
  assert.equal(stats.bodyTotal, 0);
  assert.equal(stats.partial, 0);
});

test('复杂公式和核素命令不会把中文译文误判为英文', () => {
  const title = String.raw`研究 $^{9}_{\Omega/\Omega_{ccc}}{\mathrm{Be}}$ 核中 $\alpha\alpha\Omega/\Omega_{ccc}$ 团簇的三体共振`;
  assert.equal(isChinese(title), true);
  assert.equal(isChinese(String.raw`\nuclide[78]{Ni} 的低激发态`), true);
  assert.equal(isChinese(String.raw`Three-body resonances in $\alpha\alpha\Omega$ clusters`), false);
  assert.equal(isChinese(String.raw`$\alpha\alpha\Omega$`), false);
  const stats = translationCoverage([{ id: 'p', title: 'Three-body resonances', abstract: 'Full abstract' }],
    { p: { title_zh: title, abstract_zh: '这里是完整的中文摘要。' } });
  assert.equal(stats.complete, 1);
});

function appHarness() {
  let source = readFileSync(new URL('../site/app.js', import.meta.url), 'utf8');
  source = source.replace(/^import .*;\n/gm, '').replace(/initialize\(\);\s*$/, '');
  const storage = new Map();
  const context = vm.createContext({
    URL, scientificText, nuclidesIn, searchText, translationCoverage, isNimaPaper, translationForRecord, AbortController, console,
    window: { location: { href: 'https://example.org/' } },
    document: { querySelector: () => null },
    setTimeout: () => 1, clearTimeout: () => {},
    localStorage: { setItem: (k, v) => storage.set(k, v), getItem: k => storage.get(k) || null, removeItem: k => storage.delete(k) },
  });
  vm.runInContext(source, context);
  context.featuredConfig = JSON.parse(readFileSync(new URL('../config/featured-journals.json', import.meta.url), 'utf8'));
  vm.runInContext('state.meta = {featured_journals: featuredConfig}', context);
  return { context, storage, run: code => vm.runInContext(code, context) };
}

test('首页论文卡片按日期跳转并清除旧筛选，期刊和预印本数量口径一致', async () => {
  const h = appHarness();
  const elements = new Map();
  h.context.document.querySelector = selector => {
    if (!elements.has(selector)) elements.set(selector, {value: '', textContent: '', scrollIntoView() {}});
    return elements.get(selector);
  };
  h.context.history = {replaceState() {}};
  h.run(`
    renderSourceOptions = () => {};
    setView = view => { state.view = view; };
    state.meta.insights = {latest_day: '2026-11-10'};
    state.category = 'fusion'; state.categorySelections.papers = 'fusion';
    state.source = 'old source'; state.query = 'unrelated'; state.globalKeyword = 'old keyword';
  `);
  await h.run(`openPaperMetric('journal')`);
  assert.equal(h.run('state.view'), 'papers');
  assert.equal(h.run('state.scope'), 'custom');
  assert.equal(h.run('state.dateFrom'), '2026-11-10');
  assert.equal(h.run('state.dateTo'), '2026-11-10');
  assert.equal(h.run('state.categorySelections.papers'), 'all');
  assert.equal(h.run('state.source'), 'all');
  assert.equal(h.run('state.query'), '');
  assert.equal(h.run('state.globalKeyword'), '');
  assert.equal(h.run(`matchesPaperMetric({source_type:'journal',categories:['nuclear-structure']},'journal')`), true);
  assert.equal(h.run(`matchesPaperMetric({source_type:'journal',categories:['frontiers']},'journal')`), false);
  assert.equal(h.run(`matchesPaperMetric({source_type:'preprint',categories:['nuclear-structure']},'journal')`), false);
  h.run(`beijingToday = () => '2026-11-11'`);
  await h.run(`openPaperMetric('today')`);
  assert.equal(h.run('state.dateFrom'), '2026-11-11');
  assert.equal(h.run('state.paperMetric'), '');
});

test('全部论文跳转合并日常与历史且分月加载，不把全部论文当作检索词', async () => {
  const h = appHarness();
  h.context.document.querySelector = () => ({value: ''});
  h.run(`renderCategories = renderGlobalKeywordPanel = renderCards = renderSourceOptions = () => {};
    state.papers = [{id:'daily', published:'2026-11-10'}, {id:'undated'}];
    state.historyManifest = {years:[{year:2001},{year:2026}]};`);
  h.context.fetch = async url => ({ok:true, json:async () => {
    if (url.includes('/search/2026')) return {items:[{id:'daily',month:'2026-11',search_text:'nuclear structure'}]};
    if (url.includes('/search/2001')) return {items:[{id:'old',month:'2001-01',search_text:'nuclear reactions'}]};
    if (url.includes('/papers/2026')) return [{id:'daily',published:'2026-11-10'}];
    return [{id:'old',published:'2001-01-01'}];
  }});
  await h.run(`searchAllHistory('', {browseAll:true})`);
  assert.equal(h.run('state.historyTotalMatches'), 3);
  assert.equal(h.run('state.historyBrowseAll'), true);
  assert.deepEqual([...h.run('state.historyResults.map(item => item.id)')].sort(), ['daily','old','undated']);
});

test('右侧识别 52/54Ca、53/55Sc 以及 B(E2)', () => {
  const h = appHarness();
  const facts = h.run(`extractPaperFacts({ title: 'B(E2) shell evolution', abstract: 'We investigate $^{52,54}$Ca and $^{53,55}$Sc.', tags: [] })`);
  assert.deepEqual([...facts.nuclides], ['52Ca', '54Ca', '53Sc', '55Sc']);
  assert.ok(facts.observables.includes('B(E2) 跃迁强度'));
});

test('保存过程中追加笔记，不得清除未保存修改', async () => {
  const h = appHarness();
  let resolveFetch;
  h.context.fetch = () => new Promise(resolve => { resolveFetch = resolve; });
  h.run(`state.cloudSyncAvailable = true; state.cloudSyncToken = 'test-only'; state.googleTranslations = new Map(); markPersonalDirty(); persistPersonalDraft();`);
  const pending = h.run('savePersonalToCloud()');
  h.run(`state.personal.notes.a = '保存过程中新增'; markPersonalDirty(); persistPersonalDraft();`);
  resolveFetch({ ok: true, status: 200, json: async () => ({ state: { updated_at: '2026-09-05T01:00:00Z' } }) });
  assert.equal(await pending, true);
  assert.equal(h.run('state.personalDirty'), true);
  assert.equal(h.run('state.personal.notes.a'), '保存过程中新增');
  assert.equal(h.storage.size, 1);
});

test('正常成功清副本；失败保留副本和错误', async () => {
  const h = appHarness();
  h.run(`state.cloudSyncAvailable = true; state.cloudSyncToken = 'test-only'; state.googleTranslations = new Map(); markPersonalDirty(); persistPersonalDraft();`);
  h.context.fetch = async () => ({ ok: false, status: 409, json: async () => ({ error: '冲突' }) });
  assert.equal(await h.run('savePersonalToCloud()'), false);
  assert.equal(h.storage.size, 1);
  assert.match(h.run('state.cloudSyncError'), /冲突/);
  h.context.fetch = async () => ({ ok: true, status: 200, json: async () => ({ state: { updated_at: '2026-09-05' } }) });
  assert.equal(await h.run('savePersonalToCloud()'), true);
  assert.equal(h.run('state.personalDirty'), false);
  assert.equal(h.storage.size, 0);
});

test('远端时间较新，不得丢掉本机尚未提交的收藏', () => {
  const h = appHarness();
  h.run(`state.googleTranslations = new Map(); state.personal.favorites.local = { id: 'local', title: '尚未上传的论文' }; persistPersonalDraft('2026-09-01T00:00:00Z');`);
  h.run(`applyPublicPersonalState({ updated_at: '2026-09-05T00:00:00Z', personal: { favorites: { remote: { id: 'remote', title: '另一台电脑收藏' } } } });`);
  assert.equal(h.run('Object.keys(state.personal.favorites).length'), 2);
  assert.equal(h.run('state.personalDirty'), true);
  assert.equal(h.storage.size, 1);
});

test('NIMA 兼容期刊全称、缩写与新旧 DOI，但不误收 NIM B', () => {
  for (const item of [
    { source_short: 'NIMA' }, { source: 'NIM-A' }, { source_short: 'NIM A' },
    { source: 'Nuclear Instruments and Methods in Physics Research A' },
    { source: 'Nuclear Instruments and Methods in Physics Research Section A: Accelerators, Spectrometers, Detectors and Associated Equipment' },
    { doi: '10.1016/j.nima.2026.123456' }, { doi: 'https://doi.org/10.1016/S0168-9002(11)02174-7' },
  ]) assert.equal(isNimaPaper(item), true);
  for (const item of [
    { source_short: 'NIMB', doi: '10.1016/j.nimb.2026.123456' },
    { source: 'Nuclear Instruments and Methods in Physics Research B' },
    { title: 'A NIMA paper mentioned here', source: 'Physical Review C' }, {},
  ]) assert.equal(isNimaPaper(item), false);
});

test('首页给 NIMA 四个优先位置，仍保留其他重点期刊且不会重复条目', () => {
  const h = appHarness();
  const values = [...Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, source_short: 'PRL' })),
    ...Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, source_short: 'NIMA' }))];
  h.context.fixtures = values;
  const result = h.run('prioritizeNima(fixtures)');
  assert.equal(result.length, 24);
  assert.equal(result.slice(0, 4).every(isNimaPaper), true);
  assert.equal(result.filter(isNimaPaper).length, 4);
  assert.equal(new Set(result.map(x => x.id)).size, 24);
  assert.equal(h.run('homeJournalLabel({source_short: "NIMA"})'), 'NIMA');
  assert.equal(h.run('homeJournalLabel({source_short: "NIMB"})'), '');
  assert.equal(h.run('prioritizeNima([], 24).length'), 0);
  assert.equal(h.run('prioritizeNima(fixtures, 2).length'), 2);
});

test('NIMA 筛选聚合同刊别名，尊重忽略，不混入其他期刊', () => {
  const h = appHarness();
  h.context.fixtures = [
    { id: 'a', source_short: 'NIMA', source: 'Name A', published: '2026-11-01' },
    { id: 'b', source_short: 'NIM-A', source: 'Name B', published: '2026-11-01' },
    { id: 'c', source_short: 'NIMB', source: 'Other', published: '2026-11-01' },
  ];
  h.run("state.papers = fixtures; state.scope = 'all'; state.source = NIMA_SOURCE; state.personal.ignoredItems = ['b'];");
  assert.deepEqual([...h.run('filteredItems().map(x => x.id)')], ['a']);
  h.run("state.featured = [fixtures[0], fixtures[2]];");
  assert.deepEqual([...h.run('featuredWithNima().map(x => x.id)')].sort(), ['a', 'b']);
  h.run("state.papers.push({id:'old', source_short:'NIMA',published:'2025-01-01'})");
  assert.equal(h.run('featuredWithNima().some(x => x.id === "old")'), true);
});

test('版本合并：旧 ID 收藏、关键词、笔记、阅读和忽略状态仍可读取，且不改写个人数据', () => {
  const h = appHarness();
  h.run(`state.papers = [{ id: 'journal', record_aliases: ['arxiv'], type: 'paper', title: 'Official', source_type: 'journal' }];
    state.personal.favorites = { arxiv: { id: 'arxiv', title: 'Preprint', keywords: ['核结构'] }, journal: { id: 'journal', title: 'Official', keywords: ['探测器'] } };
    state.personal.notes = { arxiv: '预印本笔记', journal: '正式版笔记' };
    state.personal.readStatus = { arxiv: 'read' };
    state.personal.ignoredItems = ['arxiv'];
    state.personal.translationFavorites = { arxiv: { id: 'arxiv' } };
    state.view = 'favorites'; state.mySection = 'papers';`);
  const before = h.run('JSON.stringify(state.personal)');
  assert.equal(h.run(`isFavorite('journal')`), true);
  assert.deepEqual([...h.run(`favoriteKeywords('journal')`)].sort(), ['探测器', '核结构']);
  assert.match(h.run(`noteText('journal')`), /预印本笔记[\s\S]*正式版笔记|正式版笔记[\s\S]*预印本笔记/);
  assert.equal(h.run(`readStatusFor('journal')`), 'read');
  assert.equal(h.run(`isIgnored('journal')`), true);
  assert.equal(h.run(`isTranslationFavorite('journal')`), true);
  assert.equal(h.run('currentItems().length'), 1);
  assert.equal(h.run('currentItems()[0].id'), 'journal');
  assert.equal(h.run('JSON.stringify(state.personal)'), before);
  h.run(`state.mySection = 'translations'`);
  assert.equal(h.run('currentItems().length'), 1, '新版本待译也不能隐藏原翻译收藏');
});

test('取消合并论文收藏和保存笔记会处理全部别名，保存失败恢复原笔记', async () => {
  const h = appHarness();
  h.run(`state.papers = [{ id: 'j', record_aliases: ['p'], title: 'Paper' }];
    state.personal.favorites = { p: { id: 'p', title: 'Paper', keywords: ['核结构'] } };
    state.publicFavorites = [{ id: 'p', title: 'Paper' }];
    state.personal.notes = { p: '旧笔记', j: '新笔记' };
    savePersonal = () => true; refreshPaperCardViews = () => {}; renderHomeHub = () => {}; showToast = () => {};`);
  await h.run(`toggleFavorite(state.papers[0], { classList: { toggle() {} }, setAttribute() {} })`);
  assert.equal(h.run(`isFavorite('j')`), false);
  h.run(`savePersonal = () => false; saveInlineNote(state.papers[0], '替换')`);
  assert.equal(h.run('state.personal.notes.p'), '旧笔记');
  assert.equal(h.run('state.personal.notes.j'), '新笔记');
  h.run(`savePersonal = () => true; saveInlineNote(state.papers[0], '整理后的笔记')`);
  assert.equal(h.run(`noteText('j')`), '整理后的笔记');
  assert.equal(h.run('state.personal.notes.p'), undefined);
});

test('译文仅在源文一致时复用，旧摘要不计为新版本已译', () => {
  const item = { id: 'j', record_aliases: ['p'], title: 'Title', abstract: 'Body', translation_source_hash: 'current', translation_legacy_hashes: { j: 'old' } };
  const old = { title_zh: '旧题目', abstract_zh: '旧摘要', source_hash: 'old' };
  assert.equal(translationForRecord(item, { j: old }), null);
  assert.equal(translationForRecord(item, { j: { title_zh: '旧译文' } }), null);
  assert.equal(translationCoverage([item], { j: old }).complete, 0);
  const matching = { title_zh: '当前题目', abstract_zh: '当前摘要', source_hash: 'current' };
  assert.equal(translationForRecord(item, { p: matching }), matching);
});

test('Cite 默认正式版，可选择预印本，输出不混用期刊 DOI', () => {
  const h = appHarness();
  h.run(`var article = { id: 'j', title: 'Published title', source: 'Physical Review C', source_type: 'journal', doi: '10.1234/a', published: '2026-05-01', authors: ['Alice Smith'],
    versions: [{ id: 'p', title: 'Preprint title', source_type: 'preprint', arxiv_id: '2601.00001', url: 'https://arxiv.org/abs/2601.00001', published: '2026-01-01', authors: ['Alice Smith'] }] };`);
  assert.equal(h.run('citationVersions(article).length'), 2);
  assert.match(h.run(`citationValue(citationVersions(article)[0].item, 'bibtex')`), /10.1234\/a/);
  const preprint = h.run(`citationValue(citationVersions(article)[1].item, 'bibtex')`);
  assert.match(preprint, /2601.00001/);
  assert.doesNotMatch(preprint, /10.1234\/a/);
  assert.match(h.run(`citationValue(citationVersions(article)[1].item, 'gbt7714-2025')`), /PP\/OL/);
});

test('重点期刊包含五组及系列刊，首页和重点选项排除其他刊与预印本', () => {
  const h = appHarness();
  for (const source of ['NIMA', 'Physical Review Letters', 'Nature', 'Nature Physics', 'Nature Astronomy', 'Nature Materials', 'Nature Computational Science', 'Communications Physics', 'npj Quantum Information', 'Science', 'Science Advances', 'Science Robotics', 'SB', 'Science Bulletin', 'Chinese Science Bulletin (Chinese Version)', '科学通报']) {
    h.context.sample = { source, source_type: 'journal' };
    assert.ok(h.run('homeJournalLabel(sample)'), source);
  }
  for (const source of ['NIMB', 'Physical Review C', 'National Science Review', 'Science China Physics, Mechanics & Astronomy', 'arXiv nucl-ex']) {
    h.context.sample = { source, source_type: 'journal' };
    assert.equal(h.run('homeJournalLabel(sample)'), '', source);
  }
  h.context.samples = [{ id: 'sb', source: 'Science Bulletin' }, { id: 'nature', source: 'Nature Astronomy' }, { id: 'science', source: 'Science Advances' }, { id: 'prc', source: 'Physical Review C' }, { id: 'pre', source_short: 'PRL', source_type: 'preprint' }];
  h.run('state.papers = samples; state.view = "featured"');
  assert.deepEqual([...h.run('currentItems().map(x => x.id)')].sort(), ['nature', 'sb', 'science']);
});

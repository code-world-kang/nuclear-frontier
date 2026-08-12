const PATH = new URL('.', window.location.href).pathname;

const DEFAULT_CATEGORY_ORDER = [
  'experimental-nuclear', 'nuclear-structure', 'nuclear-reactions', 'nuclear-decay', 'detectors-daq',
  'theoretical-nuclear', 'nuclear-astrophysics', 'high-energy-nuclear', 'accelerators', 'fusion',
  'ai-science', 'nuclear-general', 'nuclear-data-applications', 'particle-cross', 'frontiers',
];
const DEFAULT_FILTER_MODULE_ORDER = ['categories', 'keywords'];

const state = {
  papers: [], featured: [], news: [], notices: [], publicFavorites: [], translations: {}, referenceResources: [], noticePortals: { categories: [], entries: [] },
  meta: null, view: 'papers', category: 'all', source: 'all', query: '', searchField: 'all', sort: 'date', scope: 'daily-focus', visible: 20,
  dateFrom: '', dateTo: '', favoriteKeyword: 'all', favoriteDraft: null, inlineNoteId: '', inlineCitationId: '', citationDraft: null, mySection: 'papers', referenceGroup: 'all', translatedIds: new Set(),
  selectedPaperId: '',
  selectedNoticeId: '', expandedNoticeIds: new Set(),
  cloudUpdatedAt: '',
  personalDirty: false,
  noticeCategory: 'all', noticeTiming: 'all', noticeQuery: '', noticeVisible: 24,
  noticePortalCategory: 'all', noticePortalQuery: '', personal: loadPersonal(), paperLayout: loadPaperLayout(),
  layoutEditing: false, draggedCategory: '', categoryMap: new Map(),
  categorySelections: { papers: 'all', news: 'all' },
  historyManifest: null, globalKeyword: '', historyResults: [], historyMatchEntries: [],
  historyMonthQueue: [], historyLoadedMonths: new Set(), historySearching: false,
  historyProgress: '', historyRequestToken: 0, historyTotalMatches: 0,
  zoteroStatusById: new Map(),
  zoteroDraft: null,
};
const citationMetadataRequests = new Map();
const PRIMARY_NUCLEAR_CATEGORIES = new Set([
  'experimental-nuclear', 'theoretical-nuclear', 'nuclear-structure', 'nuclear-decay', 'nuclear-reactions',
  'detectors-daq', 'nuclear-general', 'high-energy-nuclear', 'nuclear-astrophysics',
]);

const CORE_CATEGORIES = new Set([
  ...PRIMARY_NUCLEAR_CATEGORIES, 'high-energy-nuclear', 'nuclear-astrophysics', 'accelerators',
  'fusion', 'nuclear-data-applications',
]);

const HOME_FEATURED_JOURNALS = new Map([
  ['physical review letters', 'PRL'],
  ['prl', 'PRL'],
  ['nature', 'Nature'],
  ['science', 'Science'],
  ['nature physics', 'Nature Physics'],
  ['nature communications', 'Nature Communications'],
]);

const NUCLEAR_PRIORITY = new Map([
  ['experimental-nuclear', 12], ['nuclear-structure', 12], ['nuclear-decay', 12],
  ['theoretical-nuclear', 11], ['nuclear-reactions', 10], ['detectors-daq', 10],
  ['nuclear-general', 9], ['accelerators', 5], ['nuclear-data-applications', 5], ['high-energy-nuclear', 4],
  ['nuclear-astrophysics', 4], ['fusion', 3], ['particle-cross', 1], ['ai-science', 0],
]);

const NOTICE_GROUPS = [
  { id: 'all', label: '全部通知', icon: '◎', description: '会议、基金和束流申请' },
  { id: 'meeting', label: '会议通知', icon: '🌼', description: '核物理会议、学校与学术年会' },
  { id: 'funding', label: '科研基金', icon: '🌱', description: '国家、地方、国际与人才项目' },
  { id: 'beam', label: '束流申请', icon: '⚛', description: '国内外束流和大科学装置' },
];

const REFERENCE_GROUPS = [
  { id: 'all', label: '全部资料', icon: '◎', description: '查看所有收录网站' },
  { id: 'official', label: '官方网站', icon: '◉', description: '学校、机构与项目官网' },
  { id: 'collaborations', label: '合作组', icon: '⚛', description: '实验合作组、课题组与内部入口' },
  { id: 'chatgpt', label: 'ChatGPT', icon: '✦', description: 'ChatGPT 与 OpenAI 官方开发资料' },
  { id: 'data-analysis', label: '数据分析', icon: '⌑', description: 'ROOT、Geant4、Jupyter 等分析工具' },
  { id: 'github-following', label: 'GitHub 跟随', icon: '⌘', description: '个人、合作者与关注的 GitHub 项目' },
  { id: 'journals-data', label: '期刊与数据库', icon: '▤', description: '期刊、预印本、核数据与学术检索' },
  { id: 'software', label: '科研软件', icon: '◇', description: '编程、写作、网络与效率工具' },
  { id: 'other', label: '其他', icon: '·', description: '其他已收录的常用网站' },
];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function emptyPersonal() {
  return { favorites: {}, keywords: [], readStatus: {}, notes: {}, translationFavorites: {}, translationGlossary: [], codeItems: [], resources: [], hiddenPublicFavorites: [], ignoredItems: [] };
}

function loadPersonal() {
  return emptyPersonal();
}

function loadPaperLayout() {
  return { categoryOrder: [...DEFAULT_CATEGORY_ORDER], hiddenCategories: [], moduleOrder: [...DEFAULT_FILTER_MODULE_ORDER] };
}

function savePaperLayout() {
  markPersonalDirty();
}

function savePersonal() {
  markPersonalDirty();
  return true;
}

function normalizeKeyword(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

function normalizeTranslationGlossary(values = []) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  return values.map((entry, index) => ({
    id: String(entry?.id || `term-${index}-${Date.now()}`),
    source: normalizeKeyword(entry?.source || ''),
    target: normalizeKeyword(entry?.target || ''),
    added_at: entry?.added_at || '',
  })).filter(entry => {
    const key = entry.source.toLocaleLowerCase('zh-CN');
    if (!key || !entry.target || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizePublicPersonalState(payload = {}) {
  const personal = payload.personal && typeof payload.personal === 'object' ? payload.personal : {};
  const normalized = emptyPersonal();
  ['favorites', 'readStatus', 'notes', 'translationFavorites'].forEach(key => {
    normalized[key] = personal[key] && typeof personal[key] === 'object' && !Array.isArray(personal[key]) ? personal[key] : {};
  });
  normalized.keywords = Array.isArray(personal.keywords) ? uniqueKeywords(personal.keywords) : [];
  normalized.translationGlossary = normalizeTranslationGlossary(personal.translationGlossary);
  normalized.codeItems = Array.isArray(personal.codeItems) ? personal.codeItems : [];
  normalized.resources = Array.isArray(personal.resources) ? personal.resources : [];
  normalized.hiddenPublicFavorites = Array.isArray(personal.hiddenPublicFavorites) ? personal.hiddenPublicFavorites.map(String) : [];
  normalized.ignoredItems = Array.isArray(personal.ignoredItems) ? personal.ignoredItems.map(String) : [];
  const layout = payload.paperLayout && typeof payload.paperLayout === 'object' ? payload.paperLayout : {};
  const paperLayout = {
    categoryOrder: Array.isArray(layout.categoryOrder) && layout.categoryOrder.length ? layout.categoryOrder.map(String) : [...DEFAULT_CATEGORY_ORDER],
    hiddenCategories: Array.isArray(layout.hiddenCategories) ? layout.hiddenCategories.map(String) : [],
    moduleOrder: Array.isArray(layout.moduleOrder) && layout.moduleOrder.length ? layout.moduleOrder.map(String) : [...DEFAULT_FILTER_MODULE_ORDER],
  };
  const googleTranslations = payload.googleTranslations && typeof payload.googleTranslations === 'object' ? payload.googleTranslations : {};
  return { personal: normalized, paperLayout, googleTranslations, updatedAt: String(payload.updated_at || '') };
}

function applyPublicPersonalState(payload = {}) {
  const normalized = normalizePublicPersonalState(payload);
  state.personal = normalized.personal;
  state.paperLayout = normalized.paperLayout;
  state.googleTranslations = new Map(Object.entries(normalized.googleTranslations));
  state.cloudUpdatedAt = normalized.updatedAt;
}

function publicPersonalPayload() {
  return {
    version: 1,
    updated_at: new Date().toISOString(),
    personal: state.personal,
    paperLayout: state.paperLayout,
    googleTranslations: Object.fromEntries(state.googleTranslations),
  };
}

function updateCloudSyncUI(message = '') {
  const bar = $('#cloudSyncBar');
  const button = $('#submitGitHubSync');
  if (!bar || !button) return;
  bar.classList.toggle('connected', !state.personalDirty);
  button.disabled = !state.personalDirty;
  button.textContent = state.personalDirty ? '提交到 GitHub' : '已同步';
  const publicTime = state.cloudUpdatedAt ? `公开快照：${prettyDate(state.cloudUpdatedAt)}` : '尚无公开个人数据';
  $('#cloudSyncStatus').textContent = message || (state.personalDirty
    ? '本页有待提交修改；点击右侧按钮后，在 GitHub 确认创建 Issue。'
    : `已从 GitHub 读取 · ${publicTime}`);
}

function markPersonalDirty() {
  state.personalDirty = true;
  updateCloudSyncUI();
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

async function encodeGitHubSnapshot(value) {
  const bytes = new TextEncoder().encode(value);
  if (!('CompressionStream' in window)) return { encoding: 'base64', data: bytesToBase64(bytes) };
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  return { encoding: 'gzip-base64', data: bytesToBase64(compressed) };
}

async function submitGitHubSync() {
  if (!state.personalDirty) return;
  const popup = window.open('', 'nuclear-frontier-github-sync');
  if (!popup) return showToast('浏览器拦截了 GitHub 提交页，请允许弹出窗口');
  popup.document.title = '正在准备 GitHub 同步';
  popup.document.body.textContent = '正在压缩公开个人数据…';
  const repositoryUrl = state.meta?.site?.repository_url || 'https://github.com/code-world-kang/nuclear-frontier';
  const payload = JSON.stringify(publicPersonalPayload(), null, 2);
  let encoded;
  try {
    encoded = await encodeGitHubSnapshot(payload);
  } catch (error) {
    popup.close();
    console.error(error);
    return showToast('同步数据准备失败，请稍后重试');
  }
  const body = [
    '<!-- nuclear-frontier-personal-state:v1 -->',
    `<!-- nuclear-frontier-encoding:${encoded.encoding} -->`,
    '这是网站生成的个人科研数据公开同步请求。',
    '',
    '> 请保留下方压缩数据不变，直接点击“Submit new issue”。GitHub Actions 将验证账号、写入仓库并自动关闭此 Issue。',
    '',
    '```text',
    encoded.data,
    '```',
  ].join('\n');
  const issueUrl = new URL(`${repositoryUrl.replace(/\/$/, '')}/issues/new`);
  issueUrl.search = new URLSearchParams({
    title: `[个人数据同步] ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    body,
  });
  if (encoded.data.length > 60_000 || issueUrl.href.length > 100_000) {
    popup.close();
    updateCloudSyncUI('个人数据过多，暂时无法通过 Issue 提交。');
    return showToast('数据超出 GitHub Issue 预填长度，请先删减过长笔记');
  }
  popup.opener = null;
  popup.location.replace(issueUrl.href);
  updateCloudSyncUI('已打开 GitHub：请确认创建 Issue，约 1–2 分钟后刷新本站。');
  showToast('请在 GitHub 页面确认提交');
}

function keywordKey(value = '') {
  return normalizeKeyword(value).toLocaleLowerCase('zh-CN');
}

function uniqueKeywords(values = []) {
  const seen = new Set();
  return values.map(normalizeKeyword).filter(value => {
    const key = keywordKey(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function corePriority(item) {
  return Math.max(0, ...(item.categories || []).map(category => NUCLEAR_PRIORITY.get(category) || 0));
}

function compareNuclearFirst(a, b) {
  return corePriority(b) - corePriority(a)
    || (b.importance || 0) - (a.importance || 0)
    || (b.published || '').localeCompare(a.published || '');
}

function text(value = '') {
  const node = document.createElement('span');
  node.textContent = String(value);
  return node.innerHTML;
}

function prettyDate(value) {
  if (!value) return '日期待核验';
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}

function beijingDay(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function noticeCategoryInfo(id) {
  return state.noticePortals.categories.find(category => category.id === id)
    || { id: id || 'other', label: '其他通知', icon: '🌿' };
}

function noticePublishedDay(item) {
  return (item.published || '').slice(0, 10);
}

function noticeFirstSeenDay(item) {
  return beijingDay(item.first_seen || '') || (item.first_seen || '').slice(0, 10);
}

function deadlineState(item) {
  const deadline = (item.deadline || '').slice(0, 10);
  if (!deadline) return { kind: 'unknown', days: null };
  const today = beijingDay();
  const delta = Math.round((new Date(`${deadline}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000);
  return { kind: delta < 0 ? 'closed' : (delta <= 14 ? 'soon' : 'open'), days: delta };
}

function relativeUpdate(value) {
  if (!value) return '尚未完成首次更新';
  const date = new Date(value);
  return `数据更新于 ${new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date)}`;
}

function truncate(value, length = 260) {
  if (!value) return '';
  return value.length > length ? `${value.slice(0, length).trim()}…` : value;
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2200);
}

function currentItems() {
  if (state.view === 'featured') return state.featured;
  if (state.view === 'news') return state.news;
  if (state.view === 'notices') return state.notices;
  if (state.view === 'ignored') {
    const ignored = new Set(state.personal.ignoredItems);
    return state.papers.filter(item => ignored.has(item.id));
  }
  if (state.view === 'favorites') {
    if (state.mySection === 'translations') {
      const ids = new Set(Object.keys(state.personal.translationFavorites));
      return state.papers.filter(item => ids.has(item.id) && Boolean(translationFor(item)));
    }
    const hidden = new Set(state.personal.hiddenPublicFavorites);
    const ids = new Set([
      ...Object.keys(state.personal.favorites),
      ...state.publicFavorites.map(item => typeof item === 'string' ? item : item.id).filter(id => !hidden.has(id)),
    ]);
    return [...state.papers, ...state.news, ...state.notices].filter(item => ids.has(item.id));
  }
  if (state.view === 'unread') return state.papers.filter(item => state.personal.readStatus[item.id] !== 'read');
  if (state.view === 'papers' && state.globalKeyword) return state.historyResults;
  return state.papers;
}

function allKnownPapers() {
  const values = new Map();
  [...state.papers, ...state.historyResults].forEach(item => values.set(item.id, item));
  return [...values.values()];
}

function isPrimaryNuclear(item) {
  return (item.categories || []).some(category => PRIMARY_NUCLEAR_CATEGORIES.has(category));
}

function publicFavoriteRecord(id) {
  if (state.personal.hiddenPublicFavorites.includes(id)) return null;
  return state.publicFavorites.find(item => typeof item === 'object' && item.id === id) || null;
}

function hasPublicFavorite(id) {
  return state.publicFavorites.some(item => (typeof item === 'string' ? item : item.id) === id);
}

function favoriteRecord(id) {
  const local = state.personal.favorites[id];
  if (local && typeof local === 'object') return local;
  return publicFavoriteRecord(id);
}

function favoriteKeywords(id) {
  const record = favoriteRecord(id);
  if (!record) return [];
  return uniqueKeywords(record.keywords || []);
}

function personalMatch(item) {
  if (!state.personal.keywords.length) return false;
  const haystack = [item.title, item.abstract, item.summary, item.source, ...(item.tags || []), ...(item.authors || [])].join(' ').toLowerCase();
  return state.personal.keywords.some(keyword => haystack.includes(keyword.toLowerCase()));
}

function paperDay(item) {
  return (item.published || '').slice(0, 10);
}

function latestPaperDay() {
  return state.papers.reduce((latest, item) => paperDay(item) > latest ? paperDay(item) : latest, '');
}

function paperDateBounds() {
  const days = state.papers.map(paperDay).filter(Boolean).sort();
  return { earliest: days[0] || '', latest: days.at(-1) || '' };
}

function configureDateRangeInputs() {
  const { earliest, latest } = paperDateBounds();
  ['dateFrom', 'dateTo'].forEach(id => {
    const input = $(`#${id}`);
    input.min = earliest;
    input.max = latest;
  });
  $('#dateRangeHint').textContent = earliest && latest
    ? `当前可选：${prettyDate(earliest)} 至 ${prettyDate(latest)}`
    : '暂无可选日期';
}

function ensureCustomDateRange() {
  const { earliest, latest } = paperDateBounds();
  if (!latest) return;
  if (!state.dateTo) state.dateTo = latest;
  if (!state.dateFrom) {
    const lower = new Date(`${latest}T00:00:00Z`);
    lower.setUTCDate(lower.getUTCDate() - 29);
    state.dateFrom = [earliest, lower.toISOString().slice(0, 10)].filter(Boolean).sort().at(-1);
  }
  $('#dateFrom').value = state.dateFrom;
  $('#dateTo').value = state.dateTo;
}

function updateCustomDateRange(changedId) {
  let from = $('#dateFrom').value;
  let to = $('#dateTo').value;
  if (from && to && from > to) {
    if (changedId === 'dateFrom') to = from;
    else from = to;
  }
  state.dateFrom = from;
  state.dateTo = to;
  $('#dateFrom').value = from;
  $('#dateTo').value = to;
  state.visible = 20;
  renderCards();
}

function dailyFocusIds() {
  const latest = latestPaperDay();
  const today = state.papers.filter(item => paperDay(item) === latest);
  return new Set(today
    .filter(isPrimaryNuclear)
    .map(item => item.id));
}

function inPaperScope(item, focusIds, latest) {
  if (state.view !== 'papers' || state.scope === 'all') return true;
  if (state.scope === 'daily-focus') return focusIds.has(item.id);
  if (state.scope === 'today') return paperDay(item) === latest;
  if (state.scope === '7days') {
    const lower = new Date(`${latest}T00:00:00Z`);
    lower.setUTCDate(lower.getUTCDate() - 6);
    return paperDay(item) >= lower.toISOString().slice(0, 10);
  }
  if (state.scope === 'custom') {
    const day = paperDay(item);
    return Boolean(day)
      && (!state.dateFrom || day >= state.dateFrom)
      && (!state.dateTo || day <= state.dateTo);
  }
  return true;
}

function filteredItems() {
  const query = state.query.trim().toLowerCase();
  const latest = latestPaperDay();
  const focusIds = state.scope === 'daily-focus' ? dailyFocusIds() : new Set();
  const ignored = new Set(state.personal.ignoredItems);
  const values = currentItems().filter(item => {
    if (state.view !== 'ignored' && ignored.has(item.id)) return false;
    if (!inPaperScope(item, focusIds, latest)) return false;
    if (state.category !== 'all' && !(item.categories || []).includes(state.category)) return false;
    if (!['news', 'notices'].includes(state.view) && state.source !== 'all' && item.source !== state.source) return false;
    if (state.view === 'favorites' && state.mySection === 'papers' && state.favoriteKeyword !== 'all') {
      const keywords = favoriteKeywords(item.id);
      if (state.favoriteKeyword === 'missing' && keywords.length) return false;
      if (state.favoriteKeyword.startsWith('kw:') && !keywords.some(value => keywordKey(value) === state.favoriteKeyword.slice(3))) return false;
    }
    if (!query) return true;
    const translated = translationFor(item);
    const customTerms = translationGlossaryMatches(item).flatMap(rule => [rule.source, rule.target]);
    const fields = {
      title: [item.title, translated?.title_zh],
      abstract: [item.abstract, item.summary, translated?.abstract_zh],
      author: item.authors || [],
      identifier: [item.doi, item.arxiv_id],
      all: [
        item.title, item.abstract, item.summary, translated?.title_zh, translated?.abstract_zh, item.source, item.source_short,
        item.doi, item.arxiv_id, ...(item.authors || []), ...(item.tags || []),
        ...favoriteKeywords(item.id),
        ...customTerms,
        ...(item.categories || []).map(id => state.categoryMap.get(id)?.name || id),
      ],
    };
    const haystack = (fields[state.searchField] || fields.all).join(' ').toLowerCase();
    return query.split(/\s+/).every(term => haystack.includes(term));
  });

  values.sort((a, b) => {
    const personalDelta = Number(personalMatch(b)) - Number(personalMatch(a));
    if (personalDelta) return personalDelta;
    if (state.sort === 'importance') return compareNuclearFirst(a, b);
    if (state.sort === 'source') return (a.source || '').localeCompare(b.source || '') || (b.published || '').localeCompare(a.published || '');
    return (b.published || '').localeCompare(a.published || '') || (b.importance || 0) - (a.importance || 0);
  });
  return values;
}

function historyCoverageLabel() {
  const manifest = state.historyManifest;
  if (!manifest) return '历史索引信息载入中';
  const start = manifest.start_month || '2001-01';
  const through = manifest.backfill_complete_through;
  const coverage = through ? `${start} 至 ${through} 已连续完成` : `正在从 ${start} 开始回填`;
  return `${coverage} · 已索引 ${Number(manifest.indexed_papers || 0).toLocaleString('zh-CN')} 篇 / ${Number(manifest.indexed_months || 0)} 个月`;
}

function clearGlobalKeywordSearch({ render = true } = {}) {
  state.historyRequestToken += 1;
  state.globalKeyword = '';
  state.historyResults = [];
  state.historyMatchEntries = [];
  state.historyMonthQueue = [];
  state.historyLoadedMonths = new Set();
  state.historySearching = false;
  state.historyProgress = '';
  state.historyTotalMatches = 0;
  state.visible = 20;
  if (render) {
    renderGlobalKeywordPanel();
    renderSourceOptions();
    renderCards();
  }
}

function historyMonthEnd(month) {
  const [year, value] = month.split('-').map(Number);
  return new Date(Date.UTC(year, value, 0)).toISOString().slice(0, 10);
}

async function loadHistoryMonths(months, token) {
  const wantedByMonth = new Map();
  state.historyMatchEntries.forEach(item => {
    if (!months.includes(item.month)) return;
    const values = wantedByMonth.get(item.month) || new Set();
    values.add(item.id);
    wantedByMonth.set(item.month, values);
  });
  const loaded = [];
  for (let index = 0; index < months.length; index += 3) {
    if (token !== state.historyRequestToken) return;
    const batch = months.slice(index, index + 3);
    const results = await Promise.all(batch.map(async month => {
      const [year, number] = month.split('-');
      const response = await fetch(`./data/history/papers/${year}/${number}.json`);
      if (!response.ok) throw new Error(`${month} 论文分片 HTTP ${response.status}`);
      const values = await response.json();
      const wanted = wantedByMonth.get(month) || new Set();
      return values.filter(item => wanted.has(item.id));
    }));
    results.forEach(values => loaded.push(...values));
    state.historyProgress = `正在载入论文详情 ${Math.min(index + 3, months.length)} / ${months.length} 个月…`;
    renderGlobalKeywordPanel();
  }
  if (token !== state.historyRequestToken) return;
  const merged = new Map(state.historyResults.map(item => [item.id, item]));
  loaded.forEach(item => merged.set(item.id, item));
  state.historyResults = [...merged.values()].sort((a, b) => (b.published || '').localeCompare(a.published || '') || (b.importance || 0) - (a.importance || 0));
  months.forEach(month => state.historyLoadedMonths.add(month));
  state.historyMonthQueue = state.historyMonthQueue.filter(month => !state.historyLoadedMonths.has(month));
}

async function loadNextHistoryBatch() {
  if (!state.globalKeyword || state.historySearching || !state.historyMonthQueue.length) return;
  const token = state.historyRequestToken;
  state.historySearching = true;
  const months = state.historyMonthQueue.slice(0, 6);
  try {
    await loadHistoryMonths(months, token);
    if (token !== state.historyRequestToken) return;
    state.visible = Math.max(state.visible, state.historyResults.length);
    state.historyProgress = state.historyMonthQueue.length
      ? `已载入 ${state.historyLoadedMonths.size} 个月，继续向下可载入更早结果`
      : '全部命中月份已载入';
  } catch (error) {
    console.error(error);
    state.historyProgress = `部分历史详情载入失败：${error.message}`;
  } finally {
    if (token === state.historyRequestToken) {
      state.historySearching = false;
      renderCategories();
      renderSourceOptions();
      renderGlobalKeywordPanel();
      renderCards();
    }
  }
}

async function searchAllHistory(keyword) {
  const normalized = normalizeKeyword(keyword);
  if (!normalized) return clearGlobalKeywordSearch();
  const token = state.historyRequestToken + 1;
  state.historyRequestToken = token;
  state.globalKeyword = normalized;
  state.historyResults = [];
  state.historyMatchEntries = [];
  state.historyMonthQueue = [];
  state.historyLoadedMonths = new Set();
  state.historyTotalMatches = 0;
  state.historySearching = true;
  state.historyProgress = '正在准备全库索引…';
  state.scope = 'all';
  state.category = 'all';
  state.source = 'all';
  state.query = '';
  state.visible = 20;
  $('#scopeSelect').value = 'all';
  $('#sourceSelect').value = 'all';
  $('#searchInput').value = '';
  renderCategories();
  renderGlobalKeywordPanel();
  renderCards();
  const terms = normalized.toLocaleLowerCase('zh-CN').split(/\s+/).filter(Boolean);
  const years = [...(state.historyManifest?.years || [])].sort((a, b) => b.year - a.year);
  const matched = new Map();
  try {
    for (let index = 0; index < years.length; index += 1) {
      if (token !== state.historyRequestToken) return;
      const year = years[index].year;
      state.historyProgress = `正在检索 ${year} 年 · ${index + 1} / ${years.length}`;
      renderGlobalKeywordPanel();
      const response = await fetch(`./data/history/search/${year}.json`);
      if (!response.ok) throw new Error(`${year} 年索引 HTTP ${response.status}`);
      const payload = await response.json();
      (payload.items || []).forEach(item => {
        const haystack = String(item.search_text || '');
        if (terms.every(term => haystack.includes(term))) matched.set(item.id, item);
      });
      // 每次只保留命中项；完整年度索引会在下一轮被浏览器回收。
    }
    if (token !== state.historyRequestToken) return;
    state.historyMatchEntries = [...matched.values()];
    state.historyTotalMatches = state.historyMatchEntries.length;
    state.historyMonthQueue = [...new Set(state.historyMatchEntries.map(item => item.month))].sort().reverse();
    state.historyProgress = state.historyTotalMatches ? '索引检索完成，正在载入最新命中月份…' : '全库暂未找到匹配论文';
    if (state.historyMonthQueue.length) await loadHistoryMonths(state.historyMonthQueue.slice(0, 6), token);
    if (token !== state.historyRequestToken) return;
    state.historyProgress = state.historyMonthQueue.length
      ? `已载入最新 ${state.historyLoadedMonths.size} 个月；点击“继续载入”查看更早结果`
      : (state.historyTotalMatches ? '全部命中月份已载入' : '可更换关键词后重试');
  } catch (error) {
    console.error(error);
    state.historyProgress = `全库检索失败：${error.message}`;
  } finally {
    if (token === state.historyRequestToken) {
      state.historySearching = false;
      renderCategories();
      renderSourceOptions();
      renderGlobalKeywordPanel();
      renderCards();
    }
  }
}

function historyMonthStats() {
  const counts = new Map();
  state.historyMatchEntries.forEach(item => counts.set(item.month, (counts.get(item.month) || 0) + 1));
  return [...counts.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

function renderGlobalKeywordPanel() {
  const panel = $('#historyKeywordPanel');
  if (!panel) return;
  panel.hidden = state.view !== 'papers';
  if (panel.hidden) return;
  $('#historyCoverage').textContent = historyCoverageLabel();
  const values = uniqueKeywords(state.personal.keywords);
  const chipHost = $('#historyKeywordChips');
  chipHost.replaceChildren(...values.map(keyword => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'history-keyword-chip';
    button.classList.toggle('active', keywordKey(keyword) === keywordKey(state.globalKeyword));
    button.textContent = keyword;
    button.addEventListener('click', () => void searchAllHistory(keyword));
    return button;
  }));
  if (!values.length) {
    const hint = document.createElement('small');
    hint.textContent = '先添加个人关键词，或在右侧输入任意关键词。';
    chipHost.append(hint);
  }
  $('#historyKeywordInput').value = state.globalKeyword;
  $('#clearHistoryKeyword').hidden = !state.globalKeyword;
  $('#historySearchStatus').textContent = state.globalKeyword
    ? `“${state.globalKeyword}”全库命中 ${state.historyTotalMatches.toLocaleString('zh-CN')} 篇；网页仅按月分批载入详情，不一次占满内存。${state.historyProgress ? ` ${state.historyProgress}` : ''}`
    : '选择关键词后，会逐年检索轻量索引，并按月分批载入论文详情。';
  const stats = historyMonthStats();
  const max = Math.max(1, ...stats.map(([, count]) => count));
  $('#historyMonthStats').innerHTML = stats.length ? stats.map(([month, count]) => `
    <button type="button" data-history-month="${text(month)}" class="${state.historyLoadedMonths.has(month) ? 'loaded' : ''}">
      <span>${text(month)}</span><i><em style="width:${Math.max(6, count / max * 100).toFixed(1)}%"></em></i><b>${count}</b>
    </button>`).join('') : '';
  $$('[data-history-month]', $('#historyMonthStats')).forEach(button => button.addEventListener('click', async () => {
    const month = button.dataset.historyMonth;
    if (!state.historyLoadedMonths.has(month)) {
      state.historySearching = true;
      state.historyProgress = `正在载入 ${month} 的命中论文…`;
      renderGlobalKeywordPanel();
      await loadHistoryMonths([month], state.historyRequestToken);
      state.historySearching = false;
    }
    state.scope = 'custom';
    state.dateFrom = `${month}-01`;
    state.dateTo = historyMonthEnd(month);
    $('#scopeSelect').value = 'custom';
    $('#dateFrom').value = state.dateFrom;
    $('#dateTo').value = state.dateTo;
    updateMySpaceUI();
    renderGlobalKeywordPanel();
    renderCards();
  }));
}

function categoryName(id) {
  return state.categoryMap.get(id)?.name || id || '其他前沿';
}

function isFavorite(id) {
  return Boolean(state.personal.favorites[id]) || (hasPublicFavorite(id) && !state.personal.hiddenPublicFavorites.includes(id));
}

function isIgnored(id) {
  return state.personal.ignoredItems.includes(id);
}

function toggleIgnored(item) {
  if (isIgnored(item.id)) {
    state.personal.ignoredItems = state.personal.ignoredItems.filter(id => id !== item.id);
    showToast('已恢复这篇论文');
  } else {
    state.personal.ignoredItems.push(item.id);
    showToast('已忽略这篇论文，可在“已忽略”中恢复');
  }
  savePersonal();
  refreshPaperCardViews();
}

function readingLabel(id) {
  return { reading: '在读', read: '已读' }[state.personal.readStatus[id]] || '未读';
}

function cycleReadingStatus(item) {
  const current = state.personal.readStatus[item.id] || 'unread';
  const next = { unread: 'reading', reading: 'read', read: 'unread' }[current];
  if (next === 'unread') delete state.personal.readStatus[item.id];
  else state.personal.readStatus[item.id] = next;
  savePersonal();
  showToast(`已标记为${readingLabel(item.id)}`);
  refreshPaperCardViews();
}

function markOpened(item) {
  if (!state.personal.readStatus[item.id]) {
    state.personal.readStatus[item.id] = 'reading';
    savePersonal();
  }
}

function translationFor(item) {
  const translation = state.translations[item.id] || null;
  return translation && (translation.title_zh || translation.abstract_zh) ? translation : null;
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applyTranslationGlossary(value = '') {
  return [...state.personal.translationGlossary]
    .sort((a, b) => b.source.length - a.source.length)
    .reduce((result, rule) => result.replace(new RegExp(escapeRegExp(rule.source), 'giu'), () => rule.target), String(value));
}

function translationGlossaryMatches(item) {
  const haystack = [item.title, item.abstract, item.summary, translationFor(item)?.title_zh, translationFor(item)?.abstract_zh]
    .join(' ').toLocaleLowerCase('zh-CN');
  return state.personal.translationGlossary.filter(rule => haystack.includes(rule.source.toLocaleLowerCase('zh-CN')));
}

function isTranslationFavorite(id) {
  return Boolean(state.personal.translationFavorites[id]);
}

function toggleTranslationFavorite(item) {
  if (!translationFor(item)) return showToast('这篇论文暂时还没有可收藏的中文译文');
  if (isTranslationFavorite(item.id)) {
    delete state.personal.translationFavorites[item.id];
    showToast('已取消收藏译文');
  } else {
    state.personal.translationFavorites[item.id] = { id: item.id, added_at: new Date().toISOString() };
    state.translatedIds.add(item.id);
    showToast('已收藏中文译文');
  }
  savePersonal();
  refreshPaperCardViews();
  renderHomeHub();
}

function usingTranslation(item) {
  return state.translatedIds.has(item.id) && Boolean(translationFor(item));
}

function localizedTitle(item) {
  const translation = translationFor(item);
  return usingTranslation(item) && translation.title_zh ? applyTranslationGlossary(translation.title_zh) : item.title;
}

function localizedAbstract(item) {
  const translation = translationFor(item);
  return usingTranslation(item) && translation.abstract_zh
    ? applyTranslationGlossary(translation.abstract_zh)
    : (item.abstract || item.summary || '');
}

function localizedDescription(item) {
  const value = localizedAbstract(item);
  if (value) return value;
  if (item.type === 'news') {
    return `${item.source || '官方来源'}发布的科研新闻，主题为“${item.title}”。当前官方订阅源未附简介，可从原文查看完整报道。`;
  }
  return '';
}

function abstractSourceLabel(item) {
  const source = String(item.abstract_source || '');
  if (!source) return item.abstract ? '原始数据源' : '未提供';
  if (source.startsWith('Publisher Cite')) return '期刊 Cite 导出';
  if (source.startsWith('Publisher metadata')) return '期刊官网元数据';
  if (source === 'Crossref') return 'Crossref';
  if (source === 'OpenAlex') return 'OpenAlex';
  if (source === 'Semantic Scholar') return 'Semantic Scholar';
  if (source === 'INSPIRE') return 'INSPIRE';
  if (source.includes('arXiv')) return 'arXiv';
  return source;
}

function missingAbstractMessage(item) {
  const sources = item.abstract_checked_sources || [];
  if (item.abstract_status === 'unavailable' || sources.length >= 4) {
    return `已查询${sources.join('、') || '期刊官网/Cite、OpenAlex、Semantic Scholar、INSPIRE'}，当前均无公开摘要；本站不生成或杜撰摘要。`;
  }
  return '该数据源暂未公开摘要，其他元数据源仍在补全队列中。';
}

function googleTranslationPageUrl(item) {
  const source = [item.title, item.abstract || item.summary || ''].filter(Boolean).join('\n\n').slice(0, 4500);
  const url = new URL('https://translate.google.com/');
  url.search = new URLSearchParams({ sl: 'auto', tl: 'zh-CN', text: source, op: 'translate' });
  return url.href;
}

const ZOTERO_BRIDGE_URL = 'http://127.0.0.1:43119';

function zoteroPayload(item) {
  const translation = translationFor(item) || {};
  return {
    id: item.id,
    title: item.title,
    title_zh: translation.title_zh || '',
    authors: item.authors || [],
    abstract: item.abstract || item.summary || '',
    source: item.source || '',
    source_short: item.source_short || '',
    source_type: item.source_type || 'journal',
    published: item.published || '',
    volume: item.volume || '',
    issue: item.issue || '',
    pages: item.pages || '',
    doi: item.doi || '',
    arxiv_id: item.arxiv_id || '',
    url: item.url || '',
    pdf_url: item.pdf_url || '',
    language: item.language || 'en',
    categories: (item.categories || []).map(categoryName),
    tags: item.tags || [],
    keywords: favoriteKeywords(item.id),
    note: state.personal.notes[item.id] || '',
    remarks: favoriteKeywords(item.id).length ? `网站收藏关键词：${favoriteKeywords(item.id).join('、')}` : '',
  };
}

function zoteroButtonLabel(item) {
  const status = state.zoteroStatusById.get(item.id);
  if (!status) return '📗 保存到 Zotero';
  if (status.kind === 'saving') return '正在保存…';
  if (status.kind === 'existing') return '✓ Zotero 已有';
  if (status.kind === 'saved') return status.pdfSaved ? '✓ Zotero + PDF' : '✓ Zotero（无 PDF）';
  return '重试 Zotero';
}

function updateZoteroButtons(item) {
  const status = state.zoteroStatusById.get(item.id);
  $$('[data-zotero-save]').filter(button => button.dataset.zoteroSave === item.id).forEach(button => {
    button.textContent = zoteroButtonLabel(item);
    button.disabled = status?.kind === 'saving';
    button.classList.toggle('saving', status?.kind === 'saving');
    button.classList.toggle('saved', ['saved', 'existing'].includes(status?.kind));
    button.classList.toggle('failed', status?.kind === 'failed');
    button.title = status?.message || '保存到 Zotero 当前选中的收藏夹，并尝试附加 PDF 和网站笔记';
  });
}

function zoteroButtonFor(item) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'zotero-button';
  button.dataset.zoteroSave = item.id;
  button.textContent = zoteroButtonLabel(item);
  button.setAttribute('aria-label', `将论文《${item.title}》、PDF 和笔记保存到 Zotero`);
  button.addEventListener('click', () => void openZoteroClassification(item));
  requestAnimationFrame(() => updateZoteroButtons(item));
  return button;
}

function defaultZoteroClassification(item) {
  return uniqueKeywords([
    ...(item.categories || []).map(categoryName),
    ...favoriteKeywords(item.id),
  ]);
}

async function loadZoteroTargets(item) {
  try {
    const response = await fetch(`${ZOTERO_BRIDGE_URL}/collections`, {
      headers: { 'X-Nuclear-Frontier-Bridge': '1' },
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.message || `本机桥返回 ${response.status}`);
    if (state.zoteroDraft?.itemId !== item.id) return;
    state.zoteroDraft.targets = result.targets || [];
    state.zoteroDraft.targetId = result.current_id || result.targets?.[0]?.id || '';
    state.zoteroDraft.loading = false;
    state.zoteroDraft.error = '';
  } catch (error) {
    if (state.zoteroDraft?.itemId !== item.id) return;
    const reason = error instanceof Error ? error.message : String(error);
    state.zoteroDraft.loading = false;
    state.zoteroDraft.error = reason.includes('Failed to fetch')
      ? '无法连接本机 Zotero，请确认 Zotero 和本机桥已启动'
      : reason;
  }
  refreshPaperCardViews();
}

function openZoteroClassification(item) {
  state.zoteroDraft = {
    itemId: item.id,
    targets: [],
    targetId: '',
    classification: new Set(defaultZoteroClassification(item)),
    loading: true,
    error: '',
  };
  refreshPaperCardViews();
  void loadZoteroTargets(item);
}

function closeZoteroClassification() {
  state.zoteroDraft = null;
  refreshPaperCardViews();
}

function zoteroClassificationPanelFor(item) {
  const draft = state.zoteroDraft;
  if (!draft || draft.itemId !== item.id) return null;
  const panel = document.createElement('section');
  panel.className = 'zotero-classification-panel';
  panel.dataset.zoteroClassification = item.id;

  const choices = uniqueKeywords([
    ...defaultZoteroClassification(item),
    ...draft.classification,
    '重点参考', '待阅论文', '实验方法', '理论模型', '探测器',
  ]);
  panel.innerHTML = `
    <div class="inline-panel-head"><b>🗂 保存前分类</b><small>分类会同时保存为 Zotero 标签</small></div>
    <label class="zotero-target-field"><span>Zotero 收藏夹</span><select aria-label="Zotero 收藏夹" ${draft.loading ? 'disabled' : ''}></select></label>
    <div class="zotero-classification-label"><span>研究分类（至少选一项）</span><small>已根据论文内容预选</small></div>
    <div class="zotero-classification-tags">${choices.map(value => `<button type="button" class="${draft.classification.has(value) ? 'active' : ''}" data-zotero-class="${text(value)}" aria-pressed="${draft.classification.has(value)}">${text(value)}</button>`).join('')}</div>
    <div class="zotero-custom-class"><input maxlength="80" placeholder="自定义分类，如 14C(p,2p)、DSSD…" aria-label="自定义 Zotero 分类"><button type="button">添加</button></div>
    ${draft.loading ? '<p class="zotero-panel-status">正在读取 Zotero 收藏夹…</p>' : ''}
    ${draft.error ? `<p class="zotero-panel-status error">${text(draft.error)}</p>` : ''}
    <div class="zotero-classification-actions"><button type="button" class="cancel">取消</button><button type="button" class="confirm" ${draft.loading || draft.error || !draft.classification.size ? 'disabled' : ''}>确认分类并保存</button></div>`;

  const select = $('select', panel);
  if (draft.targets.length) {
    draft.targets.forEach(target => {
      const option = document.createElement('option');
      option.value = target.id;
      option.textContent = `${'　'.repeat(Math.max(0, target.level))}${target.name}${target.recent ? ' · 最近' : ''}`;
      option.selected = target.id === draft.targetId;
      select.append(option);
    });
  } else {
    const option = document.createElement('option');
    option.textContent = draft.loading ? '读取中…' : '暂无可用收藏夹';
    select.append(option);
  }
  select.addEventListener('change', () => { if (state.zoteroDraft?.itemId === item.id) state.zoteroDraft.targetId = select.value; });
  $$('[data-zotero-class]', panel).forEach(button => button.addEventListener('click', () => {
    if (state.zoteroDraft?.itemId !== item.id) return;
    const value = button.dataset.zoteroClass;
    if (state.zoteroDraft.classification.has(value)) state.zoteroDraft.classification.delete(value);
    else state.zoteroDraft.classification.add(value);
    refreshPaperCardViews();
  }));
  const input = $('.zotero-custom-class input', panel);
  const addCustom = () => {
    const value = normalizeKeyword(input.value);
    if (!value || state.zoteroDraft?.itemId !== item.id) return;
    state.zoteroDraft.classification.add(value);
    refreshPaperCardViews();
  };
  $('.zotero-custom-class button', panel).addEventListener('click', addCustom);
  input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addCustom(); } });
  $('.cancel', panel).addEventListener('click', closeZoteroClassification);
  $('.confirm', panel).addEventListener('click', () => void saveToZotero(item));
  return panel;
}

async function saveToZotero(item) {
  if (state.zoteroStatusById.get(item.id)?.kind === 'saving') return;
  const draft = state.zoteroDraft;
  if (!draft || draft.itemId !== item.id || !draft.targetId || !draft.classification.size) {
    return openZoteroClassification(item);
  }
  state.zoteroStatusById.set(item.id, { kind: 'saving', message: '正在连接本机 Zotero…' });
  updateZoteroButtons(item);
  try {
    const response = await fetch(`${ZOTERO_BRIDGE_URL}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Nuclear-Frontier-Bridge': '1' },
      body: JSON.stringify({
        item: zoteroPayload(item),
        target: draft.targetId,
        classification: [...draft.classification],
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.message || `本机桥返回 ${response.status}`);
    const kind = result.already_exists ? 'existing' : 'saved';
    state.zoteroStatusById.set(item.id, {
      kind,
      pdfSaved: Boolean(result.pdf_saved),
      message: result.message || '已保存到 Zotero',
    });
    state.zoteroDraft = null;
    updateZoteroButtons(item);
    showToast(result.message || '已保存到 Zotero');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const message = reason.includes('Failed to fetch')
      ? '无法连接本机 Zotero：请打开 Zotero，并确认本机桥已启动'
      : reason;
    state.zoteroStatusById.set(item.id, { kind: 'failed', message });
    updateZoteroButtons(item);
    showToast(message);
  }
}

function refreshPaperCardViews() {
  renderCards();
  if (state.view === 'home') renderHomeDashboard();
}

function focusInlineNote(item) {
  requestAnimationFrame(() => {
    const card = $$('.paper-card').find(value => value.dataset.id === item.id);
    const editor = $('.inline-note-editor textarea', card);
    editor?.focus();
    editor?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

function openInlineNote(item) {
  state.inlineNoteId = state.inlineNoteId === item.id ? '' : item.id;
  refreshPaperCardViews();
  if (state.inlineNoteId) focusInlineNote(item);
}

function saveInlineNote(item, value) {
  const previous = state.personal.notes[item.id];
  const noteValue = String(value || '').trim();
  if (noteValue) state.personal.notes[item.id] = noteValue;
  else delete state.personal.notes[item.id];
  if (!savePersonal()) {
    if (previous === undefined) delete state.personal.notes[item.id];
    else state.personal.notes[item.id] = previous;
    return;
  }
  state.inlineNoteId = '';
  refreshPaperCardViews();
  showToast(noteValue ? '笔记已更新，请提交到 GitHub' : '空笔记已清除');
}

function deleteInlineNote(item) {
  const previous = state.personal.notes[item.id];
  delete state.personal.notes[item.id];
  if (!savePersonal()) {
    if (previous !== undefined) state.personal.notes[item.id] = previous;
    return;
  }
  state.inlineNoteId = '';
  refreshPaperCardViews();
  showToast('笔记已删除');
}

function inlineNoteEditorFor(item) {
  if (state.inlineNoteId !== item.id) return null;
  const value = state.personal.notes[item.id] || '';
  const section = document.createElement('section');
  section.className = 'inline-note-editor';
  section.dataset.inlineNote = item.id;
  section.innerHTML = `
    <div class="inline-panel-head"><b>📝 论文笔记</b><small>提交后公开同步到 GitHub</small></div>
    <textarea maxlength="12000" placeholder="记录阅读要点、引用位置、实验想法或待验证问题…">${text(value)}</textarea>
    <div class="inline-note-foot"><b>${value.length.toLocaleString('zh-CN')} / 12000</b><span></span>${value.trim() ? '<button type="button" class="delete">删除</button>' : ''}<button type="button" class="cancel">取消</button><button type="button" class="save">保存笔记</button></div>`;
  const input = $('textarea', section);
  input.addEventListener('input', () => $('.inline-note-foot b', section).textContent = `${input.value.length.toLocaleString('zh-CN')} / 12000`);
  input.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      saveInlineNote(item, input.value);
    }
  });
  $('.save', section).addEventListener('click', () => saveInlineNote(item, input.value));
  $('.cancel', section).addEventListener('click', () => { state.inlineNoteId = ''; refreshPaperCardViews(); });
  $('.delete', section)?.addEventListener('click', () => deleteInlineNote(item));
  return section;
}

function toggleTranslation(item) {
  if (!translationFor(item)) return showToast('这篇论文暂时还没有 Codex 中文译文');
  if (state.translatedIds.has(item.id)) state.translatedIds.delete(item.id);
  else state.translatedIds.add(item.id);
  refreshPaperCardViews();
}

function cardFor(item, { onSelect = selectPaperForAssistant } = {}) {
  const template = $('#paperCardTemplate');
  const card = template.content.firstElementChild.cloneNode(true);
  const primary = item.categories?.[0] || 'frontiers';
  card.dataset.id = item.id;
  card.dataset.primary = primary;
  card.classList.toggle('selected-for-assistant', state.selectedPaperId === item.id);
  if ((item.importance || 0) >= 65) card.classList.add('featured');

  const meta = $('.paper-meta', card);
  const source = document.createElement('span');
  source.className = 'source-badge';
  source.textContent = item.source_short || item.source || '官方来源';
  meta.append(source);
  if (item.type === 'paper' && item.abstract) {
    const abstractSource = document.createElement('span');
    abstractSource.className = 'abstract-source-badge';
    abstractSource.textContent = `摘要：${abstractSourceLabel(item)}`;
    meta.append(abstractSource);
  }
  const date = document.createElement('span');
  date.textContent = prettyDate(item.published);
  meta.append(date);
  if (item.source_type === 'preprint') {
    const preprint = document.createElement('span');
    preprint.textContent = 'PREPRINT';
    meta.append(preprint);
  }
  if ((item.importance || 0) >= 60) {
    const score = document.createElement('span');
    score.className = 'importance-badge';
    score.textContent = `重点 ${item.importance}`;
    meta.append(score);
  }
  if ((item.first_seen || '').slice(0, 10) === state.meta?.status?.last_success?.slice(0, 10)) {
    const fresh = document.createElement('span');
    fresh.className = 'new-badge';
    fresh.textContent = 'NEW';
    meta.append(fresh);
  }
  if (personalMatch(item)) {
    const mine = document.createElement('span');
    mine.className = 'importance-badge';
    mine.textContent = '我的关注';
    meta.append(mine);
  }

  const heading = $('h3', card);
  const titleLink = document.createElement('a');
  titleLink.href = item.url || '#';
  titleLink.target = '_blank';
  titleLink.rel = 'noreferrer';
  const translation = translationFor(item);
  const translated = usingTranslation(item);
  titleLink.textContent = translated ? applyTranslationGlossary(translation.title_zh) : item.title;
  heading.append(titleLink);

  const authors = $('.authors', card);
  authors.textContent = item.authors?.length ? item.authors.join(', ') : item.source;
  if (!item.authors?.length && item.type !== 'paper') authors.hidden = true;

  const abstractValue = item.abstract || item.summary || '';
  const hasTranslatedAbstract = Boolean(translated && translation?.abstract_zh);
  const abstract = $('.abstract', card);
  abstract.textContent = hasTranslatedAbstract
    ? applyTranslationGlossary(translation.abstract_zh)
    : (localizedDescription(item) || missingAbstractMessage(item));
  $('.abstract-label', card).textContent = (abstractValue || item.type === 'news')
    ? (hasTranslatedAbstract ? '完整摘要（Codex 中文译文）' : (item.type === 'paper' ? '完整摘要（原文）' : '完整介绍（原始来源）'))
    : (item.type === 'paper' ? '摘要状态' : '介绍状态');

  const tags = $('.tag-row', card);
  (item.categories || []).slice(0, 2).forEach(id => {
    const tag = document.createElement('span');
    tag.className = 'tag category';
    tag.textContent = categoryName(id);
    tags.append(tag);
  });
  const methodLabels = { experimental: '实验', theoretical: '理论', review: '综述' };
  (item.methods || []).slice(0, 2).forEach(value => {
    const tag = document.createElement('span');
    tag.className = 'tag method-tag';
    tag.textContent = methodLabels[value] || value;
    tags.append(tag);
  });
  (item.tags || []).slice(0, 3).forEach(value => {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = value;
    tags.append(tag);
  });
  favoriteKeywords(item.id).forEach(value => {
    const tag = document.createElement('span');
    tag.className = 'tag favorite-keyword-tag';
    tag.textContent = `# ${value}`;
    tags.append(tag);
  });
  translationGlossaryMatches(item).slice(0, 3).forEach(rule => {
    const tag = document.createElement('span');
    tag.className = 'tag translation-term-tag';
    tag.textContent = `译法：${rule.source} → ${rule.target}`;
    tags.append(tag);
  });

  const actions = $('.paper-actions', card);
  const original = document.createElement('a');
  original.href = item.url || '#';
  original.target = '_blank';
  original.rel = 'noreferrer';
  original.textContent = item.type === 'paper' ? '原始页面 ↗' : '阅读原文 ↗';
  original.addEventListener('click', () => markOpened(item));
  actions.append(original);
  if (item.pdf_url) {
    const pdf = document.createElement('a');
    pdf.href = item.pdf_url;
    pdf.target = '_blank';
    pdf.rel = 'noreferrer';
    pdf.textContent = 'PDF ↗';
    actions.append(pdf);
  }
  if (item.doi) {
    const doi = document.createElement('span');
    doi.textContent = `DOI ${item.doi}`;
    doi.className = 'paper-doi';
    actions.append(doi);
  }
  if (item.type === 'paper') {
    const cite = document.createElement('button');
    cite.type = 'button';
    cite.className = 'cite-button';
    cite.textContent = state.inlineCitationId === item.id ? '收起 Cite' : 'Cite';
    cite.setAttribute('aria-label', `引用论文《${item.title}》`);
    cite.setAttribute('aria-expanded', String(state.inlineCitationId === item.id));
    cite.addEventListener('click', () => toggleInlineCitation(item));
    actions.append(cite);
    actions.append(zoteroButtonFor(item));
  }

  const translate = document.createElement('button');
  translate.type = 'button';
  translate.className = 'translation-button';
  translate.textContent = translation ? (translated ? '查看英文原文' : '查看中文译文') : '翻译排队中';
  translate.disabled = !translation;
  translate.title = translation
    ? '中文译文优先显示，可随时切换回原文'
    : 'Codex 将在自动翻译队列中补全这条内容';
  translate.addEventListener('click', () => toggleTranslation(item));
  actions.append(translate);

  const googleTranslate = document.createElement('a');
  googleTranslate.className = 'google-translation-link';
  googleTranslate.href = googleTranslationPageUrl(item);
  googleTranslate.target = '_blank';
  googleTranslate.rel = 'noreferrer';
  googleTranslate.textContent = 'Google 翻译官网 ↗';
  googleTranslate.title = '打开已填入论文题目与摘要的 Google 翻译页面';
  googleTranslate.setAttribute('aria-label', `使用 Google 翻译查看《${item.title}》`);
  actions.append(googleTranslate);

  if (item.type === 'paper') {
    if (translation) {
      const saveTranslation = document.createElement('button');
      saveTranslation.type = 'button';
      saveTranslation.className = `translation-favorite-button${isTranslationFavorite(item.id) ? ' active' : ''}`;
      saveTranslation.textContent = isTranslationFavorite(item.id) ? '★ 已收藏译文' : '☆ 收藏译文';
      saveTranslation.setAttribute('aria-pressed', String(isTranslationFavorite(item.id)));
      saveTranslation.addEventListener('click', () => toggleTranslationFavorite(item));
      actions.append(saveTranslation);
    }

    const hasNote = Boolean((state.personal.notes[item.id] || '').trim());
    const note = document.createElement('button');
    note.type = 'button';
    note.className = `note-button${hasNote ? ' has-note' : ''}`;
    note.textContent = hasNote ? '📝 编辑已有笔记' : '📝 写笔记';
    note.setAttribute('aria-label', `${hasNote ? '编辑' : '为'}论文《${item.title}》${hasNote ? '的笔记' : '写笔记'}`);
    note.addEventListener('click', () => openInlineNote(item));
    actions.append(note);

    const info = document.createElement('button');
    info.type = 'button';
    info.className = 'paper-info-button';
    info.textContent = '论文信息';
    info.addEventListener('click', () => onSelect(item));
    actions.append(info);
  } else if (item.type === 'news') {
    const info = document.createElement('button');
    info.type = 'button';
    info.className = 'paper-info-button';
    info.textContent = '新闻信息';
    info.addEventListener('click', () => onSelect(item));
    actions.append(info);
  }
  if (item.type === 'paper') {
    const ignore = document.createElement('button');
    ignore.type = 'button';
    ignore.className = `ignore-button${isIgnored(item.id) ? ' active' : ''}`;
    ignore.textContent = isIgnored(item.id) ? '恢复论文' : '忽略';
    ignore.title = isIgnored(item.id) ? '重新显示这篇论文' : '以后不再显示这篇论文';
    ignore.addEventListener('click', () => toggleIgnored(item));
    actions.append(ignore);
  }
  if (item.type === 'paper') {
    const related = document.createElement('button');
    related.type = 'button';
    related.className = 'related-button';
    related.textContent = '关联文献';
    related.addEventListener('click', () => openDetails(item));
    actions.append(related);
  }
  if (state.inlineCitationId === item.id) {
    const citationPanel = citationPanelFor(item);
    $('.paper-copy', card).append(citationPanel);
  }
  const noteEditor = inlineNoteEditorFor(item);
  if (noteEditor) $('.paper-copy', card).append(noteEditor);
  const zoteroPanel = zoteroClassificationPanelFor(item);
  if (zoteroPanel) $('.paper-copy', card).append(zoteroPanel);

  const favorite = $('.favorite-button', card);
  if (!['paper', 'news'].includes(item.type)) return card;
  card.tabIndex = 0;
  card.setAttribute('aria-label', `${item.type === 'paper' ? '论文' : '新闻'}：${item.title}。按回车在右侧查看详细信息`);
  card.addEventListener('click', event => {
    if (event.target.closest('a, button, input, select, textarea')) return;
    onSelect(item);
  });
  card.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.target !== card) return;
    event.preventDefault();
    onSelect(item);
  });
  favorite.textContent = isFavorite(item.id) ? '★' : '☆';
  favorite.classList.toggle('active', isFavorite(item.id));
  favorite.setAttribute('aria-pressed', String(isFavorite(item.id)));
  favorite.addEventListener('click', () => toggleFavorite(item, favorite));
  return card;
}

const DEFAULT_CODE_ITEMS = [
  {
    id: 'default-nuclear-frontier', title: 'nuclear-frontier',
    url: 'https://github.com/code-world-kang/nuclear-frontier',
    description: '小康康的物理世界：每日自动更新的核物理科研情报网站。',
    keywords: ['GitHub', '核物理', '科研网站'], builtin: true,
  },
];

const DEFAULT_RESOURCES = [
  { id: 'default-arxiv-nucl-ex', title: 'arXiv · Nuclear Experiment', url: 'https://arxiv.org/list/nucl-ex/recent', description: '实验核物理最新预印本。', keywords: ['nucl-ex', '预印本'], group: 'journals-data', builtin: true },
  { id: 'default-nndc', title: 'NNDC · Nuclear Data', url: 'https://www.nndc.bnl.gov/', description: '核结构、核衰变与反应数据入口。', keywords: ['核数据', 'ENSDF'], group: 'journals-data', builtin: true },
  { id: 'default-iaea-nds', title: 'IAEA Nuclear Data Services', url: 'https://www-nds.iaea.org/', description: 'IAEA 核数据服务与数据库。', keywords: ['IAEA', '核数据'], group: 'journals-data', builtin: true },
  { id: 'default-root-docs', title: 'CERN ROOT Documentation', url: 'https://root.cern/manual/', description: 'ROOT 数据分析框架官方手册。', keywords: ['ROOT', '数据分析'], group: 'data-analysis', builtin: true },
];

function myCollectionItems(section = state.mySection) {
  if (section === 'code') return [...DEFAULT_CODE_ITEMS, ...state.personal.codeItems];
  if (section === 'references') return [...DEFAULT_RESOURCES, ...state.referenceResources, ...state.personal.resources];
  return [];
}

function referenceGroupInfo(id) {
  return REFERENCE_GROUPS.find(group => group.id === id) || REFERENCE_GROUPS.find(group => group.id === 'other');
}

function renderReferenceGroups() {
  const host = $('#referenceGroupList');
  if (!host) return;
  const items = myCollectionItems('references');
  const counts = new Map();
  items.forEach(item => {
    const group = item.group || 'other';
    counts.set(group, (counts.get(group) || 0) + 1);
  });
  host.replaceChildren(...REFERENCE_GROUPS.filter(group => group.id === 'all' || counts.get(group.id)).map(group => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `reference-group-button${state.referenceGroup === group.id ? ' active' : ''}`;
    button.innerHTML = `<span>${text(group.icon)}</span><b>${text(group.label)}</b><small>${text(group.description)}</small><i>${group.id === 'all' ? items.length : (counts.get(group.id) || 0)}</i>`;
    button.addEventListener('click', () => {
      state.referenceGroup = group.id;
      renderMyCollection();
    });
    return button;
  }));
}

function personalCollectionCard(item, section) {
  const card = document.createElement('article');
  card.className = 'personal-card';
  const tags = uniqueKeywords(item.keywords || []).map(value => `<span>${text(value)}</span>`).join('');
  card.innerHTML = `
    <div class="personal-card-icon" aria-hidden="true">${section === 'code' ? '⌘' : '↗'}</div>
    <div><small>${section === 'code' ? 'CODE & PROJECT' : text(referenceGroupInfo(item.group).label)}</small><h3><a href="${text(item.url)}" target="_blank" rel="noreferrer">${text(item.title)}</a></h3>
    <p>${text(item.description || '尚未填写说明。')}</p><div class="personal-card-tags">${tags}</div></div>
    <div class="personal-card-actions"><a href="${text(item.url)}" target="_blank" rel="noreferrer">打开 ↗</a>${item.builtin ? '' : '<button type="button">删除</button>'}</div>`;
  if (!item.builtin) $('button', card)?.addEventListener('click', () => {
    const key = section === 'code' ? 'codeItems' : 'resources';
    state.personal[key] = state.personal[key].filter(value => value.id !== item.id);
    savePersonal(); renderCards(); renderHomeHub(); showToast('已删除');
  });
  return card;
}

function renderMyCollection() {
  const query = state.query.trim().toLowerCase();
  const items = myCollectionItems()
    .filter(item => state.mySection !== 'references' || state.referenceGroup === 'all' || (item.group || 'other') === state.referenceGroup)
    .filter(item => !query || [item.title, item.description, referenceGroupInfo(item.group).label, ...(item.keywords || [])].join(' ').toLowerCase().includes(query));
  $('#cardList').replaceChildren(...items.map(item => personalCollectionCard(item, state.mySection)));
  $('#resultCount').textContent = `共 ${items.length} 项`;
  $('#emptyState').hidden = items.length !== 0;
  $('#loadMore').hidden = true;
  $('#activeFilters').replaceChildren();
  $('#myKeywordsPanel').hidden = true;
  renderReferenceGroups();
  closePaperAssistant();
}

function renderCards() {
  if (state.view === 'favorites' && ['code', 'references'].includes(state.mySection)) {
    renderMyCollection();
    return;
  }
  const items = filteredItems();
  const list = $('#cardList');
  list.replaceChildren(...items.slice(0, state.visible).map(cardFor));
  $('#resultCount').textContent = state.view === 'papers' && state.globalKeyword
    ? `全库命中 ${state.historyTotalMatches.toLocaleString('zh-CN')} 篇 · 已载入 ${items.length.toLocaleString('zh-CN')} 篇详情`
    : `共 ${items.length.toLocaleString('zh-CN')} 条结果`;
  $('#emptyState').hidden = items.length !== 0;
  const hasQueuedHistory = state.view === 'papers' && state.globalKeyword && state.historyMonthQueue.length;
  $('#loadMore').hidden = items.length <= state.visible && !hasQueuedHistory;
  $('#loadMore').disabled = state.historySearching;
  $('#loadMore').textContent = hasQueuedHistory
    ? (state.historySearching ? '正在载入…' : '继续载入更早月份')
    : '显示更多';
  renderActiveFilters();
  renderGlobalKeywordPanel();
  renderMyKeywordsPanel();
  renderTranslationShelfPanel();
  renderPaperAssistant(items);
}

function renderActiveFilters() {
  const host = $('#activeFilters');
  host.replaceChildren();
  if (state.category !== 'all') {
    const tag = document.createElement('span');
    tag.className = 'active-filter';
    tag.innerHTML = `${text(categoryName(state.category))}<button aria-label="清除分类">×</button>`;
    $('button', tag).addEventListener('click', () => setCategory('all'));
    host.append(tag);
  }
  if (!['news', 'notices'].includes(state.view) && state.source !== 'all') {
    const tag = document.createElement('span');
    tag.className = 'active-filter';
    tag.innerHTML = `${text(state.source)}<button aria-label="清除来源">×</button>`;
    $('button', tag).addEventListener('click', () => {
      state.source = 'all';
      $('#sourceSelect').value = 'all';
      renderCards();
    });
    host.append(tag);
  }
  if (state.searchField !== 'all') {
    const label = $('#searchFieldSelect').selectedOptions[0]?.textContent || '自定义字段';
    const tag = document.createElement('span');
    tag.className = 'active-filter';
    tag.innerHTML = `${text(label)}<button aria-label="恢复全文搜索">×</button>`;
    $('button', tag).addEventListener('click', () => {
      state.searchField = 'all'; $('#searchFieldSelect').value = 'all'; renderCards();
    });
    host.append(tag);
  }
  if (state.view === 'papers' && state.scope === 'custom') {
    const range = [state.dateFrom || '最早', state.dateTo || '最新'].join(' 至 ');
    const tag = document.createElement('span');
    tag.className = 'active-filter';
    tag.innerHTML = `日期：${text(range)}<button aria-label="清除自定义日期范围">×</button>`;
    $('button', tag).addEventListener('click', () => {
      state.scope = 'all';
      $('#scopeSelect').value = 'all';
      updateMySpaceUI();
      renderCards();
    });
    host.append(tag);
  }
  if (state.view === 'favorites' && state.mySection === 'papers' && state.favoriteKeyword !== 'all') {
    const label = state.favoriteKeyword === 'missing'
      ? '未分类'
      : allFavoriteKeywordStats().find(item => item.key === state.favoriteKeyword)?.label || '收藏关键词';
    const tag = document.createElement('span');
    tag.className = 'active-filter';
    tag.innerHTML = `收藏：${text(label)}<button aria-label="清除收藏关键词筛选">×</button>`;
    $('button', tag).addEventListener('click', () => { state.favoriteKeyword = 'all'; renderCards(); });
    host.append(tag);
  }
}

function updateMySpaceUI() {
  const isMy = state.view === 'favorites';
  const isPaperShelf = !isMy || ['papers', 'translations'].includes(state.mySection);
  $('#mySpaceNav').hidden = !isMy;
  $('.view-tabs').hidden = isMy;
  $$('.my-space-tab').forEach(button => button.classList.toggle('active', button.dataset.mySection === state.mySection));
  document.body.classList.toggle('personal-collection-view', isMy && !isPaperShelf);
  $('#searchFieldSelect').hidden = !isPaperShelf;
  $('#scopeSelect').hidden = state.view !== 'papers';
  $('#customDateRange').hidden = !(state.view === 'papers' && state.scope === 'custom');
  $('#sourceSelect').hidden = !isPaperShelf || ['news', 'notices'].includes(state.view);
  $('#sortSelect').hidden = !isPaperShelf;
  $('#exportReferences').hidden = ['news', 'notices'].includes(state.view) || !isPaperShelf;
  $('#addMyItem').hidden = !(isMy && !isPaperShelf);
  $('#myKeywordsPanel').hidden = !(isMy && state.mySection === 'papers');
  $('#historyKeywordPanel').hidden = state.view !== 'papers';
  $('#translationShelfPanel').hidden = !(isMy && state.mySection === 'translations');
  $('#referenceGroupPanel').hidden = !(isMy && state.mySection === 'references');
  const isPaperWorkspace = ['home', 'papers', 'featured', 'unread', 'ignored', 'news'].includes(state.view) || (isMy && isPaperShelf);
  document.body.classList.toggle('paper-assistant-available', isPaperWorkspace);
  $('#openPaperAssistant').hidden = !isPaperWorkspace;
  $('#paperAssistant').hidden = !isPaperWorkspace;
  $('#assistantBackdrop').hidden = !isPaperWorkspace;
  if (!isPaperWorkspace) closePaperAssistant();
  $('#openPaperAssistant').lastChild.textContent = state.view === 'news' ? '新闻详情' : '论文助手';
  $('#searchInput').placeholder = isMy
    ? ({ papers: '搜索收藏论文、作者或关键词…', translations: '搜索收藏译文、作者或术语…', code: '搜索我的代码与项目…', references: '搜索参考资料…' }[state.mySection])
    : '搜索题目、作者、期刊、DOI 或关键词…';
}

function setMySection(section) {
  if (!['papers', 'translations', 'code', 'references'].includes(section)) return;
  state.mySection = section;
  if (section === 'references') state.referenceGroup = 'all';
  state.visible = 20;
  const labels = {
    papers: ['MY PAPERS', '我的论文', '按收藏关键词筛选论文、阅读状态与笔记'],
    translations: ['TRANSLATION SHELF', '翻译收藏', '收藏重要中文译文，并用个人术语表指定特殊短语的译法'],
    code: ['MY CODE', '我的代码', '连接 GitHub 项目与常用分析代码'],
    references: ['REFERENCE SHELF', '参考资料', '数据库、官方手册与个人资料入口'],
  };
  if (section === 'translations') Object.keys(state.personal.translationFavorites).forEach(id => state.translatedIds.add(id));
  const [kicker, title, note] = labels[section];
  $('#sectionKicker').textContent = kicker;
  $('#sectionTitle').textContent = title;
  $('#viewNote').textContent = note;
  updateMySpaceUI();
  renderCards();
  history.replaceState(null, '', `${PATH}#favorites-${section}`);
}

function setView(view) {
  closePaperAssistant();
  state.selectedPaperId = '';
  state.inlineCitationId = '';
  const previousCategoryGroup = state.view === 'news' ? 'news' : 'papers';
  state.categorySelections[previousCategoryGroup] = state.category;
  state.view = view;
  const nextCategoryGroup = view === 'news' ? 'news' : 'papers';
  state.category = state.categorySelections[nextCategoryGroup] || 'all';
  state.visible = 20;
  const labels = {
    home: ['HOME', '首页', '今日科研简报、新闻、通知与重点文章'],
    papers: ['LATEST PAPERS', '最新论文', '题目与摘要保留原文'],
    featured: ['EDITOR\'S RADAR', '重点文献', '基于来源、新颖性与关注词评分'],
    news: ['OFFICIAL NEWS', '科研新闻', '仅保留官方原始链接'],
    notices: ['DAILY NOTICES', '每日科研通知', '基金·束流·博后·CSC·涉核会议'],
    favorites: ['MY RESEARCH SPACE', '我的科研空间', '论文、翻译收藏、代码与参考资料集中管理'],
    unread: ['READING QUEUE', '我的未读文献', '点击“未读”可在未读、在读和已读之间切换'],
    ignored: ['IGNORED PAPERS', '已忽略论文', '不感兴趣的论文集中放在这里，可随时恢复'],
  };
  const [kicker, title, note] = labels[view] || labels.papers;
  $('#sectionKicker').textContent = kicker;
  $('#sectionTitle').textContent = title;
  $('#viewNote').textContent = note;
  $$('.nav-link, .view-tab').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  const isHome = view === 'home';
  const isNoticeDashboard = view === 'notices';
  $('#briefing').hidden = !isHome;
  $('#homeDashboard').hidden = !isHome;
  $('#dailyNoticeDashboard').hidden = !isNoticeDashboard;
  $('#stream').hidden = isHome || isNoticeDashboard;
  updateMySpaceUI();
  if (isHome) {
    renderHomeDashboard();
    history.replaceState(null, '', `${PATH}#home`);
    return;
  }
  if (isNoticeDashboard) {
    renderDailyNotices();
    history.replaceState(null, '', `${PATH}#notices`);
    return;
  }
  renderCategories();
  if (view === 'favorites') {
    setMySection(state.mySection);
    return;
  }
  renderGlobalKeywordPanel();
  renderCards();
  history.replaceState(null, '', `${PATH}#${view}`);
}

function setCategory(id) {
  state.category = id;
  state.categorySelections[state.view === 'news' ? 'news' : 'papers'] = id;
  state.visible = 20;
  $$('.category-button').forEach(button => button.classList.toggle('active', button.dataset.category === id));
  renderCards();
}

function renderSourceOptions() {
  const counts = new Map();
  const values = state.view === 'papers' && state.globalKeyword ? state.historyResults : state.papers;
  values.forEach(item => counts.set(item.source, (counts.get(item.source) || 0) + 1));
  const select = $('#sourceSelect');
  select.replaceChildren(new Option('所有来源', 'all'));
  [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], 'en', { sensitivity: 'base', numeric: true })).forEach(([source, count]) => {
    select.add(new Option(`${source} (${count})`, source));
  });
  select.value = state.source;
}

function favoriteSuggestionValues(item) {
  const categorySuggestions = (item.categories || []).map(categoryName);
  const recent = state.personal.keywords.slice(-8).reverse();
  return uniqueKeywords([...categorySuggestions, ...(item.tags || []), ...recent]).slice(0, 16);
}

function renderFavoriteDraft() {
  const draft = state.favoriteDraft;
  if (!draft) return;
  const selectedKeys = new Set([...draft.selected].map(keywordKey));
  const suggestions = $('#favoriteSuggestions');
  suggestions.replaceChildren(...favoriteSuggestionValues(draft.item).map(value => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'suggestion-chip';
    button.classList.toggle('active', selectedKeys.has(keywordKey(value)));
    button.textContent = value;
    button.addEventListener('click', () => {
      const existing = [...draft.selected].find(item => keywordKey(item) === keywordKey(value));
      if (existing) draft.selected.delete(existing);
      else draft.selected.add(value);
      $('#favoriteError').textContent = '';
      renderFavoriteDraft();
    });
    return button;
  }));
  const selected = $('#favoriteSelected');
  selected.replaceChildren(...[...draft.selected].map(value => {
    const chip = document.createElement('span');
    chip.className = 'selected-keyword';
    chip.innerHTML = `${text(value)}<button type="button" aria-label="移除 ${text(value)}">×</button>`;
    $('button', chip).addEventListener('click', () => { draft.selected.delete(value); renderFavoriteDraft(); });
    return chip;
  }));
  if (!draft.selected.size) selected.innerHTML = '<small>尚未选择关键词</small>';
}

function addFavoriteInputToDraft() {
  const input = $('#favoriteKeywordInput');
  const values = uniqueKeywords(input.value.split(/[,;，；\n]+/));
  values.forEach(value => state.favoriteDraft?.selected.add(value));
  input.value = '';
  if (values.length) $('#favoriteError').textContent = '';
  renderFavoriteDraft();
}

function openFavoriteDialog(item) {
  state.favoriteDraft = { item, selected: new Set(favoriteKeywords(item.id)) };
  $('#favoritePaperTitle').textContent = item.title;
  $('#favoriteKeywordInput').value = '';
  $('#favoriteError').textContent = '';
  renderFavoriteDraft();
  $('#favoriteDialog').showModal();
  setTimeout(() => $('#favoriteKeywordInput').focus(), 50);
}

function closeFavoriteDialog() {
  $('#favoriteDialog').close();
  state.favoriteDraft = null;
}

async function saveFavoriteDraft() {
  const draft = state.favoriteDraft;
  if (!draft) return;
  addFavoriteInputToDraft();
  const keywords = uniqueKeywords([...draft.selected]);
  if (!keywords.length) {
    $('#favoriteError').textContent = '请至少选择或输入 1 个关键词。';
    return;
  }
  const item = draft.item;
  state.personal.favorites[item.id] = {
    id: item.id, doi: item.doi || '', arxiv_id: item.arxiv_id || '', title: item.title,
    url: item.url, categories: item.categories || [], tags: item.tags || [], keywords,
    added_at: new Date().toISOString(),
  };
  state.personal.hiddenPublicFavorites = state.personal.hiddenPublicFavorites.filter(id => id !== item.id);
  state.personal.keywords = uniqueKeywords([...state.personal.keywords, ...keywords]);
  savePersonal();
  closeFavoriteDialog();
  renderKeywords();
  if (state.view === 'notices') renderDailyNotices();
  else refreshPaperCardViews();
  renderHomeHub();
  showToast(`已收藏，关键词：${keywords.join('、')}`);
}

async function toggleFavorite(item, button) {
  if (state.personal.favorites[item.id]) {
    delete state.personal.favorites[item.id];
    if (hasPublicFavorite(item.id) && !state.personal.hiddenPublicFavorites.includes(item.id)) {
      state.personal.hiddenPublicFavorites.push(item.id);
    }
    savePersonal();
    const active = isFavorite(item.id);
    button.textContent = active ? '★' : '☆';
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
    if (state.view === 'notices') renderDailyNotices();
    else refreshPaperCardViews();
    renderHomeHub();
    showToast('已取消收藏，请提交到 GitHub');
    return;
  }
  if (hasPublicFavorite(item.id) && !state.personal.hiddenPublicFavorites.includes(item.id)) {
    state.personal.hiddenPublicFavorites.push(item.id);
    savePersonal();
    if (state.view === 'notices') renderDailyNotices();
    else refreshPaperCardViews();
    renderHomeHub();
    showToast('已隐藏，请提交到 GitHub');
    return;
  }
  openFavoriteDialog(item);
}

function similarity(anchor, candidate) {
  if (anchor.id === candidate.id) return -1;
  const categories = new Set(anchor.categories || []);
  const tags = new Set((anchor.tags || []).map(item => item.toLowerCase()));
  const authors = new Set((anchor.authors || []).map(item => item.toLowerCase()));
  let score = 0;
  (candidate.categories || []).forEach(value => { if (categories.has(value)) score += 5; });
  (candidate.tags || []).forEach(value => { if (tags.has(value.toLowerCase())) score += 3; });
  (candidate.authors || []).forEach(value => { if (authors.has(value.toLowerCase())) score += 4; });
  if (anchor.source === candidate.source) score += 1;
  return score;
}

function citationKey(item) {
  const doiSuffix = String(item.doi || '').split('/').pop().replace(/[^A-Za-z0-9_.:-]/g, '');
  if (doiSuffix) return doiSuffix;
  const family = (item.authors?.[0] || item.source || 'NuclearFrontier').split(/\s+/).at(-1);
  const year = (item.published || '').slice(0, 4) || 'nd';
  const word = (item.title || 'paper').match(/[A-Za-z0-9]+/)?.[0] || 'paper';
  return `${family}${year}${word}`.replace(/[^A-Za-z0-9]/g, '');
}

function citationMonth(item) {
  const month = Number((item.published || '').slice(5, 7));
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month - 1] || '';
}

function normalizedPublisher(value) {
  return String(value || '').replace(/\s*\(APS\)\s*$/, '').trim();
}

function toBibTeX(item) {
  const isPreprint = item.source_type === 'preprint' || Boolean(item.arxiv_id && !item.doi);
  const citationAuthors = item.citation_authors?.length ? item.citation_authors : item.authors;
  const journal = item.journal_abbrev || item.source;
  const month = citationMonth(item);
  const publisher = normalizedPublisher(item.publisher);
  const citationUrl = item.publisher_url || item.url;
  const fields = [
    `  title = {${String(item.title || '').replace(/\s+/g, ' ').trim()}}`,
    citationAuthors?.length ? `  author = {${citationAuthors.join(' and ')}}` : '',
    !isPreprint && journal ? `  journal = {${journal}}` : '',
    !isPreprint && item.volume ? `  volume = {${item.volume}}` : '',
    !isPreprint && item.issue ? `  issue = {${item.issue}}` : '',
    !isPreprint && item.pages ? `  pages = {${item.pages}}` : '',
    !isPreprint && item.numpages ? `  numpages = {${item.numpages}}` : '',
    item.published ? `  year = {${item.published.slice(0, 4)}}` : '',
    !isPreprint && month ? `  month = {${month}}` : '',
    !isPreprint && publisher ? `  publisher = {${publisher}}` : '',
    item.doi ? `  doi = {${item.doi}}` : '',
    isPreprint && item.arxiv_id ? `  eprint = {${item.arxiv_id}}` : '',
    isPreprint && item.arxiv_id ? '  archivePrefix = {arXiv}' : '',
    isPreprint && /^arxiv\s+/i.test(item.source || '') ? `  primaryClass = {${item.source.replace(/^arxiv\s+/i, '')}}` : '',
    citationUrl ? `  url = {${citationUrl}}` : '',
  ].filter(Boolean);
  return `@${isPreprint ? 'misc' : 'article'}{${citationKey(item)},\n${fields.join(',\n')}\n}`;
}

function citationPageCount(value) {
  const match = String(value || '').match(/^\s*(\d+)\s*[-–—]\s*(\d+)\s*$/);
  if (!match) return '';
  const first = Number(match[1]);
  const last = Number(match[2]);
  return last >= first ? String(last - first + 1) : '';
}

function decodeMetadataText(value) {
  const decoder = document.createElement('textarea');
  decoder.innerHTML = String(value || '');
  return decoder.value;
}

function crossrefCitationFields(message) {
  const pages = String(message.page || message['article-number'] || '').trim();
  return {
    citation_authors: (message.author || []).map(author => [decodeMetadataText(author.family), decodeMetadataText(author.given)].filter(Boolean).join(', ')).filter(Boolean),
    journal_abbrev: decodeMetadataText(message['short-container-title']?.[0]),
    volume: String(message.volume || ''),
    issue: String(message.issue || ''),
    pages,
    numpages: citationPageCount(message.page),
    publisher: decodeMetadataText(message.publisher),
    publisher_url: message.resource?.primary?.URL || '',
    citation_metadata_checked: true,
  };
}

function enrichCitationMetadata(item) {
  if (!item.doi || item.citation_metadata_checked) return Promise.resolve(false);
  const doi = item.doi.toLowerCase();
  if (!citationMetadataRequests.has(doi)) {
    citationMetadataRequests.set(doi, fetch(`https://api.crossref.org/works/${encodeURIComponent(item.doi)}`)
      .then(response => {
        if (!response.ok) throw new Error(`Crossref ${response.status}`);
        return response.json();
      })
      .then(payload => crossrefCitationFields(payload.message || {}))
      .catch(() => ({ citation_metadata_checked: true })));
  }
  return citationMetadataRequests.get(doi).then(metadata => {
    Object.assign(item, metadata);
    return Object.keys(metadata).some(key => key !== 'citation_metadata_checked' && metadata[key]?.length);
  });
}

function plainCitationText(value) {
  const accentMarks = { '"': '\u0308', "'": '\u0301', '`': '\u0300', '^': '\u0302', '~': '\u0303', '=': '\u0304', u: '\u0306', '.': '\u0307', v: '\u030c', H: '\u030b', c: '\u0327', k: '\u0328', r: '\u030a', b: '\u0331' };
  return String(value || '')
    .replace(/\\(["'`^~=\.uvHckrb])\{?([A-Za-z])\}?/g, (_, accent, letter) => `${letter}${accentMarks[accent] || ''}`.normalize('NFC'))
    .replace(/\\ss\b/g, 'ß')
    .replace(/\\([oOlL])\b/g, (_, letter) => ({ o: 'ø', O: 'Ø', l: 'ł', L: 'Ł' })[letter]);
}

function gbtCitationAuthors(item) {
  const authors = (item.authors || []).map(plainCitationText);
  if (!authors.length) return item.source || '责任者不详';
  if (authors.length <= 3) return authors.join(', ');
  const chinese = authors.slice(0, 3).some(author => /[\u3400-\u9fff]/.test(author));
  return `${authors.slice(0, 3).join(', ')}, ${chinese ? '等' : 'et al'}`;
}

function toGBT7714_2025(item) {
  const authors = gbtCitationAuthors(item);
  const title = String(item.title || '题名不详').replace(/\s+/g, ' ').trim();
  const published = (item.published || '').slice(0, 10);
  const year = published.slice(0, 4) || '日期不详';
  const accessed = beijingDay();
  const url = item.doi ? `https://doi.org/${item.doi}` : (item.url || '获取地址不详');
  const isPreprint = item.source_type === 'preprint' || Boolean(item.arxiv_id && !item.doi);
  if (isPreprint) {
    const platform = /^arxiv\b/i.test(item.source || '') ? 'arXiv' : (item.source || '预印本平台');
    const identifier = item.arxiv_id ? `arXiv:${item.arxiv_id}` : '';
    return `${authors}. ${title}[PP/OL]. ${platform}${published ? `(${published})` : ''}[${accessed}]. ${url}${identifier ? `. ${identifier}` : ''}.`;
  }
  const volumeIssue = `${item.volume || ''}${item.issue ? `(${item.issue})` : ''}`;
  const location = [year, volumeIssue].filter(Boolean).join(', ') + (item.pages ? `: ${item.pages}` : '');
  return `${authors}. ${title}[J/OL]. ${item.journal_abbrev || item.source || '刊名不详'}, ${location}[${accessed}]. ${url}.`;
}

function toRIS(item) {
  const lines = ['TY  - JOUR', `TI  - ${item.title}`];
  (item.authors || []).forEach(author => lines.push(`AU  - ${author}`));
  if (item.source) lines.push(`JO  - ${item.source}`);
  if (item.published) lines.push(`PY  - ${item.published.slice(0, 4)}`, `DA  - ${item.published}`);
  if (item.doi) lines.push(`DO  - ${item.doi}`);
  if (item.url) lines.push(`UR  - ${item.url}`);
  if (item.abstract) lines.push(`AB  - ${item.abstract.replace(/\s+/g, ' ')}`);
  lines.push('ER  - ');
  return lines.join('\n');
}

function downloadText(name, content, mime = 'text/plain') {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

function citationValue(item, format = $('#citationFormat')?.value || 'bibtex') {
  return format === 'gbt7714-2025' ? toGBT7714_2025(item) : toBibTeX(item);
}

function citationPanelFor(item, { compact = false } = {}) {
  const panel = document.createElement('section');
  panel.className = `inline-citation-panel${compact ? ' compact' : ''}`;
  panel.dataset.inlineCitation = item.id;
  panel.innerHTML = `
    <div class="inline-panel-head"><b>Cite / 引用</b><small>引用内容在当前位置展开</small></div>
    <label class="inline-citation-format"><span>输出格式</span><select aria-label="引用输出格式"><option value="bibtex">BibTeX</option><option value="gbt7714-2025">GB/T 7714—2025</option></select></label>
    <textarea class="inline-citation-output" readonly spellcheck="false" aria-label="引用内容"></textarea>
    <p class="inline-citation-hint"></p>
    <div class="inline-citation-actions"><a href="https://std.samr.gov.cn/gb/search/gbDetailed?id=4507EFE13D37CB6AE06397BE0A0A601F" target="_blank" rel="noreferrer">查看国家标准 ↗</a><span></span><button type="button" data-copy-citation>复制</button><button type="button" data-download-citation>下载</button></div>`;
  const format = $('select', panel);
  const output = $('.inline-citation-output', panel);
  const hint = $('.inline-citation-hint', panel);
  const render = () => {
    output.value = citationValue(item, format.value);
    hint.textContent = format.value === 'gbt7714-2025'
      ? '按 GB/T 7714—2025 和现有元数据生成；缺失的卷、期和页码不会虚构。'
      : 'BibTeX 优先包含作者、期刊、卷期、页码、出版社与 DOI；数据源没有的字段不会虚构。';
  };
  format.addEventListener('change', render);
  $('[data-copy-citation]', panel).addEventListener('click', () => copyText(citationValue(item, format.value), '引用格式已复制'));
  $('[data-download-citation]', panel).addEventListener('click', () => {
    const isBibTeX = format.value === 'bibtex';
    downloadText(`${citationKey(item)}.${isBibTeX ? 'bib' : 'txt'}`, citationValue(item, format.value), isBibTeX ? 'application/x-bibtex' : 'text/plain');
    showToast(`已下载${isBibTeX ? ' BibTeX' : ' GB/T 7714—2025 引用'}`);
  });
  render();
  return panel;
}

function enrichInlineCitation(item, rerender) {
  if (!item.doi || item.citation_metadata_checked) return;
  void enrichCitationMetadata(item).then(rerender);
}

function toggleInlineCitation(item) {
  state.inlineCitationId = state.inlineCitationId === item.id ? '' : item.id;
  refreshPaperCardViews();
  if (state.inlineCitationId === item.id) {
    enrichInlineCitation(item, () => {
      if (state.inlineCitationId === item.id) refreshPaperCardViews();
    });
  }
}

function toggleCitationPanelInHost(item, host, button) {
  const isOpen = Boolean($('[data-inline-citation]', host));
  host.replaceChildren();
  button.textContent = isOpen ? 'Cite' : '收起 Cite';
  button.setAttribute('aria-expanded', String(!isOpen));
  if (isOpen) return;
  host.append(citationPanelFor(item, { compact: true }));
  enrichInlineCitation(item, () => {
    if (!$('[data-inline-citation]', host)) return;
    host.replaceChildren(citationPanelFor(item, { compact: true }));
  });
}

function renderCitationDialog() {
  const item = state.citationDraft;
  if (!item) return;
  const format = $('#citationFormat').value;
  $('#citationOutput').value = citationValue(item, format);
  $('#citationHint').textContent = format === 'gbt7714-2025'
    ? '按 GB/T 7714—2025 和现有元数据生成；预印本使用 PP/OL，缺失的卷、期和页码不会虚构。'
    : 'BibTeX 优先包含作者、期刊、卷、期、页码、总页数、月份、出版社、DOI 与出版页面；数据源没有的字段不会虚构。';
}

function openCitationDialog(item) {
  state.citationDraft = item;
  $('#citationPaperTitle').textContent = item.title;
  $('#citationFormat').value = 'bibtex';
  renderCitationDialog();
  $('#citationDialog').showModal();
  if (item.doi && !item.citation_metadata_checked) {
    $('#citationHint').textContent = '正在从 Crossref 补全卷、期、页码、出版社和规范作者姓名……';
    void enrichCitationMetadata(item).then(() => {
      if (state.citationDraft?.id === item.id) renderCitationDialog();
    });
  }
}

function closeCitationDialog() {
  $('#citationDialog').close();
  state.citationDraft = null;
}

function downloadCitation() {
  const item = state.citationDraft;
  if (!item) return;
  const format = $('#citationFormat').value;
  const isBibTeX = format === 'bibtex';
  downloadText(
    `${citationKey(item)}.${isBibTeX ? 'bib' : 'txt'}`,
    citationValue(item, format),
    isBibTeX ? 'application/x-bibtex' : 'text/plain',
  );
  showToast(`已下载${isBibTeX ? ' BibTeX' : ' GB/T 7714—2025 引用'}`);
}

async function copyText(value, message) {
  try {
    await navigator.clipboard.writeText(value);
    showToast(message);
  } catch {
    showToast('复制失败，请手动复制');
  }
}

function exportReferenceSet() {
  const favorites = currentItems().filter(item => isFavorite(item.id));
  const items = favorites.length ? favorites : filteredItems();
  if (!items.length) return showToast('当前没有可导出的文献');
  downloadText(`小康康的物理世界-参考文献-${new Date().toISOString().slice(0, 10)}.ris`, items.map(toRIS).join('\n\n'), 'application/x-research-info-systems');
  showToast(`已导出 ${items.length} 条 RIS，可导入 Zotero`);
}

function openDetails(item) {
  markOpened(item);
  const translation = translationFor(item);
  const translated = usingTranslation(item);
  const related = allKnownPapers()
    .map(candidate => ({ candidate, score: similarity(item, candidate) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || (b.candidate.published || '').localeCompare(a.candidate.published || ''))
    .slice(0, 6);
  const host = $('#detailContent');
  host.dataset.id = item.id;
  const scoreReasons = (item.score_reasons || []).map(reason => `<span>${text(reason)}</span>`).join('');
  host.innerHTML = `
    <div class="dialog-head"><div><small>${text(item.source || '')}</small><h3>文献详情与关联</h3></div><button aria-label="关闭">×</button></div>
    <h2>${text(translated ? applyTranslationGlossary(translation.title_zh) : item.title)}</h2>
    <p class="detail-meta">${text((item.authors || []).join(', ') || item.source || '')}<br>${text(prettyDate(item.published))}${item.doi ? ` · DOI ${text(item.doi)}` : ''}</p>
    <div class="tag-row">${(item.categories || []).map(id => `<span class="tag category">${text(categoryName(id))}</span>`).join('')}</div>
    <div class="score-box"><b>重要性 ${item.importance || 0}</b><div>${scoreReasons || '<span>基于来源与主题计算</span>'}</div></div>
    <h4>${translated ? 'Codex 中文译文' : '原文摘要'}</h4>
    <p class="detail-abstract">${text(translated ? applyTranslationGlossary(translation.abstract_zh) : (item.abstract || item.summary || '该来源未提供可公开摘要。'))}</p>
    <div class="detail-tools">
      <a href="${text(item.url || '#')}" target="_blank" rel="noreferrer">打开原文 ↗</a>
      ${item.pdf_url ? `<a href="${text(item.pdf_url)}" target="_blank" rel="noreferrer">PDF ↗</a>` : ''}
      ${item.doi ? '<button id="copyDoi">复制 DOI</button>' : ''}
      <button id="openCitationFromDetail">Cite</button>
      ${translation ? `<button id="toggleDetailTranslation">${translated ? '查看英文原文' : '查看中文译文'}</button>` : ''}
      <a id="detailGoogleTranslate" class="google-translation-link" href="${text(googleTranslationPageUrl(item))}" target="_blank" rel="noreferrer">Google 翻译官网 ↗</a>
      ${item.type === 'paper' ? `<button id="openDetailNote">📝 ${state.personal.notes[item.id] ? '编辑已有笔记' : '写笔记'}</button><button id="toggleDetailIgnore" class="ignore-button${isIgnored(item.id) ? ' active' : ''}">${isIgnored(item.id) ? '恢复论文' : '忽略论文'}</button>` : ''}
    </div>
    <div class="detail-inline-citation" data-detail-citation></div>
    ${item.type === 'paper' ? '<p class="note-privacy">笔记提交后将写入 GitHub 并公开展示。</p>' : ''}
    <h4>关联文献</h4>
    <div class="related-list">${related.length ? related.map(({ candidate, score }) => `<a class="related-item" href="${text(candidate.url)}" target="_blank" rel="noreferrer">${text(candidate.title)}<small>${text(candidate.source)} · 关联度 ${score}</small></a>`).join('') : '<p>当前历史库中尚无明显关联文献。</p>'}</div>
  `;
  $('.dialog-head button', host).addEventListener('click', () => $('#detailDialog').close());
  $('#copyDoi', host)?.addEventListener('click', () => copyText(item.doi, 'DOI 已复制'));
  $('#toggleDetailTranslation', host)?.addEventListener('click', () => {
    if (translated) state.translatedIds.delete(item.id);
    else state.translatedIds.add(item.id);
    refreshPaperCardViews();
    openDetails(item);
  });
  $('#openCitationFromDetail', host).addEventListener('click', event => toggleCitationPanelInHost(item, $('[data-detail-citation]', host), event.currentTarget));
  $('#openDetailNote', host)?.addEventListener('click', () => {
    $('#detailDialog').close();
    state.inlineNoteId = item.id;
    refreshPaperCardViews();
    focusInlineNote(item);
  });
  $('#toggleDetailIgnore', host)?.addEventListener('click', () => {
    $('#detailDialog').close();
    toggleIgnored(item);
  });
  if (!$('#detailDialog').open) $('#detailDialog').showModal();
}

function renderCategories() {
  const counts = new Map();
  const categoryItems = state.view === 'news' ? state.news
    : (state.view === 'papers' && state.globalKeyword ? state.historyResults : state.papers);
  categoryItems.forEach(item => (item.categories || []).forEach(id => counts.set(id, (counts.get(id) || 0) + 1)));
  $('#researchFieldTitle').textContent = state.view === 'news' ? '新闻领域' : '研究领域';
  const host = $('#categoryList');
  host.replaceChildren();
  const all = document.createElement('button');
  all.className = 'category-button';
  all.dataset.category = 'all';
  all.innerHTML = `<span class="cat-icon">◎</span><span>${state.view === 'news' ? '全部新闻' : '全部领域'}</span><span class="cat-count">${categoryItems.length}</span>`;
  all.classList.toggle('active', state.category === 'all');
  host.append(all);

  const knownIds = new Set(state.meta.categories.map(category => category.id));
  const orderedIds = [...new Set([
    ...state.paperLayout.categoryOrder.filter(id => knownIds.has(id)),
    ...DEFAULT_CATEGORY_ORDER.filter(id => knownIds.has(id)),
    ...state.meta.categories.map(category => category.id),
  ])];
  state.paperLayout.categoryOrder = orderedIds;
  state.paperLayout.hiddenCategories = state.paperLayout.hiddenCategories.filter(id => knownIds.has(id));
  const hidden = new Set(state.paperLayout.hiddenCategories);
  const byId = new Map(state.meta.categories.map(category => [category.id, category]));

  orderedIds.filter(id => !hidden.has(id) && (state.view !== 'news' || counts.get(id))).forEach(id => {
    const category = byId.get(id);
    if (!category) return;
    const row = document.createElement('div');
    row.className = 'category-row';
    row.dataset.categoryRow = category.id;
    row.draggable = state.layoutEditing;
    const button = document.createElement('button');
    button.className = 'category-button';
    button.dataset.category = category.id;
    button.innerHTML = `<span class="cat-icon">${text(category.icon)}</span><span>${text(category.name)}</span><span class="cat-count">${counts.get(category.id) || 0}</span>`;
    button.classList.toggle('active', state.category === category.id);
    button.addEventListener('click', () => setCategory(category.id));
    const actions = document.createElement('span');
    actions.className = 'category-edit-actions';
    actions.innerHTML = `<button type="button" data-category-move="-1" aria-label="上移 ${text(category.name)}">↑</button><button type="button" data-category-move="1" aria-label="下移 ${text(category.name)}">↓</button><button type="button" data-category-hide aria-label="隐藏 ${text(category.name)}">−</button>`;
    $$('[data-category-move]', actions).forEach(control => control.addEventListener('click', () => moveCategory(category.id, Number(control.dataset.categoryMove))));
    $('[data-category-hide]', actions).addEventListener('click', () => hideCategory(category.id));
    row.append(button, actions);
    bindCategoryDrag(row);
    host.append(row);
  });
  all.addEventListener('click', () => setCategory('all'));
  renderHiddenCategories(byId);
  renderFilterModuleOrder();
}

function moveCategory(id, direction) {
  const visible = state.paperLayout.categoryOrder.filter(value => !state.paperLayout.hiddenCategories.includes(value));
  const from = visible.indexOf(id);
  const target = from + direction;
  if (from < 0 || target < 0 || target >= visible.length) return;
  const targetId = visible[target];
  const all = [...state.paperLayout.categoryOrder];
  const fromAll = all.indexOf(id);
  const targetAll = all.indexOf(targetId);
  [all[fromAll], all[targetAll]] = [all[targetAll], all[fromAll]];
  state.paperLayout.categoryOrder = all;
  savePaperLayout();
  renderCategories();
}

function hideCategory(id) {
  if (!state.paperLayout.hiddenCategories.includes(id)) state.paperLayout.hiddenCategories.push(id);
  if (state.category === id) state.category = 'all';
  savePaperLayout();
  renderCategories();
  renderCards();
}

function restoreCategory(id) {
  state.paperLayout.hiddenCategories = state.paperLayout.hiddenCategories.filter(value => value !== id);
  savePaperLayout();
  renderCategories();
}

function renderHiddenCategories(byId) {
  const host = $('#hiddenCategoryList');
  const items = state.paperLayout.hiddenCategories.map(id => byId.get(id)).filter(Boolean);
  host.hidden = !state.layoutEditing || !items.length;
  host.replaceChildren();
  if (!items.length) return;
  const title = document.createElement('span');
  title.textContent = '已隐藏领域 · 点击恢复';
  host.append(title, ...items.map(category => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `+ ${category.name}`;
    button.addEventListener('click', () => restoreCategory(category.id));
    return button;
  }));
}

function bindCategoryDrag(row) {
  row.addEventListener('dragstart', event => {
    if (!state.layoutEditing) return event.preventDefault();
    state.draggedCategory = row.dataset.categoryRow;
    row.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
  });
  row.addEventListener('dragend', () => {
    state.draggedCategory = '';
    $$('.category-row').forEach(item => item.classList.remove('dragging', 'drag-over'));
  });
  row.addEventListener('dragover', event => {
    if (!state.draggedCategory || state.draggedCategory === row.dataset.categoryRow) return;
    event.preventDefault();
    row.classList.add('drag-over');
  });
  row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
  row.addEventListener('drop', event => {
    event.preventDefault();
    const target = row.dataset.categoryRow;
    const from = state.paperLayout.categoryOrder.indexOf(state.draggedCategory);
    const to = state.paperLayout.categoryOrder.indexOf(target);
    if (from < 0 || to < 0 || from === to) return;
    const order = [...state.paperLayout.categoryOrder];
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    state.paperLayout.categoryOrder = order;
    savePaperLayout();
    renderCategories();
  });
}

function renderFilterModuleOrder() {
  const host = $('#filterModules');
  const valid = new Set(DEFAULT_FILTER_MODULE_ORDER);
  state.paperLayout.moduleOrder = [...new Set([
    ...state.paperLayout.moduleOrder.filter(id => valid.has(id)),
    ...DEFAULT_FILTER_MODULE_ORDER,
  ])];
  state.paperLayout.moduleOrder.forEach(id => {
    const module = $(`[data-filter-module="${id}"]`, host);
    if (module) host.append(module);
  });
}

function moveFilterModule(id, direction) {
  const order = [...state.paperLayout.moduleOrder];
  const from = order.indexOf(id);
  const target = from + direction;
  if (from < 0 || target < 0 || target >= order.length) return;
  [order[from], order[target]] = [order[target], order[from]];
  state.paperLayout.moduleOrder = order;
  savePaperLayout();
  renderFilterModuleOrder();
}

function toggleLayoutEditing() {
  state.layoutEditing = !state.layoutEditing;
  document.body.classList.toggle('layout-editing', state.layoutEditing);
  $('#editFilterLayout').setAttribute('aria-pressed', String(state.layoutEditing));
  $('#editFilterLayout').textContent = state.layoutEditing ? '完成' : '编辑排列';
  $('#layoutEditHint').hidden = !state.layoutEditing;
  $('#resetFilterLayout').hidden = !state.layoutEditing;
  renderCategories();
}

function resetFilterLayout() {
  state.paperLayout = { categoryOrder: [...DEFAULT_CATEGORY_ORDER], hiddenCategories: [], moduleOrder: [...DEFAULT_FILTER_MODULE_ORDER] };
  savePaperLayout();
  renderCategories();
  showToast('已恢复核物理默认排列');
}

function renderSpotlight() {
  const item = [...state.featured].sort(compareNuclearFirst)[0] || [...state.papers].sort(compareNuclearFirst)[0];
  if (!item) {
    $('#spotlight').innerHTML = '<div class="spotlight-head"><span>EDITOR\'S RADAR</span><b>今日焦点</b></div><p>等待首次数据更新。</p>';
    return;
  }
  $('#spotlight').innerHTML = `
    <div class="spotlight-head"><span>EDITOR'S RADAR</span><b>今日焦点</b></div>
    <div class="spotlight-body">
      <span class="spotlight-source">${text(item.source_short || item.source)} · ${text(categoryName(item.categories?.[0]))}</span>
      <h2>${text(item.title)}</h2>
      <p>${text(item.abstract || '该来源未提供可公开摘要。')}</p>
      <div class="spotlight-foot"><span>${text(prettyDate(item.published))} · 重要性 ${item.importance || 0}</span><a href="${text(item.url)}" target="_blank" rel="noreferrer">阅读原文 ↗</a></div>
    </div>`;
}

function assistantFilterLabels() {
  const labels = [];
  if (state.category !== 'all') labels.push(categoryName(state.category));
  if (state.source !== 'all') labels.push(state.source);
  if (state.query.trim()) labels.push(`搜索：${state.query.trim()}`);
  if (state.globalKeyword && state.view === 'papers') labels.push(`全库关键词：${state.globalKeyword}`);
  if (state.view === 'papers') labels.push($('#scopeSelect')?.selectedOptions[0]?.textContent || '全部时间');
  if (state.searchField !== 'all') labels.push($('#searchFieldSelect')?.selectedOptions[0]?.textContent || '指定字段');
  return labels;
}

function matchedTerms(value, vocabulary) {
  const haystack = String(value || '').toLowerCase();
  return vocabulary.filter(item => item.patterns.some(pattern => pattern.test(haystack))).map(item => item.label);
}

function extractNuclides(item) {
  const value = [item.title, item.abstract, ...(item.tags || [])].join(' ');
  const results = [];
  const patterns = [/\^\{(\d{1,3})\}\$?\s*([A-Z][a-z]?)/g, /\b(\d{1,3})([A-Z][a-z])\b/g];
  patterns.forEach(pattern => {
    for (const match of value.matchAll(pattern)) results.push(`${match[1]}${match[2]}`);
  });
  return [...new Set(results)].slice(0, 8);
}

function extractPaperFacts(item) {
  const value = [item.title, item.abstract, ...(item.tags || [])].join(' ');
  const reactions = matchedTerms(value, [
    { label: '电子俘获', patterns: [/electron capture/] },
    { label: 'β 衰变', patterns: [/beta decay/, /\\beta\s*decay/] },
    { label: '双β衰变', patterns: [/double beta/, /0\s*nu\s*beta/] },
    { label: '核裂变', patterns: [/\bfission\b/] },
    { label: '敲出反应', patterns: [/knockout/, /knock-out/] },
    { label: '准自由散射', patterns: [/quasifree/, /quasi-free/] },
    { label: '中子俘获', patterns: [/neutron capture/, /\(n,\s*(?:gamma|γ)\)/] },
    { label: '重离子碰撞', patterns: [/heavy-ion collision/, /heavy ion collision/] },
    { label: '弹性/非弹性散射', patterns: [/inelastic scattering/, /elastic scattering/] },
  ]);
  const detectors = matchedTerms(value, [
    { label: 'HPGe/锗探测器', patterns: [/high-purity germanium/, /hpge/, /germanium detector/] },
    { label: '硅漂移探测器', patterns: [/silicon drift detector/] },
    { label: '硅探测器', patterns: [/silicon detector/] },
    { label: '闪烁体', patterns: [/scintillator/, /scintillation detector/] },
    { label: 'SiPM', patterns: [/sipm/, /silicon photomultiplier/] },
    { label: '时间投影室 TPC', patterns: [/time projection chamber/, /\btpc\b/] },
    { label: 'CMOS 轨迹探测器', patterns: [/\bcmos\b/] },
    { label: '中子探测器', patterns: [/neutron detector/] },
    { label: 'γ 谱仪', patterns: [/gamma-ray detector/, /gamma spectrometer/, /γ-ray detector/] },
  ]);
  const facilities = matchedTerms(value, [
    { label: 'LEGEND', patterns: [/\blegend\b/] }, { label: 'CERN/LHC', patterns: [/\bcern\b/, /\blhc\b/] },
    { label: 'RHIC', patterns: [/\brhic\b/] }, { label: 'FAIR/GSI', patterns: [/\bfair\b/, /\bgsi\b/] },
    { label: 'FRIB', patterns: [/\bfrib\b/] }, { label: 'RIKEN/RIBF', patterns: [/\briken\b/, /\bribf\b/] },
    { label: 'HIRFL/RIBLL', patterns: [/\bhirfl\b/, /\bribll\b/] }, { label: 'GANIL', patterns: [/\bganil\b/] },
    { label: 'JLab', patterns: [/\bjlab\b/, /jefferson lab/] }, { label: 'ITER', patterns: [/\biter\b/] },
  ]);
  const observables = matchedTerms(value, [
    { label: '半衰期', patterns: [/half-life/] }, { label: '分支比', patterns: [/branching ratio/] },
    { label: '反应截面', patterns: [/cross section/] }, { label: '能谱/谱函数', patterns: [/energy spectrum/, /spectral function/] },
    { label: '角分布', patterns: [/angular distribution/] }, { label: '核矩阵元', patterns: [/nuclear matrix element/] },
    { label: '动量分布', patterns: [/momentum distribution/] }, { label: '质量与半径', patterns: [/mass.radius/, /mass--radius/] },
    { label: '流系数', patterns: [/flow coefficient/] }, { label: '能量分辨率', patterns: [/energy resolution/] },
  ]);
  const methodLabels = { experimental: '实验测量', theoretical: '理论计算', review: '综述' };
  const models = matchedTerms(value, [
    { label: 'HFB', patterns: [/hartree-fock-bogoliubov/, /\bhfb\b/] }, { label: 'DFT', patterns: [/density functional theory/, /\bdft\b/] },
    { label: '壳模型', patterns: [/shell model/] }, { label: 'DWIA', patterns: [/\bdwia\b/] },
    { label: 'Glauber 模型', patterns: [/glauber/] }, { label: '输运模型', patterns: [/transport model/] },
    { label: '机器学习', patterns: [/machine learning/, /neural network/, /neural operator/] },
  ]);
  return {
    nuclides: extractNuclides(item), reactions, detectors, facilities, observables,
    methods: [...new Set([...(item.methods || []).map(value => methodLabels[value] || value), ...models])],
  };
}

function paperFactRow(label, values) {
  const items = values?.length ? values : ['未从摘要识别'];
  return `<div class="paper-fact-row"><dt>${text(label)}</dt><dd>${items.map(value => `<span${value === '未从摘要识别' ? ' class="missing"' : ''}>${text(value)}</span>`).join('')}</dd></div>`;
}

function renderAssistantNewsDetail(item) {
  const host = $('#assistantPaperDetail');
  const related = state.news
    .filter(candidate => candidate.id !== item.id)
    .map(candidate => ({ candidate, score: similarity(item, candidate) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || (b.candidate.published || '').localeCompare(a.candidate.published || ''))
    .slice(0, 5);
  const reasons = (item.score_reasons || []).slice(0, 4);
  host.innerHTML = `
    <header class="selected-paper-head selected-news-head">
      <span>${text(item.source || '官方新闻')} · ${text(prettyDate(item.published))}</span>
      <h3>${text(localizedTitle(item))}</h3>
    </header>
    <section class="assistant-section paper-detail-section">
      <div class="assistant-section-head"><span>新闻信息</span><small>来自官方原始页面</small></div>
      <dl class="paper-meta-grid">
        <div><dt>类型</dt><dd>官方科研新闻</dd></div>
        <div><dt>重要性</dt><dd>${Number(item.importance || 0)}</dd></div>
        <div><dt>发布日期</dt><dd>${text(prettyDate(item.published))}</dd></div>
        <div><dt>收藏状态</dt><dd>${isFavorite(item.id) ? '已收藏' : '未收藏'}</dd></div>
      </dl>
      <div class="tag-row">${(item.categories || []).map(id => `<span class="tag category">${text(categoryName(id))}</span>`).join('')}</div>
    </section>
    <section class="assistant-section paper-detail-section">
      <div class="assistant-section-head"><span>完整介绍</span><small>优先显示中文译文</small></div>
      <p class="assistant-news-summary">${text(localizedDescription(item))}</p>
      <div class="assistant-news-actions"><a href="${text(item.url || '#')}" target="_blank" rel="noreferrer">阅读官方原文 ↗</a><button type="button" data-news-favorite>${isFavorite(item.id) ? '★ 已收藏' : '☆ 收藏'}</button></div>
    </section>
    <section class="assistant-section paper-detail-section">
      <div class="assistant-section-head"><span>为什么值得关注</span><small>可解释评分</small></div>
      <ul class="paper-reason-list">${reasons.length ? reasons.map(reason => `<li>${text(reason)}</li>`).join('') : '<li>当前暂无评分理由。</li>'}</ul>
    </section>
    <section class="assistant-section paper-detail-section">
      <div class="assistant-section-head"><span>相关新闻</span><small>按领域与标签匹配</small></div>
      <div class="assistant-related-list">${related.length ? related.map(({ candidate, score }) => `<button type="button" data-related-news="${text(candidate.id)}"><span>${text(localizedTitle(candidate))}</span><small>${text(candidate.source)} · 关联度 ${score}</small></button>`).join('') : '<p>暂无明显相关新闻。</p>'}</div>
    </section>`;
  $('[data-news-favorite]', host).addEventListener('click', event => void toggleFavorite(item, event.currentTarget));
  $$('[data-related-news]', host).forEach(button => button.addEventListener('click', () => {
    const candidate = state.news.find(value => value.id === button.dataset.relatedNews);
    if (candidate) selectPaperForAssistant(candidate);
  }));
}

function renderAssistantPaperDetail(item) {
  if (item.type === 'news') return renderAssistantNewsDetail(item);
  const host = $('#assistantPaperDetail');
  const facts = extractPaperFacts(item);
  const related = allKnownPapers()
    .map(candidate => ({ candidate, score: similarity(item, candidate) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || (b.candidate.published || '').localeCompare(a.candidate.published || ''))
    .slice(0, 4);
  const identifiers = [item.doi ? `DOI ${item.doi}` : '', item.arxiv_id ? `arXiv ${item.arxiv_id}` : ''].filter(Boolean);
  const access = item.open_access ? '开放获取' : '请以原文页面为准';
  const scoreReasons = (item.score_reasons || []).slice(0, 4);
  host.innerHTML = `
    <header class="selected-paper-head">
      <span>${text(item.source_short || item.source)} · ${text(prettyDate(item.published))}</span>
      <p>${text((item.authors || []).slice(0, 5).join(', ') || '作者信息未提供')}${(item.authors || []).length > 5 ? ` 等 ${item.authors.length} 人` : ''}</p>
    </header>
    <section class="assistant-section paper-detail-section">
      <div class="assistant-section-head"><span>基础信息</span><small>来自原始元数据</small></div>
      <dl class="paper-meta-grid">
        <div><dt>类型</dt><dd>${item.source_type === 'preprint' ? '预印本' : '期刊论文'}</dd></div>
        <div><dt>重要性</dt><dd>${Number(item.importance || 0)}</dd></div>
        <div><dt>开放状态</dt><dd>${text(access)}</dd></div>
        <div><dt>阅读状态</dt><dd>${text(readingLabel(item.id))}</dd></div>
        <div><dt>摘要来源</dt><dd>${text(abstractSourceLabel(item))}</dd></div>
      </dl>
      <div class="paper-identifiers">${identifiers.length ? identifiers.map(value => `<span>${text(value)}</span>`).join('') : '<span>暂无 DOI/arXiv 编号</span>'}</div>
    </section>
    <section class="assistant-section paper-detail-section">
      <div class="assistant-section-head"><span>摘要与操作</span><small>优先展示已有中文译文</small></div>
      <p class="assistant-paper-summary">${text(localizedAbstract(item) || missingAbstractMessage(item))}</p>
      <div class="assistant-paper-actions">
        <a href="${text(item.url || '#')}" target="_blank" rel="noreferrer">原始页面 ↗</a>
        ${item.pdf_url ? `<a href="${text(item.pdf_url)}" target="_blank" rel="noreferrer">PDF ↗</a>` : ''}
        <button type="button" class="zotero-button" data-zotero-save="${text(item.id)}">${text(zoteroButtonLabel(item))}</button>
        <button type="button" data-assistant-note>📝 ${state.personal.notes[item.id] ? '编辑笔记' : '写笔记'}</button>
        <button type="button" class="ignore-button${isIgnored(item.id) ? ' active' : ''}" data-assistant-ignore>${isIgnored(item.id) ? '恢复论文' : '忽略'}</button>
      </div>
      <div data-zotero-panel-host></div>
      <button type="button" class="assistant-cite-button" data-assistant-cite aria-expanded="false">Cite</button>
      <div class="assistant-inline-citation" data-assistant-citation></div>
    </section>
    <section class="assistant-section paper-detail-section">
      <div class="assistant-section-head"><span>核物理要素</span><small>仅提取题目与摘要明确内容</small></div>
      <dl class="paper-fact-list">
        ${paperFactRow('核素', facts.nuclides)}
        ${paperFactRow('反应/过程', facts.reactions)}
        ${paperFactRow('探测器', facts.detectors)}
        ${paperFactRow('装置/机构', facts.facilities)}
        ${paperFactRow('方法/模型', facts.methods)}
        ${paperFactRow('可观测量', facts.observables)}
      </dl>
    </section>
    <section class="assistant-section paper-detail-section">
      <div class="assistant-section-head"><span>为什么值得看</span><small>可解释评分</small></div>
      <ul class="paper-reason-list">${scoreReasons.length ? scoreReasons.map(reason => `<li>${text(reason)}</li>`).join('') : '<li>当前暂无评分理由。</li>'}</ul>
    </section>
    <section class="assistant-section paper-detail-section">
      <div class="assistant-section-head"><span>关联论文</span><small>按分类、标签、作者匹配</small></div>
      <div class="assistant-related-list">${related.length ? related.map(({ candidate, score }) => `<button type="button" data-related-paper="${text(candidate.id)}"><span>${text(candidate.title)}</span><small>${text(candidate.source_short || candidate.source)} · 关联度 ${score}</small></button>`).join('') : '<p>历史库中暂无明显关联论文。</p>'}</div>
    </section>`;
  $('[data-assistant-cite]', host).addEventListener('click', event => toggleCitationPanelInHost(item, $('[data-assistant-citation]', host), event.currentTarget));
  $('[data-zotero-save]', host).addEventListener('click', () => void openZoteroClassification(item));
  const assistantZoteroPanel = zoteroClassificationPanelFor(item);
  if (assistantZoteroPanel) $('[data-zotero-panel-host]', host).append(assistantZoteroPanel);
  updateZoteroButtons(item);
  $('[data-assistant-note]', host).addEventListener('click', () => {
    closePaperAssistant();
    state.inlineNoteId = item.id;
    refreshPaperCardViews();
    focusInlineNote(item);
  });
  $('[data-assistant-ignore]', host).addEventListener('click', () => toggleIgnored(item));
  $$('[data-related-paper]', host).forEach(button => button.addEventListener('click', () => {
    const candidate = allKnownPapers().find(value => value.id === button.dataset.relatedPaper);
    if (candidate) selectPaperForAssistant(candidate);
  }));
}

function renderPaperAssistant(items = filteredItems()) {
  if (!$('#assistantMetrics')) return;
  const favorites = items.filter(item => isFavorite(item.id)).length;
  const matched = items.filter(personalMatch).length;
  const notes = items.filter(item => Boolean(state.personal.notes[item.id]?.trim())).length;
  $('#assistantMetrics').innerHTML = [
    ['当前结果', items.length], ['已收藏', favorites], ['关注词命中', matched], ['有笔记', notes],
  ].map(([label, value]) => `<div class="assistant-metric"><span>${label}</span><b>${Number(value).toLocaleString('zh-CN')}</b></div>`).join('');

  const labels = assistantFilterLabels();
  $('#assistantFilters').innerHTML = labels.length
    ? labels.map(label => `<span class="assistant-chip">${text(label)}</span>`).join('')
    : '<span class="assistant-chip empty">尚未限制筛选条件</span>';

  const counts = new Map();
  items.forEach(item => (item.categories || []).forEach(id => counts.set(id, (counts.get(id) || 0) + 1)));
  const topics = [...counts.entries()].sort((a, b) => b[1] - a[1] || (NUCLEAR_PRIORITY.get(b[0]) || 0) - (NUCLEAR_PRIORITY.get(a[0]) || 0)).slice(0, 5);
  const max = Math.max(1, ...topics.map(([, count]) => count));
  $('#assistantTopics').innerHTML = topics.length ? topics.map(([id, count]) => `
    <div class="assistant-topic"><span>${text(categoryName(id))}</span><b>${count}</b><i style="--topic-width:${Math.max(8, count / max * 100).toFixed(1)}%"></i></div>`).join('')
    : '<span class="assistant-chip empty">当前没有可统计的主题</span>';

  const favoriteIds = new Set([...Object.keys(state.personal.favorites), ...state.publicFavorites.map(item => typeof item === 'string' ? item : item.id)]);
  $('#assistantFavoriteTotal').textContent = favoriteIds.size.toLocaleString('zh-CN');
  $('#assistantUnreadTotal').textContent = state.papers.filter(item => state.personal.readStatus[item.id] !== 'read').length.toLocaleString('zh-CN');
  $('#assistantDailyTotal').textContent = `${state.notices.length + state.news.length}`;

  const selected = state.selectedPaperId ? [...allKnownPapers(), ...state.news].find(item => item.id === state.selectedPaperId) : null;
  $('#assistantOverview').hidden = Boolean(selected);
  $('#assistantPaperDetail').hidden = !selected;
  $('#assistantBackToOverview').hidden = !selected;
  $('#assistantKicker').textContent = selected ? (selected.type === 'news' ? 'SELECTED NEWS' : 'SELECTED PAPER') : 'PAPER COMPANION';
  $('#assistantTitle').textContent = selected ? (selected.type === 'news' ? '新闻信息' : '论文信息') : '论文助手';
  $('#assistantIntro').textContent = selected
    ? (selected.type === 'news' ? '右侧展示官方来源、完整介绍、分类与相关新闻。' : '右侧只展示原始元数据与从题目、摘要中明确识别的科研要素。')
    : '解释当前筛选结果与已选内容。';
  if (selected) renderAssistantPaperDetail(selected);
}

function selectPaperForAssistant(item) {
  state.selectedPaperId = item.id;
  refreshPaperCardViews();
  openPaperAssistant();
}

function showAssistantOverview() {
  state.selectedPaperId = '';
  refreshPaperCardViews();
}

function openPaperAssistant() {
  if (window.matchMedia('(min-width: 561px)').matches) {
    $('#openPaperAssistant').setAttribute('aria-expanded', 'true');
    return;
  }
  document.body.classList.add('paper-assistant-open');
  $('#openPaperAssistant').setAttribute('aria-expanded', 'true');
  window.setTimeout(() => $('#closePaperAssistant').focus(), 30);
}

function closePaperAssistant() {
  document.body.classList.remove('paper-assistant-open');
  $('#openPaperAssistant').setAttribute('aria-expanded', 'false');
}

function clearPaperFilters() {
  state.category = 'all';
  state.source = 'all';
  state.query = '';
  state.searchField = 'all';
  state.scope = 'all';
  $('#searchInput').value = '';
  $('#searchFieldSelect').value = 'all';
  $('#scopeSelect').value = 'all';
  $('#sourceSelect').value = 'all';
  clearGlobalKeywordSearch({ render: false });
  renderCategories();
  renderSourceOptions();
  updateMySpaceUI();
  renderCards();
  showToast('已清除论文筛选');
}

function homeJournalLabel(item) {
  const values = [item.source, item.source_short].map(value => String(value || '').trim().toLowerCase());
  for (const value of values) {
    if (HOME_FEATURED_JOURNALS.has(value)) return HOME_FEATURED_JOURNALS.get(value);
  }
  return '';
}

function homeFeedCard(item, type) {
  const link = document.createElement('a');
  link.className = `home-feed-card ${type}`;
  link.href = item.url || '#';
  link.target = '_blank';
  link.rel = 'noreferrer';
  const timing = type === 'notice' && item.deadline
    ? `截止 ${prettyDate(item.deadline)}`
    : prettyDate(item.published);
  link.innerHTML = `
    <small><span>${text(timing || '日期待确认')}</span><b>${text(item.source || '官方来源')}</b></small>
    <h3>${text(localizedTitle(item))}</h3>
    ${(item.summary || item.abstract) ? `<p>${text(localizedAbstract(item))}</p>` : ''}`;
  return link;
}

function homeFeaturedCard(item) {
  const article = cardFor(item);
  article.classList.add('home-featured-paper-card');
  return article;
}

function renderHomeDashboard() {
  const news = [...state.news]
    .sort((a, b) => (b.published || '').localeCompare(a.published || '')
      || Number(isPrimaryNuclear(b)) - Number(isPrimaryNuclear(a))
      || (b.importance || 0) - (a.importance || 0))
    .slice(0, 30);
  const notices = [...state.notices]
    .sort((a, b) => Number(['open', 'soon'].includes(deadlineState(b).kind)) - Number(['open', 'soon'].includes(deadlineState(a).kind))
      || (b.published || '').localeCompare(a.published || '')
      || (b.importance || 0) - (a.importance || 0))
    .slice(0, 30);
  const seen = new Set();
  const ignored = new Set(state.personal.ignoredItems);
  const featured = [...state.papers]
    .filter(item => !ignored.has(item.id))
    .filter(item => homeJournalLabel(item))
    .filter(item => {
      const key = item.doi || item.id || `${item.source}:${item.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (b.published || '').localeCompare(a.published || '')
      || Number(isPrimaryNuclear(b)) - Number(isPrimaryNuclear(a))
      || (b.importance || 0) - (a.importance || 0))
    .slice(0, 24);

  $('#homeNewsCount').textContent = `${state.news.length.toLocaleString('zh-CN')} 条`;
  $('#homeNoticeCount').textContent = `${state.notices.length.toLocaleString('zh-CN')} 条`;
  $('#homeNewsList').replaceChildren(...news.map(item => homeFeedCard(item, 'news')));
  $('#homeNoticeList').replaceChildren(...notices.map(item => homeFeedCard(item, 'notice')));
  $('#homeFeaturedList').replaceChildren(...featured.map(homeFeaturedCard));

  if (!news.length) $('#homeNewsList').innerHTML = '<p class="home-feed-empty">等待下一次自动更新。</p>';
  if (!notices.length) $('#homeNoticeList').innerHTML = '<p class="home-feed-empty">等待下一次自动更新。</p>';
  if (!featured.length) $('#homeFeaturedList').innerHTML = '<p class="home-feed-empty">五种重点期刊暂时没有可展示的新文章。</p>';
}

function noticeGroup(item) {
  const category = String(item.notice_category || '');
  if (category.startsWith('meetings')) return 'meeting';
  if (category.startsWith('beam')) return 'beam';
  return 'funding';
}

function noticeOfficialText(item) {
  return String(item.content || item.summary || '').trim();
}

function selectNotice(item) {
  state.selectedNoticeId = item.id;
  renderDailyNotices();
}

function renderNoticeDetail(item) {
  const host = $('#noticeDetailPanel');
  if (!item) {
    host.innerHTML = '<div class="notice-detail-empty"><span>✿</span><b>通知详细信息</b><p>选择一条通知后，这里将显示官方介绍、时间与链接。</p></div>';
    return;
  }
  const group = NOTICE_GROUPS.find(value => value.id === noticeGroup(item)) || NOTICE_GROUPS[0];
  const category = noticeCategoryInfo(item.notice_category);
  const original = noticeOfficialText(item) || '官方列表页暂未提供可提取的介绍，请打开原文核对。';
  const translated = translationFor(item);
  host.innerHTML = `
    <header class="notice-detail-head"><span>${text(group.icon)} ${text(group.label)}</span><small>${text(category.label)}</small></header>
    <h2>${text(localizedTitle(item))}</h2>
    <div class="notice-detail-meta"><b>${text(item.source || '官方来源')}</b><time>${text(prettyDate(item.published))}</time>${item.deadline ? `<strong>截止 ${text(prettyDate(item.deadline))}</strong>` : ''}</div>
    ${translated?.abstract_zh ? `<section><h3>中文介绍</h3><p>${text(applyTranslationGlossary(translated.abstract_zh))}</p></section>` : ''}
    <section><h3>官方原文信息</h3><p>${text(original)}</p></section>
    <div class="notice-detail-tags">${(item.categories || []).map(id => `<span>${text(categoryName(id))}</span>`).join('')}<span>${text(item.scope || category.description || '')}</span></div>
    <div class="notice-detail-actions"><a href="${text(item.url || '#')}" target="_blank" rel="noreferrer">查看官方原文 ↗</a><button type="button" data-notice-favorite>${isFavorite(item.id) ? '★ 已收藏' : '☆ 收藏'}</button><a href="${text(googleTranslationPageUrl(item))}" target="_blank" rel="noreferrer">Google 翻译官网 ↗</a></div>`;
  $('[data-notice-favorite]', host).addEventListener('click', event => void toggleFavorite(item, event.currentTarget));
}

function dailyNoticeCard(item) {
  const article = document.createElement('article');
  article.className = 'daily-notice-card';
  const category = noticeCategoryInfo(item.notice_category);
  const deadline = deadlineState(item);
  const runDay = beijingDay(state.meta?.status?.last_success || new Date());
  const isFresh = noticeFirstSeenDay(item) === runDay;
  const deadlineLabel = deadline.kind === 'closed'
    ? `已截止 ${prettyDate(item.deadline)}`
    : deadline.days === 0 ? '今日截止'
      : deadline.days === 1 ? '明日截止'
        : deadline.days !== null ? `还有 ${deadline.days} 天截止` : '';
  article.dataset.category = category.id;
  article.classList.toggle('selected', state.selectedNoticeId === item.id);
  const original = noticeOfficialText(item);
  const expanded = state.expandedNoticeIds.has(item.id);
  const excerpt = original
    ? (expanded ? original : truncate(original, 360))
    : '官方列表页暂未提供介绍，请打开原文查看申请条件、时间和附件。';
  article.innerHTML = `
    <div class="daily-notice-card-top">
      <span class="notice-kind">${text((NOTICE_GROUPS.find(value => value.id === noticeGroup(item)) || NOTICE_GROUPS[0]).icon)} ${text((NOTICE_GROUPS.find(value => value.id === noticeGroup(item)) || NOTICE_GROUPS[0]).label)} · ${text(category.label)}</span>
      <div>${isFresh ? '<b class="notice-fresh">今日发现</b>' : ''}${deadlineLabel ? `<b class="notice-deadline ${text(deadline.kind)}">${text(deadlineLabel)}</b>` : ''}<button type="button" class="notice-favorite-button" aria-label="收藏通知">${isFavorite(item.id) ? '★' : '☆'}</button></div>
    </div>
    <h3><button type="button" class="notice-title-button">${text(localizedTitle(item))}</button></h3>
    <div class="notice-original-preview"><b>官方原文信息</b><p>${text(excerpt)}</p>${original.length > 360 ? `<button type="button" class="notice-expand">${expanded ? '收起原文' : '展开全部信息'}</button>` : ''}</div>
    <footer>
      <div><b>${text(item.source || '官方来源')}</b><span>${text(item.scope || '')}</span><time>${text(prettyDate(item.published))}</time></div>
      <span class="daily-notice-links"><button type="button" class="notice-detail-button">右侧查看详情</button><a href="${text(item.url || '#')}" target="_blank" rel="noreferrer">官方原文 ↗</a><a href="${text(googleTranslationPageUrl(item))}" target="_blank" rel="noreferrer" class="google-translation-link">Google 翻译官网 ↗</a></span>
    </footer>`;
  $('.notice-title-button', article).addEventListener('click', () => selectNotice(item));
  $('.notice-detail-button', article).addEventListener('click', () => selectNotice(item));
  $('.notice-favorite-button', article).addEventListener('click', event => void toggleFavorite(item, event.currentTarget));
  $('.notice-expand', article)?.addEventListener('click', () => {
    if (expanded) state.expandedNoticeIds.delete(item.id);
    else state.expandedNoticeIds.add(item.id);
    renderDailyNotices();
  });
  return article;
}

function filteredDailyNotices() {
  const runDay = beijingDay(state.meta?.status?.last_success || new Date());
  const today = beijingDay();
  const weekStart = new Date(`${today}T00:00:00Z`);
  weekStart.setUTCDate(weekStart.getUTCDate() - 6);
  const weekDay = weekStart.toISOString().slice(0, 10);
  const query = state.noticeQuery.trim().toLocaleLowerCase('zh-CN');
  return [...state.notices].filter(item => {
    if (state.noticeCategory !== 'all' && noticeGroup(item) !== state.noticeCategory) return false;
    if (state.noticeTiming === 'today' && noticeFirstSeenDay(item) !== runDay) return false;
    if (state.noticeTiming === 'open' && !['open', 'soon'].includes(deadlineState(item).kind)) return false;
    if (state.noticeTiming === '7days' && noticePublishedDay(item) < weekDay) return false;
    if (query) {
      const translation = translationFor(item);
      const haystack = [item.title, item.summary, item.content, translation?.title_zh, translation?.abstract_zh, item.source, item.scope, noticeCategoryInfo(item.notice_category).label]
        .join(' ').toLocaleLowerCase('zh-CN');
      if (!query.split(/\s+/).every(term => haystack.includes(term))) return false;
    }
    return true;
  }).sort((a, b) => noticePublishedDay(b).localeCompare(noticePublishedDay(a))
    || noticeFirstSeenDay(b).localeCompare(noticeFirstSeenDay(a))
    || (b.importance || 0) - (a.importance || 0));
}

function renderDailyNoticeCategories() {
  const host = $('#dailyNoticeCategories');
  const counts = new Map();
  state.notices.forEach(item => counts.set(noticeGroup(item), (counts.get(noticeGroup(item)) || 0) + 1));
  host.replaceChildren(...NOTICE_GROUPS.map(category => {
    const button = document.createElement('button');
    const count = category.id === 'all' ? state.notices.length : (counts.get(category.id) || 0);
    button.type = 'button';
    button.className = state.noticeCategory === category.id ? 'active' : '';
    button.setAttribute('aria-pressed', String(state.noticeCategory === category.id));
    button.innerHTML = `<span>${text(category.icon)}</span><b>${text(category.label)}</b><em>${text(category.description)}</em><small>${count}</small>`;
    button.addEventListener('click', () => {
      state.noticeCategory = category.id;
      state.noticeVisible = 24;
      renderDailyNotices();
    });
    return button;
  }));
}

function renderDailyNotices() {
  const runDay = beijingDay(state.meta?.status?.last_success || new Date());
  const today = beijingDay();
  const weekStart = new Date(`${today}T00:00:00Z`);
  weekStart.setUTCDate(weekStart.getUTCDate() - 6);
  const weekDay = weekStart.toISOString().slice(0, 10);
  const todayCount = state.notices.filter(item => noticeFirstSeenDay(item) === runDay).length;
  const openItems = state.notices.filter(item => ['open', 'soon'].includes(deadlineState(item).kind));
  const weekCount = state.notices.filter(item => noticePublishedDay(item) >= weekDay).length;
  const sourceResults = (state.meta?.status?.source_results || []).filter(item => item.kind === 'notice');
  const healthySources = sourceResults.filter(item => item.ok).length;

  $('#noticeTodayCount').textContent = todayCount.toLocaleString('zh-CN');
  $('#noticeOpenCount').textContent = openItems.length.toLocaleString('zh-CN');
  $('#noticeWeekCount').textContent = weekCount.toLocaleString('zh-CN');
  $('#noticeSourceCount').textContent = `${healthySources}/${sourceResults.length}`;
  $('#noticeSourceHint').textContent = sourceResults.length ? `${sourceResults.length - healthySources} 个来源待重试` : '等待首次来源检查';
  $('#dailyNoticeUpdated').textContent = relativeUpdate(state.meta?.status?.last_success || '');
  renderDailyNoticeCategories();

  const items = filteredDailyNotices();
  if (!items.some(item => item.id === state.selectedNoticeId)) state.selectedNoticeId = items[0]?.id || '';
  $('#dailyNoticeResultCount').textContent = `共 ${items.length.toLocaleString('zh-CN')} 条`;
  $('#dailyNoticeList').replaceChildren(...items.slice(0, state.noticeVisible).map(dailyNoticeCard));
  if (!items.length) {
    $('#dailyNoticeList').innerHTML = '<div class="daily-notice-empty"><span>🌱</span><b>暂无匹配通知</b><p>可切换分类或清空搜索条件。</p></div>';
  }
  $('#dailyNoticeMore').hidden = items.length <= state.noticeVisible;
  renderNoticeDetail(items.find(item => item.id === state.selectedNoticeId));

  const deadlineItems = openItems
    .filter(item => state.noticeCategory === 'all' || noticeGroup(item) === state.noticeCategory)
    .sort((a, b) => (a.deadline || '').localeCompare(b.deadline || ''))
    .slice(0, 8);
  $('#deadlineBoard').hidden = !deadlineItems.length;
  $('#deadlineList').replaceChildren(...deadlineItems.map(item => {
    const link = document.createElement('a');
    const deadline = deadlineState(item);
    link.className = 'deadline-item';
    link.href = item.url || '#';
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.innerHTML = `<time><b>${text((item.deadline || '').slice(5).replace('-', '月'))}日</b><small>${deadline.days === 0 ? '今日' : `还有 ${deadline.days} 天`}</small></time><div><span>${text(noticeCategoryInfo(item.notice_category).label)} · ${text(item.source)}</span><strong>${text(item.title)}</strong></div><i>↗</i>`;
    return link;
  }));
}

function noticePortalCategory(id) {
  return state.noticePortals.categories.find(category => category.id === id);
}

function renderNoticePortal() {
  const entries = state.noticePortals.entries || [];
  const categories = state.noticePortals.categories || [];
  const categoryCounts = new Map(categories.map(category => [
    category.id,
    entries.filter(entry => entry.category === category.id).length,
  ]));

  const categoryButtons = [
    { id: 'all', label: '全部', icon: '✦', description: '所有官方入口' },
    ...categories,
  ].map(category => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = state.noticePortalCategory === category.id ? 'active' : '';
    button.dataset.category = category.id;
    button.setAttribute('aria-pressed', String(state.noticePortalCategory === category.id));
    const count = category.id === 'all' ? entries.length : (categoryCounts.get(category.id) || 0);
    button.innerHTML = `<span>${text(category.icon || '•')}</span><b>${text(category.label)}</b><small>${count}</small>`;
    button.title = category.description || category.label;
    button.addEventListener('click', () => {
      state.noticePortalCategory = category.id;
      renderNoticePortal();
      $('#noticePortalList').scrollTop = 0;
    });
    return button;
  });
  $('#noticePortalCategories').replaceChildren(...categoryButtons);

  const query = state.noticePortalQuery.trim().toLocaleLowerCase('zh-CN');
  const filtered = entries.filter(entry => {
    if (state.noticePortalCategory !== 'all' && entry.category !== state.noticePortalCategory) return false;
    if (!query) return true;
    const haystack = [entry.name, entry.scope, entry.description, ...(entry.tags || [])]
      .join(' ').toLocaleLowerCase('zh-CN');
    return haystack.includes(query);
  });

  const cards = filtered.map(entry => {
    const category = noticePortalCategory(entry.category) || {};
    const link = document.createElement('a');
    link.className = 'notice-portal-entry';
    link.href = entry.url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.innerHTML = `
      <div class="notice-portal-entry-icon" aria-hidden="true">${text(category.icon || '•')}</div>
      <div class="notice-portal-entry-copy">
        <small><span>${text(category.label || '官方入口')}</span><b>${text(entry.scope || '')}</b></small>
        <h4>${text(entry.name)}</h4>
        <p>${text(entry.description || '')}</p>
        <div>${(entry.tags || []).slice(0, 5).map(tag => `<span>${text(tag)}</span>`).join('')}</div>
      </div>
      <span class="notice-portal-entry-arrow" aria-hidden="true">↗</span>`;
    return link;
  });

  $('#noticePortalCount').textContent = `${filtered.length} / ${entries.length} 个入口`;
  $('#noticePortalList').replaceChildren(...cards);
  if (!cards.length) {
    $('#noticePortalList').innerHTML = '<div class="notice-portal-empty"><span>🌱</span><b>没有找到匹配入口</b><p>试试装置缩写、省市名称或会议关键词。</p></div>';
  }
  $('#noticePortalUpdated').textContent = state.noticePortals.updated ? `目录核验 ${state.noticePortals.updated}` : '';
}

function openNoticePortal(category = 'all') {
  state.noticePortalCategory = noticePortalCategory(category) ? category : 'all';
  state.noticePortalQuery = '';
  $('#noticePortalSearch').value = '';
  renderNoticePortal();
  $('#noticePortalDialog').showModal();
  window.requestAnimationFrame(() => $('#noticePortalSearch').focus());
}

function homeLane({ kicker, title, count, items, view, tone, scope = '' }) {
  const article = document.createElement('article');
  article.className = `home-lane ${tone || ''}`;
  const list = items.slice(0, 4).map((item, index) => `
    <a class="home-lane-item" href="${text(item.url || '#')}" target="_blank" rel="noreferrer">
      <span>${String(index + 1).padStart(2, '0')}</span>
      <div><b>${text(localizedTitle(item))}</b><small>${text(item.source_short || item.source || '')}${item.published ? ` · ${text(prettyDate(item.published))}` : ''}</small></div>
    </a>`).join('');
  article.innerHTML = `
    <header><div><small>${text(kicker)}</small><h3>${text(title)}</h3></div><strong>${count}</strong></header>
    <div class="home-lane-list">${list || '<p>等待下一次自动更新。</p>'}</div>
    <button type="button">查看全部 <span>→</span></button>`;
  $('button', article).addEventListener('click', () => {
    if (scope) {
      state.scope = scope;
      $('#scopeSelect').value = scope;
    }
    setView(view);
    $('#stream').scrollIntoView({ behavior: 'smooth' });
  });
  return article;
}

function renderHomeHub() {
  const host = $('#homeHubGrid');
  if (!host) return;
  const latest = latestPaperDay();
  const today = state.papers.filter(item => paperDay(item) === latest);
  const todayNuclear = today.filter(isPrimaryNuclear).sort(compareNuclearFirst);
  const news = [...state.news].sort(compareNuclearFirst);
  const notices = [...state.notices].sort(compareNuclearFirst);
  const hiddenFavorites = new Set(state.personal.hiddenPublicFavorites);
  const favoriteIds = new Set([
    ...Object.keys(state.personal.favorites),
    ...state.publicFavorites.map(item => typeof item === 'string' ? item : item.id).filter(id => !hiddenFavorites.has(id)),
  ]);
  const myItems = [
    ...state.papers.filter(item => favoriteIds.has(item.id)).slice(0, 2).map(item => ({ ...item, source_short: '我的论文' })),
    ...state.papers.filter(item => state.personal.translationFavorites[item.id]).slice(0, 1).map(item => ({ ...item, source_short: '翻译收藏' })),
    ...myCollectionItems('code').slice(0, 1).map(item => ({ ...item, source_short: '我的代码' })),
    ...myCollectionItems('references').slice(0, 1).map(item => ({ ...item, source_short: '参考资料' })),
  ];
  const myCount = favoriteIds.size + Object.keys(state.personal.translationFavorites).length + myCollectionItems('code').length + myCollectionItems('references').length;
  host.replaceChildren(
    homeLane({ kicker: 'TODAY', title: '今日核物理', count: todayNuclear.length, items: todayNuclear, view: 'papers', tone: 'papers-lane', scope: 'daily-focus' }),
    homeLane({ kicker: 'NEWS', title: '科研新闻', count: state.news.length, items: news, view: 'news', tone: 'news-lane' }),
    homeLane({ kicker: 'NOTICES', title: '官方通知', count: state.notices.length, items: notices, view: 'notices', tone: 'notices-lane' }),
    homeLane({ kicker: 'MY SPACE', title: '我的科研', count: myCount, items: myItems, view: 'favorites', tone: 'my-lane' }),
  );
}

function renderBriefing() {
  const latest = state.meta.insights?.latest_day || latestPaperDay();
  const allItems = state.papers.filter(item => paperDay(item) === latest);
  const items = allItems.filter(isPrimaryNuclear);
  const categoryCounts = new Map();
  const sourceCounts = new Map();
  items.forEach(item => {
    (item.categories || []).filter(category => PRIMARY_NUCLEAR_CATEGORIES.has(category)).forEach(category => categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1));
    sourceCounts.set(item.source, (sourceCounts.get(item.source) || 0) + 1);
  });
  const topics = [...categoryCounts.entries()].sort((a, b) => (NUCLEAR_PRIORITY.get(b[0]) || 0) - (NUCLEAR_PRIORITY.get(a[0]) || 0) || b[1] - a[1]).slice(0, 5);
  const sources = [...sourceCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topItems = [...items].sort(compareNuclearFirst).slice(0, 3);
  $('#briefingDate').textContent = latest ? `${prettyDate(latest)} · 核物理相关 ${items.length} 篇` : '等待今日数据';
  const journalCount = items.filter(item => item.source_type === 'journal').length;
  const preprintCount = items.filter(item => item.source_type === 'preprint').length;
  const translationGroups = [
    ['论文', state.papers], ['新闻', state.news], ['通知', state.notices],
  ].map(([label, records]) => ({ label, total: records.length, translated: records.filter(item => Boolean(state.translations[item.id])).length }));
  const translationTotal = translationGroups.reduce((sum, group) => sum + group.total, 0);
  const translatedCount = translationGroups.reduce((sum, group) => sum + group.translated, 0);
  const translationPercent = translationTotal ? translatedCount / translationTotal * 100 : 0;
  const translationPercentLabel = translationPercent >= 100 ? '100%' : `${translationPercent.toFixed(1)}%`;
  $('#dailyPaperCount').textContent = allItems.length.toLocaleString('zh-CN');
  $('#dailyNuclearCount').textContent = items.length.toLocaleString('zh-CN');
  $('#dailyJournalCount').textContent = journalCount.toLocaleString('zh-CN');
  $('#dailyPreprintCount').textContent = preprintCount.toLocaleString('zh-CN');
  $('#briefingSummary').textContent = items.length
    ? `今日共收录 ${allItems.length} 篇论文，其中 ${items.length} 篇属于核物理相关分类：期刊论文 ${journalCount} 篇、预印本 ${preprintCount} 篇。重点文章仅从 PRL、Nature、Science、Nature Physics 与 Nature Communications 中筛选。`
    : '尚无可用的当日元数据。';
  $('#translationProgressPercent').textContent = translationPercentLabel;
  $('#translationProgressCount').textContent = `${translatedCount.toLocaleString('zh-CN')} / ${translationTotal.toLocaleString('zh-CN')} 条已有中文译文`;
  $('#translationProgressBar').style.width = `${Math.min(100, translationPercent).toFixed(2)}%`;
  $('#translationProgressTrack').setAttribute('aria-valuenow', translationPercent.toFixed(1));
  $('#translationProgressStats').innerHTML = `${translationGroups.map(group => `<span>${group.label} <b>${group.translated.toLocaleString('zh-CN')}</b> / ${group.total.toLocaleString('zh-CN')}</span>`).join('')}<small>尚待翻译 ${(translationTotal - translatedCount).toLocaleString('zh-CN')} 条</small>`;

  const renderBars = (host, values, labelFor) => {
    const max = Math.max(...values.map(([, count]) => count), 1);
    host.innerHTML = values.map(([value, count]) => `
      <div class="brief-row"><div><span>${text(labelFor(value))}</span><b>${count}</b></div><i><em style="width:${Math.max(8, count / max * 100)}%"></em></i></div>
    `).join('') || '<small>暂无数据</small>';
  };
  renderBars($('#topicBrief'), topics, categoryName);
  renderBars($('#sourceBrief'), sources, value => value);
  $('#topBrief').innerHTML = topItems.map((item, index) => `
    <a href="${text(item.url)}" target="_blank" rel="noreferrer"><span>0${index + 1}</span><div><b>${text(item.title)}</b><small>${text(item.source_short || item.source)} · ${item.importance || 0}</small></div></a>
  `).join('') || '<small>暂无数据</small>';
}

function renderMetrics() {
  const status = state.meta.status;
  const indexedPapers = Number(state.historyManifest?.indexed_papers || state.papers.length);
  const indexedMonths = Number(state.historyManifest?.indexed_months || 0);
  $('#paperCount').textContent = indexedPapers.toLocaleString('zh-CN');
  $('#paperCountHint').textContent = indexedMonths ? `${indexedMonths} 个月已建索引` : '持续累积';
  $('#featuredCount').textContent = (state.meta.insights?.latest_count ?? state.featured.length).toLocaleString('zh-CN');
  $('#newsCount').textContent = state.news.length.toLocaleString('zh-CN');
  const results = status.source_results || [];
  const ok = results.filter(item => item.ok).length;
  $('#sourceHealth').textContent = results.length ? `${ok}/${results.length}` : '—';
  $('#sourceHealthHint').textContent = results.length && ok === results.length ? '全部正常' : `${results.length - ok} 个源待重试`;
  $('#lastUpdated').textContent = relativeUpdate(status.last_success);
  $('#automationSummary').textContent = results.length ? `本次 ${ok} 个数据源成功，${results.length - ok} 个将在下次重试。` : '尚未完成首次自动更新。';
}

function showStatus() {
  const results = state.meta.status.source_results || [];
  $('#statusContent').innerHTML = results.length ? results.map(item => `
    <div class="status-row"><span>${text(item.name)}<small> · ${text(item.kind)} · ${item.count} 条${item.duration_ms ? ` · ${(item.duration_ms / 1000).toFixed(1)}s` : ''}</small></span><span class="${item.ok ? 'ok' : 'fail'}">${item.ok ? '正常' : '待重试'}</span></div>
  `).join('') : '<p>尚无更新记录。</p>';
  $('#statusDialog').showModal();
}

function renderKeywords() {
  const host = $('#keywordTags');
  host.replaceChildren(...state.personal.keywords.map(keyword => {
    const tag = document.createElement('span');
    tag.className = 'keyword-tag';
    tag.innerHTML = `${text(keyword)}<button type="button" aria-label="删除 ${text(keyword)}">×</button>`;
    $('button', tag).addEventListener('click', () => {
      state.personal.keywords = state.personal.keywords.filter(item => item !== keyword);
      savePersonal(); renderKeywords(); renderCards();
    });
    return tag;
  }));
}

function allFavoriteKeywordStats() {
  const counts = new Map();
  let uncategorized = 0;
  const ids = new Set([
    ...Object.keys(state.personal.favorites),
    ...state.publicFavorites.map(item => typeof item === 'string' ? item : item.id).filter(id => !state.personal.hiddenPublicFavorites.includes(id)),
  ]);
  ids.forEach(id => {
    const values = favoriteKeywords(id);
    if (!values.length) uncategorized += 1;
    values.forEach(label => {
      const key = `kw:${keywordKey(label)}`;
      const old = counts.get(key) || { key, label, count: 0 };
      old.count += 1;
      counts.set(key, old);
    });
  });
  const values = [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-CN'));
  if (uncategorized) values.push({ key: 'missing', label: '未分类', count: uncategorized });
  return values;
}

function renderMyKeywordsPanel() {
  const panel = $('#myKeywordsPanel');
  if (!panel || state.view !== 'favorites' || state.mySection !== 'papers') {
    if (panel) panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const stats = allFavoriteKeywordStats();
  const total = currentItems().length;
  const host = $('#myKeywordList');
  const all = document.createElement('button');
  all.type = 'button';
  all.className = 'my-keyword-button';
  all.classList.toggle('active', state.favoriteKeyword === 'all');
  all.innerHTML = `<span>全部收藏</span><b>${total}</b>`;
  all.addEventListener('click', () => { state.favoriteKeyword = 'all'; renderCards(); });
  const nodes = stats.map(item => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'my-keyword-button';
    button.classList.toggle('active', state.favoriteKeyword === item.key);
    button.innerHTML = `<span># ${text(item.label)}</span><b>${item.count}</b>`;
    button.addEventListener('click', () => { state.favoriteKeyword = item.key; state.visible = 20; renderCards(); });
    return button;
  });
  host.replaceChildren(all, ...nodes);
  if (!stats.length) {
    const hint = document.createElement('p');
    hint.className = 'my-keyword-empty';
    hint.textContent = '收藏论文时设定的关键词会出现在这里。';
    host.append(hint);
  }
}

function renderTranslationShelfPanel() {
  const panel = $('#translationShelfPanel');
  const visible = state.view === 'favorites' && state.mySection === 'translations';
  panel.hidden = !visible;
  if (!visible) return;
  const rules = state.personal.translationGlossary;
  $('#translationFavoriteCount').textContent = Object.keys(state.personal.translationFavorites).length.toLocaleString('zh-CN');
  $('#translationGlossaryCount').textContent = rules.length.toLocaleString('zh-CN');
  $('#translationGlossaryPreview').innerHTML = rules.length
    ? rules.slice(0, 8).map(rule => `<span><b>${text(rule.source)}</b><i>→</i>${text(rule.target)}</span>`).join('')
    : '<small>尚未添加指定译法。例如：knockout reaction → 敲出反应。</small>';
}

function renderTranslationGlossary() {
  const host = $('#translationGlossaryList');
  const rules = state.personal.translationGlossary;
  host.innerHTML = rules.length ? rules.map(rule => `
    <div class="translation-glossary-item" data-translation-rule="${text(rule.id)}">
      <span><b>${text(rule.source)}</b><i>→</i><strong>${text(rule.target)}</strong></span>
      <button type="button" aria-label="删除译法 ${text(rule.source)}">删除</button>
    </div>`).join('') : '<p>尚未添加指定译法。</p>';
  $$('[data-translation-rule] button', host).forEach(button => button.addEventListener('click', () => {
    const id = button.closest('[data-translation-rule]').dataset.translationRule;
    state.personal.translationGlossary = state.personal.translationGlossary.filter(rule => rule.id !== id);
    savePersonal();
    renderTranslationGlossary();
    renderTranslationShelfPanel();
    renderCards();
    showToast('已删除指定译法');
  }));
}

function openTranslationGlossaryDialog() {
  renderTranslationGlossary();
  $('#translationGlossaryDialog').showModal();
  $('#translationPhraseSource').focus();
}

function saveTranslationGlossary(event) {
  event.preventDefault();
  const source = normalizeKeyword($('#translationPhraseSource').value);
  const target = normalizeKeyword($('#translationPhraseTarget').value);
  if (!source || !target) return showToast('请同时填写原短语和指定译法');
  const key = source.toLocaleLowerCase('zh-CN');
  const existing = state.personal.translationGlossary.find(rule => rule.source.toLocaleLowerCase('zh-CN') === key);
  if (existing) {
    existing.source = source;
    existing.target = target;
  } else {
    state.personal.translationGlossary.unshift({ id: `term-${Date.now()}`, source, target, added_at: new Date().toISOString() });
  }
  savePersonal();
  event.currentTarget.reset();
  renderTranslationGlossary();
  renderTranslationShelfPanel();
  renderCards();
  showToast(existing ? '已更新译法，待提交 GitHub' : '已添加译法，待提交 GitHub');
}

function openMyItemDialog() {
  if (!['code', 'references'].includes(state.mySection)) return;
  $('#myItemDialogTitle').textContent = state.mySection === 'code' ? '添加我的代码' : '添加参考资料';
  $('#myItemForm').reset();
  $('#myItemDialog').showModal();
}

function closeMyItemDialog() {
  $('#myItemDialog').close();
}

function saveMyItem(event) {
  event.preventDefault();
  const title = $('#myItemTitle').value.trim();
  const rawUrl = $('#myItemUrl').value.trim();
  let url;
  try {
    url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
  } catch {
    return showToast('请输入有效的 http 或 https 链接');
  }
  const key = state.mySection === 'code' ? 'codeItems' : 'resources';
  state.personal[key].unshift({
    id: `personal-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    title,
    url: url.href,
    description: $('#myItemDescription').value.trim(),
    keywords: uniqueKeywords($('#myItemKeywords').value.split(/[,;，；\n]+/)),
    added_at: new Date().toISOString(),
  });
  savePersonal();
  closeMyItemDialog();
  renderCards();
  renderHomeHub();
  showToast('已添加到科研空间，待提交 GitHub');
}

function bindEvents() {
  $$('.nav-link[data-view], .view-tab[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
  $('.brand').addEventListener('click', event => {
    event.preventDefault();
    setView('home');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  $$('[data-view-jump]').forEach(button => button.addEventListener('click', () => {
    closePaperAssistant();
    setView(button.dataset.viewJump);
    const target = button.dataset.viewJump === 'notices' ? $('#dailyNoticeDashboard') : $('#stream');
    target?.scrollIntoView({ behavior: 'smooth' });
  }));
  $$('[data-scroll]').forEach(button => button.addEventListener('click', () => $(`#${button.dataset.scroll}`)?.scrollIntoView({ behavior: 'smooth' })));
  $$('.my-space-tab').forEach(button => button.addEventListener('click', () => setMySection(button.dataset.mySection)));
  $('#clearCategory').addEventListener('click', () => setCategory('all'));
  $('#editFilterLayout').addEventListener('click', toggleLayoutEditing);
  $('#resetFilterLayout').addEventListener('click', resetFilterLayout);
  $$('[data-filter-module] [data-module-move]').forEach(button => button.addEventListener('click', () => {
    moveFilterModule(button.closest('[data-filter-module]').dataset.filterModule, Number(button.dataset.moduleMove));
  }));
  $('#openPaperAssistant').addEventListener('click', openPaperAssistant);
  $('#closePaperAssistant').addEventListener('click', closePaperAssistant);
  $('#assistantBackToOverview').addEventListener('click', showAssistantOverview);
  $('#assistantBackdrop').addEventListener('click', closePaperAssistant);
  $('#clearAssistantFilters').addEventListener('click', clearPaperFilters);
  $('#searchInput').addEventListener('input', event => { state.query = event.target.value; state.visible = 20; renderCards(); });
  $('#searchFieldSelect').addEventListener('change', event => { state.searchField = event.target.value; state.visible = 20; renderCards(); });
  $('#sortSelect').addEventListener('change', event => { state.sort = event.target.value; renderCards(); });
  $('#scopeSelect').addEventListener('change', event => {
    state.scope = event.target.value;
    if (state.scope === 'custom') ensureCustomDateRange();
    state.visible = 20;
    updateMySpaceUI();
    renderCards();
  });
  $('#dateFrom').addEventListener('change', () => updateCustomDateRange('dateFrom'));
  $('#dateTo').addEventListener('change', () => updateCustomDateRange('dateTo'));
  $('#clearDateRange').addEventListener('click', () => {
    state.dateFrom = '';
    state.dateTo = '';
    $('#dateFrom').value = '';
    $('#dateTo').value = '';
    state.visible = 20;
    renderCards();
  });
  $('#sourceSelect').addEventListener('change', event => { state.source = event.target.value; state.visible = 20; renderCards(); });
  $('#loadMore').addEventListener('click', () => {
    if (state.view === 'papers' && state.globalKeyword && state.historyMonthQueue.length) {
      void loadNextHistoryBatch();
      return;
    }
    state.visible += 20;
    renderCards();
  });
  $('#historyKeywordForm').addEventListener('submit', event => {
    event.preventDefault();
    void searchAllHistory($('#historyKeywordInput').value);
  });
  $('#clearHistoryKeyword').addEventListener('click', () => clearGlobalKeywordSearch());
  $('#keywordButton').addEventListener('click', () => $('#keywordDialog').showModal());
  $('#addKeywordAside').addEventListener('click', () => $('#keywordDialog').showModal());
  $('#keywordForm').addEventListener('submit', event => {
    event.preventDefault();
    const input = $('#keywordInput');
    const value = input.value.trim();
    if (value && !state.personal.keywords.includes(value)) {
      state.personal.keywords.push(value);
      savePersonal(); renderKeywords(); renderGlobalKeywordPanel(); renderCards();
    }
    input.value = '';
  });
  $('#favoriteForm').addEventListener('submit', event => { event.preventDefault(); saveFavoriteDraft(); });
  $('#cancelFavorite').addEventListener('click', closeFavoriteDialog);
  $('#cancelFavoriteBottom').addEventListener('click', closeFavoriteDialog);
  $('#openTranslationGlossary').addEventListener('click', openTranslationGlossaryDialog);
  $('#closeTranslationGlossary').addEventListener('click', () => $('#translationGlossaryDialog').close());
  $('#translationGlossaryForm').addEventListener('submit', saveTranslationGlossary);
  $('#closeCitation').addEventListener('click', closeCitationDialog);
  $('#citationDialog').addEventListener('close', () => { state.citationDraft = null; });
  $('#citationFormat').addEventListener('change', renderCitationDialog);
  $('#copyCitation').addEventListener('click', () => {
    const item = state.citationDraft;
    if (item) copyText(citationValue(item), '引用格式已复制');
  });
  $('#downloadCitation').addEventListener('click', downloadCitation);
  $('#addMyItem').addEventListener('click', openMyItemDialog);
  $('#myItemForm').addEventListener('submit', saveMyItem);
  $('#cancelMyItem').addEventListener('click', closeMyItemDialog);
  $('#cancelMyItemBottom').addEventListener('click', closeMyItemDialog);
  $('#showSourceStatus').addEventListener('click', showStatus);
  $('#openNoticePortal').addEventListener('click', () => openNoticePortal());
  $$('.notice-portal-quick [data-notice-category]').forEach(button => {
    button.addEventListener('click', () => openNoticePortal(button.dataset.noticeCategory));
  });
  $('#closeNoticePortal').addEventListener('click', () => $('#noticePortalDialog').close());
  $('#noticePortalSearch').addEventListener('input', event => {
    state.noticePortalQuery = event.target.value;
    renderNoticePortal();
  });
  $('#dailyNoticeSearch').addEventListener('input', event => {
    state.noticeQuery = event.target.value;
    state.noticeVisible = 24;
    renderDailyNotices();
  });
  $('#dailyNoticeTiming').addEventListener('change', event => {
    state.noticeTiming = event.target.value;
    state.noticeVisible = 24;
    renderDailyNotices();
  });
  $('#dailyNoticeMore').addEventListener('click', () => {
    state.noticeVisible += 24;
    renderDailyNotices();
  });
  $('#submitGitHubSync').addEventListener('click', () => void submitGitHubSync());
  $('#exportReferences').addEventListener('click', exportReferenceSet);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.body.classList.contains('paper-assistant-open')) {
      closePaperAssistant();
      $('#openPaperAssistant').focus();
      return;
    }
    if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
      event.preventDefault();
      (state.view === 'notices' ? $('#dailyNoticeSearch') : $('#searchInput')).focus();
    }
  });
}

async function loadData() {
  const files = ['meta', 'papers', 'featured', 'news', 'notices', 'public-favorites', 'notice-portals', 'reference-resources', 'personal-state', 'translations.zh-CN'];
  const [responses, historyManifest] = await Promise.all([Promise.all(files.map(async name => {
    const response = await fetch(`./data/${name}.json`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    return response.json();
  })), fetch('./data/history/manifest.json', { cache: 'no-store' }).then(response => {
    if (!response.ok) throw new Error(`history manifest: HTTP ${response.status}`);
    return response.json();
  })]);
  const translationPayload = responses.pop();
  const personalPayload = responses.pop();
  const referencePayload = responses.pop();
  [state.meta, state.papers, state.featured, state.news, state.notices, state.publicFavorites, state.noticePortals] = responses;
  state.referenceResources = Array.isArray(referencePayload?.items) ? referencePayload.items : [];
  state.historyManifest = historyManifest;
  applyPublicPersonalState(personalPayload);
  state.personalDirty = false;
  state.translations = translationPayload.items || {};
  Object.keys(state.translations).forEach(id => state.translatedIds.add(id));
  state.meta.categories.forEach(category => state.categoryMap.set(category.id, category));
  configureDateRangeInputs();
  if (state.meta.site.repository_url) $('#repoLink').href = state.meta.site.repository_url;
  else $('#repoLink').hidden = true;
  updateCloudSyncUI();
}

async function initialize() {
  bindEvents();
  try {
    await loadData();
    renderCategories(); renderSourceOptions(); renderHomeHub(); renderBriefing(); renderMetrics(); renderKeywords(); renderGlobalKeywordPanel(); renderHomeDashboard(); renderNoticePortal();
    const hash = location.hash.slice(1);
    const myMatch = hash.match(/^favorites-(papers|translations|code|references)$/);
    if (myMatch) {
      state.mySection = myMatch[1];
      setView('favorites');
    } else {
      setView(['home', 'papers', 'featured', 'news', 'notices', 'favorites', 'unread', 'ignored'].includes(hash) ? hash : 'home');
    }
  } catch (error) {
    console.error(error);
    const hint = location.protocol === 'file:'
      ? '请打开在线站点 https://code-world-kang.github.io/nuclear-frontier/'
      : '请稍后刷新。';
    $('#cardList').innerHTML = `<div class="empty-state"><b>数据暂时无法载入</b><p>${text(error.message)}。${text(hint)}</p></div>`;
    $('#lastUpdated').textContent = '数据加载失败';
  }
}

initialize();

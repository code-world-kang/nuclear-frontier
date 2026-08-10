const PATH = new URL('.', window.location.href).pathname;
const PERSONAL_KEY = 'nuclear-frontier.personal.v1';
const PAPER_LAYOUT_KEY = 'nuclear-frontier.paper-layout.v1';

const DEFAULT_CATEGORY_ORDER = [
  'experimental-nuclear', 'nuclear-structure', 'nuclear-reactions', 'nuclear-decay', 'detectors-daq',
  'theoretical-nuclear', 'nuclear-astrophysics', 'high-energy-nuclear', 'accelerators', 'fusion',
  'ai-science', 'nuclear-general', 'nuclear-data-applications', 'particle-cross', 'frontiers',
];
const DEFAULT_FILTER_MODULE_ORDER = ['categories', 'keywords'];

const state = {
  papers: [], featured: [], news: [], notices: [], publicFavorites: [], translations: {}, noticePortals: { categories: [], entries: [] },
  meta: null, view: 'papers', category: 'all', source: 'all', query: '', searchField: 'all', sort: 'date', scope: 'daily-focus', visible: 20,
  dateFrom: '', dateTo: '', favoriteKeyword: 'all', favoriteDraft: null, noteDraft: null, citationDraft: null, mySection: 'papers', translatedIds: new Set(),
  selectedPaperId: '',
  noticeCategory: 'all', noticeTiming: 'all', noticeQuery: '', noticeVisible: 24,
  noticePortalCategory: 'all', noticePortalQuery: '', personal: loadPersonal(), paperLayout: loadPaperLayout(),
  layoutEditing: false, draggedCategory: '', categoryMap: new Map(), favoriteSyncInFlight: false,
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

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function loadPersonal() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PERSONAL_KEY) || '{}');
    const favorites = parsed.favorites && typeof parsed.favorites === 'object' ? parsed.favorites : {};
    const notes = parsed.notes && typeof parsed.notes === 'object' ? parsed.notes : {};
    Object.entries(favorites).forEach(([id, record]) => {
      if (!record || typeof record !== 'object') return;
      if (!notes[id] && typeof record.note === 'string' && record.note.trim()) notes[id] = record.note;
      delete record.note;
    });
    return {
      favorites,
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
      outbox: Array.isArray(parsed.outbox) ? parsed.outbox : [],
      readStatus: parsed.readStatus || {},
      notes,
      translationFavorites: parsed.translationFavorites && typeof parsed.translationFavorites === 'object' ? parsed.translationFavorites : {},
      translationGlossary: normalizeTranslationGlossary(parsed.translationGlossary),
      codeItems: Array.isArray(parsed.codeItems) ? parsed.codeItems : [],
      resources: Array.isArray(parsed.resources) ? parsed.resources : [],
      hiddenPublicFavorites: Array.isArray(parsed.hiddenPublicFavorites) ? parsed.hiddenPublicFavorites : [],
    };
  } catch {
    return { favorites: {}, keywords: [], outbox: [], readStatus: {}, notes: {}, translationFavorites: {}, translationGlossary: [], codeItems: [], resources: [], hiddenPublicFavorites: [] };
  }
}

function savePersonal() {
  try {
    localStorage.setItem(PERSONAL_KEY, JSON.stringify(state.personal));
    return true;
  } catch (error) {
    console.error(error);
    showToast('浏览器存储空间不足，本次内容未能保存');
    return false;
  }
}

function loadPaperLayout() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PAPER_LAYOUT_KEY) || '{}');
    return {
      categoryOrder: Array.isArray(parsed.categoryOrder) ? parsed.categoryOrder.map(String) : [...DEFAULT_CATEGORY_ORDER],
      hiddenCategories: Array.isArray(parsed.hiddenCategories) ? parsed.hiddenCategories.map(String) : [],
      moduleOrder: Array.isArray(parsed.moduleOrder) ? parsed.moduleOrder.map(String) : [...DEFAULT_FILTER_MODULE_ORDER],
    };
  } catch {
    return { categoryOrder: [...DEFAULT_CATEGORY_ORDER], hiddenCategories: [], moduleOrder: [...DEFAULT_FILTER_MODULE_ORDER] };
  }
}

function savePaperLayout() {
  try {
    localStorage.setItem(PAPER_LAYOUT_KEY, JSON.stringify(state.paperLayout));
  } catch (error) {
    console.error(error);
    showToast('排列未能保存，请检查浏览器存储空间');
  }
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

function publicFavoritePayload(record = {}) {
  return {
    id: record.id || '', doi: record.doi || '', arxiv_id: record.arxiv_id || '',
    title: record.title || '', url: record.url || '', categories: record.categories || [],
    tags: record.tags || [], keywords: uniqueKeywords(record.keywords || []), added_at: record.added_at || '',
  };
}

function publicSyncEvent(event = {}) {
  const at = typeof event.at === 'string' ? event.at : new Date().toISOString();
  if (event.operation === 'upsert' && event.item) {
    return { operation: 'upsert', item: publicFavoritePayload(event.item), at };
  }
  if (event.operation === 'remove' && event.id) {
    return { operation: 'remove', id: String(event.id), at };
  }
  if (event.operation === 'keywords') {
    return { operation: 'keywords', keywords: uniqueKeywords(event.keywords || []), at };
  }
  return null;
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
    return state.papers.filter(item => ids.has(item.id));
  }
  if (state.view === 'unread') return state.papers.filter(item => state.personal.readStatus[item.id] !== 'read');
  return state.papers;
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
  const values = currentItems().filter(item => {
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

function categoryName(id) {
  return state.categoryMap.get(id)?.name || id || '其他前沿';
}

function isFavorite(id) {
  return Boolean(state.personal.favorites[id]) || (hasPublicFavorite(id) && !state.personal.hiddenPublicFavorites.includes(id));
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
  renderCards();
}

function markOpened(item) {
  if (!state.personal.readStatus[item.id]) {
    state.personal.readStatus[item.id] = 'reading';
    savePersonal();
  }
}

function translationFor(item) {
  return state.translations[item.id] || null;
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
  renderCards();
  renderHomeHub();
}

function usingTranslation(item) {
  return state.translatedIds.has(item.id) && Boolean(translationFor(item));
}

function localizedTitle(item) {
  const translation = translationFor(item);
  return usingTranslation(item) ? applyTranslationGlossary(translation.title_zh) : item.title;
}

function localizedAbstract(item) {
  const translation = translationFor(item);
  return usingTranslation(item)
    ? applyTranslationGlossary(translation.abstract_zh)
    : (item.abstract || item.summary || '');
}

function toggleTranslation(item) {
  if (!translationFor(item)) return showToast('这篇论文暂时还没有 Codex 中文译文');
  if (state.translatedIds.has(item.id)) state.translatedIds.delete(item.id);
  else state.translatedIds.add(item.id);
  renderCards();
}

function cardFor(item) {
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
  const abstract = $('.abstract', card);
  abstract.textContent = translated
    ? applyTranslationGlossary(translation.abstract_zh)
    : (abstractValue || '该数据源未公开摘要；本站不生成或杜撰摘要。');
  $('.abstract-label', card).textContent = abstractValue
    ? (translated ? '完整摘要（Codex 中文译文）' : (item.type === 'paper' ? '完整摘要（原文）' : '完整介绍（原始来源）'))
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
    cite.textContent = 'Cite';
    cite.setAttribute('aria-label', `引用论文《${item.title}》`);
    cite.addEventListener('click', () => openCitationDialog(item));
    actions.append(cite);
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
    note.textContent = hasNote ? '📝 编辑笔记 · 已保存' : '📝 写笔记';
    note.setAttribute('aria-label', `${hasNote ? '编辑' : '为'}论文《${item.title}》${hasNote ? '的笔记' : '写笔记'}`);
    note.addEventListener('click', () => openNoteDialog(item));
    actions.append(note);

    const info = document.createElement('button');
    info.type = 'button';
    info.className = 'paper-info-button';
    info.textContent = '论文信息';
    info.addEventListener('click', () => selectPaperForAssistant(item));
    actions.append(info);
  }
  const related = document.createElement('button');
  related.type = 'button';
  related.className = 'related-button';
  related.textContent = '关联文献';
  related.addEventListener('click', () => openDetails(item));
  actions.append(related);
  if (item.type === 'paper') {
    const reading = document.createElement('button');
    reading.type = 'button';
    reading.className = 'reading-button';
    reading.textContent = readingLabel(item.id);
    reading.addEventListener('click', () => cycleReadingStatus(item));
    actions.append(reading);
  }

  const favorite = $('.favorite-button', card);
  if (item.type !== 'paper') {
    favorite.hidden = true;
    return card;
  }
  card.tabIndex = 0;
  card.setAttribute('aria-label', `论文：${item.title}。按回车在右侧查看论文信息`);
  card.addEventListener('click', event => {
    if (event.target.closest('a, button, input, select, textarea')) return;
    selectPaperForAssistant(item);
  });
  card.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.target !== card) return;
    event.preventDefault();
    selectPaperForAssistant(item);
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
  { id: 'default-arxiv-nucl-ex', title: 'arXiv · Nuclear Experiment', url: 'https://arxiv.org/list/nucl-ex/recent', description: '实验核物理最新预印本。', keywords: ['nucl-ex', '预印本'], builtin: true },
  { id: 'default-nndc', title: 'NNDC · Nuclear Data', url: 'https://www.nndc.bnl.gov/', description: '核结构、核衰变与反应数据入口。', keywords: ['核数据', 'ENSDF'], builtin: true },
  { id: 'default-iaea-nds', title: 'IAEA Nuclear Data Services', url: 'https://www-nds.iaea.org/', description: 'IAEA 核数据服务与数据库。', keywords: ['IAEA', '核数据'], builtin: true },
  { id: 'default-root-docs', title: 'CERN ROOT Documentation', url: 'https://root.cern/manual/', description: 'ROOT 数据分析框架官方手册。', keywords: ['ROOT', '数据分析'], builtin: true },
];

function myCollectionItems(section = state.mySection) {
  if (section === 'code') return [...DEFAULT_CODE_ITEMS, ...state.personal.codeItems];
  if (section === 'references') return [...DEFAULT_RESOURCES, ...state.personal.resources];
  return [];
}

function personalCollectionCard(item, section) {
  const card = document.createElement('article');
  card.className = 'personal-card';
  const tags = uniqueKeywords(item.keywords || []).map(value => `<span>${text(value)}</span>`).join('');
  card.innerHTML = `
    <div class="personal-card-icon" aria-hidden="true">${section === 'code' ? '⌘' : '↗'}</div>
    <div><small>${section === 'code' ? 'CODE & PROJECT' : 'REFERENCE'}</small><h3><a href="${text(item.url)}" target="_blank" rel="noreferrer">${text(item.title)}</a></h3>
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
  const items = myCollectionItems().filter(item => !query || [item.title, item.description, ...(item.keywords || [])].join(' ').toLowerCase().includes(query));
  $('#cardList').replaceChildren(...items.map(item => personalCollectionCard(item, state.mySection)));
  $('#resultCount').textContent = `共 ${items.length} 项`;
  $('#emptyState').hidden = items.length !== 0;
  $('#loadMore').hidden = true;
  $('#activeFilters').replaceChildren();
  $('#myKeywordsPanel').hidden = true;
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
  $('#resultCount').textContent = `共 ${items.length.toLocaleString('zh-CN')} 条结果`;
  $('#emptyState').hidden = items.length !== 0;
  $('#loadMore').hidden = items.length <= state.visible;
  renderActiveFilters();
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
  $('#translationShelfPanel').hidden = !(isMy && state.mySection === 'translations');
  const isPaperWorkspace = ['papers', 'featured', 'unread'].includes(state.view) || (isMy && isPaperShelf);
  $('#openPaperAssistant').hidden = !isPaperWorkspace;
  $('#paperAssistant').hidden = !isPaperWorkspace;
  $('#assistantBackdrop').hidden = !isPaperWorkspace;
  if (!isPaperWorkspace) closePaperAssistant();
  $('#searchInput').placeholder = isMy
    ? ({ papers: '搜索收藏论文、作者或关键词…', translations: '搜索收藏译文、作者或术语…', code: '搜索我的代码与项目…', references: '搜索参考资料…' }[state.mySection])
    : '搜索题目、作者、期刊、DOI 或关键词…';
}

function setMySection(section) {
  if (!['papers', 'translations', 'code', 'references'].includes(section)) return;
  state.mySection = section;
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
  state.view = view;
  state.visible = 20;
  const labels = {
    home: ['HOME', '首页', '今日科研简报、新闻、通知与重点文章'],
    papers: ['LATEST PAPERS', '最新论文', '题目与摘要保留原文'],
    featured: ['EDITOR\'S RADAR', '重点文献', '基于来源、新颖性与关注词评分'],
    news: ['OFFICIAL NEWS', '科研新闻', '仅保留官方原始链接'],
    notices: ['DAILY NOTICES', '每日科研通知', '基金·束流·博后·CSC·涉核会议'],
    favorites: ['MY RESEARCH SPACE', '我的科研空间', '论文、翻译收藏、代码与参考资料集中管理'],
    unread: ['READING QUEUE', '我的未读文献', '点击“未读”可在未读、在读和已读之间切换'],
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
  if (view === 'favorites') {
    setMySection(state.mySection);
    return;
  }
  renderCards();
  history.replaceState(null, '', `${PATH}#${view}`);
}

function setCategory(id) {
  state.category = id;
  state.visible = 20;
  $$('.category-button').forEach(button => button.classList.toggle('active', button.dataset.category === id));
  renderCards();
}

function renderSourceOptions() {
  const counts = new Map();
  state.papers.forEach(item => counts.set(item.source, (counts.get(item.source) || 0) + 1));
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
  state.personal.outbox.push({ operation: 'upsert', item: publicFavoritePayload(state.personal.favorites[item.id]), at: new Date().toISOString() });
  savePersonal();
  closeFavoriteDialog();
  renderKeywords();
  renderCards();
  renderHomeHub();
  showToast(`已收藏，关键词：${keywords.join('、')}`);
  await tryFavoriteSync();
}

async function toggleFavorite(item, button) {
  if (state.personal.favorites[item.id]) {
    delete state.personal.favorites[item.id];
    if (hasPublicFavorite(item.id) && !state.personal.hiddenPublicFavorites.includes(item.id)) {
      state.personal.hiddenPublicFavorites.push(item.id);
    }
    state.personal.outbox.push({ operation: 'remove', id: item.id, at: new Date().toISOString() });
    savePersonal();
    const active = isFavorite(item.id);
    button.textContent = active ? '★' : '☆';
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
    await tryFavoriteSync();
    renderCards();
    renderHomeHub();
    showToast('已取消本机收藏');
    return;
  }
  if (hasPublicFavorite(item.id) && !state.personal.hiddenPublicFavorites.includes(item.id)) {
    state.personal.hiddenPublicFavorites.push(item.id);
    state.personal.outbox.push({ operation: 'remove', id: item.id, at: new Date().toISOString() });
    savePersonal();
    await tryFavoriteSync();
    renderCards();
    renderHomeHub();
    showToast('已在本机隐藏并提交取消收藏');
    return;
  }
  openFavoriteDialog(item);
}

async function tryFavoriteSync() {
  const runtime = state.meta?.site;
  if (!runtime?.favorite_sync_enabled || !runtime.favorite_sync_endpoint || !state.personal.outbox.length || state.favoriteSyncInFlight) return;
  const queuedCount = state.personal.outbox.length;
  const batch = state.personal.outbox.map(publicSyncEvent).filter(Boolean);
  if (!batch.length) {
    state.personal.outbox = [];
    savePersonal();
    return;
  }
  state.favoriteSyncInFlight = true;
  let succeeded = false;
  try {
    const response = await fetch(runtime.favorite_sync_endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: batch }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.personal.outbox.splice(0, queuedCount);
    savePersonal();
    succeeded = true;
  } catch (error) {
    console.warn('收藏同步将在下次联网时重试', error);
  } finally {
    state.favoriteSyncInFlight = false;
    if (succeeded && state.personal.outbox.length) queueMicrotask(tryFavoriteSync);
  }
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

function updateNoteCount() {
  const count = $('#noteInput').value.length;
  $('#noteCount').textContent = `${count.toLocaleString('zh-CN')} / 12000`;
}

function openNoteDialog(item) {
  state.noteDraft = item;
  const value = state.personal.notes[item.id] || '';
  $('#notePaperTitle').textContent = item.title;
  $('#noteInput').value = value;
  $('#deleteNote').hidden = !value.trim();
  updateNoteCount();
  $('#noteDialog').showModal();
  setTimeout(() => $('#noteInput').focus(), 50);
}

function closeNoteDialog() {
  $('#noteDialog').close();
  state.noteDraft = null;
}

function refreshOpenDetailNoteButton(item) {
  if (!$('#detailDialog').open || $('#detailContent').dataset.id !== item.id) return;
  const button = $('#openDetailNote', $('#detailContent'));
  if (button) button.textContent = state.personal.notes[item.id] ? '📝 编辑笔记 · 已保存' : '📝 写笔记';
}

function saveNoteDraft() {
  const item = state.noteDraft;
  if (!item) return;
  const previous = state.personal.notes[item.id];
  const previousFavoriteNote = state.personal.favorites[item.id]?.note;
  const value = $('#noteInput').value.trim();
  if (value) state.personal.notes[item.id] = value;
  else delete state.personal.notes[item.id];
  if (state.personal.favorites[item.id]) delete state.personal.favorites[item.id].note;
  if (!savePersonal()) {
    if (previous === undefined) delete state.personal.notes[item.id];
    else state.personal.notes[item.id] = previous;
    if (state.personal.favorites[item.id] && previousFavoriteNote !== undefined) {
      state.personal.favorites[item.id].note = previousFavoriteNote;
    }
    return;
  }
  refreshOpenDetailNoteButton(item);
  closeNoteDialog();
  renderCards();
  showToast(value ? '笔记已保存在当前浏览器' : '空笔记已清除');
}

function deleteNoteDraft() {
  const item = state.noteDraft;
  if (!item) return;
  const previous = state.personal.notes[item.id];
  const previousFavoriteNote = state.personal.favorites[item.id]?.note;
  delete state.personal.notes[item.id];
  if (state.personal.favorites[item.id]) delete state.personal.favorites[item.id].note;
  if (!savePersonal()) {
    if (previous !== undefined) state.personal.notes[item.id] = previous;
    if (state.personal.favorites[item.id] && previousFavoriteNote !== undefined) {
      state.personal.favorites[item.id].note = previousFavoriteNote;
    }
    return;
  }
  refreshOpenDetailNoteButton(item);
  closeNoteDialog();
  renderCards();
  showToast('笔记已删除');
}

function openDetails(item) {
  markOpened(item);
  const translation = translationFor(item);
  const translated = usingTranslation(item);
  const related = state.papers
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
      ${item.type === 'paper' ? `<button id="openDetailNote">📝 ${state.personal.notes[item.id] ? '编辑笔记 · 已保存' : '写笔记'}</button><button id="cycleRead">${text(readingLabel(item.id))}</button>` : ''}
    </div>
    ${item.type === 'paper' ? '<p class="note-privacy">笔记仅保存在当前浏览器，不进入公开收藏。</p>' : ''}
    <h4>关联文献</h4>
    <div class="related-list">${related.length ? related.map(({ candidate, score }) => `<a class="related-item" href="${text(candidate.url)}" target="_blank" rel="noreferrer">${text(candidate.title)}<small>${text(candidate.source)} · 关联度 ${score}</small></a>`).join('') : '<p>当前历史库中尚无明显关联文献。</p>'}</div>
  `;
  $('.dialog-head button', host).addEventListener('click', () => $('#detailDialog').close());
  $('#copyDoi', host)?.addEventListener('click', () => copyText(item.doi, 'DOI 已复制'));
  $('#toggleDetailTranslation', host)?.addEventListener('click', () => {
    if (translated) state.translatedIds.delete(item.id);
    else state.translatedIds.add(item.id);
    renderCards();
    openDetails(item);
  });
  $('#openCitationFromDetail', host).addEventListener('click', () => openCitationDialog(item));
  $('#openDetailNote', host)?.addEventListener('click', () => openNoteDialog(item));
  $('#cycleRead', host)?.addEventListener('click', () => {
    cycleReadingStatus(item);
    $('#cycleRead', host).textContent = readingLabel(item.id);
  });
  if (!$('#detailDialog').open) $('#detailDialog').showModal();
}

function renderCategories() {
  const counts = new Map();
  state.papers.forEach(item => (item.categories || []).forEach(id => counts.set(id, (counts.get(id) || 0) + 1)));
  const host = $('#categoryList');
  host.replaceChildren();
  const all = document.createElement('button');
  all.className = 'category-button';
  all.dataset.category = 'all';
  all.innerHTML = `<span class="cat-icon">◎</span><span>全部领域</span><span class="cat-count">${state.papers.length}</span>`;
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

  orderedIds.filter(id => !hidden.has(id)).forEach(id => {
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
  savePaperLayout();
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

function renderAssistantPaperDetail(item) {
  const host = $('#assistantPaperDetail');
  const facts = extractPaperFacts(item);
  const related = state.papers
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
      </dl>
      <div class="paper-identifiers">${identifiers.length ? identifiers.map(value => `<span>${text(value)}</span>`).join('') : '<span>暂无 DOI/arXiv 编号</span>'}</div>
      <button type="button" class="assistant-cite-button" data-assistant-cite>Cite</button>
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
  $('[data-assistant-cite]', host).addEventListener('click', () => openCitationDialog(item));
  $$('[data-related-paper]', host).forEach(button => button.addEventListener('click', () => {
    const candidate = state.papers.find(value => value.id === button.dataset.relatedPaper);
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

  const selected = state.selectedPaperId ? state.papers.find(item => item.id === state.selectedPaperId) : null;
  $('#assistantOverview').hidden = Boolean(selected);
  $('#assistantPaperDetail').hidden = !selected;
  $('#assistantBackToOverview').hidden = !selected;
  $('#assistantKicker').textContent = selected ? 'SELECTED PAPER' : 'PAPER COMPANION';
  $('#assistantTitle').textContent = selected ? '论文信息' : '论文助手';
  $('#assistantIntro').textContent = selected ? '右侧只展示原始元数据与从题目、摘要中明确识别的科研要素。' : '只解释当前论文结果，不再重复首页新闻。';
  if (selected) renderAssistantPaperDetail(selected);
}

function selectPaperForAssistant(item) {
  state.selectedPaperId = item.id;
  renderCards();
  openPaperAssistant();
}

function showAssistantOverview() {
  state.selectedPaperId = '';
  renderCards();
}

function openPaperAssistant() {
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
  renderCategories();
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
  const article = document.createElement('article');
  article.className = 'home-featured-card';
  const categories = (item.categories || []).slice(0, 3).map(id => `<span>${text(categoryName(id))}</span>`).join('');
  const authors = item.authors?.length ? item.authors.join(', ') : '';
  const abstract = localizedAbstract(item) || '该原始来源暂未公开摘要；本站不会生成或杜撰摘要。';
  article.innerHTML = `
    <div class="home-featured-meta"><strong>${text(homeJournalLabel(item))}</strong><span>${text(prettyDate(item.published))}</span></div>
    <h3><a href="${text(item.url || '#')}" target="_blank" rel="noreferrer">${text(localizedTitle(item))}</a></h3>
    ${authors ? `<p class="home-featured-authors">${text(authors)}</p>` : ''}
    <div class="home-featured-abstract"><b>${item.abstract || item.summary ? (usingTranslation(item) ? '中文翻译' : '完整摘要') : '摘要状态'}</b><p>${text(abstract)}</p></div>
    <div class="home-featured-foot"><div>${categories}</div><a href="${text(item.url || '#')}" target="_blank" rel="noreferrer">阅读原文 ↗</a></div>`;
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
  const featured = [...state.papers, ...state.news]
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
  article.innerHTML = `
    <div class="daily-notice-card-top">
      <span class="notice-kind">${text(category.icon)} ${text(category.label)}</span>
      <div>${isFresh ? '<b class="notice-fresh">今日发现</b>' : ''}${deadlineLabel ? `<b class="notice-deadline ${text(deadline.kind)}">${text(deadlineLabel)}</b>` : ''}</div>
    </div>
    <h3><a href="${text(item.url || '#')}" target="_blank" rel="noreferrer">${text(localizedTitle(item))}</a></h3>
    <p>${text(truncate(localizedAbstract(item), 320) || '官方列表页未提供简介；点开原文可查看申请条件、时间与附件。')}</p>
    <footer>
      <div><b>${text(item.source || '官方来源')}</b><span>${text(item.scope || '')}</span><time>${text(prettyDate(item.published))}</time></div>
      <a href="${text(item.url || '#')}" target="_blank" rel="noreferrer">查看官方原文 ↗</a>
    </footer>`;
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
    if (state.noticeCategory !== 'all' && item.notice_category !== state.noticeCategory) return false;
    if (state.noticeTiming === 'today' && noticeFirstSeenDay(item) !== runDay) return false;
    if (state.noticeTiming === 'open' && !['open', 'soon'].includes(deadlineState(item).kind)) return false;
    if (state.noticeTiming === '7days' && noticePublishedDay(item) < weekDay) return false;
    if (query) {
      const translation = translationFor(item);
      const haystack = [item.title, item.summary, translation?.title_zh, translation?.abstract_zh, item.source, item.scope, noticeCategoryInfo(item.notice_category).label]
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
  const categories = [{ id: 'all', label: '全部通知', icon: '🌿' }, ...(state.noticePortals.categories || [])];
  const counts = new Map();
  state.notices.forEach(item => counts.set(item.notice_category, (counts.get(item.notice_category) || 0) + 1));
  host.replaceChildren(...categories.map(category => {
    const button = document.createElement('button');
    const count = category.id === 'all' ? state.notices.length : (counts.get(category.id) || 0);
    button.type = 'button';
    button.className = state.noticeCategory === category.id ? 'active' : '';
    button.setAttribute('aria-pressed', String(state.noticeCategory === category.id));
    button.innerHTML = `<span>${text(category.icon)}</span><b>${text(category.label)}</b><small>${count}</small>`;
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
  $('#dailyNoticeResultCount').textContent = `共 ${items.length.toLocaleString('zh-CN')} 条`;
  $('#dailyNoticeList').replaceChildren(...items.slice(0, state.noticeVisible).map(dailyNoticeCard));
  if (!items.length) {
    $('#dailyNoticeList').innerHTML = '<div class="daily-notice-empty"><span>🌱</span><b>暂无匹配通知</b><p>可切换分类或清空搜索条件。</p></div>';
  }
  $('#dailyNoticeMore').hidden = items.length <= state.noticeVisible;

  const deadlineItems = openItems
    .filter(item => state.noticeCategory === 'all' || item.notice_category === state.noticeCategory)
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
  const translatedCount = Object.keys(state.translations).length;
  $('#dailyPaperCount').textContent = allItems.length.toLocaleString('zh-CN');
  $('#dailyNuclearCount').textContent = items.length.toLocaleString('zh-CN');
  $('#dailyJournalCount').textContent = journalCount.toLocaleString('zh-CN');
  $('#dailyPreprintCount').textContent = preprintCount.toLocaleString('zh-CN');
  $('#briefingSummary').textContent = items.length
    ? `今日共收录 ${allItems.length} 篇论文，其中 ${items.length} 篇属于核物理相关分类：期刊论文 ${journalCount} 篇、预印本 ${preprintCount} 篇。重点文章仅从 PRL、Nature、Science、Nature Physics 与 Nature Communications 中筛选。当前已有 ${translatedCount} 篇 Codex 中文译文。`
    : '尚无可用的当日元数据。';

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
  $('#paperCount').textContent = state.papers.length.toLocaleString('zh-CN');
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
      state.personal.outbox.push({ operation: 'keywords', keywords: state.personal.keywords, at: new Date().toISOString() });
      savePersonal(); renderKeywords(); renderCards(); tryFavoriteSync();
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
  showToast(existing ? '已更新指定译法' : '已保存指定译法');
}

function exportPersonal() {
  const blob = new Blob([JSON.stringify(state.personal, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `小康康的物理世界-个人备份-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function importPersonal(file) {
  try {
    const value = JSON.parse(await file.text());
    if (!value || typeof value !== 'object') throw new Error('备份格式错误');
    const favorites = value.favorites && typeof value.favorites === 'object' ? value.favorites : {};
    const notes = value.notes && typeof value.notes === 'object' ? value.notes : {};
    Object.entries(favorites).forEach(([id, record]) => {
      if (!record || typeof record !== 'object') return;
      if (!notes[id] && typeof record.note === 'string' && record.note.trim()) notes[id] = record.note;
      delete record.note;
      record.keywords = uniqueKeywords(record.keywords || []);
    });
    state.personal = {
      favorites, keywords: Array.isArray(value.keywords) ? uniqueKeywords(value.keywords) : [],
      outbox: Array.isArray(value.outbox) ? value.outbox.map(publicSyncEvent).filter(Boolean) : [],
      readStatus: value.readStatus || {}, notes,
      translationFavorites: value.translationFavorites && typeof value.translationFavorites === 'object' ? value.translationFavorites : {},
      translationGlossary: normalizeTranslationGlossary(value.translationGlossary),
      codeItems: Array.isArray(value.codeItems) ? value.codeItems : [],
      resources: Array.isArray(value.resources) ? value.resources : [],
      hiddenPublicFavorites: Array.isArray(value.hiddenPublicFavorites) ? value.hiddenPublicFavorites : [],
    };
    savePersonal(); renderKeywords(); renderCards(); renderHomeHub();
  } catch (error) {
    alert(`无法导入备份：${error.message}`);
  }
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
  showToast('已保存到我的科研空间');
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
  $('#loadMore').addEventListener('click', () => { state.visible += 20; renderCards(); });
  $('#keywordButton').addEventListener('click', () => $('#keywordDialog').showModal());
  $('#addKeywordAside').addEventListener('click', () => $('#keywordDialog').showModal());
  $('#keywordForm').addEventListener('submit', event => {
    event.preventDefault();
    const input = $('#keywordInput');
    const value = input.value.trim();
    if (value && !state.personal.keywords.includes(value)) {
      state.personal.keywords.push(value);
      state.personal.outbox.push({ operation: 'keywords', keywords: state.personal.keywords, at: new Date().toISOString() });
      savePersonal(); renderKeywords(); renderCards(); tryFavoriteSync();
    }
    input.value = '';
  });
  $('#exportPersonal').addEventListener('click', exportPersonal);
  $('#importPersonal').addEventListener('change', event => event.target.files?.[0] && importPersonal(event.target.files[0]));
  $('#favoriteForm').addEventListener('submit', event => { event.preventDefault(); saveFavoriteDraft(); });
  $('#cancelFavorite').addEventListener('click', closeFavoriteDialog);
  $('#cancelFavoriteBottom').addEventListener('click', closeFavoriteDialog);
  $('#noteForm').addEventListener('submit', event => { event.preventDefault(); saveNoteDraft(); });
  $('#noteInput').addEventListener('input', updateNoteCount);
  $('#closeNote').addEventListener('click', closeNoteDialog);
  $('#cancelNote').addEventListener('click', closeNoteDialog);
  $('#deleteNote').addEventListener('click', deleteNoteDraft);
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
  window.addEventListener('online', tryFavoriteSync);
}

async function loadData() {
  const files = ['meta', 'papers', 'featured', 'news', 'notices', 'public-favorites', 'notice-portals', 'translations.zh-CN'];
  const responses = await Promise.all(files.map(async name => {
    const response = await fetch(`./data/${name}.json`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    return response.json();
  }));
  const translationPayload = responses.pop();
  [state.meta, state.papers, state.featured, state.news, state.notices, state.publicFavorites, state.noticePortals] = responses;
  state.translations = translationPayload.items || {};
  Object.keys(state.translations).forEach(id => state.translatedIds.add(id));
  state.meta.categories.forEach(category => state.categoryMap.set(category.id, category));
  configureDateRangeInputs();
  if (state.meta.site.repository_url) $('#repoLink').href = state.meta.site.repository_url;
  else $('#repoLink').hidden = true;
}

async function initialize() {
  bindEvents();
  try {
    await loadData();
    renderCategories(); renderSourceOptions(); renderHomeHub(); renderBriefing(); renderMetrics(); renderKeywords(); renderHomeDashboard(); renderNoticePortal();
    const hash = location.hash.slice(1);
    const myMatch = hash.match(/^favorites-(papers|translations|code|references)$/);
    if (myMatch) {
      state.mySection = myMatch[1];
      setView('favorites');
    } else {
      setView(['home', 'papers', 'featured', 'news', 'notices', 'favorites', 'unread'].includes(hash) ? hash : 'home');
    }
    tryFavoriteSync();
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

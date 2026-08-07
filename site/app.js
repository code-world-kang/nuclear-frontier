const PATH = new URL('.', window.location.href).pathname;
const PERSONAL_KEY = 'nuclear-frontier.personal.v1';

const state = {
  papers: [], featured: [], news: [], notices: [], publicFavorites: [],
  meta: null, view: 'papers', category: 'all', query: '', sort: 'date', visible: 20,
  personal: loadPersonal(), categoryMap: new Map(),
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function loadPersonal() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PERSONAL_KEY) || '{}');
    return {
      favorites: parsed.favorites || {},
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
      outbox: Array.isArray(parsed.outbox) ? parsed.outbox : [],
    };
  } catch {
    return { favorites: {}, keywords: [], outbox: [] };
  }
}

function savePersonal() {
  localStorage.setItem(PERSONAL_KEY, JSON.stringify(state.personal));
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

function relativeUpdate(value) {
  if (!value) return '尚未完成首次更新';
  const date = new Date(value);
  return `数据更新于 ${new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date)}`;
}

function truncate(value, length = 260) {
  if (!value) return '';
  return value.length > length ? `${value.slice(0, length).trim()}…` : value;
}

function currentItems() {
  if (state.view === 'featured') return state.featured;
  if (state.view === 'news') return state.news;
  if (state.view === 'notices') return state.notices;
  if (state.view === 'favorites') {
    const ids = new Set([
      ...Object.keys(state.personal.favorites),
      ...state.publicFavorites.map(item => typeof item === 'string' ? item : item.id),
    ]);
    return state.papers.filter(item => ids.has(item.id));
  }
  return state.papers;
}

function personalMatch(item) {
  if (!state.personal.keywords.length) return false;
  const haystack = [item.title, item.abstract, item.summary, item.source, ...(item.tags || []), ...(item.authors || [])].join(' ').toLowerCase();
  return state.personal.keywords.some(keyword => haystack.includes(keyword.toLowerCase()));
}

function filteredItems() {
  const query = state.query.trim().toLowerCase();
  const values = currentItems().filter(item => {
    if (state.category !== 'all' && !(item.categories || []).includes(state.category)) return false;
    if (!query) return true;
    const haystack = [
      item.title, item.abstract, item.summary, item.source, item.source_short,
      item.doi, item.arxiv_id, ...(item.authors || []), ...(item.tags || []),
      ...(item.categories || []).map(id => state.categoryMap.get(id)?.name || id),
    ].join(' ').toLowerCase();
    return query.split(/\s+/).every(term => haystack.includes(term));
  });

  values.sort((a, b) => {
    const personalDelta = Number(personalMatch(b)) - Number(personalMatch(a));
    if (personalDelta) return personalDelta;
    if (state.sort === 'importance') return (b.importance || 0) - (a.importance || 0) || (b.published || '').localeCompare(a.published || '');
    if (state.sort === 'source') return (a.source || '').localeCompare(b.source || '') || (b.published || '').localeCompare(a.published || '');
    return (b.published || '').localeCompare(a.published || '') || (b.importance || 0) - (a.importance || 0);
  });
  return values;
}

function categoryName(id) {
  return state.categoryMap.get(id)?.name || id || '其他前沿';
}

function isFavorite(id) {
  return Boolean(state.personal.favorites[id]) || state.publicFavorites.some(item => (typeof item === 'string' ? item : item.id) === id);
}

function cardFor(item) {
  const template = $('#paperCardTemplate');
  const card = template.content.firstElementChild.cloneNode(true);
  const primary = item.categories?.[0] || 'frontiers';
  card.dataset.id = item.id;
  card.dataset.primary = primary;
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
  titleLink.textContent = item.title;
  heading.append(titleLink);

  const authors = $('.authors', card);
  authors.textContent = item.authors?.length ? item.authors.join(', ') : item.source;
  if (!item.authors?.length && item.type !== 'paper') authors.hidden = true;

  const abstract = $('.abstract', card);
  abstract.textContent = truncate(item.abstract || item.summary || '该数据源未提供可公开摘要。');

  const tags = $('.tag-row', card);
  (item.categories || []).slice(0, 2).forEach(id => {
    const tag = document.createElement('span');
    tag.className = 'tag category';
    tag.textContent = categoryName(id);
    tags.append(tag);
  });
  (item.tags || []).slice(0, 3).forEach(value => {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = value;
    tags.append(tag);
  });

  const actions = $('.paper-actions', card);
  const original = document.createElement('a');
  original.href = item.url || '#';
  original.target = '_blank';
  original.rel = 'noreferrer';
  original.textContent = item.type === 'paper' ? '原始页面 ↗' : '阅读原文 ↗';
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
  const related = document.createElement('button');
  related.type = 'button';
  related.className = 'related-button';
  related.textContent = '关联文献';
  related.addEventListener('click', () => openDetails(item));
  actions.append(related);

  const favorite = $('.favorite-button', card);
  favorite.textContent = isFavorite(item.id) ? '★' : '☆';
  favorite.classList.toggle('active', isFavorite(item.id));
  favorite.setAttribute('aria-pressed', String(isFavorite(item.id)));
  favorite.addEventListener('click', () => toggleFavorite(item, favorite));
  return card;
}

function renderCards() {
  const items = filteredItems();
  const list = $('#cardList');
  list.replaceChildren(...items.slice(0, state.visible).map(cardFor));
  $('#resultCount').textContent = `共 ${items.length.toLocaleString('zh-CN')} 条结果`;
  $('#emptyState').hidden = items.length !== 0;
  $('#loadMore').hidden = items.length <= state.visible;
  renderActiveFilters();
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
  state.personal.keywords.forEach(keyword => {
    const tag = document.createElement('button');
    tag.className = 'active-filter';
    tag.textContent = `关注：${keyword}`;
    tag.addEventListener('click', () => {
      $('#searchInput').value = keyword;
      state.query = keyword;
      renderCards();
    });
    host.append(tag);
  });
}

function setView(view) {
  state.view = view;
  state.visible = 20;
  const labels = {
    papers: ['LATEST PAPERS', '最新论文', '题目与摘要保留原文'],
    featured: ['EDITOR\'S RADAR', '重点文献', '基于来源、新颖性与关注词评分'],
    news: ['OFFICIAL NEWS', '科研新闻', '仅保留官方原始链接'],
    notices: ['OFFICIAL NOTICES', '官方通知', '截止日期请以原始通知为准'],
    favorites: ['KEY REFERENCES', '我的重点参考', '本机收藏与GitHub公开收藏合并显示'],
  };
  const [kicker, title, note] = labels[view] || labels.papers;
  $('#sectionKicker').textContent = kicker;
  $('#sectionTitle').textContent = title;
  $('#viewNote').textContent = note;
  $$('.nav-link, .view-tab').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  renderCards();
  history.replaceState(null, '', `${PATH}#${view}`);
}

function setCategory(id) {
  state.category = id;
  state.visible = 20;
  $$('.category-button').forEach(button => button.classList.toggle('active', button.dataset.category === id));
  renderCards();
}

async function toggleFavorite(item, button) {
  if (state.personal.favorites[item.id]) {
    delete state.personal.favorites[item.id];
    state.personal.outbox.push({ operation: 'remove', id: item.id, at: new Date().toISOString() });
  } else {
    state.personal.favorites[item.id] = {
      id: item.id, doi: item.doi || '', arxiv_id: item.arxiv_id || '', title: item.title,
      url: item.url, categories: item.categories || [], tags: item.tags || [],
      added_at: new Date().toISOString(), note: '',
    };
    state.personal.outbox.push({ operation: 'upsert', item: state.personal.favorites[item.id], at: new Date().toISOString() });
  }
  savePersonal();
  const active = isFavorite(item.id);
  button.textContent = active ? '★' : '☆';
  button.classList.toggle('active', active);
  button.setAttribute('aria-pressed', String(active));
  await tryFavoriteSync();
  if (state.view === 'favorites') renderCards();
}

async function tryFavoriteSync() {
  const runtime = state.meta?.site;
  if (!runtime?.favorite_sync_enabled || !runtime.favorite_sync_endpoint || !state.personal.outbox.length) return;
  try {
    const response = await fetch(runtime.favorite_sync_endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: state.personal.outbox }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.personal.outbox = [];
    savePersonal();
  } catch (error) {
    console.warn('收藏同步将在下次联网时重试', error);
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

function openDetails(item) {
  const related = state.papers
    .map(candidate => ({ candidate, score: similarity(item, candidate) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || (b.candidate.published || '').localeCompare(a.candidate.published || ''))
    .slice(0, 6);
  const host = $('#detailContent');
  host.innerHTML = `
    <div class="dialog-head"><div><small>${text(item.source || '')}</small><h3>文献详情与关联</h3></div><button aria-label="关闭">×</button></div>
    <h2>${text(item.title)}</h2>
    <p class="detail-meta">${text((item.authors || []).join(', ') || item.source || '')}<br>${text(prettyDate(item.published))}${item.doi ? ` · DOI ${text(item.doi)}` : ''}</p>
    <div class="tag-row">${(item.categories || []).map(id => `<span class="tag category">${text(categoryName(id))}</span>`).join('')}</div>
    <h4>原文摘要</h4>
    <p class="detail-abstract">${text(item.abstract || item.summary || '该来源未提供可公开摘要。')}</p>
    <h4>关联文献</h4>
    <div class="related-list">${related.length ? related.map(({ candidate, score }) => `<a class="related-item" href="${text(candidate.url)}" target="_blank" rel="noreferrer">${text(candidate.title)}<small>${text(candidate.source)} · 关联度 ${score}</small></a>`).join('') : '<p>当前历史库中尚无明显关联文献。</p>'}</div>
  `;
  $('.dialog-head button', host).addEventListener('click', () => $('#detailDialog').close());
  $('#detailDialog').showModal();
}

function renderCategories() {
  const counts = new Map();
  state.papers.forEach(item => (item.categories || []).forEach(id => counts.set(id, (counts.get(id) || 0) + 1)));
  const host = $('#categoryList');
  const all = document.createElement('button');
  all.className = 'category-button active';
  all.dataset.category = 'all';
  all.innerHTML = `<span class="cat-icon">◎</span><span>全部领域</span><span class="cat-count">${state.papers.length}</span>`;
  host.append(all);
  state.meta.categories.forEach(category => {
    const button = document.createElement('button');
    button.className = 'category-button';
    button.dataset.category = category.id;
    button.innerHTML = `<span class="cat-icon">${text(category.icon)}</span><span>${text(category.name)}</span><span class="cat-count">${counts.get(category.id) || 0}</span>`;
    host.append(button);
  });
  $$('.category-button', host).forEach(button => button.addEventListener('click', () => setCategory(button.dataset.category)));
}

function renderSpotlight() {
  const item = state.featured[0] || state.papers[0];
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

function renderRadar() {
  const items = [...state.notices.slice(0, 3), ...state.news.slice(0, 2)].slice(0, 5);
  const host = $('#radarList');
  host.replaceChildren(...items.map(item => {
    const link = document.createElement('a');
    link.className = 'radar-item';
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.innerHTML = `<small><span>${text(item.source)}</span><span>${text(prettyDate(item.published))}</span></small><b>${text(item.title)}</b>`;
    return link;
  }));
}

function renderMetrics() {
  const status = state.meta.status;
  $('#paperCount').textContent = state.papers.length.toLocaleString('zh-CN');
  $('#featuredCount').textContent = state.featured.length.toLocaleString('zh-CN');
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
    <div class="status-row"><span>${text(item.name)}<small> · ${text(item.kind)} · ${item.count} 条</small></span><span class="${item.ok ? 'ok' : 'fail'}">${item.ok ? '正常' : '待重试'}</span></div>
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

function exportPersonal() {
  const blob = new Blob([JSON.stringify(state.personal, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `核视界-收藏备份-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function importPersonal(file) {
  try {
    const value = JSON.parse(await file.text());
    if (!value || typeof value !== 'object') throw new Error('备份格式错误');
    state.personal = {
      favorites: value.favorites || {}, keywords: Array.isArray(value.keywords) ? value.keywords : [],
      outbox: Array.isArray(value.outbox) ? value.outbox : [],
    };
    savePersonal(); renderKeywords(); renderCards();
  } catch (error) {
    alert(`无法导入备份：${error.message}`);
  }
}

function bindEvents() {
  $$('.nav-link, .view-tab').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
  $$('[data-view-jump]').forEach(button => button.addEventListener('click', () => {
    setView(button.dataset.viewJump); $('#stream').scrollIntoView({ behavior: 'smooth' });
  }));
  $('[data-scroll="stream"]').addEventListener('click', () => $('#stream').scrollIntoView({ behavior: 'smooth' }));
  $('#clearCategory').addEventListener('click', () => setCategory('all'));
  $('#searchInput').addEventListener('input', event => { state.query = event.target.value; state.visible = 20; renderCards(); });
  $('#sortSelect').addEventListener('change', event => { state.sort = event.target.value; renderCards(); });
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
  $('#showSourceStatus').addEventListener('click', showStatus);
  document.addEventListener('keydown', event => {
    if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
      event.preventDefault(); $('#searchInput').focus();
    }
  });
  window.addEventListener('online', tryFavoriteSync);
}

async function loadData() {
  const files = ['meta', 'papers', 'featured', 'news', 'notices', 'public-favorites'];
  const responses = await Promise.all(files.map(async name => {
    const response = await fetch(`./data/${name}.json`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    return response.json();
  }));
  [state.meta, state.papers, state.featured, state.news, state.notices, state.publicFavorites] = responses;
  state.meta.categories.forEach(category => state.categoryMap.set(category.id, category));
  if (state.meta.site.repository_url) $('#repoLink').href = state.meta.site.repository_url;
  else $('#repoLink').hidden = true;
}

async function initialize() {
  bindEvents();
  try {
    await loadData();
    renderCategories(); renderSpotlight(); renderRadar(); renderMetrics(); renderKeywords();
    const hash = location.hash.slice(1);
    setView(['papers', 'featured', 'news', 'notices', 'favorites'].includes(hash) ? hash : 'papers');
    tryFavoriteSync();
  } catch (error) {
    console.error(error);
    $('#cardList').innerHTML = `<div class="empty-state"><b>数据暂时无法载入</b><p>${text(error.message)}。请稍后刷新。</p></div>`;
    $('#lastUpdated').textContent = '数据加载失败';
  }
}

initialize();

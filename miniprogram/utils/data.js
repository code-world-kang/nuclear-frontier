const BASE_URL = 'https://code-world-kang.github.io/nuclear-frontier/data';
const CACHE_PREFIX = 'nuclear-frontier-public-cache:';

const ENDPOINTS = {
  papers: 'papers.json',
  featured: 'featured.json',
  news: 'news.json',
  notices: 'notices.json',
  translations: 'translations.zh-CN.json',
  meta: 'meta.json',
  status: 'status.json',
  personal: 'personal-state.json',
  resources: 'reference-resources.json'
};

const memoryCache = {};

function requestJson(name, options = {}) {
  const endpoint = ENDPOINTS[name];
  if (!endpoint) return Promise.reject(new Error(`未知数据集：${name}`));
  if (!options.refresh && memoryCache[name]) return Promise.resolve(memoryCache[name]);

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}/${endpoint}?v=${Date.now()}`,
      method: 'GET',
      timeout: 15000,
      success(response) {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        memoryCache[name] = response.data;
        try { wx.setStorageSync(`${CACHE_PREFIX}${name}`, response.data); } catch (error) { /* 公开数据缓存失败不影响阅读 */ }
        resolve(response.data);
      },
      fail(error) {
        try {
          const cached = wx.getStorageSync(`${CACHE_PREFIX}${name}`);
          if (cached) {
            memoryCache[name] = cached;
            resolve(cached);
            return;
          }
        } catch (cacheError) { /* 继续返回原始网络错误 */ }
        reject(new Error(error.errMsg || '数据请求失败'));
      }
    });
  });
}

function loadBundle(names, options = {}) {
  return Promise.all(names.map(name => requestJson(name, options)))
    .then(values => names.reduce((result, name, index) => {
      result[name] = values[index];
      return result;
    }, {}));
}

function translationItems(payload) {
  return payload && payload.items ? payload.items : {};
}

function categoryMap(meta) {
  return ((meta && meta.categories) || []).reduce((result, category) => {
    result[category.id] = category.name;
    return result;
  }, {});
}

function localizedItem(item, translations, categories = {}) {
  const translation = translationItems(translations)[item.id] || {};
  const sourceDescription = item.abstract || item.summary || item.content || '';
  const blockedDescription = /client challenge|couldn.t load|enable javascript and cookies|access denied/i.test(sourceDescription);
  const originalDescription = blockedDescription ? '' : sourceDescription;
  const chineseDescription = translation.abstract_zh || '';
  const categoryIds = item.categories || [];
  return Object.assign({}, item, {
    titleZh: translation.title_zh || '',
    descriptionZh: chineseDescription,
    displayTitle: translation.title_zh || item.title || '未命名条目',
    displayDescription: chineseDescription || originalDescription || '该官方来源暂未提供可公开介绍，可进入详情复制原文链接查看。',
    originalDescription,
    hasTranslation: Boolean(translation.title_zh || translation.abstract_zh),
    categoryNames: categoryIds.map(id => categories[id] || id),
    dateLabel: item.published || item.updated || '',
    sourceLabel: item.source_short || item.source || '未知来源'
  });
}

function localizeList(items, translations, meta) {
  const categories = categoryMap(meta);
  return (items || []).map(item => localizedItem(item, translations, categories));
}

function sortNewest(items) {
  return [...(items || [])].sort((a, b) => {
    const dateOrder = String(b.published || b.updated || '').localeCompare(String(a.published || a.updated || ''));
    return dateOrder || Number(b.importance || 0) - Number(a.importance || 0);
  });
}

function matches(item, keyword) {
  const query = String(keyword || '').trim().toLocaleLowerCase('zh-CN');
  if (!query) return true;
  const values = [
    item.title, item.titleZh, item.abstract, item.summary, item.content,
    item.descriptionZh, item.source, item.source_short,
    ...(item.authors || []), ...(item.tags || []), ...(item.categoryNames || [])
  ];
  return values.some(value => String(value || '').toLocaleLowerCase('zh-CN').includes(query));
}

function findById(items, id) {
  return (items || []).find(item => String(item.id) === String(id)) || null;
}

module.exports = {
  BASE_URL,
  categoryMap,
  findById,
  loadBundle,
  localizeList,
  localizedItem,
  matches,
  requestJson,
  sortNewest,
  translationItems
};

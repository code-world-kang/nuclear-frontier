import { getStore } from '@edgeone/pages-blob';

const STORE_NAME = 'nuclear-frontier-personal';
const STATE_KEY = 'state/current.json';
const MAX_BODY_BYTES = 2 * 1024 * 1024;

const PERSONAL_OBJECT_FIELDS = ['favorites', 'readStatus', 'notes', 'translationFavorites'];
const PERSONAL_LIST_FIELDS = [
  'keywords', 'translationGlossary', 'codeItems', 'resources',
  'hiddenPublicFavorites', 'ignoredItems',
];
const LAYOUT_LIST_FIELDS = ['categoryOrder', 'hiddenCategories', 'moduleOrder'];

function emptyState() {
  return {
    version: 1,
    updated_at: '',
    personal: {
      favorites: {}, readStatus: {}, notes: {}, translationFavorites: {},
      keywords: [], translationGlossary: [], codeItems: [], resources: [],
      hiddenPublicFavorites: [], ignoredItems: [],
    },
    paperLayout: {},
    googleTranslations: {},
  };
}

export function cleanState(payload) {
  const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const inputPersonal = source.personal && typeof source.personal === 'object' && !Array.isArray(source.personal)
    ? source.personal : {};
  const personal = {};
  PERSONAL_OBJECT_FIELDS.forEach(key => {
    const value = inputPersonal[key];
    personal[key] = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  });
  PERSONAL_LIST_FIELDS.forEach(key => {
    personal[key] = Array.isArray(inputPersonal[key]) ? inputPersonal[key] : [];
  });
  const inputLayout = source.paperLayout && typeof source.paperLayout === 'object' && !Array.isArray(source.paperLayout)
    ? source.paperLayout : {};
  const paperLayout = {};
  LAYOUT_LIST_FIELDS.forEach(key => {
    if (Array.isArray(inputLayout[key])) paperLayout[key] = inputLayout[key].map(String);
  });
  const googleTranslations = source.googleTranslations
    && typeof source.googleTranslations === 'object'
    && !Array.isArray(source.googleTranslations) ? source.googleTranslations : {};
  return {
    version: 1,
    updated_at: new Date().toISOString(),
    personal,
    paperLayout,
    googleTranslations,
  };
}

function envValue(context, name) {
  return String(context?.env?.[name] || '');
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Nuclear-Frontier-Cloud': 'edgeone',
      ...extraHeaders,
    },
  });
}

function isAuthorized(request, context) {
  const expected = envValue(context, 'PERSONAL_SYNC_SECRET');
  const received = String(request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  return Boolean(expected && received && expected === received);
}

export async function onRequest(context) {
  const { request } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { Allow: 'GET, PUT, OPTIONS' } });
  }
  const store = getStore({ name: STORE_NAME, consistency: 'strong' });
  if (request.method === 'GET') {
    const saved = await store.get(STATE_KEY, { type: 'json', consistency: 'strong' });
    return json(saved || emptyState());
  }
  if (request.method !== 'PUT') return json({ error: '仅支持 GET 和 PUT' }, 405, { Allow: 'GET, PUT, OPTIONS' });
  if (!envValue(context, 'PERSONAL_SYNC_SECRET')) {
    return json({ error: '云同步密码尚未在 EdgeOne 环境变量中配置' }, 503);
  }
  if (!isAuthorized(request, context)) return json({ error: '同步密码不正确' }, 401);
  const declaredLength = Number(request.headers.get('Content-Length') || 0);
  if (declaredLength > MAX_BODY_BYTES) return json({ error: '个人数据超过 2 MB 限制' }, 413);
  let payload;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return json({ error: '个人数据超过 2 MB 限制' }, 413);
    payload = JSON.parse(raw);
  } catch {
    return json({ error: '请求体不是有效 JSON' }, 400);
  }
  const cleaned = cleanState(payload);
  await store.setJSON(STATE_KEY, cleaned);
  return json({ ok: true, state: cleaned });
}

export default onRequest;

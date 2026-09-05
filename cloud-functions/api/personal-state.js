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

export async function handleRequest(context, store) {
  const { request } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { Allow: 'GET, PUT, OPTIONS' } });
  }
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
  if (payload?.version !== 1 || !payload.personal || typeof payload.personal !== 'object' || Array.isArray(payload.personal)) {
    return json({ error: '个人快照结构不完整，没有覆盖云端数据' }, 400);
  }
  const cleaned = cleanState(payload);
  const previous = await store.get(STATE_KEY, { type: 'json', consistency: 'strong' });
  if (previous?.updated_at && payload.base_updated_at !== previous.updated_at) {
    return json({ error: '云端已有另一份修改。请先导出当前副本，再刷新合并；本次没有覆盖云端。' }, 409);
  }
  // 保存覆盖前的版本。时间戳校验能发现过时客户端，但不是数据库级原子事务。
  // 保留旧版本用于恢复；跨设备同时写入仍应改用支持事务的存储后再开放并发编辑。
  if (previous?.updated_at) {
    const version = String(previous.updated_at).replace(/[^0-9A-Za-z.-]/g, '-');
    await store.setJSON(`history/${version}.json`, previous);
  }
  await store.setJSON(STATE_KEY, cleaned);
  return json({ ok: true, state: cleaned });
}

export async function onRequest(context) {
  const store = getStore({ name: STORE_NAME, consistency: 'strong' });
  return handleRequest(context, store);
}

export default onRequest;

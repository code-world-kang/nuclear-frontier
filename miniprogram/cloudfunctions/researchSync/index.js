const crypto = require('crypto');
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const USER_COLLECTION = 'research_user_states';
const ZOTERO_COLLECTION = 'zotero_queue';
const ALLOWED_TYPES = new Set(['favorite', 'ignored', 'note', 'keywords', 'zotero']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function cleanText(value, limit = 500) {
  return String(value || '').trim().slice(0, limit);
}

function cleanId(value) {
  const id = cleanText(value, 180);
  return id && !FORBIDDEN_KEYS.has(id) ? id : '';
}

function cleanTags(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(value => cleanText(value, 80))
    .filter(Boolean))].slice(0, 30);
}

function emptyState() {
  return { favorites: {}, ignored: {}, notes: {}, keywords: {}, updatedAt: '' };
}

function safeMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  Object.entries(value).slice(0, 5000).forEach(([key, item]) => {
    const id = cleanId(key);
    if (id) result[id] = item;
  });
  return result;
}

function normalizeState(value) {
  const state = emptyState();
  state.favorites = safeMap(value && value.favorites);
  state.ignored = safeMap(value && value.ignored);
  state.notes = safeMap(value && value.notes);
  state.keywords = safeMap(value && value.keywords);
  state.updatedAt = cleanText(value && value.updatedAt, 40);
  return state;
}

function cleanOperation(value) {
  if (!value || typeof value !== 'object') return null;
  const id = cleanText(value.id, 120);
  const type = cleanText(value.type, 30);
  const itemId = cleanId(value.itemId);
  if (!id || !itemId || !ALLOWED_TYPES.has(type)) return null;
  return {
    id,
    type,
    itemId,
    payload: value.payload && typeof value.payload === 'object' ? value.payload : {},
    createdAt: cleanText(value.createdAt, 40)
  };
}

function cleanRecord(operation, timeKey) {
  const source = operation.payload.record || {};
  return {
    id: operation.itemId,
    type: cleanText(source.type, 30) || 'paper',
    title: cleanText(source.title, 1000),
    [timeKey]: cleanText(source[timeKey], 40) || new Date().toISOString()
  };
}

async function queueZotero(openid, operation) {
  const payload = operation.payload;
  const key = crypto.createHash('sha256').update(`${openid}:${operation.itemId}`).digest('hex');
  const now = new Date().toISOString();
  await db.collection(ZOTERO_COLLECTION).doc(key).set({
    data: {
      owner: openid,
      itemId: operation.itemId,
      title: cleanText(payload.title, 1000),
      url: cleanText(payload.url, 2000),
      pdfUrl: cleanText(payload.pdfUrl, 2000),
      collection: cleanText(payload.collection, 300),
      tags: cleanTags(payload.tags),
      note: cleanText(payload.note, 12000),
      status: 'pending',
      createdAt: operation.createdAt || now,
      updatedAt: now
    }
  });
}

async function applyOperations(openid, state, operations) {
  let zoteroQueued = 0;
  for (const operation of operations) {
    const { itemId, payload, type } = operation;
    if (type === 'favorite') {
      if (payload.active) state.favorites[itemId] = cleanRecord(operation, 'addedAt');
      else delete state.favorites[itemId];
    } else if (type === 'ignored') {
      if (payload.active) state.ignored[itemId] = cleanRecord(operation, 'ignoredAt');
      else delete state.ignored[itemId];
    } else if (type === 'note') {
      const text = cleanText(payload.text, 12000);
      if (text) state.notes[itemId] = { text, updatedAt: new Date().toISOString() };
      else delete state.notes[itemId];
    } else if (type === 'keywords') {
      const keywords = cleanTags(payload.keywords);
      if (keywords.length) state.keywords[itemId] = keywords;
      else delete state.keywords[itemId];
    } else if (type === 'zotero') {
      await queueZotero(openid, operation);
      zoteroQueued += 1;
    }
  }
  return zoteroQueued;
}

async function readUserState(openid) {
  try {
    const result = await db.collection(USER_COLLECTION).doc(`user-${openid}`).get();
    return normalizeState(result.data);
  } catch (error) {
    if (error && (error.errCode === -1 || /not exist|does not exist/i.test(error.message || ''))) return emptyState();
    throw error;
  }
}

exports.main = async event => {
  const context = cloud.getWXContext();
  const openid = context && context.OPENID;
  if (!openid) return { ok: false, message: '未取得微信用户身份' };

  const action = cleanText(event && event.action, 30);
  if (action === 'ping') return { ok: true, message: '云端同步服务已连接' };
  if (action !== 'sync') return { ok: false, message: '不支持的同步操作' };

  try {
    const raw = event && event.payload && Array.isArray(event.payload.operations)
      ? event.payload.operations.slice(0, 200)
      : [];
    const operations = raw.map(cleanOperation).filter(Boolean);
    const state = await readUserState(openid);
    const zoteroQueued = await applyOperations(openid, state, operations);
    state.updatedAt = new Date().toISOString();
    await db.collection(USER_COLLECTION).doc(`user-${openid}`).set({
      data: Object.assign({ owner: openid }, state)
    });
    return {
      ok: true,
      state,
      acknowledgedIds: operations.map(item => item.id),
      zoteroQueued
    };
  } catch (error) {
    console.error('researchSync failed', error);
    return { ok: false, message: '云端同步失败，请检查数据库集合与云函数部署状态' };
  }
};

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { applyTranslationBatch, loadTranslationFeed } from '../site/translation-feed.js';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const batch = { version: 1, items: { a: { title_zh: '新译文', source_hash: 'new' } }, previous: { a: null } };
const raw = JSON.stringify(batch);
const digest = createHash('sha256').update(raw).digest('hex');

test('增量合并幂等且保留后续人工修改', () => {
  const payload = { items: {} };
  applyTranslationBatch(payload, batch);
  applyTranslationBatch(payload, batch);
  assert.equal(payload.items.a.title_zh, '新译文');
  payload.items.a = { title_zh: '人工编辑' };
  applyTranslationBatch(payload, batch);
  assert.equal(payload.items.a.title_zh, '人工编辑');
});

test('源文变更时保留旧译文版本', () => {
  const old = { source_hash: 'old', title_zh: '旧译文' };
  const payload = { items: { a: old } };
  applyTranslationBatch(payload, { ...batch, previous: { a: old } });
  assert.equal(payload.versions.a.old, old);
  assert.equal(payload.items.a.source_hash, 'new');
});

test('验证批次后才应用；缓存避免重复下载；请求不携带凭据', async () => {
  let batchReads = 0;
  const fetcher = async (url, options) => {
    assert.equal(options.credentials, 'omit');
    if (url.includes('manifest.json')) return new Response(JSON.stringify({ version: 1, batches: [digest] }));
    batchReads++;
    return new Response(raw);
  };
  const initial = { items: {} }, cache = new Map();
  const result = await loadTranslationFeed(initial, { fetcher, cache });
  await loadTranslationFeed(result.payload, { fetcher, cache });
  assert.equal(batchReads, 1);
  assert.deepEqual(initial, { items: {} });
  assert.equal(result.payload.items.a.title_zh, '新译文');
  await assert.rejects(loadTranslationFeed(initial, { fetcher: async url => url.includes('manifest')
    ? new Response(JSON.stringify({ version: 1, batches: [digest] })) : new Response('corrupted') }), /更新不完整/);
  assert.deepEqual(initial, { items: {} });
});

test('非法批次路径不向任意地址请求', async () => {
  let calls = 0;
  await assert.rejects(loadTranslationFeed({ items: {} }, { fetcher: async () => {
    calls++; return new Response(JSON.stringify({ version: 1, batches: ['../../private'] }));
  } }), /索引格式错误/);
  assert.equal(calls, 1);
});

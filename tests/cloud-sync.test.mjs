import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest, cleanState } from '../cloud-functions/api/personal-state.js';

test('云端拒绝过时覆盖，并保存更新前快照', async () => {
  const previous = { ...cleanState({ personal: { favorites: { a: { title: '已有收藏' } } } }), updated_at: '2026-09-01T00:00:00Z' };
  const saved = new Map([['state/current.json', previous]]);
  const store = { get: async key => saved.get(key), setJSON: async (key, value) => saved.set(key, value) };
  const context = payload => ({ env: { PERSONAL_SYNC_SECRET: 'test-only-secret' }, request: new Request('https://example.org/api/personal-state', { method: 'PUT', headers: { Authorization: 'Bearer test-only-secret' }, body: JSON.stringify(payload) }) });
  const denied = await handleRequest(context({ version: 1, personal: {}, base_updated_at: 'old' }), store);
  assert.equal(denied.status, 409);
  assert.equal(saved.get('state/current.json'), previous);
  const next = { version: 1, personal: { favorites: { b: { title: '新收藏' } } }, base_updated_at: previous.updated_at };
  const result = await handleRequest(context(next), store);
  assert.equal(result.status, 200);
  assert.equal(saved.size, 2);
  assert.ok([...saved.keys()].some(key => key.startsWith('history/')));
  assert.ok(saved.get('state/current.json').personal.favorites.b);
});

test('无凭据或无效 JSON 不会写入云端', async () => {
  let writes = 0;
  const store = { get: async () => null, setJSON: async () => writes++ };
  const response = await handleRequest({ env: { PERSONAL_SYNC_SECRET: 'test-only-secret' }, request: new Request('https://example.org/api/personal-state', { method: 'PUT', body: '{}' }) }, store);
  assert.equal(response.status, 401);
  assert.equal(writes, 0);
});

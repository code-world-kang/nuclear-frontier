import test from 'node:test';
import assert from 'node:assert/strict';
import { createPaperLibraryLoader } from '../site/paper-library.js';

function fixture(failOnce = '') {
  const calls = [];
  const data = {
    'stats/2001.json': { months: [{ month: '2001-01' }, { month: '2001-02' }] },
    'papers/2001/01.json': [{ id: 'old', title: 'Historical paper' }],
    'papers/2001/02.json': [{ id: 'daily', title: 'Merged record', abstract: 'Full abstract' }],
  };
  let active = 0, peak = 0;
  const fetchImpl = async url => {
    calls.push(url); active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 1)); active--;
    if (url === failOnce) { failOnce = ''; return { ok: false, status: 503 }; }
    return { ok: true, json: async () => data[url] };
  };
  return { calls, fetchImpl, peak: () => peak };
}

test('automatically loads every month, retains undated records and deduplicates daily records', async () => {
  const f = fixture(); const progress = [];
  const load = createPaperLibraryLoader({ root: '', fetchImpl: f.fetchImpl, concurrency: 2 });
  const options = { daily: [{ id: 'daily' }, { id: 'undated' }], years: [{ year: 2001 }], onProgress: x => progress.push(x) };
  const [result, shared] = await Promise.all([load(options), load({ ...options, onProgress: undefined })]);
  assert.equal(result.items.length, 3);
  assert.equal(result.items.find(x => x.id === 'daily').abstract, 'Full abstract');
  assert.equal(result.loaded, 2); assert.equal(shared.loaded, 2);
  assert.ok(progress.length > 1); assert.ok(f.peak() <= 2);
  await load(options);
  assert.equal(f.calls.length, 3, 're-entering does not download loaded files again');
});

test('failed month keeps successful data and retry fetches only the missing month', async () => {
  const f = fixture('papers/2001/01.json'); let partial;
  const load = createPaperLibraryLoader({ root: '', fetchImpl: f.fetchImpl, concurrency: 2 });
  const options = { daily: [{ id: 'daily' }], years: [{ year: 2001 }], onProgress: x => { partial = x; } };
  await assert.rejects(load(options), /503/);
  assert.equal(partial.loaded, 1);
  assert.equal(partial.items[0].abstract, 'Full abstract');
  const result = await load(options);
  assert.equal(result.loaded, 2);
  assert.equal(f.calls.filter(x => x === 'papers/2001/02.json').length, 1);
  assert.equal(f.calls.filter(x => x === 'papers/2001/01.json').length, 2);
});

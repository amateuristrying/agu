import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const root = new URL('../dist/', import.meta.url);
const worker = await readFile(new URL('sw.js', root), 'utf8');
function harness() {
  const events = {};
  const entries = new Map();
  const deleted = [];
  let offline = false;
  const cache = {
    addAll: async urls => { for (const url of urls) entries.set(url, new Response('cached shell')); },
    put: async (url, response) => entries.set(url, response),
    match: async url => entries.get(url)?.clone(),
  };
  runInNewContext(worker, {
    URL, Response, Promise,
    self: { location: { href: 'https://agu.example/sw.js' }, clients: { claim: async () => {} }, addEventListener: (name, callback) => { events[name] = callback; } },
    caches: { open: async () => cache, keys: async () => ['agu-preview-v0', 'other-app'], delete: async key => deleted.push(key) },
    fetch: async () => { if (offline) throw new Error('offline'); return new Response('network shell'); },
  });
  return {
    entries, deleted,
    offline: () => { offline = true; },
    lifecycle: async name => { let work; events[name]({ waitUntil: promise => { work = promise; } }); await work; },
    request: (path, options = {}) => {
      let work;
      events.fetch({ request: { url: new URL(path, 'https://agu.example/').href, method: 'GET', headers: new Headers(), mode: 'cors', ...options }, respondWith: promise => { work = promise; } });
      return work;
    },
  };
}

test('manifest launch and all precache assets exist, with correctly sized PNG icons', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', root), 'utf8'));
  assert.equal(manifest.start_url, './#capabilities');
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) {
    const png = await readFile(new URL(icon.src, root));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
  }
  const h = harness(); await h.lifecycle('install');
  for (const url of h.entries.keys()) {
    const path = new URL(url).pathname.slice(1) || 'index.html';
    await access(new URL(path, root));
    assert.ok(!path.endsWith('.mp4'), 'do not precache video');
  }
});

test('previously loaded preview remains available offline including a launch URL query', async () => {
  const h = harness(); await h.lifecycle('install');
  assert.equal(await (await h.request('/', { mode: 'navigate' })).text(), 'network shell');
  h.offline();
  assert.equal(await (await h.request('/?source=installed', { mode: 'navigate' })).text(), 'network shell');
  assert.equal(await (await h.request('/use.css')).text(), 'cached shell');
});

test('worker never handles video, ranges, external services, API traffic or writes', () => {
  const h = harness();
  assert.equal(h.request('/assets/metal-human-scrub.mp4'), undefined);
  assert.equal(h.request('/assets/metal-human-poster.jpg', { headers: new Headers({ range: 'bytes=0-99' }) }), undefined);
  assert.equal(h.request('https://external.example/app.js'), undefined);
  assert.equal(h.request('/api/projects'), undefined);
  assert.equal(h.request('/app.js', { method: 'POST' }), undefined);
});

test('activation deletes only obsolete AGU preview caches', async () => {
  const h = harness(); await h.lifecycle('activate');
  assert.deepEqual(h.deleted, ['agu-preview-v0']);
});

test('missing offline content gives an explicit unavailable response', async () => {
  const h = harness(); h.offline();
  assert.equal((await h.request('/use.css')).status, 503);
});

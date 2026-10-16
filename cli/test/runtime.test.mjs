import { test } from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, symlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openProject, sync, search, history, planReport, applyPlan, status } from '../src/runtime.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'agu-cli-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  git('init', '-q');
  writeFileSync(join(root, 'README.md'), '# Atlas\nPayment migration is blocked by schema review.\nOwner: engineering.\n');
  writeFileSync(join(root, 'service.js'), 'export const paymentVersion = 2;\n');
  writeFileSync(join(root, '.env'), 'PRIVATE_TOKEN=do-not-index\n');
  writeFileSync(join(root, 'ignored.txt'), 'not tracked, do not index\n');
  git('add', 'README.md', 'service.js', '.env');
  git('-c', 'user.name=AGU Test', '-c', 'user.email=test@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'Initial fixture');
  return { root, git };
}
function initialized(t) {
  const f = fixture(t);
  const p = openProject(f.root, { initialize: true });
  t.after(() => p.close());
  sync(p);
  return { ...f, p };
}

test('sync indexes tracked text, excludes env/untracked files, and ignores its own state', t => {
  const { p, root, git } = initialized(t);
  assert.equal(status(p).snapshot.file_count, 2);
  assert.equal(search(p, 'PRIVATE_TOKEN').evidence.length, 0);
  assert.equal(search(p, 'not tracked').evidence.length, 0);
  assert.ok(!git('status', '--porcelain', '--untracked-files=all').includes('.agu/'));
  assert.equal(sync(p).unchanged, true);
  const matches = search(p, 'schema review');
  assert.equal(matches.evidence[0].path, 'README.md');
  assert.equal(matches.evidence[0].line, 2);
  assert.match(matches.evidence[0].hash, /^[a-f0-9]{64}$/);
  assert.ok(existsSync(join(root, '.agu', 'project.sqlite')));
});

test('modified and removed evidence must be synced and deleted text is no longer searchable', t => {
  const { p, root } = initialized(t);
  writeFileSync(join(root, 'README.md'), '# Atlas\nRelease ready after review.\n');
  assert.equal(status(p).stale, true);
  assert.throws(() => search(p, 'schema'), /changed/);
  sync(p);
  assert.equal(search(p, 'schema').evidence.length, 0);
  assert.equal(history(p)[0].kind, 'updated');
  rmSync(join(root, 'service.js'));
  sync(p);
  assert.equal(search(p, 'paymentVersion').evidence.length, 0);
  assert.equal(history(p)[0].kind, 'removed');
});

test('symlinks and oversized files do not become evidence', t => {
  const { root, git } = fixture(t);
  symlinkSync('README.md', join(root, 'linked.md'));
  writeFileSync(join(root, 'large.txt'), 'x'.repeat(512 * 1024 + 1));
  git('add', 'linked.md', 'large.txt');
  const p = openProject(root, { initialize: true }); t.after(() => p.close());
  const result = sync(p);
  assert.equal(result.file_count, 2);
  assert.equal(result.skipped, 3);
});

test('action requires exact approval, writes only its report, and retries reuse the verified result', t => {
  const { p, root } = initialized(t);
  const original = readFileSync(join(root, 'README.md'), 'utf8');
  const plan = planReport(p, 'schema review');
  assert.ok(!existsSync(join(root, plan.output)));
  assert.throws(() => applyPlan(p, plan.id), /Exact approval/);
  assert.throws(() => applyPlan(p, plan.id, 'wrong'), /Exact approval/);
  const result = applyPlan(p, plan.id, plan.approval_hash);
  assert.equal(result.state, 'verified');
  assert.match(readFileSync(join(root, result.output), 'utf8'), /README\.md:2/);
  assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), original);
  assert.equal(applyPlan(p, plan.id, plan.approval_hash).reused, true);
  assert.equal(p.db.prepare('SELECT count(*) AS n FROM runs').get().n, 1);
});

test('changed evidence invalidates approvals before and after a resync', t => {
  const { p, root } = initialized(t);
  const plan = planReport(p, 'schema');
  writeFileSync(join(root, 'README.md'), 'schema changed\n');
  assert.throws(() => applyPlan(p, plan.id, plan.approval_hash), /changed/);
  sync(p);
  assert.throws(() => applyPlan(p, plan.id, plan.approval_hash), /stale/);
  assert.ok(!existsSync(join(root, plan.output)));
});

test('unrelated HEAD change also invalidates the plan', t => {
  const { p, git } = initialized(t);
  const plan = planReport(p, 'schema');
  git('-c', 'user.name=AGU Test', '-c', 'user.email=test@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-qm', 'New head');
  assert.throws(() => applyPlan(p, plan.id, plan.approval_hash), /changed/);
});

test('tampered plan payloads fail integrity checking', t => {
  const { p } = initialized(t);
  const plan = planReport(p, 'schema');
  p.db.prepare('UPDATE plans SET payload = ? WHERE id = ?').run('{}', plan.id);
  assert.throws(() => applyPlan(p, plan.id, plan.approval_hash), /integrity/);
});

test('report conflicts and report directory symlinks are never overwritten or followed', t => {
  const { p, root } = initialized(t);
  const plan = planReport(p, 'schema');
  mkdirSync(join(root, '.agu', 'reports'));
  writeFileSync(join(root, plan.output), 'user content');
  assert.throws(() => applyPlan(p, plan.id, plan.approval_hash), /unexpected content/);
  assert.equal(readFileSync(join(root, plan.output), 'utf8'), 'user content');
  rmSync(join(root, '.agu', 'reports'), { recursive: true });
  symlinkSync(root, join(root, '.agu', 'reports'));
  assert.throws(() => applyPlan(p, plan.id, plan.approval_hash), /real directory/);
});

test('an interrupted completed write is reconciled without duplicate action', t => {
  const { p, root } = initialized(t);
  const plan = planReport(p, 'schema');
  applyPlan(p, plan.id, plan.approval_hash);
  p.db.exec("DELETE FROM runs; UPDATE plans SET status = 'proposed'");
  assert.equal(applyPlan(p, plan.id, plan.approval_hash).reused, true);
  assert.equal(p.db.prepare('SELECT count(*) AS n FROM runs').get().n, 1);
  assert.match(readFileSync(join(root, plan.output), 'utf8'), /Approved plan hash/);
});

test('unmatched and punctuation-only queries do not generate fabricated reports', t => {
  const { p } = initialized(t);
  assert.throws(() => planReport(p, 'nonexistenttoken'), /No matching evidence/);
  assert.throws(() => planReport(p, '* OR \"'), /No matching evidence/);
  assert.throws(() => search(p, '***'), /at least one word/);
});

test('CLI works end-to-end in a selected project and rejects unknown options', t => {
  const { root } = fixture(t);
  const bin = fileURLToPath(new URL('../bin/agu.mjs', import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [bin, ...args, '--project', root, '--json'], { encoding: 'utf8' });
  assert.equal(run('init').status, 0);
  const proposed = run('plan', 'schema review');
  assert.equal(proposed.status, 0, proposed.stderr);
  const plan = JSON.parse(proposed.stdout);
  assert.equal(run('apply', plan.id).status, 1);
  const result = run('apply', plan.id, '--approve', plan.approval_hash);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).state, 'verified');
  assert.equal(run('sync', '--unknown').status, 1);
});


test('expired plans and changed report destinations are rejected even with their current hash', t => {
  const { p } = initialized(t);
  const expired = planReport(p, 'schema');
  const replace = (plan, changes) => {
    const row = p.db.prepare('SELECT payload FROM plans WHERE id = ?').get(plan.id);
    const payload = JSON.stringify({ ...JSON.parse(row.payload), ...changes });
    const hash = createHash('sha256').update(payload).digest('hex');
    p.db.prepare('UPDATE plans SET payload = ?, hash = ? WHERE id = ?').run(payload, hash, plan.id);
    return hash;
  };
  const hash = replace(expired, { expires_at: '2000-01-01T00:00:00.000Z' });
  assert.throws(() => applyPlan(p, expired.id, hash), /expired/);
  const escaped = planReport(p, 'schema');
  const escapedHash = replace(escaped, { output: '../outside.md' });
  assert.throws(() => applyPlan(p, escaped.id, escapedHash), /invalid action/);
});

test('runtime state already tracked by Git is rejected', t => {
  const { root, git } = fixture(t);
  mkdirSync(join(root, '.agu'));
  writeFileSync(join(root, '.agu', 'tracked.txt'), 'state must stay private');
  git('add', '.agu/tracked.txt');
  assert.throws(() => openProject(root, { initialize: true }), /remain untracked/);
});

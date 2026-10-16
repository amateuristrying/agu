import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, lstatSync, realpathSync, existsSync, openSync, closeSync, readSync, constants } from 'node:fs';
import { join, isAbsolute, extname } from 'node:path';

const VERSION = 1;
const MAX_FILE = 512 * 1024;
const MAX_TOTAL = 20 * 1024 * 1024;
const TEXT = new Set(['.md', '.mdx', '.txt', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rs', '.go', '.java', '.css', '.html', '.json', '.yml', '.yaml', '.toml', '.sql', '.sh']);
const sha = value => createHash('sha256').update(value).digest('hex');
const time = () => new Date().toISOString();
const plain = text => String(text).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '');

function git(root, args) {
  const result = spawnSync('git', ['--no-pager', '-c', 'core.fsmonitor=false', '-C', root, ...args], {
    encoding: 'utf8', timeout: 10000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
  });
  if (result.error || result.status !== 0) throw new Error(`Git could not complete ${args[0]}. Use a local Git working tree with at least one commit.`);
  return result.stdout;
}

export function projectRoot(cwd) {
  return realpathSync(git(cwd, ['rev-parse', '--show-toplevel']).trim());
}

function regularPath(root, path) {
  const parts = path.split('/');
  if (isAbsolute(path) || parts.some(part => part === '..' || part === '' || part === '.')) return false;
  let current = root;
  try {
    for (const part of parts) {
      current = join(current, part);
      if (lstatSync(current).isSymbolicLink()) return false;
    }
    return lstatSync(current).isFile();
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw error;
  }
}

function eligible(path) {
  const parts = path.toLowerCase().split('/');
  if (parts.some(part => ['.agu', '.git', 'node_modules', 'vendor', '.aws', '.ssh', '.codex', '.agents'].includes(part))) return false;
  if (parts.some(part => /(^\.env($|\.)|secret|credential|^id_rsa|^id_ed25519)/.test(part))) return false;
  if (/\.(pem|key|p12|pfx|lock)$/.test(path) || /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(path)) return false;
  return TEXT.has(extname(path).toLowerCase()) || /(^|\/)(README|LICENSE|Dockerfile|Makefile)$/i.test(path);
}

export function scan(root) {
  const head = git(root, ['rev-parse', 'HEAD']).trim();
  const paths = [...new Set(git(root, ['ls-files', '--cached', '-z']).split('\0').filter(Boolean))].sort();
  if (paths.length > 10000) throw new Error('Prototype limit: at most 10,000 tracked paths per repository. Select a smaller repository.');
  const files = [];
  let skipped = 0;
  let bytes = 0;
  for (const path of paths) {
    if (!eligible(path) || !regularPath(root, path)) { skipped++; continue; }
    // No-follow prevents a final-component symlink swap while opening a file.
    const fd = openSync(join(root, path), constants.O_RDONLY | constants.O_NOFOLLOW);
    let data;
    try {
      const buffer = Buffer.alloc(MAX_FILE + 1);
      let length = 0;
      while (length < buffer.length) {
        const count = readSync(fd, buffer, length, buffer.length - length, null);
        if (!count) break;
        length += count;
      }
      data = buffer.subarray(0, length);
    } finally { closeSync(fd); }
    if (data.length > MAX_FILE || data.includes(0)) { skipped++; continue; }
    let content;
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(data); }
    catch { skipped++; continue; }
    bytes += data.length;
    if (bytes > MAX_TOTAL) throw new Error('Prototype limit: eligible text exceeds 20 MiB. No index changes were saved.');
    files.push({ path, hash: sha(data), content });
  }
  if (git(root, ['rev-parse', 'HEAD']).trim() !== head) throw new Error('HEAD changed during scanning. Retry sync.');
  const digest = sha(JSON.stringify({ head, files: files.map(({ path, hash }) => [path, hash]) }));
  return { head, digest, files, skipped, bytes };
}

function directory(path) {
  if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Expected a real directory: ${path}`);
}

export function openProject(cwd, { initialize = false } = {}) {
  const root = projectRoot(cwd);
  const state = join(root, '.agu');
  if (git(root, ['ls-files', '--', '.agu']).trim()) throw new Error('AGU state must remain untracked. Remove .agu from Git tracking before using this prototype.');
  if (!initialize && !existsSync(join(state, 'project.sqlite'))) throw new Error('Run agu init in this repository first.');
  directory(state);
  const dbPath = join(state, 'project.sqlite');
  if (existsSync(dbPath) && (lstatSync(dbPath).isSymbolicLink() || !lstatSync(dbPath).isFile())) throw new Error('AGU database must be a regular file.');
  if (initialize && !existsSync(join(state, '.gitignore'))) writeFileSync(join(state, '.gitignore'), '*\n', { flag: 'wx', mode: 0o600 });
  const db = new DatabaseSync(dbPath, { timeout: 5000 });
  try {
    db.exec('PRAGMA foreign_keys = ON;');
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (version > VERSION) throw new Error('This project uses a newer AGU data format. Upgrade AGU before opening it.');
    if (version === 0) db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE snapshots (id INTEGER PRIMARY KEY, digest TEXT NOT NULL, head TEXT NOT NULL, created_at TEXT NOT NULL, file_count INTEGER NOT NULL, skipped INTEGER NOT NULL);
      CREATE TABLE files (path TEXT PRIMARY KEY, hash TEXT NOT NULL, content TEXT NOT NULL);
      CREATE VIRTUAL TABLE search USING fts5(path, content, tokenize='unicode61');
      CREATE TABLE changes (id INTEGER PRIMARY KEY, snapshot_id INTEGER NOT NULL REFERENCES snapshots(id), path TEXT NOT NULL, kind TEXT NOT NULL, old_hash TEXT, new_hash TEXT);
      CREATE TABLE plans (id TEXT PRIMARY KEY, hash TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'proposed');
      CREATE TABLE runs (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES plans(id), state TEXT NOT NULL, created_at TEXT NOT NULL, output TEXT, detail TEXT);
      PRAGMA user_version = 1;
      COMMIT;
    `);
    const storedRoot = db.prepare('SELECT value FROM metadata WHERE key = ?').get('root');
    if (storedRoot && storedRoot.value !== root) throw new Error('This AGU index belongs to another repository location. Create a fresh index for this location.');
    if (!storedRoot) db.prepare('INSERT INTO metadata VALUES (?, ?)').run('root', root);
    return { root, state, db, close: () => db.close() };
  } catch (error) { db.close(); throw error; }
}

export function sync(project) {
  const snapshot = scan(project.root);
  const { db } = project;
  db.exec('BEGIN IMMEDIATE');
  try {
    const previous = db.prepare('SELECT * FROM snapshots ORDER BY id DESC LIMIT 1').get();
    if (previous?.digest === snapshot.digest) {
      db.exec('COMMIT');
      return { ...previous, changed: 0, unchanged: true };
    }
    const inserted = db.prepare('INSERT INTO snapshots (digest, head, created_at, file_count, skipped) VALUES (?, ?, ?, ?, ?)').run(snapshot.digest, snapshot.head, time(), snapshot.files.length, snapshot.skipped);
    const id = Number(inserted.lastInsertRowid);
    const old = new Map(db.prepare('SELECT path, hash FROM files').all().map(file => [file.path, file.hash]));
    const event = db.prepare('INSERT INTO changes (snapshot_id, path, kind, old_hash, new_hash) VALUES (?, ?, ?, ?, ?)');
    let changed = 0;
    for (const file of snapshot.files) {
      const oldHash = old.get(file.path);
      if (oldHash !== file.hash) {
        event.run(id, file.path, oldHash ? 'updated' : 'added', oldHash ?? null, file.hash);
        changed++;
      }
      old.delete(file.path);
    }
    for (const [path, hash] of old) { event.run(id, path, 'removed', hash, null); changed++; }
    db.exec('DELETE FROM files; DELETE FROM search;');
    const insert = db.prepare('INSERT INTO files VALUES (?, ?, ?)');
    const index = db.prepare('INSERT INTO search VALUES (?, ?)');
    for (const file of snapshot.files) { insert.run(file.path, file.hash, file.content); index.run(file.path, file.content); }
    db.exec('COMMIT');
    return { id, digest: snapshot.digest, head: snapshot.head, file_count: snapshot.files.length, skipped: snapshot.skipped, changed, unchanged: false };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

function latest(project) {
  const snapshot = project.db.prepare('SELECT * FROM snapshots ORDER BY id DESC LIMIT 1').get();
  if (!snapshot) throw new Error('No evidence indexed yet. Run agu sync.');
  return snapshot;
}

function assertFresh(project) {
  const snapshot = latest(project);
  if (scan(project.root).digest !== snapshot.digest) throw new Error('Project evidence has changed. Run agu sync, then create and review a new plan.');
  return snapshot;
}

export function status(project) {
  const snapshot = project.db.prepare('SELECT * FROM snapshots ORDER BY id DESC LIMIT 1').get();
  return { root: project.root, snapshot: snapshot ?? null, stale: !snapshot || scan(project.root).digest !== snapshot.digest, plans: project.db.prepare('SELECT id, status, created_at FROM plans ORDER BY created_at DESC LIMIT 10').all() };
}

function searchEvidence(project, query) {
  if (query.length > 1000) throw new Error('Use a search query of at most 1,000 characters.');
  const snapshot = assertFresh(project);
  const words = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [])].slice(0, 16);
  if (!words.length) throw new Error('Enter at least one word to search.');
  const expression = words.map(word => `"${word}"`).join(' OR ');
  const rows = project.db.prepare('SELECT search.path, files.hash, files.content FROM search JOIN files ON files.path = search.path WHERE search MATCH ? ORDER BY bm25(search, 3.0, 1.0), search.path LIMIT 8').all(expression);
  const evidence = rows.map(row => {
    const lines = row.content.split(/\r?\n/);
    const index = Math.max(0, lines.findIndex(line => words.some(word => line.toLowerCase().includes(word))));
    return { path: row.path, hash: row.hash, line: index + 1, excerpt: plain(lines.slice(index, index + 3).join('\n')).slice(0, 700) };
  });
  return { query, snapshot: snapshot.id, head: snapshot.head, evidence, method: 'Local lexical retrieval; excerpts are source material, not an AI answer.' };
}

export function history(project) {
  return project.db.prepare('SELECT changes.*, snapshots.created_at, snapshots.head FROM changes JOIN snapshots ON snapshots.id = changes.snapshot_id ORDER BY changes.id DESC LIMIT 50').all();
}

export function search(project, query) {
  project.db.exec('BEGIN');
  try {
    const result = searchEvidence(project, query);
    project.db.exec('COMMIT');
    return result;
  } catch (error) { project.db.exec('ROLLBACK'); throw error; }
}

export function planReport(project, query) {
  project.db.exec('BEGIN IMMEDIATE');
  try {
    const results = searchEvidence(project, query);
    if (!results.evidence.length) throw new Error('No matching evidence. Try more specific terms; AGU will not create an unsupported report.');
    const snapshot = latest(project);
    const id = randomUUID();
    const payload = {
      version: 1, id, type: 'write-evidence-report', root: project.root, digest: snapshot.digest,
      created_at: time(), expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      output: `.agu/reports/${id}.md`, results,
    };
    const serialized = JSON.stringify(payload);
    const hash = sha(serialized);
    project.db.prepare('INSERT INTO plans (id, hash, payload, created_at) VALUES (?, ?, ?, ?)').run(id, hash, serialized, payload.created_at);
    project.db.exec('COMMIT');
    return { ...payload, approval_hash: hash, status: 'proposed' };
  } catch (error) { project.db.exec('ROLLBACK'); throw error; }
}

export function showPlan(project, id) {
  const row = project.db.prepare('SELECT * FROM plans WHERE id = ?').get(id);
  if (!row) throw new Error('Unknown plan ID.');
  if (sha(row.payload) !== row.hash) throw new Error('The stored plan failed its integrity check.');
  return { ...JSON.parse(row.payload), approval_hash: row.hash, status: row.status };
}

function reportText(plan) {
  const heading = value => plain(value).replace(/[\r\n]/g, ' ').replace(/[\\`*_{}[\]()<>#!|]/g, '\\$&');
  return [
    '# AGU evidence report', '', `Query: ${heading(plan.results.query)}`, '',
    `Snapshot: ${plan.results.snapshot} · HEAD: ${plan.results.head}`, '',
    'Local lexical search results. These excerpts do not establish an explanation, causal conclusion or verified fix.', '',
    ...plan.results.evidence.flatMap(item => [
      `## ${heading(item.path)}:${item.line}`, '', `Content SHA-256: ${item.hash}`, '',
      ...item.excerpt.split('\n').map(line => `    ${line}`), '',
    ]),
    `Plan: ${plan.id}`, `Approved plan hash: ${plan.approval_hash}`, '',
  ].join('\n');
}

export function applyPlan(project, id, approval) {
  const { db } = project;
  db.exec('BEGIN IMMEDIATE');
  try {
    const plan = showPlan(project, id);
    if (approval !== plan.approval_hash) throw new Error('Exact approval required. Review agu show <id>, then pass --approve <approval_hash>.');
    if (plan.type !== 'write-evidence-report' || plan.root !== project.root || plan.id !== id || plan.output !== `.agu/reports/${id}.md` || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('Unsupported or invalid action plan.');
    const completed = db.prepare('SELECT * FROM runs WHERE plan_id = ? AND state = ? LIMIT 1').get(id, 'verified');
    const report = reportText(plan);
    directory(join(project.state, 'reports'));
    const output = join(project.root, plan.output);
    if (existsSync(output)) {
      if (!regularPath(project.root, plan.output) || readFileSync(output, 'utf8') !== report) throw new Error('Report path already exists with unexpected content. Nothing was overwritten.');
      if (!completed) {
        // Reconcile a crash after writing the exact approved report but before DB commit.
        db.prepare('INSERT INTO runs VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), id, 'verified', time(), plan.output, 'Recovered exact approved report after interrupted execution.');
        db.prepare('UPDATE plans SET status = ? WHERE id = ?').run('verified', id);
      }
      db.exec('COMMIT');
      return { state: 'verified', output: plan.output, reused: true };
    }
    if (completed) throw new Error('The previously verified report was removed. Create a new plan to regenerate it.');
    if (Date.now() > Date.parse(plan.expires_at)) throw new Error('Approval plan expired. Create and review a new plan.');
    const snapshot = assertFresh(project);
    if (snapshot.digest !== plan.digest) throw new Error('Plan is stale. Create and review a new plan after syncing.');
    // The prototype only writes this report. It never executes project scripts or model-generated commands.
    writeFileSync(output, report, { flag: 'wx', mode: 0o600 });
    if (readFileSync(output, 'utf8') !== report) throw new Error('Report verification failed.');
    db.prepare('INSERT INTO runs VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), id, 'verified', time(), plan.output, 'Verified report bytes against the approved evidence plan.');
    db.prepare('UPDATE plans SET status = ? WHERE id = ?').run('verified', id);
    db.exec('COMMIT');
    return { state: 'verified', output: plan.output, reused: false };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export { plain };

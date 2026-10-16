import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, readdirSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { projectRoot, git, sha } from './project.mjs';

export function directory(path) {
  if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Expected a real directory: ${path}`);
}
export function regular(path) {
  if (existsSync(path) && (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())) throw new Error('Knowledge-base files must be regular files.');
}
export function atomic(path, value) {
  regular(path);
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, value, { flag: 'wx', mode: 0o600 });
  try { renameSync(temp, path); } finally { if (existsSync(temp)) unlinkSync(temp); }
}
export function readJSON(path) {
  regular(path);
  return JSON.parse(readFileSync(path, 'utf8'));
}
export function locked(project, fn) {
  const path = join(project.state, 'write.lock');
  let fd;
  try { fd = openSync(path, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Knowledge base is busy. If a process crashed, verify it has stopped before removing .agu/write.lock.'); throw error; }
  try { return fn(); } finally { closeSync(fd); unlinkSync(path); }
}
export function openProject(cwd, { initialize = false } = {}) {
  const root = projectRoot(cwd), state = join(root, '.agu');
  if (git(root, ['ls-files', '--', '.agu']).trim()) throw new Error('AGU state must remain untracked.');
  if (!initialize && !existsSync(join(state, 'knowledge', 'manifest.json'))) throw new Error('Run agu init to create the file-based knowledge base. Existing legacy SQLite data is preserved.');
  directory(state);
  for (const folder of ['knowledge', 'plans', 'runs', 'answers', 'reports']) directory(join(state, folder));
  directory(join(state, 'knowledge', 'sources'));
  directory(join(state, 'knowledge', 'notes'));
  const project = { root, state, close() {} };
  if (initialize) locked(project, () => {
    const ignore = join(state, '.gitignore');
    regular(ignore);
    if (!existsSync(ignore)) writeFileSync(ignore, '*\n', { flag: 'wx', mode: 0o600 });
    const file = join(state, 'knowledge', 'manifest.json');
    if (!existsSync(file)) atomic(file, JSON.stringify({ version: 2, root, snapshot: null, files: [], notes: [], changes: [] }, null, 2));
    const guide = join(state, 'knowledge', 'README.md');
    if (!existsSync(guide)) atomic(guide, '# Your AGU knowledge base\n\nThis folder belongs to you. No central context database is used.\n\nmanifest.json maps source paths to immutable text in sources/. Notes live in notes/. Use agu remember to import notes. Back up the whole .agu folder to preserve plans and results too. Source hashes are checked on read. Do not edit generated snapshots; edit the original project and run agu sync.\n');
  });
  manifest(project);
  return project;
}
export function manifest(project) {
  const data = readJSON(join(project.state, 'knowledge', 'manifest.json'));
  if (data.version !== 2 || data.root !== project.root) throw new Error('Unsupported or relocated knowledge base. Use agu init in the original project location.');
  return data;
}
export function saveManifest(project, data) { atomic(join(project.state, 'knowledge', 'manifest.json'), JSON.stringify(data, null, 2)); }
export function source(project, file) {
  if (!/^[a-f0-9]{64}$/.test(file.hash)) throw new Error('Invalid source hash.');
  const path = join(project.state, 'knowledge', 'sources', `${file.hash}.txt`);
  regular(path);
  const content = readFileSync(path, 'utf8');
  if (sha(content) !== file.hash) throw new Error('Source integrity check failed. Restore your knowledge-base backup.');
  return content;
}
export function putSource(project, content) {
  const hash = sha(content), path = join(project.state, 'knowledge', 'sources', `${hash}.txt`);
  if (!existsSync(path)) atomic(path, content);
  else source(project, { hash });
  return hash;
}
export function recordPath(project, type, id) {
  if (!['plans','runs','answers'].includes(type) || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid record identifier.');
  directory(join(project.state, type));
  return join(project.state, type, `${id}.json`);
}
export function writeRecord(project, type, id, value) { atomic(recordPath(project, type, id), JSON.stringify(value, null, 2)); }
export function readRecord(project, type, id) {
  const path = recordPath(project, type, id);
  if (!existsSync(path)) throw new Error(`Unknown ${type} ID.`);
  return readJSON(path);
}
export function listRecords(project, type) {
  directory(join(project.state, type));
  return readdirSync(join(project.state, type)).filter(x => /^[a-f0-9-]{36}\.json$/.test(x)).map(x => readRecord(project, type, x.slice(0,-5))).sort((a,b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

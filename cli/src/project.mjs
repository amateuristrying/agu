import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, realpathSync, openSync, closeSync, readSync, constants } from 'node:fs';
import { join, isAbsolute, extname } from 'node:path';
const MAX_FILE = 512 * 1024;
const MAX_TOTAL = 20 * 1024 * 1024;
const TEXT = new Set(['.md', '.mdx', '.txt', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rs', '.go', '.java', '.css', '.html', '.json', '.yml', '.yaml', '.toml', '.sql', '.sh']);
export const sha = value => createHash('sha256').update(value).digest('hex');
export const time = () => new Date().toISOString();
export const plain = text => String(text).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '');

export function git(root, args) {
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

export function regularPath(root, path) {
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

export function eligible(path) {
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
    try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data); }
    catch { skipped++; continue; }
    bytes += data.length;
    if (bytes > MAX_TOTAL) throw new Error('Prototype limit: eligible text exceeds 20 MiB. No index changes were saved.');
    files.push({ path, hash: sha(data), content });
  }
  if (git(root, ['rev-parse', 'HEAD']).trim() !== head) throw new Error('HEAD changed during scanning. Retry sync.');
  const digest = sha(JSON.stringify({ head, files: files.map(({ path, hash }) => [path, hash]) }));
  return { head, digest, files, skipped, bytes };
}


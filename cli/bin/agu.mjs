#!/usr/bin/env node
import { resolve } from 'node:path';

const HELP = `AGU local prototype 0.1.0

Usage: agu <command> [arguments] [--project <directory>] [--json]

  init                 Create a local index and sync tracked text files
  sync                 Refresh evidence and record changed/removed files
  status               Show index freshness and recent plans
  search "words"       Find evidence with source paths, lines and hashes
  history              Show the last 50 indexed file changes
  plan "words"         Propose a local evidence report; does not write it
  show <plan-id>       Review the complete report plan and approval hash
  apply <plan-id> --approve <hash>
                       Write and verify that exact approved report

This prototype runs locally with no model or network calls.
It writes only its .agu directory. No code edits, shell actions or PRs.
Requires Node.js 22.18+ and Git. Node's SQLite API may emit an experimental warning.
`;

async function main() {
  const raw = process.argv.slice(2);
  if (!raw.length || raw.includes('--help') || raw[0] === 'help') { console.log(HELP); return; }
  if (raw[0] === '--version') { console.log('0.1.0'); return; }
  const command = raw.shift();
  const args = [];
  let cwd = process.cwd(), json = false, approval;
  while (raw.length) {
    const token = raw.shift();
    if (token === '--json') json = true;
    else if (token === '--project' || token === '--approve') {
      const value = raw.shift();
      if (!value || value.startsWith('--')) throw new Error(`${token} requires a value.`);
      if (token === '--project') cwd = resolve(value);
      else approval = value;
    } else if (token.startsWith('--')) throw new Error(`Unknown option: ${token}`);
    else args.push(token);
  }
  const expected = { init: 0, sync: 0, status: 0, search: 1, history: 0, plan: 1, show: 1, apply: 1 };
  if (!(command in expected)) throw new Error(`Unknown command: ${command}. Run agu --help.`);
  if (args.length !== expected[command]) throw new Error(`${command} expects ${expected[command]} argument(s). Put a multiword query in quotes.`);
  if (approval && command !== 'apply') throw new Error('--approve is only valid with apply.');
  const runtime = await import('../src/runtime.mjs');
  const project = runtime.openProject(cwd, { initialize: command === 'init' });
  try {
    let result;
    if (command === 'init' || command === 'sync') result = runtime.sync(project);
    if (command === 'status') result = runtime.status(project);
    if (command === 'search') result = runtime.search(project, args[0]);
    if (command === 'history') result = runtime.history(project);
    if (command === 'plan') result = runtime.planReport(project, args[0]);
    if (command === 'show') result = runtime.showPlan(project, args[0]);
    if (command === 'apply') result = runtime.applyPlan(project, args[0], approval);
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      const print = value => console.log(runtime.plain(value));
      if (command === 'init' || command === 'sync') {
        print(`AGU · ${result.unchanged ? 'Already current' : 'Evidence synced'}`);
        print(`${result.file_count} files · ${result.changed} changes · ${result.skipped} excluded paths`);
        print(`Snapshot ${result.id} · HEAD ${result.head.slice(0, 12)}`);
        print('Local state: .agu/ · Nothing was sent to a model or service.');
      } else if (command === 'search') {
        print(result.method);
        for (const item of result.evidence) print(`\n${item.path}:${item.line}\n${item.excerpt}\nSHA-256 ${item.hash}`);
        if (!result.evidence.length) print('No matching evidence. Try a term used in your project.');
      } else if (command === 'plan' || command === 'show') {
        print(`AGU · ${result.status} report plan ${result.id}`);
        print(`Query: ${result.results.query}\nOutput: ${result.output}\nExpires: ${result.expires_at}`);
        print('Action: write one local Markdown evidence report. No project code changes.');
        for (const item of result.results.evidence) print(`\n${item.path}:${item.line}\n${item.excerpt}\nSHA-256 ${item.hash}`);
        print(`\nAfter reviewing, approve this exact plan:\nagu apply ${result.id} --approve ${result.approval_hash}`);
      } else if (command === 'apply') print(`AGU · Verified${result.reused ? ' (existing report)' : ''}\n${result.output}`);
      else print(JSON.stringify(result, null, 2));
    }
  } finally { project.close(); }
}
main().catch(error => {
  const message = String(error.message).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
  console.error(`AGU: ${message}`);
  process.exitCode = 1;
});

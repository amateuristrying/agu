# AGU local prototype

AGU can now index a real Git working tree, retrieve source evidence, track indexed file changes, and write an explicitly approved evidence report. Everything happens locally. This is the first runtime milestone, separate from the website's sample workspace.

**This is lexical retrieval and a bounded report action, not an LLM, a new model architecture, an autonomous coding agent or a production release.** There are no model-provider calls, cloud sync, shell execution, code modifications, GitHub writes or automatic updates.

## Run it

Requirements: Git and Node.js 22.18 or newer. The implementation uses Node's built-in SQLite/FTS5 support with no external packages. Node 22 emits an experimental SQLite warning; it is expected. This prototype was verified on Node 22.18/macOS. Broader platform and Node-version validation is still required before a public release. See [Node 22 SQLite documentation](https://nodejs.org/docs/latest-v22.x/api/sqlite.html).

From this repository:

```sh
node cli/bin/agu.mjs init --project /absolute/path/to/your/git-project
node cli/bin/agu.mjs search "payment migration" --project /absolute/path/to/your/git-project
node cli/bin/agu.mjs plan "payment migration" --project /absolute/path/to/your/git-project
```

Use a repository with at least one commit. Quote multiword queries. Replace the path and query with your own project and terms.

Optional local installation gives you the `agu` executable:

```sh
npm install --global ./cli
cd /absolute/path/to/your/git-project
agu init
agu status
agu search "payment migration"
agu plan "payment migration"
```

The package is private and unpublished. Do not use `npm install agu` or assume a registry package belongs to this project.

## Review and act

`agu plan` prints the exact source excerpts, hashes, destination file, expiry, plan ID and approval hash. It does not write the report. Inspect it again with:

```sh
agu show <plan-id>
```

After reviewing, use the command printed by the CLI:

```sh
agu apply <plan-id> --approve <approval-hash>
```

Angle-bracket values above are placeholders. The approval hash identifies the exact plan; it is not an authentication token or a security boundary against someone who can modify your local database. This prototype assumes a trusted local workstation.

The only supported action writes `.agu/reports/<plan-id>.md`, verifies the output bytes and records the result. It cannot run repository commands or edit project code. A plan expires after 24 hours. Changed indexed files or a new HEAD invalidate a pending plan, including after a sync. Applying an already completed plan verifies and reuses the existing report instead of producing duplicates. If execution stopped after the file write but before committing the run record, an exact matching report can be reconciled on retry. Existing conflicting content is never overwritten.

## Commands

| Command | Behavior |
| --- | --- |
| `agu init` | Create `.agu/project.sqlite` and take the first evidence snapshot |
| `agu sync` | Refresh current evidence and record added, changed or removed indexed files |
| `agu status` | Show the snapshot, freshness and recent plan statuses |
| `agu search "terms"` | Return up to eight matching sources with a line number, excerpt and content hash |
| `agu history` | Show the last 50 index change events across syncs |
| `agu plan "terms"` | Propose an evidence report for review |
| `agu show <id>` | Display the stored plan and its approval hash |
| `agu apply <id> --approve <hash>` | Write and verify that exact report |

Every command accepts `--project <directory>` and `--json`. Run `agu --help` for usage. The prototype has no `agu update` command; reinstall the local package after pulling a newer source version.

## What gets indexed

Only Git-tracked, eligible UTF-8 text files in the selected working tree are indexed. This includes current uncommitted edits to tracked files. Untracked files are excluded. File types are allowlisted in `src/runtime.mjs`; common source files, Markdown and structured configuration are supported.

Symlinks, binary files, common dependency directories, `.env` files, credential/secret-named paths and key-file extensions are excluded. These are conservative name-based rules, **not a secret scanner**. Ordinary source files may still contain sensitive information; the SQLite index contains copies of eligible text and must remain local and private. A self-contained `.agu/.gitignore` ignores runtime state. The CLI rejects repositories that already track `.agu` files.

Limits: 10,000 tracked paths, 512 KiB per file, 20 MiB of indexed text. Large or non-text files are skipped; exceeding the overall limit aborts sync. No model or network service receives the data. Deleted/excluded files are removed from the live search index on sync; history retains their path and old/new hashes, not a full version archive. SQLite can retain old bytes in free pages or backups; this is not a secure-erasure guarantee.

Search is token-based and returns source excerpts, not synthesized answers. Results carry the indexed HEAD and file hash; an uncommitted file's hash is its precise identity, not the HEAD revision. History starts at initialization and records subsequent syncs; it does not reconstruct every historical Git commit. Avoid editing the repository while syncing/applying: the prototype checks HEAD and indexed content freshness but does not lock the external working tree.

## Next milestone

Add an opt-in model adapter that generates structured explanations strictly linked to retrieved evidence, with evaluation for unsupported claims. Then implement isolated patch preparation, diff review, scoped execution and verification. Publishing, signed updates, authenticated GitHub connections and a live UI come after those capabilities are tested. The public website remains a sample preview.

## Tests

```sh
npm --prefix cli test
```

The integration suite creates disposable Git repositories and covers real SQLite retrieval, exclusions, index changes, stale approvals, exact approval, plan integrity, path conflicts, retry recovery and CLI execution. It does not write into your projects or call a model.

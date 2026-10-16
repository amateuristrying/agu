# AGU local runtime · 0.2

AGU now uses a **knowledge base owned by the user**, made of ordinary Markdown, text and JSON files. There is no hosted context store, account service, SQLite dependency or vector database. A project has its own `.agu` folder; the local CLI and retro workspace read the same files.

This release adds opt-in model answers, citation checks, proposed code patches, exact-plan approval, isolated patch preparation, containerized checks, and a live local workspace. It remains an unpublished developer prototype, not a new foundation model or a production-autonomy system.

## Start

Requires Node.js 22.18+ and Git. From the repository:

```sh
node cli/bin/agu.mjs init --project /absolute/path/to/project
node cli/bin/agu.mjs search "payment migration" --project /absolute/path/to/project
node cli/bin/agu.mjs serve --project /absolute/path/to/project
```

Or install the local package, then work in your chosen repository:

```sh
npm install --global ./cli
cd /absolute/path/to/project
agu init
agu serve
```

Open the full localhost URL printed by `agu serve`. Its fragment contains a random session token; do not share it. The browser stores that token in tab-scoped session storage, not project data or API keys. The server binds only to `127.0.0.1`, validates Host and Origin, and requires the token for all API access. It has no cross-origin access from the public marketing site.

The package remains private and unpublished. Do not assume a registry package named `agu` is this product.

## Your knowledge base

```text
.agu/
  knowledge/
    README.md
    manifest.json          source identities, snapshots, notes and change history
    sources/<hash>.txt     immutable source versions
    notes/*.md             your imported or handwritten notes
  answers/<id>.json        cited model answers
  plans/<id>.json          reviewable actions and approval hashes
  runs/<id>.json           actual execution state and check output
  runs/<id>/workspace/    isolated patched text snapshot
  runs/<id>/changes.patch  reviewable patch artifact
  reports/<id>.md          local evidence reports
```

Use `agu remember /path/to/decision.md` to import a note, or put Markdown files directly in `knowledge/notes/`. Run `agu sync` after editing/adding/removing notes. Notes are included in retrieval alongside source files; their content is also untrusted input to the model.

The project index covers eligible Git-tracked text in the current working tree, including uncommitted edits. It excludes untracked project files, symlinks, common dependency directories, environment files and credential-named paths. Those filters are **not a secret scanner**: ordinary source files can contain sensitive material. Review selected context before a model call.

Limits are 10,000 tracked paths, 512 KiB per source/note, and 20 MiB of indexed project text. Search is deterministic lexical retrieval in memory, not embeddings. Source versions are immutable and hash-checked; history starts when AGU first syncs. It does not ingest all historic Git commits automatically. Old source versions remain in your knowledge folder even when removed from current search. Back up the folder if you want to retain this history; there is no automatic cloud backup or synchronization across devices/projects.

A `.agu/.gitignore` excludes runtime state. AGU refuses to run if `.agu` is already tracked. Keep this private folder out of shared archives unless you intend to share the included source, notes and model answers. Moving a knowledge folder to a different path is currently rejected by the root binding; cross-project import/export is a future feature.

### Existing 0.1 users

Run `agu init` to create the new file-based knowledge base from current project files. An existing `project.sqlite` is preserved but never opened or used by 0.2. Its historical snapshots and plans are not automatically migrated. Earlier generated reports remain on disk. Keep the old file until you have exported anything you need with the earlier runtime; no automatic deletion or destructive migration occurs.

## Ask a model, explicitly

Choose a model you already have available. AGU does not download a model or choose a paid model on your behalf.

For an installed local Ollama model:

```sh
export AGU_PROVIDER=ollama
export AGU_MODEL=YOUR_INSTALLED_LOCAL_MODEL
agu ask "What changed, and what might break?" --preview
agu ask "What changed, and what might break?" --allow-model
```

`YOUR_INSTALLED_LOCAL_MODEL` is a placeholder. The adapter uses `http://127.0.0.1:11434/api/chat`, JSON schema output and non-streaming requests. Use a genuinely local model and local Ollama configuration when context must stay on the machine; a local service address alone does not establish that the selected model runs locally. [Ollama chat API](https://docs.ollama.com/api/chat)

For OpenAI, set `AGU_PROVIDER=openai`, `AGU_MODEL` to an available structured-output model, and `OPENAI_API_KEY` in your terminal environment. The same preview/consent commands apply. Keys are never stored in the knowledge base or sent to the browser. Requests use the fixed Responses API endpoint, `store: false`, a schema, and no file uploads, vector stores or hosted conversations. Disabling response storage is **not** a promise of zero provider retention; account/provider data policies still apply. [Responses API](https://developers.openai.com/api/docs/guides/migrate-to-responses), [data controls](https://developers.openai.com/api/docs/guides/your-data)

Without `--allow-model`, no model request is made. `--preview` shows the question, destination, selected snippets and observed sync changes. Only that bounded context is sent; there are no automatic tool calls or model requests during sync, search or startup. A model receives up to eight excerpts within a 30,000-character retrieval budget. It does not see your entire knowledge base.

Answers contain separate **facts**, **inferences** and **missing information**. Every claim must cite a provided evidence ID and valid line range; citations are resolved to source paths and hashes. Invalid citations, malformed output, timeouts, refusals and evidence changes during generation fail closed. Citation validation confirms source identity and range, **not semantic entailment**. A model can still misinterpret a real source: review consequential conclusions.

## Plan a patch

```sh
agu plan "Update the payment version in service.js" --preview
agu plan "Update the payment version in service.js" --allow-model
agu show <plan-id>
```

The plan contains rationale, a unified diff, source hashes and citations, uncertainty, an expiry and a SHA-256 approval hash. Only bounded exact replacements in existing indexed files are supported (up to six files, one unambiguous replacement per file). New files, deletion, unsafe paths, dotfiles, private state and guessed replacement text are rejected. Do not expect broad repository refactors from this version.

For behavioral verification, provide explicit check arguments and an already-installed local Docker image **when creating the plan**:

```sh
agu plan "Fix the payment version check in service.js" --allow-model \
  --image YOUR_LOCAL_TEST_IMAGE \
  --check '["node","--test","test/payment.test.mjs"]'
```

The image is resolved to its immutable local image ID before the plan is saved. AGU does not pull images or install dependencies. The image must already contain the runtime/dependencies your checks need. Suggested checks returned by a model are shown as advice and are never automatically executed.

## Approve, execute and inspect

```sh
agu apply <plan-id> --approve <approval-hash>
```

Replace the placeholders with values from `agu show`. Approval binds to the complete plan, its selected checks and pinned image. It expires after 24 hours. Changed evidence, notes or HEAD require a new plan. Hash approval prevents accidental plan drift; it is not an authentication boundary against someone who controls your machine and can rewrite all local state.

AGU prepares the patch in `.agu/runs/<id>/workspace`, using only eligible indexed source text. **The original working tree is never modified.** The resulting `changes.patch` is available for manual review and integration. This is an isolated text snapshot, not a full Git checkout: untracked files, binary assets, dependencies and ignored content are not copied.

Approved checks run through a local Unix-socket Docker engine, with a read-only workspace/root filesystem, non-root container user, no network, no additional capabilities, no privilege escalation, and CPU/memory/PID/output/time limits. API keys and host environment variables are not passed to the container. Docker must be installed and running; there is no host-execution fallback. No production credentials, Docker socket or original project mount is exposed inside the container. Containers remain a security boundary with limitations, not a claim of perfect isolation. [Docker run reference](https://docs.docker.com/reference/cli/docker/container/run/)

Run states distinguish:

- `prepared`: patch bytes verified; no behavioral checks requested.
- `executing`: approved checks are running.
- `verified`: all approved checks actually returned success.
- `failed`: preparation or a check failed; inspect stored errors, exit codes and logs.

Repeat apply returns the existing run instead of silently re-executing it. A failed run needs a newly reviewed plan. Successful tests do not prove production correctness. If a process crashes, a run can remain `preparing` or `executing`; AGU does not mark it successful or retry automatically. Check the stored `active_container`, stop it if needed, verify no AGU process remains, then remove a leftover `.agu/write.lock` before creating a new plan. Never clear a lock while a run is still active.

Draft GitHub PR creation remains a later integration. This version does not push code, merge changes or deploy from the CLI.

## Live retro workspace

Run `agu serve --provider ollama --model YOUR_INSTALLED_LOCAL_MODEL`. It opens a live local interface styled after the retro preview, with actual source files, notes, sync history, model answers, saved plans, diffs and execution logs. Provider consent is unchecked after every request and whenever the question/mode changes. Patch execution requires the reviewed hash. The public website continues to use explicitly labelled sample data; it does not probe or attach to local servers automatically.

Commands also accept `--project <directory>` and `--json`. `agu report "terms"` preserves the model-free evidence-report workflow from 0.1; `agu plan` now proposes code patches. Reinstall the local package after pulling changes; a signed automatic updater is not implemented.

## Verification and current limits

```sh
npm --prefix cli test
```

Tests use disposable Git repositories, actual file-based storage and local HTTP servers. Model calls use protocol fixtures: they verify consent, parsing, citation rejection and stale responses without transmitting project data. Container command construction and pass/fail bookkeeping are covered; a live Docker execution requires Docker on the test machine. Hosted/local model inference must be smoke-tested with an explicitly configured provider before calling the integration production-ready.

The runtime assumes a trusted local workstation. It uses atomic record replacement and a process lock for mutation; it does not claim multi-tenant isolation, arbitrary-file adversary resistance, enterprise authentication or production-grade crash recovery. Context is user-owned; model-provider transmission is always a separate choice.

# AGU: from project understanding to verified action

Product proposal • 16 October 2026 • These are recommendations and targets, not shipped capabilities or achieved results.

## The product to build

AGU should be a project-understanding and action runtime: software that maintains an evidence-backed view of a project, explains what changed, and carries an approved task through to a verified result. Its first users should be small engineering teams working across GitHub, repository documentation and issue history.

A concise promise: **“Understand what changed. Know why it matters. Move the project forward.”**

Start with existing language models behind a replaceable model interface. AGU is a system architecture around those models: ingestion, project state, retrieval, planning, authorization, execution and verification. It is not currently a new foundation model, and the name does not establish artificial general intelligence or human-level understanding. Research into a new model architecture would need a separate hypothesis, training budget and evaluation program. It should follow evidence of a limitation that existing models cannot solve economically.

The practical distinction is between remembering an event and completing work because of it. A memory record saying “the payment API changed” has limited value. A system that finds the affected callers, explains the incompatibility, proposes a bounded fix, runs tests and opens an approved draft PR has an outcome a customer can evaluate.

## What exists today

The website has four chapters: the cursor-responsive metal-human hero, the editorial perspective, the interactive retro Project Atlas demonstration, and the final Use AGU screen with a footer. The preview uses sample data. The new install flow provides a browser-supported home-screen/app icon for that preview, with browser-specific instructions where a native install prompt is unavailable.

A local CLI prototype now provides Git-tracked text indexing, SQLite search, snapshot change history, and exact-plan-approved evidence reports; see [the runtime README](../cli/README.md). Its only action writes and verifies a local Markdown report. There is still no published npm CLI, production inference service, authenticated project connection, code-change executor or native desktop binary. Installing the preview does not install a model or give AGU access to local files. The broader CLI workflow on the site is labelled as a proposal; the local prototype implements only its evidence-report subset. No signup or waitlist submission is simulated.

## First customer and first workflow

Focus on a technical lead or engineer in a team of roughly 5–30 people. Their recurring problem is reconstructing why a release is blocked and identifying a concrete next step across commits, issues and documentation. Validate this with interviews before assuming it is the best market.

The first end-to-end workflow should be a release-change investigation with an optional draft fix:

1. Connect one explicitly selected GitHub repository and its checked-in documentation. Import a bounded recent history; index incremental changes afterward.
2. Ask “What is blocking this release?” AGU links each material claim to a file revision, issue, PR or commit. It distinguishes fact, inference, conflicting evidence and missing information.
3. Propose a next step with scope, expected effect, touched resources and verification criteria. If evidence is insufficient, request the missing source rather than invent an explanation.
4. Prepare a patch in an isolated worktree or worker. Show the exact diff, base revision and proposed commands. Running repository scripts is itself execution and must use the approved sandbox policy.
5. After approval, execute only the approved plan, run the agreed checks and optionally open a draft PR in the selected repository. Do not merge or deploy in the MVP.
6. Record actual outcomes with test logs, tool exit status and PR identifiers. A passing test supports a bounded claim; it does not prove production correctness.

The initial demo can use Project Atlas, but product validation must use consented real team tasks. Do not seed a fictional customer metric or pretend the static console is connected.

## Architecture

```text
Git / docs / GitHub events
         │
         ▼
Versioned event log → evidence + temporal project state
                              │
                         scoped retrieval
                              ▼
                  context assembly + model adapter
                              │
                   proposed typed action plan
                              ▼
                policy check + exact-plan approval
                              │
                isolated executor + tool adapters
                              ▼
                 verification + outcome ledger
                              │
                   refresh project evidence
```

| Layer | MVP implementation | Responsibility |
| --- | --- | --- |
| Client/runtime | TypeScript on a supported Node.js LTS; CLI plus a local UI | One runtime shared by CLI and UI; consistent plan and approval semantics |
| Local state | SQLite with FTS, source snapshots and relation tables | Durable local event history and lexical retrieval; embeddings only where evaluation justifies them |
| Evidence ingestion | Git/file adapters first, then a GitHub App | Incremental sync, stable source identifiers, deletion handling, permission boundaries |
| Team storage | PostgreSQL with pgvector where needed; object storage for artifacts | Tenant isolation, revision metadata, hybrid retrieval and auditable evidence |
| Model interface | Provider adapters with structured-output validation | Replaceable inference models, cost budgets, recorded model/prompt versions |
| Workflow engine | Persistent job state initially; Temporal when long waits and retries justify it | Resume approvals and executions after crashes without silently duplicating effects |
| Executor | Isolated worktrees and sandboxed workers; narrow typed tools | Enforce capabilities, network/resource limits and scoped credentials |
| Product UI | React/TypeScript for the real workspace | Evidence explorer, plan/diff review, run timeline and results; marketing site can remain static |
| Desktop later | Tauri shell with signed distributions and updates | OS integration over the same runtime, once users justify native packaging |

This is a proposed stack, not a description of the current static site's dependencies. Avoid building a graph database, custom vector database and orchestration platform simultaneously. Start with the simplest store that supports the actual queries; add infrastructure after a measured bottleneck.

Temporal supports durable workflow execution; external tools still need idempotency and reconciliation. MCP can standardize tool/resource connections, but does not replace AGU's authorization, provenance or execution policy. See [Temporal workflow execution](https://docs.temporal.io/workflow-execution) and [MCP architecture](https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture).

### Evidence and memory

Every evidence item needs a tenant/project identifier, source URI, source revision or content hash, observation time, event/effective time where available, and source permissions. Derived claims link back to evidence and record the derivation/model version. Store contradictory claims explicitly; avoid silently overwriting history with the most recent model answer.

Represent commits, files, services, issues, decisions and releases as entities with typed relations. Preserve when a relation was true and when AGU learned it. Enforce authorization before retrieval and again before an action. Deleted or revoked sources must stop being retrievable; retention and deletion of derived records need an explicit policy.

An AI assistant's summary is one attributed source, not ground truth. Imports from other AI tools need supported export/API access and user consent. Compare their claims against the underlying project evidence. A successful run can improve project memory and workflow examples without changing model weights. Do not call a sync operation “training your intelligence.”

Temporal memory is already an established area: [Graphiti](https://github.com/getzep/graphiti) provides evolving knowledge graphs and retrieval. This is a useful reference or potential component, and evidence that a knowledge graph alone is not AGU's differentiation.

### Actions: the part that makes this a product

Use a durable state machine: `observed → proposed → approved → executing → verified | failed | needs-review`.

An action plan should contain the initiating user, selected project, objective, source revisions, tool and argument list, resource scope, expected changes, estimated cost, preconditions, verification checks, expiry and a content hash. Approval binds to that exact plan and base state. If the target changes, revalidate or require a fresh approval. A retrieved document cannot approve an action or expand a tool's permissions.

Use deterministic tools for reading Git state, applying patches and interpreting process status. Use a language model to interpret context and propose changes. Never interpret a model's fluent explanation as evidence that a tool succeeded.

Give every externally visible operation an idempotency key. If an API times out after creating a PR, reconcile using a stored run identifier before retrying. “Retry” must not mean “create a second PR.” Record attempted actions and returned identifiers before advancing the workflow. A compensating action is possible for some effects; do not promise universal undo.

Start with human approval for writes. Only consider narrowly scoped automatic actions after evaluation and customer opt-in. Keep production deployments, destructive changes and broad credential access out of the MVP. Use short-lived, repository-scoped credentials; a [GitHub App installation token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation) is a suitable integration mechanism.

Local storage and cloud inference are different choices. Clearly show what context leaves the machine, which provider receives it, retention behavior, and how to disable that route. Team retrieval must never cross tenant boundaries. The product should support export, deletion, permission revocation and observable run history from the beginning.

## How users should get AGU

| Delivery | Recommendation | What it actually provides |
| --- | --- | --- |
| Browser / installed PWA | Available for the current preview | An app icon and standalone preview where supported; no local daemon or unrestricted filesystem access |
| npm CLI | First real developer product | Install the runtime, connect a selected project, sync evidence, review plans and execute approved tasks |
| Signed binaries | After CLI validation | Installation without a Node.js prerequisite; platform-specific releases and verified checksums/signatures |
| Native desktop app | After proving daily use | A persistent workspace and OS integration; signed releases, migrations and controlled updates |
| curl installer | Optional convenience later | A published, inspectable bootstrap script for verified binaries; not a prerequisite or a substitute for release integrity |

For npm, first register a package under a scope the project actually owns. The following is a **design example, not a runnable installation instruction today**; replace `YOUR_SCOPE` only after package ownership and publication:

```sh
npm install -g @YOUR_SCOPE/agu@latest
agu init
agu sync
agu plan "Explain the release blocker and propose a fix"
agu apply <plan-id>
```

`npm agu update` is not standard npm syntax. Once the package is published, `npm install -g @YOUR_SCOPE/agu@latest` can explicitly install its latest release. A custom `agu update` could provide a guided equivalent after checking installation method. `npm update -g` has npm's own version-range behavior, so do not promise it always upgrades to every new major version. Reference: [npm install](https://docs.npmjs.com/cli/v11/commands/npm-install/) and [npm update](https://docs.npmjs.com/cli/v11/commands/npm-update/).

Keep three operations distinct:

- `agu sync`: refresh project evidence and indexes.
- `agu update`: update AGU's software, with migration checks and release notes.
- A future `agu models` command: select or change model configuration, with permission, cost and compatibility checks.

Updating software does not automatically improve the base model or make the user's project knowledge correct. Test migrations, preserve a recoverable data snapshot, and verify compatibility. Native desktop updates should use signed artifacts; see [Tauri's updater](https://v2.tauri.app/plugin/updater/).

The PWA manifest supplies app identity, icons and a launch URL. Browser/OS installation support varies; the site uses a native prompt only when supplied by the browser and otherwise offers instructions. The current worker caches a small static preview shell after a successful visit, excludes hero videos and bypasses external services and API calls. Offline use shows the hero poster instead of interactive video. See [MDN's installable PWA guide](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).

## A credible 12-week validation plan

This is a planning estimate for two experienced engineers with the founder recruiting and supporting design partners. Adjust after technical discovery; these are gates, not delivery promises.

| Stage | Build | Evidence required to proceed |
| --- | --- | --- |
| Weeks 1–2 | Interview 10 target teams, recruit 3–5 partners, collect consented release investigations, establish manual/agent baselines | A recurring painful workflow and access to representative tasks; at least 3 teams agree to pilot |
| Weeks 3–4 | Local CLI, Git/docs ingestion, evidence links, change history, read-only answers | Held-out questions can be answered with traceable, current evidence; stale and contradictory sources are handled |
| Weeks 5–7 | Typed plans, scoped approvals, isolated patches/tests, draft PR adapter, durable run ledger | End-to-end tasks complete with explicit approval, verified tool results and crash/retry recovery |
| Weeks 8–9 | Real pilot use, latency/cost profiling, evidence and action evaluation | Usage repeats beyond a novelty demo; known failure modes are visible and recoverable |
| Weeks 10–12 | Packaging, update/migration flow, paid pilots and focused iteration | Customers pay or commit to a specific pilot; measured value supports further investment |

Measure 30–50 representative held-out tasks initially and expand the set as partners use the product. Include stale branches, renamed files, denied permissions, malicious instructions in documents, conflicting sources, provider failures and API timeouts. Compare against the team's current workflow and a capable coding assistant with similar model access and budget. Count human review/correction time, not just model runtime. With small samples, show task-level results and distributions rather than claiming statistical certainty.

Proposed pilot targets, **not achieved metrics**:

- At least 30% lower median end-to-end investigation/fix time versus the agreed baseline, without lowering reviewer acceptance or check quality.
- At least 90% of material factual claims supported by their cited evidence on a held-out set, with separate reporting for stale evidence and unsupported inference.
- At least 80% of approved in-scope tasks reaching their predeclared verification checks without human repair; report task mix and failures.
- Zero unauthorized writes in the evaluation and pilot, plus explicit permission-bypass and prompt-injection tests. Zero observed incidents is not proof of zero risk.
- Weekly returning use from at least 3 of the first 5 partner teams after four weeks, with concrete reasons for return or abandonment.
- Cost and elapsed time per verified outcome, human intervention minutes, approval rejection rate, and repeat use per team.

## What could make AGU investable

The hypothesis is that engineering teams will pay for reliable progress across changing project context. Prove that with a narrow workflow before expanding to every resource and every action. Buyers should be able to explain which recurring job AGU takes off their plate.

Potential differentiation is an evidence-to-outcome loop: versioned project context, reproducible plans, permission-aware execution and measured verification. The defensibility would have to emerge from workflow depth, integration quality, customer trust and an evaluation corpus of real failure modes. A polished UI, generic retrieval or a prompt around an existing model is insufficient by itself.

Use outcome data only under explicit customer agreements. Never assume customer code or transcripts can become a shared training set. Reusable evaluation fixtures can be synthetic, licensed, or explicitly consented. Keep customer-specific memory isolated.

Test a paid design-partner offer around $200–$500 per workspace per month with a clear usage allowance, or a time-bounded fixed-fee pilot. This is a pricing hypothesis, not a market valuation or established willingness to pay. Track inference, execution, storage and support costs before promising unlimited usage. Interview customers about the value of completed work and their procurement constraints.

A useful investor demonstration is one real investigation carried through an approved draft PR, showing the evidence, failure handling and verified result. Pair it with paid-pilot demand, repeat usage, honest baseline comparisons, cost per successful task and a focused expansion path. No architecture guarantees funding; these observations make the product thesis assessable.

## Scope after validation

Add issues and deployment metadata when they resolve real gaps in the first workflow. Add other AI session imports only through supported, consented connections. Add desktop packaging when users need persistent local access. Add broader action types only when their permissions, verification and recovery are explicit. Consider fine-tuning or model research after the evaluation set identifies a repeated model-level bottleneck that retrieval, tools and workflow design do not solve.

The immediate product milestone is simple to judge: **a user connects one project, asks a consequential question, sees the evidence, approves a bounded change, and gets a verified result.**

# App Feedback Execution Plan

**Goal:** Deliver the approved Slack-to-verified-PR workflow and demonstrate it against a polished sample application.

**Architecture:** Switch runs the Codex agents and carries conversations and handoffs. A small persistent service validates decisions and claims, mirrors tickets to GitHub, and checks PR previews. The sample app is an independent Git repository so implementation agents can change it without changing the orchestration system.

**Tech stack:** TypeScript, Node.js 22 LTS, npm workspaces, PostgreSQL 16, Vitest; Next.js App Router/React and Playwright for the sample app; Switch Console/Codex, GitHub, Vercel and Neon for integrations. Use plain SQL migrations and `pg`; use `ws` for the service's Switch connection. No new LLM API account, model SDK, or second agent framework.

**Spec:** [Approved specification](../../SPEC.md). Vocabulary: [CONTEXT.md](../../CONTEXT.md).

## Global constraints

- This is a plan, not an instruction to start implementation or provision services before the user reviews it.
- All future paths in these plans are relative to this project's root, the directory containing SPEC.md. They describe files to create later; only documentation exists now.
- Two logical roles, feedback and implementation, both powered by the existing Codex subscription. Multiple engineers/worker agents and concurrent PRs are supported; no global one-PR limit.
- Code changes stop at verified PR handoff. Human-requested corrections remain in scope; merge automation, merge conflicts, rebases to track main, production release, and issue closure stay outside the workflow.
- One room maps to one sample-app repository. GitHub is the shared work record; the service is authoritative for enforced claims and decision versions. No second tracker UI.
- Human decisions must be derived from source-authenticated Switch messages, never sender IDs supplied by an LLM tool argument.
- Keep service credentials, coordinator state, and worktrees outside the sample-app repository. The worker's normal editing scope is its isolated sample-app checkout.
- Next.js/React/library package versions must be resolved from official package metadata at task execution, installed with exact versions, and locked. Do not guess newer API surfaces from these plans; the Switch contract gate captures the actual installed contract.
- No app authentication, automated video analysis, extra chat adapters, independent AI reviewer, or custom preview database provisioning.

## Review focus

1. Human/agent impersonation and stale approvals: workflow [Task F2](2026-11-06-feedback-workflow.md#task-f2-transactional-request-lifecycle-and-decisions), test `decisions.reject-spoofed-or-stale.test.ts`.
2. Competing workers and abandoned ownership: workflow [Task F3](2026-11-06-feedback-workflow.md#task-f3-exclusive-claims-and-explicit-reassignment), test `claims.concurrent.test.ts`.
3. Retries, lost acknowledgements, and duplicate tickets: workflow [Task F5](2026-11-06-feedback-workflow.md#task-f5-github-issue-projection-and-recoverable-effects), test `effects.recovery.test.ts`.
4. Failed/stale/inaccessible previews and schema isolation: workflow [Task F8](2026-11-06-feedback-workflow.md#task-f8-pr-previews-verification-and-requester-handoff), test `previews.current-head.test.ts`.
5. Thread/attachment correlation and regression correctness: workflow [Task F4](2026-11-06-feedback-workflow.md#task-f4-switch-event-ingestion-and-confirmation-routing), test `switch.thread-and-media.test.ts`; app [Task A4](2026-11-06-sample-app.md#task-a4-repeatable-demo-bug-and-independent-verification), test `export.contract.test.ts`.

## Plans and dependency order

1. Execute **F1**, the Switch compatibility gate, before investing in the full app or coordinator. It must prove the needed transport, identity, thread, file, and agent-tool integration on the actual release.
2. Execute [sample-app plan A1–A4](2026-11-06-sample-app.md). It yields a runnable polished app, persistent fixtures, a frozen demo baseline, and an independently reproducible export defect.
3. Execute [workflow plan F2–F5](2026-11-06-feedback-workflow.md). These can be tested against a disposable GitHub repository independently of the sample app.
4. Execute workflow F6–F8 with the frozen sample app, then F9 for end-to-end verification and submission evidence.

An implementation run should cover one task, or a tightly coupled task pair, then stop for tests and change review. Prefer sequential local execution: identity, claims, and external-effect recovery are tightly coupled and do not benefit from concurrent edits to shared files. If task commits are selected during execution, commit only at these reviewable boundaries, not each red-green step; no push is implied by a local task commit.

## Local project layout to create

- `package.json`, `package-lock.json`, `tsconfig.base.json`, `vitest.config.ts`, `.gitignore`: automation workspace and checks.
- `packages/contracts/`: public request/action/configuration types, runtime validation.
- `apps/coordinator/`: PostgreSQL lifecycle, claims, Switch event client, GitHub/Vercel adapters, local authenticated HTTP endpoints, and bounded background effects.
- `apps/agent-cli/`: `feedbackctl`, the small JSON CLI the Switch-run Codex agents call. This avoids depending on custom MCP injection before that behavior is proven.
- `config/`, `switch/`, `scripts/`, `tests/`, `docs/`: configuration, role instructions, contract checks, adversarial integration tests, and setup/demo documentation.
- `sample-app/`: a **separate** Git repository, with its own package lock, Next.js app, database migrations, tests, and GitHub remote. Ignore this nested checkout and `.local/` in the automation repository. Preserve the sample app's README and demo setup when packaging the submission.
- `.local/`: ignored coordinator secrets, agent-specific CLI credential files, evidence artifacts, and worktrees. Never package its secrets. In team deployments worker checkout roots are machine-local configuration, not shared absolute paths.

The final README links both GitHub repositories so judges can reproduce the system without receiving private keys or runtime state.

## External setup and permissions

During implementation, confirm the intended Slack workspace/channel, GitHub owner/repositories, and Vercel project before writing externally. The user or connected account flow performs sign-in and consent; never request tokens in chat. Run setup and live tests only in the explicitly selected demo resources.

- Switch Console/server and Slack bridge; actual version saved by F1. Feedback agent, at least two implementation identities for the demo, and one deterministic service participant. The service participant is transport infrastructure, not a third AI role.
- Codex CLI installed and signed in where workers run. Switch owns those sessions and supplies its native room tools. No direct model API key is needed.
- GitHub credentials for issue/PR writes held by the coordinator; worker Git push authentication configured by the engineer's normal Git credential flow. Shared machine credentials are not claimed to be adversarial isolation.
- Vercel Git integration attached to the **sample-app** repo; Neon preview branching configured against seeded fictional baseline data. Coordinator persistence is separate and is never cloned into app previews.
- Requesters must be able to open the actual preview link. Configure intended collaborator access or a supported shareable deployment link; keep such links out of public recordings when they confer access.

## Release gates and risk ordering

- **Gate 1:** F1 passes on the installed Switch release. If source-authoritative identity or same-thread replies cannot be demonstrated, stop and resolve the contract; do not replace Switch with a direct Slack bot or trust model-supplied identities.
- **Gate 2:** App baseline and deliberate defect are repeatable; coordinator decisions/claims pass adversarial tests.
- **Gate 3:** One real text-only request produces a GitHub Issue, authorized claim, verified change, PR, and accessible preview. Keep it unmerged and prove another request can progress.
- **Gate 4:** Screenshot intake, a confirmed duplicate, a feature with a migration, and a blocked/reassigned request work; regression checks remain reproducible.
- **Gate 5:** Clean-clone setup, README, exact demo steps, and recorded evidence agree. Never describe fakes or fixture tests as live integration evidence.

If time is tight, freeze visual enhancements and automate less presentation; retain the approved product gates and report any missing acceptance check honestly. Do not expand the sample app or silently remove required behavior.

## What this plan deliberately does not decide for the requester

Priority values and the existing-task default must be confirmed during the feature-request demonstration. They are not secretly implemented in the baseline. Tests for the demonstration will take their expected values from the recorded, human-confirmed criteria.

## Documentation consulted

Checked on 2026-11-06. The release gate verifies differences between these current docs and the installed release.

- [Switch agent protocol](https://docs.switchagents.ai/switch-rooms/internals/agent-protocol): operation discovery and agent-to-agent messaging.
- [Switch connection](https://docs.switchagents.ai/switch-rooms/internals/agent-connection): WebSocket transport and reconnect behavior.
- [Switch events](https://docs.switchagents.ai/switch-rooms/internals/agent-events): opaque sender IDs and attachment grouping.
- [Switch runtime](https://docs.switchagents.ai/switch-rooms/internals/connectors-and-runtime): Console owns coding sessions and attachment delivery.
- [Switch work in a room](https://docs.switchagents.ai/switch-rooms/using/work-in-a-room): follow-ups and thread handling.
- [Switch identity](https://docs.switchagents.ai/switch-rooms/internals/identity-and-access): membership, addressing, and permission distinctions.
- [Next.js route handlers](https://nextjs.org/docs/app/getting-started/route-handlers) and [testing](https://nextjs.org/docs/app/guides/testing/vitest).
- [GitHub Issues](https://docs.github.com/en/rest/issues/issues) and [PRs](https://docs.github.com/en/rest/pulls/pulls).
- [PostgreSQL transactions with pg](https://node-postgres.com/features/transactions) and [GitHub deployment statuses](https://docs.github.com/en/rest/deployments/statuses).
- [Vercel GitHub previews](https://vercel.com/docs/git/vercel-for-github), [Neon integration](https://neon.com/docs/guides/vercel-managed-integration), and [preview sharing](https://vercel.com/docs/deployments/sharing-deployments).

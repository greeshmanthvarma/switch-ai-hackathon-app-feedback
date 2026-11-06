# Switch App Feedback Workflow Implementation Plan

**Goal:** Turn user reports in Slack into confirmed GitHub Issues, exclusively claimed implementation work, and verified PRs with usable previews and same-thread requester feedback.

**Architecture:** Switch Console runs Codex feedback/implementation agents. A deterministic coordinator connects to Switch under its own service identity, stores trusted room events and transactional workflow state in PostgreSQL, and exposes authenticated actions through a JSON CLI. External-effect workers mirror issues and notify agents through Switch; GitHub/Vercel integrations supply PRs and preview deployments. There is no direct Slack bot replacing Switch and no additional AI role.

**Tech stack:** Node.js 22, TypeScript, npm workspaces, PostgreSQL 16 with `pg`, Zod, Fastify, `ws`, Vitest, Git CLI, GitHub REST API, Switch agent protocol, Vercel/Neon. Agent tools are initially `feedbackctl` shell commands, not an assumed custom MCP extension to Switch's runtime.

**Spec:** [SPEC.md](../../SPEC.md); execution ordering and external prerequisites: [execution index](2026-11-06-execution-index.md).

## Global constraints

- Paths are relative to the directory containing SPEC.md; `sample-app/` is a separate Git repository produced by the app plan.
- Each agent has its own identity and coordinator credential. Human actors come only from the coordinator's authenticated Switch event stream. Agent actions carry event references, never an authoritative human `actorId` parameter.
- An explicit feedback mention starts a report. Unmentioned channel chatter never creates work, even if the Switch room enables conversational follow-ups. Unmentioned replies in a known request thread may clarify but cannot confirm, authorize, or accept.
- Use native Switch messages for user conversation, notifications, and handoffs. Do not make agents open raw second connections under their Console-managed identities. The service participant is separately registered and never invokes an LLM.
- One room/app/repo configuration; one issue can have multiple confirmed-duplicate request threads. Initial requester authority stays with the original requester; secondary reporters do not accept requirements or PRs on their behalf.
- One current claim per request; registered team workers can implement different requests concurrently. PRs waiting for people never reserve team-wide capacity.
- Only current, confirmed, authorized criteria can be claimed. Changing criteria revokes old authorization. Superseded claim generations cannot mutate service state or request a new PR.
- Never close issues, merge PRs, resolve merge conflicts, auto-rebase onto main, or deploy production. PR text uses `Related to #N`, never auto-closing keywords.
- External integrations fail closed. Provider outages are not coding failures. Retries never silently create an additional issue, PR, or acceptance decision.
- Tests use disposable fixture resources until live demo setup is explicitly selected. No production data/credentials are needed.

## Review focus

1. Spoofed, stale, wrong-person or wrong-stage decisions: F2, `decisions.reject-spoofed-or-stale.test.ts`.
2. Claim races, revoked workers and duplicate pickup notifications: F3, `claims.concurrent.test.ts`.
3. Replayed Switch events, wrong threads, grouped attachments and stream gaps: F4, `switch.thread-and-media.test.ts` and `switch.reconnect.test.ts`.
4. Lost HTTP acknowledgements and partial cross-system writes: F5, `effects.recovery.test.ts`.
5. Incorrect code, failed previews, changed head commits and inaccessible links: F6 `attempts.limit.test.ts`, F8 `previews.current-head.test.ts` and `previews.access.test.ts`.

## Dependency direction and file responsibilities

- `packages/contracts/src/{config,request,actions,ports}.ts` owns runtime-validated public types. It imports no adapter or agent code.
- `apps/coordinator/src/domain/{lifecycle,decisions,claims,attempts}.ts` owns invariants; domain functions use one passed database transaction and validated inputs.
- `apps/coordinator/src/store/{pool,transaction,inbox,outbox}.ts` owns durable operations. SQL migrations live at `apps/coordinator/db/migrations/`.
- `apps/coordinator/src/switch/{connection,normalize,operations,ingest}.ts` is the only source of trusted Switch events. It adapts discovered wire schemas into application-owned contracts.
- `apps/coordinator/src/github/{client,issues,pulls,deployments}.ts` owns GitHub calls, pagination, projections and correlation markers.
- `apps/coordinator/src/services/{requests,dispatch,effects,previews,recovery}.ts` composes domain and ports. It is not a second agent planner.
- `apps/coordinator/src/{server,main}.ts` handles authenticated HTTP and lifecycle loops.
- `apps/agent-cli/src/{main,client,worktree,checks,profile}.ts` provides machine-local worker actions using argument arrays, separate checkout directories and JSON input/output.
- `switch/{room,feedback,implementation}.md` contains scoped agent instructions; `switch/app-feedback.template.yaml` is authored against the verified template contract, not guessed fields.

## Public contracts

These are **our application contracts**, not claims about Switch's HTTP argument shapes. The F1 capture determines how the Switch adapter implements them.

```ts
type RequestId = string; // UUID; generated by the coordinator
type Revision = number; // integer >= 1
type Sha = string; // full Git SHA from GitHub; never abbreviate in storage
type RequestState = 'clarifying' | 'awaiting_authorization' | 'available'
  | 'implementing' | 'pr_opened' | 'blocked';
type Role = 'feedback' | 'implementation';
type AuthenticatedAgent = { agentId:string; ownerEngineerId:string|null; role:Role; roomIds:string[] };
type AttachmentEvidence = { sourceMessageId:string; filename:string; mimeType:string;
  size:number; mediaRef:string|null; sourceUrl:string|null; summary:string|null;
  interpretation:'not_attempted'|'interpreted'|'unavailable'|'unsupported' };
type TrustedMessage = { sourceKey:string; serverKey:string; roomId:string; bridgeId:string|null;
  channelId:string; sourceMessageId:string; threadRootId:string; senderParticipantId:string;
  senderKind:'human'|'agent'|'system'|'unknown'; body:string; occurredAt:string;
  attachments:AttachmentEvidence[]; sequence:number; sourcePermalink:string|null };
type RequirementSet = { revision:Revision; summary:string; criteria:string[]; contentHash:string };
type Claim = { requestId:RequestId; agentId:string; engineerId:string; epoch:number;
  branch:string; baseSha:Sha; claimedAt:string; lastHeartbeatAt:string };
type VerificationEvidence = { requestId:RequestId; epoch:number; attempt:number; headSha:Sha;
  commands:Array<{name:'typecheck'|'unit'|'integration'|'build'|'browser'|'regression';
    exitCode:number; durationMs:number; artifactId:string}>;
  criterionResults:Array<{criterionIndex:number; result:'passed'|'failed'; artifactId:string}> };
type Handoff = { requestId:RequestId; revision:Revision; epoch:number; prNumber:number;
  prUrl:string; branch:string; headSha:Sha; evidenceId:string; summary:string;
  verificationSteps:string[]; previewRequired:boolean; previewUrl:string|null };
type RequestView = { id:RequestId; state:RequestState; revision:Revision; title:string;
  kind:'bug'|'feature'; issueNumber:number|null; issueUrl:string|null;
  claim:Claim|null; requirements:RequirementSet|null; handoff:Handoff|null;
  acceptance:{sha:Sha; sourceEventKey:string}|null; blocker:string|null };
type Result<T> = {ok:true;value:T} | {ok:false;error:{code:
  'INVALID_INPUT'|'UNAUTHORIZED'|'NOT_FOUND'|'WRONG_STAGE'|'STALE_REVISION'
  |'STALE_CLAIM'|'ALREADY_CLAIMED'|'WORKER_BUSY'|'SOURCE_PENDING'
  |'AMBIGUOUS_DECISION'|'ATTEMPT_LIMIT'|'DEPENDENCY_UNAVAILABLE'|'EFFECT_UNCERTAIN';message:string}};
interface SwitchPort {
  send(input:{roomId:string;threadRootId:string;targetParticipantIds:string[];
    body:string;effectKey:string}):Promise<{sourceMessageId:string}>;
  readThread(input:{roomId:string;threadRootId:string}):Promise<TrustedMessage[]>;
  participants(roomId:string):Promise<Array<{id:string;kind:TrustedMessage['senderKind'];name:string}>>;
}
```

`config/rooms.example.json` is a validated array of:

```ts
type RoomConfig = { id:string; switchServerKey:string; switchRoomId:string; slackChannelId:string;
  githubRepo:string; baseBranch:string; feedbackAgentId:string; feedbackMention:string;
  engineers:Array<{id:string;switchParticipantId:string;githubLogin:string}>;
  workers:Array<{agentId:string;ownerEngineerId:string}>;
  vercelProjectId:string|null; allowedPreviewHosts:string[] };
```

Secrets are separate environment/local profile values, never fields in the tracked config. The server's allowed room mapping bounds every lookup. Do not infer human/agent kind by parsing opaque participant ID strings.

For pre-preview tasks allow `vercelProjectId` to be null and `allowedPreviewHosts` to be empty; F8 refuses to start preview work until both are configured. This keeps F1 independent of unfinished deployment setup.

### HTTP and CLI surface

- `GET /health`: no secrets; reports process/database/stream readiness.
- `POST /v1/actions`: bearer-agent authentication plus an `Idempotency-Key` UUID. Body is one of the actions below. Reject unknown fields. Return Result, with HTTP 400 for invalid input, 401/403 for auth, 404 for absent resource, 409 for state/ownership/version conflict, 503 for unavailable dependencies, and 200/201 on success.
- No HTTP endpoint accepts a caller-supplied trusted human message. Only the internal Switch connector writes the trusted inbox.
- `feedbackctl action --profile <name>` reads one Action JSON object from stdin, prints one Result JSON object to stdout and exits 0 on success/1 on action failure/2 on invalid input. Diagnostics go to stderr with secrets redacted. `--profile` selects an ignored machine-local credential file whose identity matches the configured agent; input cannot override identity.
- `feedbackctl prepare --profile <name> --request <uuid>`, `feedbackctl check --profile <name> --request <uuid>`, and `feedbackctl submit --profile <name> --request <uuid>` implement F6 machine-local steps and call the actions below. `feedbackctl status --profile <name> --request <uuid>` is read-only `get_request`.

Action union (all return RequestView unless specified):

- `get_request {requestId}`; `list_available {roomId}` → RequestView[].
- `lookup_source {roomId,sourceMessageId}` → `{sourceEventKey:string}`: a read-only lookup of an observed message in the caller's allowed room. Return SOURCE_PENDING when the native agent input arrives before the service's durable event. The native room/message IDs come from Switch tools/context, not IDs invented by the model.
- `open_report {roomId,sourceEventKey,kind,title,summary}`: feedback only; original source must be a human's explicit initial feedback mention. Establish stable request ID before enqueueing issue creation.
- `propose_requirements {requestId,expectedRevision,summary,criteria}`: feedback only; creates next immutable revision (the first uses expectedRevision=0). Any existing confirmation/authorization is invalidated. Active coding requires a pause/stop acknowledgement before a revised request is re-dispatched.
- `prepare_prompt {requestId,stage:'requirements'|'authorization'|'acceptance'}` → `{promptId,text,expectedReply,revision,headSha}`. Text is generated by the service from current state; the feedback agent posts it through native Switch tools. F4 validates the actual published message before accepting a human response.
- `propose_duplicate {requestId,candidateIssueNumbers:number[]}`; `link_duplicate {requestId,targetRequestId,sourceEventKey}`: feedback only; verify the secondary requester's explicit same-problem confirmation before linking. The duplicate's identity remains as a thread alias, with `alias_of` outside the normal work-state enum; it cannot be claimed separately.
- `claim {requestId,expectedRevision}` → Claim: implementation only, available current authorized work and idle registered worker.
- `heartbeat {requestId,epoch}`; `progress {requestId,epoch,summary}`: current worker only.
- `begin_attempt {requestId,epoch}` → `{attempt:number,remaining:number}`.
- `store_artifact {requestId,epoch,headSha,kind:'check_log'|'verification',content:string}` → `{artifactId:string,contentHash:string}`: current worker only, at most 1 MB of redacted UTF-8 text, written under a server-generated path. Neither artifact paths nor credentials are accepted from the caller.
- `complete_attempt {requestId,epoch,attempt,evidence:VerificationEvidence,outcome:'passed'|'failed'|'dependency_unavailable'}` → `{request:RequestView,evidenceId:string}`: worker only; validate referenced artifact ownership/SHA, save the evidence as a verification artifact, and return its identity. Dependencies pause without consuming a completed coding pass. A passed result still needs independently checked handoff/preview identity.
- `submit_pr {requestId,epoch,headSha,summary,verificationSteps,previewRequired,evidenceId}`: current worker only; F7 verifies remote branch/head and creates or updates the request's one PR.
- `report_blocker {requestId,epoch,reason:'worker_stopped'|'needs_information'|'verification_failed'|'dependency_unavailable',detail}`.
- `request_correction {requestId,sourceEventKey,summary,changesRequirements:boolean}`: feedback only; human source must be requester/engineer. Changed criteria invalidate decisions; unchanged criteria still need explicit engineer resume authorization before another implementation budget.
- `apply_control {requestId,sourceEventKey}`: feedback may request evaluation, but the service parses the observed engineer message to determine `resume`, `release`, or `reassign`; tool input never declares human authority or an arbitrary replacement agent.
- `search_issues {roomId,query}` → `{issueNumber:number,title:string,url:string,requestId:string|null}[]`; excludes PRs from GitHub's mixed issues listing. `query` is bounded to 200 chars and repository scope is fixed by config.

Source-authoritative `confirm`, `authorize`, and `accept` are applied directly by F4's event handler. Agents cannot perform them by submitting their own actor IDs.

Source keys are generated by the connector as SHA-256 of canonical JSON `[serverKey, roomId, logicalMessageId]`. A valid attachment group supplies logicalMessageId; otherwise use the source message ID. Agents obtain keys with `lookup_source`, not by inventing keys or passing raw human event payloads. Late files update the existing logical message's evidence without reapplying its text as a fresh decision.

### Package scripts to create

Define these at the automation root as the owning task adds the corresponding files:

- `test`: `vitest run` (Node environment; excludes sample-app, .local, live-only tests, and deployed-preview tests).
- `test:contract`: `vitest run tests/contracts` (sanitized fixture checks; no live writes).
- `test:db`: `vitest run --config vitest.db.config.ts` (domain/DB and recovery tests using isolated coordinator database).
- `test:e2e:workflow`: `vitest run tests/e2e` (deterministic full-flow tests with fake external ports).
- `test:preview`: `vitest run --config vitest.preview.config.ts` (requires explicit PREVIEW_BASE_URL and recorded criteria/fixture expectations; never defaults to an arbitrary remote).
- `typecheck`: `tsc --noEmit -p tsconfig.json`; use strict configuration, include existing apps/packages/scripts/tests, exclude independent sample-app and local worktrees.
- `format:check`: `prettier --check . --ignore-path .gitignore`; provide a matching format script for intentional formatting.
- `db:migrate`: `tsx apps/coordinator/scripts/migrate.ts`.
- `dev:coordinator`: `tsx watch apps/coordinator/src/main.ts`.
- `feedbackctl`: `tsx apps/agent-cli/src/main.ts`; agent instructions render the absolute-root invocation `npm run --silent --prefix '<automation-root>' feedbackctl -- action --profile <configured-profile>` so workers can use it from independent checkouts without global installation.
- `probe:switch`: `tsx scripts/switch-contract-probe.ts`.
- `demo:preflight`: `tsx scripts/demo-preflight.ts`; `demo:reset`: `tsx scripts/demo-reset.ts` (explicit operator confirmation and designated fixture resources only).

F1 defines only scripts it can execute; later tasks add the rest alongside their behavior. All npm script execution occurs from an npm package root and uses its pinned local dependencies.

### Confirmation and engineer controls

Use the agreed ordinary commands `@feedback confirm`, `@feedback authorize`, and `@feedback accept` only when there is a single unambiguous current prompt and no superseded prompt of that stage. Prompts include a visible revision identifier. After a revision/preview changes, ask for the displayed suffix, e.g. `@feedback confirm R2`, `@feedback authorize R2`, or `@feedback accept P2`. Reject an ambiguous bare reply rather than guessing which version the human saw. This is a stale-confirmation safeguard, not a technical question for the requester.

Engineer-only controls are `@feedback resume Rn`, `@feedback release`, and `@feedback reassign @registered-worker`. Release/reassign requires the engineer to confirm the old worker has stopped; the response prompt includes the current claim epoch. When that prompt has changed, require its displayed `C<n>` suffix. Code and criteria edits in ordinary prose are data; role checks and explicit controls authorize execution.

## Persistent schema and transactions

Migration `0001_coordination.sql` creates the following. All IDs are UUID unless stated; timestamps are UTC timestamptz; created_at is required throughout.

- `room_configs(id text primary key, config jsonb, config_version int)`; validated config also loaded from tracked config at startup with explicit operator apply, not LLM edits.
- `agents(id text primary key, role text, room_config_id text references room_configs, owner_engineer_id text null, credential_hash text, enabled boolean, busy_request_id uuid null)`. Each enrolled identity serves this installation's configured demo room; multi-room enrollment is not required for the MVP. This imposes no cap on participating engineers or worker identities.
- `source_events(source_key text primary key, server_key text, room_config_id text, source_message_id text, thread_root_id text, sender_id text, sender_kind text, sequence bigint, occurred_at timestamptz, received_at timestamptz, payload jsonb, applied_at timestamptz null)`; unique `(server_key, room_config_id, source_message_id)` for logical messages after attachment grouping.
- `stream_positions(server_key text, service_agent_id text, connection_id uuid, generation int null, durable_cursor bigint, health text, primary key(server_key,service_agent_id))`.
- `requests(id uuid primary key, room_config_id text, requester_id text, source_event_key text unique references source_events, kind text, title text, summary text, state text, state_version int, requirements_revision int, issue_number bigint null, issue_url text null, alias_of uuid null references requests, blocked_from_state text null, blocker jsonb null)`; unique `(room_config_id,issue_number)` when non-null.
- `request_threads(request_id uuid references requests, room_config_id text, thread_root_id text, reporter_id text, source_permalink text null, primary key(room_config_id,thread_root_id))`. Each thread points to one canonical request; keep secondary reporter metadata when linking duplicates.
- `requirements(request_id uuid, revision int, summary text, criteria jsonb, content_hash text, primary key(request_id,revision))`.
- `prompts(id uuid primary key, request_id uuid, stage text, revision int, head_sha text null, prompt_version int, exact_text text, published_event_key text null, status text, superseded_at timestamptz null)`. One active prompt per request/stage, enforced by partial unique index.
- `decisions(id uuid primary key, request_id uuid, stage text, revision int, head_sha text null, actor_id text, source_event_key text unique, prompt_id uuid, revoked_at timestamptz null)`. All identities verified against the trusted source, not action JSON.
- `claims(request_id uuid, epoch int, agent_id text, engineer_id text, branch text, base_sha text, status text, last_heartbeat_at timestamptz, ended_at timestamptz null, primary key(request_id,epoch))`. Partial unique index on request_id where status=`active`; agent busy state is enforced transactionally, not a global worker cap.
- `attempts(request_id uuid, budget_id uuid, ordinal int, claim_epoch int, status text, evidence jsonb null, started_at timestamptz, finished_at timestamptz null, primary key(request_id,budget_id,ordinal))`; budgets are records in `implementation_budgets(id uuid primary key,request_id uuid,authorization_decision_id uuid,max_attempts int default 2)`.
- `handoffs(request_id uuid primary key,revision int,claim_epoch int,branch text,pr_number bigint,pr_url text,head_sha text,evidence_id uuid,summary text,verification_steps jsonb,preview_required boolean,preview_status text,preview_url text null,preview_checked_at timestamptz null,monitor_until timestamptz null)`.
- `artifacts(id uuid primary key,request_id uuid,sha text,kind text,relative_path text,content_hash text,exit_code int null)`. Store bounded logs under ignored `.local/artifacts/`; paths never come from a requester and are not external access credentials.
- `actions(idempotency_key uuid,agent_id text,input_hash text,response jsonb,primary key(agent_id,idempotency_key))`; a reused key with a different hash is INVALID_INPUT.
- `effects(id uuid primary key,request_id uuid,kind text,effect_key text unique,payload jsonb,status text,try_count int,next_try_at timestamptz,claimed_at timestamptz null,external_id text null,last_error text null)`.
- `audit_events(id uuid primary key,request_id uuid,event_type text,source_event_key text null,payload jsonb)` preserves transition history; human approvals retain their exact source evidence.

Use one `pg` client for every transaction. Lock the request row for decisions/state changes; lock worker row for busy transitions. Commit domain changes and outbox effects together. Never hold a DB transaction across GitHub, Switch, subprocess, or deployment network calls. Effect workers claim jobs with `FOR UPDATE SKIP LOCKED`; each effect has stable correlation identity. Remote ambiguity is represented as `uncertain`, not falsely acknowledged or blindly retried.

Canonical state transitions:

- Initial report → clarifying; confirmed criteria → awaiting_authorization; authorized current revision → available; successful claim → implementing.
- After passed verification and PR creation → pr_opened; independent preview readiness updates the handoff record, not the state enum. Worker busy status is released after code handoff so it can claim another request while deployment/review waits.
- Any dependency/worker/attempt failure → blocked with previous state and explicit reason. Requester acceptance never bypasses readiness.
- A rejected preview on agreed requirements → blocked awaiting explicit engineer resume; resume creates a new two-attempt budget and returns work to available. Keep branch/PR and increment claim epoch on pickup.
- Changed requirements → pause/fence active work, create next immutable criteria revision, clear confirmation/authorization/acceptance, then return to clarifying after an engineer acknowledges the old worker stopped. No automatic race with an editing old worker.
- Engineer release/reassign revokes old claim epoch and preserves branch/PR. A replacement must use the new claim before state updates. If no PR exists, repair resumes from saved branch; never silently abandon prior changes.
- New head SHA invalidates verification readiness and acceptance for the previous SHA; retain old decisions as revoked audit history. It does not implicitly authorize new feature scope.

### Task F1: Prove the installed Switch contract before committing to adapters

**Files:**
- Create: `package.json`, `package-lock.json`, `tsconfig.base.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `compose.yaml`.
- Create: `scripts/switch-contract-probe.ts`, `tests/contracts/switch-release.test.ts`, `tests/fixtures/switch/{operations,participants,messages,frames}.json`.
- Create: `docs/integration/switch-contract.md`, `config/rooms.example.json`.

**Interfaces:** Consumes authenticated Switch access supplied by operator setup; produces sanitized released wire fixtures and a verified adapter mapping for SwitchPort. The probe is run only after plan approval and selected demo-resource authorization.

- [ ] **Step 1: Write the failing contract test**

Assert that sanitized fixtures contain the service's first connection state, a human source message, a same-thread response, an agent handoff, grouped attachments, and operation schemas for `read_context`, `post_message`, `send_targeted_message`, and `list_participants`. Assert the participant kind mapping is available without ID-string parsing.

- [ ] **Step 2: Verify the red state**

Run `npm run test:contract -- tests/contracts/switch-release.test.ts`. Expect missing live-capture fixtures; do not generate invented fixtures to satisfy it.

- [ ] **Step 3: Implement the minimal probe and perform the live proof**

Resolve and pin the workspace's runtime/test dependencies locally. Probe public health and authenticated version; use a **separately registered non-managed service identity**, not a Console agent's watcher key. Registration is out-of-band with an operator-provided registration credential, stored only in ignored local config. Read the operations registry, then exercise only the selected demo room.

Validate WebSocket connection, sender kind lookup, human source IDs, normalized mention format, same-thread replies, return-to-feedback handoff, and one PNG delivered/read by a Switch-started Codex session. Prove that the session can execute a harmless local Node command and resolve an explicitly configured profile path; the actual feedbackctl CLI is built in F6, not assumed present here. Capture external Slack message/permalink mapping if exposed; otherwise capture a working Slack channel/message deep link from the bridge metadata during setup. Links cannot be derived from Switch IDs by guessing.

Configure addressing explicitly so requesters reach feedback and registered workers accept service/feedback notifications, including across different owners. Defaults differ across docs/releases; do not rely on them. If required identities, routing, or attachment access cannot be verified, stop here with a concrete incompatibility report.

The same gate must prove the source Slack thread link can be recovered reliably. If neither captured metadata nor a documented available operation exposes a usable source mapping, stop and resolve that integration gap; do not substitute a fabricated permalink or silently claim a Switch ID is a Slack timestamp.

- [ ] **Step 4: Verify the green state**

Run the contract test and `npm run probe:switch -- --check`. Expect recorded release, schema hashes, sanitized examples, and proven capabilities. Keep credentials, workspace messages unrelated to the demo, and private media out of fixtures.

- [ ] **Step 5: Run broader checks**

Run `npm run typecheck`, `npm run format:check`. Document exact mappings and limitations in `docs/integration/switch-contract.md`; all subsequent Switch code consumes these captures.

Sources: [protocol](https://docs.switchagents.ai/switch-rooms/internals/agent-protocol), [connection](https://docs.switchagents.ai/switch-rooms/internals/agent-connection), [runtime](https://docs.switchagents.ai/switch-rooms/internals/connectors-and-runtime). Current docs use WebSockets, deprecate SSE, and reserve managed-agent connections for the controller. Discover operation schemas rather than assuming payload fields. The service identity avoids taking over a coding agent's connection.

### Task F2: Transactional request lifecycle and decisions

**Files:**
- Create: `packages/contracts/src/{config,request,actions,ports}.ts`.
- Create: `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `apps/coordinator/package.json`, `apps/coordinator/tsconfig.json`, `vitest.db.config.ts`.
- Create: `apps/coordinator/db/migrations/0001_coordination.sql`, `apps/coordinator/scripts/migrate.ts`.
- Create: `apps/coordinator/src/store/{pool,transaction}.ts`, `apps/coordinator/src/domain/{lifecycle,decisions}.ts`, `apps/coordinator/src/services/requests.ts`.
- Test: `tests/domain/decisions.reject-spoofed-or-stale.test.ts`, `tests/domain/lifecycle.test.ts`, `tests/helpers/database.ts`.

**Interfaces:** Consumes F1 config/fixtures. Produces Result, RequestView, action validation and `applyHumanDecision(tx, sourceEventKey:string):Promise<Result<RequestView>>`. Production calls accept only persisted trusted source events; tests seed them through a test-only helper.

- [ ] **Step 1: Write the failing test**

```ts
it('does not authorize from another person or a stale revision', async () => {
  const r = await fixture.awaitingAuthorization({ revision: 2 });
  const stranger = await fixture.humanReply(r, { sender: 'unlisted-human', body: '@feedback authorize R2' });
  expect((await applyDecision(stranger.sourceKey)).ok).toBe(false);
  const old = await fixture.engineerReply(r, '@feedback authorize R1');
  expect(await applyDecision(old.sourceKey)).toMatchObject({ ok:false, error:{code:'STALE_REVISION'} });
  expect((await readRequest(r.id)).state).toBe('awaiting_authorization');
});
```

- [ ] **Step 2: Verify the red state**

Run `npm test -- tests/domain/decisions.reject-spoofed-or-stale.test.ts`. Expect missing handler/state logic after successful database setup.

- [ ] **Step 3: Implement the minimal behavior**

Create migration/schema and own types above; add config validation, immutable criteria revisions, request-row locking, stage/role/version checks, prompt uniqueness, audit records, and action idempotency. Source events from an agent/system/unknown sender can never count as a human decision. `confirm`/`accept` require original requester ID, `authorize` requires configured engineer ID, and authorizing a revised request must reference its current confirmation.

Only accept replies after a verified feedback-agent prompt was published. A replayed source event is a no-op with its original result. A changed prompt cannot consume a prior bare confirmation. The service prepares deterministic prompts; F4 later verifies they were actually published through Switch.

- [ ] **Step 4: Verify the green state**

Run narrow tests; add coverage for agent impersonation, wrong room/thread, confirmation before prompt, repeated input, omitted/unknown fields, changed criteria, and acceptance before verified handoff. Each must leave state unchanged or transition exactly once.

- [ ] **Step 5: Run broader checks**

Run `npm run test:db`, `npm run typecheck`, `npm run format:check`, and `npm run db:migrate` twice on a fresh coordinator DB. No network adapter is needed to test lifecycle invariants.

### Task F3: Exclusive claims and explicit reassignment

**Files:**
- Create: `apps/coordinator/src/domain/{claims,attempts}.ts`, `apps/coordinator/src/services/dispatch.ts`.
- Modify: `packages/contracts/src/actions.ts`, `apps/coordinator/src/services/requests.ts`.
- Test: `tests/domain/claims.concurrent.test.ts`, `tests/domain/attempts.limit.test.ts`, `tests/domain/reassignment.test.ts`.

**Interfaces:** Consumes current authorization and registered workers. Produces `claimRequest(tx,agent,requestId,expectedRevision,baseSha):Promise<Result<Claim>>`, epoch-bound heartbeat/progress/attempt operations, and engineer-source reassignment controls. Define `BaseRefPort.resolveBaseSha(roomId:string):Promise<Sha>` in contracts; the service resolves the configured repository ref before entering the transaction (fake port in F3, GitHub adapter in F5). Resumed work preserves the existing branch/base; this is not a rebase onto main.

- [ ] **Step 1: Write the failing test**

```ts
it('has one winner per request without blocking other requests', async () => {
  const [a,b] = await fixture.authorizedRequests(2);
  const results = await Promise.all([claim(worker1,a), claim(worker2,a)]);
  expect(results.filter(r => r.ok)).toHaveLength(1);
  const loser = results[0].ok ? worker2 : worker1;
  expect((await claim(loser,b)).ok).toBe(true);
});
```

- [ ] **Step 2: Verify the red state**

Run `npm test -- tests/domain/claims.concurrent.test.ts tests/domain/attempts.limit.test.ts`. Expect duplicate claims or missing behavior; use independent PostgreSQL connections so the test exercises a real race.

- [ ] **Step 3: Implement the minimal behavior**

In one transaction lock worker and request, check current authorization/revision and worker idle, grant next epoch and unique branch `feedback/<request UUID>`, update busy state, enqueue issue projection. Return ALREADY_CLAIMED to the loser. A handed-off claim is historical; it does not make the worker busy while humans review. Resumed work reuses branch/PR with a new epoch and explicit authorized budget.

The CLI heartbeats every 30 seconds while long checks run; progress/worker actions also refresh contact. Worker instructions require a progress update at least every five minutes during longer editing. After 15 minutes without any contact mark blocked with `worker_stopped`; **do not release/reassign automatically**. This is a conservative stalled-work heuristic, not proof that the OS process stopped. An engineer must acknowledge the old process stopped. Fence old epochs for all subsequent operations and require explicit stop/release before a replacement edits the same checkout. Test the interval with a fake clock, not real waiting.

Count completed implementation/verification passes, not chat turns or tool calls. Pass one failure permits pass two; pass two failure blocks. External dependency failures pause with no additional spent attempt. Explicit engineer resume after requester corrections creates a fresh budget, recorded against source evidence.

- [ ] **Step 4: Verify the green state**

Run the narrow tests plus reassignment: old-epoch progress and submit fail; the new claim preserves branch/PR; a worker waiting on a PR can claim new work; different workers can hold different requests; no hidden global cap exists. Test fake-clock heartbeat expiry without sleeping.

- [ ] **Step 5: Run broader checks**

Run `npm run test:db`, `npm run typecheck`, `npm run format:check` and repeated real concurrent-connection tests. Ensure test isolation, not arbitrary sleeps, controls race setup.

### Task F4: Switch event ingestion and confirmation routing

**Files:**
- Create: `apps/coordinator/src/switch/{connection,normalize,operations,ingest}.ts`, `apps/coordinator/src/store/inbox.ts`.
- Create: `apps/coordinator/src/services/{prompts,attachments}.ts`.
- Test: `tests/adapters/switch.thread-and-media.test.ts`, `tests/adapters/switch.reconnect.test.ts`, `tests/adapters/switch.prompts.test.ts`.

**Interfaces:** Consumes F1 exact wire mappings and F2 source-event/decision contracts. Produces TrustedMessage and SwitchPort. `ingestSourceMessage(message:TrustedMessage)` is internal only; HTTP agents cannot call it.

- [ ] **Step 1: Write the failing test**

Replay a fixture containing an unrelated channel post, a feedback mention with two screenshots, an unmentioned clarification in its thread, and a different thread's confirmation. Expect one logical report candidate, two attachments, the correct clarification association, and no cross-thread decision.

- [ ] **Step 2: Verify the red state**

Run `npm test -- tests/adapters/switch.thread-and-media.test.ts tests/adapters/switch.reconnect.test.ts`. Expect missing normalized events/correlation/reconnect handling.

- [ ] **Step 3: Implement the minimal behavior**

Use a server-side WebSocket under the service identity with all-message delivery for its configured room. It observes only to validate workflow events; it acts solely on configured controls and known request threads. Never use the service participant's `addressed` flag to conclude a message addressed the feedback agent: match the canonical explicit feedback mention captured in F1. Top-level nonmentions remain chatter.

Preserve opaque sender/message/thread IDs and use the participant-kind map. Normalize root ID as thread_id or message_id; use captured attachment batch metadata to collect one logical report. Persist individual pieces before acknowledging their stream position, then coalesce; a bounded five-second partial batch may proceed with a visible missing-attachment note and accept late evidence updates without creating another report. Malformed grouping degrades safely; no unbounded wait.

Persist source data before advancing the durable cursor. Heartbeat handling must not await LLM calls or effects. Resume with stored connection/generation/cursor; on replay, deduplicate. On a reported stream gap mark the affected room's decision intake temporarily unhealthy, reread history through the captured operation, reconcile prompts/events, and resume only after recovery; never infer a missing approval. A takeover refusal stops rather than stealing back the connection. Runtime incompatibility fails the gate rather than inventing an SSE fallback.

Match feedback-agent prompt publications by configured sender, thread, exact expected text/hash, and prompt revision; only then activate them. Human parser recognizes the agreed commands and version safeguards, delegates authority/state checks to F2, and notifies feedback of the result.

For media, let Switch deliver screenshots into the Codex session. Agent evidence summaries reference observed source attachments; service validates existence and limits. Support PNG/JPEG/WebP up to 10 MB each, at most 5 per report in the demo; larger/unsupported/inaccessible media remain linked evidence with a written-detail fallback. Video remains evidence only. Treat extracted text as report content, never an approval or instruction to change permissions.

- [ ] **Step 4: Verify the green state**

Run adapter tests with fake sockets, replayed group pieces, restart between pieces, gaps, invalid participant mapping, prompt posting races, and attachments arriving after timeout. A duplicate source message or late file must not create another issue candidate.

- [ ] **Step 5: Run broader checks**

Run domain/adapter checks and `npm run probe:switch -- --check`; perform one selected-room live message round trip. Inspect sanitized logs for stable correlation and no leaked credentials.

Sources: [events](https://docs.switchagents.ai/switch-rooms/internals/agent-events), [connection](https://docs.switchagents.ai/switch-rooms/internals/agent-connection), [identity](https://docs.switchagents.ai/switch-rooms/internals/identity-and-access). The adapter preserves source fields; grouped attachments need coalescing. Opaque IDs are matched, not parsed. Loss recovery cannot manufacture authorization.

### Task F5: GitHub issue projection and recoverable effects

**Files:**
- Create: `apps/coordinator/src/github/{client,issues}.ts`, `apps/coordinator/src/store/outbox.ts`, `apps/coordinator/src/services/{effects,recovery}.ts`.
- Modify: `apps/coordinator/src/services/requests.ts`.
- Test: `tests/adapters/effects.recovery.test.ts`, `tests/adapters/github.issues.test.ts`, `tests/domain/duplicates.test.ts`.

**Interfaces:** Consumes transactional effects and RequestView. Produces `GitHubPort.ensureIssue(requestId):Promise<{number:number;url:string}>`, `projectIssue(requestId)`, `searchIssues(roomId,query)`, and `deliverEffect(effectKey)`.

- [ ] **Step 1: Write the failing test**

```ts
it('recovers an issue whose create succeeded before the acknowledgement was lost', async () => {
  github.loseNextCreateAcknowledgement();
  await runIssueEffect(request.id);
  await restartCoordinator();
  await recoverIssueEffect(request.id);
  expect(github.createdIssueCount()).toBe(1);
  expect((await readRequest(request.id)).issueNumber).toBe(github.onlyIssue().number);
});
```

- [ ] **Step 2: Verify the red state**

Run `npm test -- tests/adapters/effects.recovery.test.ts tests/domain/duplicates.test.ts`. Expect duplicate writes or missing recovered mapping under a deterministic fake GitHub server.

- [ ] **Step 3: Implement the minimal behavior**

Generate the request ID before issue creation. Include stable marker `<!-- app-feedback:request=<UUID> -->` in the managed issue section; serialize the create effect per request. On ambiguous success, reconcile by paginated repository listing and exact marker, excluding PR records. GitHub search indexing is not a safe immediate read-after-write oracle. If recovery remains uncertain, mark EFFECT_UNCERTAIN and ask engineering to reconcile; never blindly retry creation. This is safe-at-most-one automatic action with manual uncertainty recovery, not a false claim of distributed exactly-once semantics.

Render report, attachment/source links, confirmed criteria/revision, lifecycle label, worker/owning engineer, PR and acceptance-at-SHA. Manage only a delimited app-feedback section; preserve human notes outside it. Use conditional reads/updates where supported; on conflicting human edits refresh/reconcile instead of overwriting them. Labels are projections, never authorization. Precreate a small `feedback:<state>` label set and kind labels in demo setup.

External retries use bounded exponential backoff, honor rate-limit/reset/Retry-After, and never hold DB locks across I/O. Authentication/permission errors block setup; transient service errors pause. Outbox effects include exact request/revision/epoch checks so an old queued write cannot overwrite current state.

Apply the same uncertainty rule to Switch sends. Put a stable effect marker in machine-directed handoffs, and reconcile against trusted observed messages/thread history from the configured service sender. If a send may have succeeded but cannot be found reliably, mark its effect uncertain and request recovery rather than emit repeated prompts. User-facing prompts are separately matched to their exact prepared text and version by F4.

Search likely duplicates before issuing new work. A new source thread may already have a provisional clarifying issue: if confirmed duplicate, preserve it as a cross-linked nonclaimable alias rather than delete/close it automatically. Canonical work stays on the original issue. The original requester retains decision authority; secondary threads receive their own correctly linked updates.

- [ ] **Step 4: Verify the green state**

Test lost ACKs before/after local commit, 429/503, human body edits, wrong repo, exact-marker collisions, duplicate source delivery, and duplicate confirmation by the wrong person. Replaying effects cannot duplicate tickets or erase human text.

- [ ] **Step 5: Run broader checks**

Run all DB/adapter tests, typecheck/format checks. In the selected disposable repo create and update one fixture issue, then stop; keep issue open, record live evidence separately from fakes.

Sources: [GitHub Issues](https://docs.github.com/en/rest/issues/issues). Paginate result sets and distinguish actual issues from PRs.

### Task F6: Authenticated agent CLI, isolated checkouts, and verification attempts

**Files:**
- Create: `apps/coordinator/src/{server,main}.ts`, `apps/coordinator/src/services/actions.ts`.
- Create: `apps/agent-cli/package.json`, `apps/agent-cli/tsconfig.json`, `apps/agent-cli/src/{main,client,profile,worktree,checks}.ts`.
- Create: `config/checks.sample-app.json`, `scripts/enroll-agent.ts`.
- Test: `tests/http/actions.auth.test.ts`, `tests/cli/worktree.isolation.test.ts`, `tests/cli/checks.evidence.test.ts`.

**Interfaces:** Consumes all public actions and claim epochs; produces HTTP/CLI surface defined above, per-agent profiles, and commit-bound VerificationEvidence. Check commands are fixed in trusted automation config, not accepted as arbitrary strings from a user report.

- [ ] **Step 1: Write the failing test**

Create two claimed requests against a disposable Git fixture. `prepare` must produce two branches/worktree directories; editing a tracked file in one must leave the other and baseline unchanged. A revoked epoch must fail before preparing/submitting work.

- [ ] **Step 2: Verify the red state**

Run `npm test -- tests/cli/worktree.isolation.test.ts tests/http/actions.auth.test.ts`. Expect missing CLI/auth/worktree logic. Tests never invoke live model sessions or GitHub pushes.

- [ ] **Step 3: Implement the minimal behavior**

Bind coordinator to loopback port 4317 for the solo demo. TLS reverse proxy or private network access is required when team machines connect; local demo does not claim tested distributed deployment. Use server-hashed per-agent random bearer tokens from a private enrollment step. Feedback tools cannot claim work; worker tools cannot approve human decisions or change config. Request IDs and role/room membership are checked on every action. Profile identity must match authenticated identity, not a CLI flag from report content.

Worker clone roots are machine-local. Prepare one worktree at `.local/worktrees/<request UUID>` on `feedback/<UUID>` from the recorded base SHA; an existing branch is resumed, never overwritten/reset. Invoke Git with argument arrays, validate remotes against configured repository, and retain uncommitted owned work on interruption. Never call destructive reset/clean as automated recovery. Only one active editing claim can use a checkout; retired workers must be stopped before reuse.

`check` executes fixed commands with a minimal environment containing only the target app's disposable test DB and required tool paths. Exclude coordinator/GitHub/Vercel credentials from child test/build processes. Run typecheck, normal tests, integration, build, and criterion-specific external regression checks; browser checks where applicable. Save bounded stdout/stderr and hashes under `.local/artifacts/`, binding evidence to current Git head. Evidence is engineering information, not self-approved requester acceptance. This is scoped ordinary development, not a claim of an adversarial sandbox against the machine owner.

`begin_attempt` and `complete_attempt` wrap one pass; the CLI heartbeats while checks run. Failed verification uses the two-attempt budget; unavailable DB/network is recorded as a dependency pause. The check environment must distinguish setup outage from a real failed assertion. Progress artifacts and current branch survive a restart.

- [ ] **Step 4: Verify the green state**

Run the narrow tests. Add profile spoofing, path traversal, wrong remote, malicious shell metacharacters in titles, reused idempotency key with different input, stale evidence SHA, and token-redaction cases. Subprocess execution must never interpolate a report into a shell command.

- [ ] **Step 5: Run broader checks**

Run `npm run test:db`, `npm test`, `npm run typecheck`, `npm run format:check`. Exercise prepare/check against a scratch sample-app branch; no external push until the selected live integration task.

### Task F7: Switch role configuration, pool dispatch, and PR creation

**Files:**
- Create: `switch/{room,feedback,implementation}.md`, `switch/app-feedback.template.yaml`, `scripts/render-switch-template.ts`.
- Create: `apps/coordinator/src/github/pulls.ts`, `apps/coordinator/src/services/handoffs.ts`.
- Modify: `apps/coordinator/src/services/{dispatch,effects}.ts`, `apps/agent-cli/src/main.ts`.
- Test: `tests/workflow/dispatch-and-handoff.test.ts`, `tests/adapters/github.pulls.test.ts`, `tests/contracts/agent-instructions.test.ts`.

**Interfaces:** Consumes F1 SwitchPort and F6 CLI. Produces available-work notifications, actionable Codex role instructions, and Handoff with PR identity and pending preview status.

- [ ] **Step 1: Write the failing test**

Authorize two requests; notify two registered workers; race claims for the first; have the loser pick the second. Submit one completed pass and verify the request's PR is linked, worker busy state clears, issue remains open, and a message handoff is sent through Switch to feedback in the original thread.

- [ ] **Step 2: Verify the red state**

Run `npm test -- tests/workflow/dispatch-and-handoff.test.ts tests/adapters/github.pulls.test.ts`; expect missing dispatch/PR mappings or duplicate handoff behavior.

- [ ] **Step 3: Implement the minimal behavior**

Room instructions define one request/thread, named CLI profile, issue reference, nontechnical requester communication, and explicit authority limits. Feedback reads trusted report context, performs duplicate search, summarizes screenshot evidence, asks only needed questions, proposes requirements, posts service-prepared prompts through native Switch tools, and reports status. It never opens direct code-edit work or approves itself.

Worker notifications are targeted Switch messages to registered idle workers, not invisible DB changes. A worker first calls claim; on ALREADY_CLAIMED it stays quiet and may inspect available work. On success it prepares its worktree, reads the issue/confirmed criteria, writes a failing regression test, implements, verifies, and submits. A busy worker does not start an overlapping edit. Native Switch per-agent placements are respected; workers use separate Switch agent identities, not competing sessions under one identity.

Use the operator-confirmed GitHub repository/base branch. Before PR creation verify a pushed remote `feedback/<UUID>` head equals the evidence SHA. PR body contains Related issue, plain-language summary, current criteria revision, verification evidence, requester steps, and a pending preview section. Create through the coordinator; resume updates the same request PR. Reconcile by exact repository/head/base/request marker after ambiguous creates; do not create another PR on retry. No auto-closing keyword, merge API, auto-merge flag, or workflow dispatch is exposed.

Template generation reads the verified template format and inserts full role text and configured machine directories; the final template must not depend on unsupported include syntax. Agent owners explicitly permit required feedback/service/worker addressing. The shared tracker is attached as a room reference and credentials are granted separately. Profiles remain outside exported templates.

- [ ] **Step 4: Verify the green state**

Run workflow tests; cover no idle worker (request remains available), duplicate notifications, wrong-owner unregistered agent, retry after remote PR success, stale epoch, wrong SHA, and a worker claiming new work while an older PR waits. Instruction contract checks catch forbidden merge/close tools but do not substitute for live behavior checks.

- [ ] **Step 5: Run broader checks**

Run all checks and import the template into the selected Switch demo workspace. Perform a real authorized claim/handoff and one scratch PR, preserving it open. Verify screenshots and source/PR links resolve for the intended participants.

Source: [templates](https://docs.switchagents.ai/switch-rooms/administer/room-templates), [shared context](https://docs.switchagents.ai/switch-rooms/using/shared-context), [GitHub PRs](https://docs.github.com/en/rest/pulls/pulls). Native template/operation shapes come from F1, not this plan's internal interfaces.

### Task F8: PR previews, verification, and requester handoff

**Files:**
- Create: `apps/coordinator/src/github/deployments.ts`, `apps/coordinator/src/services/previews.ts`.
- Modify: `apps/coordinator/src/services/{handoffs,effects,requests}.ts`.
- Modify: `sample-app/package.json`, `sample-app/scripts/migrate.ts`, `sample-app/README.md` for the configured build/migration command.
- Create: `docs/integration/preview-setup.md`, `tests/preview/export.contract.test.ts`, `tests/preview/priority.contract.test.ts`.
- Create: `vitest.preview.config.ts`.
- Test: `tests/workflow/previews.current-head.test.ts`, `tests/workflow/previews.access.test.ts`.

**Interfaces:** Consumes current PR/head/evidence and provider setup. Produces `checkPreview(requestId,now):Promise<Result<Handoff>>`, commit-bound requester prompt, and a native Switch feedback notification. Readiness uses deployment status plus an actual app check; a PR URL alone is insufficient.

- [ ] **Step 1: Write the failing test**

```ts
it('will not accept or announce a deployment for the previous head', async () => {
  const r = await fixture.pr({ headSha: fixture.shaB });
  github.succeedDeployment({ sha: fixture.shaA, url: fixture.previewUrl });
  expect((await checkPreview(r.id, clock.now())).ok).toBe(false);
  expect(await fixture.accept(r)).toMatchObject({ ok:false, error:{code:'WRONG_STAGE'} });
  expect(switchFake.readyAnnouncements()).toHaveLength(0);
});
```

- [ ] **Step 2: Verify the red state**

Run `npm test -- tests/workflow/previews.current-head.test.ts tests/workflow/previews.access.test.ts`; expect stale/inaccessible links being treated as ready until the checks are implemented.

- [ ] **Step 3: Implement the minimal behavior**

Connect only the sample-app GitHub repository to Vercel. Configure Neon provider-managed preview branching from a seeded fictional default branch. Use a separate project/database from coordinator persistence. Apply versioned migrations before the Next build with a database-level lock; do not reset or reseed on every preview update. Verify two PR branches receive separate databases without logging connection strings.

Read GitHub deployments and their latest statuses for the PR head, checking configured environment/project provenance and allowlisted HTTPS preview hosts. F1/live setup confirms Vercel emits the required deployment metadata; if GitHub's configured integration does not expose it, resolve this adapter at the setup gate before claiming preview automation. Do not scrape PR comments or follow arbitrary URLs from user reports.

Poll pending deployments every 20 seconds, at most 15 minutes per current SHA. Respect API rate limits. A timeout pauses with a concrete pending/dependency blocker, not acceptance. Persist polling jobs so process restart does not duplicate notifications. While feedback remains active, refresh PR head at most every 30 seconds with conditional requests; stop after 24 hours and mark monitoring paused with an explicit refresh/resume prompt rather than assuming freshness. Read PR closure only to stop this freshness job; never inspect merge result to close issues or produce a release announcement. Each acceptance performs a fresh remote head check regardless of the timer.

For a ready deployment, verify `/api/health`, matching build SHA where provider supplies it, current head in GitHub, and criterion-specific observable behavior. Protected preview automation uses a separately configured supported access mechanism. Require a requester-accessible link; an automated bypass response alone does not prove the user can open it. This is a live setup gate with the person playing requester.

Patch the PR's preview section with the current verified link and readable steps. Send a targeted same-thread Switch message to feedback to announce the PR and request acceptance. Record published prompt and source-confirmed acceptance at that exact SHA. A new detected head or service-submitted correction revokes old readiness/acceptance and supersedes the prompt. Old URLs are not offered again because branch DB migrations can make them incompatible. If monitoring is paused, acceptance first revalidates remotely; the old accepted-SHA audit record is never presented as approval of unknown newer code.

For API-only future requests, previewRequired=false permits evidence-based engineering verification without forcing a fake UI, but the two demo scenarios require interactive previews.

- [ ] **Step 4: Verify the green state**

Run the narrow tests with pending/success/failure/status replay, old SHA, new commit between prompt and accept, HTTP login redirect, 401/403, broken DB migration, disallowed preview hostname, and duplicate readiness ticks. Only one handoff announcement per verified SHA/thread. Run external export/priority contracts against the real preview using independently held expected criteria.

- [ ] **Step 5: Run broader checks**

Run coordinator checks and sample app checks. Produce two real PR previews from the frozen baseline and verify data isolation, migration behavior, and requester browser access. Keep cleanup manual and documented. No production promotion or merge is part of this task.

Sources: [Vercel GitHub](https://vercel.com/docs/git/vercel-for-github), [Neon branching integration](https://neon.com/docs/guides/vercel-managed-integration), [sharing previews](https://vercel.com/docs/deployments/sharing-deployments), [GitHub deployment statuses](https://docs.github.com/en/rest/deployments/statuses). Code deployments and database branches are separate resources; per-branch data is not immutable per commit.

### Task F9: End-to-end acceptance and submission handoff

**Files:**
- Create: `tests/e2e/feedback-lifecycle.test.ts`, `tests/e2e/restart-and-reassignment.test.ts`.
- Create: `docs/{SETUP,DEMO,VERIFICATION}.md`, `README.md`, `scripts/demo-preflight.ts`, `scripts/demo-reset.ts`, `.env.example`.
- Modify: `SPEC.md` only to link verified implementation evidence; do not redefine product scope to match missing functionality.

**Interfaces:** Consumes both completed plans. Produces a reproducible setup, two real feedback-to-PR runs, sanitized evidence, and honest submission documentation.

- [ ] **Step 1: Write the failing end-to-end scenarios**

Use deterministic fake Switch/GitHub/deployment ports for repeatable integration tests: text bug lifecycle, feature clarification, screenshot intake, confirmed duplicate, competing claim, separate request while one waits for review, wrong-person decision, blocked two-attempt limit, and explicit reassignment/restart. The expected artifact is one canonical issue/PR per request with correct thread/revision/worker identity, not merely a final success string.

- [ ] **Step 2: Verify the red state**

Run `npm run test:e2e:workflow`; expect failures revealing unwired seams. No recorded model transcript is substituted for actual adapter behavior.

- [ ] **Step 3: Complete the minimal integration and run the real demo**

Wire lifecycle loops, graceful shutdown and resumption; redact tokens from errors/logs. Preflight checks database migrations, Switch stream health and mappings, agent profiles, GitHub access, sample baseline SHA, Vercel/Neon preview setup and expected fixture data. Reset only explicitly designated demo databases/owned fixture branches after operator confirmation; never delete user work or live agent credentials.

Perform the real Slack demo as explicitly identified fictional human roles: report the export bug with text, confirm criteria, engineer authorizes, two agents contend for one claim, winner fixes the bug and produces a verified PR. Leave it awaiting human review. Submit the feature request in a different thread, clarify priority semantics in nontechnical language, confirm/authorize, and let another worker implement it in an independent branch. Show issue status, screenshot evidence, PR link/preview/steps, acceptance bound to SHA, and continued independent progress. Demonstrate a confirmed duplicate and blocked/reassigned fixture without claiming they occurred in the successful code run.

Record sanitized screen evidence only after live checks pass. README explains why Switch is central: removing its room events, user decisions, pool notifications and handoffs stops the actual workflow; no hidden direct Slack automation path replaces it. State that sample data, identities, and the export defect are deliberate fixtures. Document unresolved limitations instead of presenting tests as production reliability.

- [ ] **Step 4: Verify the green state**

Run workflow e2e tests and `npm run demo:preflight`. Record live thread/issue/PR/preview references privately as needed and publish only intended demo resources. Compare every SPEC demo acceptance check with a named test or live evidence entry in VERIFICATION.md.

- [ ] **Step 5: Run broader checks and hand off**

From clean checkouts run `npm ci`, migrations, sample seed, default tests, typechecks, formatting checks, app build/browser checks, coordinator e2e tests, and the explicitly separate known-bug reproduction. Verify documented commands work without copied private state. Provide setup/recording/README plus links to both repos and evidence. Leave PRs and issues open for engineering, and keep implementation feedback separate from merge/release status.

## Spec coverage and deliberate exclusions

- Natural text/screenshots/recordings, explicit intake, same-thread follow-through, nontechnical confirmation: F1/F4/F7/F9.
- Bugs/features, duplicate checks, GitHub shared tracker and early clarifying issues: A4/F2/F5/F9.
- Human source identity, versioned confirmation, authorization and acceptance: F2/F4/F8.
- Shared pool, team-owned workers, simultaneous requests, one claim/request, no fixed global cap: F3/F6/F7.
- Persistent lifecycle, retry budget, blocked work, explicit resume/reassignment, restart safety: F2/F3/F5/F6/F9.
- Real app changes/tests/PR, screenshot evidence, latest verified preview with isolated data: A1–A4/F6/F7/F8.
- PR handoff boundary and no automatic issue closure/merge/conflict repair: F5/F7/F9.
- Deliberately excluded: app login, extra app features, video interpretation, extra chat adapters, multi-harness setup, custom database branch provisioning, separate review AI, merge orchestration, production release, immutable historical data previews, distributed deployment claims not exercised by the demo.

## Execution handoff

Review this plan and the sample-app plan before code. Start with F1, then follow the execution index. If F1 uncovers an incompatible release or a missing trusted identity/thread capability, report the exact evidence and revise the adapter plan before proceeding. A passing fake test is never permission to claim an unproven live integration.

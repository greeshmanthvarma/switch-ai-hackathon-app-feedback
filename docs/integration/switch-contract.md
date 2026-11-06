# F1 Switch contract — blocked live gate

Checked 2026-11-06. Scope: F1 only. No sample app, coordinator lifecycle, Slack bot, registration, posts, or external configuration changes were made. SPEC.md, CONTEXT.md, ADRs and approved plans are unchanged.

## Observed local evidence

- Node v22.19.0 / npm 10.9.3.
- Installed Switch Console application reports 0.40.1 in its application metadata.
- Console's local server configuration identifies `http://localhost:56830`.
- An actual unauthenticated GET `/health` returned HTTP 200 with `{"status":"ok"}`.
- A local switch-core source bundle exists under version directory 0.31.0. This is **not authenticated proof of the running server release**. Source confirms `/version` requires an agent key and exposes agent-protocol contracts. Never substitute Console's version or a bundle directory for this response.
- No SWITCH probe service credentials were present in this session environment. Console's credential store and managed-agent credentials were not read or copied.
- Operator selected Slack workspace `newworkspace-1pr9533`, channel `C0CFNBEAZRQ`, and explicitly authorized F1 service registration and labeled messages/one PNG. Switch room, feedback agent, worker agents and their owners remain to be identified by the operator. No inference from a Slack channel ID to a Switch room ID is allowed.

## Implemented scaffolding and commands

Exact npm dependencies and lockfile, strict TypeScript configuration, Vitest setup, opt-in local PostgreSQL compose prerequisite (not started), example room configuration, ignored private state, read-only discovery probe, and evidence placeholders are present.

- `npm ci`: install pinned dependencies.
- `npm run test:unit`: two local evidence-checker tests. They do not prove Switch compatibility. `npm test` includes the blocked release contract and therefore currently fails.
- `npm run test:contract`: intentionally fails until actual release captures and their mapping validator exist.
- `npm run probe:switch -- --check`: offline gate; exits 1 and reports missing captures.
- `npm run probe:switch -- --inspect`: health, authenticated `/version`, and operation discovery only. Set `SWITCH_PROBE_BASE_URL`, `SWITCH_PROBE_SERVICE_ID`, `SWITCH_PROBE_SERVICE_KEY` via a private local process environment and `SWITCH_PROBE_IDENTITY_KIND=separate-unmanaged-service`. Never use a Console-managed identity or watcher key. No socket or posts are opened by this mode.
- Discovery saves authenticated responses only to ignored `.local/switch-probe/discovery.json`, mode 600, with exclusive creation to prevent accidental overwrite. It prints only hashes. Review and sanitize selected demo evidence before any tracked fixture promotion; never copy credentials, unrelated conversations, private media, or signed access links.
- `npm run typecheck`, `npm run format:check`: local checks. Formatting is scoped to new F1 files to preserve approved documents.

The current checker deliberately refuses even manually set `live-reviewed` flags: the release-specific mapping validator is unfinished until real schemas are available. The probe is a partial discovery tool, **not yet the complete F1 WebSocket/exercise harness**. `ws` is pinned for that implementation. No green contract result is claimed.

## Contract facts from current official docs

These are documentation findings, not observations of the installed release.

- [Protocol](https://docs.switchagents.ai/switch-rooms/internals/agent-protocol): separate one-time registration credential; register an unmanaged service out of band at POST `/agents`, without overwrite. Discover operation input schemas at GET `/agents/{id}/ops`; invoke operations with unwrapped JSON arguments and connection identity header. Hash captured input schemas with canonical object key ordering.
- [Connection](https://docs.switchagents.ai/switch-rooms/internals/agent-connection): WebSocket transport, first `connection_state`, immediate cursor pongs, generation fencing, explicit gaps/refusals. Room claims can take over another connection, making a separately registered identity essential. SSE is deprecated.
- [Events](https://docs.switchagents.ai/switch-rooms/internals/agent-events): opaque sender IDs; obtain participant kind from authoritative lookup rather than parsing ID strings. Multi-file messages require attachment-group correlation; attachment references are not file bytes.
- [Runtime](https://docs.switchagents.ai/switch-rooms/internals/connectors-and-runtime): Console owns coding-agent watchers and placements; native tools mediate agent calls. Attachments are delivered as session-local files. A Switch-started Codex session must actually read the PNG; this chat cannot stand in for it.
- [Identity](https://docs.switchagents.ai/switch-rooms/internals/identity-and-access): resource permission and permission to address an agent are distinct. Explicit cross-owner addressing configuration must be verified.

No SwitchPort wire mapping is approved yet. In particular, post/thread arguments, mention encoding, participant-kind field, media grouping visibility and Slack source mapping must come from actual release evidence.

## Required continuation, in order

1. Obtain the operator's Switch room and feedback/worker Codex identities plus owner mapping. Verify that the selected room bridges to the selected Slack channel.
2. Use the signed-in operator registration flow to create a separate deterministic service identity (suggested name `app-feedback-f1-probe`) with no overwrite. An operator-created registration credential must stay private; do not request it in chat. Do not repurpose Console-managed keys. Add service room membership/addressing only within the authorized demo resources.
3. Read authenticated `/version` and registry. Record exact version/protocol ranges and four operation schemas: `read_context`, `post_message`, `send_targeted_message`, `list_participants`. Resolve any unknown version rather than marking it compatible.
4. Implement bounded WebSocket capture against those schemas, first-state/cursor handling and participant lookup. Capture only labeled F1 messages, with unrelated events excluded. Do not reconnect after takeover or conceal a stream gap.
5. Have the selected human send the labeled Slack mention; prove authenticated sender kind, explicit mention and source thread. Exercise same-thread response and service/feedback → worker → feedback handoff using native tools, including permitted cross-owner addressing. Correlate source event and response IDs.
6. Recover the actual source Slack thread link through exposed bridge metadata or documented operation. Test that it opens the correct thread. A channel URL is not thread evidence; never construct a timestamp from a Switch message ID.
7. Send one fixture PNG to a Switch-run Codex session; record its local delivery and correct visual interpretation. Prove that session executes a harmless Node command and resolves an explicitly configured ignored profile path. Do not pretend F6 feedbackctl already exists. Also capture a genuine multi-attachment group for the group contract.
8. Sanitize captures, implement release-specific assertions tying senders, room/thread IDs, schemas, source links and session evidence together, then run contract/probe/type/format checks. Record hashes and limitations. Live proof and fixture validation are both required.

## Verification result

- Local unit tests: 2 passed.
- Typecheck: passed.
- Contract test: expected failure, four missing live-capture fixtures.
- Offline probe check: expected BLOCKED, exit 1.
- Dependency installation audit: zero reported vulnerabilities.
- Formatting: verified after this document was created.

**F1 gate: NOT PASSED.** Missing authorized-resource mapping and separately provisioned service access block authenticated discovery and live proofs. The required WebSocket/exercise harness and release assertions remain unfinished pending those inputs. No later task may start based on these local tests.

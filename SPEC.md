# App feedback workflow — MVP specification

Status: approved by the user on 2026-11-06. Implementation planning is authorized; application implementation and provisioning remain paused until plan review. Technical design and integration proofs listed at the end are prerequisites, not permission to expand product scope.

## Problem

Users report bugs and request features in a shared channel. Turning those conversations into actionable work and following through requires repeated manual coordination.

## Agreed direction

- Build a solo hackathon demo using Switch to coordinate users and agents.
- Use a small sample target app rather than an existing application.
- Use the term user throughout; the product is not specific to scientists.
- Let users report naturally with text, screenshots, recordings, or a combination.
- Keep each request's clarification and follow-through associated with its thread in the common channel.
- An explicit @mention starts intake; ordinary channel posts do not create work. Follow-up conversation continues in the request thread.
- Support both bug reports and feature requests, with one bounded demonstration of each. Complex or ambiguous requests pause for a human decision.
- Automated implementation ends at a technically verified PR, with a working hosted preview where applicable. The feedback agent shares the PR and collects requester feedback or acceptance. PR handoff, requester acceptance, and merge are distinct outcomes; a PR is not a shipped change.
- Intake clarifies and files tickets automatically. The requester confirms acceptance criteria, and an engineer explicitly authorizes implementation. Review and integration are engineering responsibilities outside automation. One person can play both human roles in the solo demo.
- GitHub Issues track requests; GitHub PRs hold proposed changes. Both link back to the request thread. Issues contain the report, evidence or attachment links, confirmed acceptance criteria, Slack thread link, and linked PR. Lifecycle states include clarifying, awaiting authorization, available, implementing, PR opened, and blocked; requester acceptance is recorded separately.
- Create an issue once intake recognizes an actual report, initially clarifying, and update it as details arrive. Incomplete reports are preserved but cannot enter the implementation pool before confirmation and authorization.
- Slack is the only chat platform in the MVP, connected through Switch. Other platforms are deferred.
- Each feedback room serves one configured target app and one GitHub repository. Users do not need to identify a repository in their reports.

## Requirements and human decisions

- Requester-facing clarification, confirmation, and verification instructions use observable app behavior and plain language. Requesters may be nontechnical.
- Ask the requester about user-facing ambiguities, including allowed priority values, defaults, filtering, and export behavior.
- Route implementation decisions such as database structure, API design, frameworks, and migrations to engineering. Translate a technical constraint into a user-facing tradeoff only when it requires a requester decision.
- Use explicit, stage-specific confirmations in the request thread. The feedback agent posts numbered requirements, then asks the original requester to reply @feedback confirm or describe changes. Preview acceptance uses @feedback accept. Record the person and confirmed requirements revision or tested commit.
- After requester confirmation, the feedback agent posts an engineering authorization prompt with the issue and requirements revision. A configured engineer replies @feedback authorize. That authorizes only the displayed revision; changed requirements require fresh requester confirmation and engineering authorization.
- Apply a confirmation only to an unambiguous current prompt for that thread and stage. Ambiguous or stale replies require clarification; messages from other people cannot substitute for the original requester's confirmation or acceptance. Validate identities using authenticated source events rather than trusting an agent's assertion about who approved.
- Requester acceptance applies to the tested commit. New code requires fresh verification and acceptance.
- Engineering owns review, branch updates, conflict resolution, merging, and final issue closure. Engineers may use their own agents for those activities, outside this workflow. Automated merge tracking, conflict repair, issue closure after merge, and production deployment are outside MVP scope.
- Opening a PR leaves its issue open. Report PR opened or handed off to engineering; record requester acceptance separately without claiming the change has merged or shipped.
- If a preview fails to meet agreed criteria, continue the same ticket and PR within the attempt limit. Changed requirements require revised requester confirmation and fresh engineering authorization. Unrelated additions become separate requests; ambiguous cases require clarification.

## Requester handoff

- Post the PR link in the original request thread, rather than starting a separate channel-level announcement.
- The PR holds a plain-language summary, the ready preview deployment link, requester verification steps, and engineering test evidence.
- The requester tries the preview and confirms acceptance in the original thread. Engineering review and merge take place in GitHub.
- A failed deployment is reported as a blocker, not presented as ready for acceptance.

## Pauses and failed work

- An implementation attempt is one implementation pass followed by verification. If verification fails, allow one corrective pass. If that also fails, mark the request blocked and report the blocker to engineering.
- Missing information or an unavailable external service pauses work without consuming a coding attempt. Requester feedback requiring further changes can resume work with explicit engineering authorization.
- Missing information pauses for the requester; a failed preview cannot advance to acceptance.
- Resume on explicit human input. Silence and timeouts never count as approval.

## Sample target app

A polished team project workspace with projects, tasks, task details, assignees, statuses, comments, search/filtering, and CSV export. Data persists and realistic seeded projects support repeatable demonstrations. Include loading, empty, and error states. Authentication and third-party integrations are outside the target app's scope.

- Bug scenario: the completed-task filter works on screen, but CSV export includes all tasks.
- Feature scenario: add priority across storage, API validation, task creation/editing, task display, filtering, and CSV export. The requester must confirm priority values and the default for existing tasks during intake; those values are intentionally unspecified here.
- Verify UI behavior and API results.
- Freeze the sample app's baseline scope once it is credible. Allocate roughly one-third of implementation effort to the app and two-thirds to the feedback workflow and demo.

## Verification and previews

- Offer an interactive hosted PR preview when the requested outcome can be exercised through the app. A backend change used by the existing UI qualifies; frontend file changes are not required.
- For behavior without a meaningful UI interaction, provide API/integration test evidence and require engineering verification. Requester confirmation concerns the outcome, rather than interpreting raw technical responses.
- Demo the export fix and priority feature through the app; a separate backend-only demonstration is outside the current demo scope.
- Use Vercel Git previews and the Neon integration's automatic database branching: one target-app database branch per Git branch, separate from the baseline. Each request has its own Git branch. Provider-managed branching supersedes the earlier shared-preview-database proposal; custom provisioning is deferred.
- Configure versioned migrations and fictional baseline seed data. Keep cleanup manual for the demo; automatic cleanup is deferred.
- Offer only the latest verified preview for a request. A new commit invalidates previous acceptance. Database isolation is per branch, not per deployment: later migrations may make older commit-specific previews unusable. Immutable historical previews are outside scope.
- Deployment readiness checks, preview access, and the migration/build commands still need concrete implementation design.

## Attachment evidence

- Preserve links to original Slack messages/files in issues, together with a written summary of relevant screenshot evidence.
- A separate media-hosting service is outside MVP scope.
- If an agent cannot retrieve or interpret an attachment, explain the limitation and ask for the missing details. Recordings remain linked evidence; automatic video analysis is deferred.

## MVP scope limits

- Accept multiple reports and allow multiple active implementations and open PRs across the engineering team. A request waiting for preview acceptance, engineering review, or merge does not block unrelated requests. There is no product-wide fixed worker or PR cap; the solo demo may use a small number of workers without making that a product restriction.
- Interpret text and screenshots. Preserve screen recordings as ticket evidence; ask for written reproduction steps when the available evidence is insufficient. Automatic video analysis is deferred.
- Two agent roles: feedback and implementation. Multiple instances can hold these responsibilities. Engineering review is human; a separate reviewer role is deferred.
- Both agent roles use Codex initially, using the user's existing subscription for the solo demo. Different harnesses are outside MVP scope. In a team, implementation agents may belong to different engineers, and an engineer can have multiple agents.

## Implementation handoff and claiming

- After requirements confirmation and engineering authorization, intake hands the request to a shared pool of eligible implementation agents rather than selecting a fixed coding agent.
- Notify registered implementation agents of available work through Switch. Available agents can attempt a claim; busy agents continue their current work. If no agent claims the request, it remains available.
- Any eligible implementation agent can claim an available authorized request.
- Each request has exactly one active implementation assignee. Claiming must prevent two workers from taking the same request, including simultaneous claims.
- Configure participating engineers and their implementation agents during setup. Any registered implementation agent may claim an authorized request; record its owning engineer. Only configured engineers may authorize implementation or release/reassign claims.
- Different claimed requests progress independently in separate branches and PRs. A waiting PR retains its request association without reserving team-wide capacity.
- If a claimed request's agent stops working, mark the request blocked. An engineer explicitly releases or reassigns its claim. A replacement continues from the existing branch, ticket, and recorded progress. Automatic takeover is deferred because the original agent may still be editing.
- Engineer/agent identity mapping, claim persistence, and stopped-worker detection remain to be specified.

## Shared issue tracker

- The feedback room uses a shared GitHub Issues repository as its central tracker, rather than a separate private tracker per agent. The exact repository is selected during setup.
- Issues preserve the report, confirmed requirements, lifecycle status, implementation assignment, decisions, evidence links, and associated PR. New or replacement agents consult the same issue instead of relying on another agent's session memory.
- Slack request threads hold the user conversation; issue records hold the durable work summary. Cross-link both. A room-level reference identifies the tracker, while agent-specific service access supplies authorization.
- Sharing a tracker reference does not grant credentials or authorize every room participant to mutate issues. Requester and engineer decisions retain their distinct authority.
- Transactional claim enforcement and durable identity/thread mappings still need an implementation design; shared issue visibility alone does not prevent competing claims.

## Coordination service

- Build a small coordination service without a separate dashboard. Agents use its tools to advance requests.
- Persist the association between the Slack request thread, GitHub issue, PR, and current requirements revision/tested commit.
- Enforce one active implementation claim per request, including concurrent claim attempts.
- Check original-requester and configured-engineer identities for stage-specific decisions; native tool-permission approval is not a substitute for product authorization.
- Persist confirmations, implementation attempts, requester acceptance, and processed event identities. Reject duplicate events and invalid state transitions.
- GitHub remains the shared human-readable ticket tracker. The coordination service enforces operational decisions and reflects resulting lifecycle status in issues. Conflicting or partial updates require recovery without repeating external writes.
- Agent session memory is not the authoritative record for claims, approval, or request progress. The concrete persistence technology, authenticated event source, and external-update recovery design are still open implementation questions.

## Duplicate reports

- Search the shared tracker for likely matches during intake and present them to the requester.
- If the requester confirms the same problem is already tracked, attach the new evidence and thread link to the existing issue rather than create an additional work item.
- If the report differs, continue with a separate issue. Similarity alone never silently discards a report.
- Ticket creation follows the duplicate check when it finds a potential match; otherwise create the issue in clarifying status promptly. Multiple request threads may reference one issue, so later updates must retain their thread associations.

## Agent responsibilities

- Feedback agent: clarify reports, maintain tickets, coordinate approvals, and return results to the requester in the request thread.
- Implementation agents: claim available authorized requests, investigate the target app, change code, run checks, and open a PR for each claimed request.
- Humans: the engineer reviews and approves integration; the requester explicitly accepts the outcome.

## Intended outcome

An agent clarifies a report, creates a ticket, obtains requirements confirmation and engineering authorization, and makes the request available to implementation agents. One worker claims it and produces a verified PR with a working preview where applicable. The feedback agent posts the PR in the original thread and records requester feedback or acceptance. Review, integration, conflict resolution, and final issue closure stay with engineering.

## Lifecycle and handoff requirements

- Clarifying: preserve report/evidence, investigate duplicates, and resolve user-facing questions. Present numbered criteria for requester confirmation.
- Awaiting authorization: requester has confirmed the current criteria; wait for a configured engineer's authorization.
- Available: current criteria are confirmed and authorized; any eligible free implementation agent can attempt to claim.
- Implementing: one agent holds the claim, owns the request branch, records progress, and implements and verifies the authorized scope.
- PR opened: the worker has opened the linked PR. Technical checks and deployment readiness must be established before presenting it as a verified handoff or asking for preview acceptance. PR opened alone does not mean ready, accepted, merged, or shipped.
- Blocked: record the cause and the human or external dependency needed to continue. Preserve the request's branch and progress. Human intervention controls resume/reassignment; no automatic takeover.
- Requester acceptance is recorded separately against the verified commit. It is not a merge or issue-closure state.
- A worker's handoff includes issue identity, criteria revision, branch, PR, commit, verification evidence, preview URL/status if applicable, and unresolved questions. Return this through Switch to the feedback agent; that agent posts the user-facing PR handoff in the original thread.

## Demo and acceptance checks

The demo uses fictional people and data, and clearly identifies the solo builder as playing human roles. A small number of worker instances demonstrates team behavior without imposing a product-wide cap.

- A text-only bug report produces a clarifying issue linked to its Slack thread. The requester confirms nontechnical criteria; an engineer authorizes implementation. A worker reproduces the CSV filter bug, fixes it, verifies expected records through API/UI checks, and opens a PR with a usable preview.
- A priority feature request requires user-facing clarification, then changes persistence, validation, creation/editing, display, filtering, and CSV output in accordance with confirmed criteria. Existing-task defaults match that confirmation.
- PR summaries and verification steps are understandable to the requester; technical evidence is available for engineering. PR links return to the correct original threads.
- Demonstrate that another request can progress while one PR waits for human review. Separate requests retain separate branches, PRs, previews, and data environments.
- Test simultaneous claims for one authorized request: only one eligible worker wins. A different authorized request remains independently claimable.
- Test wrong-person, wrong-stage, stale-revision, and duplicate confirmations/events: none causes unauthorized implementation or duplicate issues/PRs.
- Demonstrate duplicate-report confirmation and evidence linkage without creating duplicate implementation work. Each linked request thread retains its identity.
- Demonstrate a blocked path after two unsuccessful implementation passes, plus explicit engineer-controlled resumption/reassignment.
- A screenshot contributes to clarification; inaccessible attachments produce an honest fallback request. Recordings can be retained as links without claiming video interpretation.
- A failed or stale deployment is never offered as a verified preview. New code invalidates prior acceptance. Preview access works for the person playing the requester.
- Restart/recovery checks preserve request associations, claims, decisions, and attempts without repeating already-completed external actions.
- Issues remain open after PR handoff. No automatic merges, conflict resolution, merge-time issue closure, or production-release claims occur.

## Technical design and feasibility work still required

These choices are addressed by the engineering plans under docs/plans. They do not reopen the agreed product boundary; application implementation remains paused pending plan review.

- Select the application framework, coordination-service runtime/persistence, and agent tool transport compatible with Switch and Codex.
- Inspect installed Switch version and operation schemas. Prove same-thread communication, handoffs, worker notifications, and screenshot delivery using the intended runtime; validate follow-up routing and configure explicit-mention-only intake as needed.
- Specify stable workspace/channel/thread/message/issue/agent/engineer identities and obtain trustworthy source events for authorization checks. Define agent registration and engineer configuration.
- Specify atomic claims, ownership checks, explicit reassignment, stopped-worker detection, event deduplication, and recovery for partially completed GitHub/Slack writes. Mirrored issue labels alone are not enforcement.
- Provide per-request branches and isolated local checkouts when workers share a machine. Honor superseded claims so replaced workers cannot advance request state.
- Connect GitHub and Vercel/Neon; define migration/seed/build commands, deployment status lookup, current-commit matching, and preview access. Use fictional baseline data and provider-managed preview branches.
- Select supported screenshot types and retrieval limits; preserve source links and useful summaries. Test failures and access expiry.
- Choose the bounded mechanism for checking PR deployment readiness. Merge-event monitoring stays outside scope.
- Pin reproducible dependencies, setup instructions, fixture data, and checks appropriate to the chosen stack.

## Superseded or unselected suggestions

The local ticket board and orchestration runtime previously suggested have not been selected by the user. The two agent roles using Codex, project workspace sample app, export bug, and priority feature have been accepted. The earlier single-active-PR rule and proposed fixed worker caps are superseded: authorized requests enter a shared implementation pool, one agent claims each request, and different requests proceed independently.

## Documentation evidence

- Switch thread follow-ups route to the last agent that spoke or was tagged; explicit mentions override that routing: https://docs.switchagents.ai/switch-rooms/using/work-in-a-room#keep-talking-without-tagging-the-agent
- Switch provides same-thread message correlation and agent handoff messaging, but the request lifecycle and role-specific approval enforcement are application responsibilities: https://docs.switchagents.ai/switch-rooms/internals/collaboration-bridge and https://docs.switchagents.ai/switch-rooms/internals/agent-protocol
- Provider-managed preview database branching: https://neon.com/docs/guides/vercel-managed-integration
- Preview branch cleanup behavior: https://neon.com/docs/guides/vercel-branch-cleanup
- Requester access to protected previews must be verified: https://vercel.com/docs/deployments/sharing-deployments

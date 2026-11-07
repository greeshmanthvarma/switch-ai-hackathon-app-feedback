# App Feedback

App Feedback turns a Slack report into a tracked request and hands it from one Codex agent to another through Switch. A local operator approves the exact request revision. The feedback agent delegates to the worker and posts its result in the original Slack thread.

**Verified demo:** Slack report → [GitHub issue](https://github.com/greeshmanthvarma/switch-ai-hackathon-app-feedback/issues/1) → local approval → feedback-to-worker handoff → same-thread result. Repeating issue tracking returned the same issue. The worker ran `node --version` and returned exit code 0.

The prototype demonstrates intake, tracking, approval, and handoff. It does not yet have a target-app checkout or automated code changes and PR delivery. Switch 0.31.0 / protocol 9 was tested live. The operator approves work in the local terminal. Slack text alone cannot authorize work.

## Try it

- [Set up and run the demo](docs/integration/operator-demo.md)
- [Switch Console settings and agent instructions](docs/integration/agent-instructions.md)

Use Node.js 22.19.0 or a newer Node 22 release. For the offline checks:

```sh
npm ci
npm test
npm run typecheck
npm run format:check
```

Use your own Switch and GitHub access for a live run. Credentials, raw captures, and request state belong in ignored local storage. The checked-in fixtures are sanitized.

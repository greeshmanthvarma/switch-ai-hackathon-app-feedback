# App Feedback

A Switch-coordinated Slack feedback workflow that turns reports into shared GitHub Issues, requester-confirmed requirements, engineer-authorized implementation, and verified pull request handoffs.

Both feedback and implementation agents use Codex. Each request has one exclusive implementation claim; unrelated requests can progress independently. Automation ends at verified PR handoff. Review, merge, issue closure, and production release remain engineering responsibilities.

## Current status

Task F1 is partially implemented. The workspace, read-only Switch discovery probe, and local evidence checks are present. **The Switch compatibility gate has not passed.** Live service registration, authenticated release discovery, source identity/thread routing, handoffs, Slack thread links, and screenshot delivery still require proof. The release contract test intentionally fails while that evidence is missing.

See [F1 findings and continuation](docs/integration/switch-contract.md).

## Local checks

Requires Node.js 22.12 or later within Node 22, and npm.

```sh
npm ci
npm run test:unit
npm run typecheck
npm run format:check
```

The following currently exit unsuccessfully because live evidence is missing:

```sh
npm test
npm run test:contract
npm run probe:switch -- --check
```

For private authenticated discovery setup, follow the F1 integration document. Do not use a Console-managed agent's connection or credentials. Store local credentials and captures only under ignored `.local/` or private process environment variables.

## Approved design

- [Specification](SPEC.md)
- [Glossary](CONTEXT.md)
- [Execution index](docs/plans/2026-11-06-execution-index.md)
- [Feedback workflow plan](docs/plans/2026-11-06-feedback-workflow.md)
- [Sample application plan](docs/plans/2026-11-06-sample-app.md)

The sample application will be a separate repository. Its implementation has not started. `sample-app/`, local state, dependencies, and environment files are excluded from this repository.

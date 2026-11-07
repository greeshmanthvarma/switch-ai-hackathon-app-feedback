# Run the operator demo

The operator approves a saved report revision in the local terminal. Slack reports and attachments provide context; they do not authorize work. The feedback agent handles the worker handoff and returns the result to the original thread.

## Set up

1. Install dependencies with `npm ci` from the repository root. Use Node.js 22.19.0 or a newer Node 22 release. For optional GitHub tracking, sign in with the GitHub CLI and choose a private repository with Issues enabled.
2. On your Switch server, connect Slack and select a demo room. Configure the two Codex agents using the [agent instructions](agent-instructions.md). Note the Switch room UUID, which is different from the Slack channel ID.
3. Register the separate deterministic service once. Supply `SWITCH_PROBE_BASE_URL` and `SWITCH_PROBE_REGISTRATION_KEY` privately in the shell environment, then run:

   ```sh
   node --import tsx scripts/switch-service-registration.ts --register
   ```

   This writes the service profile to ignored `.local/switch-probe/service.json`. If a profile already exists, use it rather than registering again. Use the operator's registration credential, never a Console-managed agent's key. Invite `app-feedback-f1-probe` to the demo room and allow it to address `feedback` there. Keep credentials and raw captures out of Git.

4. Verify the connection and then start the listener in an interactive terminal. Substitute your own room UUID and, if using tracking, private repository:

   ```sh
   npm run demo:flow -- --check YOUR_SWITCH_ROOM_UUID
   npm run demo:flow -- --live YOUR_SWITCH_ROOM_UUID --tracker OWNER/REPO
   ```

   Omit `--tracker OWNER/REPO` for the local-only flow. The live probe currently expects the captured Switch 0.31.0 / protocol 9 operation schemas. A changed release or schema stops startup.

## Run a report

1. Post a new Slack message beginning with `@feedback report:`. Include text and optional screenshots. To queue an earlier root from authenticated room history, use `queue-history <thread-id>` in the terminal.
2. Run `list` and `show <id>` in the terminal. Review the report, exact revision, and original Slack thread.
3. In tracker mode, run `track <id>` to create an issue for that one request. Its body records the original report, screenshot references, Switch room/thread IDs, and revision. Repeat tracking returns the same issue; an ambiguous response is reconciled by request marker without another create. Intake and startup do not write to GitHub.
4. Run `approve <id> <revision>`. The coordinator targets feedback only. Feedback sends the worker a labeled `node --version` test in the same thread.
5. Confirm that the worker returns its result to feedback and that feedback posts the matching summary. In tracker mode, the summary includes the issue link. Use `release <id>` after reviewing the thread, or `quit` to stop the listener.

## What the live test proved

[Demo issue #1](https://github.com/greeshmanthvarma/switch-ai-hackathon-app-feedback/issues/1) was created for a selected Slack test report. Repeating the tracking command returned the same issue, and a separate GitHub query found one matching request marker. After local approval, feedback handed the test to the worker, the worker returned Node `v22.19.0` / exit code `0`, and feedback posted the result and issue link in the original thread. The issue remains open.

The coordinator saves requests and receipts in ignored local SQLite storage. One configured worker can handle one approved smoke test at a time; other reports can still be queued. If a dispatch receipt is ambiguous, the request remains reserved for operator review and does not retry automatically. A receipt proves Switch accepted the handoff message; a displayed sender label does not authenticate an approval. This demo trusts the local operating-system account running the terminal, and it does not open a network approval endpoint.

The original deployment used Slack channel `C0CFNBEAZRQ` in Switch room `13acee29-83e4-443e-b0e8-b2c4d2c741a4`. Those are example resource identifiers, not credentials; use your own room for a new setup.

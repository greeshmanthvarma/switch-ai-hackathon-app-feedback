# Verified CSV-fix PR handoff

The bounded target is a **separate** Node.js checkout, `target-app`. Its `main` contains the reproducible status-filter defect; `feedback/export-status` contains the fix and regression test. `npm test` on the fix branch verifies exactly three matching rows and excludes the other project. The baseline returned ten rows with the same filter. This is a backend/API demo, with no hosted preview.

This extension relays an **existing** verified PR. It does not generate fixes from arbitrary Slack messages or have agents open, merge, or deploy PRs. The operator prepares the target PR; the service verifies its identity and test result; feedback delegates delivery to the worker and posts the returned link in the original thread.

## Prepare the demo

1. Use the existing [operator setup](operator-demo.md) and selected room; stop the previous listener before starting the new one. Never clear its shared lock while the old listener is running.
2. Apply the updated [agent instructions](agent-instructions.md) to both existing agents. Keep their addressing and approval restrictions. Start fresh sessions if needed so the instructions apply.
3. Publish the separate target's `main` and `feedback/export-status` branches to a private GitHub repository. Leave the fixed branch checked out and clean, with `origin` pointing to that repository. `gh` needs read access to the target and the existing tracker.
4. Start the listener with the existing service profile and explicit targets:

   ```bash
   npm run demo:flow -- --live ROOM_UUID --tracker OWNER/TRACKER \
     --target /absolute/path/to/target-app --target-repo OWNER/TARGET
   ```

5. Submit a new bounded report through the selected room: `@feedback report: Completed-task CSV includes tasks of other statuses`. At the local listener use `list`, `show REQUEST_ID`, and `track REQUEST_ID` to review and create one issue. Do not run the smoke-test `approve` on this request.
6. Open a PR in the target repository from `feedback/export-status` into `main`. Include the exact line `Related to https://github.com/OWNER/TRACKER/issues/NUMBER` using the tracked issue's actual URL. Describe the regression and `npm test` result. Leave it open.
7. In the local listener, run `relay-pr REQUEST_ID REVISION PR_NUMBER` as the explicit approval to deliver it. The listener requires a pending revision and linked issue, checks the private repo and clean checkout, matches the open PR's full head SHA, runs the regression, and rereads the PR before claiming and dispatching. A changed head, unrelated PR, failed test, or unavailable service prevents delivery.
8. Review the real `DEMO-PR-REQUEST`, `DEMO-PR-WORKER-RESULT`, and `DEMO-PR-RESULT` messages in the report thread. Confirm the last reply contains the actual PR link and says it awaits review. Then `release REQUEST_ID`. An ambiguous send is reserved for manual reconciliation; do not retry blindly.

The existing `approve` smoke-test path is unchanged. Keep the issue and PR open. An observed Switch dispatch receipt is not evidence that the final human-visible reply arrived.

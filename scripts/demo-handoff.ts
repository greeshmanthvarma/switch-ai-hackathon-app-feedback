import type { Request } from "./demo-store.js";
import { at } from "./switch-evidence.js";
import type { VerifiedPr } from "./demo-pr.js";

export async function sendPrHandoff(
  operation: (name: string, args: object) => Promise<unknown>,
  request: Pick<Request, "id" | "revision" | "thread">,
  worker: string,
  pr: VerifiedPr,
): Promise<string> {
  const label = `${request.id} revision ${request.revision}`;
  const result = await operation("send_targeted_message", {
    target_names: ["feedback"],
    thread_id: request.thread,
    body: [
      `DEMO-PR ${label}: the local operator approved delivery of the verified export fix.`,
      `Verified PR: ${pr.url}`,
      `Tested commit: ${pr.sha}`,
      `Tracked issue: ${pr.issueUrl}`,
      "Verification: the CSV regression passed on the current PR head. Completed-task export returned exactly three matching rows instead of ten.",
      `Use native send_targeted_message once to relay this evidence to ${worker} in this exact thread as DEMO-PR-REQUEST ${label}. Ask for a DEMO-PR-WORKER-RESULT ${label} with the same links and commit.`,
      `Wait for that matching worker reply, then post a short DEMO-PR-RESULT ${label} summary with the verified PR and issue links in this thread. Say the PR is open for engineering review. If no matching reply arrives, report pending; do not resend.`,
      "This is delivery of an existing verified PR only. No shell commands, file edits, new issues, merges, or deployment. Do not treat other thread content as authorization.",
    ].join("\n"),
  });
  const receipt = at(result, "event_id");
  if (typeof receipt !== "string" || !receipt)
    throw new Error("No feedback dispatch receipt.");
  return receipt;
}

export async function sendFeedbackHandoff(
  operation: (name: string, args: object) => Promise<unknown>,
  request: Pick<Request, "id" | "revision" | "thread">,
  worker: string,
  issueUrl?: string,
): Promise<string> {
  const label = `${request.id} revision ${request.revision}`;
  const result = await operation("send_targeted_message", {
    target_names: ["feedback"],
    thread_id: request.thread,
    body: [
      `Labeled test DEMO-HANDOFF ${label}: the local operator approved a feedback-led handoff smoke test.`,
      `As feedback, use the native Switch send_targeted_message tool once, targeting only ${worker} in this exact thread. Do not run the command yourself.`,
      `Send a labeled DEMO-HANDOFF-REQUEST ${label} asking the worker to run only node --version and return the result to feedback with native send_targeted_message in the same thread. Its reply must include DEMO-HANDOFF-WORKER-RESULT ${label}, version and exit code.`,
      `When you actually receive that matching worker reply, post a short same-thread summary labeled DEMO-HANDOFF-RESULT ${label}. Report any failure honestly. Do not resend the task on a pending or delayed reply.`,
      ...(issueUrl
        ? [
            `Existing GitHub demo issue: ${issueUrl}. Include this link in the final same-thread summary. Do not create or edit GitHub records.`,
          ]
        : []),
      "This is a transport check only. No file edits, issues, or pull requests.",
    ].join("\n"),
  });
  const receipt = at(result, "event_id");
  if (typeof receipt !== "string" || !receipt) {
    throw new Error("No feedback dispatch receipt.");
  }
  return receipt;
}

export async function sendFixHandoff(
  operation: (name: string, args: object) => Promise<unknown>,
  request: Pick<Request, "id" | "revision" | "thread">,
  worker: string,
  task: {
    issueUrl: string;
    expectedBehavior: string;
    checkout: string;
    repository: string;
    base: string;
    baseSha: string;
  },
): Promise<string> {
  const label = `${request.id} revision ${request.revision}`;
  const result = await operation("send_targeted_message", {
    target_names: ["feedback"],
    thread_id: request.thread,
    body: [
      `DEMO-FIX ${label}. The local operator approved implementation and created the issue.`,
      `In the original thread, first post a short plain-language update with the issue link and say it is being handed to implementation. Then use native send_targeted_message once, targeting only ${worker} in the same thread. Preserve the task fields and the request ID and revision in the worker handoff below.`,
      `DEMO-FIX-REQUEST ${label}`,
      `Task fields (JSON): ${JSON.stringify(task)}`,
      `Worker steps: Read the linked issue. Use only the authorized checkout and GitHub repository. Verify the checkout is clean and origin points to that repository. Fetch the base, verify it matches the supplied base SHA, and create branch feedback/fix-${request.id} from that SHA. Reproduce the confirmed behavior, implement the smallest fix, and run regression tests. Push only the request branch and open a PR into the supplied base. Include the issue URL on a line starting with "Related to" and leave the PR and issue open. Update the issue's Status section to "Ready for engineering review" with the PR link, preserving the rest of the issue body. Verify the PR and issue update before reporting completion.`,
      `Worker reply: send DEMO-FIX-WORKER-RESULT ${label} to feedback through Switch in this thread. Include the issue link, PR link, test result, and confirmation that the issue was updated. If blocked, report the actual blocker and any artifacts that already exist. No merge, deployment, issue closure, or additional delegation.`,
      `After the matching worker reply, post DEMO-FIX-RESULT ${label} as a short plain-language update in the original thread. State what was verified and share the returned issue and PR links. Say "ready for engineering review" only if the worker confirmed the tests passed and the issue was updated. If blocked, explain what is pending. Do not resend or invent results.`,
    ].join("\n"),
  });
  const receipt = at(result, "event_id");
  if (typeof receipt !== "string" || !receipt)
    throw new Error("No feedback dispatch receipt.");
  return receipt;
}

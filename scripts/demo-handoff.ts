import type { Request } from "./demo-store.js";
import { at } from "./switch-evidence.js";

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

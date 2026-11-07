import { at } from "./switch-evidence.js";

export function slackApprovals(
  room: string,
  operator: string,
  feedback: string,
) {
  const summaries = new Map<string, { behavior: string; timestamp: number }>();

  return (frame: unknown, isPending: (thread: string) => boolean) => {
    if (
      at(frame, "event") !== "message" ||
      at(frame, "data", "room_id") !== room
    )
      return null;

    const payload = at(frame, "data", "payload");
    const thread = at(payload, "thread_id");
    const body = at(payload, "body");
    const sender = at(payload, "sender");
    const timestamp = at(payload, "timestamp");
    if (
      typeof thread !== "string" ||
      typeof body !== "string" ||
      typeof sender !== "string" ||
      typeof timestamp !== "number" ||
      !Number.isSafeInteger(timestamp) ||
      at(payload, "on_behalf_of") ||
      at(payload, "sender_kind") === "platform" ||
      !isPending(thread)
    )
      return null;

    const previous = summaries.get(thread);
    if (previous && timestamp <= previous.timestamp) return null;
    if (sender === feedback) {
      const match = /^Ready for approval: ([^\r\n]+)(?:\r?\n|$)/i.exec(
        body.trim(),
      );
      const behavior = match?.[1]?.trim();
      if (behavior && behavior.length <= 1500)
        summaries.set(thread, { behavior, timestamp });
      else summaries.delete(thread);
      return null;
    }

    if (sender === operator && /^Approved[.!]?$/i.test(body.trim())) {
      summaries.delete(thread);
      return previous ? { thread, expectedBehavior: previous.behavior } : null;
    }

    // A follow-up from the operator can change the request. Wait for a new summary.
    if (sender === operator) summaries.delete(thread);
    return null;
  };
}

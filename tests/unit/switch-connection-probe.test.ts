import { test, expect } from "vitest";
import {
  validateProfile,
  validateFirstState,
} from "../../scripts/switch-connection-probe.js";
import { loadEvidence, at } from "../../scripts/switch-evidence.js";
test("profiles require a separate identity and safe credential-free origin", () => {
  const profile = {
    server: "http://localhost:56830",
    id: "test-service",
    api_key: "synthetic-unit-key",
    identityKind: "separate-unmanaged-service",
  };
  expect(validateProfile(profile).id).toBe("test-service");
  expect(() =>
    validateProfile({ ...profile, identityKind: "managed-agent" }),
  ).toThrow();
  expect(() =>
    validateProfile({ ...profile, server: "https://user:secret@example.com" }),
  ).toThrow();
});
test("authentic first state must match service and requested room", async () => {
  const evidence = await loadEvidence();
  const frame = at(evidence.frames, "capture", "firstConnection");
  const id = at(frame, "data", "agent_id") as string;
  const room = (at(frame, "data", "rooms") as string[])[0]!;
  expect(validateFirstState(frame, id, room)).toBe(at(frame, "data", "cursor"));
  expect(() => validateFirstState(frame, "another-agent", room)).toThrow();
  expect(() => validateFirstState(frame, id, "another-room")).toThrow();
  expect(() => validateFirstState({ event: "message" }, id, room)).toThrow();
});

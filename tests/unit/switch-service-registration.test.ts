import { test, expect } from "vitest";
import {
  serverOrigin,
  registerService,
  registrationBody,
} from "../../scripts/switch-service-registration.js";
test("registration rejects credential-bearing URLs and insecure nonlocal origins", () => {
  for (const url of [
    "https://person:secret@example.com",
    "https://example.com/path",
    "https://example.com/?key=secret",
    "http://example.com",
  ])
    expect(() => serverOrigin(url)).toThrow();
  expect(serverOrigin("http://localhost:56830").origin).toBe(
    "http://localhost:56830",
  );
});
test("registers a separate deterministic participant once without controller registration or overwrite", async () => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const request: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return Response.json({
      id: "synthetic-service",
      api_key: "synthetic-unit-key",
    });
  };
  expect(
    await registerService(
      serverOrigin("https://example.com"),
      "synthetic-registration-key",
      request,
    ),
  ).toEqual({ id: "synthetic-service", api_key: "synthetic-unit-key" });
  expect(calls).toHaveLength(1);
  expect(calls[0]?.url).toBe("https://example.com/agents");
  expect(JSON.parse(String(calls[0]?.init?.body))).toEqual(registrationBody);
  expect(registrationBody.overwrite).toBe(false);
  expect(calls[0]?.init?.redirect).toBe("error");
});
test("refusals do not leak server bodies or trigger a retry", async () => {
  let calls = 0;
  const request: typeof fetch = async () => {
    calls++;
    return new Response("private upstream diagnostic", { status: 409 });
  };
  await expect(
    registerService(
      serverOrigin("https://example.com"),
      "synthetic-key",
      request,
    ),
  ).rejects.toThrow("Registration HTTP 409; response body withheld.");
  expect(calls).toBe(1);
});

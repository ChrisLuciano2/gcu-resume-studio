import { describe, expect, it, vi, afterEach } from "vitest";
import { toErrorResponse } from "@/lib/apiError";
import { UnauthorizedError } from "@/lib/auth";
import { NotProvisionedError } from "@/lib/studentContext";

describe("toErrorResponse: the chokepoint every unexpected route error passes through", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never forwards a raw exception message to the client on the generic 500 path", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const leaky = new Error("Cloudflare Worker deploy failed: 400 {\"errors\":[{\"message\":\"secret_text value eyJhbGciOi... rejected\"}]}");
    const res = toErrorResponse(leaky);
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error).toBe("internal error");
    expect(JSON.stringify(body)).not.toContain("secret_text");
    expect(JSON.stringify(body)).not.toContain("eyJhbGciOi");
  });

  it("still logs the full error server-side so it's debuggable", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("some internal detail");
    toErrorResponse(err);
    expect(spy).toHaveBeenCalledWith(err);
  });

  it("passes through UnauthorizedError as a plain 401 with no detail", async () => {
    const res = toErrorResponse(new UnauthorizedError());
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.error).toBe("unauthorized");
  });

  it("passes through NotProvisionedError's hand-authored, secret-free message as 409", async () => {
    const res = toErrorResponse(new NotProvisionedError());
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.error).toMatch(/Connect and finish provisioning/);
  });
});

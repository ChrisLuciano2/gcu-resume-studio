"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface ConnectionInfo {
  provider: "CLOUDFLARE";
  status: "NOT_CONNECTED" | "CONNECTING" | "CONNECTED" | "ERROR";
  method: "OAUTH" | "TOKEN";
  lastError: string | null;
}

interface Step {
  key: string;
  label: string;
  state: "pending" | "active" | "done" | "error";
}

// Functional recreation of the account-connect screen from Connect Accounts.dc.html
// — real polling against /api/provisioning/status, real OAuth tabs, real token
// fallback. One provider now (Cloudflare only — see PLAN.md for why Supabase was
// dropped in favor of Cloudflare D1). Visual system follows design-system.md's
// tokens; this pass didn't aim for pixel-parity with every animation in the
// prototype (see README.md).
export default function ConnectPage() {
  const router = useRouter();
  const [connection, setConnection] = useState<ConnectionInfo | undefined>();
  const [steps, setSteps] = useState<Step[]>([]);
  const [token, setToken] = useState("");
  const [tokenBusy, setTokenBusy] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  // Guards the auto-redirect below so it fires exactly once, the moment
  // status first flips to CONNECTED — not on every subsequent poll tick,
  // which would otherwise re-trigger router.push repeatedly.
  const redirectedRef = useRef(false);

  const poll = useCallback(async () => {
    const res = await fetch("/api/provisioning/status");
    if (!res.ok) return;
    const body = await res.json();
    const cf = (body.connections ?? []).find((c: ConnectionInfo) => c.provider === "CLOUDFLARE");
    setConnection(cf);
    setSteps(body.steps ?? []);

    // Auto-continue once provisioning finishes — previously this screen just
    // sat on "connected" forever until the student noticed and navigated
    // away themselves.
    if (cf?.status === "CONNECTED" && !redirectedRef.current) {
      redirectedRef.current = true;
      setTimeout(() => router.push("/editor"), 1200);
    }
  }, [router]);

  useEffect(() => {
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, [poll]);

  async function submitToken(e: React.FormEvent) {
    e.preventDefault();
    setTokenBusy(true);
    setTokenError(null);
    try {
      const res = await fetch("/api/connections/cloudflare/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "couldn't verify that token");
      poll();
    } catch (err) {
      setTokenError(err instanceof Error ? err.message : String(err));
    } finally {
      setTokenBusy(false);
    }
  }

  const status = connection?.status ?? "NOT_CONNECTED";

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "64px 40px 96px" }}>
      <div className="mono" style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-3)" }}>
        Setup · connect your account
      </div>
      <h1 style={{ fontSize: 40, lineHeight: 1.1, fontWeight: 600, letterSpacing: "-0.02em", margin: "16px 0 24px" }}>
        Connect your Cloudflare account
      </h1>
      <p style={{ maxWidth: "44ch", fontSize: 16, lineHeight: 1.6, color: "var(--ink-2)" }}>
        Your resume runs on infrastructure you own: a free Cloudflare account holds your data and
        runs your chatbot. No shared limits, no one else&rsquo;s traffic slowing you down — and
        nothing here requires a credit card.
      </p>

      {steps.length > 0 && (
        <div style={{ margin: "32px 0", display: "flex", flexDirection: "column", gap: 2, maxWidth: 480 }}>
          {steps.map((s) => (
            <div key={s.key} style={{ display: "flex", gap: 14, padding: "10px 0", borderBottom: "1px solid var(--surface-2)" }}>
              <span className="mono" style={{ fontSize: 12, color: stateColor(s.state), minWidth: 18 }}>
                {s.state === "done" ? "✓" : s.state === "error" ? "!" : "·"}
              </span>
              <div style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>{s.label}</div>
              <span className="mono" style={{ fontSize: 10, textTransform: "uppercase", color: stateColor(s.state) }}>
                {s.state}
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ maxWidth: 480, marginTop: 32 }}>
        <div style={{ border: `1px solid ${status === "CONNECTED" ? "var(--purple)" : "var(--line)"}`, borderRadius: 6, padding: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 20, fontWeight: 600 }}>Cloudflare</span>
            <div style={{ flex: 1 }} />
            <span
              className="mono"
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                padding: "4px 9px",
                borderRadius: 999,
                background: status === "CONNECTED" ? "var(--purple-tint)" : "var(--surface-2)",
                color: status === "CONNECTED" ? "var(--purple)" : status === "ERROR" ? "var(--danger)" : "var(--ink-3)",
              }}
            >
              {status.replace("_", " ").toLowerCase()}
            </span>
          </div>
          <p style={{ fontSize: 14, color: "var(--ink-2)", margin: "12px 0 0" }}>
            Where your resume data lives and what runs your chatbot.
          </p>
          {connection?.lastError && <p style={{ fontSize: 12, color: "var(--danger)", marginTop: 8 }}>{connection.lastError}</p>}
          {status === "CONNECTED" && (
            <p className="mono" style={{ fontSize: 12, color: "var(--purple)", marginTop: 12 }}>
              Taking you to your resume…
            </p>
          )}
          {status !== "CONNECTED" && (
            <button
              onClick={() => window.open("/api/connections/cloudflare/start", "_blank")}
              style={{
                marginTop: 20,
                fontSize: 14,
                fontWeight: 500,
                padding: "11px 18px",
                border: "1px solid var(--purple)",
                background: "var(--purple)",
                color: "var(--white)",
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              {/* Never disabled, even mid-"CONNECTING" — a provisioning step can crash
                  and leave status stuck here with no server-side timeout to clear it.
                  Retrying just re-runs the OAuth flow and the idempotent provisioning
                  steps; there's no unsafe double-submit to guard against, so blocking
                  the retry only traps the student with no way out short of a manual
                  DB fix. */}
              {status === "CONNECTING" ? "Reconnect…" : "Connect Cloudflare"}
            </button>
          )}
          {(!connection || status === "NOT_CONNECTED" || status === "ERROR") && (
            <form onSubmit={submitToken} style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
              <label className="mono" style={{ fontSize: 11, color: "var(--ink-2)" }}>
                or paste a scoped API token
              </label>
              <input
                type="text"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="needs Workers Scripts:Edit, Workers KV Storage:Edit, D1:Edit"
                className="mono"
                style={{ fontSize: 13, padding: "10px 12px", border: "1px solid var(--line-strong)", borderRadius: 6 }}
              />
              {tokenError && <p style={{ color: "var(--danger)", fontSize: 12, margin: 0 }}>{tokenError}</p>}
              <button
                type="submit"
                disabled={tokenBusy || !token}
                style={{ alignSelf: "flex-start", fontSize: 13, padding: "8px 14px", border: "1px solid var(--line)", background: "var(--white)", borderRadius: 4, cursor: "pointer" }}
              >
                {tokenBusy ? "Verifying…" : "Use this token"}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}

function stateColor(state: Step["state"]): string {
  if (state === "done") return "var(--purple)";
  if (state === "error") return "var(--danger)";
  if (state === "active") return "var(--ink-2)";
  return "var(--ink-3)";
}

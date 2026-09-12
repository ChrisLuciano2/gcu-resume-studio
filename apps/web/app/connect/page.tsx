"use client";

import { useCallback, useEffect, useState } from "react";

interface ConnectionInfo {
  provider: "SUPABASE" | "CLOUDFLARE";
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
// fallback. Visual system follows design-system.md's tokens; this pass didn't aim
// for pixel-parity with every animation in the prototype (see README.md).
export default function ConnectPage() {
  const [connections, setConnections] = useState<ConnectionInfo[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [token, setToken] = useState("");
  const [tokenBusy, setTokenBusy] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  const poll = useCallback(async () => {
    const res = await fetch("/api/provisioning/status");
    if (!res.ok) return;
    const body = await res.json();
    setConnections(body.connections ?? []);
    setSteps(body.steps ?? []);
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, [poll]);

  const supabase = connections.find((c) => c.provider === "SUPABASE");
  const cloudflare = connections.find((c) => c.provider === "CLOUDFLARE");

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

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "64px 40px 96px" }}>
      <div className="mono" style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-3)" }}>
        Setup · connect your two accounts
      </div>
      <h1 style={{ fontSize: 40, lineHeight: 1.1, fontWeight: 600, letterSpacing: "-0.02em", margin: "16px 0 24px" }}>
        Connect your two accounts
      </h1>
      <p style={{ maxWidth: "44ch", fontSize: 16, lineHeight: 1.6, color: "var(--ink-2)" }}>
        Your resume runs on infrastructure you own: a Supabase project for your data, a Cloudflare account for
        compute. No shared limits, no one else&rsquo;s traffic slowing you down.
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

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginTop: 32 }}>
        <ConnectionCard
          title="Supabase"
          description="Where your resume data lives."
          info={supabase}
          onConnect={() => window.open("/api/connections/supabase/start", "_blank")}
        />
        <ConnectionCard
          title="Cloudflare"
          description="What runs your chatbot."
          info={cloudflare}
          onConnect={() => window.open("/api/connections/cloudflare/start", "_blank")}
        >
          {(!cloudflare || cloudflare.status === "NOT_CONNECTED" || cloudflare.status === "ERROR") && (
            <form onSubmit={submitToken} style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
              <label className="mono" style={{ fontSize: 11, color: "var(--ink-2)" }}>
                or paste a scoped API token
              </label>
              <input
                type="text"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="needs Workers Scripts:Edit"
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
        </ConnectionCard>
      </div>
    </main>
  );
}

function ConnectionCard({
  title,
  description,
  info,
  onConnect,
  children,
}: {
  title: string;
  description: string;
  info?: ConnectionInfo;
  onConnect: () => void;
  children?: React.ReactNode;
}) {
  const status = info?.status ?? "NOT_CONNECTED";
  return (
    <div style={{ border: `1px solid ${status === "CONNECTED" ? "var(--purple)" : "var(--line)"}`, borderRadius: 6, padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 20, fontWeight: 600 }}>{title}</span>
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
      <p style={{ fontSize: 14, color: "var(--ink-2)", margin: "12px 0 0" }}>{description}</p>
      {info?.lastError && <p style={{ fontSize: 12, color: "var(--danger)", marginTop: 8 }}>{info.lastError}</p>}
      {status !== "CONNECTED" && (
        <button
          onClick={onConnect}
          style={{
            marginTop: 20,
            fontSize: 14,
            fontWeight: 500,
            padding: "11px 18px",
            border: "1px solid var(--purple)",
            background: status === "CONNECTING" ? "var(--surface)" : "var(--purple)",
            color: status === "CONNECTING" ? "var(--ink-3)" : "var(--white)",
            borderRadius: 4,
            cursor: "pointer",
          }}
          disabled={status === "CONNECTING"}
        >
          {status === "CONNECTING" ? "Connecting…" : `Connect ${title}`}
        </button>
      )}
      {children}
    </div>
  );
}

function stateColor(state: Step["state"]): string {
  if (state === "done") return "var(--purple)";
  if (state === "error") return "var(--danger)";
  if (state === "active") return "var(--ink-2)";
  return "var(--ink-3)";
}

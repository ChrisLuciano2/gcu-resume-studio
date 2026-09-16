"use client";

import { useEffect, useState } from "react";

interface ConnectionInfo {
  provider: "SUPABASE" | "CLOUDFLARE";
  status: "NOT_CONNECTED" | "CONNECTING" | "CONNECTED" | "ERROR";
  method: "OAUTH" | "TOKEN";
  lastError: string | null;
}

const LABELS: Record<ConnectionInfo["provider"], { name: string; detail: string }> = {
  SUPABASE: { name: "Supabase", detail: "Where your resume data lives." },
  CLOUDFLARE: { name: "Cloudflare", detail: "What runs your chatbot." },
};

export default function SettingsPage() {
  const [connections, setConnections] = useState<ConnectionInfo[]>([]);

  useEffect(() => {
    fetch("/api/provisioning/status")
      .then((r) => r.json())
      .then((body) => setConnections(body.connections ?? []));
  }, []);

  return (
    <div style={{ maxWidth: 720 }}>
      <h2 style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.015em", margin: 0 }}>Settings</h2>
      <p style={{ fontSize: 15, lineHeight: 1.55, color: "var(--ink-2)", margin: "12px 0 32px" }}>
        Your connected accounts. Reconnect here if a token is rotated or access is revoked.
      </p>
      <div className="mono" style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 12 }}>
        Connections
      </div>
      <div style={{ border: "1px solid var(--line)", borderRadius: 6, overflow: "hidden" }}>
        {connections.map((c) => {
          const meta = LABELS[c.provider];
          const connected = c.status === "CONNECTED";
          return (
            <div
              key={c.provider}
              style={{ display: "flex", alignItems: "center", gap: 16, padding: "18px 20px", borderBottom: "1px solid var(--surface-2)" }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 500 }}>{meta.name}</div>
                <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 4 }}>
                  {meta.detail} {c.method === "TOKEN" ? "(pasted token)" : ""}
                </div>
                {c.lastError && (
                  <div style={{ fontSize: 12, color: "var(--danger)", marginTop: 6 }}>{c.lastError}</div>
                )}
              </div>
              <div style={{ flex: 1 }} />
              <span
                className="mono"
                style={{
                  fontSize: 11,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  padding: "4px 9px",
                  borderRadius: 999,
                  background: connected ? "var(--purple-tint)" : "var(--surface-2)",
                  color: connected ? "var(--purple)" : c.status === "ERROR" ? "var(--danger)" : "var(--ink-3)",
                }}
              >
                {connected ? "Connected" : c.status.replace("_", " ").toLowerCase()}
              </span>
              <a
                href={c.provider === "SUPABASE" ? "/api/connections/supabase/start" : "/api/connections/cloudflare/start"}
                target="_blank"
                rel="noreferrer"
                className="mono"
                style={{
                  fontSize: 11,
                  padding: "6px 11px",
                  border: "1px solid var(--line)",
                  background: "var(--white)",
                  color: "var(--ink-2)",
                  borderRadius: 4,
                  textDecoration: "none",
                }}
              >
                Reconnect
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}

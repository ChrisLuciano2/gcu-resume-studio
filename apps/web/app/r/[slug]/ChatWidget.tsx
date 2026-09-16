"use client";

import { useState } from "react";

/**
 * Posts to the already-rate-limited public chat proxy (app/api/r/[slug]/chat,
 * which itself proxies to the student's own Worker's /chat — see
 * worker-template/src/index.js for the retrieval scoping and per-slug daily
 * budget). No auth, no per-viewer identity — this is intentionally the same
 * anonymous access model as the resume page itself.
 */
export function ChatWidget({ chatUrl }: { chatUrl: string }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setBusy(true);
    setError(null);
    setAnswer(null);
    try {
      const res = await fetch(chatUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const body = await res.json();
      if (!res.ok || body.ok === false) {
        throw new Error(body.message ?? body.error ?? "couldn't answer that right now");
      }
      setAnswer(body.answer);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 40, paddingTop: 24, borderTop: "1px solid var(--line)" }}>
      <h2 className="mono" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-3)", margin: "0 0 12px" }}>
        Ask about this resume
      </h2>
      <form onSubmit={ask} style={{ display: "flex", gap: 8 }}>
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. What EHR systems has she used?"
          style={{ flex: 1, fontSize: 14, padding: "10px 12px", border: "1px solid var(--line-strong)", borderRadius: 6 }}
        />
        <button
          type="submit"
          disabled={busy || !question.trim()}
          className="btn-primary"
          style={{ fontSize: 13, fontWeight: 500, padding: "10px 16px", border: "1px solid var(--purple)", background: "var(--purple)", color: "var(--white)", borderRadius: 4, cursor: "pointer" }}
        >
          {busy ? "Asking…" : "Ask"}
        </button>
      </form>
      {error && <p style={{ fontSize: 13, color: "var(--danger)", marginTop: 12 }}>{error}</p>}
      {answer && <p style={{ fontSize: 14, lineHeight: 1.6, marginTop: 16 }}>{answer}</p>}
    </div>
  );
}

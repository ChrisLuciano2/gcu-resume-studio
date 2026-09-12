"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Minimal auth screen — this pass is scoped to the backend (see README.md); the
// full "dev tool" visual system from design-system.md applies to /connect, the
// one screen recreated for end-to-end verification.
export default function HomePage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "something went wrong");
      router.push("/connect");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 360, margin: "96px auto", padding: "0 20px" }}>
      <div className="mono" style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-3)" }}>
        resume-studio
      </div>
      <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.015em", margin: "12px 0 24px" }}>
        {mode === "login" ? "Log in" : "Create your account"}
      </h1>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <input
          type="email"
          placeholder="you@gcu.edu"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={inputStyle}
        />
        <input
          type="password"
          placeholder="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          style={inputStyle}
        />
        {error && <p style={{ color: "var(--danger)", fontSize: 13, margin: 0 }}>{error}</p>}
        <button type="submit" disabled={busy} style={buttonStyle}>
          {busy ? "Working…" : mode === "login" ? "Log in" : "Sign up"}
        </button>
      </form>
      <button
        className="mono"
        onClick={() => setMode(mode === "login" ? "signup" : "login")}
        style={{ marginTop: 16, background: "none", border: "none", color: "var(--purple)", fontSize: 12, cursor: "pointer", padding: 0 }}
      >
        {mode === "login" ? "Need an account? Sign up" : "Already have an account? Log in"}
      </button>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  fontSize: 14,
  padding: "10px 12px",
  border: "1px solid var(--line-strong)",
  borderRadius: 6,
};

const buttonStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 500,
  padding: "11px 16px",
  border: "1px solid var(--purple)",
  background: "var(--purple)",
  color: "var(--white)",
  borderRadius: 4,
  cursor: "pointer",
};

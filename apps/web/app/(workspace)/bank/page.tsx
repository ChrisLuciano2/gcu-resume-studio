"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { DraftRow } from "@/lib/drafts";

type BankDraft = Pick<
  DraftRow,
  "id" | "name" | "category" | "niche" | "is_default" | "slug" | "source_updated_at" | "created_at" | "updated_at"
>;

// Resume bank — every saved draft, matching Connect Accounts.dc.html's card grid.
// "Stale" means the source resume changed after this draft's plan was locked in;
// per the design brief, that never auto-rewrites the draft, just surfaces a quiet
// indicator (source_updated_at vs. updated_at, compared client-side below).
export default function BankPage() {
  const router = useRouter();
  const [drafts, setDrafts] = useState<BankDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/drafts");
    if (!res.ok) {
      setError("Couldn't load your drafts.");
      return;
    }
    const body = await res.json();
    setDrafts(body.drafts);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function duplicate(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/drafts/${id}/duplicate`, { method: "POST" });
      if (!res.ok) throw new Error();
      await load();
    } catch {
      setError("Couldn't duplicate that draft.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/drafts/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      await load();
    } catch {
      setError("Couldn't delete that draft.");
    } finally {
      setBusyId(null);
    }
  }

  async function commitRename(id: string) {
    const name = renameValue.trim();
    setRenamingId(null);
    if (!name) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/drafts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error();
      await load();
    } catch {
      setError("Couldn't rename that draft.");
    } finally {
      setBusyId(null);
    }
  }

  function isStale(d: BankDraft): boolean {
    if (!d.source_updated_at) return false;
    return new Date(d.source_updated_at).getTime() > new Date(d.updated_at).getTime();
  }

  const staleCount = drafts?.filter(isStale).length ?? 0;

  return (
    <div>
      <h2 style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.015em", margin: 0 }}>Resume bank</h2>
      <p style={{ fontSize: 15, lineHeight: 1.55, color: "var(--ink-2)", margin: "12px 0 28px", maxWidth: "70ch" }}>
        Every saved draft, the field it was tailored for, and its own public link. Each draft keeps the rewrite it
        was saved with — nothing is regenerated behind your back.
      </p>

      {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}

      {drafts && (
        <p className="mono" style={{ fontSize: 11, color: "var(--ink-3)", marginBottom: 24 }}>
          {drafts.length} draft{drafts.length === 1 ? "" : "s"}
        </p>
      )}

      {staleCount > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 11,
            padding: "12px 15px",
            border: "1px solid var(--line)",
            background: "var(--surface)",
            borderRadius: 6,
            marginBottom: 20,
            maxWidth: 1080,
          }}
        >
          <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 999, background: "var(--ink-3)", flexShrink: 0 }} />
          <span style={{ fontSize: 14 }}>
            Your original resume changed after {staleCount} of these drafts were saved. They still read as you
            approved them — re-tailor whichever ones you want updated.
          </span>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(324px, 1fr))", gap: 16, maxWidth: 1080 }}>
        {drafts?.map((d) => {
          const stale = isStale(d);
          const publicUrl = typeof window !== "undefined" ? `${window.location.origin}/r/${d.slug}` : `/r/${d.slug}`;
          return (
            <div
              key={d.id}
              style={{
                border: "1px solid var(--line)",
                borderRadius: 6,
                padding: 20,
                display: "flex",
                flexDirection: "column",
                opacity: busyId === d.id ? 0.6 : 1,
              }}
            >
              {renamingId === d.id ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(d.id);
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    style={{ flex: 1, minWidth: 0, fontSize: 14, padding: "7px 9px", border: "1px solid var(--purple)", borderRadius: 4 }}
                  />
                  <button onClick={() => commitRename(d.id)} style={smallPrimaryBtn}>
                    save
                  </button>
                  <button onClick={() => setRenamingId(null)} style={smallGhostBtn}>
                    esc
                  </button>
                </div>
              ) : (
                <div style={{ fontSize: 16, fontWeight: 600 }}>{d.name}</div>
              )}

              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 9 }}>
                <span className="mono" style={pillStyle(!!d.category)}>
                  {d.category ?? "untailored"}
                </span>
                {d.niche && <span className="mono" style={outlinePillStyle}>{d.niche}</span>}
              </div>

              <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 12 }}>
                updated {new Date(d.updated_at).toLocaleDateString()}
              </div>

              {stale && (
                <div style={{ display: "flex", alignItems: "flex-start", gap: 9, marginTop: 12, padding: "10px 12px", background: "var(--surface)", borderRadius: 4 }}>
                  <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: 999, background: "var(--ink-3)", marginTop: 6, flexShrink: 0 }} />
                  <span className="mono" style={{ fontSize: 11, lineHeight: 1.55, color: "var(--ink-2)" }}>
                    Source updated since this plan was locked. Re-tailor to pick up the change.
                  </span>
                </div>
              )}

              <div
                className="mono"
                style={{ marginTop: 16, padding: "10px 12px", background: "var(--surface)", borderRadius: 4, fontSize: 11, color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {publicUrl}
              </div>

              <div style={{ flex: 1 }} />
              <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <button onClick={() => router.push(`/editor?draft=${d.id}`)} style={outlineBtn}>
                  Open in editor
                </button>
                <button
                  onClick={() => {
                    setRenamingId(d.id);
                    setRenameValue(d.name);
                  }}
                  style={smallGhostBtn}
                >
                  rename
                </button>
                <button onClick={() => duplicate(d.id)} style={smallGhostBtn}>
                  duplicate
                </button>
                <div style={{ flex: 1 }} />
                {d.is_default ? (
                  <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>
                    can&rsquo;t be deleted
                  </span>
                ) : (
                  <button onClick={() => remove(d.id)} style={smallDangerBtn}>
                    delete
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mono" style={{ fontSize: 11, lineHeight: 1.6, color: "var(--ink-3)", marginTop: 24 }}>
        The default draft is created automatically on upload and always stays untailored. New drafts come from
        tailoring in the editor.
      </p>
    </div>
  );
}

function pillStyle(tailored: boolean): React.CSSProperties {
  return {
    fontSize: 10,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    padding: "3px 8px",
    borderRadius: 999,
    background: tailored ? "var(--purple-tint)" : "var(--surface-2)",
    color: tailored ? "var(--purple)" : "var(--ink-3)",
  };
}

const outlinePillStyle: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  padding: "3px 8px",
  borderRadius: 999,
  border: "1px solid #DCCDF4",
  color: "var(--purple)",
};

const outlineBtn: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  padding: "8px 13px",
  border: "1px solid var(--line-strong)",
  background: "var(--white)",
  color: "var(--black)",
  borderRadius: 4,
  cursor: "pointer",
};

const smallGhostBtn: React.CSSProperties = {
  fontSize: 11,
  padding: "8px 11px",
  border: "1px solid var(--line)",
  background: "var(--white)",
  color: "var(--ink-2)",
  borderRadius: 4,
  cursor: "pointer",
};

const smallPrimaryBtn: React.CSSProperties = {
  fontSize: 11,
  padding: "7px 9px",
  border: "1px solid var(--purple)",
  background: "var(--purple)",
  color: "var(--white)",
  borderRadius: 4,
  cursor: "pointer",
};

const smallDangerBtn: React.CSSProperties = {
  fontSize: 11,
  padding: "8px 11px",
  border: "1px solid var(--line)",
  background: "var(--white)",
  color: "var(--ink-3)",
  borderRadius: 4,
  cursor: "pointer",
};

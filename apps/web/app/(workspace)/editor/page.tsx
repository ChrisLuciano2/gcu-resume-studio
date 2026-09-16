"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { JOB_CATEGORIES, type JobCategory } from "@/lib/jobFields";
import type { DraftPlan, DraftRow } from "@/lib/drafts";

type DraftSummary = Pick<DraftRow, "id" | "name" | "category" | "niche" | "is_default">;

interface DragPayload {
  category: string;
  niche?: string;
  label: string;
}

// useSearchParams() opts a page out of static prerendering unless it's wrapped in
// its own Suspense boundary — without this, `next build` fails on this route.
export default function EditorPage() {
  return (
    <Suspense fallback={<p className="mono" style={{ color: "var(--ink-3)" }}>Loading…</p>}>
      <EditorPageInner />
    </Suspense>
  );
}

function EditorPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedDraftId = searchParams.get("draft");

  const [drafts, setDrafts] = useState<DraftSummary[] | null>(null);
  const [draft, setDraft] = useState<DraftRow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openCategories, setOpenCategories] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const [rewriting, setRewriting] = useState(false);
  const [rewriteError, setRewriteError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<{ plan: DraftPlan; category: string; niche?: string; label: string } | null>(null);
  const [editingChunkId, setEditingChunkId] = useState<string | null>(null);
  const [editBuffer, setEditBuffer] = useState<{ bullets: string[]; tags: string }>({ bullets: [], tags: "" });
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadDraftList = useCallback(async (): Promise<DraftSummary[]> => {
    const res = await fetch("/api/drafts");
    if (!res.ok) {
      setLoadError("Couldn't load your drafts.");
      return [];
    }
    const body = await res.json();
    setDrafts(body.drafts);
    return body.drafts;
  }, []);

  const loadDraft = useCallback(async (id: string) => {
    const res = await fetch(`/api/drafts/${id}`);
    if (!res.ok) {
      setLoadError("Couldn't load that draft.");
      return;
    }
    const body = await res.json();
    setDraft(body.draft);
  }, []);

  useEffect(() => {
    (async () => {
      const list = await loadDraftList();
      const target = requestedDraftId ?? list.find((d) => d.is_default)?.id ?? list[0]?.id;
      if (target) await loadDraft(target);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedDraftId]);

  async function handleUpload(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch("/api/resumes/ingest", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "upload failed");
      await loadDraftList();
      await loadDraft(body.draft.id);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  async function performTailor(payload: DragPayload) {
    if (!draft || rewriting) return;
    setRewriting(true);
    setRewriteError(null);
    setProposal(null);
    try {
      const res = await fetch(`/api/drafts/${draft.id}/tailor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetField: payload.niche ?? payload.label }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setRewriteError(body.message ?? "The rewrite didn't finish in time — try again.");
        return;
      }
      setProposal({ plan: body.proposedPlan, category: payload.category, niche: payload.niche, label: payload.label });
    } catch {
      setRewriteError("Couldn't reach the rewrite service — try again.");
    } finally {
      setRewriting(false);
    }
  }

  async function commitProposal(mode: "new" | "apply") {
    if (!draft || !proposal) return;
    const res = await fetch(`/api/drafts/${draft.id}/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode,
        plan: proposal.plan,
        category: proposal.category,
        niche: proposal.niche,
        name: mode === "new" ? `${draft.name} — ${proposal.label}` : undefined,
      }),
    });
    const body = await res.json();
    if (!res.ok || !body.ok) {
      setRewriteError("Couldn't save that — try again.");
      return;
    }
    setProposal(null);
    await loadDraftList();
    if (mode === "new") {
      router.push(`/editor?draft=${body.draft.id}`);
    } else {
      await loadDraft(draft.id);
    }
  }

  function startEditChunk(sectionIdx: number, chunkIdx: number) {
    if (!draft) return;
    const chunk = draft.plan.sections[sectionIdx]!.chunks[chunkIdx]!;
    setEditingChunkId(chunk.id);
    setEditBuffer({ bullets: chunk.bullets.length ? chunk.bullets : [""], tags: chunk.tags.join(", ") });
  }

  async function saveHandEdit(sectionIdx: number, chunkIdx: number) {
    if (!draft) return;
    const nextPlan: DraftPlan = {
      sections: draft.plan.sections.map((s, si) => ({
        ...s,
        chunks: s.chunks.map((c, ci) =>
          si === sectionIdx && ci === chunkIdx
            ? {
                ...c,
                bullets: editBuffer.bullets.map((b) => b.trim()).filter(Boolean),
                tags: editBuffer.tags
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean),
              }
            : c,
        ),
      })),
    };
    const res = await fetch(`/api/drafts/${draft.id}/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "apply", plan: nextPlan }),
    });
    if (res.ok) {
      setEditingChunkId(null);
      await loadDraft(draft.id);
    }
  }

  function toggleCategory(id: string) {
    setOpenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onDragStart(e: React.DragEvent, payload: DragPayload) {
    e.dataTransfer.setData("application/json", JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "copy";
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const raw = e.dataTransfer.getData("application/json");
    if (!raw) return;
    performTailor(JSON.parse(raw));
  }

  if (loadError) return <p style={{ color: "var(--danger)" }}>{loadError}</p>;

  if (drafts && drafts.length === 0) {
    return <UploadGate uploading={uploading} error={uploadError} onUpload={handleUpload} fileInputRef={fileInputRef} />;
  }

  if (!draft) return <p className="mono" style={{ color: "var(--ink-3)" }}>Loading…</p>;

  return (
    <div>
      <h2 style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.015em", margin: 0 }}>Resume editor</h2>
      <p style={{ fontSize: 15, lineHeight: 1.55, color: "var(--ink-2)", margin: "12px 0 32px" }}>
        Drag a job field onto your resume to tailor it, or click one. The rewrite runs on your own Workers AI quota.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "clamp(16px, 2vw, 28px)", alignItems: "flex-start" }}>
        {/* Job fields sidebar */}
        <div
          style={{
            flex: "0 1 248px",
            minWidth: 212,
            maxWidth: 288,
            border: "1px solid var(--line)",
            borderRadius: 6,
            display: "flex",
            flexDirection: "column",
            maxHeight: "calc(100vh - 160px)",
          }}
        >
          <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid var(--surface-2)" }}>
            <div className="mono" style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-3)" }}>
              Job fields
            </div>
            <p className="mono" style={{ fontSize: 10, lineHeight: 1.6, color: "var(--ink-3)", margin: "8px 0 0" }}>
              Drag a category, or open it and drag a specific field.
            </p>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 10 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {JOB_CATEGORIES.map((cat) => (
                <CategoryRow
                  key={cat.id}
                  category={cat}
                  open={openCategories.has(cat.id)}
                  onToggle={() => toggleCategory(cat.id)}
                  onDragStart={onDragStart}
                  onClickField={(payload) => performTailor(payload)}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Resume + review */}
        <div style={{ flex: "1 1 340px", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
            <span className="mono" style={{ fontSize: 11, letterSpacing: "0.06em" }}>
              {draft.name}
            </span>
            <span
              className="mono"
              style={{
                fontSize: 10,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                padding: "3px 8px",
                borderRadius: 999,
                background: draft.category ? "var(--purple-tint)" : "var(--surface-2)",
                color: draft.category ? "var(--purple)" : "var(--ink-3)",
              }}
            >
              {draft.category ?? "untailored"}
            </span>
            <div style={{ flex: 1 }} />
            {rewriting && (
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  fontSize: 11,
                  color: "var(--purple)",
                  padding: "5px 10px",
                  border: "1px solid #DCCDF4",
                  background: "var(--purple-tint)",
                  borderRadius: 999,
                }}
                className="mono"
              >
                <TypingDots />
                <span>Rewriting…</span>
              </span>
            )}
          </div>

          {rewriteError && (
            <p style={{ color: "var(--danger)", fontSize: 13, marginBottom: 12 }}>{rewriteError}</p>
          )}

          {proposal && (
            <div style={{ border: "1px solid #DCCDF4", background: "var(--purple-tint)", borderRadius: 6, padding: "18px 20px", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span style={{ fontSize: 15, fontWeight: 500 }}>Rewritten for {proposal.label}</span>
              </div>
              <p style={{ fontSize: 14, lineHeight: 1.55, color: "var(--ink-2)", margin: "10px 0 0", maxWidth: "62ch" }}>
                Sections were reordered and language re-emphasized. Nothing was invented or removed. Where do you
                want this?
              </p>
              <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <button onClick={() => commitProposal("new")} style={primaryBtn}>
                  Save as new draft
                </button>
                <button onClick={() => commitProposal("apply")} style={outlineBtn}>
                  Apply to this draft
                </button>
                <button onClick={() => setProposal(null)} style={textBtn}>
                  discard
                </button>
                <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
                  Asked every time, so nothing overwrites silently.
                </span>
              </div>
            </div>
          )}

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            style={{
              border: `1px solid ${dragOver ? "var(--purple)" : "var(--line)"}`,
              background: dragOver ? "var(--purple-tint)" : "var(--white)",
              borderRadius: 6,
              padding: "clamp(24px, 4vw, 48px) clamp(20px, 4vw, 56px)",
              transition: "all 180ms cubic-bezier(.2,.6,.2,1)",
            }}
          >
            <div style={{ paddingBottom: 22, borderBottom: "1px solid var(--black)" }}>
              <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-0.02em" }}>{draft.name}</div>
            </div>
            {draft.plan.sections.map((section, sectionIdx) => (
              <div key={section.section} style={{ padding: "24px 0", borderBottom: "1px solid var(--surface-2)" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span className="mono" style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-3)" }}>
                    {section.section}
                  </span>
                </div>
                <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 20 }}>
                  {section.chunks.map((chunk, chunkIdx) => (
                    <div key={chunk.id} style={{ position: "relative", margin: "-6px -10px", padding: "6px 10px", borderRadius: 4 }}>
                      {editingChunkId === chunk.id ? (
                        <div style={{ padding: 14, border: "1px solid var(--purple)", borderRadius: 6 }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {editBuffer.bullets.map((b, bi) => (
                              <textarea
                                key={bi}
                                value={b}
                                onChange={(e) =>
                                  setEditBuffer((prev) => ({
                                    ...prev,
                                    bullets: prev.bullets.map((x, i) => (i === bi ? e.target.value : x)),
                                  }))
                                }
                                rows={3}
                                style={{ width: "100%", fontSize: 14, lineHeight: 1.6, padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 4, resize: "vertical" }}
                              />
                            ))}
                            <div>
                              <label className="mono" style={{ display: "block", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 6 }}>
                                Skills · comma separated
                              </label>
                              <textarea
                                value={editBuffer.tags}
                                onChange={(e) => setEditBuffer((prev) => ({ ...prev, tags: e.target.value }))}
                                rows={2}
                                className="mono"
                                style={{ width: "100%", fontSize: 12, lineHeight: 1.6, padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 4, resize: "vertical" }}
                              />
                            </div>
                          </div>
                          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <button onClick={() => saveHandEdit(sectionIdx, chunkIdx)} style={primaryBtn}>
                              Save
                            </button>
                            <button onClick={() => setEditingChunkId(null)} style={outlineBtn}>
                              cancel
                            </button>
                            <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>
                              No AI — saves straight to this draft.
                            </span>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              {chunk.heading && <div style={{ fontSize: 16, fontWeight: 600 }}>{chunk.heading}</div>}
                              {chunk.meta && (
                                <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 5 }}>
                                  {chunk.meta}
                                </div>
                              )}
                            </div>
                            <button onClick={() => startEditChunk(sectionIdx, chunkIdx)} title="Edit this text by hand" style={editBtn}>
                              edit
                            </button>
                          </div>
                          {chunk.bullets.length > 0 && (
                            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 7 }}>
                              {chunk.bullets.map((b, i) => (
                                <div key={i} style={{ display: "flex", gap: 10, fontSize: 14, lineHeight: 1.6 }}>
                                  <span style={{ color: "var(--line-strong)" }}>—</span>
                                  <span>{b}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {chunk.tags.length > 0 && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: chunk.bullets.length ? 10 : 0 }}>
                              {chunk.tags.map((t) => (
                                <span key={t} className="mono" style={{ fontSize: 11, padding: "5px 9px", border: "1px solid var(--line)", borderRadius: 4 }}>
                                  {t}
                                </span>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function CategoryRow({
  category,
  open,
  onToggle,
  onDragStart,
  onClickField,
}: {
  category: JobCategory;
  open: boolean;
  onToggle: () => void;
  onDragStart: (e: React.DragEvent, payload: DragPayload) => void;
  onClickField: (payload: DragPayload) => void;
}) {
  const payload: DragPayload = { category: category.label, label: category.label };
  return (
    <div>
      <div style={{ display: "flex", alignItems: "stretch", gap: 4 }}>
        <div
          draggable
          onDragStart={(e) => onDragStart(e, payload)}
          onClick={() => onClickField(payload)}
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "9px 10px",
            border: "1px solid var(--line)",
            borderRadius: 4,
            background: category.comingSoon ? "var(--surface)" : "var(--white)",
            fontSize: 13,
            fontWeight: 500,
            cursor: "grab",
          }}
        >
          <span style={{ display: "inline-block", width: 3, height: 14, background: "var(--line-strong)", borderRadius: 2, flexShrink: 0 }} />
          <span>{category.label}</span>
          {category.comingSoon && (
            <span className="mono" style={{ fontSize: 9, color: "var(--ink-3)", marginLeft: "auto" }}>
              soon
            </span>
          )}
        </div>
        <button
          onClick={onToggle}
          style={{
            flex: "0 0 34px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 1,
            border: "1px solid var(--line)",
            borderRadius: 4,
            background: "var(--white)",
            color: "var(--ink-3)",
            cursor: "pointer",
          }}
          className="mono"
        >
          <span style={{ fontSize: 12, lineHeight: 1 }}>{open ? "−" : "+"}</span>
          <span style={{ fontSize: 9, lineHeight: 1 }}>{category.items.length}</span>
        </button>
      </div>
      {open && (
        <div style={{ margin: "4px 0 8px 11px", paddingLeft: 11, borderLeft: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 1 }}>
          {category.items.map((field) => {
            const fieldPayload: DragPayload = { category: category.label, niche: field.label, label: field.label };
            return (
              <div
                key={field.id}
                draggable
                onDragStart={(e) => onDragStart(e, fieldPayload)}
                onClick={() => onClickField(fieldPayload)}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 4, fontSize: 12.5, lineHeight: 1.4, cursor: "grab" }}
              >
                <span style={{ display: "inline-block", width: 4, height: 4, borderRadius: 999, background: "var(--line-strong)", flexShrink: 0 }} />
                <span>{field.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TypingDots() {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
      {[0, 0.18, 0.36].map((delay, i) => (
        <span
          key={i}
          style={{
            display: "inline-block",
            width: 4,
            height: 4,
            borderRadius: 999,
            background: "var(--purple)",
            animation: `typing 1.1s ease-in-out ${delay}s infinite`,
          }}
        />
      ))}
      <style>{`@keyframes typing { 0%,100% { opacity: .25; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-2px); } }`}</style>
    </span>
  );
}

function UploadGate({
  uploading,
  error,
  onUpload,
  fileInputRef,
}: {
  uploading: boolean;
  error: string | null;
  onUpload: (file: File) => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
}) {
  return (
    <div style={{ maxWidth: 480 }}>
      <h2 style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.015em", margin: 0 }}>Upload your resume</h2>
      <p style={{ fontSize: 15, lineHeight: 1.55, color: "var(--ink-2)", margin: "12px 0 28px" }}>
        We&rsquo;ll chunk it into sections and create your default draft automatically — no tailoring needed yet.
      </p>
      <div
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: "1px dashed var(--line-strong)",
          borderRadius: 6,
          padding: 40,
          textAlign: "center",
          cursor: "pointer",
          background: "var(--surface)",
        }}
      >
        <p className="mono" style={{ fontSize: 12, color: "var(--ink-2)", margin: 0 }}>
          {uploading ? "Uploading…" : "Click to choose a PDF, DOCX, or TXT file"}
        </p>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.txt"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUpload(file);
        }}
      />
      {error && <p style={{ color: "var(--danger)", fontSize: 13, marginTop: 12 }}>{error}</p>}
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 500,
  padding: "10px 16px",
  border: "1px solid var(--purple)",
  background: "var(--purple)",
  color: "var(--white)",
  borderRadius: 4,
  cursor: "pointer",
};

const outlineBtn: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 500,
  padding: "10px 16px",
  border: "1px solid var(--line-strong)",
  background: "var(--white)",
  color: "var(--black)",
  borderRadius: 4,
  cursor: "pointer",
};

const textBtn: React.CSSProperties = {
  fontSize: 11,
  padding: "9px 12px",
  border: "none",
  background: "none",
  color: "var(--ink-3)",
  cursor: "pointer",
};

const editBtn: React.CSSProperties = {
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "5px 8px",
  border: "1px solid var(--line)",
  background: "var(--white)",
  color: "var(--ink-3)",
  borderRadius: 4,
  cursor: "pointer",
  fontFamily: "ui-monospace, monospace",
  fontSize: 10,
  letterSpacing: "0.06em",
};

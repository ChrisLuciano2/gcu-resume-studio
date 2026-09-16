import { notFound } from "next/navigation";
import { getPublicDraftBySlug } from "@/lib/publicDraft";
import { ChatWidget } from "./ChatWidget";
import { PrintButton } from "./PrintButton";

// Public, no-auth resume page a student shares as their recruiter-facing link.
// Server-rendered directly from lib/publicDraft.ts's shared lookup (also used
// by app/api/r/[slug]/route.ts, so there's exactly one implementation of "what
// a recruiter link resolves to" and this page pays no extra internal HTTP
// round-trip to get there). Print/PDF is the browser's own native
// print-to-PDF (see the `.print-hide`/`@media print` rules in globals.css) —
// deliberately not a server-rendered PDF pipeline, to avoid adding a
// maintenance-heavy dependency to a project nobody will be maintaining.
export default async function PublicResumePage({ params }: { params: { slug: string } }) {
  const result = await getPublicDraftBySlug(params.slug);
  if (!result) notFound();

  const { draft, chatUrl } = result;

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 40px 96px" }}>
      <div className="print-hide" style={{ display: "flex", justifyContent: "flex-end", marginBottom: 24 }}>
        <PrintButton />
      </div>

      <header style={{ marginBottom: 32, borderBottom: "1px solid var(--line)", paddingBottom: 20 }}>
        <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.01em", margin: 0 }}>{draft.name}</h1>
        {(draft.category || draft.niche) && (
          <p className="mono" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-3)", margin: "8px 0 0" }}>
            {[draft.category, draft.niche].filter(Boolean).join(" · ")}
          </p>
        )}
      </header>

      {draft.plan.sections.map((section) => (
        <section key={section.section} style={{ marginBottom: 28 }}>
          <h2 className="mono" style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--purple)", margin: "0 0 14px" }}>
            {section.section}
          </h2>
          {section.chunks.map((chunk, chunkIndex) => (
            // Keyed by index + id, not id alone: a tailored plan can legitimately
            // contain two chunks sharing an id — the tailoring LLM sometimes splits
            // one input chunk's bullets across two output entries while preserving
            // the original id on both (confirmed live 2026-09-16). That's a
            // pre-existing property of /tailor's output, not a bug introduced here.
            <div key={`${chunk.id}-${chunkIndex}`} style={{ marginBottom: 18 }}>
              {chunk.heading && <div style={{ fontSize: 16, fontWeight: 600 }}>{chunk.heading}</div>}
              {chunk.meta && <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 2 }}>{chunk.meta}</div>}
              {chunk.bullets.length > 0 && (
                <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
                  {chunk.bullets.map((b, i) => (
                    <li key={i} style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 4 }}>
                      {b}
                    </li>
                  ))}
                </ul>
              )}
              {chunk.tags.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: chunk.bullets.length ? 10 : 6 }}>
                  {chunk.tags.map((t) => (
                    <span
                      key={t}
                      style={{ fontSize: 11, padding: "3px 9px", borderRadius: 999, background: "var(--surface-2)", color: "var(--ink-2)" }}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </section>
      ))}

      <div className="print-hide">
        <ChatWidget chatUrl={chatUrl} />
      </div>
    </main>
  );
}

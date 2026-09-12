import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { toErrorResponse } from "@/lib/apiError";
import { getStudentContext } from "@/lib/studentContext";
import { extractText } from "@/lib/textExtract";
import { chunkResumeText } from "@/lib/chunking";
import { embedTexts } from "@/lib/workerClient";
import { createDraft } from "@/lib/drafts";
import { studentRest, withReturnRepresentation } from "@/lib/studentSupabase";

/**
 * Generic across any resume format/major: extract text, chunk it, embed each
 * chunk via the student's own Worker, store chunks + embeddings in the student's
 * own Supabase, and auto-create the default (untailored) draft — the one every
 * student gets with zero effort. This is the route most likely to run before any
 * tailoring handler ever does, so it's also responsible for its own
 * PublicDraftIndex entry (via lib/drafts.ts's createDraft) — see PLAN.md.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const ctx = await getStudentContext(userId);

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "a file is required" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const rawText = await extractText(buffer, file.type, file.name);
    if (!rawText.trim()) {
      return NextResponse.json({ error: "couldn't extract any text from that file" }, { status: 422 });
    }

    const chunks = chunkResumeText(rawText);
    if (chunks.length === 0) {
      return NextResponse.json({ error: "couldn't find any content to chunk in that resume" }, { status: 422 });
    }

    const embedResult = await embedTexts(
      ctx.workerUrl,
      chunks.map((c) => [c.heading, c.meta, ...c.bullets, ...c.tags].filter(Boolean).join(" — ")),
    );
    if (!embedResult.ok || !embedResult.embeddings) {
      return NextResponse.json(
        { error: `embedding failed (${embedResult.reason ?? "unknown"}) — try again in a moment` },
        { status: 502 },
      );
    }

    const [resumeRow] = await studentRest<Array<{ id: string }>>(
      ctx.supabase,
      "resumes",
      withReturnRepresentation({ method: "POST", body: JSON.stringify({ raw_text: rawText }) }),
    );
    if (!resumeRow) throw new Error("Supabase did not return the created resume row");

    const chunkRows = chunks.map((c, i) => ({
      resume_id: resumeRow.id,
      section: c.section,
      position: c.position,
      heading: c.heading ?? null,
      meta: c.meta ?? null,
      bullets: c.bullets,
      tags: c.tags,
      embedding: embedResult.embeddings![i],
    }));
    const insertedChunks = await studentRest<Array<{ id: string; section: string; heading: string | null; meta: string | null; bullets: string[]; tags: string[] }>>(
      ctx.supabase,
      "resume_chunks",
      withReturnRepresentation({ method: "POST", body: JSON.stringify(chunkRows) }),
    );

    const sections = groupBySection(insertedChunks);
    const draft = await createDraft(userId, ctx.supabase, ctx.workerUrl, {
      name: "Default resume",
      isDefault: true,
      plan: { sections },
      sourceUpdatedAt: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true, resumeId: resumeRow.id, draft });
  } catch (err) {
    return toErrorResponse(err);
  }
}

function groupBySection(
  chunks: Array<{ id: string; section: string; heading: string | null; meta: string | null; bullets: string[]; tags: string[] }>,
) {
  const order: string[] = [];
  const bySection = new Map<string, typeof chunks>();
  for (const c of chunks) {
    if (!bySection.has(c.section)) {
      bySection.set(c.section, []);
      order.push(c.section);
    }
    bySection.get(c.section)!.push(c);
  }
  return order.map((section) => ({
    section,
    chunks: bySection.get(section)!.map((c) => ({
      id: c.id,
      heading: c.heading ?? undefined,
      meta: c.meta ?? undefined,
      bullets: c.bullets,
      tags: c.tags,
    })),
  }));
}

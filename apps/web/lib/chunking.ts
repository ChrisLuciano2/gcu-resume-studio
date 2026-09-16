// Generic resume chunking: section-boundary detection by common heading patterns,
// with a paragraph-level fallback when no headings are recognized. Deliberately
// has no field/major-specific logic — the same heuristic runs for every resume
// regardless of degree.

export interface ResumeChunk {
  section: string;
  position: number;
  heading?: string;
  meta?: string;
  bullets: string[];
  tags: string[];
}

// Common resume section names across fields — this is a vocabulary of *document
// structure* (every resume has some notion of experience/education/skills),
// not a vocabulary of any particular major or job field.
const SECTION_HEADING_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "Summary", pattern: /^(summary|professional summary|objective|profile)$/i },
  { name: "Experience", pattern: /^(experience|work experience|professional experience|employment( history)?)$/i },
  { name: "Projects", pattern: /^(projects|personal projects|academic projects)$/i },
  { name: "Skills", pattern: /^(skills|technical skills|core competencies|skills\s*&\s*tools)$/i },
  { name: "Education", pattern: /^(education|academic background)$/i },
  { name: "Certifications", pattern: /^(certifications?|licenses?( and certifications)?)$/i },
  { name: "Awards", pattern: /^(awards?|honors?( and awards)?)$/i },
  { name: "Publications", pattern: /^(publications?)$/i },
  { name: "Leadership", pattern: /^(leadership|activities|volunteer( experience)?)$/i },
  { name: "Languages", pattern: /^(languages?)$/i },
];

const BULLET_PREFIX = /^[•\-*•●]\s*/;
const DATE_RANGE_HINT = /\b(19|20)\d{2}\b/;

function matchSectionHeading(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 40) return null;
  for (const { name, pattern } of SECTION_HEADING_PATTERNS) {
    if (pattern.test(trimmed)) return name;
  }
  return null;
}

/**
 * Returns the raw lines before the first recognized section heading — where a
 * resume's name/contact block lives, and which `chunkResumeText` otherwise
 * discards entirely (`splitIntoSections` never starts capturing until the
 * first heading matches). Needed for cover-letter generation, which has
 * nowhere else to get the candidate's name to sign off with. Returns
 * `undefined` rather than the whole document when no heading is found
 * anywhere — that's exactly when `chunkResumeText` falls back to treating
 * every line as content already, so capturing the same text again as
 * "header" would just duplicate it into the cover-letter prompt for no
 * reason — and `undefined` when the very first line is already a heading
 * (no preamble to capture).
 */
export function extractResumeHeader(rawText: string): string | undefined {
  const lines = rawText
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim());

  const preamble: string[] = [];
  let foundHeading = false;
  for (const line of lines) {
    if (matchSectionHeading(line)) {
      foundHeading = true;
      break;
    }
    if (line) preamble.push(line);
  }

  if (!foundHeading || preamble.length === 0) return undefined;
  return preamble.join("\n");
}

export function chunkResumeText(rawText: string): ResumeChunk[] {
  const lines = rawText
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim());

  const sections = splitIntoSections(lines);
  if (sections.length === 0) {
    return chunkAsFallback(lines);
  }

  const chunks: ResumeChunk[] = [];
  let position = 0;
  for (const section of sections) {
    for (const block of splitIntoBlocks(section.lines)) {
      const chunk = blockToChunk(section.name, position, block);
      if (chunk) {
        chunks.push(chunk);
        position += 1;
      }
    }
  }

  // A resume with recognizable headings but literally no content under them
  // (e.g. only a heading line was found) still falls back, rather than
  // returning an empty chunk set.
  return chunks.length > 0 ? chunks : chunkAsFallback(lines);
}

function splitIntoSections(lines: string[]): Array<{ name: string; lines: string[] }> {
  const sections: Array<{ name: string; lines: string[] }> = [];
  let current: { name: string; lines: string[] } | null = null;

  for (const line of lines) {
    const heading = matchSectionHeading(line);
    if (heading) {
      current = { name: heading, lines: [] };
      sections.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }

  return sections;
}

/** Splits a section's lines into blank-line-delimited blocks (one block per role/entry). */
function splitIntoBlocks(lines: string[]): string[][] {
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line === "") {
      if (current.length > 0) blocks.push(current);
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) blocks.push(current);
  return blocks;
}

function blockToChunk(section: string, position: number, block: string[]): ResumeChunk | null {
  if (block.length === 0) return null;

  const bulletLines = block.filter((l) => BULLET_PREFIX.test(l));
  const nonBulletLines = block.filter((l) => !BULLET_PREFIX.test(l));

  // Skills-style sections are usually comma/pipe-separated tag lists, not bullets.
  if (section === "Skills" && bulletLines.length === 0) {
    const tags = block
      .join(", ")
      .split(/[,|•]/)
      .map((t) => t.trim())
      .filter(Boolean);
    return { section, position, bullets: [], tags };
  }

  const heading = nonBulletLines[0];
  const metaCandidate = nonBulletLines[1];
  const meta = metaCandidate && DATE_RANGE_HINT.test(metaCandidate) ? metaCandidate : undefined;

  const bullets =
    bulletLines.length > 0
      ? bulletLines.map((l) => l.replace(BULLET_PREFIX, "").trim())
      : nonBulletLines.slice(meta ? 2 : 1);

  return {
    section,
    position,
    heading,
    meta,
    bullets: bullets.filter(Boolean),
    tags: [],
  };
}

/** Used when no recognizable section headings exist — still generic, just paragraph-based. */
function chunkAsFallback(lines: string[]): ResumeChunk[] {
  const blocks = splitIntoBlocks(lines);
  return blocks
    .map((block, i) => blockToChunk("General", i, block))
    .filter((c): c is ResumeChunk => c !== null);
}

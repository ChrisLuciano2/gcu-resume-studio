import { describe, expect, it } from "vitest";
import { chunkResumeText, extractResumeHeader } from "@/lib/chunking";

const RESUME_WITH_HEADINGS = `
Jane Doe
Registered Nurse

Summary
Compassionate RN with 5 years of pediatric experience.

Experience
RN, Mercy Children's Hospital
Jun 2020 - Present
- Led triage for a 20-bed pediatric unit
- Trained 6 incoming nurses on EHR workflows

RN, City General
2018 - 2020
- Managed medication administration for 40+ patients daily

Education
BSN, Grand Canyon University
2014 - 2018

Skills
EHR systems, IV insertion, patient triage, Epic, Cerner
`;

const RESUME_WITHOUT_HEADINGS = `
Jane Doe, Registered Nurse

Worked at Mercy Children's Hospital from 2020 to present leading triage for a
pediatric unit and training incoming nurses on EHR workflows.

Earned a BSN from Grand Canyon University in 2018.
`;

describe("chunkResumeText: generic, no field-specific logic", () => {
  it("splits a resume with clear section headings into the right sections", () => {
    const chunks = chunkResumeText(RESUME_WITH_HEADINGS);
    const sections = [...new Set(chunks.map((c) => c.section))];
    expect(sections).toEqual(expect.arrayContaining(["Summary", "Experience", "Education", "Skills"]));
  });

  it("captures bullets and role/date meta under Experience", () => {
    const chunks = chunkResumeText(RESUME_WITH_HEADINGS);
    const experience = chunks.filter((c) => c.section === "Experience");
    expect(experience.length).toBe(2);
    expect(experience[0]!.heading).toContain("Mercy");
    expect(experience[0]!.bullets).toEqual(
      expect.arrayContaining([expect.stringContaining("triage"), expect.stringContaining("EHR")]),
    );
  });

  it("treats Skills as a tag list, not bullets", () => {
    const chunks = chunkResumeText(RESUME_WITH_HEADINGS);
    const skills = chunks.find((c) => c.section === "Skills");
    expect(skills?.tags).toEqual(expect.arrayContaining(["EHR systems", "Epic", "Cerner"]));
    expect(skills?.bullets).toEqual([]);
  });

  it("falls back to paragraph-level chunking when no headings are recognized — same code path for any major", () => {
    const chunks = chunkResumeText(RESUME_WITHOUT_HEADINGS);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.section === "General")).toBe(true);
  });

  it("never throws on empty input", () => {
    expect(chunkResumeText("")).toEqual([]);
  });
});

describe("extractResumeHeader: captures the name/contact preamble chunking otherwise discards", () => {
  it("captures the lines before the first recognized section heading", () => {
    const header = extractResumeHeader(RESUME_WITH_HEADINGS);
    expect(header).toContain("Jane Doe");
    expect(header).toContain("Registered Nurse");
    expect(header).not.toContain("Summary");
    expect(header).not.toContain("Compassionate");
  });

  it("returns undefined, not the whole document, when no heading is found anywhere", () => {
    // RESUME_WITHOUT_HEADINGS is exactly the case chunkResumeText falls back
    // to chunkAsFallback for — capturing the same text again as "header"
    // would just duplicate it into a cover-letter prompt for no reason.
    expect(extractResumeHeader(RESUME_WITHOUT_HEADINGS)).toBeUndefined();
  });

  it("returns undefined when the very first line is already a recognized heading", () => {
    expect(extractResumeHeader("Experience\nRN, Mercy Hospital\n- Led triage")).toBeUndefined();
  });

  it("never throws on empty input", () => {
    expect(extractResumeHeader("")).toBeUndefined();
  });
});

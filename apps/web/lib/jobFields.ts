// Data-driven job field list for the editor's drag-and-tailor sidebar. Seeded with
// GCU's most-graduated program clusters so the tool feels built for these students
// specifically (per student-tool-design-brief.md), but structured as plain data —
// no field-specific parsing or rewrite logic anywhere in the pipeline reads this
// list. Adding a field for a different institution later is just adding a row.
export interface JobField {
  id: string;
  label: string;
}

export interface JobCategory {
  id: string;
  label: string;
  /** Not yet live at GCU but worth listing ahead of launch, per the design brief. */
  comingSoon?: boolean;
  items: JobField[];
}

export const JOB_CATEGORIES: JobCategory[] = [
  {
    id: "nursing-health",
    label: "Nursing & Health Sciences",
    items: [
      { id: "nursing-general", label: "Registered Nursing" },
      { id: "nursing-pediatric", label: "Pediatric Nursing" },
      { id: "nursing-icu", label: "Critical Care / ICU" },
      { id: "public-health", label: "Public Health" },
      { id: "health-admin", label: "Healthcare Administration" },
    ],
  },
  {
    id: "business",
    label: "Business",
    items: [
      { id: "business-general", label: "General Business" },
      { id: "marketing", label: "Marketing" },
      { id: "finance", label: "Finance" },
      { id: "accounting", label: "Accounting" },
      { id: "management", label: "Management" },
      { id: "entrepreneurship", label: "Entrepreneurship" },
    ],
  },
  {
    id: "education",
    label: "Education",
    items: [
      { id: "elementary-ed", label: "Elementary Education" },
      { id: "secondary-ed", label: "Secondary Education" },
      { id: "special-ed", label: "Special Education" },
      { id: "curriculum-design", label: "Curriculum & Instruction" },
    ],
  },
  {
    id: "tech-engineering",
    label: "Technology & Engineering",
    items: [
      { id: "software-engineering", label: "Software Engineering" },
      { id: "data-science", label: "Data Science" },
      { id: "cybersecurity", label: "Cybersecurity" },
      { id: "electrical-engineering", label: "Electrical Engineering" },
      { id: "civil-engineering", label: "Civil Engineering" },
    ],
  },
  {
    id: "psych-counseling",
    label: "Psychology & Counseling",
    items: [
      { id: "clinical-psych", label: "Clinical Psychology" },
      { id: "counseling", label: "Counseling" },
      { id: "behavioral-health", label: "Behavioral Health" },
      { id: "school-psych", label: "School Psychology" },
    ],
  },
  {
    id: "theology-ministry",
    label: "Theology & Ministry",
    items: [
      { id: "pastoral-ministry", label: "Pastoral Ministry" },
      { id: "youth-ministry", label: "Youth Ministry" },
      { id: "biblical-studies", label: "Biblical Studies" },
      { id: "missions", label: "Missions" },
    ],
  },
  {
    id: "social-humanities",
    label: "Social Sciences & Humanities",
    items: [
      { id: "social-work", label: "Social Work" },
      { id: "criminal-justice", label: "Criminal Justice" },
      { id: "history", label: "History" },
      { id: "communications", label: "Communications" },
      { id: "english", label: "English" },
    ],
  },
  {
    id: "law",
    label: "Law",
    comingSoon: true,
    items: [
      { id: "law-general", label: "General Practice" },
      { id: "corporate-law", label: "Corporate Law" },
      { id: "public-interest-law", label: "Public Interest Law" },
    ],
  },
];

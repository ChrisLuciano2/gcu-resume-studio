// Data-driven job field list for the editor's drag-and-tailor sidebar. Seeded with
// GCU's most-graduated program clusters so the tool feels built for these students
// specifically (per student-tool-design-brief.md), but structured as plain data —
// no field-specific parsing or rewrite logic anywhere in the pipeline reads this
// list. Adding a field for a different institution later is just adding a row.
//
// Niche lists expanded 2026-09-18 against real job-title research (O*NET, BLS
// Occupational Outlook Handbook, and industry career-path sources per category —
// not guessed) so the tailoring AI gets a real, specific target field ("Game
// Development", "Systems Development", "Data Analytics") instead of only the
// handful of broad program names GCU's catalog uses. `category`/`niche` are
// stored on a draft by their `label`, not `id` (see editor/page.tsx's
// DragPayload construction), so adding rows here is additive and never breaks
// an existing draft's stored category/niche string.
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
      { id: "nursing-er", label: "Emergency Room Nursing" },
      { id: "nursing-oncology", label: "Oncology Nursing" },
      { id: "nursing-psych", label: "Psychiatric / Mental Health Nursing" },
      { id: "nursing-or", label: "Operating Room / Perioperative Nursing" },
      { id: "nursing-labor-delivery", label: "Labor & Delivery Nursing" },
      { id: "nursing-home-hospice", label: "Home Health / Hospice Nursing" },
      { id: "nursing-travel", label: "Travel Nursing" },
      { id: "nurse-practitioner", label: "Family Nurse Practitioner" },
      { id: "nurse-educator", label: "Nurse Educator" },
      { id: "nurse-case-manager", label: "Nurse Case Management" },
      { id: "public-health", label: "Public Health" },
      { id: "health-admin", label: "Healthcare Administration" },
      { id: "physician-assistant", label: "Physician Assistant Studies" },
      { id: "medical-lab-science", label: "Medical Laboratory Science" },
      { id: "radiologic-tech", label: "Radiologic Technology" },
      { id: "physical-therapy", label: "Physical Therapy" },
      { id: "occupational-therapy", label: "Occupational Therapy" },
      { id: "respiratory-therapy", label: "Respiratory Therapy" },
      { id: "nutrition-dietetics", label: "Nutrition & Dietetics" },
      { id: "health-informatics", label: "Health Informatics" },
    ],
  },
  {
    id: "business",
    label: "Business",
    items: [
      { id: "business-general", label: "General Business" },
      { id: "marketing", label: "Marketing" },
      { id: "digital-marketing", label: "Digital Marketing" },
      { id: "finance", label: "Finance" },
      { id: "financial-analyst", label: "Financial Analysis" },
      { id: "accounting", label: "Accounting" },
      { id: "management", label: "Management" },
      { id: "operations-management", label: "Operations Management" },
      { id: "entrepreneurship", label: "Entrepreneurship" },
      { id: "human-resources", label: "Human Resources" },
      { id: "project-management", label: "Project Management" },
      { id: "product-management", label: "Product Management" },
      { id: "supply-chain-logistics", label: "Supply Chain & Logistics" },
      { id: "business-analyst", label: "Business Analysis" },
      { id: "sales", label: "Sales" },
      { id: "market-research", label: "Market Research" },
      { id: "real-estate", label: "Real Estate" },
      { id: "consulting", label: "Consulting" },
      { id: "international-business", label: "International Business" },
    ],
  },
  {
    id: "education",
    label: "Education",
    items: [
      { id: "elementary-ed", label: "Elementary Education" },
      { id: "secondary-ed", label: "Secondary Education" },
      { id: "early-childhood-ed", label: "Early Childhood Education" },
      { id: "special-ed", label: "Special Education" },
      { id: "esl-bilingual-ed", label: "ESL / Bilingual Education" },
      { id: "stem-ed", label: "STEM Education" },
      { id: "curriculum-design", label: "Curriculum & Instruction" },
      { id: "instructional-design", label: "Instructional Design" },
      { id: "instructional-technology", label: "Instructional Technology" },
      { id: "school-counseling", label: "School Counseling" },
      { id: "educational-leadership", label: "Educational Leadership / Administration" },
      { id: "higher-ed-advising", label: "Higher Education / Academic Advising" },
      { id: "library-media-science", label: "Library & Media Science" },
      { id: "athletic-coaching", label: "Athletic Coaching / Physical Education" },
    ],
  },
  {
    id: "tech-engineering",
    label: "Technology & Engineering",
    items: [
      { id: "software-engineering", label: "Software Engineering" },
      { id: "web-development", label: "Web Development" },
      { id: "mobile-development", label: "Mobile App Development" },
      { id: "game-development", label: "Game Development" },
      { id: "systems-development", label: "Systems Development / Administration" },
      { id: "data-science", label: "Data Science" },
      { id: "data-analytics", label: "Data Analytics" },
      { id: "machine-learning", label: "Machine Learning / AI Engineering" },
      { id: "devops-engineering", label: "DevOps Engineering" },
      { id: "site-reliability", label: "Site Reliability Engineering" },
      { id: "cloud-engineering", label: "Cloud Architecture / Engineering" },
      { id: "cybersecurity", label: "Cybersecurity" },
      { id: "network-engineering", label: "Network Engineering" },
      { id: "database-admin", label: "Database Administration" },
      { id: "qa-testing", label: "Quality Assurance / QA Testing" },
      { id: "ux-ui-design", label: "UX / UI Design" },
      { id: "it-support", label: "IT Support / Help Desk" },
      { id: "electrical-engineering", label: "Electrical Engineering" },
      { id: "civil-engineering", label: "Civil Engineering" },
      { id: "mechanical-engineering", label: "Mechanical Engineering" },
      { id: "industrial-engineering", label: "Industrial / Manufacturing Engineering" },
      { id: "robotics-engineering", label: "Robotics Engineering" },
      { id: "embedded-systems", label: "Embedded Systems Engineering" },
    ],
  },
  {
    id: "psych-counseling",
    label: "Psychology & Counseling",
    items: [
      { id: "clinical-psych", label: "Clinical Psychology" },
      { id: "counseling", label: "Counseling" },
      { id: "marriage-family-therapy", label: "Marriage & Family Therapy" },
      { id: "substance-abuse-counseling", label: "Substance Abuse / Addiction Counseling" },
      { id: "behavioral-health", label: "Behavioral Health" },
      { id: "school-psych", label: "School Psychology" },
      { id: "child-adolescent-psych", label: "Child & Adolescent Psychology" },
      { id: "trauma-crisis-counseling", label: "Trauma / Crisis Counseling" },
      { id: "career-counseling", label: "Career Counseling" },
      { id: "rehabilitation-counseling", label: "Rehabilitation Counseling" },
      { id: "industrial-org-psych", label: "Industrial-Organizational Psychology" },
      { id: "forensic-psych", label: "Forensic Psychology" },
      { id: "neuropsychology", label: "Neuropsychology" },
      { id: "sports-psych", label: "Sports Psychology" },
    ],
  },
  {
    id: "theology-ministry",
    label: "Theology & Ministry",
    items: [
      { id: "pastoral-ministry", label: "Pastoral Ministry" },
      { id: "youth-ministry", label: "Youth Ministry" },
      { id: "childrens-ministry", label: "Children's Ministry" },
      { id: "worship-ministry", label: "Worship / Music Ministry" },
      { id: "biblical-studies", label: "Biblical Studies" },
      { id: "missions", label: "Missions" },
      { id: "chaplaincy", label: "Chaplaincy" },
      { id: "pastoral-counseling", label: "Pastoral Counseling" },
      { id: "church-administration", label: "Church Administration" },
      { id: "christian-education", label: "Christian Education" },
      { id: "faith-based-nonprofit", label: "Faith-Based Nonprofit Leadership" },
      { id: "apologetics", label: "Apologetics" },
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
      { id: "sociology", label: "Sociology" },
      { id: "political-science", label: "Political Science / Government" },
      { id: "anthropology", label: "Anthropology" },
      { id: "public-policy", label: "Public Policy" },
      { id: "international-relations", label: "International Relations" },
      { id: "nonprofit-management", label: "Nonprofit Management" },
      { id: "human-services", label: "Human Services" },
      { id: "journalism", label: "Journalism" },
      { id: "public-relations", label: "Public Relations" },
      { id: "philosophy", label: "Philosophy" },
      { id: "urban-regional-planning", label: "Urban & Regional Planning" },
      { id: "library-science", label: "Library Science" },
    ],
  },
  {
    id: "law",
    label: "Law",
    items: [
      { id: "law-general", label: "General Practice" },
      { id: "corporate-law", label: "Corporate Law" },
      { id: "public-interest-law", label: "Public Interest Law" },
      { id: "criminal-law", label: "Criminal Law" },
      { id: "family-law", label: "Family Law" },
      { id: "immigration-law", label: "Immigration Law" },
      { id: "environmental-law", label: "Environmental Law" },
      { id: "intellectual-property-law", label: "Intellectual Property Law" },
      { id: "paralegal-studies", label: "Paralegal Studies" },
      { id: "legal-compliance", label: "Legal Compliance" },
      { id: "legal-operations", label: "Legal Operations" },
      { id: "contract-management", label: "Contract Management" },
    ],
  },
];

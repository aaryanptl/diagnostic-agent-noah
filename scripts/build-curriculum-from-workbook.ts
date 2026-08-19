/**
 * Builds app/learning-plan-builder/curriculum.generated.ts from the maths
 * teaching-sequence workbook.
 *
 *   npx tsx --env-file=.env.local scripts/build-curriculum-from-workbook.ts
 *
 * The workbook is the source of truth for THREE things only:
 *   - topic order per grade (column "Topic Order" / "Topic Name")
 *   - prerequisites, given by topic name (column "Must Be Completed Before…")
 *   - learning objectives and their subtopic grouping
 *
 * Everything else a CurriculumTopic needs (family, priority, ideal/minimum
 * classes, activities, easy/practice split, reason) is NOT in the workbook.
 * For Grade 5 we keep the hand-tuned values that were already in data.ts; for
 * every other grade we derive them with the heuristics below, calibrated
 * against those Grade 5 values. Replace them with real numbers when the
 * workbook grows a class-count column.
 *
 * Topic IDs are the real `topics.id` values from the database, matched on
 * (grade, normalised name). An unmatched topic is a hard failure — we never
 * invent an ID, because plan rows are persisted against these FKs.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as XLSX from "xlsx";
import pool from "@/lib/db";
import type { Priority } from "@/lib/learning-plan/types";

const WORKBOOK = path.resolve(
  process.cwd(),
  "files/Maths Teaching Sequence All Grades.xlsx",
);
const OUTPUT = path.resolve(
  process.cwd(),
  "app/learning-plan-builder/curriculum.generated.ts",
);

/* ------------------------------------------------------------------ parsing */

interface RawObjective {
  order: number;
  subtopic: string;
  text: string;
}

interface RawTopic {
  order: number;
  name: string;
  prerequisiteNames: string[];
  objectives: RawObjective[];
}

interface RawGrade {
  label: string;
  key: string;
  topics: RawTopic[];
}

/** Em/en dashes are used as the workbook's "none" marker and inside names. */
function normaliseName(value: string): string {
  return value.replace(/[‐-―]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();
}

function isNoneMarker(value: string): boolean {
  return value === "" || /^[‐-―-]+$/.test(value.trim());
}

function gradeKeyFor(label: string): string {
  if (/kinder/i.test(label)) return "KG";
  const match = label.match(/\d+/);
  if (!match) throw new Error(`Unrecognised grade heading: "${label}"`);
  return match[0];
}

function parseWorkbook(): RawGrade[] {
  if (!fs.existsSync(WORKBOOK)) {
    throw new Error(`Workbook not found: ${WORKBOOK}`);
  }

  const book = XLSX.readFile(WORKBOOK);
  const sheet = book.Sheets[book.SheetNames[0]];
  const rows = XLSX.utils
    .sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" })
    .slice(1)
    .map((row) => row.map((cell) => String(cell ?? "").trim()));

  const grades: RawGrade[] = [];
  let grade: RawGrade | undefined;
  let topic: RawTopic | undefined;

  for (const [
    order,
    name,
    prerequisites,
    loOrder,
    subtopic,
    objective,
  ] of rows) {
    const isGradeHeading = order !== "" && !/^\d+$/.test(order);

    if (isGradeHeading) {
      grade = { label: order, key: gradeKeyFor(order), topics: [] };
      grades.push(grade);
      topic = undefined;
      continue;
    }

    if (/^\d+$/.test(order)) {
      if (!grade)
        throw new Error(`Topic "${name}" appears before any grade heading`);
      topic = {
        order: Number(order),
        name,
        prerequisiteNames: isNoneMarker(prerequisites)
          ? []
          : prerequisites
              // Only ";" separates entries — topic names contain commas
              // ("Numbers to 10,000", "Factors, Multiples & Primes").
              .split(";")
              .map((entry) => entry.trim())
              .filter((entry) => entry.length > 0 && !isNoneMarker(entry)),
        objectives: [],
      };
      grade.topics.push(topic);
    }

    if (objective) {
      if (!topic)
        throw new Error(`Objective "${objective}" has no owning topic`);
      topic.objectives.push({
        order: Number(loOrder) || topic.objectives.length + 1,
        subtopic: subtopic || topic.name,
        text: objective,
      });
    }
  }

  return grades;
}

/* -------------------------------------------------------------- database IDs */

async function loadTopicIds(): Promise<Map<string, number>> {
  const result = await pool.query<{ id: string; name: string; grade: string }>(
    `SELECT t.id::text AS id, t.name, COALESCE(t.grade::text, t.class_level) AS grade
       FROM topics t
       JOIN subjects s ON s.id = t.subject_id
      WHERE lower(s.name) LIKE '%math%'
        AND t.status = 'active'`,
  );

  const ids = new Map<string, number>();
  for (const row of result.rows) {
    const gradeMatch = row.grade?.match(/kg|\d+/i);
    if (!gradeMatch) continue;
    const key = /kg/i.test(gradeMatch[0]) ? "KG" : gradeMatch[0];
    ids.set(`${key}::${normaliseName(row.name)}`, Number(row.id));
  }
  return ids;
}

/* ------------------------------------------------- teaching-metadata defaults */

/** Ordered keyword rules — first match wins. */
const FAMILY_RULES: Array<[RegExp, string]> = [
  [/vedic|logical reasoning|set theory/i, "Enrichment"],
  [/fraction/i, "Fractions"],
  [/decimal/i, "Decimals"],
  [/percent|ratio|proportion/i, "Ratio & Proportion"],
  [/money|financial|budget|interest|tax|currency/i, "Money & Finance"],
  [/probabilit/i, "Probability"],
  [/statistic|data|graph|pictograph|scatter|average/i, "Data & Statistics"],
  [
    /perimeter|area|volume|surface|mensuration|measurement|length|capacity/i,
    "Measurement",
  ],
  [/time|clock/i, "Time"],
  [
    /geometr|shape|angle|triangle|quadrilateral|circle|polygon|symmetr|congruen|pythagoras|transformation|position|construction|coordinate/i,
    "Geometry",
  ],
  [
    /algebra|equation|expression|polynomial|factorisation|variable|function|linear/i,
    "Patterns & Algebra",
  ],
  [/pattern|sequence|sorting|classification/i, "Patterns & Algebra"],
  [
    /factor|multiple|prime|exponent|power|square|cube|root|scientific notation/i,
    "Number Theory",
  ],
  [
    /multiplication|division|arithmetic|operations/i,
    "Multiplication & Division",
  ],
  [
    /integer|rational|number|place value|counting|compos|comparing/i,
    "Number Sense",
  ],
];

const HIGH_PRIORITY_FAMILIES = new Set([
  "Number Sense",
  "Multiplication & Division",
  "Number Theory",
  "Fractions",
  "Decimals",
  "Ratio & Proportion",
  "Patterns & Algebra",
  "Measurement",
]);

function familyFor(name: string): string {
  for (const [pattern, family] of FAMILY_RULES) {
    if (pattern.test(name)) return family;
  }
  return "Number Sense";
}

function priorityFor(name: string, family: string): Priority {
  if (/vedic/i.test(name)) return "low";
  if (family === "Enrichment") return "medium";
  return HIGH_PRIORITY_FAMILIES.has(family) ? "high" : "medium";
}

/**
 * Calibrated against the 13 hand-tuned Grade 5 topics: high-priority topics ran
 * one class longer than their objective count, medium-priority topics matched
 * it, and enrichment ran shorter.
 */
function idealClassesFor(
  objectives: number,
  priority: Priority,
  family: string,
): number {
  if (family === "Enrichment") return Math.max(2, Math.ceil(objectives * 0.75));
  if (priority === "high") return objectives + 1;
  return Math.max(3, objectives);
}

/** Rule H1 compression floor: ~60% of ideal, never below 1. */
function minimumClassesFor(idealClasses: number): number {
  if (idealClasses <= 2) return 1;
  return Math.max(1, Math.ceil(idealClasses * 0.6));
}

function idealActivitiesFor(idealClasses: number, priority: Priority): number {
  const perClass =
    priority === "high" ? 3.9 : priority === "medium" ? 3.4 : 3.2;
  return Math.round(idealClasses * perClass);
}

function easyPercentFor(priority: Priority, family: string): number {
  if (family === "Fractions") return 55;
  if (priority === "high") return 60;
  if (priority === "low") return 70;
  return 65;
}

function reasonFor(
  topic: RawTopic,
  gradeLabel: string,
  family: string,
  priority: Priority,
  unlocks: string[],
): string {
  const lead =
    priority === "high"
      ? `Core ${family.toLowerCase()} work for ${gradeLabel}`
      : priority === "low"
        ? `Enrichment topic — valuable but the first thing to compress`
        : `Supporting ${family.toLowerCase()} work for ${gradeLabel}`;
  const tail = unlocks.length
    ? ` Unlocks ${unlocks.slice(0, 2).join(" and ")}.`
    : ` Can be taught independently of the rest of the sequence.`;
  return `${lead} (sequence ${topic.order}).${tail}`;
}

/**
 * Hand-tuned Grade 5 values carried over from the original data.ts so the
 * existing prototype scenarios keep their exact class/activity budgets.
 */
interface Override {
  family?: string;
  priority?: Priority;
  idealClasses?: number;
  minimumClasses?: number;
  idealActivities?: number;
  easyPercent?: number;
  reason?: string;
  objectiveKeys?: string[];
}

/**
 * Grade 5 full-year package from the workbook: 79 classes =
 * 66 teaching + 13 structural (5 checkpoints + 5 RDP + 3 PTM).
 *
 * The ideal class counts below MUST sum to this number. That is what makes an
 * untouched full-year plan land exactly on the package: every topic runs at its
 * ideal length, structural runs at full strength, and nothing has to be
 * compressed. Any class the plan then saves — a strong placement score
 * shortening a topic to its minimum, a completed topic dropping out — shows up
 * as real headroom under the package instead of being swallowed by an overage
 * that was baked into the curriculum.
 */
const GRADE_5_TEACHING_BUDGET = 66;

const GRADE_5_OVERRIDES: Record<string, Override> = {
  "number sense & operations": {
    family: "Number Sense",
    priority: "high",
    idealClasses: 5,
    minimumClasses: 3,
    idealActivities: 20,
    easyPercent: 60,
    reason:
      "Foundational for the whole year; order of operations is needed again in Algebra.",
    objectiveKeys: [
      "large-numbers",
      "estimation",
      "order-operations",
      "brackets",
    ],
  },
  "multi-digit operations": {
    family: "Multiplication & Division",
    priority: "high",
    idealClasses: 5,
    minimumClasses: 3,
    idealActivities: 20,
    easyPercent: 60,
    reason:
      "Long division consistently needs the most teaching and practice time at this grade.",
    objectiveKeys: [
      "multiplication-standard",
      "multiplication-problems",
      "long-division",
      "remainders",
    ],
  },
  "factors, multiples & primes": {
    family: "Number Theory",
    priority: "high",
    idealClasses: 5,
    minimumClasses: 3,
    idealActivities: 21,
    easyPercent: 60,
    reason:
      "HCF and LCM are prerequisites for adding and subtracting unlike fractions.",
    objectiveKeys: [
      "hcf",
      "lcm",
      "hcf-lcm-problems",
      "prime-factors",
      "factor-trees",
    ],
  },
  "decimal arithmetic": {
    family: "Decimals",
    priority: "high",
    idealClasses: 5,
    minimumClasses: 3,
    idealActivities: 19,
    easyPercent: 60,
    reason:
      "Decimals carry straight into measurement, money, and percentage work.",
    objectiveKeys: ["add-subtract", "align-points", "multiply", "divide"],
  },
  "fraction arithmetic": {
    family: "Fractions",
    priority: "high",
    idealClasses: 8,
    minimumClasses: 5,
    idealActivities: 30,
    easyPercent: 55,
    reason:
      "The heaviest topic of the year; unlike denominators and division of fractions both need dedicated time.",
    objectiveKeys: [
      "common-denominator",
      "mixed-numbers",
      "multiply-fractions",
      "multiply-problems",
      "divide-fractions",
      "division-diagrams",
    ],
  },
  "2d & 3d geometry": {
    family: "Geometry",
    priority: "medium",
    idealClasses: 4,
    minimumClasses: 3,
    idealActivities: 13,
    easyPercent: 65,
    reason:
      "Independent of the number strand, so it can be moved without breaking prerequisites.",
    objectiveKeys: [
      "classify-shapes",
      "missing-angles",
      "prisms-pyramids",
      "nets",
    ],
  },
  "perimeter, area & measurement": {
    family: "Measurement",
    priority: "high",
    idealClasses: 6,
    minimumClasses: 4,
    idealActivities: 22,
    easyPercent: 60,
    reason:
      "Needs both the decimal work and the shape vocabulary in place first.",
    objectiveKeys: [
      "area-polygons",
      "area-problems",
      "volume",
      "capacity",
      "convert-units",
      "select-units",
    ],
  },
  "algebraic expressions": {
    family: "Patterns & Algebra",
    priority: "high",
    idealClasses: 4,
    minimumClasses: 3,
    idealActivities: 16,
    easyPercent: 60,
    reason:
      "First formal algebra; leans on order of operations from the opening topic.",
    objectiveKeys: ["write-expressions", "simplify", "substitute", "compare"],
  },
  "data analysis": {
    family: "Data & Statistics",
    priority: "medium",
    idealClasses: 5,
    minimumClasses: 3,
    idealActivities: 16,
    easyPercent: 65,
    reason: "Standalone topic — safe to reorder when the calendar is tight.",
    objectiveKeys: ["graphs", "choose-graph", "mean", "median-mode"],
  },
  "theoretical & experimental probability": {
    family: "Probability",
    priority: "medium",
    idealClasses: 3,
    minimumClasses: 2,
    idealActivities: 11,
    easyPercent: 65,
    reason: "Short topic, but it needs fraction notation to be secure first.",
    objectiveKeys: [
      "simple-events",
      "sample-space",
      "experiments",
      "compare-results",
    ],
  },
  "geometric transformations": {
    family: "Geometry",
    priority: "medium",
    idealClasses: 3,
    minimumClasses: 2,
    idealActivities: 11,
    easyPercent: 65,
    reason:
      "Extends the geometry strand; low risk if it slips to the following term.",
    objectiveKeys: ["reflect", "rotate", "translate", "describe-translation"],
  },
  "logical reasoning": {
    family: "Enrichment",
    priority: "medium",
    idealClasses: 3,
    minimumClasses: 2,
    idealActivities: 10,
    easyPercent: 70,
    reason:
      "Enrichment topic with no prerequisites; useful filler when capacity allows.",
    objectiveKeys: ["analogies", "classification", "deduce", "multi-step"],
  },
  "vedic mathematics": {
    family: "Enrichment",
    priority: "low",
    idealClasses: 2,
    minimumClasses: 1,
    idealActivities: 6,
    easyPercent: 70,
    reason:
      "Speed-technique enrichment; the first topic to drop when the package is tight.",
    objectiveKeys: ["duplex", "near-base"],
  },
  // Percentages & Ratios and Budgeting & Simple Interest were previously left to
  // the heuristics. They are pinned here so the whole Grade 5 sequence adds up to
  // GRADE_5_TEACHING_BUDGET; family, priority, easy split, and reason still come
  // from the heuristics.
  "percentages & ratios": {
    idealClasses: 5,
    minimumClasses: 3,
    idealActivities: 20,
  },
  "budgeting & simple interest": {
    idealClasses: 3,
    minimumClasses: 2,
    idealActivities: 11,
  },
};

/* ----------------------------------------------------------------- objectives */

/**
 * The workbook phrases every objective as "Students can …". The builder UI
 * already labels the list as learning objectives, so drop the stem the way the
 * original hand-written Grade 5 data did.
 */
function objectiveText(value: string): string {
  const trimmed = value.replace(/^students\s+can\s+/i, "").trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function objectiveKeys(topic: RawTopic, override?: Override): string[] {
  if (
    override?.objectiveKeys &&
    override.objectiveKeys.length === topic.objectives.length
  ) {
    return override.objectiveKeys;
  }
  const usedPerSubtopic = new Map<string, number>();
  return topic.objectives.map((objective) => {
    const base = slug(objective.subtopic);
    const next = (usedPerSubtopic.get(base) ?? 0) + 1;
    usedPerSubtopic.set(base, next);
    return `${base}-${next}`;
  });
}

/* -------------------------------------------------------------------- emitter */

function quote(value: string): string {
  return JSON.stringify(value);
}

async function main() {
  const grades = parseWorkbook();
  const topicIds = await loadTopicIds();

  const missing: string[] = [];
  const idByGradeAndName = new Map<string, number>();

  for (const grade of grades) {
    for (const topic of grade.topics) {
      const key = `${grade.key}::${normaliseName(topic.name)}`;
      const id = topicIds.get(key);
      if (!id) {
        missing.push(`${grade.label} — ${topic.name}`);
        continue;
      }
      idByGradeAndName.set(key, id);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `No database topic row for ${missing.length} workbook topic(s):\n  ${missing.join("\n  ")}`,
    );
  }

  const unresolvedPrerequisites: string[] = [];
  let grade5TeachingClasses = 0;
  const chunks: string[] = [];
  let topicCount = 0;
  let objectiveCount = 0;

  for (const grade of grades) {
    const idFor = (name: string) =>
      idByGradeAndName.get(`${grade.key}::${normaliseName(name)}`);

    // Which topics each topic unlocks, used for the generated reason line.
    const unlocks = new Map<string, string[]>();
    for (const topic of grade.topics) {
      for (const prerequisite of topic.prerequisiteNames) {
        const list = unlocks.get(normaliseName(prerequisite)) ?? [];
        list.push(topic.name);
        unlocks.set(normaliseName(prerequisite), list);
      }
    }

    const topicChunks = grade.topics.map((topic) => {
      const id = idFor(topic.name) as number;
      const override =
        grade.key === "5"
          ? GRADE_5_OVERRIDES[normaliseName(topic.name)]
          : undefined;

      const family = override?.family ?? familyFor(topic.name);
      const priority = override?.priority ?? priorityFor(topic.name, family);
      const idealClasses =
        override?.idealClasses ??
        idealClassesFor(topic.objectives.length, priority, family);
      const minimumClasses =
        override?.minimumClasses ?? minimumClassesFor(idealClasses);
      const idealActivities =
        override?.idealActivities ?? idealActivitiesFor(idealClasses, priority);
      const easyPercent =
        override?.easyPercent ?? easyPercentFor(priority, family);
      const reason =
        override?.reason ??
        reasonFor(
          topic,
          grade.label,
          family,
          priority,
          unlocks.get(normaliseName(topic.name)) ?? [],
        );

      const prerequisiteIds = topic.prerequisiteNames
        .map((name) => {
          const resolved = idFor(name);
          if (!resolved)
            unresolvedPrerequisites.push(
              `${grade.label}: ${topic.name} ← ${name}`,
            );
          return resolved;
        })
        .filter((value): value is number => typeof value === "number");

      const keys = objectiveKeys(topic, override);
      objectiveCount += topic.objectives.length;
      topicCount += 1;
      if (grade.key === "5") grade5TeachingClasses += idealClasses;

      const objectives = topic.objectives
        .map(
          (objective, index) =>
            `      {\n` +
            `        id: ${quote(`${id}-${keys[index]}`)},\n` +
            `        subtopic: ${quote(objective.subtopic)},\n` +
            `        text: ${quote(objectiveText(objective.text))},\n` +
            `      },`,
        )
        .join("\n");

      return (
        `  {\n` +
        `    id: ${id},\n` +
        `    sequence: ${topic.order},\n` +
        `    name: ${quote(topic.name)},\n` +
        `    family: ${quote(family)},\n` +
        `    priority: ${quote(priority)},\n` +
        `    prerequisiteIds: [${prerequisiteIds.join(", ")}],\n` +
        `    idealClasses: ${idealClasses},\n` +
        `    minimumClasses: ${minimumClasses},\n` +
        `    idealActivities: ${idealActivities},\n` +
        `    easyPercent: ${easyPercent},\n` +
        `    practicePercent: ${100 - easyPercent},\n` +
        `    reason: ${quote(reason)},\n` +
        `    learningObjectives: [\n${objectives}\n    ],\n` +
        `  },`
      );
    });

    chunks.push(
      `const grade${grade.key}Topics: CurriculumTopic[] = [\n${topicChunks.join("\n")}\n]`,
    );
  }

  if (unresolvedPrerequisites.length > 0) {
    throw new Error(
      `Unresolved prerequisite name(s):\n  ${unresolvedPrerequisites.join("\n  ")}`,
    );
  }

  // A Grade 5 full-year plan has to land exactly on the package with every topic
  // at its ideal length. If this drifts, an untouched plan is already over (or
  // under) budget before any student evidence is applied, and the placement
  // savings the builder reports stop being visible on the capacity card.
  if (grade5TeachingClasses !== GRADE_5_TEACHING_BUDGET) {
    throw new Error(
      `Grade 5 ideal classes add up to ${grade5TeachingClasses}, expected ${GRADE_5_TEACHING_BUDGET}. ` +
        `Adjust GRADE_5_OVERRIDES so the full-year sequence fits 79 classes ` +
        `(${GRADE_5_TEACHING_BUDGET} teaching + 13 structural).`,
    );
  }

  const keys = grades.map((grade) => grade.key);
  const header = `// AUTO-GENERATED FILE — do not edit by hand.
//
// Source:    files/Maths Teaching Sequence All Grades.xlsx
// Generator: scripts/build-curriculum-from-workbook.ts
// Regenerate with:
//   npx tsx --env-file=.env.local scripts/build-curriculum-from-workbook.ts
//
// Topic IDs are the live \`topics.id\` values from the maths curriculum tables.
// The workbook supplies topic order, prerequisites, and learning objectives.
// Class counts, activity counts, priority, family, and easy/practice splits are
// hand-tuned for Grade 5 and derived from calibrated heuristics for every other
// grade — see the generator for the exact rules.

import type { CurriculumTopic } from "@/lib/learning-plan/types"

export type GradeKey = ${keys.map(quote).join(" | ")}

`;

  const footer = `
export const gradeKeys: GradeKey[] = [${keys.map(quote).join(", ")}]

export const gradeLabels: Record<GradeKey, string> = {
${grades.map((grade) => `  ${quote(grade.key)}: ${quote(grade.label)},`).join("\n")}
}

export const curriculumByGrade: Record<GradeKey, CurriculumTopic[]> = {
${grades.map((grade) => `  ${quote(grade.key)}: grade${grade.key}Topics,`).join("\n")}
}
`;

  const body = chunks.join("\n\n");
  fs.writeFileSync(OUTPUT, `${header}${body}\n${footer}`, "utf8");

  console.log(
    `Wrote ${path.relative(process.cwd(), OUTPUT)}: ${grades.length} grades, ${topicCount} topics, ${objectiveCount} learning objectives.`,
  );
  await pool.end();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

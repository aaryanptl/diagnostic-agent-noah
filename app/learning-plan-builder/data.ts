import type { DemoStudent, QuestionGuideline } from "@/lib/learning-plan/types";
import { curriculumByGrade } from "./curriculum.generated";

/**
 * Every grade's teaching sequence, learning objectives, and prerequisites live
 * in curriculum.generated.ts, built from
 * `files/Maths Teaching Sequence All Grades.xlsx` by
 * `scripts/build-curriculum-from-workbook.ts`. Topic IDs are the live
 * `topics.id` values from the curriculum tables.
 *
 * The demo students below are all Grade 5, so this stays the default sequence
 * for the prototype. Use `getTopicsForGrade()` from ./curriculum for any other
 * grade.
 */
export const curriculumTopics = curriculumByGrade["5"];

export const demoStudents: DemoStudent[] = [
  {
    id: "student-a",
    scenario: "A",
    name: "Maya Thompson",
    initials: "MT",
    grade: 5,
    region: "US",
    // Full-year package from workbook: 66 teaching + 13 structural = 79
    classesRemaining: 79,
    packageLabel: "Full year · 79 classes",
    classesPerWeek: 2,
    placementStatus: "completed",
    placementResults: [
      { topicId: 60, score: 30 },
      { topicId: 58, score: 35 },
      { topicId: 57, score: 85 },
      { topicId: 65, score: 80 },
    ],
    defaultPlacementScore: 60,
    completedTopics: [],
    objectiveEvidence: [],
  },
  {
    id: "student-b",
    scenario: "B",
    name: "Ethan Carter",
    initials: "EC",
    grade: 5,
    region: "US",
    // Half-year package: the fit rules (compress toward minimums, then drop) fire.
    classesRemaining: 40,
    packageLabel: "Half year · 40 classes",
    classesPerWeek: 2,
    placementStatus: "not-taken",
    placementResults: [],
    completedTopics: [],
    objectiveEvidence: [],
  },
  {
    id: "student-c",
    scenario: "C",
    name: "Aarav Shah",
    initials: "AS",
    grade: 5,
    region: "US",
    classesRemaining: 24,
    packageLabel: "Full year · 24 classes left",
    classesPerWeek: 2,
    placementStatus: "not-applicable",
    placementResults: [],
    completedTopics: [
      { topicId: 57, plannedClasses: 5, actualClasses: 4 },
      { topicId: 58, plannedClasses: 6, actualClasses: 6 },
    ],
    // Factors, Multiples & Primes — the topic every objectiveEvidence entry
    // below is recorded against, and the one in progress when the plan is rebuilt.
    currentTopicId: 59,
    // Workbook scenario C: 3 of this topic's classes are already taught.
    // 4 (topic 57) + 6 (topic 58) + 3 = the 13 classes in `previousPlanLabel`.
    currentTopicClassesUsed: 3,
    objectiveEvidence: [
      {
        learningObjectiveId: "59-hcf",
        level: "starter",
        result: "secure",
        note: "Solves Starter-level HCF questions correctly.",
      },
      {
        learningObjectiveId: "59-lcm",
        level: "starter",
        result: "secure",
        note: "Solves Starter-level LCM questions correctly.",
      },
      {
        learningObjectiveId: "59-hcf-lcm-problems",
        level: "master",
        result: "not-secure",
        note: "Gets Master-level real-world HCF and LCM questions wrong.",
      },
      {
        learningObjectiveId: "59-factor-trees",
        level: "master",
        result: "not-secure",
        note: "Has not attempted factor trees and index notation yet.",
      },
    ],
    questionAttemptEvidence: [
      {
        topicId: 57,
        learningObjectiveId: "57-order-operations",
        level: "starter",
        correct: 3,
        attempted: 4,
        note: "Uses the order-of-operations routine accurately on familiar expressions.",
      },
      {
        topicId: 57,
        learningObjectiveId: "57-brackets",
        level: "master",
        correct: 1,
        attempted: 3,
        note: "Loses track of how brackets change the order in multi-step expressions.",
      },
      {
        topicId: 59,
        learningObjectiveId: "59-hcf-lcm-problems",
        level: "starter",
        correct: 4,
        attempted: 4,
        note: "Finds HCF and LCM correctly when the method is named.",
      },
      {
        topicId: 59,
        learningObjectiveId: "59-hcf-lcm-problems",
        level: "master",
        correct: 1,
        attempted: 4,
        note: "Needs to decide whether an unfamiliar real-world problem calls for HCF or LCM.",
      },
      {
        topicId: 60,
        learningObjectiveId: "60-common-denominator",
        level: "starter",
        correct: 1,
        attempted: 4,
        note: "Still needs fluency finding equivalent fractions and a common denominator.",
      },
      {
        topicId: 60,
        learningObjectiveId: "60-common-denominator",
        level: "master",
        correct: 3,
        attempted: 4,
        note: "Can reason through a supported multi-step fraction task, but the basic routine is not reliable yet.",
      },
    ],
    previousPlanLabel: "Baseline plan · 13 classes completed",
  },
  {
    id: "student-d",
    scenario: "D",
    name: "Sofia Martinez",
    initials: "SM",
    grade: 5,
    region: "US",
    classesRemaining: 79,
    packageLabel: "Full year · 79 classes",
    classesPerWeek: 2,
    placementStatus: "not-taken",
    placementResults: [],
    completedTopics: [],
    objectiveEvidence: [],
    parentRequestedTopicId: 60,
  },
];

export const questionGuidelines: QuestionGuideline[] = [
  {
    topicId: 60,
    learningObjectiveId: "60-common-denominator",
    starter: "1/4 + 2/4 = ?",
    master:
      "5/6 − 3/8 + 1/4 = ? (three unlike denominators; simplify the answer)",
  },
  {
    topicId: 60,
    learningObjectiveId: "60-mixed-numbers",
    starter: "1½ + 2½ = ?",
    master: "4⅖ − 2¾ = ? (requires borrowing across the whole number)",
  },
  {
    topicId: 60,
    learningObjectiveId: "60-multiply-fractions",
    starter: "½ × 4 = ?",
    master:
      "¾ × ⅚ = ? Then explain why the product is smaller than both fractions.",
  },
  {
    topicId: 60,
    learningObjectiveId: "60-multiply-problems",
    starter: "A recipe needs ½ cup of sugar. How much for 2 recipes?",
    master:
      "A tank is ¾ full. ⅔ of that water is used. What fraction of the full tank was used?",
  },
  {
    topicId: 60,
    learningObjectiveId: "60-divide-fractions",
    starter: "½ ÷ 2 = ?",
    master:
      "How many ¼-litre bottles can be filled from 6 litres, and what does the answer represent?",
  },
  {
    topicId: 60,
    learningObjectiveId: "60-division-diagrams",
    starter: "Shade a diagram to show ½ ÷ 2.",
    master:
      "Draw a model for 3 ÷ ⅕ and write the matching division sentence and answer.",
  },
  {
    topicId: 59,
    learningObjectiveId: "59-hcf",
    starter: "Find the HCF of 8 and 12.",
    master:
      "Find the HCF of 24, 36, and 60, and explain what it tells you about the three numbers.",
  },
  {
    topicId: 59,
    learningObjectiveId: "59-lcm",
    starter: "Find the LCM of 4 and 6.",
    master:
      "Two bells ring every 12 and 18 minutes. They ring together now—after how many minutes will they ring together again?",
  },
  {
    topicId: 59,
    learningObjectiveId: "59-hcf-lcm-problems",
    starter:
      "Ribbons of 6 cm and 9 cm—what is the longest piece that measures both exactly?",
    master:
      "Three ropes of 42 m, 56 m, and 70 m must be cut into equal pieces of the greatest possible length with nothing left over. Find the length and total number of pieces.",
  },
  {
    topicId: 59,
    learningObjectiveId: "59-prime-factors",
    starter: "Write 12 as a product of prime factors.",
    master:
      "Write 360 as a product of prime factors in index notation, and use it to say whether 360 is divisible by 27.",
  },
  {
    topicId: 59,
    learningObjectiveId: "59-factor-trees",
    starter: "Complete a factor tree for 18.",
    master:
      "Complete two different factor trees for 48 and explain why both end with the same prime factors.",
  },
  {
    topicId: 57,
    learningObjectiveId: "57-large-numbers",
    starter: "Write 4,205,000 in words.",
    master:
      "Write ‘seven million forty thousand and nine’, then increase it by 100,000.",
  },
  {
    topicId: 57,
    learningObjectiveId: "57-estimation",
    starter: "Estimate 298 + 512 by rounding to hundreds.",
    master:
      "A student says 4,890 × 21 ≈ 10,000. Is that reasonable? Estimate properly and explain the error.",
  },
  {
    topicId: 57,
    learningObjectiveId: "57-order-operations",
    starter: "12 + 3 × 2 = ?",
    master: "36 ÷ (2 + 4) × 3 − 5 = ?",
  },
  {
    topicId: 57,
    learningObjectiveId: "57-brackets",
    starter: "Solve (5 + 3) × 2 and 5 + 3 × 2. Why do they differ?",
    master: "Insert brackets to make this true: 4 + 8 ÷ 2 × 3 = 18.",
  },
];

/** Lookup across every grade — topic IDs are unique across the curriculum. */
export const topicById = new Map(
  Object.values(curriculumByGrade)
    .flat()
    .map((topic) => [topic.id, topic]),
);

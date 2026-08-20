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
    starters: [
      "1/4 + 2/4 = ?",
      "1/2 + 1/4 = ?",
      "2/3 − 1/6 = ?",
      "3/5 + 1/10 = ?",
    ],
    masters: [
      "5/6 − 3/8 + 1/4 = ? (three unlike denominators; simplify the answer)",
      "7/12 + 5/18 = ? Show how you chose the denominator, then simplify.",
      "Ravi says 2/3 + 3/4 = 5/7. Find his mistake and give the correct answer.",
    ],
  },
  {
    topicId: 60,
    learningObjectiveId: "60-mixed-numbers",
    starters: [
      "1½ + 2½ = ?",
      "3¼ + 1½ = ?",
      "5¾ − 2¼ = ?",
      "2⅓ + 1⅙ = ?",
    ],
    masters: [
      "4⅖ − 2¾ = ? (requires borrowing across the whole number)",
      "A plank 6⅛ m long has 2⅚ m cut off. How much is left?",
      "Add 3⅗ and 2¾, then subtract 1½. Give the answer as a mixed number in simplest form.",
    ],
  },
  {
    topicId: 60,
    learningObjectiveId: "60-multiply-fractions",
    starters: [
      "½ × 4 = ?",
      "⅓ × 6 = ?",
      "½ × ⅓ = ?",
      "⅖ × 10 = ?",
    ],
    masters: [
      "¾ × ⅚ = ? Then explain why the product is smaller than both fractions.",
      "Work out ⅔ × 4½ and explain why the answer is smaller than 4½.",
      "⅝ × ⅘ = ? Simplify before multiplying and explain why that is allowed.",
    ],
  },
  {
    topicId: 60,
    learningObjectiveId: "60-multiply-problems",
    starters: [
      "A recipe needs ½ cup of sugar. How much for 2 recipes?",
      "A ribbon is ¾ m long. How long are 3 such ribbons?",
      "There are 12 sweets. Ravi eats ⅓ of them. How many did he eat?",
      "A jug holds ⅖ litre. How much do 5 jugs hold?",
    ],
    masters: [
      "A tank is ¾ full. ⅔ of that water is used. What fraction of the full tank was used?",
      "A field is ⅘ of a hectare. ⅜ of the field is planted with wheat. What fraction of a hectare is under wheat?",
      "Meera spends ⅓ of her money on books and ¼ of the remainder on food. What fraction of her money is left?",
    ],
  },
  {
    topicId: 60,
    learningObjectiveId: "60-divide-fractions",
    starters: [
      "½ ÷ 2 = ?",
      "¼ ÷ 3 = ?",
      "4 ÷ ½ = ?",
      "3 ÷ ⅓ = ?",
    ],
    masters: [
      "How many ¼-litre bottles can be filled from 6 litres, and what does the answer represent?",
      "A 5 m rope is cut into ⅕ m pieces. How many pieces, and why is the answer larger than 5?",
      "Explain, with a calculation, why ⅙ ÷ 3 and ⅙ × ⅓ give the same answer.",
    ],
  },
  {
    topicId: 60,
    learningObjectiveId: "60-division-diagrams",
    starters: [
      "Shade a diagram to show ½ ÷ 2.",
      "Draw a model for ¼ ÷ 2 and write the answer.",
      "Use a number line to show 2 ÷ ½.",
      "Shade a bar model to show ⅓ ÷ 3.",
    ],
    masters: [
      "Draw a model for 3 ÷ ⅕ and write the matching division sentence and answer.",
      "Draw one diagram that shows both ½ ÷ 4 and ½ × ¼, and explain what it proves.",
      "A diagram shows 4 wholes split into ⅔ pieces. Write the division sentence it represents and give the answer.",
    ],
  },
  {
    topicId: 59,
    learningObjectiveId: "59-hcf",
    starters: [
      "Find the HCF of 8 and 12.",
      "Find the HCF of 15 and 25.",
      "Find the HCF of 18 and 27.",
      "Find the HCF of 14 and 21.",
    ],
    masters: [
      "Find the HCF of 24, 36, and 60, and explain what it tells you about the three numbers.",
      "Find the HCF of 84 and 126 using prime factorisation, and show the working.",
      "Two numbers have an HCF of 6. One of them is 18. Give two possible values for the other and explain your choice.",
    ],
  },
  {
    topicId: 59,
    learningObjectiveId: "59-lcm",
    starters: [
      "Find the LCM of 4 and 6.",
      "Find the LCM of 5 and 8.",
      "Find the LCM of 9 and 12.",
      "Find the LCM of 3, 4 and 6.",
    ],
    masters: [
      "Two bells ring every 12 and 18 minutes. They ring together now—after how many minutes will they ring together again?",
      "Find the LCM of 15, 20 and 25 using prime factorisation.",
      "Two buses leave a stand every 24 and 36 minutes, starting together at 8:00 am. Give the next two times they leave together.",
    ],
  },
  {
    topicId: 59,
    learningObjectiveId: "59-hcf-lcm-problems",
    starters: [
      "Ribbons of 6 cm and 9 cm—what is the longest piece that measures both exactly?",
      "Tiles of 4 cm and 6 cm—what is the shortest length both measure exactly?",
      "Two lights flash every 5 s and 7 s. After how long do they flash together?",
      "What is the largest equal group size that divides both 12 and 30 exactly?",
    ],
    masters: [
      "Three ropes of 42 m, 56 m, and 70 m must be cut into equal pieces of the greatest possible length with nothing left over. Find the length and total number of pieces.",
      "Sweets come in boxes of 24 and packets of 40. What is the smallest number of sweets you could buy as a whole number of each?",
      "A hall floor is 15 m by 24 m. Find the largest square tile that fits exactly, and how many tiles are needed.",
    ],
  },
  {
    topicId: 59,
    learningObjectiveId: "59-prime-factors",
    starters: [
      "Write 12 as a product of prime factors.",
      "Write 30 as a product of prime factors.",
      "Write 45 as a product of prime factors.",
      "Write 100 as a product of prime factors.",
    ],
    masters: [
      "Write 360 as a product of prime factors in index notation, and use it to say whether 360 is divisible by 27.",
      "Write 504 in index notation, and use the prime factors to list three factors of 504 greater than 20.",
      "Two numbers are 2² × 3 and 2 × 3². Find their HCF and LCM from the prime factors alone.",
    ],
  },
  {
    topicId: 59,
    learningObjectiveId: "59-factor-trees",
    starters: [
      "Complete a factor tree for 18.",
      "Complete a factor tree for 24.",
      "Complete a factor tree for 50.",
      "Complete a factor tree for 36.",
    ],
    masters: [
      "Complete two different factor trees for 48 and explain why both end with the same prime factors.",
      "Build a factor tree for 720 and write the result in index notation.",
      "A factor tree ends in 2, 2, 5 and 5. What number did it start from? Write it in index notation.",
    ],
  },
  {
    topicId: 57,
    learningObjectiveId: "57-large-numbers",
    starters: [
      "Write 4,205,000 in words.",
      "Write 3,070,400 in words.",
      "Write ‘two million five hundred thousand’ in figures.",
      "What is the value of the 6 in 6,432,109?",
    ],
    masters: [
      "Write ‘seven million forty thousand and nine’, then increase it by 100,000.",
      "Write 8,009,050 in words, then write the number that is 10,000 less.",
      "Order these from smallest to largest and explain your method: 4,099,999 · 4,100,000 · 4,090,999.",
    ],
  },
  {
    topicId: 57,
    learningObjectiveId: "57-estimation",
    starters: [
      "Estimate 298 + 512 by rounding to hundreds.",
      "Estimate 4,812 − 1,979 by rounding to thousands.",
      "Estimate 39 × 21 by rounding to tens.",
      "Round 4,783,216 to the nearest hundred thousand.",
    ],
    masters: [
      "A student says 4,890 × 21 ≈ 10,000. Is that reasonable? Estimate properly and explain the error.",
      "Estimate 6,930,025 + 2,146,809, then say whether 69,300,250 could be the exact answer and why.",
      "A shop takes ₹4,982 a day. Estimate the takings for 31 days, then say whether your estimate is above or below the true value.",
    ],
  },
  {
    topicId: 57,
    learningObjectiveId: "57-order-operations",
    starters: [
      "12 + 3 × 2 = ?",
      "20 − 6 ÷ 2 = ?",
      "5 × 4 + 3 = ?",
      "18 ÷ 3 + 7 × 2 = ?",
    ],
    masters: [
      "36 ÷ (2 + 4) × 3 − 5 = ?",
      "50 − 3 × (4 + 2) ÷ 2 = ?",
      "Two students answer 2 + 4 × 3 as 14 and 18. Which is correct, and what did the other one do?",
    ],
  },
  {
    topicId: 57,
    learningObjectiveId: "57-brackets",
    starters: [
      "Solve (5 + 3) × 2 and 5 + 3 × 2. Why do they differ?",
      "Work out (10 − 4) × 3.",
      "Work out 10 − (4 × 3).",
      "Does 2 × (3 + 5) equal 2 × 3 + 5? Show why.",
    ],
    masters: [
      "Insert brackets to make this true: 4 + 8 ÷ 2 × 3 = 18.",
      "Insert brackets to make this true: 3 + 2 × 5 + 1 = 26.",
      "Using 4, 6 and 2 once each, write one expression with brackets giving 20 and one without brackets giving 16.",
    ],
  },
];

/** Lookup across every grade — topic IDs are unique across the curriculum. */
export const topicById = new Map(
  Object.values(curriculumByGrade)
    .flat()
    .map((topic) => [topic.id, topic]),
);

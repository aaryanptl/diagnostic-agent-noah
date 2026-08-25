import "server-only";

import { query } from "@/lib/db";
import { getCodingData } from "@/lib/csv-coding-loader";
import type {
  DemoQuizCatalog,
  DemoQuizCatalogEntry,
  DemoQuizQuestion,
} from "@/lib/demo-types";
import {
  getGradeTestPlan,
  getTopicTestQuestionCount,
  getValidMultiTopicQuestionCounts,
} from "@/lib/quiz-counts";
import type {
  BloomLevel,
  ClassLevel,
  DiagnosticRegion,
  DifficultyBand,
  DragDropQuestionPayload,
  FitbQuestionPayload,
  MatchingQuestionPayload,
  McqQuestionPayload,
  OpenResponseQuestionPayload,
  QuestionBankQuestion,
  QuestionType,
  ShortAnswerQuestionPayload,
  Subject,
  TrueFalseQuestionPayload,
  WordProblemQuestionPayload,
} from "../types/index";

type ContentQuestionRow = {
  id: string;
  question_type: string;
  question_text: string;
  question_svg?: string | null;
  subject: string;
  grade: string;
  grade_level?: string;
  topic: string;
  subtopic: string;
  learning_objective: string;
  blooms_level: string;
  difficulty_level: string;
  difficulty_rating: number | null;
  options: unknown;
  explanation: string | null;
  generation_metadata: unknown;
  region?: string | null;
  parent_id?: string | null;
};

export const DIAGNOSTIC_REGIONS = [
  "US",
  "UK",
  "UAE",
  "Ontario",
  "Australia",
] as const satisfies readonly DiagnosticRegion[];
export const DEFAULT_DIAGNOSTIC_REGION: DiagnosticRegion = "US";

const INTERACTIVE_QUESTION_TYPES = ["fitb", "drag_drop"] as const;
const MIN_INTERACTIVE_QUESTION_COUNTS: Record<
  (typeof INTERACTIVE_QUESTION_TYPES)[number],
  number
> = {
  fitb: 2,
  drag_drop: 1,
};
const GRADE_TEST_VISUAL_QUESTION_RATIO = 0.3;

declare global {
  // eslint-disable-next-line no-var
  var __diagnosticQuizCatalogPromise__: Promise<DemoQuizCatalog> | undefined;
}

const TOPIC_STANDARDIZATION_MAP: Record<string, Record<string, string[]>> = {
  class8: {
    "Properties of Quadrilaterals": [
      "quadrilaterals",
      "Quadrilaterals",
      "polygon properties",
      "Polygons",
      "Congruence and similarity",
      "Geometry",
      "triangle properties",
      "Triangles",
      "Properties of Quadrilaterals",
    ],
    "Geometric Constructions": [
      "angles",
      "Angles",
      "circle geometry",
      "lines and angles",
      "Lines and angles",
      "Lines and segments",
      "transformations",
      "Transformations",
      "Geometric Constructions",
    ],
    "Perimeter, Area & Volume": [
      "2D shapes",
      "perimeter and area",
      "Perimeter and area",
      "Perimeter, Area & Volume",
    ],
    "3D Shapes & Mensuration": ["3D shapes", "3D Shapes & Mensuration"],
  },
  class7: {
    "Circle Geometry": ["Geometry", "Circle Geometry"],
  },
  class5: {
    "2D & 3D Geometry": ["2D &3D Geometry", "2D & 3D Geometry"],
  },
};

export function getStandardizedTopicName(
  classLevel: string,
  rawTopic: string,
): string {
  const normRaw = rawTopic.trim();
  const classMap = TOPIC_STANDARDIZATION_MAP[classLevel];
  if (!classMap) return normRaw;

  for (const [standardized, rawList] of Object.entries(classMap)) {
    if (rawList.some((r) => r.toLowerCase().trim() === normRaw.toLowerCase())) {
      return standardized;
    }
  }
  return normRaw;
}

export function getRawTopicNames(
  classLevel: string,
  standardizedTopic: string,
): string[] {
  const normStd = standardizedTopic.trim();
  const classMap = TOPIC_STANDARDIZATION_MAP[classLevel];
  if (!classMap) return [normStd];

  for (const [standardized, rawList] of Object.entries(classMap)) {
    if (standardized.toLowerCase().trim() === normStd.toLowerCase()) {
      return rawList;
    }
  }
  return [normStd];
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function normalizeQuestionText(value: string | null | undefined): string {
  return normalizeText(value).replace(
    /^(Fill in the blank with the correct answer:|Drag each choice into the correct group:)\s*/i,
    "",
  );
}

function normalizeKey(value: string | null | undefined): string {
  return normalizeText(value).toLowerCase();
}

function toSubject(value: string | null | undefined): Subject {
  const normalized = normalizeKey(value);
  if (normalized === "science") return "Science";
  if (normalized === "english") return "English";
  if (normalized === "social studies") return "Social Studies";
  if (normalized === "coding-python" || normalized === "coding - python" || normalized === "python") return "coding-python";
  if (normalized === "coding-webdev" || normalized === "coding - webdev" || normalized === "webdev" || normalized === "web development") return "coding-webdev";
  return "Maths";
}

function toClassLevel(value: string | null | undefined): ClassLevel {
  const normalized = normalizeKey(value);
  if (normalized === "kg" || normalized === "classkg") return "classKG";
  const match = normalized.match(/\d+/);
  const grade = match ? Number(match[0]) : Number(normalized);
  if (grade <= 0) return "classKG";
  if (grade === 1) return "class1";
  if (grade === 2) return "class2";
  if (grade === 3) return "class3";
  if (grade === 4) return "class4";
  if (grade === 5) return "class5";
  if (grade === 6) return "class6";
  if (grade === 7) return "class7";
  return "class8";
}

function toDiagnosticRegion(
  value: string | null | undefined,
): DiagnosticRegion {
  const normalized = normalizeKey(value);
  return (
    DIAGNOSTIC_REGIONS.find((region) => normalizeKey(region) === normalized) ??
    DEFAULT_DIAGNOSTIC_REGION
  );
}

function toDbGrade(classLevel: ClassLevel) {
  return classLevel === "classKG" ? "KG" : classLevel.replace("class", "");
}

function toBloomLevel(value: string | null | undefined): BloomLevel {
  const normalized = normalizeKey(value);
  if (normalized === "knowing" || normalized === "remember") return "remember";
  if (normalized === "understanding" || normalized === "understand") {
    return "understand";
  }
  return "apply";
}

function toQuestionType(value: string | null | undefined): QuestionType {
  switch (normalizeKey(value)) {
    case "mcq":
      return "mcq";
    case "true_false":
      return "true_false";
    case "fitb":
      return "fitb";
    case "matching":
      return "matching";
    case "drag_drop":
    case "drag n drop":
    case "drag_n_drop":
    case "drag-and-drop":
      return "drag_drop";
    case "short_answer":
      return "short_answer";
    case "word_problem":
      return "word_problem";
    case "open_response":
      return "open_response";
    default:
      return "short_answer";
  }
}

function normalizeDifficultyBand(value?: string): DifficultyBand {
  const normalized = normalizeKey(value ?? "");
  if (normalized === "medium" || normalized === "hard") return normalized;
  return "easy";
}

function extractFocus(payload: Record<string, unknown>) {
  const payloadFocus =
    payload.metadata &&
    typeof payload.metadata === "object" &&
    "focus" in payload.metadata
      ? String((payload.metadata as Record<string, unknown>).focus ?? "")
      : "";

  if (payloadFocus.trim() !== "") {
    return normalizeText(payloadFocus);
  }

  const metadata =
    payload.metadata && typeof payload.metadata === "object"
      ? (payload.metadata as Record<string, unknown>)
      : undefined;
  return normalizeText(String(metadata?.focus ?? payload.focus ?? ""));
}

function buildKeywords(value: string): string[] {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9\-+.]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2),
    ),
  ).slice(0, 12);
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function toSvg(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.startsWith("<svg") ? trimmed : undefined;
}

function isNotCorrectDropZone(value: string | null | undefined) {
  return normalizeKey(value).replace(/[^a-z0-9]+/g, " ") === "not correct";
}

function toMcqOptions(value: unknown): McqQuestionPayload["options"] {
  const rawOptions = Array.isArray(value)
    ? value
    : toArray(toRecord(value).options);

  return rawOptions
    .map((option) => {
      if (typeof option === "string") {
        const svg = toSvg(option);
        return {
          text: svg ? "" : normalizeText(option),
          ...(svg ? { svg } : {}),
          correct: false,
        };
      }

      const record = toRecord(option);
      const correctValue = record.correct ?? record.is_correct;
      const svg = toSvg(
        record.svg ??
          record.option_svg ??
          record.image_svg ??
          record.visual_svg ??
          record.media,
      );
      return {
        text: normalizeText(
          String(record.text ?? record.label ?? record.value ?? ""),
        ),
        ...(svg ? { svg } : {}),
        correct:
          correctValue === true ||
          String(correctValue).toLowerCase() === "true",
      };
    })
    .filter((option) => option.text.length > 0 || Boolean(option.svg));
}

function getPayload(row: ContentQuestionRow) {
  const metadata = toRecord(row.generation_metadata);
  const nestedPayload = toRecord(metadata.payload);
  return Object.keys(nestedPayload).length > 0 ? nestedPayload : metadata;
}

function buildQuestion(row: ContentQuestionRow): QuestionBankQuestion {
  const questionType = toQuestionType(row.question_type);
  const subject = toSubject(row.subject);
  const classLevel = toClassLevel(row.grade);
  const payload = getPayload(row);
  const explanationFromColumn = normalizeText(row.explanation);
  const questionSvg =
    toSvg(row.question_svg) ??
    toSvg(payload.questionSvg) ??
    toSvg(payload.question_svg);

  let options: string[] | undefined;
  let correctAnswer: string | undefined;
  let modelAnswer: string | undefined;
  let explanation = "";
  let typedPayload: QuestionBankQuestion["payload"];

  if (questionType === "mcq") {
    const mcqOptionsFromColumn = toMcqOptions(row.options);
    const mcqOptions =
      mcqOptionsFromColumn.length > 0
        ? mcqOptionsFromColumn
        : toMcqOptions(payload.options);
    options = mcqOptions.map((option) => option.text);
    const correctIndex = mcqOptions.findIndex((option) => option.correct);
    correctAnswer =
      correctIndex >= 0 ? ["A", "B", "C", "D"][correctIndex] : undefined;
    explanation = explanationFromColumn;
    typedPayload = {
      options: mcqOptions,
      explanation: explanationFromColumn,
      ...(questionSvg ? { questionSvg } : {}),
    };
  } else if (questionType === "true_false") {
    const tfPayload = payload as unknown as TrueFalseQuestionPayload;
    options = ["True", "False"];
    explanation =
      normalizeText(tfPayload.explanation ?? "") || explanationFromColumn;
    typedPayload = { ...tfPayload, ...(questionSvg ? { questionSvg } : {}) };
  } else if (questionType === "fitb") {
    const fitbPayload = payload as unknown as FitbQuestionPayload & {
      blanks?: Array<{ answer?: string; text?: string }>;
    };
    let fitbAns = normalizeText(fitbPayload.answer ?? "");
    if (!fitbAns && Array.isArray(fitbPayload.blanks)) {
      fitbAns = fitbPayload.blanks
        .map((b) => normalizeText(b.answer || b.text || ""))
        .filter(Boolean)
        .join(", ");
    }
    modelAnswer = fitbAns;
    explanation =
      normalizeText(fitbPayload.hint ?? "") || explanationFromColumn;
    typedPayload = {
      ...fitbPayload,
      answer: fitbAns,
      ...(questionSvg ? { questionSvg } : {}),
    };
  } else if (questionType === "matching") {
    const matchingPayload = payload as any;

    // Support both new (items/targets) and old (premises/responses) schema
    let premises: string[] = matchingPayload.premises ?? [];
    if (premises.length === 0 && Array.isArray(matchingPayload.items)) {
      premises = matchingPayload.items.map(
        (i: any) => i.label || i.text || i.value || "",
      );
    }
    let responses: string[] = matchingPayload.responses ?? [];
    if (responses.length === 0 && Array.isArray(matchingPayload.targets)) {
      responses = matchingPayload.targets.map(
        (t: any) => t.label || t.text || t.value || "",
      );
    }

    let answerKey: any[] = matchingPayload.answerKey ?? [];
    if (answerKey.length === 0 && Array.isArray(matchingPayload.targets)) {
      const itemMap = new Map(
        (matchingPayload.items || []).map((i: any) => [
          i.id,
          i.label || i.text || "",
        ]),
      );
      const builtKey: any[] = [];
      for (const t of matchingPayload.targets) {
        if (t.correctItemId) {
          const itemLabel = itemMap.get(t.correctItemId) || t.correctItemId;
          const targetLabel = t.label || t.text || "";
          if (itemLabel && targetLabel) {
            builtKey.push({
              prompt: itemLabel,
              match: targetLabel,
            });
          }
        }
      }
      if (builtKey.length > 0) {
        answerKey = builtKey;
      }
    } else if (answerKey.length > 0 && answerKey[0].itemId) {
      answerKey = answerKey.map((ans: any) => {
        const itemObj = (matchingPayload.items || []).find(
          (i: any) => i.id === ans.itemId,
        );
        const targetObj = (matchingPayload.targets || []).find(
          (t: any) => t.id === ans.targetId,
        );
        return {
          prompt: itemObj
            ? itemObj.label || itemObj.text || ""
            : ans.prompt || "",
          match: targetObj
            ? targetObj.label || targetObj.text || ""
            : ans.match || "",
        };
      });
    }

    explanation =
      normalizeText(matchingPayload.scoringGuidance ?? "") ||
      explanationFromColumn;
    typedPayload = {
      ...matchingPayload,
      premises,
      responses,
      answerKey,
      ...(questionSvg ? { questionSvg } : {}),
    };
  } else if (questionType === "drag_drop") {
    const dragDropPayload = payload as any;

    // Support both new (items/targets) and old (draggableItems/dropZones) schema
    let draggableItems: string[] = dragDropPayload.draggableItems ?? [];
    if (draggableItems.length === 0 && Array.isArray(dragDropPayload.items)) {
      draggableItems = dragDropPayload.items.map(
        (i: any) => i.label || i.text || i.value || "",
      );
    }

    let dropZones: string[] = dragDropPayload.dropZones ?? [];
    if (dropZones.length === 0 && Array.isArray(dragDropPayload.targets)) {
      dropZones = dragDropPayload.targets.map(
        (t: any) => t.label || t.text || t.value || "",
      );
    }

    let answerKey: any[] = dragDropPayload.answerKey ?? [];
    if (answerKey.length === 0 && Array.isArray(dragDropPayload.targets)) {
      const itemMap = new Map(
        (dragDropPayload.items || []).map((i: any) => [
          i.id,
          i.label || i.text || "",
        ]),
      );
      const builtKey: any[] = [];
      for (const t of dragDropPayload.targets) {
        if (t.correctItemId) {
          const itemLabel = itemMap.get(t.correctItemId) || t.correctItemId;
          const targetLabel = t.label || t.text || "";
          if (itemLabel && targetLabel) {
            builtKey.push({
              item: itemLabel,
              target: targetLabel,
            });
          }
        }
      }
      if (builtKey.length > 0) {
        answerKey = builtKey;
      }
    } else if (answerKey.length > 0 && answerKey[0].itemId) {
      // Map itemId/targetId pointers back to actual string labels
      answerKey = answerKey.map((ans: any) => {
        const itemObj = (dragDropPayload.items || []).find(
          (i: any) => i.id === ans.itemId,
        );
        const targetObj = (dragDropPayload.targets || []).find(
          (t: any) => t.id === ans.targetId,
        );
        return {
          item: itemObj ? itemObj.label || itemObj.text || "" : ans.item || "",
          target: targetObj
            ? targetObj.label || targetObj.text || ""
            : ans.target || "",
        };
      });
    }

    const visibleDropZones = dropZones.filter(
      (dropZone) => !isNotCorrectDropZone(dropZone),
    );
    const visibleAnswerKey = answerKey.filter(
      (pair) => !isNotCorrectDropZone(pair.target),
    );
    explanation =
      normalizeText(dragDropPayload.scoringGuidance ?? "") ||
      explanationFromColumn;
    typedPayload = {
      ...dragDropPayload,
      draggableItems,
      dropZones: visibleDropZones,
      answerKey: visibleAnswerKey,
      ...(questionSvg ? { questionSvg } : {}),
    };
  } else if (questionType === "short_answer") {
    const shortAnswerPayload = payload as unknown as ShortAnswerQuestionPayload;
    modelAnswer = normalizeText(shortAnswerPayload.modelAnswer ?? "");
    explanation =
      normalizeText(shortAnswerPayload.scoringGuidance ?? "") ||
      explanationFromColumn;
    typedPayload = {
      ...shortAnswerPayload,
      ...(questionSvg ? { questionSvg } : {}),
    };
  } else if (questionType === "open_response") {
    const openResponsePayload =
      payload as unknown as OpenResponseQuestionPayload;
    modelAnswer = normalizeText(openResponsePayload.exemplarAnswer ?? "");
    explanation =
      normalizeText(openResponsePayload.scoringGuidance ?? "") ||
      explanationFromColumn;
    typedPayload = {
      ...openResponsePayload,
      ...(questionSvg ? { questionSvg } : {}),
    };
  } else {
    const wordProblemPayload = payload as unknown as WordProblemQuestionPayload;
    modelAnswer = normalizeText(wordProblemPayload.finalAnswer ?? "");
    explanation =
      normalizeText(wordProblemPayload.scoringGuidance ?? "") ||
      explanationFromColumn;
    typedPayload = {
      ...wordProblemPayload,
      ...(questionSvg ? { questionSvg } : {}),
    };
  }

  return {
    id: normalizeText(row.id),
    subject,
    topic: normalizeText(row.topic),
    subtopic: normalizeText(row.subtopic),
    learningObjective: normalizeText(row.learning_objective),
    difficultyLevel: normalizeText(row.difficulty_level),
    difficultyRating: row.difficulty_rating ?? undefined,
    classLevel,
    bloomLevel: toBloomLevel(row.blooms_level),
    questionType,
    question: normalizeQuestionText(row.question_text),
    options,
    correctAnswer,
    modelAnswer,
    explanation,
    focus: extractFocus(payload),
    keywords: buildKeywords(
      [
        row.topic,
        row.subtopic,
        row.learning_objective,
        modelAnswer ?? "",
        explanation,
      ].join(" "),
    ),
    gradeLevel: row.grade_level ? normalizeText(row.grade_level) : undefined,
    ...(row.region
      ? {
          region:
            normalizeKey(row.region) === "global"
              ? "global"
              : toDiagnosticRegion(row.region),
        }
      : {}),
    ...(row.parent_id ? { parentId: normalizeText(row.parent_id) } : {}),
    payload: typedPayload,
  };
}

const DIAGNOSTIC_BANK_CTE = `(
  SELECT
    id,
    question_type,
    question_text,
    question_svg,
    subject,
    grade,
    topic,
    subtopic,
    learning_objective,
    blooms_level,
    difficulty_level,
    difficulty_rating,
    options,
    explanation,
    generation_metadata,
    lower(region) AS region,
    parent_id,
    visual_mode,
    created_at
  FROM final_content_questions_1
  
  UNION ALL
  
  SELECT
    id,
    question_type,
    question_text,
    question_svg,
    subject,
    grade,
    topic,
    subtopic,
    learning_objective,
    blooms_level,
    difficulty_level,
    difficulty_rating,
    options,
    explanation,
    CASE 
      WHEN payload IS NOT NULL THEN generation_metadata::jsonb || jsonb_build_object('payload', payload::jsonb)
      ELSE generation_metadata::jsonb
    END AS generation_metadata,
    lower(region) AS region,
    NULL AS parent_id,
    visual_mode,
    created_at
  FROM english_content_questions
)`;

const CONTENT_QUESTION_SELECT = `
  SELECT
    id::text,
    question_type,
    question_text,
    question_svg,
    subject,
    grade,
    topic,
    subtopic,
    learning_objective,
    blooms_level,
    difficulty_level,
    difficulty_rating,
    options,
    explanation,
    generation_metadata,
    region,
    parent_id::text AS parent_id
  FROM ${DIAGNOSTIC_BANK_CTE} AS final_content_questions_1
`;

const QUESTION_VISUAL_MODE_TYPE_FILTER = `
  AND (
    visual_mode IS NULL
    OR lower(btrim(visual_mode)) <> 'question_svg'
    OR lower(btrim(question_type)) = 'mcq'
  )
`;

function toQuestions(rows: ContentQuestionRow[]) {
  return rows
    .filter((row) => row.id && row.question_text && row.question_type)
    .map(buildQuestion);
}

function normalizeStudentName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function shuffleItems<T>(items: T[]) {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }

  return shuffled;
}

function shuffleQuestionQueues(grouped: Map<string, QuestionBankQuestion[]>) {
  for (const [key, queue] of grouped) {
    grouped.set(key, shuffleItems(queue));
  }
}

async function loadDiagnosticQuizCatalog(): Promise<DemoQuizCatalog> {
  const codingData = getCodingData();
  let dbRows: any[] = [];
  try {
    const result = await query(`
      SELECT
        subject,
        grade,
        topic,
        array_agg(DISTINCT learning_objective) FILTER (
          WHERE learning_objective IS NOT NULL AND btrim(learning_objective) <> ''
        ) AS learning_objectives,
        count(*)::int AS question_count
      FROM ${DIAGNOSTIC_BANK_CTE} AS final_content_questions_1
      WHERE question_text IS NOT NULL
        AND question_type IS NOT NULL
        ${QUESTION_VISUAL_MODE_TYPE_FILTER}
        AND subject IS NOT NULL
        AND grade IS NOT NULL
        AND topic IS NOT NULL
      GROUP BY subject, grade, topic
      ORDER BY subject, grade, topic
    `);
    dbRows = result.rows;
  } catch (err) {
    console.warn("Database query failed in loadDiagnosticQuizCatalog, using CSV data:", err);
  }

  const rawEntries = [
    ...dbRows.map(
      (row: {
        subject: string;
        grade: string;
        topic: string;
        learning_objectives: string[] | null;
        question_count: number;
      }): DemoQuizCatalogEntry => {
        const classLevel = toClassLevel(row.grade);
        return {
          subject: toSubject(row.subject),
          classLevel,
          topic: getStandardizedTopicName(classLevel, row.topic),
          learningObjectives: (row.learning_objectives ?? [])
            .map(normalizeText)
            .filter(Boolean),
          questionCount: row.question_count,
        };
      },
    ),
    ...codingData.catalogEntries,
  ];

  // Merge duplicates resolving to same subject, classLevel, and topic
  const mergedMap = new Map<string, DemoQuizCatalogEntry>();
  for (const entry of rawEntries) {
    const key = `${entry.subject}-${entry.classLevel}-${entry.topic}`;
    const existing = mergedMap.get(key);
    if (existing) {
      const mergedLOs = Array.from(
        new Set([...existing.learningObjectives, ...entry.learningObjectives]),
      ).sort((left, right) => left.localeCompare(right));
      existing.learningObjectives = mergedLOs;
      existing.questionCount += entry.questionCount;
    } else {
      entry.learningObjectives.sort((left, right) => left.localeCompare(right));
      mergedMap.set(key, entry);
    }
  }

  const entries = Array.from(mergedMap.values()).sort((left, right) => {
    const byClass = left.classLevel.localeCompare(right.classLevel);
    if (byClass !== 0) return byClass;
    return left.topic.localeCompare(right.topic);
  });

  return { entries };
}

async function getCatalog() {
  if (process.env.NODE_ENV !== "production") {
    return loadDiagnosticQuizCatalog();
  }

  globalThis.__diagnosticQuizCatalogPromise__ ??= loadDiagnosticQuizCatalog();
  return globalThis.__diagnosticQuizCatalogPromise__;
}

async function loadTopicQuestions(input: {
  subject: Subject;
  classLevel: ClassLevel;
  topic: string;
  region: DiagnosticRegion;
}) {
  if (
    input.subject === "coding-python" ||
    input.subject === "coding-webdev" ||
    input.subject === "Python" ||
    input.subject === "WebDev"
  ) {
    const codingData = getCodingData();
    const questions = codingData.questions.filter(
      (q) =>
        (q.subject === input.subject ||
          (input.subject.includes("python") && q.subject?.includes("python")) ||
          (input.subject.includes("web") && q.subject?.includes("web"))) &&
        q.topic.toLowerCase() === input.topic.toLowerCase(),
    );
    for (const q of questions) {
      q.topic = input.topic;
    }
    return questions;
  }

  const rawTopics = getRawTopicNames(input.classLevel, input.topic);
  const result = await query(
    `
      ${CONTENT_QUESTION_SELECT}
      WHERE subject = $1
        AND grade = $2
        AND topic = $3
        AND region IN ('global', lower($4))
        AND question_text IS NOT NULL
        AND question_type IS NOT NULL
        ${QUESTION_VISUAL_MODE_TYPE_FILTER}
      ORDER BY learning_objective, difficulty_level, id
    `,
    [input.subject, toDbGrade(input.classLevel), input.topic, input.region],
  );

  const questions = toQuestions(result.rows as ContentQuestionRow[]);
  for (const q of questions) {
    q.topic = input.topic;
  }
  return questions;
}

async function loadGradeQuestions(input: {
  subject: Subject;
  classLevel: ClassLevel;
  region: DiagnosticRegion;
}) {
  if (
    input.subject === "coding-python" ||
    input.subject === "coding-webdev" ||
    input.subject === "Python" ||
    input.subject === "WebDev"
  ) {
    const codingData = getCodingData();
    return codingData.questions.filter(
      (q) =>
        q.subject === input.subject ||
        (input.subject.includes("python") && q.subject?.includes("python")) ||
        (input.subject.includes("web") && q.subject?.includes("web")),
    );
  }

  const targets = getGradeTestPlan(input.classLevel).difficultyTargets;
  const perTopicCandidateLimit = Math.max(
    targets.easy,
    targets.medium,
    targets.hard,
  );
  const result = await query(
    `
      WITH ranked_questions AS (
        SELECT
          id::text,
          question_type,
          question_text,
          question_svg,
          subject,
          grade,
          topic,
          subtopic,
          learning_objective,
          blooms_level,
          difficulty_level,
          difficulty_rating,
          options,
          explanation,
          generation_metadata,
          region,
          parent_id::text AS parent_id,
          row_number() OVER (
            PARTITION BY difficulty_level, topic
            ORDER BY
              CASE
                WHEN question_svg IS NOT NULL AND btrim(question_svg) <> '' THEN 0
                WHEN lower(btrim(COALESCE(visual_mode, ''))) = 'option_svg' THEN 0
                ELSE 1
              END,
              random()
          ) AS topic_difficulty_rank
        FROM ${DIAGNOSTIC_BANK_CTE} AS final_content_questions_1
        WHERE subject = $1
          AND grade = $2
          AND region IN ('global', lower($4))
          AND question_text IS NOT NULL
          AND question_type IS NOT NULL
          ${QUESTION_VISUAL_MODE_TYPE_FILTER}
      )
      SELECT
        id,
        question_type,
        question_text,
        question_svg,
        subject,
        grade,
        topic,
        subtopic,
        learning_objective,
        blooms_level,
        difficulty_level,
        difficulty_rating,
        options,
        explanation,
        generation_metadata,
        region,
        parent_id
      FROM ranked_questions
      WHERE topic_difficulty_rank <= $3
      ORDER BY topic, learning_objective, difficulty_level, id
    `,
    [
      input.subject,
      toDbGrade(input.classLevel),
      perTopicCandidateLimit,
      input.region,
    ],
  );

  return toQuestions(result.rows as ContentQuestionRow[]);
}

async function loadMultiTopicQuestions(input: {
  subject: Subject;
  classLevel: ClassLevel;
  topics: string[];
  region: DiagnosticRegion;
}) {
  if (
    input.subject === "coding-python" ||
    input.subject === "coding-webdev" ||
    input.subject === "Python" ||
    input.subject === "WebDev"
  ) {
    const codingData = getCodingData();
    const topicSet = new Set(input.topics.map((t) => t.toLowerCase()));
    return codingData.questions.filter(
      (q) =>
        (q.subject === input.subject ||
          (input.subject.includes("python") && q.subject?.includes("python")) ||
          (input.subject.includes("web") && q.subject?.includes("web"))) &&
        topicSet.has(q.topic.toLowerCase()),
    );
  }

  const selectedTopicByRawTopic = new Map<string, string>();

  for (const topic of input.topics) {
    for (const rawTopic of new Set([
      topic,
      ...getRawTopicNames(input.classLevel, topic),
    ])) {
      selectedTopicByRawTopic.set(rawTopic.trim().toLowerCase(), topic);
    }
  }

  const result = await query(
    `
      ${CONTENT_QUESTION_SELECT}
      WHERE subject = $1
        AND grade = $2
        AND lower(btrim(topic)) = ANY($3::text[])
        AND region IN ('global', lower($4))
        AND question_text IS NOT NULL
        AND question_type IS NOT NULL
        ${QUESTION_VISUAL_MODE_TYPE_FILTER}
      ORDER BY topic, learning_objective, difficulty_level, id
    `,
    [
      input.subject,
      toDbGrade(input.classLevel),
      Array.from(selectedTopicByRawTopic.keys()),
      input.region,
    ],
  );

  const questions = toQuestions(result.rows as ContentQuestionRow[]);
  for (const question of questions) {
    question.topic =
      selectedTopicByRawTopic.get(question.topic.trim().toLowerCase()) ??
      question.topic;
  }
  return questions;
}

async function getPreviouslyAnsweredQuestionIds(input: {
  studentId: string;
  testMode: "topic" | "multi_topic" | "grade";
  subject: Subject;
  classLevel: ClassLevel;
  region: DiagnosticRegion;
  topic?: string | null;
}) {
  const normalizedStudentName = normalizeStudentName(input.studentId);
  if (!normalizedStudentName) return new Set<string>();

  try {
    const rawTopics =
      input.testMode === "topic" && input.topic
        ? Array.from(
            new Set([
              normalizeText(input.topic),
              ...getRawTopicNames(input.classLevel, input.topic),
            ]),
          )
        : null;

    const result = await query(
      `
        SELECT DISTINCT qr.question_id::text AS question_id
        FROM public.diagnostic_students s
        INNER JOIN public.diagnostic_assessments a
          ON a.student_id = s.id
        INNER JOIN public.diagnostic_question_results qr
          ON qr.assessment_id = a.id
        WHERE s.normalized_name = $1
          AND s.current_class_level = $2
          AND a.test_mode = $3
          AND a.subject = $4
          AND a.class_level = $2
          AND ($5::text IS NULL OR a.topic = $5)
          AND COALESCE(a.region, lower('${DEFAULT_DIAGNOSTIC_REGION}')) = lower($6)
        LIMIT 1000
      `,
      [
        normalizedStudentName,
        toDbGrade(input.classLevel),
        input.testMode,
        input.subject,
        input.testMode === "topic" && input.topic
          ? normalizeText(input.topic)
          : null,
        input.region,
      ],
    );

    return new Set(
      (result.rows as Array<{ question_id: string }>).map(
        (row) => row.question_id,
      ),
    );
  } catch (error) {
    console.warn(
      `[diagnostic] Could not load previous question history: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return new Set<string>();
  }
}

function getTopicRequestedQuestionCount(input: {
  questions: QuestionBankQuestion[];
  maxQuestions: number;
}) {
  const distinctLearningObjectiveCount = new Set(
    input.questions
      .map((question) => question.learningObjective)
      .filter(Boolean),
  ).size;
  const learningObjectiveCount =
    distinctLearningObjectiveCount > 0 ? distinctLearningObjectiveCount : 1;
  return Math.min(
    input.maxQuestions > 0
      ? input.maxQuestions
      : getTopicTestQuestionCount(learningObjectiveCount),
    getTopicTestQuestionCount(learningObjectiveCount),
    input.questions.length,
  );
}

function preferUnseenQuestions(input: {
  questions: QuestionBankQuestion[];
  seenQuestionIds: Set<string>;
  requestedCount: number;
}) {
  if (input.seenQuestionIds.size === 0) return input.questions;

  const unseenQuestions = input.questions.filter(
    (question) => !input.seenQuestionIds.has(question.id),
  );

  return unseenQuestions.length >= input.requestedCount
    ? unseenQuestions
    : input.questions;
}

async function loadRecurringTestQuestions(input: {
  subject: Subject;
  classLevel: ClassLevel;
  failedTopics: string[];
  failedLOs: string[];
  excludedQuestionIds: string[];
  region: DiagnosticRegion;
}) {
  if (input.failedTopics.length === 0 && input.failedLOs.length === 0)
    return [];

  const result = await query(
    `
      ${CONTENT_QUESTION_SELECT}
      WHERE subject = $1
        AND grade = $2
        AND (
          topic = ANY($3::text[])
          OR learning_objective = ANY($5::text[])
        )
        AND region IN ('global', lower($6))
        AND id::text != ALL($4::text[])
        AND question_text IS NOT NULL
        AND question_type IS NOT NULL
        ${QUESTION_VISUAL_MODE_TYPE_FILTER}
      ORDER BY topic, learning_objective, difficulty_level, id
    `,
    [
      input.subject,
      toDbGrade(input.classLevel),
      input.failedTopics,
      input.excludedQuestionIds,
      input.failedLOs,
      input.region,
    ],
  );

  return toQuestions(result.rows as ContentQuestionRow[]);
}

function sortQuestionsForTopicQuiz(questions: QuestionBankQuestion[]) {
  const difficultyOrder: Record<DifficultyBand, number> = {
    easy: 0,
    medium: 1,
    hard: 2,
  };

  return [...questions].sort((left, right) => {
    const byDifficulty =
      difficultyOrder[normalizeDifficultyBand(left.difficultyLevel)] -
      difficultyOrder[normalizeDifficultyBand(right.difficultyLevel)];
    if (byDifficulty !== 0) return byDifficulty;

    const byObjective = (left.learningObjective ?? "").localeCompare(
      right.learningObjective ?? "",
    );
    if (byObjective !== 0) return byObjective;

    const bloomOrder: Record<BloomLevel, number> = {
      remember: 0,
      understand: 1,
      apply: 2,
    };
    const byBloom = bloomOrder[left.bloomLevel] - bloomOrder[right.bloomLevel];
    if (byBloom !== 0) return byBloom;

    return left.id.localeCompare(right.id);
  });
}

function buildBandQueues(questions: QuestionBankQuestion[]) {
  const grouped = new Map<DifficultyBand, Map<string, QuestionBankQuestion[]>>([
    ["easy", new Map()],
    ["medium", new Map()],
    ["hard", new Map()],
  ]);

  for (const question of sortQuestionsForTopicQuiz(questions)) {
    const band = normalizeDifficultyBand(question.difficultyLevel);
    const objective =
      question.learningObjective || "Untitled learning objective";
    const objectives = grouped.get(band);
    if (!objectives) continue;

    const queue = objectives.get(objective) ?? [];
    queue.push(question);
    objectives.set(objective, queue);
  }

  for (const objectives of grouped.values()) {
    shuffleQuestionQueues(objectives);
  }

  return grouped;
}

function takeRoundRobin(
  queuesByObjective: Map<string, QuestionBankQuestion[]>,
  count: number,
) {
  const selected: QuestionBankQuestion[] = [];
  const objectiveOrder = shuffleItems(
    Array.from(queuesByObjective.keys()).sort((left, right) =>
      left.localeCompare(right),
    ),
  );
  let cursor = 0;

  while (selected.length < count && objectiveOrder.length > 0) {
    const objective = objectiveOrder[cursor % objectiveOrder.length];
    const queue = queuesByObjective.get(objective);
    if (!queue || queue.length === 0) {
      objectiveOrder.splice(cursor % objectiveOrder.length, 1);
      if (objectiveOrder.length === 0) break;
      continue;
    }

    const nextQuestion = queue.shift();
    if (nextQuestion) {
      selected.push(nextQuestion);
      cursor += 1;
      continue;
    }

    objectiveOrder.splice(cursor % objectiveOrder.length, 1);
  }

  return selected;
}

function countRemainingQuestions(
  grouped: Map<DifficultyBand, Map<string, QuestionBankQuestion[]>>,
  band: DifficultyBand,
) {
  return Array.from(grouped.get(band)?.values() ?? []).reduce(
    (sum, queue) => sum + queue.length,
    0,
  );
}

function countSelectedQuestionsByBand(
  questions: QuestionBankQuestion[],
  band: DifficultyBand,
) {
  return questions.filter(
    (question) => normalizeDifficultyBand(question.difficultyLevel) === band,
  ).length;
}

function getInteractiveQuestionTarget(totalQuestions: number) {
  const minimumInteractiveQuestions = Object.values(
    MIN_INTERACTIVE_QUESTION_COUNTS,
  ).reduce((sum, count) => sum + count, 0);
  return Math.min(
    totalQuestions,
    Math.max(minimumInteractiveQuestions, Math.floor(totalQuestions / 3)),
  );
}

function isInteractiveQuestion(question: QuestionBankQuestion) {
  return INTERACTIVE_QUESTION_TYPES.includes(
    question.questionType as (typeof INTERACTIVE_QUESTION_TYPES)[number],
  );
}

function isVisualQuestion(question: QuestionBankQuestion) {
  const payload = question.payload as
    | {
        questionSvg?: unknown;
        options?: Array<{ svg?: unknown }>;
      }
    | undefined;

  return (
    typeof payload?.questionSvg === "string" ||
    Boolean(payload?.options?.some((option) => typeof option.svg === "string"))
  );
}

function getGradeVisualQuestionTarget(totalQuestions: number) {
  return Math.ceil(totalQuestions * GRADE_TEST_VISUAL_QUESTION_RATIO);
}

function buildInteractiveQueues(
  questions: QuestionBankQuestion[],
  groupKey: (question: QuestionBankQuestion) => string,
) {
  const queues = new Map<
    (typeof INTERACTIVE_QUESTION_TYPES)[number],
    Map<string, QuestionBankQuestion[]>
  >(
    INTERACTIVE_QUESTION_TYPES.map((questionType) => [
      questionType,
      new Map<string, QuestionBankQuestion[]>(),
    ]),
  );

  for (const question of sortQuestionsForTopicQuiz(questions)) {
    if (!isInteractiveQuestion(question)) continue;

    const questionType =
      question.questionType as (typeof INTERACTIVE_QUESTION_TYPES)[number];
    const grouped = queues.get(questionType);
    if (!grouped) continue;

    const key = groupKey(question);
    grouped.set(key, [...(grouped.get(key) ?? []), question]);
  }

  for (const groupedQuestions of queues.values()) {
    shuffleQuestionQueues(groupedQuestions);
  }

  return queues;
}

function countQueuedQuestions(
  grouped: Map<string, QuestionBankQuestion[]> | undefined,
) {
  return Array.from(grouped?.values() ?? []).reduce(
    (sum, queue) => sum + queue.length,
    0,
  );
}

function takeInteractiveQuestions(
  questions: QuestionBankQuestion[],
  requestedCount: number,
  groupKey: (question: QuestionBankQuestion) => string,
) {
  const selected: QuestionBankQuestion[] = [];
  const queues = buildInteractiveQueues(questions, groupKey);

  for (const questionType of INTERACTIVE_QUESTION_TYPES) {
    const requestedForType = Math.min(
      MIN_INTERACTIVE_QUESTION_COUNTS[questionType],
      requestedCount - selected.length,
    );
    if (requestedForType <= 0) break;

    selected.push(
      ...takeRoundRobin(
        queues.get(questionType) ?? new Map(),
        requestedForType,
      ),
    );
  }

  let cursor = 0;

  while (selected.length < requestedCount) {
    const availableTypes = INTERACTIVE_QUESTION_TYPES.filter(
      (questionType) => countQueuedQuestions(queues.get(questionType)) > 0,
    );
    if (availableTypes.length === 0) break;

    const questionType = availableTypes[cursor % availableTypes.length];
    const picked = takeRoundRobin(queues.get(questionType) ?? new Map(), 1);
    if (picked.length > 0) {
      selected.push(...picked);
      cursor += 1;
      continue;
    }

    cursor += 1;
  }

  return selected;
}

function countQuestionsByType(
  questions: QuestionBankQuestion[],
  questionType: (typeof INTERACTIVE_QUESTION_TYPES)[number],
) {
  return questions.filter((question) => question.questionType === questionType)
    .length;
}

function addInteractiveQuestionCoverageWarnings(input: {
  selected: QuestionBankQuestion[];
  available: QuestionBankQuestion[];
  warnings: string[];
}) {
  for (const questionType of INTERACTIVE_QUESTION_TYPES) {
    const availableCount = countQuestionsByType(input.available, questionType);
    const selectedCount = countQuestionsByType(input.selected, questionType);
    const requestedCount = Math.min(
      MIN_INTERACTIVE_QUESTION_COUNTS[questionType],
      availableCount,
    );

    if (selectedCount < requestedCount) {
      input.warnings.push(
        `Requested ${requestedCount} ${questionType} questions but only selected ${selectedCount}.`,
      );
    }
  }
}

function getFillQuestionsAfterInteractiveQuota(
  questions: QuestionBankQuestion[],
  selectedIds: Set<string>,
  remainingSlots: number,
) {
  const remaining = questions.filter(
    (question) => !selectedIds.has(question.id),
  );
  const nonInteractive = remaining.filter(
    (question) => !isInteractiveQuestion(question),
  );

  return nonInteractive.length >= remainingSlots ? nonInteractive : remaining;
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function orderByDifficultyAscending(questions: QuestionBankQuestion[]) {
  const bandOrder: Record<DifficultyBand, number> = {
    easy: 0,
    medium: 1,
    hard: 2,
  };
  return questions
    .map((question, index) => ({ question, index }))
    .sort((left, right) => {
      const bandDiff =
        bandOrder[normalizeDifficultyBand(left.question.difficultyLevel)] -
        bandOrder[normalizeDifficultyBand(right.question.difficultyLevel)];
      if (bandDiff !== 0) return bandDiff;
      return left.index - right.index;
    })
    .map((entry) => entry.question);
}

function mixQuestionTypes(questions: QuestionBankQuestion[]) {
  const seed = questions
    .map((question) => question.id)
    .sort((left, right) => left.localeCompare(right))
    .join("|");
  const buckets = new Map<QuestionType, QuestionBankQuestion[]>();

  for (const question of questions) {
    const bucket = buckets.get(question.questionType) ?? [];
    bucket.push(question);
    buckets.set(question.questionType, bucket);
  }

  for (const [questionType, bucket] of buckets) {
    buckets.set(
      questionType,
      [...bucket].sort(
        (left, right) =>
          hashString(`${seed}:${questionType}:${left.id}`) -
          hashString(`${seed}:${questionType}:${right.id}`),
      ),
    );
  }

  const mixed: QuestionBankQuestion[] = [];
  let lastType: QuestionType | null = null;

  while (mixed.length < questions.length) {
    const availableTypes = Array.from(buckets.entries())
      .filter(([, bucket]) => bucket.length > 0)
      .map(([questionType, bucket]) => ({
        questionType,
        remaining: bucket.length,
      }));
    if (availableTypes.length === 0) break;

    const candidates =
      availableTypes.length > 1
        ? availableTypes.filter((item) => item.questionType !== lastType)
        : availableTypes;
    const nextType = candidates.sort((left, right) => {
      const byRemaining = right.remaining - left.remaining;
      if (byRemaining !== 0) return byRemaining;
      return (
        hashString(`${seed}:${mixed.length}:${left.questionType}`) -
        hashString(`${seed}:${mixed.length}:${right.questionType}`)
      );
    })[0]?.questionType;
    if (!nextType) break;

    const nextQuestion = buckets.get(nextType)?.shift();
    if (!nextQuestion) break;

    mixed.push(nextQuestion);
    lastType = nextType;
  }

  return mixed;
}

function seedQuestionsAcrossObjectives(
  questions: QuestionBankQuestion[],
  count: number,
) {
  const selected: QuestionBankQuestion[] = [];
  const queuesByObjective = new Map<string, QuestionBankQuestion[]>();

  for (const question of sortQuestionsForTopicQuiz(questions)) {
    const objective =
      question.learningObjective || "Untitled learning objective";
    const queue = queuesByObjective.get(objective) ?? [];
    queue.push(question);
    queuesByObjective.set(objective, queue);
  }

  shuffleQuestionQueues(queuesByObjective);

  for (const objective of shuffleItems(
    Array.from(queuesByObjective.keys()).sort((a, b) => a.localeCompare(b)),
  )) {
    if (selected.length >= count) break;
    const nextQuestion = queuesByObjective.get(objective)?.shift();
    if (nextQuestion) selected.push(nextQuestion);
  }

  return selected;
}

function selectQuestionsAcrossLearningObjectives(
  questions: QuestionBankQuestion[],
  maxQuestions: number,
) {
  const selected: QuestionBankQuestion[] = [];
  const warnings: string[] = [];
  const distinctLearningObjectiveCount = new Set(
    questions.map((question) => question.learningObjective).filter(Boolean),
  ).size;
  const learningObjectiveCount =
    distinctLearningObjectiveCount > 0 ? distinctLearningObjectiveCount : 1;
  const requestedByLearningObjectives = getTopicTestQuestionCount(
    learningObjectiveCount,
  );
  const requestedTotal = Math.min(
    maxQuestions > 0 ? maxQuestions : requestedByLearningObjectives,
    requestedByLearningObjectives,
    questions.length,
  );

  // Pre-calculate target count per difficulty band to ensure balanced 1:1:1 ratio
  const targets: Record<DifficultyBand, number> = {
    easy: Math.floor(requestedTotal / 3),
    medium: Math.floor(requestedTotal / 3),
    hard: Math.floor(requestedTotal / 3),
  };

  // Distribute any remainder to easy, then medium
  let remainder =
    requestedTotal - (targets.easy + targets.medium + targets.hard);
  if (remainder > 0) {
    targets.easy += 1;
    remainder -= 1;
  }
  if (remainder > 0) {
    targets.medium += 1;
    remainder -= 1;
  }

  const interactiveTarget = Math.min(
    getInteractiveQuestionTarget(requestedTotal),
    questions.filter(isInteractiveQuestion).length,
  );
  selected.push(
    ...takeInteractiveQuestions(
      questions,
      interactiveTarget,
      (question) => question.learningObjective || "Untitled learning objective",
    ),
  );

  if (selected.length < interactiveTarget) {
    warnings.push(
      `Requested ${interactiveTarget} fitb/drag_drop questions but only found ${selected.length}.`,
    );
  }
  const selectedIds = new Set(selected.map((question) => question.id));
  const fillQuestions = getFillQuestionsAfterInteractiveQuota(
    questions,
    selectedIds,
    requestedTotal - selected.length,
  );
  const grouped = buildBandQueues(fillQuestions);

  for (const band of ["easy", "medium", "hard"] as const) {
    const requested = Math.min(
      Math.max(0, targets[band] - countSelectedQuestionsByBand(selected, band)),
      requestedTotal - selected.length,
    );
    if (requested <= 0) continue;

    const picked = takeRoundRobin(grouped.get(band) ?? new Map(), requested);
    selected.push(...picked);

    if (picked.length < requested) {
      warnings.push(
        `Requested ${requested} ${band} questions for this topic but only found ${picked.length}.`,
      );
    }
  }

  while (selected.length < requestedTotal) {
    const donorBand = (["easy", "medium", "hard"] as const)
      .map((band) => ({
        band,
        remaining: countRemainingQuestions(grouped, band),
      }))
      .sort((left, right) => right.remaining - left.remaining)[0];

    if (!donorBand || donorBand.remaining === 0) {
      break;
    }

    const fallbackPick = takeRoundRobin(
      grouped.get(donorBand.band) ?? new Map(),
      1,
    );
    if (fallbackPick.length === 0) {
      break;
    }

    selected.push(...fallbackPick);
  }

  if (selected.length < requestedTotal) {
    const usedIds = new Set(selected.map((question) => question.id));
    const coverageFill = questions.filter(
      (question) => !usedIds.has(question.id),
    );
    selected.push(
      ...seedQuestionsAcrossObjectives(
        coverageFill,
        requestedTotal - selected.length,
      ),
    );
  }

  if (selected.length < requestedTotal) {
    warnings.push(
      `Only ${selected.length} questions were available for the topic after balancing difficulty and learning objective coverage.`,
    );
  }
  addInteractiveQuestionCoverageWarnings({
    selected,
    available: questions,
    warnings,
  });

  return {
    questions: orderByDifficultyAscending(mixQuestionTypes(selected)),
    coverageWarnings: warnings.length > 0 ? warnings : undefined,
  };
}

function buildBandQueuesByTopic(questions: QuestionBankQuestion[]) {
  const grouped = new Map<DifficultyBand, Map<string, QuestionBankQuestion[]>>([
    ["easy", new Map()],
    ["medium", new Map()],
    ["hard", new Map()],
  ]);

  const sorted = [...questions].sort(
    (a, b) =>
      a.topic.localeCompare(b.topic) ||
      (a.learningObjective ?? "").localeCompare(b.learningObjective ?? ""),
  );

  for (const q of sorted) {
    const band = normalizeDifficultyBand(q.difficultyLevel);
    const topic = q.topic || "Untitled";
    const topicMap = grouped.get(band);
    if (!topicMap) continue;
    topicMap.set(topic, [...(topicMap.get(topic) ?? []), q]);
  }

  for (const topicMap of grouped.values()) {
    shuffleQuestionQueues(topicMap);
  }

  return grouped;
}

function takeVisualQuestionsMatchingGradeTargets(input: {
  questions: QuestionBankQuestion[];
  selected: QuestionBankQuestion[];
  targets: Record<DifficultyBand, number>;
  total: number;
  requestedCount: number;
}) {
  const selectedIds = new Set(input.selected.map((question) => question.id));
  const visualQueues = buildBandQueuesByTopic(
    input.questions.filter(
      (question) => isVisualQuestion(question) && !selectedIds.has(question.id),
    ),
  );
  let remainingVisualCount = Math.max(
    0,
    input.requestedCount - input.selected.filter(isVisualQuestion).length,
  );

  for (const band of ["easy", "medium", "hard"] as const) {
    if (remainingVisualCount <= 0 || input.selected.length >= input.total) {
      break;
    }

    const capacityWithinDifficultyTarget = Math.max(
      0,
      input.targets[band] - countSelectedQuestionsByBand(input.selected, band),
    );
    const requested = Math.min(
      remainingVisualCount,
      capacityWithinDifficultyTarget,
      input.total - input.selected.length,
    );
    if (requested <= 0) continue;

    const picked = takeRoundRobin(
      visualQueues.get(band) ?? new Map(),
      requested,
    );
    input.selected.push(...picked);
    remainingVisualCount -= picked.length;
  }
}

function buildGradeFillQueueTiers(
  questions: QuestionBankQuestion[],
  selectedIds: Set<string>,
) {
  const remaining = questions.filter(
    (question) => !selectedIds.has(question.id),
  );

  return [
    remaining.filter(
      (question) =>
        !isVisualQuestion(question) && !isInteractiveQuestion(question),
    ),
    remaining.filter(
      (question) =>
        !isVisualQuestion(question) && isInteractiveQuestion(question),
    ),
    remaining.filter(
      (question) =>
        isVisualQuestion(question) && !isInteractiveQuestion(question),
    ),
    remaining.filter(
      (question) =>
        isVisualQuestion(question) && isInteractiveQuestion(question),
    ),
  ].map(buildBandQueuesByTopic);
}

function takeGradeFillQuestions(
  tiers: Array<Map<DifficultyBand, Map<string, QuestionBankQuestion[]>>>,
  band: DifficultyBand,
  count: number,
) {
  const selected: QuestionBankQuestion[] = [];

  for (const tier of tiers) {
    if (selected.length >= count) break;
    selected.push(
      ...takeRoundRobin(tier.get(band) ?? new Map(), count - selected.length),
    );
  }

  return selected;
}

function countGradeRemainingQuestions(
  tiers: Array<Map<DifficultyBand, Map<string, QuestionBankQuestion[]>>>,
  band: DifficultyBand,
) {
  return tiers.reduce(
    (sum, tier) => sum + countRemainingQuestions(tier, band),
    0,
  );
}

function selectQuestionsForGradeTest(
  questions: QuestionBankQuestion[],
  classLevel: ClassLevel,
) {
  const plan = getGradeTestPlan(classLevel);
  const targets = plan.difficultyTargets;
  const selected: QuestionBankQuestion[] = [];
  const warnings: string[] = [];
  const total = Math.min(plan.total, questions.length);
  const interactiveTarget = Math.min(
    getInteractiveQuestionTarget(total),
    questions.filter(isInteractiveQuestion).length,
  );
  selected.push(
    ...takeInteractiveQuestions(
      questions,
      interactiveTarget,
      (question) => question.topic || "Untitled",
    ),
  );

  if (selected.length < interactiveTarget) {
    warnings.push(
      `Requested ${interactiveTarget} fitb/drag_drop questions but only found ${selected.length}.`,
    );
  }

  const visualTarget = getGradeVisualQuestionTarget(total);
  takeVisualQuestionsMatchingGradeTargets({
    questions,
    selected,
    targets,
    total,
    requestedCount: visualTarget,
  });

  const selectedIds = new Set(selected.map((question) => question.id));
  const fillQueueTiers = buildGradeFillQueueTiers(questions, selectedIds);

  for (const band of ["easy", "medium", "hard"] as const) {
    const requested = Math.min(
      Math.max(0, targets[band] - countSelectedQuestionsByBand(selected, band)),
      total - selected.length,
    );
    if (requested <= 0) continue;

    const picked = takeGradeFillQuestions(fillQueueTiers, band, requested);
    selected.push(...picked);
    if (picked.length < requested) {
      warnings.push(
        `Requested ${requested} ${band} questions but only found ${picked.length}.`,
      );
    }
  }

  while (selected.length < total) {
    const donor = (["easy", "medium", "hard"] as const)
      .map((b) => ({ b, n: countGradeRemainingQuestions(fillQueueTiers, b) }))
      .sort((a, z) => z.n - a.n)[0];
    if (!donor || donor.n === 0) break;
    const extra = takeGradeFillQuestions(fillQueueTiers, donor.b, 1);
    if (!extra.length) break;
    selected.push(...extra);
  }

  const selectedVisualCount = selected.filter(isVisualQuestion).length;
  if (selectedVisualCount < visualTarget) {
    warnings.push(
      `Requested ${visualTarget} visual questions within the grade difficulty targets but only selected ${selectedVisualCount}; filled remaining slots with available questions.`,
    );
  }

  if (selected.length < total) {
    warnings.push(
      `Only ${selected.length} of ${total} grade test questions available.`,
    );
  }
  addInteractiveQuestionCoverageWarnings({
    selected,
    available: questions,
    warnings,
  });

  return {
    questions: orderByDifficultyAscending(mixQuestionTypes(selected)),
    coverageWarnings: warnings.length ? warnings : undefined,
  };
}

function sanitizePayload(
  question: QuestionBankQuestion,
): DemoQuizQuestion["payload"] {
  const questionSvg = toSvg(
    (question.payload as { questionSvg?: unknown } | undefined)?.questionSvg,
  );
  const visualPayload: Record<string, string> = questionSvg
    ? { questionSvg }
    : {};

  if (question.questionType === "mcq") {
    const payload = question.payload as McqQuestionPayload | undefined;
    const options =
      payload?.options?.map((option) => ({
        ...(option.svg ? { svg: option.svg } : {}),
      })) ?? [];
    const hasOptionSvg = options.some((option) => Boolean(option.svg));
    const hasQuestionSvg = Boolean(visualPayload.questionSvg);

    return hasOptionSvg || hasQuestionSvg
      ? {
          ...visualPayload,
          ...(hasOptionSvg ? { options } : {}),
        }
      : undefined;
  }

  if (question.questionType === "matching") {
    const payload = question.payload as MatchingQuestionPayload | undefined;
    return payload
      ? {
          ...visualPayload,
          premises: payload.premises,
          responses: payload.responses,
        }
      : Object.keys(visualPayload).length > 0
        ? visualPayload
        : undefined;
  }

  if (question.questionType === "drag_drop") {
    const payload = question.payload as DragDropQuestionPayload | undefined;
    return payload
      ? {
          ...visualPayload,
          draggableItems: payload.draggableItems,
          dropZones: payload.dropZones,
        }
      : Object.keys(visualPayload).length > 0
        ? visualPayload
        : undefined;
  }

  if (question.questionType === "word_problem") {
    const payload = question.payload as WordProblemQuestionPayload | undefined;
    return payload
      ? {
          ...visualPayload,
          scenario: payload.scenario,
          hints: payload.hints,
          requiresCalculation: payload.requiresCalculation,
        }
      : Object.keys(visualPayload).length > 0
        ? visualPayload
        : undefined;
  }

  if (question.questionType === "fitb") {
    const payload = question.payload as FitbQuestionPayload | undefined;
    return payload
      ? {
          ...visualPayload,
          hint: payload.hint,
        }
      : Object.keys(visualPayload).length > 0
        ? visualPayload
        : undefined;
  }

  return Object.keys(visualPayload).length > 0 ? visualPayload : undefined;
}

export function toClientQuizQuestion(
  question: QuestionBankQuestion,
): DemoQuizQuestion {
  const {
    correctAnswer: _correctAnswer,
    modelAnswer: _modelAnswer,
    minimumCorrect: _minimumCorrect,
    expectedUnit: _expectedUnit,
    wordProblemStyle: _wordProblemStyle,
    ...rest
  } = question;

  return {
    ...rest,
    payload: sanitizePayload(question),
  };
}

export async function getDiagnosticQuizCatalog(): Promise<DemoQuizCatalog> {
  return getCatalog();
}

export async function getQuizQuestionsByIds(input: {
  questionIds: string[];
  subject: Subject;
  classLevel: ClassLevel;
  topic?: string | null;
  region?: DiagnosticRegion;
}) {
  const questionIds = Array.from(new Set(input.questionIds.filter(Boolean)));

  if (questionIds.length === 0) {
    return {
      subject: input.subject,
      classLevel: input.classLevel,
      topic: input.topic ? normalizeText(input.topic) : null,
      expectedLearningObjectives: [] as string[],
      questions: [] as QuestionBankQuestion[],
      coverageWarnings: ["No submitted question ids were provided."],
    };
  }

  if (
    input.subject === "coding-python" ||
    input.subject === "coding-webdev" ||
    input.subject === "Python" ||
    input.subject === "WebDev"
  ) {
    const codingData = getCodingData();
    const questionsById = new Map(codingData.questions.map((q) => [q.id, q]));
    const questions = questionIds.flatMap((id) => {
      const q = questionsById.get(id);
      return q ? [q] : [];
    });
    const expectedLearningObjectives = Array.from(
      new Set(questions.map((q) => q.learningObjective).filter(Boolean)),
    ) as string[];
    const missingCount = questionIds.length - questions.length;

    return {
      subject: input.subject,
      classLevel: input.classLevel,
      topic: input.topic ? normalizeText(input.topic) : null,
      expectedLearningObjectives,
      questions,
      coverageWarnings:
        missingCount > 0
          ? [`${missingCount} submitted questions could not be found.`]
          : undefined,
    };
  }

  const result = await query(
    `
      ${CONTENT_QUESTION_SELECT}
      WHERE id::text = ANY($1::text[])
        AND subject = $2
        AND grade = $3
        AND ($4::text IS NULL OR topic = $4)
        AND question_text IS NOT NULL
        AND question_type IS NOT NULL
        ${QUESTION_VISUAL_MODE_TYPE_FILTER}
      ORDER BY array_position($1::text[], id::text)
    `,
    [
      questionIds,
      input.subject,
      toDbGrade(input.classLevel),
      input.topic ? normalizeText(input.topic) : null,
    ],
  );

  const questionsById = new Map(
    toQuestions(result.rows as ContentQuestionRow[]).map((question) => [
      question.id,
      question,
    ]),
  );
  const questions = questionIds.flatMap((id) => {
    const question = questionsById.get(id);
    return question ? [question] : [];
  });
  const expectedLearningObjectives = Array.from(
    new Set(
      questions.map((question) => question.learningObjective).filter(Boolean),
    ),
  ) as string[];
  const missingCount = questionIds.length - questions.length;

  return {
    subject: input.subject,
    classLevel: input.classLevel,
    topic: input.topic ? normalizeText(input.topic) : null,
    expectedLearningObjectives,
    questions,
    coverageWarnings:
      missingCount > 0
        ? [`${missingCount} submitted questions could not be found.`]
        : undefined,
  };
}

export async function getTopicQuizQuestions(input: {
  subject: Subject;
  classLevel: ClassLevel;
  topic: string;
  maxQuestions: number;
  region?: DiagnosticRegion;
  questions?: QuestionBankQuestion[];
}) {
  const matchingQuestions =
    input.questions ??
    (await loadTopicQuestions({
      ...input,
      region: input.region ?? DEFAULT_DIAGNOSTIC_REGION,
    }));

  const { questions, coverageWarnings } =
    selectQuestionsAcrossLearningObjectives(
      matchingQuestions,
      input.maxQuestions,
    );
  const expectedLearningObjectives = Array.from(
    new Set(
      matchingQuestions
        .map((question) => question.learningObjective)
        .filter(Boolean),
    ),
  ) as string[];

  if (coverageWarnings && coverageWarnings.length > 0) {
    console.warn(
      `[diagnostic] Topic coverage warnings for "${normalizeText(input.topic)}": ${coverageWarnings.join(
        " ",
      )}`,
    );
  }

  return {
    subject: input.subject,
    classLevel: input.classLevel,
    topic: normalizeText(input.topic),
    expectedLearningObjectives,
    questions,
    coverageWarnings:
      matchingQuestions.length === 0
        ? [`No questions were found for ${input.topic}.`]
        : coverageWarnings,
  };
}

export async function getGradeQuizQuestions(input: {
  subject: Subject;
  classLevel: ClassLevel;
  region?: DiagnosticRegion;
  questions?: QuestionBankQuestion[];
}) {
  const gradeQuestions =
    input.questions ??
    (await loadGradeQuestions({
      ...input,
      region: input.region ?? DEFAULT_DIAGNOSTIC_REGION,
    }));
  const { questions, coverageWarnings } = selectQuestionsForGradeTest(
    gradeQuestions,
    input.classLevel,
  );

  if (coverageWarnings?.length) {
    console.warn(
      `[diagnostic] Grade test coverage for ${input.classLevel}: ${coverageWarnings.join(" ")}`,
    );
  }

  return {
    subject: input.subject,
    classLevel: input.classLevel,
    topic: null,
    expectedLearningObjectives: [] as string[],
    questions,
    coverageWarnings:
      gradeQuestions.length === 0
        ? [`No questions were found for ${input.classLevel}.`]
        : coverageWarnings,
  };
}

function selectExactTopicQuestionShare(
  questions: QuestionBankQuestion[],
  requestedCount: number,
) {
  const balanced = selectQuestionsAcrossLearningObjectives(
    questions,
    requestedCount,
  ).questions;
  const selectedIds = new Set(balanced.map((question) => question.id));
  const fill = shuffleItems(
    sortQuestionsForTopicQuiz(questions).filter(
      (question) => !selectedIds.has(question.id),
    ),
  );

  return mixQuestionTypes([...balanced, ...fill].slice(0, requestedCount));
}

function interleaveTopicQuestions(
  topics: string[],
  questionsByTopic: Map<string, QuestionBankQuestion[]>,
  perTopic: number,
) {
  const interleaved: QuestionBankQuestion[] = [];
  for (let questionIndex = 0; questionIndex < perTopic; questionIndex += 1) {
    for (const topic of topics) {
      const question = questionsByTopic.get(topic)?.[questionIndex];
      if (question) interleaved.push(question);
    }
  }
  return interleaved;
}

export async function getMultiTopicQuizQuestions(input: {
  subject: Subject;
  classLevel: ClassLevel;
  topics: string[];
  maxQuestions: number;
  region?: DiagnosticRegion;
  questions?: QuestionBankQuestion[];
}) {
  const topics = Array.from(
    new Set(input.topics.map((topic) => normalizeText(topic)).filter(Boolean)),
  );
  const validQuestionCounts = getValidMultiTopicQuestionCounts(topics.length);

  if (topics.length < 1 || topics.length > 5) {
    throw new Error("Select between 1 and 5 topics for a multi-topic test.");
  }
  if (!validQuestionCounts.includes(input.maxQuestions)) {
    throw new Error(
      "Choose 10 to 30 questions with an equal whole-number share for every topic.",
    );
  }

  const perTopic = input.maxQuestions / topics.length;
  const availableQuestions =
    input.questions ??
    (await loadMultiTopicQuestions({
      ...input,
      topics,
      region: input.region ?? DEFAULT_DIAGNOSTIC_REGION,
    }));
  const questionsByTopic = new Map<string, QuestionBankQuestion[]>();

  for (const topic of topics) {
    const candidates = availableQuestions.filter(
      (question) => question.topic === topic,
    );
    const selected = selectExactTopicQuestionShare(candidates, perTopic);
    if (selected.length !== perTopic) {
      throw new Error(
        `${topic} can currently provide ${selected.length} of the required ${perTopic} questions. Choose fewer questions or another topic.`,
      );
    }
    questionsByTopic.set(topic, selected);
  }

  const questions = interleaveTopicQuestions(
    topics,
    questionsByTopic,
    perTopic,
  );

  return {
    subject: input.subject,
    classLevel: input.classLevel,
    topic: null,
    selectedTopics: topics,
    expectedLearningObjectives: Array.from(
      new Set(
        questions.map((question) => question.learningObjective).filter(Boolean),
      ),
    ) as string[],
    questions,
  };
}

export async function getTopicQuizForClient(input: {
  studentId: string;
  subject: Subject;
  classLevel: ClassLevel;
  topic: string;
  maxQuestions: number;
  region?: DiagnosticRegion;
}) {
  const region = input.region ?? DEFAULT_DIAGNOSTIC_REGION;
  const matchingQuestions = await loadTopicQuestions({ ...input, region });
  const seenQuestionIds = await getPreviouslyAnsweredQuestionIds({
    studentId: input.studentId,
    testMode: "topic",
    subject: input.subject,
    classLevel: input.classLevel,
    region,
    topic: input.topic,
  });
  const quiz = await getTopicQuizQuestions({
    ...input,
    questions: preferUnseenQuestions({
      questions: matchingQuestions,
      seenQuestionIds,
      requestedCount: getTopicRequestedQuestionCount({
        questions: matchingQuestions,
        maxQuestions: input.maxQuestions,
      }),
    }),
  });

  return {
    studentId: input.studentId,
    region,
    testMode: "topic" as const,
    subject: quiz.subject,
    classLevel: quiz.classLevel,
    topic: quiz.topic,
    expectedLearningObjectives: quiz.expectedLearningObjectives,
    maxQuestions: quiz.questions.length,
    questions: quiz.questions.map(toClientQuizQuestion),
  };
}

export async function getGradeQuizForClient(input: {
  studentId: string;
  subject: Subject;
  classLevel: ClassLevel;
  region?: DiagnosticRegion;
}) {
  const region = input.region ?? DEFAULT_DIAGNOSTIC_REGION;
  const gradeQuestions = await loadGradeQuestions({ ...input, region });
  const seenQuestionIds = await getPreviouslyAnsweredQuestionIds({
    studentId: input.studentId,
    testMode: "grade",
    subject: input.subject,
    classLevel: input.classLevel,
    region,
  });
  const quiz = await getGradeQuizQuestions({
    ...input,
    questions: preferUnseenQuestions({
      questions: gradeQuestions,
      seenQuestionIds,
      requestedCount: Math.min(
        getGradeTestPlan(input.classLevel).total,
        gradeQuestions.length,
      ),
    }),
  });
  const targets = getGradeTestPlan(input.classLevel).difficultyTargets;
  const topicsInGrade = Array.from(
    new Set(quiz.questions.map((q) => q.topic).filter(Boolean)),
  ).sort();

  return {
    studentId: input.studentId,
    region,
    testMode: "grade" as const,
    subject: input.subject,
    classLevel: input.classLevel,
    topic: null,
    expectedLearningObjectives: [] as string[],
    topicsInGrade,
    maxQuestions: quiz.questions.length,
    gradeTargets: targets,
    questions: quiz.questions.map(toClientQuizQuestion),
    coverageWarnings: quiz.coverageWarnings,
  };
}

export async function getMultiTopicQuizForClient(input: {
  studentId: string;
  subject: Subject;
  classLevel: ClassLevel;
  topics: string[];
  maxQuestions: number;
  region?: DiagnosticRegion;
}) {
  const region = input.region ?? DEFAULT_DIAGNOSTIC_REGION;
  const topics = Array.from(
    new Set(input.topics.map((topic) => normalizeText(topic)).filter(Boolean)),
  );
  const validQuestionCounts = getValidMultiTopicQuestionCounts(topics.length);
  if (topics.length < 1 || topics.length > 5) {
    throw new Error("Select between 1 and 5 topics for a multi-topic test.");
  }
  if (!validQuestionCounts.includes(input.maxQuestions)) {
    throw new Error(
      "Choose 10 to 30 questions with an equal whole-number share for every topic.",
    );
  }
  const allQuestions = await loadMultiTopicQuestions({
    ...input,
    topics,
    region,
  });
  const seenQuestionIds = await getPreviouslyAnsweredQuestionIds({
    studentId: input.studentId,
    testMode: "multi_topic",
    subject: input.subject,
    classLevel: input.classLevel,
    region,
  });
  const perTopic = input.maxQuestions / topics.length;
  const preferredQuestions = topics.flatMap((topic) => {
    const topicQuestions = allQuestions.filter(
      (question) => question.topic === topic,
    );
    return preferUnseenQuestions({
      questions: topicQuestions,
      seenQuestionIds,
      requestedCount: perTopic,
    });
  });
  const quiz = await getMultiTopicQuizQuestions({
    ...input,
    topics,
    region,
    questions: preferredQuestions,
  });

  return {
    studentId: input.studentId,
    region,
    testMode: "multi_topic" as const,
    subject: input.subject,
    classLevel: input.classLevel,
    topic: null,
    selectedTopics: quiz.selectedTopics,
    topicsInGrade: quiz.selectedTopics,
    expectedLearningObjectives: quiz.expectedLearningObjectives,
    maxQuestions: quiz.questions.length,
    questions: quiz.questions.map(toClientQuizQuestion),
  };
}

/** Scale target question count based on number of failed topics (8–16). */
function recurringTestQuestionCount(failedTopicCount: number): number {
  if (failedTopicCount <= 1) return 8;
  if (failedTopicCount === 2) return 10;
  if (failedTopicCount === 3) return 12;
  if (failedTopicCount === 4) return 14;
  return 16;
}

function selectQuestionsForRecurringTest(
  questions: QuestionBankQuestion[],
  targetCount: number,
) {
  const selected = takeInteractiveQuestions(
    questions,
    Math.min(getInteractiveQuestionTarget(targetCount), questions.length),
    (question) => question.topic || "Untitled",
  );
  const selectedIds = new Set(selected.map((question) => question.id));
  const byTopic = new Map<string, QuestionBankQuestion[]>();

  for (const question of sortQuestionsForTopicQuiz(questions)) {
    if (selectedIds.has(question.id)) continue;

    const key = question.topic || "Untitled";
    byTopic.set(key, [...(byTopic.get(key) ?? []), question]);
  }

  selected.push(...takeRoundRobin(byTopic, targetCount - selected.length));

  return selected;
}

export async function getRecurringTestForClient(input: {
  studentId: string;
  subject: Subject;
  classLevel: ClassLevel;
  region?: DiagnosticRegion;
  failedTopics: string[];
  failedLOs: string[];
  excludedQuestionIds: string[];
}) {
  const region = input.region ?? DEFAULT_DIAGNOSTIC_REGION;
  const targetCount = recurringTestQuestionCount(input.failedTopics.length);

  // Load fresh candidate questions from failed topics only, excluding seen IDs
  const candidates = await loadRecurringTestQuestions({
    subject: input.subject,
    classLevel: input.classLevel,
    failedTopics: input.failedTopics,
    failedLOs: input.failedLOs,
    excludedQuestionIds: input.excludedQuestionIds,
    region,
  });

  const selected = selectQuestionsForRecurringTest(candidates, targetCount);
  const mixed = mixQuestionTypes(selected);

  return {
    studentId: input.studentId,
    region,
    testMode: "recurring" as const,
    subject: input.subject,
    classLevel: input.classLevel,
    failedTopics: input.failedTopics,
    targetQuestionCount: targetCount,
    maxQuestions: mixed.length,
    questions: mixed.map(toClientQuizQuestion),
  };
}

export async function loadPlacementQuestions(input: {
  subject: Subject;
  classLevel: ClassLevel;
}) {
  const result = await query(
    `
      SELECT
        id::text,
        question_type,
        question_text,
        subject,
        grade,
        grade_level,
        topic,
        subtopic,
        learning_objective,
        blooms_level,
        difficulty_level,
        difficulty_rating,
        options,
        explanation,
        generation_metadata
      FROM placement_test_questions_v2
      WHERE subject = $1
        AND grade = $2
        AND question_text IS NOT NULL
        AND question_type IS NOT NULL
      ORDER BY id
    `,
    [input.subject, toDbGrade(input.classLevel)],
  );

  return toQuestions(result.rows as ContentQuestionRow[]);
}

export async function getPlacementQuestionsByIds(input: {
  questionIds: string[];
  subject: Subject;
  classLevel: ClassLevel;
}) {
  const questionIds = Array.from(new Set(input.questionIds.filter(Boolean)));

  if (questionIds.length === 0) {
    return {
      subject: input.subject,
      classLevel: input.classLevel,
      topic: "Placement Test",
      expectedLearningObjectives: [] as string[],
      questions: [] as QuestionBankQuestion[],
    };
  }

  if (
    input.subject === "coding-python" ||
    input.subject === "coding-webdev" ||
    input.subject === "Python" ||
    input.subject === "WebDev"
  ) {
    const codingData = getCodingData();
    const questionsById = new Map(codingData.questions.map((q) => [q.id, q]));
    const questions = questionIds.flatMap((id) => {
      const q = questionsById.get(id);
      return q ? [q] : [];
    });
    const expectedLearningObjectives = Array.from(
      new Set(questions.map((q) => q.learningObjective).filter(Boolean)),
    ) as string[];

    return {
      subject: input.subject,
      classLevel: input.classLevel,
      topic: "Placement Test",
      expectedLearningObjectives,
      questions,
    };
  }

  const result = await query(
    `
      SELECT
        id::text,
        question_type,
        question_text,
        subject,
        grade,
        grade_level,
        topic,
        subtopic,
        learning_objective,
        blooms_level,
        difficulty_level,
        difficulty_rating,
        options,
        explanation,
        generation_metadata
      FROM placement_test_questions_v2
      WHERE id::text = ANY($1::text[])
        AND subject = $2
        AND grade = $3
      ORDER BY array_position($1::text[], id::text)
    `,
    [questionIds, input.subject, toDbGrade(input.classLevel)],
  );

  const questions = toQuestions(result.rows as ContentQuestionRow[]);
  const expectedLearningObjectives = Array.from(
    new Set(questions.map((q) => q.learningObjective).filter(Boolean)),
  ) as string[];

  return {
    subject: input.subject,
    classLevel: input.classLevel,
    topic: "Placement Test",
    expectedLearningObjectives,
    questions,
  };
}

export async function getPlacementQuizForClient(input: {
  studentId: string;
  subject: Subject;
  classLevel: ClassLevel;
}) {
  const allQuestions = await loadPlacementQuestions(input);

  // Requirement: Easy -> Medium -> Hard
  const sortedQuestions = orderByDifficultyAscending(allQuestions);

  return {
    studentId: input.studentId,
    testMode: "placement" as const,
    subject: input.subject,
    classLevel: input.classLevel,
    topic: "Placement Test",
    expectedLearningObjectives: Array.from(
      new Set(sortedQuestions.map((q) => q.learningObjective).filter(Boolean)),
    ),
    maxQuestions: sortedQuestions.length,
    questions: sortedQuestions.map(toClientQuizQuestion),
  };
}

/* -------------------------------------------------------------------------- */
/*  Generic question-serving API                                              */
/*  Flexible, filterable read access over the question banks. Reuses the same */
/*  row -> typed-question mapping (buildQuestion) as the diagnostic flow so    */
/*  the output shape is identical everywhere.                                  */
/* -------------------------------------------------------------------------- */

/** Which physical question bank a request reads from. */
export type QuestionSource = "diagnostic" | "placement";

export const QUESTION_SOURCES = ["diagnostic", "placement"] as const;
export const QUESTION_TYPES = [
  "mcq",
  "true_false",
  "fitb",
  "matching",
  "drag_drop",
  "short_answer",
  "word_problem",
  "open_response",
] as const satisfies readonly QuestionType[];
export const DIFFICULTY_BANDS = ["easy", "medium", "hard"] as const;

/**
 * Bloom levels accepted by the *filter*. The diagnostic type system collapses
 * to three buckets, but the raw banks also store "Analyzing" — exposed here as
 * `analyze` so callers can target it precisely. (Output `bloomLevel` still maps
 * analyze -> apply, matching the rest of the diagnostic pipeline.)
 */
export const BLOOM_LEVELS = ["remember", "understand", "apply"] as const;
// The banks store six Bloom buckets (Knowing/Understanding/Applying/Analyzing/
// Evaluating/Creating). Filtering supports all six; output `bloomLevel` still
// collapses the upper three to "apply" (existing diagnostic behaviour).
export const BLOOM_FILTERS = [
  "remember",
  "understand",
  "apply",
  "analyze",
  "evaluate",
  "create",
] as const;
export type BloomFilter = (typeof BLOOM_FILTERS)[number];

export const DIFFICULTY_RATING_MIN = 1;
export const DIFFICULTY_RATING_MAX = 5;

export const QUESTION_ORDERINGS = [
  "default",
  "random",
  "difficulty",
  "difficulty_desc",
  "rating",
  "rating_desc",
  "newest",
  "oldest",
] as const;

export type QuestionOrdering = (typeof QUESTION_ORDERINGS)[number];

/**
 * Canonical question type -> every spelling that appears in the DB.
 * Lets us filter accurately at the SQL layer even though the source data is
 * inconsistent (e.g. "drag n drop" vs "drag_drop").
 */
const QUESTION_TYPE_DB_ALIASES: Record<QuestionType, string[]> = {
  mcq: ["mcq"],
  true_false: ["true_false"],
  fitb: ["fitb"],
  matching: ["matching"],
  drag_drop: ["drag_drop", "drag n drop", "drag_n_drop", "drag-and-drop"],
  short_answer: ["short_answer"],
  word_problem: ["word_problem"],
  open_response: ["open_response"],
};

const BLOOM_DB_ALIASES: Record<BloomFilter, string[]> = {
  remember: ["remember", "remembering", "knowing"],
  understand: ["understand", "understanding"],
  apply: ["apply", "applying"],
  analyze: ["analyze", "analyse", "analyzing"],
  evaluate: ["evaluate", "evaluating"],
  create: ["create", "creating"],
};

const PLACEMENT_QUESTION_SELECT = `
  SELECT
    id::text,
    question_type,
    question_text,
    subject,
    grade,
    grade_level,
    topic,
    subtopic,
    learning_objective,
    blooms_level,
    difficulty_level,
    difficulty_rating,
    options,
    explanation,
    generation_metadata
  FROM placement_test_questions_v2
`;

const DIFFICULTY_ORDER_SQL = `
  CASE lower(btrim(difficulty_level))
    WHEN 'easy' THEN 0
    WHEN 'medium' THEN 1
    WHEN 'hard' THEN 2
    ELSE 3
  END`;

export interface ServeQuestionsFilters {
  source: QuestionSource;
  subject?: Subject;
  classLevel?: ClassLevel;
  /** Only applied to the region-aware diagnostic bank. */
  region: DiagnosticRegion;
  /** Exact (case-insensitive) topic match; accepts several. */
  topics?: string[];
  subtopics?: string[];
  learningObjectives?: string[];
  questionTypes?: QuestionType[];
  difficulties?: DifficultyBand[];
  blooms?: BloomFilter[];
  /** difficulty_rating bounds (1-5). */
  minRating?: number;
  maxRating?: number;
  /** Restrict to / exclude specific question ids. */
  ids?: string[];
  excludeIds?: string[];
  /** Placement only — e.g. "Q1". */
  questionNumber?: string;
  /** Case-insensitive substring match on the question text. */
  search?: string;
}

export interface ServeQuestionsParams extends ServeQuestionsFilters {
  order: QuestionOrdering;
  limit: number;
  offset: number;
}

export interface ServeQuestionsResult {
  questions: QuestionBankQuestion[];
  total: number;
}

/**
 * Builds the shared FROM/WHERE clause (and bound values) for a filter set, so
 * the list, count, and facet queries all apply identical predicates.
 */
function buildQuestionFilters(filters: ServeQuestionsFilters): {
  table: string;
  isPlacement: boolean;
  where: string;
  values: unknown[];
} {
  const isPlacement = filters.source === "placement";
  const table = isPlacement
    ? "placement_test_questions_v2"
    : `${DIAGNOSTIC_BANK_CTE} AS final_content_questions_1`;

  const conditions: string[] = [
    "question_text IS NOT NULL",
    "question_type IS NOT NULL",
  ];
  const values: unknown[] = [];
  const bind = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  const lowerList = (items: string[]) =>
    items.map((item) => item.trim().toLowerCase()).filter(Boolean);

  if (filters.subject) conditions.push(`subject = ${bind(filters.subject)}`);
  if (filters.classLevel) {
    conditions.push(`grade = ${bind(toDbGrade(filters.classLevel))}`);
  }

  if (filters.topics?.length) {
    conditions.push(
      `lower(btrim(topic)) = ANY(${bind(lowerList(filters.topics))}::text[])`,
    );
  }
  if (filters.subtopics?.length) {
    conditions.push(
      `lower(btrim(subtopic)) = ANY(${bind(lowerList(filters.subtopics))}::text[])`,
    );
  }
  if (filters.learningObjectives?.length) {
    conditions.push(
      `lower(btrim(learning_objective)) = ANY(${bind(
        lowerList(filters.learningObjectives),
      )}::text[])`,
    );
  }
  if (filters.search) {
    conditions.push(`question_text ILIKE ${bind(`%${filters.search}%`)}`);
  }

  if (filters.questionTypes?.length) {
    const spellings = filters.questionTypes.flatMap(
      (type) => QUESTION_TYPE_DB_ALIASES[type],
    );
    conditions.push(
      `lower(btrim(question_type)) = ANY(${bind(spellings)}::text[])`,
    );
  }
  if (filters.difficulties?.length) {
    conditions.push(
      `lower(btrim(difficulty_level)) = ANY(${bind(filters.difficulties)}::text[])`,
    );
  }
  if (filters.blooms?.length) {
    const spellings = filters.blooms.flatMap(
      (bloom) => BLOOM_DB_ALIASES[bloom],
    );
    conditions.push(
      `lower(btrim(blooms_level)) = ANY(${bind(spellings)}::text[])`,
    );
  }
  if (typeof filters.minRating === "number") {
    conditions.push(`difficulty_rating >= ${bind(filters.minRating)}`);
  }
  if (typeof filters.maxRating === "number") {
    conditions.push(`difficulty_rating <= ${bind(filters.maxRating)}`);
  }

  if (filters.ids?.length) {
    conditions.push(`id::text = ANY(${bind(filters.ids)}::text[])`);
  }
  if (filters.excludeIds?.length) {
    conditions.push(`id::text <> ALL(${bind(filters.excludeIds)}::text[])`);
  }

  // Region + visual-mode filters only exist on the diagnostic bank.
  if (table.includes(DIAGNOSTIC_BANK_CTE)) {
    conditions.push(`region IN ('global', lower(${bind(filters.region)}))`);
    conditions.push(`(
      visual_mode IS NULL
      OR lower(btrim(visual_mode)) <> 'question_svg'
      OR lower(btrim(question_type)) = 'mcq'
    )`);
  } else if (filters.questionNumber) {
    conditions.push(`question_number = ${bind(filters.questionNumber)}`);
  }

  return {
    table,
    isPlacement,
    where: `WHERE ${conditions.join("\n    AND ")}`,
    values,
  };
}

/**
 * Filterable, paginated read over a question bank.
 * Returns fully-typed questions (with answer keys); callers decide whether to
 * strip them for client delivery via `toClientQuizQuestion`.
 */
export async function serveQuestions(
  params: ServeQuestionsParams,
): Promise<ServeQuestionsResult> {
  const { table, isPlacement, where, values } = buildQuestionFilters(params);

  const countResult = await query(
    `SELECT count(*)::int AS total FROM ${table} ${where}`,
    values,
  );
  const total: number = countResult.rows[0]?.total ?? 0;

  const orderBy = (() => {
    switch (params.order) {
      case "random":
        return "ORDER BY random()";
      case "difficulty":
        return `ORDER BY ${DIFFICULTY_ORDER_SQL}, id`;
      case "difficulty_desc":
        return `ORDER BY ${DIFFICULTY_ORDER_SQL} DESC, id`;
      case "rating":
        return "ORDER BY difficulty_rating ASC NULLS LAST, id";
      case "rating_desc":
        return "ORDER BY difficulty_rating DESC NULLS LAST, id";
      case "newest":
        return "ORDER BY created_at DESC NULLS LAST, id";
      case "oldest":
        return "ORDER BY created_at ASC NULLS LAST, id";
      default:
        return isPlacement
          ? "ORDER BY id"
          : "ORDER BY subject, grade, topic, learning_objective, difficulty_level, id";
    }
  })();

  const listValues = [...values, params.limit, params.offset];
  const limitPlaceholder = `$${listValues.length - 1}`;
  const offsetPlaceholder = `$${listValues.length}`;
  const select = isPlacement
    ? PLACEMENT_QUESTION_SELECT
    : CONTENT_QUESTION_SELECT;

  const result = await query(
    `${select} ${where} ${orderBy} LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
    listValues,
  );

  return {
    questions: toQuestions(result.rows as ContentQuestionRow[]),
    total,
  };
}

export interface QuestionFacetBucket {
  value: string;
  count: number;
}

export interface QuestionFacets {
  total: number;
  byQuestionType: QuestionFacetBucket[];
  byDifficulty: QuestionFacetBucket[];
  byBloom: QuestionFacetBucket[];
  byRating: QuestionFacetBucket[];
  byGrade: QuestionFacetBucket[];
  byTopic: QuestionFacetBucket[];
}

/**
 * Aggregated counts for the questions matching a filter set — useful for
 * "what do we have?" dashboards and for sizing a quiz before fetching it.
 */
export async function getQuestionFacets(
  filters: ServeQuestionsFilters,
): Promise<QuestionFacets> {
  const { table, where, values } = buildQuestionFilters(filters);

  const facetOf = async (expr: string, limit = 100) => {
    const result = await query(
      `SELECT ${expr} AS value, count(*)::int AS count
       FROM ${table} ${where}
       GROUP BY ${expr}
       ORDER BY count DESC, value ASC
       LIMIT ${limit}`,
      values,
    );
    return result.rows
      .filter((row: { value: unknown }) => row.value !== null)
      .map((row: { value: unknown; count: number }) => ({
        value: String(row.value),
        count: row.count,
      }));
  };

  const totalResult = await query(
    `SELECT count(*)::int AS total FROM ${table} ${where}`,
    values,
  );

  const [byQuestionType, byDifficulty, byBloom, byRating, byGrade, byTopic] =
    await Promise.all([
      facetOf("lower(btrim(question_type))"),
      facetOf("lower(btrim(difficulty_level))"),
      facetOf("btrim(blooms_level)"),
      facetOf("difficulty_rating::text"),
      facetOf("grade"),
      facetOf("topic", 200),
    ]);

  return {
    total: totalResult.rows[0]?.total ?? 0,
    byQuestionType,
    byDifficulty,
    byBloom,
    byRating,
    byGrade,
    byTopic,
  };
}

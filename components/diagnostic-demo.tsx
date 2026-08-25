"use client";

import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Globe2,
  GraduationCap,
  Layers3,
  Pin,
  RotateCcw,
  Shuffle,
  Sparkles,
  Star,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import type React from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import type {
  DiagnosticRegion,
  DiagnosticReport,
  DragDropQuestionPayload,
  MatchingQuestionPayload,
} from "../agents/diagnostic/types/index";
import type {
  CreateSessionInput,
  DemoLoadedQuiz,
  DemoQuizCatalog,
  DemoQuizCatalogEntry,
  DemoQuizLoadResponse,
  DemoQuizQuestion,
  DemoQuizSubmitResponse,
} from "../lib/demo-types";
import { DIAGNOSTIC_CONTENT_DEFAULTS } from "../lib/diagnostic-content-defaults";
import {
  getGradeTestPlan,
  getTopicTestQuestionCount,
  getValidMultiTopicQuestionCounts,
} from "../lib/quiz-counts";
import { MultiStageLoadingScreen } from "./loading-screen";
import { PlacementTopicInsightsSection } from "./placement-result-view";

const OPTION_LABELS = ["A", "B", "C", "D"] as const;

function seededNumber(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function seededRange(seed: number, min: number, max: number) {
  return min + seededNumber(seed) * (max - min);
}

// ─── App navigation ───────────────────────────────────────────────────────────
type AppScreen =
  | "student-info"
  | "selector"
  | "topic-browse"
  | "topic-start"
  | "multi-topic-setup"
  | "grade-browse"
  | "grade-start";

type StudentSetup = {
  studentId: string;
  classLevel: CreateSessionInput["classLevel"];
  region: DiagnosticRegion;
};

const DIAGNOSTIC_REGION_OPTIONS = [
  "US",
  "UK",
  "UAE",
  "Ontario",
  "Australia",
] as const satisfies readonly DiagnosticRegion[];
const DEFAULT_DIAGNOSTIC_REGION: DiagnosticRegion = "US";

export type AssessmentKind = "diagnostic" | "placement";

const ASSESSMENT_COPY: Record<
  AssessmentKind,
  {
    brand: string;
    shortBrand: string;
    tagline: string;
    headerEmoji: string;
    headerShape: "circle" | "square";
    studentDetailsIntro: string;
    selectorIntro: string;
    topicBrowseIntro: string;
    gradeBrowseIntro: string;
    topicStartIntro: string;
    gradeStartIntro: string;
    resultLabel: string;
    runNewLabel: string;
  }
> = {
  diagnostic: {
    brand: "Diagnostic Agent",
    shortBrand: "Diagnostic",
    tagline: "Spot strengths & gaps",
    headerEmoji: "🔭",
    headerShape: "circle",
    studentDetailsIntro:
      "Add the student name and grade before choosing the diagnostic test.",
    selectorIntro: "Pick a {grade} test that fits what you want to check.",
    topicBrowseIntro: "Select a class and topic to begin your diagnostic.",
    gradeBrowseIntro:
      "Select your class to see your grade-wide diagnostic test.",
    topicStartIntro:
      "Answer each question carefully. The test is designed to quickly check your current understanding.",
    gradeStartIntro:
      "Answer each question carefully. The test is designed to quickly check your current understanding across all topics.",
    resultLabel: "Diagnostic",
    runNewLabel: "Run New Diagnostic",
  },
  placement: {
    brand: "Placement Test",
    shortBrand: "Placement",
    tagline: "Find the right level",
    headerEmoji: "🎯",
    headerShape: "square",
    studentDetailsIntro:
      "Add the student name and grade before starting the placement test.",
    selectorIntro:
      "Pick a {grade} placement flow to understand the right starting point.",
    topicBrowseIntro: "Select a class and topic to begin your placement check.",
    gradeBrowseIntro:
      "Select your class to see your grade-wide placement test.",
    topicStartIntro:
      "Answer each question carefully. The test is designed to estimate the right starting level.",
    gradeStartIntro:
      "Answer each question carefully. The test is designed to estimate readiness across the grade.",
    resultLabel: "Placement",
    runNewLabel: "Run New Placement Test",
  },
};

const PLACEMENT_EXCLUDED_CLASS_LEVELS = new Set([
  "classKG",
  "class1",
  "class2",
]);

function isClassLevelAvailableForAssessment(
  assessmentKind: AssessmentKind,
  classLevel: string,
) {
  return (
    assessmentKind !== "placement" ||
    !PLACEMENT_EXCLUDED_CLASS_LEVELS.has(classLevel)
  );
}

// ─── Star Rating ──────────────────────────────────────────────────────────────
function StarRating({
  filled,
  total = 5,
  size = 16,
}: {
  filled: number;
  total?: number;
  size?: number;
}) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: total }, (_, i) => ({
        id: `star-${i + 1}`,
        isFilled: i < filled,
      })).map((star) => (
        <Star
          key={star.id}
          width={size}
          height={size}
          fill={star.isFilled ? "#F5A623" : "#E2DED4"}
          stroke={star.isFilled ? "#E0941A" : "#D1CCC4"}
          strokeWidth={1}
        />
      ))}
    </div>
  );
}

// ─── Theme ────────────────────────────────────────────────────────────────────
const THEME = {
  page: "bg-white text-[#1a1a1a] font-sans min-h-screen",
  surface: "border border-gray-100 bg-white shadow-sm",
  textDim: "text-[#6B7280]",
  textMuted: "text-[#9CA3AF]",
  primaryGradient: "bg-[#F5A623]",
  primaryText: "text-[#1B4A4A]",
  rounded: "rounded-[20px]",
  roundedSm: "rounded-[12px]",
  roundedPill: "rounded-full",
  btnPrimary:
    "bg-[#F5A623] hover:bg-[#E0941A] text-white font-semibold rounded-full transition-all",
  btnSecondary:
    "border-2 border-[#2EC4B6] text-[#1B4A4A] font-semibold rounded-full hover:bg-[#2EC4B6]/10 transition-all",
};

const DIFFICULTY_BASE_POINTS: Record<string, number> = {
  easy: 2,
  medium: 3,
  hard: 4,
};

const DIFFICULTY_TIME_LIMITS_MS: Record<string, number> = {
  easy: 45_000,
  medium: 55_000,
  hard: 70_000,
};

const RAPID_RESPONSE_THRESHOLD_MS = 2_000;

// ─── Toast triggers ───────────────────────────────────────────────────────────
export const TOAST_TRIGGERS = [3, 8, 13]; // 0-based question indices after which to show toast
export const TOAST_CONFIGS = [
  {
    emoji: "🌟",
    title: "Great work! Keep going!",
    message: "You're doing brilliantly. Stay focused on the next one.",
  },
  {
    emoji: "🔥",
    title: "You're on fire!",
    message: "Halfway there. Take a breath and keep going strong!",
  },
  {
    emoji: "🏆",
    title: "Almost done!",
    message: "Just a few more questions. You've absolutely got this!",
  },
];

// ─── Utility functions ────────────────────────────────────────────────────────
export function classLabel(value: string) {
  if (value === "classKG") return "KG";
  if (value === "class1") return "Grade 1";
  if (value === "class2") return "Grade 2";
  if (value === "class3") return "Grade 3";
  if (value === "class4") return "Grade 4";
  if (value === "class5") return "Grade 5";
  if (value === "class6") return "Grade 6";
  if (value === "class8") return "Grade 8";
  if (value === "class7") return "Grade 7";
  return value;
}

export function classNum(value: string) {
  return value.replace("class", "");
}

export function toRomanNumeral(num: number) {
  if (num <= 0) return "";
  const map: Array<[number, string]> = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let n = num;
  let result = "";
  for (const [value, numeral] of map) {
    while (n >= value) {
      result += numeral;
      n -= value;
    }
  }
  return result;
}

export function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function getDefaultCatalogEntry(catalog: DemoQuizCatalog) {
  return (
    catalog.entries.find(
      (entry) =>
        entry.subject === DIAGNOSTIC_CONTENT_DEFAULTS.subject &&
        entry.classLevel === DIAGNOSTIC_CONTENT_DEFAULTS.classLevel &&
        entry.topic === DIAGNOSTIC_CONTENT_DEFAULTS.topic,
    ) ??
    catalog.entries.find(
      (entry) =>
        entry.subject === DIAGNOSTIC_CONTENT_DEFAULTS.subject &&
        entry.classLevel === DIAGNOSTIC_CONTENT_DEFAULTS.classLevel,
    ) ??
    catalog.entries.find(
      (entry) => entry.classLevel === DIAGNOSTIC_CONTENT_DEFAULTS.classLevel,
    ) ??
    catalog.entries[0]
  );
}

export function getCatalogEntryForClass(
  catalog: DemoQuizCatalog,
  classLevel: CreateSessionInput["classLevel"],
) {
  return (
    catalog.entries.find((entry) => entry.classLevel === classLevel) ??
    getDefaultCatalogEntry(catalog)
  );
}

export function buildDefaultForm(
  entry: DemoQuizCatalogEntry | null,
  studentId = "Riya Sharma",
  region: DiagnosticRegion = DEFAULT_DIAGNOSTIC_REGION,
): CreateSessionInput {
  const topicQuestionCount = entry
    ? getTopicTestQuestionCount(entry.learningObjectives.length)
    : 0;

  return entry
    ? {
        studentId,
        testMode: "topic",
        subject: entry.subject,
        classLevel: entry.classLevel,
        topic: entry.topic,
        maxQuestions: topicQuestionCount,
        region,
      }
    : {
        studentId,
        testMode: "topic",
        subject: DIAGNOSTIC_CONTENT_DEFAULTS.subject,
        classLevel: DIAGNOSTIC_CONTENT_DEFAULTS.classLevel,
        topic: DIAGNOSTIC_CONTENT_DEFAULTS.topic,
        maxQuestions: 0,
        region,
      };
}

function getTopicQuestionCountForEntry(entry?: DemoQuizCatalogEntry | null) {
  if (!entry) return 0;
  const target = getTopicTestQuestionCount(entry.learningObjectives.length);
  return entry.questionCount > 0 ? Math.min(target, entry.questionCount) : target;
}

export function getGradeQuestionCountForClass(
  classLevel: CreateSessionInput["classLevel"],
) {
  return getGradeTestPlan(classLevel).total;
}

export function getAnswerMap(answer: string) {
  try {
    return JSON.parse(answer) as Record<string, string>;
  } catch {
    return {};
  }
}

function formatDuration(timeTakenMs?: number) {
  if (!timeTakenMs || timeTakenMs <= 0) return "-";
  return `${(timeTakenMs / 1000).toFixed(1)}s`;
}

function formatCompactDuration(timeTakenMs?: number) {
  if (!timeTakenMs || timeTakenMs <= 0) return "0s";
  const totalSeconds = timeTakenMs / 1000;
  if (totalSeconds < 60)
    return `${totalSeconds.toFixed(totalSeconds >= 10 ? 0 : 1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}m ${seconds}s`;
}

function formatRelativePastDate(value: string) {
  const submittedAt = new Date(value).getTime();
  if (!Number.isFinite(submittedAt)) return "last time";

  const diffMs = Date.now() - submittedAt;
  const days = Math.max(1, Math.round(diffMs / 86_400_000));
  if (days < 7) return days === 1 ? "1 day ago" : `${days} days ago`;

  const weeks = Math.round(days / 7);
  if (weeks < 8) return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;

  const months = Math.round(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

function scoreStars(correct: number, total: number) {
  if (total <= 0) return 1;
  return Math.min(5, Math.max(1, Math.ceil((correct / total) * 5)));
}

export function getEstimatedTestTimeLabel(questionCount: number) {
  if (questionCount <= 15) return "15 min";
  if (questionCount <= 22) return "20 min";
  if (questionCount <= 25) return "25 min";
  return "30 min";
}

function _clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function _formatQuestionTypeLabel(value: string) {
  return value.replace(/_/g, " ");
}

type QuestionDisplayData = {
  questionType: DemoQuizQuestion["questionType"];
  options?: string[];
  payload?: Record<string, unknown>;
  correctAnswer?: string;
  modelAnswer?: string;
};

function getQuestionSvg(question?: {
  payload?: Record<string, unknown> | null;
}) {
  const questionSvg = question?.payload?.questionSvg;
  return typeof questionSvg === "string" &&
    questionSvg.trim().startsWith("<svg")
    ? questionSvg
    : null;
}

function normalizeDifficultyLevel(value?: string) {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "medium" || normalized === "hard") return normalized;
  return "easy";
}

export function getQuestionTimeLimitMs(difficultyLevel?: string) {
  return DIFFICULTY_TIME_LIMITS_MS[normalizeDifficultyLevel(difficultyLevel)];
}

function getQuestionBasePoints(difficultyLevel?: string) {
  return DIFFICULTY_BASE_POINTS[normalizeDifficultyLevel(difficultyLevel)];
}

function getQuestionFinalPoints(record: {
  verdict: string;
  question: { difficultyLevel?: string };
}) {
  const base = getQuestionBasePoints(record.question.difficultyLevel);
  if (record.verdict === "correct") return base;
  if (record.verdict === "partial") return base * 0.5;
  return 0;
}

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomItem<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

export function buildRandomAnswer(question: DemoQuizQuestion) {
  if (question.questionType === "mcq") {
    const optionCount = Math.max(1, question.options?.length ?? 4);
    return OPTION_LABELS[randomInt(0, Math.min(optionCount, 4) - 1)] ?? "A";
  }

  if (question.questionType === "true_false") {
    return Math.random() > 0.5 ? "true" : "false";
  }

  if (question.questionType === "matching") {
    const payload = question.payload as MatchingQuestionPayload | undefined;
    const premises = payload?.premises ?? [];
    const responses = payload?.responses ?? [];
    const answer: Record<string, string> = {};
    for (const premise of premises) {
      answer[premise] = randomItem(responses) ?? "";
    }
    return JSON.stringify(answer);
  }

  if (question.questionType === "drag_drop") {
    const payload = question.payload as DragDropQuestionPayload | undefined;
    const draggableItems = payload?.draggableItems ?? [];
    const dropZones = payload?.dropZones ?? [];
    const answerKey = payload?.answerKey ?? [];
    const answer: Record<string, string> = {};
    if (answerKey.length > 0) {
      for (const pair of answerKey) {
        const item = pair.item || pair.prompt;
        const target = pair.target || pair.match;
        if (item && target) answer[item] = target;
      }
    } else {
      for (const item of draggableItems) {
        answer[item] = randomItem(dropZones) ?? "";
      }
    }
    return JSON.stringify(answer);
  }

  if (question.questionType === "fitb") {
    const payload = question.payload as
      | { answer?: string; blanks?: Array<{ answer?: string }> }
      | undefined;
    const candidate =
      (question as { modelAnswer?: string }).modelAnswer ||
      payload?.answer ||
      payload?.blanks?.[0]?.answer;
    if (candidate) return candidate;
    return randomItem(["python", "print", "high-level", "script", "0", "not sure"]) ?? "python";
  }

  if (question.questionType === "word_problem") {
    return (
      randomItem(["12", "24", "36", "I would add the numbers", "not sure"]) ??
      "not sure"
    );
  }

  return (
    randomItem([
      "I am not sure yet.",
      "The answer is 10.",
      "I would solve it by checking the pattern.",
      "I think the first option is correct.",
    ]) ?? "I am not sure yet."
  );
}

export function buildRandomQuizSubmission(quiz: DemoLoadedQuiz) {
  const randomAnswers: Record<string, string> = {};
  const randomResponseMeta: Record<
    string,
    { timeTakenMs: number; allocatedTimeMs: number; wasAutoSkipped: boolean }
  > = {};

  for (const question of quiz.questions) {
    const allocatedTimeMs = getQuestionTimeLimitMs(question.difficultyLevel);
    const maxTimeMs = Math.max(3_000, Math.min(allocatedTimeMs, 18_000));
    randomAnswers[question.id] = buildRandomAnswer(question);
    randomResponseMeta[question.id] = {
      timeTakenMs: randomInt(1_200, maxTimeMs),
      allocatedTimeMs,
      wasAutoSkipped: false,
    };
  }

  return { randomAnswers, randomResponseMeta };
}

function getQuestionConceptText(record: DiagnosticReport["results"][number]) {
  const source = [
    record.question.subtopic,
    record.question.learningObjective,
    record.question.topic,
    record.question.question,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (source.includes("number line")) {
    return "where values belong on a number line";
  }
  if (source.includes("equivalent")) {
    return "spotting when two answers are secretly the same";
  }
  if (source.includes("simpl") || source.includes("reduce")) {
    return "making answers simpler without changing their value";
  }
  if (
    source.includes("compare") ||
    source.includes("bigger") ||
    source.includes("smaller") ||
    source.includes("least") ||
    source.includes("greater")
  ) {
    return "telling which value is bigger or smaller";
  }
  if (source.includes("like term") || source.includes("collect")) {
    return "putting similar terms together";
  }
  if (
    source.includes("word") ||
    source.includes("description") ||
    source.includes("statement")
  ) {
    return "turning word clues into maths";
  }
  if (
    source.includes("equal") ||
    source.includes("equation") ||
    source.includes("=")
  ) {
    return "checking when two expressions match";
  }
  if (source.includes("expression") || source.includes("algebra")) {
    return "working with algebraic ideas";
  }
  if (source.includes("fraction")) {
    return "thinking about parts of a whole";
  }
  if (source.includes("shape") || source.includes("angle")) {
    return "using shape clues carefully";
  }
  if (source.includes("measure") || source.includes("unit")) {
    return "using measurements and units";
  }
  return "using the key idea from the question";
}

function getQuestionSkillText(record: DiagnosticReport["results"][number]) {
  switch (record.question.questionType) {
    case "mcq":
      return "you could choose the right idea from the options";
    case "drag_drop":
      return "you could place ideas in the right spot";
    case "matching":
      return "you could connect ideas that belong together";
    case "word_problem":
      return "you could use maths in a real-life situation";
    case "fitb":
      return "you could fill in the missing piece";
    case "short_answer":
    case "open_response":
      return "you could explain your thinking in your own words";
    case "true_false":
      return "you could decide whether the statement made sense";
    default:
      return "you could use the right strategy";
  }
}

function buildSimpleResultCopy({
  report,
}: {
  firstName: string;
  report: DiagnosticReport;
  results: DiagnosticReport["results"];
  roundedScore: number;
}) {
  const narrative = report.resultNarrative;
  return {
    mainSummary: narrative?.mainSummary ?? "",
    whatWentWell: narrative?.whatWentWell ?? "",
    whatNeedsPractice: narrative?.whatNeedsPractice ?? "",
    practiceSteps: narrative?.practiceSteps ?? [],
    parentNotes: narrative?.parentNotes ?? [],
  };
}

function formatPoints(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatAnswerSummary(question: QuestionDisplayData, answer: string) {
  if (question.questionType === "mcq" && question.options) {
    const normalized = answer.trim().toUpperCase();
    const labels = ["A", "B", "C", "D"] as const;
    const labelIndex = labels.indexOf(normalized as (typeof labels)[number]);
    if (labelIndex >= 0)
      return `${labels[labelIndex]} · ${question.options[labelIndex] ?? ""}`.trim();
    return answer || "(blank)";
  }
  if (question.questionType === "true_false") return answer || "(blank)";
  if (
    question.questionType === "matching" ||
    question.questionType === "drag_drop"
  ) {
    try {
      const parsed = JSON.parse(answer) as Record<string, string>;
      const pairs = Object.entries(parsed).map(
        ([left, right]) => `${left} → ${right}`,
      );
      return pairs.length > 0 ? pairs.join("; ") : "(blank)";
    } catch {
      return answer || "(blank)";
    }
  }
  return answer || "(blank)";
}

function getCorrectAnswerSummary(question: QuestionDisplayData) {
  if (question.questionType === "mcq" && question.options) {
    const labels = ["A", "B", "C", "D"] as const;
    const correctAnswer =
      typeof question.correctAnswer === "string"
        ? question.correctAnswer.trim()
        : "";
    const selected = labels.indexOf(
      correctAnswer.toUpperCase() as (typeof labels)[number],
    );
    if (selected >= 0)
      return `${labels[selected]} · ${question.options[selected] ?? ""}`.trim();
    return correctAnswer || "—";
  }
  if (question.questionType === "true_false") {
    const payload = question.payload as { correctAnswer?: boolean } | undefined;
    return payload?.correctAnswer === true ? "True" : "False";
  }
  if (question.questionType === "matching") {
    const payload = question.payload as
      | { answerKey?: Array<{ prompt?: string; match?: string }> }
      | undefined;
    return (
      (payload?.answerKey ?? [])
        .map((pair) => `${pair.prompt ?? ""} → ${pair.match ?? ""}`.trim())
        .join("; ") || "See answer key"
    );
  }
  if (question.questionType === "drag_drop") {
    const payload = question.payload as
      | { answerKey?: Array<{ item?: string; target?: string }> }
      | undefined;
    return (
      (payload?.answerKey ?? [])
        .map((pair) => `${pair.item ?? ""} → ${pair.target ?? ""}`.trim())
        .join("; ") || "See answer key"
    );
  }
  return question.modelAnswer ?? question.correctAnswer ?? "—";
}

function ProgressComparisonCard({
  report,
  currentCorrectCount,
  currentTotalQuestions,
}: {
  report: DiagnosticReport;
  currentCorrectCount: number;
  currentTotalQuestions: number;
}) {
  const comparison = report.progressComparison;

  if (!comparison) {
    return (
      <div
        className="v1-card overflow-hidden rounded-[18px]"
        style={{
          background: "linear-gradient(135deg,#FFF7E8 0%,#FFF0C9 100%)",
          border: "1px solid #F8D694",
        }}
      >
        <div className="p-6">
          <div className="mb-1 text-[1.05rem] font-extrabold text-[#1B4A4A]">
            Progress this time
          </div>
          <div className="mb-5 text-[0.92rem] font-semibold text-[#D48600]">
            This is the first saved attempt for this topic.
          </div>
          <div className="rounded-[16px] bg-white px-6 py-5 shadow-sm">
            <div className="font-mono text-[0.75rem] font-bold uppercase tracking-widest text-[#9CA3AF]">
              This time
            </div>
            <div className="mt-2 text-[2rem] font-extrabold text-[#1B4A4A]">
              {currentCorrectCount}/{currentTotalQuestions}
            </div>
            <div className="mt-2">
              <StarRating
                filled={scoreStars(currentCorrectCount, currentTotalQuestions)}
                size={18}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const improvedFocus = comparison.improvedLearningObjective ?? report.topic;
  const delta = comparison.correctDelta;
  const message =
    delta > 0
      ? `You got ${delta} more ${delta === 1 ? "question" : "questions"} right this time. Strong progress on ${improvedFocus}.`
      : delta === 0
        ? `You matched your last score. Next focus: ${improvedFocus}.`
        : `This attempt was ${Math.abs(delta)} ${
            Math.abs(delta) === 1 ? "question" : "questions"
          } below last time. Review ${improvedFocus} and try again.`;

  return (
    <div
      className="v1-card overflow-hidden rounded-[18px]"
      style={{
        background: "linear-gradient(135deg,#FFF7E8 0%,#FFF0C9 100%)",
        border: "1px solid #F8D694",
      }}
    >
      <div className="p-6">
        <div className="mb-1 text-[1.05rem] font-extrabold text-[#1B4A4A]">
          Progress this time
        </div>
        <div className="mb-5 text-[0.92rem] font-semibold text-[#D48600]">
          You took this test{" "}
          {formatRelativePastDate(comparison.previousSubmittedAt)}. Here is how
          you have changed:
        </div>

        <div className="grid items-center gap-4 rounded-[16px] bg-white px-6 py-5 shadow-sm sm:grid-cols-[1fr_auto_1fr] sm:px-10">
          <div className="text-center sm:text-left">
            <div className="font-mono text-[0.75rem] font-bold uppercase tracking-widest text-[#9CA3AF]">
              Last time
            </div>
            <div className="mt-2 text-[2rem] font-extrabold text-[#1B4A4A]">
              {comparison.previousCorrectCount}/
              {comparison.previousTotalQuestions}
            </div>
            <div className="mt-2 flex justify-center sm:justify-start">
              <StarRating
                filled={scoreStars(
                  comparison.previousCorrectCount,
                  comparison.previousTotalQuestions,
                )}
                size={18}
              />
            </div>
          </div>

          <div className="text-center font-mono text-[1.5rem] font-bold text-[#9CA3AF]">
            →
          </div>

          <div className="text-center sm:text-left">
            <div className="font-mono text-[0.75rem] font-bold uppercase tracking-widest text-[#9CA3AF]">
              This time
            </div>
            <div className="mt-2 text-[2rem] font-extrabold text-[#1B4A4A]">
              {comparison.currentCorrectCount}/
              {comparison.currentTotalQuestions}
            </div>
            <div className="mt-2 flex justify-center sm:justify-start">
              <StarRating
                filled={scoreStars(
                  comparison.currentCorrectCount,
                  comparison.currentTotalQuestions,
                )}
                size={18}
              />
            </div>
          </div>
        </div>

        <div
          className={`mt-5 rounded-[14px] px-5 py-4 text-[0.95rem] font-extrabold ${
            delta >= 0
              ? "bg-[#CFF7EF] text-[#1B4A4A]"
              : "bg-[#FFE3DA] text-[#8A2A18]"
          }`}
        >
          {message}
        </div>
      </div>
    </div>
  );
}

function normalizeAnswerText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function _getMapAnswerState(
  question: QuestionDisplayData,
  answer: string,
  isAnswered: boolean,
) {
  if (!isAnswered) return "upcoming";

  if (question.questionType === "mcq") {
    const expected = question.correctAnswer?.trim().toUpperCase();
    return answer.trim().toUpperCase() === expected ? "correct" : "incorrect";
  }

  if (question.questionType === "true_false") {
    const payload = question.payload as { correctAnswer?: boolean } | undefined;
    const expected = payload?.correctAnswer === true ? "true" : "false";
    return normalizeAnswerText(answer) === expected ? "correct" : "incorrect";
  }

  if (question.questionType === "fitb") {
    const payload = question.payload as
      | { answer?: string; blanks?: Array<{ answer?: string; acceptedAnswers?: string[] }> }
      | undefined;
    const rawAnswers: string[] = [];
    if (question.modelAnswer) rawAnswers.push(question.modelAnswer);
    if (payload?.answer) rawAnswers.push(payload.answer);
    if (Array.isArray(payload?.blanks)) {
      for (const b of payload.blanks) {
        if (b.answer) rawAnswers.push(b.answer);
        if (Array.isArray(b.acceptedAnswers)) {
          for (const acc of b.acceptedAnswers) rawAnswers.push(acc);
        }
      }
    }
    const actual = normalizeAnswerText(answer);
    if (!actual) return "answered";
    if (rawAnswers.length === 0) return "answered";

    const isCorrect = rawAnswers.some((exp) => {
      const expected = normalizeAnswerText(exp);
      if (!expected) return false;
      return (
        actual === expected ||
        actual.includes(expected) ||
        expected.includes(actual)
      );
    });

    return isCorrect ? "correct" : "incorrect";
  }

  if (
    question.questionType === "matching" ||
    question.questionType === "drag_drop"
  ) {
    const payload = question.payload as
      | {
          answerKey?: Array<{
            prompt?: string;
            match?: string;
            item?: string;
            target?: string;
          }>;
        }
      | undefined;
    const answerMap = getAnswerMap(answer);
    const answerKey = payload?.answerKey ?? [];
    if (answerKey.length === 0) return "answered";
    const correctCount = answerKey.filter((pair) => {
      const key = pair.prompt ?? pair.item ?? "";
      const expected = pair.match ?? pair.target ?? "";
      return (
        normalizeAnswerText(answerMap[key] ?? "") ===
        normalizeAnswerText(expected)
      );
    }).length;
    const expectedKeys = new Set(
      answerKey.map((pair) => pair.prompt ?? pair.item ?? ""),
    );
    const expectedTargets = new Set(
      answerKey.map((pair) =>
        normalizeAnswerText(pair.match ?? pair.target ?? ""),
      ),
    );
    const extraPlacementCount =
      question.questionType === "drag_drop"
        ? Object.entries(answerMap).filter(
            ([key, target]) =>
              !expectedKeys.has(key) &&
              expectedTargets.has(normalizeAnswerText(target)),
          ).length
        : 0;
    if (correctCount === answerKey.length && extraPlacementCount === 0)
      return "correct";
    if (correctCount > 0 || extraPlacementCount > 0) return "partial";
    return "incorrect";
  }

  if (question.modelAnswer) {
    const expected = normalizeAnswerText(question.modelAnswer);
    const actual = normalizeAnswerText(answer);
    if (!expected) return "answered";
    return actual === expected ||
      actual.includes(expected) ||
      expected.includes(actual)
      ? "correct"
      : "incorrect";
  }

  return "answered";
}

function getQuestionExplanation(record: DiagnosticReport["results"][number]) {
  const question = record.question as QuestionDisplayData & {
    explanation?: string;
    feedback?: string;
    solutionSteps?: string[];
    scoringGuidance?: string;
  };
  const payload = question.payload as
    | { explanation?: string; whyWrong?: string; solutionSteps?: string[] }
    | undefined;
  const explanation =
    question.feedback ??
    question.explanation ??
    payload?.explanation ??
    payload?.whyWrong;
  if (explanation) return explanation;
  const steps = question.solutionSteps ?? payload?.solutionSteps;
  if (steps && steps.length > 0) return steps.join(" ");
  if (question.scoringGuidance) return question.scoringGuidance;
  return `Correct answer: ${getCorrectAnswerSummary(question)}. Review this question with the teacher explanation for the full working.`;
}

function getStudentDisplayName(studentId?: string) {
  const normalized = studentId?.trim();
  return normalized && normalized.length > 0 ? normalized : "Student";
}

export function formatLearningObjectiveLabel(learningObjective?: string) {
  if (!learningObjective) return "General";
  const stripped = learningObjective.replace(/^Students can\s+/i, "").trim();
  if (!stripped) return "General";
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

// ─── API functions ─────────────────────────────────────────────────────────────
export async function loadQuiz(input: CreateSessionInput) {
  const response = await fetch("/api/quiz/section", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = (await response.json()) as DemoQuizLoadResponse & {
    error?: string;
  };
  if (!response.ok || !("quiz" in data))
    throw new Error(data.error ?? "Unable to load quiz.");
  return data.quiz;
}

export async function loadRecurringQuiz(
  assessmentId: string,
  studentId: string,
) {
  const response = await fetch("/api/quiz/recurring", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assessmentId, studentId }),
  });
  const data = (await response.json()) as {
    quiz: DemoLoadedQuiz;
    parentAssessmentId: string;
    error?: string;
  };
  if (!response.ok || !data.quiz)
    throw new Error(data.error ?? "Unable to load recurring test.");

  return {
    ...data.quiz,
    parentAssessmentId: data.parentAssessmentId,
  };
}

export async function submitQuiz(
  quiz: DemoLoadedQuiz,
  answers: Record<string, string>,
  responseMeta: Record<
    string,
    { timeTakenMs: number; allocatedTimeMs: number; wasAutoSkipped: boolean }
  >,
) {
  const response = await fetch("/api/quiz/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      studentId: quiz.studentId,
      testMode: quiz.testMode,
      subject: quiz.subject,
      classLevel: quiz.classLevel,
      region: quiz.region,
      topic: quiz.topic,
      topics: quiz.selectedTopics,
      maxQuestions: quiz.maxQuestions,
      parentAssessmentId: quiz.parentAssessmentId,
      questions: quiz.questions, // Send full questions for re-evaluation
      answers: quiz.questions.map((question) => ({
        questionId: question.id,
        answer: answers[question.id] ?? "",
        timeTakenMs: responseMeta[question.id]?.timeTakenMs ?? 0,
        allocatedTimeMs: responseMeta[question.id]?.allocatedTimeMs ?? 0,
        wasAutoSkipped: responseMeta[question.id]?.wasAutoSkipped ?? false,
      })),
    }),
  });
  const data = (await response.json()) as DemoQuizSubmitResponse & {
    error?: string;
  };
  if (!response.ok || !("report" in data))
    throw new Error(data.error ?? "Unable to submit quiz.");

  // Attach the server-generated assessmentId to the report so UI can use it
  return {
    ...data.report,
    assessmentId: data.assessmentId,
  };
}

// ─── AI Tutor Chat Bubble ─────────────────────────────────────────────────────
export function AIChatBubble({
  config,
  onDismiss,
}: {
  config: { emoji: string; title: string; message: string } | null;
  onDismiss: () => void;
}) {
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!config) return;
    const t = setTimeout(() => onDismissRef.current(), 5000);
    return () => clearTimeout(t);
  }, [config]); // only restarts when a new message appears, not on every re-render

  if (!config) return null;

  return (
    <div className="fixed bottom-5 right-4 z-50 flex flex-col items-end gap-2 sm:right-6">
      {/* Speech bubble */}
      <div className="animate-in slide-in-from-bottom-4 fade-in duration-500 w-[268px] sm:w-[340px]">
        <div className="relative rounded-[20px] rounded-br-[5px] bg-white px-4 py-4 shadow-[0_8px_32px_rgba(0,0,0,0.13)] ring-1 ring-[#F5A623]/25 sm:px-5 sm:py-5">
          {/* Dismiss */}
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full text-[10px] text-[#C0C4CC] transition-colors hover:bg-[#FFF8E7] hover:text-[#F5A623]"
          >
            ✕
          </button>

          {/* Content */}
          <div className="flex items-start gap-3 pr-4">
            <span className="shrink-0 text-[1.6rem] leading-none sm:text-[2rem]">
              {config.emoji}
            </span>
            <div className="min-w-0">
              <div className="font-bold text-[14px] leading-snug text-[#1B4A4A] sm:text-[16px]">
                {config.title}
              </div>
              <div className="mt-1 text-[12px] leading-relaxed text-[#6B7280] sm:text-[13px]">
                {config.message}
              </div>
            </div>
          </div>

          {/* Progress bar showing time remaining */}
          <div className="mt-3 h-[3px] w-full overflow-hidden rounded-full bg-[#F0EDE6]">
            <div
              className="h-full rounded-full bg-[#F5A623]"
              style={{ animation: "shrink-bar 5s linear forwards" }}
            />
          </div>
        </div>

        {/* Tail pointing down toward avatar */}
        <div className="flex justify-end pr-[20px]">
          <div
            className="h-0 w-0 border-l-[8px] border-r-[8px] border-t-[8px] border-l-transparent border-r-transparent border-t-white"
            style={{ filter: "drop-shadow(0 2px 1px rgba(0,0,0,0.06))" }}
          />
        </div>
      </div>

      {/* Avatar */}
      <div className="animate-in zoom-in-75 duration-400 flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#ffd166,#F5A623)] text-[1.5rem] shadow-[0_4px_18px_rgba(245,166,35,0.45)] ring-2 ring-white sm:h-[52px] sm:w-[52px] sm:text-[1.7rem]">
        🦉
      </div>
    </div>
  );
}

// ─── Selector Screen ───────────────────────────────────────────────────────────
function StudentInfoScreen({
  setup,
  classLevels,
  assessmentCopy,
  assessmentKind,
  onChange,
  onContinue,
}: {
  setup: StudentSetup;
  classLevels: CreateSessionInput["classLevel"][];
  assessmentCopy: (typeof ASSESSMENT_COPY)[AssessmentKind];
  assessmentKind: AssessmentKind;
  onChange: (setup: StudentSetup) => void;
  onContinue: () => void;
}) {
  const studentName = setup.studentId.trim();
  const isPlacement = assessmentKind === "placement";

  return (
    <div
      className={`mx-auto max-w-[760px] animate-in fade-in slide-in-from-bottom-4 duration-500 ${
        isPlacement
          ? "flex min-h-[calc(100vh-160px)] flex-col justify-center sm:block sm:min-h-0"
          : ""
      }`}
    >
      <div className="mb-8 text-center">
        <h2 className="text-[24px] font-extrabold tracking-tight text-[#1B4A4A] sm:text-[32px]">
          Student details
        </h2>
        <p className="mx-auto mt-2 max-w-[520px] text-[15px] leading-relaxed text-[#6B7280] sm:text-[16px]">
          {assessmentCopy.studentDetailsIntro}
        </p>
      </div>

      <div
        className={
          isPlacement
            ? "rounded-[20px] bg-white p-5 sm:p-8"
            : "rounded-[20px] border border-gray-100 bg-white p-5 shadow-sm sm:p-8"
        }
        style={
          isPlacement
            ? {
                border: "2px solid rgba(46,196,182,0.25)",
                boxShadow:
                  "0 6px 0 rgba(46,196,182,0.18), 0 4px 14px rgba(26,26,46,0.06)",
              }
            : undefined
        }
      >
        <div className="grid gap-5">
          <label className="block">
            <span className="mb-2 flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-widest text-[#6B7280]">
              <UserRound className="h-4 w-4 text-[#2EC4B6]" />
              Student name
            </span>
            <input
              type="text"
              value={setup.studentId}
              onChange={(event) =>
                onChange({ ...setup, studentId: event.target.value })
              }
              placeholder="Enter student name"
              className="h-12 w-full rounded-[14px] border border-gray-200 bg-[#F8F9FA] px-4 text-[16px] font-semibold text-[#1a1a1a] outline-none transition-all placeholder:text-[#9CA3AF] focus:border-[#2EC4B6] focus:bg-white focus:ring-4 focus:ring-[#2EC4B6]/10"
            />
          </label>

          <label className="block">
            <span className="mb-2 flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-widest text-[#6B7280]">
              <GraduationCap className="h-4 w-4 text-[#F5A623]" />
              Grade
            </span>
            <select
              value={setup.classLevel}
              onChange={(event) =>
                onChange({
                  ...setup,
                  classLevel: event.target
                    .value as CreateSessionInput["classLevel"],
                })
              }
              className="h-12 w-full appearance-none rounded-[14px] border border-gray-200 bg-[#F8F9FA] px-4 text-[16px] font-semibold text-[#1a1a1a] outline-none transition-all focus:border-[#F5A623] focus:bg-white focus:ring-4 focus:ring-[#F5A623]/10"
            >
              {classLevels.map((classLevel) => {
                return (
                  <option key={classLevel} value={classLevel}>
                    {classLabel(classLevel)}
                  </option>
                );
              })}
            </select>
          </label>

          {!isPlacement && (
            <label className="block">
              <span className="mb-2 flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-widest text-[#6B7280]">
                <Globe2 className="h-4 w-4 text-[#2EC4B6]" />
                Country / region
              </span>
              <select
                value={setup.region}
                onChange={(event) =>
                  onChange({
                    ...setup,
                    region: event.target.value as DiagnosticRegion,
                  })
                }
                className="h-12 w-full appearance-none rounded-[14px] border border-gray-200 bg-[#F8F9FA] px-4 text-[16px] font-semibold text-[#1a1a1a] outline-none transition-all focus:border-[#2EC4B6] focus:bg-white focus:ring-4 focus:ring-[#2EC4B6]/10"
              >
                {DIAGNOSTIC_REGION_OPTIONS.map((region) => (
                  <option key={region} value={region}>
                    {region}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <button
          type="button"
          onClick={onContinue}
          disabled={assessmentKind !== "placement" && studentName.length === 0}
          className={`mt-8 flex w-full items-center justify-center gap-2 rounded-full bg-[#F5A623] py-4 font-bold text-[16px] text-white transition-all hover:bg-[#E0941A] disabled:opacity-50 ${
            isPlacement
              ? "shadow-[0_6px_0_#C68213] hover:translate-y-0.5 hover:shadow-[0_3px_0_#C68213] active:translate-y-1 active:shadow-[0_0_0_#C68213] disabled:translate-y-0 disabled:shadow-[0_6px_0_#C68213]"
              : "shadow-[0_6px_20px_rgba(245,166,35,0.30)] hover:-translate-y-0.5 disabled:translate-y-0"
          }`}
        >
          {assessmentKind === "placement"
            ? "Start Placement Test"
            : "Choose your test"}
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function SelectorScreen({
  onSelectTopic,
  onSelectMultiTopic,
  onSelectGrade,
  studentName,
  classLevel,
  assessmentCopy,
}: {
  onSelectTopic: () => void;
  onSelectMultiTopic: () => void;
  onSelectGrade: () => void;
  studentName: string;
  classLevel: string;
  assessmentCopy: (typeof ASSESSMENT_COPY)[AssessmentKind];
}) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-10 text-center">
        <h2 className="text-[24px] font-extrabold tracking-tight text-[#1B4A4A] sm:text-[32px]">
          Choose your test
        </h2>
        <p className="mx-auto mt-2 max-w-[520px] text-[15px] leading-relaxed text-[#6B7280] sm:text-[16px]">
          Ready for {studentName}?{" "}
          {assessmentCopy.selectorIntro.replace(
            "{grade}",
            classLabel(classLevel),
          )}
        </p>
      </div>

      <div className="mx-auto grid max-w-[1120px] grid-cols-1 gap-6 md:grid-cols-3">
        {/* Topic Test Card */}
        <button
          type="button"
          onClick={onSelectTopic}
          className="group cursor-pointer rounded-[20px] border border-gray-100 bg-white p-5 text-left shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-[#2EC4B6] hover:shadow-[0_8px_32px_rgba(46,196,182,0.12)] sm:p-8"
        >
          <div className="mb-4 flex h-[60px] w-[60px] items-center justify-center rounded-[14px] bg-[#E6F8F7] text-[30px]">
            📋
          </div>
          <h3 className="mb-2 text-[22px] font-bold text-[#1B4A4A]">
            Topic Test
          </h3>
          <p className="mb-5 text-[14px] leading-relaxed text-[#6B7280]">
            Test your knowledge on one specific topic. Good for checking if you
            have mastered what you just learnt.
          </p>
          <div className="mb-5 flex flex-wrap gap-2">
            {["3 per learning objective", "One topic", "15–20 min"].map(
              (pill) => (
                <span
                  key={pill}
                  className="rounded-full bg-[#F8F9FA] px-3 py-1.5 font-mono text-[12px] text-[#6B7280] border border-gray-100"
                >
                  {pill}
                </span>
              ),
            )}
          </div>
          <div className="flex items-center gap-1 font-semibold text-[14px] text-[#F5A623]">
            Start a topic test{" "}
            <span className="text-[18px] leading-none">›</span>
          </div>
        </button>

        {/* Multi-topic Test Card */}
        <button
          type="button"
          onClick={onSelectMultiTopic}
          className="group cursor-pointer rounded-[20px] border border-gray-100 bg-white p-5 text-left shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-[#7C5CFC] hover:shadow-[0_8px_32px_rgba(124,92,252,0.12)] sm:p-8"
        >
          <div className="mb-4 flex h-[60px] w-[60px] items-center justify-center rounded-[14px] bg-[#F0ECFF] text-[#7C5CFC]">
            <Layers3 className="h-8 w-8" strokeWidth={2.2} />
          </div>
          <h3 className="mb-2 text-[22px] font-bold text-[#1B4A4A]">
            Multi-topic Test
          </h3>
          <p className="mb-5 text-[14px] leading-relaxed text-[#6B7280]">
            Choose up to five topics and give each one an equal share of the
            test. Good for focused revision across related skills.
          </p>
          <div className="mb-5 flex flex-wrap gap-2">
            {["1–5 topics", "10–30 questions", "Equal topic mix"].map(
              (pill) => (
                <span
                  key={pill}
                  className="rounded-full border border-gray-100 bg-[#F8F9FA] px-3 py-1.5 font-mono text-[12px] text-[#6B7280]"
                >
                  {pill}
                </span>
              ),
            )}
          </div>
          <div className="flex items-center gap-1 font-semibold text-[14px] text-[#7C5CFC]">
            Build a multi-topic test
            <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </div>
        </button>

        {/* Grade Test Card */}
        <button
          type="button"
          onClick={onSelectGrade}
          className="group cursor-pointer rounded-[20px] border border-gray-100 bg-white p-5 text-left shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-[#F5A623] hover:shadow-[0_8px_32px_rgba(245,166,35,0.12)] sm:p-8"
        >
          <div className="mb-4 flex h-[60px] w-[60px] items-center justify-center rounded-[14px] bg-[#FFF8E7] text-[30px]">
            🏆
          </div>
          <h3 className="mb-2 text-[22px] font-bold text-[#1B4A4A]">
            Grade Test
          </h3>
          <p className="mb-5 text-[14px] leading-relaxed text-[#6B7280]">
            Test your knowledge across your whole grade. Good for finding which
            topics to focus on next.
          </p>
          <div className="mb-5 flex flex-wrap gap-2">
            {["15-30 questions", "All topics", "20–30 min"].map((pill) => (
              <span
                key={pill}
                className="rounded-full bg-[#F8F9FA] px-3 py-1.5 font-mono text-[12px] text-[#6B7280] border border-gray-100"
              >
                {pill}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-1 font-semibold text-[14px] text-[#F5A623]">
            Start a grade test{" "}
            <span className="text-[18px] leading-none">›</span>
          </div>
        </button>
      </div>
    </div>
  );
}

// ─── Topic Browse Screen ───────────────────────────────────────────────────────
function MultiTopicSetupScreen({
  quizCatalog,
  classLevel,
  isBusy,
  onBack,
  onBegin,
}: {
  quizCatalog: DemoQuizCatalog;
  classLevel: CreateSessionInput["classLevel"];
  isBusy: boolean;
  onBack: () => void;
  onBegin: (input: {
    subject: CreateSessionInput["subject"];
    topics: string[];
    maxQuestions: number;
  }) => void;
}) {
  const entriesForGrade = useMemo(
    () =>
      quizCatalog.entries.filter((entry) => entry.classLevel === classLevel),
    [classLevel, quizCatalog.entries],
  );
  const subjects = useMemo(() => {
    return Array.from(
      new Set(entriesForGrade.map((entry) => entry.subject)),
    ).sort();
  }, [entriesForGrade]);
  const [selectedSubject, setSelectedSubject] = useState<
    CreateSessionInput["subject"]
  >(() => subjects[0] ?? "Maths");
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [questionCount, setQuestionCount] = useState(10);
  const [selectionMessage, setSelectionMessage] = useState<string | null>(null);

  const topicEntries = useMemo(
    () => entriesForGrade.filter((entry) => entry.subject === selectedSubject),
    [entriesForGrade, selectedSubject],
  );
  const selectedEntries = selectedTopics.flatMap((topic) => {
    const entry = topicEntries.find((candidate) => candidate.topic === topic);
    return entry ? [entry] : [];
  });
  const minimumAvailableQuestions =
    selectedEntries.length > 0
      ? Math.min(...selectedEntries.map((entry) => entry.questionCount))
      : 0;
  const validQuestionCounts = getValidMultiTopicQuestionCounts(
    selectedTopics.length,
  ).filter(
    (total) => total / selectedTopics.length <= minimumAvailableQuestions,
  );
  const effectiveQuestionCount = validQuestionCounts.includes(questionCount)
    ? questionCount
    : (validQuestionCounts[0] ?? 0);
  const questionsPerTopic = selectedTopics.length
    ? effectiveQuestionCount / selectedTopics.length
    : 0;

  const toggleTopic = (topic: string) => {
    setSelectionMessage(null);
    setSelectedTopics((current) => {
      if (current.includes(topic)) {
        return current.filter((selectedTopic) => selectedTopic !== topic);
      }
      if (current.length >= 5) {
        setSelectionMessage("You can select up to 5 topics.");
        return current;
      }
      return [...current, topic];
    });
  };

  return (
    <div className="mx-auto max-w-[980px] animate-in fade-in slide-in-from-bottom-4 duration-500">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 flex items-center gap-1 text-[13px] font-medium text-[#6B7280] transition-colors hover:text-[#1a1a1a]"
      >
        <ChevronLeft className="h-4 w-4" /> Back
      </button>

      <div className="overflow-hidden rounded-[20px] border border-gray-100 bg-white shadow-sm">
        <div className="border-b border-gray-100 p-5 sm:p-8">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-[#F0ECFF] px-3 py-1 font-mono text-[11px] font-bold tracking-wider text-[#6547D8]">
            <Layers3 className="h-3.5 w-3.5" /> MULTI-TOPIC TEST
          </div>
          <h2 className="text-[24px] font-extrabold tracking-tight text-[#1B4A4A] sm:text-[30px]">
            Build an equal-topic test
          </h2>
          <p className="mt-2 max-w-[680px] text-[14px] leading-relaxed text-[#6B7280]">
            Select up to five {classLabel(classLevel)} topics. Every available
            question total divides evenly across your selection.
          </p>
        </div>

        <div className="grid lg:grid-cols-[1fr_320px]">
          <div className="border-b border-gray-100 p-5 lg:border-r lg:border-b-0 sm:p-8">
            <div className="mb-6 flex flex-wrap gap-2">
              {subjects.map((subject) => (
                <button
                  type="button"
                  key={subject}
                  onClick={() => {
                    setSelectedSubject(subject);
                    setSelectedTopics([]);
                    setQuestionCount(10);
                    setSelectionMessage(null);
                  }}
                  className={`rounded-full px-5 py-2 font-mono text-[12px] font-bold transition-all ${
                    selectedSubject === subject
                      ? "bg-[#7C5CFC] text-white shadow-sm"
                      : "border border-gray-200 bg-white text-[#6B7280] hover:border-[#7C5CFC]"
                  }`}
                >
                  {subject}
                </button>
              ))}
            </div>

            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-[#9CA3AF]">
                Choose topics
              </span>
              <span className="text-[12px] font-bold text-[#7C5CFC]">
                {selectedTopics.length} of 5 selected
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {topicEntries.map((entry) => {
                const isSelected = selectedTopics.includes(entry.topic);
                return (
                  <button
                    type="button"
                    key={`${entry.subject}-${entry.classLevel}-${entry.topic}`}
                    onClick={() => toggleTopic(entry.topic)}
                    aria-pressed={isSelected}
                    className={`flex min-h-[64px] items-start gap-3 rounded-[14px] border p-3.5 text-left transition-all ${
                      isSelected
                        ? "border-[#7C5CFC] bg-[#F7F4FF] shadow-[0_0_0_2px_rgba(124,92,252,0.08)]"
                        : "border-gray-200 bg-white hover:border-[#7C5CFC]/50"
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                        isSelected
                          ? "border-[#7C5CFC] bg-[#7C5CFC] text-white"
                          : "border-gray-300 bg-white text-transparent"
                      }`}
                    >
                      <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    </span>
                    <span className="min-w-0">
                      <strong className="block text-[13px] leading-snug text-[#1B4A4A]">
                        {entry.topic}
                      </strong>
                      <span className="mt-1 block text-[11px] text-[#9CA3AF]">
                        {entry.questionCount} available
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            {selectionMessage && (
              <p className="mt-3 text-[12px] font-semibold text-[#F46853]">
                {selectionMessage}
              </p>
            )}
          </div>

          <aside className="bg-[#FCFBFF] p-5 sm:p-8">
            <h3 className="text-[19px] font-extrabold text-[#1B4A4A]">
              Your test
            </h3>
            <div className="mt-5 space-y-2">
              {selectedTopics.length > 0 ? (
                selectedTopics.map((topic) => (
                  <div
                    key={topic}
                    className="flex items-center justify-between gap-3 rounded-[11px] border border-[#7C5CFC]/10 bg-white px-3 py-2.5 text-[12px]"
                  >
                    <span className="min-w-0 truncate font-semibold text-[#4B5563]">
                      {topic}
                    </span>
                    <strong className="shrink-0 font-mono text-[11px] text-[#7C5CFC]">
                      {questionsPerTopic} questions
                    </strong>
                  </div>
                ))
              ) : (
                <div className="rounded-[12px] border border-dashed border-gray-200 bg-white px-4 py-6 text-center text-[12px] text-[#9CA3AF]">
                  Select at least one topic.
                </div>
              )}
            </div>

            <div className="mt-6">
              <div className="mb-2 flex items-end justify-between gap-3">
                <span className="text-[13px] font-bold text-[#1B4A4A]">
                  Total questions
                </span>
                <span className="font-mono text-[9px] font-bold text-[#9CA3AF]">
                  MIN 10 · MAX 30
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {validQuestionCounts.map((count) => (
                  <button
                    type="button"
                    key={count}
                    onClick={() => setQuestionCount(count)}
                    className={`min-w-10 rounded-[9px] border px-2.5 py-2 font-mono text-[12px] font-bold transition-all ${
                      effectiveQuestionCount === count
                        ? "border-[#7C5CFC] bg-[#7C5CFC] text-white"
                        : "border-gray-200 bg-white text-[#6B7280] hover:border-[#7C5CFC]"
                    }`}
                  >
                    {count}
                  </button>
                ))}
              </div>
              {selectedTopics.length > 0 &&
                validQuestionCounts.length === 0 && (
                  <p className="mt-2 text-[11px] leading-relaxed text-[#F46853]">
                    One selected topic does not have enough questions for an
                    equal test of at least 10 questions.
                  </p>
                )}
            </div>

            <div className="mt-6 grid grid-cols-2 gap-2">
              <div className="rounded-[12px] bg-white p-3">
                <div className="font-mono text-[9px] font-bold uppercase tracking-wider text-[#9CA3AF]">
                  Per topic
                </div>
                <div className="mt-1 text-[18px] font-extrabold text-[#1B4A4A]">
                  {questionsPerTopic || "—"}
                </div>
              </div>
              <div className="rounded-[12px] bg-white p-3">
                <div className="font-mono text-[9px] font-bold uppercase tracking-wider text-[#9CA3AF]">
                  Est. time
                </div>
                <div className="mt-1 text-[18px] font-extrabold text-[#1B4A4A]">
                  {effectiveQuestionCount
                    ? getEstimatedTestTimeLabel(effectiveQuestionCount)
                    : "—"}
                </div>
              </div>
            </div>

            <button
              type="button"
              disabled={
                isBusy ||
                selectedTopics.length === 0 ||
                effectiveQuestionCount === 0
              }
              onClick={() =>
                onBegin({
                  subject: selectedSubject,
                  topics: selectedTopics,
                  maxQuestions: effectiveQuestionCount,
                })
              }
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-[#7C5CFC] py-3.5 font-bold text-white shadow-[0_6px_20px_rgba(124,92,252,0.25)] transition-all hover:-translate-y-0.5 hover:bg-[#6C4CEB] disabled:translate-y-0 disabled:opacity-45"
            >
              {isBusy ? "Preparing…" : "Begin Test"}
              {!isBusy && <ChevronRight className="h-4 w-4" />}
            </button>
          </aside>
        </div>
      </div>
    </div>
  );
}

function TopicBrowseScreen({
  form,
  setForm,
  quizCatalog,
  defaultTopicEntry,
  assessmentCopy,
  onContinue,
  onBack,
  onSelectEntry,
}: {
  form: CreateSessionInput;
  setForm: React.Dispatch<React.SetStateAction<CreateSessionInput>>;
  quizCatalog: DemoQuizCatalog;
  defaultTopicEntry: DemoQuizCatalogEntry | null;
  assessmentCopy: (typeof ASSESSMENT_COPY)[AssessmentKind];
  onContinue: () => void;
  onBack: () => void;
  onSelectEntry: (entry: DemoQuizCatalogEntry) => void;
}) {
  const defaultEntry = defaultTopicEntry ?? getDefaultCatalogEntry(quizCatalog);
  const subjects = useMemo(
    () => Array.from(new Set(quizCatalog.entries.map((e) => e.subject))).sort(),
    [quizCatalog.entries],
  );
  const [selectedSubject, setSelectedSubject] = useState<string>(
    () => form.subject || defaultEntry?.subject || subjects[0] || "",
  );
  const [selectedTopic, setSelectedTopic] = useState<string | null>(
    () => form.topic || defaultEntry?.topic || null,
  );
  const [activeTab, setActiveTab] = useState<string>(
    () => form.classLevel || defaultEntry?.classLevel || "class6",
  );

  const classLevels = useMemo(
    () =>
      Array.from(new Set(quizCatalog.entries.map((e) => e.classLevel))).sort(),
    [quizCatalog.entries],
  );

  const filteredEntries = useMemo(
    () =>
      quizCatalog.entries.filter(
        (e) => e.classLevel === activeTab && e.subject === selectedSubject,
      ),
    [activeTab, selectedSubject, quizCatalog.entries],
  );

  const handleSelectTopic = (entry: DemoQuizCatalogEntry) => {
    setSelectedTopic(entry.topic);
    setForm((prev) => ({
      ...prev,
      topic: entry.topic,
      classLevel: entry.classLevel as never,
      subject: entry.subject,
      maxQuestions: getTopicQuestionCountForEntry(entry),
    }));
    onSelectEntry(entry);
  };

  const selectedEntry =
    filteredEntries.find((e) => e.topic === selectedTopic) ??
    filteredEntries[0];

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-6 flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-[13px] font-medium text-[#6B7280] transition-colors hover:text-[#1a1a1a]"
        >
          <ChevronLeft className="h-4 w-4" /> Back
        </button>
        <div className="h-1 w-px bg-[rgba(0,0,0,0.1)]" />
        <span className="font-mono text-[11px] font-bold uppercase tracking-widest text-[#2EC4B6]">
          • TOPIC TEST
        </span>
      </div>

      <div className="mb-6 text-center">
        <h2 className="text-[22px] font-extrabold tracking-tight text-[#1B4A4A] sm:text-[28px]">
          Pick a topic to test
        </h2>
        <p className="mt-1 text-[14px] text-[#6B7280]">
          {assessmentCopy.topicBrowseIntro}
        </p>
      </div>

      {/* Subject tabs */}
      <div className="mb-4 flex flex-wrap justify-center gap-2">
        {subjects.map((sub) => (
          <button
            key={sub}
            onClick={() => {
              setSelectedSubject(sub);
              setSelectedTopic(null);
            }}
            className={`rounded-full px-5 py-2 font-mono text-[12px] font-bold transition-all ${
              selectedSubject === sub
                ? "bg-[#2EC4B6] text-white shadow-sm"
                : "bg-white border border-gray-200 text-[#6B7280] hover:border-[#2EC4B6]"
            }`}
          >
            {sub}
          </button>
        ))}
      </div>

      {/* Class tabs */}
      <div className="mb-6 flex flex-wrap justify-center gap-2">
        {classLevels.map((cl) => (
          <button
            key={cl}
            onClick={() => {
              setActiveTab(cl);
              setSelectedTopic(null);
            }}
            className={`rounded-full px-5 py-2 font-mono text-[12px] font-bold transition-all ${
              activeTab === cl
                ? "bg-[#F5A623] text-white shadow-sm"
                : "bg-white border border-gray-200 text-[#6B7280] hover:border-[#F5A623]"
            }`}
          >
            Class {classNum(cl)}
          </button>
        ))}
      </div>

      {/* Topic cards */}
      <div className="mx-auto mb-6 grid max-w-[900px] grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filteredEntries.map((entry) => {
          const isSelected =
            selectedTopic === entry.topic ||
            (!selectedTopic && entry.topic === defaultEntry?.topic);
          return (
            <button
              type="button"
              key={`${entry.subject}-${entry.classLevel}-${entry.topic}`}
              onClick={() => handleSelectTopic(entry)}
              className={`cursor-pointer rounded-[14px] border-2 p-4 text-left transition-all duration-150 ${
                isSelected
                  ? "border-[#F5A623] bg-[rgba(245,166,35,0.04)] shadow-sm"
                  : "border-gray-100 bg-white hover:border-[#2EC4B6] hover:shadow-sm"
              }`}
            >
              <div
                className={`mb-1 font-mono text-[10px] font-bold uppercase tracking-wider ${isSelected ? "text-[#F5A623]" : "text-[#9CA3AF]"}`}
              >
                {entry.subject}
              </div>
              <div className="font-bold text-[14px] text-[#1B4A4A] leading-snug">
                {entry.topic}
              </div>
              {isSelected && (
                <div className="mt-1.5 font-mono text-[10px] text-[#F5A623]">
                  ✓ Selected
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Continue button */}
      <div className="flex justify-center">
        <button
          onClick={() => {
            if (selectedEntry) handleSelectTopic(selectedEntry);
            onContinue();
          }}
          className="flex items-center gap-2 rounded-full bg-[#F5A623] px-7 py-3.5 font-bold text-[15px] text-white shadow-[0_6px_20px_rgba(245,166,35,0.30)] transition-all hover:bg-[#E0941A] hover:-translate-y-0.5 hover:shadow-[0_10px_28px_rgba(245,166,35,0.40)] sm:px-10"
        >
          <span className="hidden sm:inline">Continue to Start Screen</span>
          <span className="sm:hidden">Continue</span>
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ─── Topic Start Screen ────────────────────────────────────────────────────────
function TopicStartScreen({
  form,
  topicEntries,
  assessmentCopy,
  onSelectTopic,
  onBegin,
  onBack,
  isBusy,
}: {
  form: CreateSessionInput;
  learningObjectives: string[];
  topicEntries: DemoQuizCatalogEntry[];
  assessmentCopy: (typeof ASSESSMENT_COPY)[AssessmentKind];
  onSelectTopic: (entry: DemoQuizCatalogEntry) => void;
  onBegin: () => void;
  onBack: () => void;
  isBusy: boolean;
}) {
  const subjects = useMemo(
    () => Array.from(new Set(topicEntries.map((e) => e.subject))).sort(),
    [topicEntries],
  );
  const [selectedSubject, setSelectedSubject] = useState(
    form.subject || topicEntries[0]?.subject || "Maths",
  );

  const filteredTopicEntries = useMemo(
    () => topicEntries.filter((entry) => entry.subject === selectedSubject),
    [topicEntries, selectedSubject],
  );

  const selectedTopic = filteredTopicEntries.some(
    (entry) => entry.topic === form.topic,
  )
    ? form.topic
    : (filteredTopicEntries[0]?.topic ?? "");
  const selectedEntry =
    filteredTopicEntries.find((entry) => entry.topic === selectedTopic) ??
    filteredTopicEntries[0];
  const questionCount = getTopicQuestionCountForEntry(selectedEntry);
  const estimatedTime = getEstimatedTestTimeLabel(questionCount);

  return (
    <div className="mx-auto max-w-[680px] animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-4 flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-[13px] font-medium text-[#6B7280] transition-colors hover:text-[#1a1a1a]"
        >
          <ChevronLeft className="h-4 w-4" /> Back
        </button>
      </div>

      <div className="rounded-[20px] border border-gray-100 bg-white p-5 shadow-sm sm:p-8">
        <div className="mb-3 inline-block rounded-full bg-[#E6F8F7] px-3 py-1 font-mono text-[11px] font-bold tracking-wider text-[#1B4A4A]">
          TOPIC TEST
        </div>

        <h2 className="mb-2 text-[24px] font-extrabold tracking-tight text-[#1B4A4A] sm:text-[30px]">
          {form.topic}
        </h2>
        <p className="mb-6 text-[14px] leading-relaxed text-[#6B7280]">
          {assessmentCopy.topicStartIntro}
        </p>

        <label className="mb-4 block">
          <span className="mb-2 block font-mono text-[10px] font-bold uppercase tracking-widest text-[#9CA3AF]">
            Subject
          </span>
          <div className="relative">
            <select
              value={selectedSubject}
              onChange={(event) => {
                const newSubject = event.target
                  .value as CreateSessionInput["subject"];
                setSelectedSubject(newSubject);
                const nextEntry = topicEntries.find(
                  (entry) => entry.subject === newSubject,
                );
                if (nextEntry) onSelectTopic(nextEntry);
              }}
              disabled={subjects.length <= 1 || isBusy}
              className="h-12 w-full appearance-none rounded-[14px] border border-gray-200 bg-[#F8F9FA] px-4 pr-11 text-[15px] font-semibold text-[#1a1a1a] outline-none transition-all focus:border-[#2EC4B6] focus:bg-white focus:ring-4 focus:ring-[#2EC4B6]/10 disabled:opacity-60"
            >
              {subjects.map((sub) => (
                <option key={sub} value={sub}>
                  {sub}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7280]"
              aria-hidden="true"
            />
          </div>
        </label>

        <label className="mb-6 block">
          <span className="mb-2 block font-mono text-[10px] font-bold uppercase tracking-widest text-[#9CA3AF]">
            Topic
          </span>
          <div className="relative">
            <select
              value={selectedTopic}
              onChange={(event) => {
                const nextEntry = filteredTopicEntries.find(
                  (entry) => entry.topic === event.target.value,
                );
                if (nextEntry) onSelectTopic(nextEntry);
              }}
              disabled={filteredTopicEntries.length === 0 || isBusy}
              className="h-12 w-full appearance-none rounded-[14px] border border-gray-200 bg-[#F8F9FA] px-4 pr-11 text-[15px] font-semibold text-[#1a1a1a] outline-none transition-all focus:border-[#2EC4B6] focus:bg-white focus:ring-4 focus:ring-[#2EC4B6]/10 disabled:opacity-60"
            >
              {filteredTopicEntries.map((entry) => (
                <option
                  key={`${entry.subject}-${entry.classLevel}-${entry.topic}`}
                  value={entry.topic}
                >
                  {entry.topic}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7280]"
              aria-hidden="true"
            />
          </div>
        </label>

        <div className="mb-7 grid gap-3 sm:grid-cols-3">
          {[
            { label: "Questions", value: String(questionCount) },
            { label: "Estimated time", value: estimatedTime },
            { label: "Grade", value: classLabel(form.classLevel) },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-[14px] border border-gray-100 bg-[#F8F9FA] p-4"
            >
              <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-[#9CA3AF]">
                {item.label}
              </div>
              <div className="mt-1 text-[18px] font-extrabold text-[#1B4A4A]">
                {item.value}
              </div>
            </div>
          ))}
        </div>

        <div className="mb-8 rounded-[14px] bg-[#FFF8E7] p-4 text-[13px] font-medium leading-relaxed text-[#6B7280]">
          You can move through the test one question at a time. Try to answer
          without guessing too quickly.
        </div>

        {/* Begin button */}
        <button
          onClick={onBegin}
          disabled={isBusy}
          className="flex w-full items-center justify-center gap-3 rounded-full bg-[#F5A623] py-4 font-bold text-[17px] text-white shadow-[0_6px_20px_rgba(245,166,35,0.30)] transition-all hover:bg-[#E0941A] hover:-translate-y-0.5 hover:shadow-[0_10px_28px_rgba(245,166,35,0.40)] disabled:opacity-60"
        >
          {isBusy ? (
            <>
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Preparing...
            </>
          ) : (
            "Begin Test"
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Grade Browse Screen ───────────────────────────────────────────────────────
function GradeBrowseScreen({
  quizCatalog,
  assessmentCopy,
  onSelect,
  onBack,
}: {
  quizCatalog: DemoQuizCatalog;
  assessmentCopy: (typeof ASSESSMENT_COPY)[AssessmentKind];
  onSelect: (classLevel: string, subject: string) => void;
  onBack: () => void;
}) {
  const subjects = useMemo(
    () => Array.from(new Set(quizCatalog.entries.map((e) => e.subject))).sort(),
    [quizCatalog.entries],
  );
  const [selectedSubject, setSelectedSubject] = useState<string>(
    () => subjects[0] || "",
  );

  const classLevels = useMemo(
    () =>
      Array.from(new Set(quizCatalog.entries.map((e) => e.classLevel))).sort(),
    [quizCatalog.entries],
  );

  const gradeEmojis: Record<string, string> = {
    class4: "🏆",
    class6: "🔬",
    class7: "⚗️",
    class8: "🧪",
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-6 flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-[13px] font-medium text-[#6B7280] transition-colors hover:text-[#1a1a1a]"
        >
          <ChevronLeft className="h-4 w-4" /> Back
        </button>
        <div className="h-4 w-px bg-[rgba(0,0,0,0.1)]" />
        <span className="font-mono text-[11px] font-bold uppercase tracking-widest text-[#F5A623]">
          • GRADE TEST
        </span>
      </div>

      <div className="mb-8 text-center">
        <h2 className="text-[22px] font-extrabold tracking-tight text-[#1B4A4A] sm:text-[28px]">
          Choose your grade
        </h2>
        <p className="mt-1 text-[14px] text-[#6B7280]">
          {assessmentCopy.gradeBrowseIntro}
        </p>
      </div>

      {/* Subject tabs */}
      <div className="mb-8 flex flex-wrap justify-center gap-2">
        {subjects.map((sub) => (
          <button
            key={sub}
            onClick={() => setSelectedSubject(sub)}
            className={`rounded-full px-5 py-2 font-mono text-[12px] font-bold transition-all ${
              selectedSubject === sub
                ? "bg-[#2EC4B6] text-white shadow-sm"
                : "bg-white border border-gray-200 text-[#6B7280] hover:border-[#2EC4B6]"
            }`}
          >
            {sub}
          </button>
        ))}
      </div>

      <div className="mx-auto grid max-w-[700px] grid-cols-2 gap-5 sm:grid-cols-3">
        {classLevels.map((cl) => {
          const topicsForClass = quizCatalog.entries.filter(
            (e) => e.classLevel === cl && e.subject === selectedSubject,
          );
          if (topicsForClass.length === 0) return null;
          return (
            <button
              type="button"
              key={cl}
              onClick={() => onSelect(cl, selectedSubject)}
              className="cursor-pointer rounded-[20px] border border-gray-100 bg-white p-7 text-center shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-[#F5A623] hover:shadow-[0_8px_28px_rgba(245,166,35,0.14)]"
            >
              <div className="mb-3 text-[40px] leading-none">
                {gradeEmojis[cl] ?? "📚"}
              </div>
              <h3 className="mb-1 text-[20px] font-extrabold text-[#1B4A4A]">
                Grade {classNum(cl)}
              </h3>
              <p className="text-[13px] text-[#6B7280]">
                {topicsForClass.length} topics covered
              </p>
              <div className="mt-4 inline-flex items-center gap-1 font-semibold text-[13px] text-[#F5A623]">
                Select <span className="text-[16px]">›</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Grade Start Screen ────────────────────────────────────────────────────────
function GradeStartScreen({
  classLevel,
  subject,
  assessmentCopy,
  onBegin,
  onBeginRandom,
  onBack,
  isBusy,
  testMode,
}: {
  classLevel: string;
  subject: string;
  assessmentCopy: (typeof ASSESSMENT_COPY)[AssessmentKind];
  onBegin: () => void;
  onBeginRandom?: () => void;
  onBack: () => void;
  isBusy: boolean;
  testMode?: string;
}) {
  const isPlacement = testMode === "placement";
  const questionCount = isPlacement
    ? 20
    : getGradeQuestionCountForClass(
        classLevel as CreateSessionInput["classLevel"],
      );

  return (
    <div
      className={`mx-auto max-w-[680px] animate-in fade-in slide-in-from-bottom-4 duration-500 ${
        isPlacement
          ? "flex min-h-[calc(100vh-160px)] flex-col justify-center sm:block sm:min-h-0"
          : ""
      }`}
    >
      <div className="mb-4 flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-[13px] font-medium text-[#6B7280] transition-colors hover:text-[#1a1a1a]"
        >
          <ChevronLeft className="h-4 w-4" /> Back
        </button>
      </div>

      <div
        className={
          isPlacement
            ? "rounded-[20px] bg-white p-5 sm:p-8"
            : "rounded-[20px] border border-gray-100 bg-white p-5 shadow-sm sm:p-8"
        }
        style={
          isPlacement
            ? {
                border: "2px solid rgba(46,196,182,0.25)",
                boxShadow:
                  "0 6px 0 rgba(46,196,182,0.18), 0 4px 14px rgba(26,26,46,0.06)",
              }
            : undefined
        }
      >
        <div className="mb-3 inline-block rounded-full bg-[#FFF8E7] px-3 py-1 font-mono text-[11px] font-bold tracking-wider text-[#1B4A4A]">
          {isPlacement ? "PLACEMENT TEST" : "GRADE TEST"}
        </div>

        <h2 className="mb-2 text-[24px] font-extrabold tracking-tight text-[#1B4A4A] sm:text-[30px]">
          Grade {classNum(classLevel)} {subject}
        </h2>
        <p className="mb-6 text-[14px] leading-relaxed text-[#6B7280]">
          {assessmentCopy.gradeStartIntro}
        </p>

        <div className="mb-7 grid gap-3 sm:grid-cols-3">
          {[
            { label: "Questions", value: String(questionCount) },
            {
              label: "Estimated time",
              value: getEstimatedTestTimeLabel(questionCount),
            },
            { label: "Grade", value: `Grade ${classNum(classLevel)}` },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-[14px] border border-gray-100 bg-[#F8F9FA] p-4"
            >
              <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-[#9CA3AF]">
                {item.label}
              </div>
              <div className="mt-1 text-[18px] font-extrabold text-[#1B4A4A]">
                {item.value}
              </div>
            </div>
          ))}
        </div>

        {!isPlacement && (
          <div className="mb-8 rounded-[14px] bg-[#FFF8E7] p-4 text-[13px] font-medium leading-relaxed text-[#6B7280]">
            You can move through the test one question at a time. Try to answer
            without guessing too quickly.
          </div>
        )}

        <button
          onClick={onBegin}
          disabled={isBusy}
          className={`flex w-full items-center justify-center gap-3 rounded-full bg-[#F5A623] py-4 font-bold text-[17px] text-white transition-all hover:bg-[#E0941A] disabled:opacity-60 ${
            isPlacement
              ? "shadow-[0_6px_0_#C68213] hover:translate-y-0.5 hover:shadow-[0_3px_0_#C68213] active:translate-y-1 active:shadow-[0_0_0_#C68213] disabled:translate-y-0 disabled:shadow-[0_6px_0_#C68213]"
              : "shadow-[0_6px_20px_rgba(245,166,35,0.30)] hover:-translate-y-0.5 hover:shadow-[0_10px_28px_rgba(245,166,35,0.40)]"
          }`}
        >
          {isBusy ? (
            <>
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Preparing…
            </>
          ) : (
            "Begin Test"
          )}
        </button>

        {isPlacement && onBeginRandom && (
          <button
            type="button"
            onClick={onBeginRandom}
            disabled={isBusy}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-full border border-dashed border-[#2563EB]/35 bg-[#EFF6FF] py-3.5 font-mono text-[12px] font-bold uppercase tracking-wider text-[#2563EB] transition hover:bg-[#DBEAFE] disabled:opacity-50"
          >
            <Shuffle className="h-4 w-4" />
            Randomly answer and show result
          </button>
        )}
      </div>
    </div>
  );
}

function renderFormattedQuestionText(text: string) {
  if (!text || !text.includes("{{")) {
    return text;
  }
  const parts = text.split(/(\{\{\d+\}\})/g);
  return (
    <span>
      {parts.map((part, idx) => {
        const match = part.match(/^\{\{(\d+)\}\}$/);
        if (match) {
          const num = match[1];
          return (
            <span
              key={`blank-${idx}`}
              className="mx-1.5 inline-flex items-center rounded-md border-2 border-dashed border-[#F5A623] bg-[#FFF8E7] px-2.5 py-0.5 font-mono text-[14px] font-bold text-[#C68213]"
            >
              [ Blank {num} ]
            </span>
          );
        }
        return <span key={`text-${idx}`}>{part}</span>;
      })}
    </span>
  );
}

// ─── Question Input ────────────────────────────────────────────────────────────
export function QuestionInput({
  question,
  answer,
  setAnswer,
  assessmentKind = "diagnostic",
}: {
  question: DemoQuizQuestion;
  answer: string;
  setAnswer: (value: string) => void;
  assessmentKind?: AssessmentKind;
}) {
  const isPlacement = assessmentKind === "placement";
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);

  if (question.questionType === "mcq" && question.options) {
    const payload = question.payload as
      | { options?: Array<{ svg?: string | null }> }
      | undefined;
    const hasOptionSvg = question.options.some((_, index) =>
      Boolean(payload?.options?.[index]?.svg),
    );

    if (hasOptionSvg) {
      return (
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          {question.options.map((option, index) => {
            const label = OPTION_LABELS[index] ?? "";
            const selected = answer === label;
            const optionSvg = payload?.options?.[index]?.svg;
            return (
              <button
                key={`${question.id}-${label}`}
                type="button"
                onClick={() => setAnswer(label)}
                className={`group flex min-h-[190px] flex-col rounded-[18px] border-2 bg-white p-3 text-left transition-all duration-200 sm:min-h-[220px] sm:p-4 ${
                  selected
                    ? "border-[#F5A623] shadow-[0_10px_28px_rgba(245,166,35,0.18)]"
                    : "border-gray-100 hover:-translate-y-0.5 hover:border-[#2EC4B6]/60 hover:shadow-sm"
                }`}
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 font-mono text-[14px] font-extrabold transition-all ${
                      selected
                        ? "border-[#F5A623] bg-[#F5A623] text-white"
                        : "border-gray-200 bg-[#F8F9FA] text-[#6B7280] group-hover:border-[#F5A623] group-hover:text-[#F5A623]"
                    }`}
                  >
                    {label}
                  </span>
                  {selected ? (
                    <span className="rounded-full bg-[#FFF8E7] px-2.5 py-1 font-mono text-[10px] font-bold text-[#C68213]">
                      Selected
                    </span>
                  ) : null}
                </div>

                <div className="flex flex-1 items-center justify-center rounded-[14px] border border-gray-100 bg-[#F8F9FA] p-3 sm:p-4 [&_svg]:h-full [&_svg]:max-h-[116px] [&_svg]:w-full [&_svg]:max-w-[180px]">
                  {optionSvg ? (
                    <span
                      className="flex h-[112px] w-full items-center justify-center sm:h-[132px]"
                      dangerouslySetInnerHTML={{ __html: optionSvg }}
                    />
                  ) : (
                    <span className="text-center text-[13px] font-semibold leading-snug text-[#6B7280]">
                      No visual
                    </span>
                  )}
                </div>

                {option.trim() ? (
                  <div className="mt-3 text-[13px] font-semibold leading-snug text-[#1a1a1a] sm:text-[14px]">
                    {option}
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      );
    }

    return (
      <div
        className={
          isPlacement
            ? "grid grid-cols-1 gap-3 sm:grid-cols-2"
            : "flex flex-col gap-3"
        }
      >
        {question.options.map((option, index) => {
          const label = OPTION_LABELS[index] ?? "";
          const selected = answer === label;
          const optionSvg = payload?.options?.[index]?.svg;
          return (
            <button
              key={`${question.id}-${label}`}
              type="button"
              onClick={() => setAnswer(label)}
              className={`group flex w-full items-center gap-4 border-2 p-4 text-left transition-all duration-200 ${
                isPlacement ? "rounded-[8px]" : "rounded-full"
              } ${
                selected
                  ? "border-[#F5A623] bg-[rgba(245,166,35,0.05)] text-[#1B4A4A]"
                  : "border-gray-100 bg-white text-[#1a1a1a] hover:translate-x-0.5 hover:border-[#2EC4B6]/50 hover:shadow-sm"
              }`}
            >
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center border-2 font-mono text-[14px] font-extrabold transition-all ${
                  isPlacement ? "rounded-[6px]" : "rounded-full"
                } ${
                  selected
                    ? "border-[#F5A623] bg-[#F5A623] text-white"
                    : "border-gray-200 bg-[#F8F9FA] text-[#6B7280] group-hover:border-[#F5A623] group-hover:text-[#F5A623]"
                }`}
              >
                {label}
              </span>
              <span className="flex flex-1 items-center justify-between gap-4">
                <span className="text-[15px] font-semibold leading-snug">
                  {option}
                </span>
                {optionSvg ? (
                  <span
                    className="h-20 w-24 shrink-0 rounded-[10px] border border-gray-100 bg-[#F8F9FA] p-2"
                    dangerouslySetInnerHTML={{ __html: optionSvg }}
                  />
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  if (question.questionType === "true_false") {
    return (
      <div className="flex flex-row gap-4">
        {["true", "false"].map((value) => {
          const selected = answer === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setAnswer(value)}
              className={`flex-1 border-2 p-5 text-center transition-all duration-200 rounded-full ${
                selected
                  ? "border-[#F5A623] bg-[rgba(245,166,35,0.05)] font-bold text-[#1B4A4A]"
                  : "border-gray-100 bg-white font-semibold text-[#6B7280] hover:-translate-y-0.5 hover:border-[#2EC4B6]/50 hover:shadow-sm"
              }`}
            >
              <span className="font-mono text-[16px] uppercase tracking-wider">
                {value === "true" ? "True" : "False"}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  if (
    question.questionType === "matching" ||
    question.questionType === "drag_drop"
  ) {
    const payload = question.payload as
      | MatchingQuestionPayload
      | DragDropQuestionPayload
      | undefined;
    const leftItems =
      question.questionType === "matching"
        ? ((payload as MatchingQuestionPayload)?.premises ?? [])
        : ((payload as DragDropQuestionPayload)?.draggableItems ?? []);
    const rightItems =
      question.questionType === "matching"
        ? ((payload as MatchingQuestionPayload)?.responses ?? [])
        : ((payload as DragDropQuestionPayload)?.dropZones ?? []);
    const answerMap = getAnswerMap(answer);
    const isOrdinalDragDrop =
      question.questionType === "drag_drop" &&
      rightItems.every((target) => /^\d+(st|nd|rd|th)$/i.test(target));
    const isSingleItemTarget =
      question.questionType === "matching" || isOrdinalDragDrop;
    const targetToItems = rightItems.reduce<Record<string, string[]>>(
      (acc, target) => {
        acc[target] = Object.entries(answerMap)
          .filter(([_item, mappedTarget]) => mappedTarget === target)
          .map(([item]) => item);
        return acc;
      },
      {},
    );

    const commitAnswerMap = (nextMap: Record<string, string>) => {
      setAnswer(JSON.stringify(nextMap));
    };

    // ── Desktop drag handlers ──────────────────────────────────────────────────
    const handleDragStart = (
      event: React.DragEvent<HTMLElement>,
      item: string,
    ) => {
      event.dataTransfer.setData("text/plain", item);
      event.dataTransfer.effectAllowed = "move";
    };

    const handleDrop = (
      event: React.DragEvent<HTMLElement>,
      target: string,
    ) => {
      event.preventDefault();
      const item = event.dataTransfer.getData("text/plain");
      if (!item || !leftItems.includes(item)) return;
      const nextMap = Object.fromEntries(
        Object.entries(answerMap).filter(
          ([mappedItem, mappedTarget]) =>
            mappedItem !== item &&
            (!isSingleItemTarget || mappedTarget !== target),
        ),
      );
      nextMap[item] = target;
      commitAnswerMap(nextMap);
      setSelectedItem(null);
    };

    // ── Tap-to-select / tap-to-place (mobile + desktop) ──────────────────────
    const handleSourceTap = (item: string) => {
      if (answerMap[item]) {
        // Already placed — un-place it
        const nextMap = Object.fromEntries(
          Object.entries(answerMap).filter(([k]) => k !== item),
        );
        commitAnswerMap(nextMap);
        setSelectedItem(null);
      } else {
        setSelectedItem(selectedItem === item ? null : item);
      }
    };

    const handleZoneTap = (target: string) => {
      if (selectedItem) {
        // Place the selected item into this zone
        const nextMap = Object.fromEntries(
          Object.entries(answerMap).filter(
            ([mappedItem, mappedTarget]) =>
              mappedItem !== selectedItem &&
              (!isSingleItemTarget || mappedTarget !== target),
          ),
        );
        nextMap[selectedItem] = target;
        commitAnswerMap(nextMap);
        setSelectedItem(null);
      } else {
        // No selection — clear the zone
        const nextMap = Object.fromEntries(
          Object.entries(answerMap).filter(([, t]) => t !== target),
        );
        commitAnswerMap(nextMap);
      }
    };

    const placedCount = Object.keys(answerMap).filter((item) =>
      leftItems.includes(item),
    ).length;
    const totalSlots = isSingleItemTarget
      ? rightItems.length
      : leftItems.length;
    const unplacedItems = leftItems.filter((item) => !answerMap[item]);
    const placedItemsLookup = leftItems.filter((item) =>
      Boolean(answerMap[item]),
    );

    const onZoneDragOver = (
      event: React.DragEvent<HTMLElement>,
      target: string,
    ) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (dragOverTarget !== target) setDragOverTarget(target);
    };

    const onZoneDragLeave = (target: string) => {
      if (dragOverTarget === target) setDragOverTarget(null);
    };

    const renderPiece = (
      item: string,
      opts?: { compact?: boolean; inSlot?: boolean },
    ) => {
      const isSelected = selectedItem === item;
      return (
        <button
          key={`piece-${item}`}
          type="button"
          draggable
          onDragStart={(e) => handleDragStart(e, item)}
          onDragEnd={() => setDragOverTarget(null)}
          onClick={(e) => {
            e.stopPropagation();
            handleSourceTap(item);
          }}
          className={`group relative select-none rounded-full border-2 font-mono font-bold transition-all duration-150 ${
            opts?.compact
              ? "px-3 py-1.5 text-[13px]"
              : "px-4 py-2.5 text-[15px] sm:px-5 sm:py-3 sm:text-[16px]"
          } ${
            isSelected
              ? "scale-[1.04] border-[#F5A623] bg-[#F5A623] text-white shadow-[0_0_0_4px_rgba(245,166,35,0.25)] animate-pulse"
              : opts?.inSlot
                ? "cursor-pointer border-[#F5A623] bg-white text-[#1B4A4A] shadow-sm hover:bg-[#FFF8E7]"
                : "cursor-pointer border-[#F5A623] bg-white text-[#1B4A4A] shadow-sm hover:-translate-y-0.5 hover:scale-[1.02]"
          }`}
          title={opts?.inSlot ? "Tap to remove" : "Tap to select"}
        >
          {item}
          {opts?.inSlot && (
            <span className="ml-2 inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#F8F9FA] text-[10px] font-bold text-[#9CA3AF] group-hover:bg-[#F5A623] group-hover:text-white">
              ✕
            </span>
          )}
        </button>
      );
    };

    return (
      <div className="rounded-[20px] border border-[#EFEAE0] bg-[linear-gradient(180deg,#FAFAF7_0%,#F4F1EA_100%)] p-4 sm:p-5">
        {/* Header strip */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-[#6B7280]">
            {selectedItem ? (
              <span className="text-[#F5A623]">
                ✨ Selected: "{selectedItem}" — tap a slot
              </span>
            ) : placedCount === 0 ? (
              <span>🧩 Pick a piece, then tap a slot</span>
            ) : (
              <span>Tap a piece to swap, or a slot to clear</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 rounded-full border border-[#E2DED4] bg-white px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-[#6B7280]">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                placedCount === totalSlots ? "bg-[#22C55E]" : "bg-[#F5A623]"
              }`}
            />
            {placedCount} / {totalSlots} placed
          </div>
        </div>

        {/* Pieces bank */}
        <div className="mb-4 rounded-[14px] border border-[rgba(0,0,0,0.06)] bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.03)] sm:p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#9CA3AF]">
              Pieces
            </div>
            {unplacedItems.length === 0 && (
              <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#22C55E]">
                ✓ all placed
              </div>
            )}
          </div>
          <div className="flex min-h-[56px] flex-wrap items-center justify-center gap-2.5 sm:gap-3">
            {unplacedItems.length === 0 ? (
              <div className="text-[12px] italic text-[#9CA3AF]">
                Tap a slot below to remove a piece and place it again
              </div>
            ) : (
              unplacedItems.map((item) => renderPiece(item))
            )}
          </div>
        </div>

        {/* Slots */}
        {isOrdinalDragDrop ? (
          <div className="relative rounded-[14px] border border-[rgba(0,0,0,0.06)] bg-white p-4 sm:p-5">
            {/* Anchor labels */}
            <div className="mb-3 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-[#9CA3AF]">
              <span className="font-mono">↑ First</span>
              <span className="font-mono">Last ↓</span>
            </div>

            <div className="relative space-y-2">
              {/* Vertical guide line */}
              <div className="pointer-events-none absolute left-[22px] top-2 bottom-2 w-px bg-[linear-gradient(180deg,#22C55E_0%,#F5A623_50%,#EF4444_100%)] opacity-30" />

              {rightItems.map((target, index) => {
                const placedItem = targetToItems[target]?.[0];
                const isActiveTarget = Boolean(selectedItem);
                const isDragOver = dragOverTarget === target;
                return (
                  <div
                    key={target}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleZoneTap(target)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleZoneTap(target);
                      }
                    }}
                    onDragOver={(e) => onZoneDragOver(e, target)}
                    onDragLeave={() => onZoneDragLeave(target)}
                    onDrop={(e) => {
                      handleDrop(e, target);
                      setDragOverTarget(null);
                    }}
                    className={`relative flex w-full cursor-pointer items-center gap-3 rounded-[12px] border-2 px-3 py-3 text-left transition-all sm:gap-4 sm:px-4 ${
                      isDragOver
                        ? "scale-[1.01] border-[#F5A623] bg-[#FFF4DD] shadow-[0_0_0_3px_rgba(245,166,35,0.2)]"
                        : placedItem
                          ? "border-[#22C55E]/40 bg-[#F0FDF4]"
                          : isActiveTarget
                            ? "animate-pulse border-dashed border-[#F5A623] bg-[#FFF8E7]"
                            : "border-dashed border-[#D6D2C8] bg-[#FAFAF7]"
                    }`}
                  >
                    <span
                      className={`relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-mono text-[13px] font-extrabold ${
                        placedItem
                          ? "bg-[#22C55E] text-white"
                          : "bg-white text-[#6B7280] ring-2 ring-[#D6D2C8]"
                      }`}
                    >
                      {index + 1}
                    </span>
                    <div className="flex flex-1 items-center justify-between gap-3">
                      {placedItem ? (
                        renderPiece(placedItem, { inSlot: true })
                      ) : (
                        <span
                          className={`text-[13px] font-semibold ${
                            isActiveTarget ? "text-[#F5A623]" : "text-[#9CA3AF]"
                          }`}
                        >
                          {isActiveTarget
                            ? "Tap to drop here"
                            : "Empty — drop a piece"}
                        </span>
                      )}
                      <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#9CA3AF]">
                        {target}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="rounded-[14px] border border-[rgba(0,0,0,0.06)] bg-white p-4 sm:p-5">
            <div className="flex flex-col gap-2.5">
              {rightItems.map((target) => {
                const placedItems = targetToItems[target] ?? [];
                const isActiveTarget = Boolean(selectedItem);
                const isDragOver = dragOverTarget === target;
                return (
                  <div
                    key={target}
                    className="flex items-stretch gap-2.5 sm:gap-3"
                  >
                    <div className="flex w-[100px] shrink-0 items-center rounded-[10px] bg-[#F8F9FA] px-3 text-[13px] font-bold text-[#1B4A4A] sm:w-[120px] sm:text-[14px]">
                      {target}
                    </div>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => handleZoneTap(target)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleZoneTap(target);
                        }
                      }}
                      onDragOver={(e) => onZoneDragOver(e, target)}
                      onDragLeave={() => onZoneDragLeave(target)}
                      onDrop={(e) => {
                        handleDrop(e, target);
                        setDragOverTarget(null);
                      }}
                      className={`flex min-h-[52px] flex-1 cursor-pointer flex-wrap items-center justify-start gap-2 rounded-[10px] border-2 px-3 py-2 text-left transition-all sm:px-4 ${
                        isDragOver
                          ? "scale-[1.005] border-[#F5A623] bg-[#FFF4DD] shadow-[0_0_0_3px_rgba(245,166,35,0.2)]"
                          : placedItems.length > 0
                            ? "border-[#22C55E]/40 bg-[#F0FDF4]"
                            : isActiveTarget
                              ? "animate-pulse border-dashed border-[#F5A623] bg-[#FFF8E7]"
                              : "border-dashed border-[#D6D2C8] bg-[#FAFAF7]"
                      }`}
                    >
                      {placedItems.length > 0 ? (
                        placedItems.map((item) =>
                          renderPiece(item, { compact: true, inSlot: true }),
                        )
                      ) : (
                        <span
                          className={`text-[13px] font-semibold ${
                            isActiveTarget ? "text-[#F5A623]" : "text-[#9CA3AF]"
                          }`}
                        >
                          {isActiveTarget
                            ? "Tap to drop here"
                            : "Drop a piece here"}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {placedItemsLookup.length > 0 && (
          <div className="mt-3 text-center font-mono text-[10px] font-bold uppercase tracking-wider text-[#9CA3AF]">
            Tap a placed piece (✕) to send it back to the bank
          </div>
        )}
      </div>
    );
  }

  if (question.questionType === "fitb") {
    return (
      <input
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        placeholder="Type the missing word or phrase…"
        className="w-full rounded-full border border-gray-200 bg-[#F8F9FA] px-5 py-4 text-[15px] font-semibold text-[#1a1a1a] outline-none transition-all focus:border-[#F5A623] focus:bg-white focus:shadow-[0_0_0_3px_rgba(245,166,35,0.15)]"
      />
    );
  }

  return (
    <input
      value={answer}
      onChange={(e) => setAnswer(e.target.value)}
      placeholder="Type your answer…"
      className="w-full rounded-full border border-gray-200 bg-[#F8F9FA] px-5 py-4 text-[15px] font-semibold text-[#1a1a1a] outline-none transition-all focus:border-[#F5A623] focus:bg-white focus:shadow-[0_0_0_3px_rgba(245,166,35,0.15)]"
    />
  );
}

// ─── Mascot Report V2 ──────────────────────────────────────────────────────────
function MascotReportV2({
  report,
  onReset,
  onRecurring,
  isBusy = false,
}: {
  report: DiagnosticReport;
  onReset: () => void;
  onRecurring: (assessmentId: string) => void;
  isBusy?: boolean;
}) {
  const studentName = getStudentDisplayName(report.studentId);
  const firstName = studentName.split(" ")[0];
  const results = report.results ?? [];
  const learningObjectives = report.learningObjectiveResults ?? [];
  const score = report.overallReadinessScore ?? report.readinessScore ?? 0;
  const roundedScore = Math.round(score);
  const narrative = report.resultNarrative;

  const totalQuestions = results.length || report.totalQuestionsShown || 0;
  const correctCount = results.filter((r) => r.verdict === "correct").length;
  const partialCount = results.filter((r) => r.verdict === "partial").length;
  const wrongRecords = useMemo(
    () => results.filter((r) => r.verdict !== "correct"),
    [results],
  );
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedReviewId(wrongRecords[0]?.question.id ?? null);
  }, [wrongRecords]);

  const selectedReview =
    wrongRecords.find((record) => record.question.id === selectedReviewId) ??
    wrongRecords[0] ??
    null;

  // Sort LOs: best → worst
  const sortedLOs = [...learningObjectives].sort((a, b) => b.score - a.score);

  const getMascotConfig = (pct: number) => {
    if (pct >= 80)
      return {
        face: "🦁",
        badge: "🏆",
        tier: "Excellent work",
        tierColor: "#1e7e34",
      };
    if (pct >= 60)
      return {
        face: "🦊",
        badge: "⛰️",
        tier: "Great effort",
        tierColor: "#1e7e34",
      };
    if (pct >= 40)
      return {
        face: "🐯",
        badge: "💪",
        tier: "Solid climb",
        tierColor: "#b8860b",
      };
    return {
      face: "🐻",
      badge: "🔧",
      tier: "Keep going",
      tierColor: "#c0392b",
    };
  };

  const mascot = getMascotConfig(roundedScore);

  const getMasteryPips = (pct: number) => {
    if (pct >= 90) return { filled: 5, label: "Expert" };
    if (pct >= 75) return { filled: 4, label: "Proficient" };
    if (pct >= 60) return { filled: 3, label: "Developing" };
    if (pct >= 40) return { filled: 2, label: "Climbing" };
    return { filled: 1, label: "Starting" };
  };

  const mastery = getMasteryPips(roundedScore);

  const getStars = (loScore: number) => {
    if (loScore >= 80) return 3;
    if (loScore >= 50) return 2;
    return 1;
  };

  const getChipStyle = (loScore: number) => {
    if (loScore >= 80)
      return {
        border: "#c7e7cf",
        bg: "#f1faf3",
        icon: "⛰️",
        iconClass: "text-[#2aae4a]",
      };
    if (loScore >= 50)
      return {
        border: "#f0dcb0",
        bg: "#fff7e6",
        icon: "🧗",
        iconClass: "text-[#b8860b]",
      };
    return {
      border: "#f3cbc6",
      bg: "#fdf0ee",
      icon: "🐣",
      iconClass: "text-[#e25a44]",
    };
  };

  const getChipFeedback = (lo: {
    learningObjective: string;
    score: number;
  }) => {
    const generated = narrative?.learningObjectiveFeedback.find(
      (item) => item.learningObjective === lo.learningObjective,
    )?.feedback;
    if (generated) return generated;

    const label = formatLearningObjectiveLabel(lo.learningObjective);
    if (lo.score >= 80)
      return `Sharp! You've mastered "${label}" with confidence.`;
    if (lo.score >= 50)
      return `Good progress on "${label}"! A bit more practice and you'll nail it.`;
    return `Let's revisit "${label}" — review the fundamentals and try again soon.`;
  };

  const strongLOs = sortedLOs.filter((lo) => lo.score >= 80);
  const weakLOs = sortedLOs.filter((lo) => lo.score < 50);

  const speechMessage = (() => {
    if (strongLOs.length >= 2 && weakLOs.length === 0)
      return `You're crushing everything! Keep up this incredible streak — you're ready for the next level.`;
    if (strongLOs.length > 0 && weakLOs.length > 0)
      return `You nailed ${formatLearningObjectiveLabel(strongLOs[0]?.learningObjective)}! Let's work on ${formatLearningObjectiveLabel(weakLOs[weakLOs.length - 1]?.learningObjective)} next.`;
    if (weakLOs.length > 0)
      return `Every expert started here! Focus on ${formatLearningObjectiveLabel(weakLOs[weakLOs.length - 1]?.learningObjective)} first — you've got this!`;
    return `You're making great progress! Keep practising to reach the top.`;
  })();

  const parentNotes = narrative?.parentNotes ?? [
    `${firstName} completed the "${report.topic}" diagnostic today.`,
    `They got ${correctCount} out of ${totalQuestions} questions right.`,
    strongLOs.length > 0
      ? `Strong areas: ${strongLOs
          .slice(0, 2)
          .map((lo) => formatLearningObjectiveLabel(lo.learningObjective))
          .join(", ")}.`
      : "Building foundations across all areas.",
    weakLOs.length > 0
      ? `Needs more practice on: ${weakLOs
          .slice(-2)
          .map((lo) => formatLearningObjectiveLabel(lo.learningObjective))
          .join(", ")}.`
      : "Performing well across all objectives.",
    weakLOs.length > 0
      ? `Suggested next step: spend 10 minutes practising ${formatLearningObjectiveLabel(weakLOs[weakLOs.length - 1]?.learningObjective)} this week.`
      : `Suggested next step: try a harder topic or take the grade test.`,
  ];

  return (
    <div className="mx-auto max-w-[580px]">
      {/* Context bar */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-1 px-1 text-[11px] text-[#888]">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[#555] truncate max-w-[180px] sm:max-w-none">
            {report.mode === "recurring" ? "Recurring Test" : report.topic} ·{" "}
            {classLabel(report.classLevel ?? "class6")}
          </span>
          <span className="rounded-full bg-[#F5A623] px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-white shrink-0">
            {report.mode === "recurring" ? "Remediation" : "Diagnostic"}
          </span>
          {report.mode === "recurring" && (
            <span className="rounded-full bg-[#2EC4B6] px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-white shrink-0">
              Recurring Test Result
            </span>
          )}
        </div>
        <span>{firstName} · Today</span>
      </div>

      {/* Report card */}
      <div className="overflow-hidden rounded-[22px] bg-white shadow-[0_10px_32px_rgba(60,60,80,0.08),0_2px_8px_rgba(60,60,80,0.04)]">
        {/* Mascot hero */}
        <div className="flex items-center gap-3 bg-[linear-gradient(135deg,#fff4e0,#ffe8d2)] px-4 py-4 sm:gap-4 sm:px-6 sm:py-5">
          <div className="relative flex h-[68px] w-[68px] shrink-0 items-center justify-center rounded-full bg-[linear-gradient(145deg,#ffd166,#ffb347)] shadow-[0_4px_12px_rgba(255,160,60,0.35)] sm:h-[82px] sm:w-[82px]">
            <span className="text-[36px] leading-none sm:text-[44px]">
              {mascot.face}
            </span>
            <span className="absolute -right-1 -top-1 flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 border-white bg-[#2aae4a] text-[12px] shadow-sm sm:h-[26px] sm:w-[26px] sm:text-[14px]">
              {mascot.badge}
            </span>
          </div>
          <div className="relative flex-1 min-w-0 rounded-[14px] bg-white px-3 py-3 shadow-sm before:absolute before:-left-[8px] before:top-[20px] before:border-b-[8px] before:border-r-[10px] before:border-t-[8px] before:border-b-transparent before:border-r-white before:border-t-transparent sm:px-4">
            <div className="text-[14px] font-bold text-[#1a1a1a] sm:text-[15px]">
              {roundedScore >= 80
                ? `Outstanding, ${firstName}! 🎉`
                : roundedScore >= 60
                  ? `Nice climb, ${firstName}! 🧗`
                  : roundedScore >= 40
                    ? `Good effort, ${firstName}! 💪`
                    : `Keep going, ${firstName}! 🌱`}
            </div>
            <div className="mt-0.5 text-[12px] leading-relaxed text-[#444] sm:text-[13px]">
              {speechMessage}
            </div>
          </div>
        </div>

        {/* Score strip */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-t border-[#efece5] bg-[#fafaf7] px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span
              className="text-[15px] font-bold"
              style={{ color: mascot.tierColor }}
            >
              {mascot.tier}
            </span>
            <StarRating
              filled={Math.min(
                3,
                Math.max(1, Math.round(roundedScore / 33.4 + 0.5)),
              )}
              total={3}
              size={15}
            />
          </div>
          <div className="flex items-center gap-1">
            {Array.from({ length: 5 }, (_, i) => (
              <div
                key={i}
                className="h-[5px] w-[22px] rounded-[3px]"
                style={{
                  background: i < mastery.filled ? "#2aae4a" : "#e5e2d9",
                  boxShadow:
                    i === mastery.filled - 1
                      ? "0 0 0 2px rgba(42,174,74,0.25)"
                      : undefined,
                }}
              />
            ))}
            <span className="ml-2 font-mono text-[10px] font-semibold text-[#888]">
              {mastery.label}
            </span>
          </div>
        </div>

        {/* Question heatmap */}
        {results.length > 0 && (
          <div className="border-b border-[#efece5] px-5 py-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-[#666]">
                Question heatmap
              </div>
              <div className="font-mono text-[10px] font-semibold text-[#888]">
                Green = correct, red = needs review
              </div>
            </div>
            <div className="grid grid-cols-6 gap-2 sm:grid-cols-9">
              {results.map((record, index) => {
                const isCorrect = record.verdict === "correct";
                return (
                  <button
                    key={record.question.id}
                    type="button"
                    onClick={() =>
                      !isCorrect && setSelectedReviewId(record.question.id)
                    }
                    className={`flex h-9 items-center justify-center rounded-[9px] border font-mono text-[12px] font-bold transition-all ${
                      isCorrect
                        ? "border-[#bfe7c8] bg-[#edf9f0] text-[#1f8a3b]"
                        : "border-[#f2b8ae] bg-[#fff0ee] text-[#c0392b] hover:bg-[#ffe4e0]"
                    }`}
                  >
                    {index + 1}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* LO chips */}
        <div className="px-5 py-5">
          <div className="mb-3 font-mono text-[11px] font-bold uppercase tracking-wider text-[#666]">
            Your climb, topic by topic
          </div>
          <div className="flex flex-col gap-2.5">
            {sortedLOs.map((lo) => {
              const chip = getChipStyle(lo.score);
              const stars = getStars(lo.score);
              const label = formatLearningObjectiveLabel(lo.learningObjective);
              return (
                <div
                  key={lo.learningObjective}
                  className="rounded-[12px] border p-3"
                  style={{ background: chip.bg, borderColor: chip.border }}
                >
                  <div className="mb-1 flex items-center gap-2.5">
                    <span className="w-[22px] shrink-0 text-center text-[16px] leading-none">
                      {chip.icon}
                    </span>
                    <span className="flex-1 text-[13px] font-bold text-[#111]">
                      {label}
                    </span>
                    <StarRating filled={stars} total={3} size={14} />
                  </div>
                  <div className="pl-[30px] text-[12px] leading-relaxed text-[#444]">
                    {getChipFeedback(lo)}
                  </div>
                  <div className="mt-2 pl-[30px]">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#e5e2d9]">
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{
                            width: `${lo.score}%`,
                            background:
                              lo.score >= 80
                                ? "#2aae4a"
                                : lo.score >= 50
                                  ? "#f59e0b"
                                  : "#ef4444",
                          }}
                        />
                      </div>
                      <span className="font-mono text-[10px] font-bold text-[#888]">
                        {Math.round(lo.score)}%
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Missed question review */}
        {selectedReview && (
          <div className="border-t border-[#efece5] bg-[#fffaf4] px-5 py-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#9a6308]">
                  Review a missed question
                </div>
                <div className="mt-1 text-[14px] font-bold text-[#1a1a1a]">
                  Question{" "}
                  {results.findIndex(
                    (record) =>
                      record.question.id === selectedReview.question.id,
                  ) + 1}
                </div>
              </div>
              <div className="flex gap-1.5">
                {wrongRecords.slice(0, 6).map((record) => (
                  <button
                    key={record.question.id}
                    type="button"
                    onClick={() => setSelectedReviewId(record.question.id)}
                    className={`h-7 w-7 rounded-[7px] font-mono text-[11px] font-bold ${
                      selectedReview.question.id === record.question.id
                        ? "bg-[#c0392b] text-white"
                        : "bg-white text-[#c0392b] ring-1 ring-[#f2b8ae]"
                    }`}
                  >
                    {results.findIndex(
                      (item) => item.question.id === record.question.id,
                    ) + 1}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-[12px] border border-[#f0dcb0] bg-white p-4">
              <div className="mb-2 text-[13px] font-bold leading-relaxed text-[#1a1a1a]">
                {selectedReview.question.question}
              </div>
              {getQuestionSvg(
                selectedReview.question as QuestionDisplayData,
              ) && (
                <div
                  className="mb-3 flex min-h-[120px] items-center justify-center rounded-[12px] border border-[#E8E3D8] bg-[#FAFAF7] p-4 [&_svg]:h-auto [&_svg]:max-h-[180px] [&_svg]:w-full [&_svg]:max-w-[460px]"
                  dangerouslySetInnerHTML={{
                    __html:
                      getQuestionSvg(
                        selectedReview.question as QuestionDisplayData,
                      ) ?? "",
                  }}
                />
              )}
              <div className="grid gap-2 text-[12px] leading-relaxed text-[#4B5563] sm:grid-cols-2">
                <div>
                  <span className="font-bold text-[#c0392b]">Your answer:</span>{" "}
                  {formatAnswerSummary(
                    selectedReview.question as QuestionDisplayData,
                    selectedReview.studentAnswer,
                  )}
                </div>
                <div>
                  <span className="font-bold text-[#1f8a3b]">
                    Correct answer:
                  </span>{" "}
                  {getCorrectAnswerSummary(
                    selectedReview.question as QuestionDisplayData,
                  )}
                </div>
              </div>
              <div className="mt-3 rounded-[10px] bg-[#f6f8fb] p-3 text-[12px] font-medium leading-relaxed text-[#3a4a64]">
                {narrative?.questionReviewNotes.find(
                  (item) => item.questionId === selectedReview.question.id,
                )?.note ?? getQuestionExplanation(selectedReview)}
              </div>
            </div>
          </div>
        )}

        <div className="border-t border-[#efece5] bg-[#FAFAF7] px-5 py-4">
          <div className="mb-2 font-mono text-[10px] font-bold uppercase tracking-wider text-[#666]">
            Quick feedback
          </div>
          <div className="grid gap-2 text-[12px] leading-relaxed text-[#444] sm:grid-cols-3">
            <div>
              <span className="font-bold text-[#1a1a1a]">Accuracy:</span>{" "}
              {correctCount}/{totalQuestions} correct
            </div>
            <div>
              <span className="font-bold text-[#1a1a1a]">Partial:</span>{" "}
              {partialCount} questions
            </div>
            <div>
              <span className="font-bold text-[#1a1a1a]">Review:</span>{" "}
              {wrongRecords.length} questions need attention
            </div>
          </div>
        </div>

        {/* Parent strip */}
        <div className="border-t border-[#e8ecf2] bg-[#f6f8fb] px-5 py-4">
          <div className="mb-2 flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-[#5a6b85]">
            👨‍👩‍👧 For Parents
          </div>
          {parentNotes.map((note, i) => (
            <div
              key={i}
              className="mb-1 flex items-start gap-2 text-[12px] leading-relaxed text-[#3a4a64]"
            >
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[#5a6b85]" />
              <span>{note}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-8 flex flex-col items-center gap-4">
        {roundedScore < 60 && (
          <div className="w-full max-w-[480px] rounded-[22px] bg-[#FFF8E7] p-5 border border-[#F5A623]/20 shadow-sm">
            {weakLOs.length > 0 && (
              <div className="mb-4 text-center">
                <div className="mb-3 font-mono text-[10px] font-bold uppercase tracking-widest text-[#D48600]">
                  Focus Areas for Practice
                </div>
                <div className="flex flex-wrap justify-center gap-1.5">
                  {weakLOs.slice(0, 6).map((lo) => (
                    <span
                      key={lo.learningObjective}
                      className="rounded-full bg-white px-3 py-1 text-[11px] font-bold text-[#1B4A4A] shadow-sm ring-1 ring-[#F5A623]/10"
                    >
                      {formatLearningObjectiveLabel(lo.learningObjective)}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="flex justify-center">
              <button
                onClick={() => {
                  const assessmentId =
                    (report as any).id || (report as any).assessmentId;
                  if (assessmentId) onRecurring(assessmentId);
                }}
                disabled={isBusy}
                className="z-999 flex items-center justify-center gap-2 rounded-full border-2 border-[#F5A623] px-6 py-2.5 text-[13px] font-bold text-[#F5A623] transition-all hover:bg-[#F5A623]/5 hover:-translate-y-0.5 disabled:opacity-50"
              >
                {isBusy ? "Preparing..." : "🔁 Start Recurring Test"}
              </button>
            </div>
          </div>
        )}
        <div className="mt-8 flex flex-col items-center gap-4">
          {/* Removed Take Another Test button from here */}
        </div>
      </div>
    </div>
  );
}

// ─── Report V1 (existing analytics view) ──────────────────────────────────────
function ReportView({
  report,
  onReset,
  onRecurring,
  isBusy = false,
}: {
  report: DiagnosticReport;
  onReset: () => void;
  onRecurring: (assessmentId: string) => void;
  isBusy?: boolean;
}) {
  const [showMethodology, setShowMethodology] = useState(false);
  const [selectedReviewQuestionId, setSelectedReviewQuestionId] = useState<
    string | null
  >(null);
  const [countScore, setCountScore] = useState(0);
  const [countPct, setCountPct] = useState(0);
  const [rocketBottom, setRocketBottom] = useState(0);
  const [showParticles, setShowParticles] = useState(false);

  const score = report.overallReadinessScore ?? report.readinessScore ?? 0;
  const roundedScore = Math.round(score);
  const studentName = getStudentDisplayName(report.studentId);
  const firstName = studentName.split(" ")[0];
  const results = report.results ?? [];
  const learningObjectives = report.learningObjectiveResults ?? [];
  const narrative = report.resultNarrative;

  const totalQuestions = results.length || report.totalQuestionsShown || 0;
  const correctCount = results.filter((r) => r.verdict === "correct").length;
  const selectedReportTopics =
    report.mode === "multi_topic"
      ? Array.from(
          new Set(
            results
              .map((record) => record.question.topic)
              .filter((topic): topic is string => Boolean(topic)),
          ),
        ).map((topic) => {
          const topicResults = results.filter(
            (record) => record.question.topic === topic,
          );
          return {
            topic,
            questionCount: topicResults.length,
            correctCount: topicResults.filter(
              (record) => record.verdict === "correct",
            ).length,
          };
        })
      : [];
  const rapidCount = results.filter(
    (r) =>
      (r.timeTakenMs ?? 0) > 0 &&
      (r.timeTakenMs ?? 0) < RAPID_RESPONSE_THRESHOLD_MS,
  ).length;
  const totalTimeTakenMs = results.reduce(
    (sum, r) => sum + (r.timeTakenMs ?? 0),
    0,
  );
  const avgTimeTakenMs =
    totalQuestions > 0 ? totalTimeTakenMs / totalQuestions : 0;
  const totalBasePoints = results.reduce(
    (sum, r) => sum + getQuestionBasePoints(r.question.difficultyLevel),
    0,
  );
  const totalFinalPoints = results.reduce((sum, r) => {
    const base = getQuestionBasePoints(r.question.difficultyLevel);
    if (r.verdict === "correct") return sum + base;
    if (r.verdict === "partial") return sum + base * 0.5;
    return sum;
  }, 0);
  const selectedReviewRecord =
    results.find((record) => record.question.id === selectedReviewQuestionId) ??
    results[0] ??
    null;
  const selectedReviewIndex = selectedReviewRecord
    ? results.findIndex(
        (record) => record.question.id === selectedReviewRecord.question.id,
      )
    : -1;
  const selectedReviewQuestionSvg = getQuestionSvg(
    selectedReviewRecord?.question as QuestionDisplayData | undefined,
  );
  const questionReviewNotes = new Map(
    (narrative?.questionReviewNotes ?? []).map((item) => [
      item.questionId,
      item.note,
    ]),
  );

  useEffect(() => {
    setSelectedReviewQuestionId(results[0]?.question.id ?? null);
  }, [results]);

  useEffect(() => {
    setShowParticles(true);
    const timer = setTimeout(() => {
      const targetScore = Math.round(totalFinalPoints);
      const targetPct = roundedScore;
      const duration = 1400;
      const startTime = performance.now();
      const animate = (now: number) => {
        const progress = Math.min((now - startTime) / duration, 1);
        const eased = 1 - (1 - progress) ** 3;
        setCountScore(Math.round(eased * targetScore));
        setCountPct(Math.round(eased * targetPct));
        setRocketBottom(eased * targetPct);
        if (progress < 1) requestAnimationFrame(animate);
      };
      requestAnimationFrame(animate);
    }, 500);
    return () => clearTimeout(timer);
  }, [totalFinalPoints, roundedScore]);

  const getHeroContent = (pct: number) => {
    if (pct >= 90)
      return {
        emoji: "🏆",
        greeting: `Outstanding work, ${firstName}!`,
        subtitle:
          "You've absolutely crushed this diagnostic — your understanding is rock-solid!",
        altitude: "🌌 Stratosphere reached!",
      };
    if (pct >= 70)
      return {
        emoji: "🌟",
        greeting: `Great job, ${firstName}!`,
        subtitle:
          "You've got a strong grip on most concepts. A little more focus on the tricky ones and you'll be unstoppable!",
        altitude: "☁️ Cruising through the clouds",
      };
    if (pct >= 50)
      return {
        emoji: "💪",
        greeting: `Nice effort, ${firstName}!`,
        subtitle:
          "You're building a solid foundation. Let's work on the areas where you stumbled — you're closer than you think!",
        altitude: "🛫 Gaining altitude",
      };
    return {
      emoji: "🧪",
      greeting: `Keep going, ${firstName}!`,
      subtitle:
        "Every scientist starts somewhere. Review the concepts below and give it another shot — you've got this!",
      altitude: "🔧 Pre-flight check — preparing for takeoff",
    };
  };

  const hero = {
    ...getHeroContent(roundedScore),
  };
  const resultCopy = buildSimpleResultCopy({
    firstName,
    report,
    results,
    roundedScore,
  });
  const starCount = Math.min(5, Math.max(1, Math.ceil(roundedScore / 20)));
  const accentColor =
    roundedScore >= 70 ? "#22C55E" : roundedScore >= 50 ? "#F5A623" : "#f46853";
  const pctColor = accentColor;
  const pctBg =
    roundedScore >= 70
      ? "rgba(34,197,94,0.1)"
      : roundedScore >= 50
        ? "rgba(245,166,35,0.10)"
        : "rgba(244,104,83,0.08)";
  const sortedLearningObjectives = [...learningObjectives].sort(
    (left, right) => right.score - left.score,
  );
  const placementBand =
    report.placementPlanInsights?.bandName ??
    (roundedScore >= 80
      ? "Grade-Ahead"
      : roundedScore >= 55
        ? "Confident Solver"
        : roundedScore >= 35
          ? "Foundation Builder"
          : "Early Start");
  const placementNextBand =
    report.placementPlanInsights?.nextBandName ??
    (roundedScore >= 80
      ? "Advanced stretch"
      : roundedScore >= 55
        ? "Grade-Ahead"
        : roundedScore >= 35
          ? "Confident Solver"
          : "Foundation Builder");
  const placementPercentile = Math.max(
    5,
    Math.min(96, Math.round(8 + roundedScore * 0.9 - (rapidCount > 3 ? 4 : 0))),
  );
  const placementMarkerX = Math.max(16, Math.min(384, roundedScore * 4));
  const placementMarkerPct = Math.max(4, Math.min(96, roundedScore));
  const placementSummary =
    report.placementPlanInsights?.placementSummary ??
    `${studentName} is in ${placementBand} with ${roundedScore}% accuracy, ${correctCount}/${totalQuestions} correct, and ${formatCompactDuration(totalTimeTakenMs)} total time.`;
  const placementTopicCount = new Set(
    results.map((record) => record.question.topic).filter(Boolean),
  ).size;
  const weakTopicCount = new Set(
    results
      .filter((record) => record.verdict !== "correct")
      .map((record) => record.question.topic)
      .filter(Boolean),
  ).size;
  const peerDotSeeds = Array.from({ length: 28 }, (_, index) => index + 1);

  return (
    <div className="font-sans text-[#1a1a1a] pb-20 max-w-7xl mx-auto flex flex-col gap-[18px]">
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @keyframes cardUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes bounceIn { 0% { transform: scale(0) rotate(-10deg); } 50% { transform: scale(1.25) rotate(5deg); } 100% { transform: scale(1) rotate(0deg); } }
        @keyframes starTwinkle { 0% { opacity: 0; transform: scale(0); } 50% { opacity: 1; transform: scale(1.3); } 100% { opacity: 0.6; transform: scale(1); } }
        @keyframes floatUp { 0% { transform: translateY(100vh) scale(0); opacity: 0; } 10% { opacity: 0.35; } 90% { opacity: 0.35; } 100% { transform: translateY(-10vh) scale(1); opacity: 0; } }
        .v1-card { background: white; border: 1px solid rgba(0,0,0,0.08); border-radius: 18px; box-shadow: 0 2px 20px rgba(26,26,46,0.05); overflow: hidden; animation: cardUp 0.5s cubic-bezier(0.22,1,0.36,1) both; }
        .v1-result-hero { padding: 44px 36px 40px; text-align: center; position: relative; overflow: hidden; background: white; border: 1px solid rgba(0,0,0,0.08); border-radius: 18px; box-shadow: 0 2px 20px rgba(26,26,46,0.05); animation: cardUp 0.5s cubic-bezier(0.22,1,0.36,1) both; }
        .v1-result-hero::before { content: ''; position: absolute; inset: 0; background: radial-gradient(circle at 50% 0%, rgba(245,166,35,0.05), transparent 70%); }
        .v1-result-emoji { font-size: 3.6rem; margin-bottom: 8px; display: block; animation: bounceIn 0.6s 0.2s both; }
        .v1-rocket-launchpad { position: relative; width: 120px; height: 240px; flex-shrink: 0; }
        .v1-rocket-track { position: absolute; left: 50%; top: 20px; bottom: 20px; width: 3px; margin-left: -1.5px; background: #f0eee9; border-radius: 3px; }
        .v1-rocket-track-fill { position: absolute; bottom: 0; left: 0; width: 100%; border-radius: 3px; transition: height 1.8s cubic-bezier(0.22,1,0.36,1); }
        .v1-rocket-marker { position: absolute; left: -16px; width: 35px; height: 1px; background: rgba(0,0,0,0.06); }
        .v1-rocket-marker-label { position: absolute; left: -38px; top: -7px; font-family: 'Courier New',monospace; font-size: 0.55rem; color: #9a9ab0; font-weight: 700; }
        .v1-rocket-ship { position: absolute; left: 50%; bottom: 0; transform: translateX(-50%) translateY(10px); transition: bottom 1.8s cubic-bezier(0.22,1,0.36,1); z-index: 3; filter: drop-shadow(0 4px 12px rgba(0,0,0,0.12)); }
        .v1-kpi-strip { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
        .v1-kpi { background: white; border: 1px solid rgba(0,0,0,0.08); border-radius: 18px; padding: 18px 20px; box-shadow: 0 2px 20px rgba(26,26,46,0.05); animation: cardUp 0.5s cubic-bezier(0.22,1,0.36,1) both; transition: transform 0.2s; }
        .v1-kpi:hover { transform: translateY(-3px); }
        .v1-kpi-val { font-weight: 800; font-size: 1.7rem; letter-spacing: -0.02em; line-height: 1; }
        .v1-lo-grid { display: flex; flex-direction: column; gap: 0; }
        .v1-lo-card { background: transparent; border-bottom: 1px solid rgba(0,0,0,0.07); padding: 12px 0; animation: cardUp 0.5s both; }
        .v1-lo-card:last-child { border-bottom: none; }
        .v1-lo-card:hover { background: rgba(0,0,0,0.015); border-radius: 8px; }
        .v1-student-table { width: 100%; border-collapse: separate; border-spacing: 0 5px; font-size: 0.88rem; }
        .v1-student-table th { text-align: left; font-size: 0.72rem; font-weight: 700; color: #9a9ab0; text-transform: uppercase; letter-spacing: 0.06em; padding: 8px 12px; }
        .v1-student-table td { padding: 11px 12px; background: #F8F9FA; border: none; vertical-align: middle; }
        .v1-student-table tr td:first-child { border-radius: 10px 0 0 10px; }
        .v1-student-table tr td:last-child { border-radius: 0 10px 10px 0; }
        .v1-student-table tbody tr:hover td { background: rgba(245,166,35,0.04); }
        .v1-diff-badge { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; padding: 4px 12px; border-radius: 14px; white-space: nowrap; }
        .v1-diff-badge.easy { background: rgba(46,204,135,0.1); color: #2ecc87; }
        .v1-diff-badge.medium { background: rgba(245,158,11,0.12); color: #b8860b; }
        .v1-diff-badge.hard { background: rgba(244,104,83,0.08); color: #f46853; }
        .v1-lo-status-badge { font-size: 0.68rem; padding: 3px 10px; border-radius: 20px; font-weight: 700; white-space: nowrap; }
        .v1-lo-status-badge.mastered { background: rgba(46,204,135,0.1); color: #2ecc87; }
        .v1-lo-status-badge.developing { background: rgba(245,158,11,0.12); color: #b8860b; }
        .v1-lo-status-badge.needs-work { background: rgba(244,104,83,0.08); color: #f46853; }
        .v1-particle { position: absolute; border-radius: 50%; animation: floatUp linear infinite; opacity: 0; pointer-events: none; }
        @media(max-width: 900px) { .v1-kpi-strip { grid-template-columns: repeat(2, 1fr); } }
        @media(max-width: 480px) { .v1-kpi-strip { grid-template-columns: repeat(2, 1fr); } }
        @media(max-width: 380px) { .v1-kpi-strip { grid-template-columns: 1fr; } .v1-kpi { display: flex; align-items: center; gap: 12px; padding: 14px 16px; } .v1-kpi > :first-child { margin-bottom: 0; flex-shrink: 0; } .v1-kpi-val { font-size: 1.3rem; } }
        @media(max-width: 640px) { .v1-result-hero { padding: 28px 18px 24px; } .hero-title { font-size: 1.2rem !important; } .hero-subtitle { font-size: 0.95rem !important; } }
      `,
        }}
      />

      {showParticles && (
        <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="v1-particle"
              style={{
                width: `${seededRange(i + 1, 2, 6)}px`,
                height: `${seededRange(i + 17, 2, 6)}px`,
                left: `${seededRange(i + 31, 0, 100)}%`,
                background: [
                  "#F5A623",
                  "#f46853",
                  "#2EC4B6",
                  "#ffc53d",
                  "#22C55E",
                ][Math.floor(seededRange(i + 47, 0, 5))],
                animationDuration: `${seededRange(i + 61, 12, 26)}s`,
                animationDelay: `${seededRange(i + 79, 0, 10)}s`,
              }}
            />
          ))}
        </div>
      )}

      {report.mode === "placement" ? (
        <section className="v1-card">
          <div className="grid min-h-[280px] lg:grid-cols-[1.1fr_1fr]">
            <div className="bg-[linear-gradient(135deg,#fff,#f3f7ff)] p-7 sm:p-8">
              <div className="mb-2 font-mono text-[0.65rem] font-extrabold uppercase tracking-[0.18em] text-[#3A5CCC]">
                Placement complete
              </div>
              <div className="mb-2 text-[1.8rem] font-extrabold leading-tight tracking-tight text-[#0F1226]">
                Hi {firstName} - here is your spot.
              </div>
              <div className="mb-5 max-w-[420px] text-[0.92rem] font-medium leading-relaxed text-[#525978]">
                You sit in the <b>{placementBand}</b> band for{" "}
                {classLabel(report.classLevel)}. The plan below shows which
                skills should move first.
              </div>

              <div className="mb-4 flex items-end gap-5">
                <div className="text-[4.2rem] font-black leading-none tracking-tight text-[#3A5CCC]">
                  {roundedScore}
                </div>
                <div className="pb-1">
                  <div className="font-mono text-[0.85rem] font-bold text-[#9AA0B5]">
                    / 100
                  </div>
                  <div className="mt-2">
                    <StarRating filled={starCount} size={18} />
                  </div>
                </div>
              </div>

              <div className="inline-flex items-center gap-2 rounded-full border border-[#3A5CCC]/15 bg-[#3A5CCC]/[0.08] px-3 py-1.5 text-[0.78rem] font-bold text-[#3A5CCC]">
                {placementBand} - {classLabel(report.classLevel)}
              </div>
              <div className="ml-2 mt-2 inline-flex items-center gap-2 rounded-full border border-[#7C5CFC]/15 bg-[#7C5CFC]/[0.08] px-3 py-1.5 text-[0.74rem] font-bold text-[#4338CA]">
                Next: {placementNextBand}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {[
                  `Student: ${studentName}`,
                  `${correctCount}/${totalQuestions} correct`,
                  `${formatCompactDuration(totalTimeTakenMs)} total`,
                ].map((pill) => (
                  <span
                    key={pill}
                    className="rounded-full border border-[#E6EAF2] bg-white px-3 py-1 text-[0.74rem] font-semibold text-[#525978]"
                  >
                    {pill}
                  </span>
                ))}
              </div>
            </div>

            <div className="relative overflow-hidden bg-[linear-gradient(135deg,#0F1226,#1C1F3D)] p-7 text-white sm:p-8">
              <div className="font-mono text-[0.62rem] font-extrabold uppercase tracking-[0.18em] text-white/50">
                Placed among grade peers
              </div>
              <div className="mt-1 text-[1.05rem] font-extrabold">
                You are around P{placementPercentile} on this placement run
              </div>
              <div className="mt-3 max-w-[580px] text-[0.82rem] font-semibold leading-relaxed text-white/65">
                {placementSummary}
              </div>
              <div className="relative mt-5 h-[165px]">
                <div
                  className="absolute -top-1 z-20 -translate-x-1/2 rounded-md bg-[#F46853] px-2.5 py-1 font-mono text-[0.62rem] font-extrabold uppercase tracking-wider"
                  style={{
                    left: `${placementMarkerPct}%`,
                  }}
                >
                  You - {roundedScore}
                </div>
                <svg
                  className="h-full w-full"
                  viewBox="0 0 400 140"
                  preserveAspectRatio="none"
                  aria-label="Placement curve"
                >
                  <defs>
                    <linearGradient
                      id="placementHeroBell"
                      x1="0"
                      x2="0"
                      y1="0"
                      y2="1"
                    >
                      <stop offset="0%" stopColor="rgba(124,92,252,0.5)" />
                      <stop offset="100%" stopColor="rgba(124,92,252,0)" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M 0 130 C 80 130, 120 120, 160 60 C 180 20, 220 20, 240 60 C 280 120, 320 130, 400 130 L 400 140 L 0 140 Z"
                    fill="url(#placementHeroBell)"
                  />
                  <path
                    d="M 0 130 C 80 130, 120 120, 160 60 C 180 20, 220 20, 240 60 C 280 120, 320 130, 400 130"
                    fill="none"
                    stroke="rgba(255,255,255,0.4)"
                    strokeWidth="1.5"
                  />
                  {[35, 55, 80].map((mark) => (
                    <line
                      key={mark}
                      x1={mark * 4}
                      y1="104"
                      x2={mark * 4}
                      y2="134"
                      stroke="rgba(255,255,255,0.22)"
                      strokeDasharray="3 4"
                    />
                  ))}
                  <line
                    x1={placementMarkerX}
                    y1="50"
                    x2={placementMarkerX}
                    y2="130"
                    stroke="#F46853"
                    strokeWidth="2"
                  />
                  <circle
                    cx={placementMarkerX}
                    cy="50"
                    r="6"
                    fill="#F46853"
                    stroke="#fff"
                    strokeWidth="2"
                  />
                </svg>
                <div className="mt-1 flex justify-between font-mono text-[0.62rem] font-bold text-white/45">
                  <span>0</span>
                  <span>25</span>
                  <span>50</span>
                  <span>75</span>
                  <span>100</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <div className="v1-result-hero">
          <div className="hero-title font-extrabold text-[1.5rem] mb-1">
            {hero.greeting}
          </div>
          <div className="hero-subtitle text-[1.05rem] font-semibold text-[#5a5a72] mb-6 max-w-[600px] mx-auto leading-relaxed">
            {report.mode === "recurring" ? (
              <span className="flex items-center justify-center gap-2">
                <span className="rounded-full bg-[#2EC4B6]/10 px-3 py-1 text-[12px] font-bold uppercase tracking-widest text-[#2EC4B6] ring-1 ring-[#2EC4B6]/20">
                  Recurring Test Result
                </span>
              </span>
            ) : (
              hero.subtitle
            )}
          </div>

          <div className="flex flex-col items-center justify-center p-8 sm:p-12 mb-6">
            {/* Left Column: Rocket + Score */}
            <div className="flex items-center justify-center gap-6 sm:gap-11 w-full">
              <div className="v1-rocket-launchpad">
                <div className="v1-rocket-track">
                  {[25, 50, 75, 100].map((m) => (
                    <div
                      key={m}
                      className="v1-rocket-marker"
                      style={{ bottom: `${m}%` }}
                    >
                      <span className="v1-rocket-marker-label">
                        {m}
                        {m === 100 ? "" : "%"}
                      </span>
                    </div>
                  ))}
                  <div
                    className="v1-rocket-track-fill"
                    style={{
                      height: `${rocketBottom}%`,
                      background: `linear-gradient(to top, ${accentColor}, ${accentColor}44)`,
                    }}
                  />
                </div>
                <svg
                  className="v1-rocket-ship"
                  style={{ bottom: `${(rocketBottom / 100) * 200}px` }}
                  width="40"
                  height="56"
                  viewBox="0 0 40 56"
                >
                  <defs>
                    <linearGradient id="bodyGradV1" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#e8e4dc" />
                      <stop offset="100%" stopColor="#d4d0c8" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M8,40 L4,52 L14,44 Z"
                    fill={accentColor}
                    opacity=".8"
                  />
                  <path
                    d="M32,40 L36,52 L26,44 Z"
                    fill={accentColor}
                    opacity=".8"
                  />
                  <rect
                    x="12"
                    y="14"
                    width="16"
                    height="32"
                    rx="3"
                    fill="url(#bodyGradV1)"
                    stroke="#c4bfb4"
                    strokeWidth="1"
                  />
                  <path
                    d="M12,14 Q12,2 20,0 Q28,2 28,14 Z"
                    fill={accentColor}
                  />
                  <circle
                    cx="20"
                    cy="24"
                    r="4.5"
                    fill="#F5A623"
                    stroke="#E0941A"
                    strokeWidth="1"
                  />
                  <circle
                    cx="18.5"
                    cy="22.5"
                    r="1.2"
                    fill="rgba(255,255,255,0.5)"
                  />
                </svg>
                <div className="absolute inset-0 pointer-events-none overflow-hidden">
                  {Array.from({
                    length: Math.max(3, Math.floor(roundedScore / 10)),
                  }).map((_, i) => (
                    <div
                      key={i}
                      className="absolute rounded-full bg-[#ffc53d] opacity-0"
                      style={{
                        width: `${seededRange(i + 101, 2, 5)}px`,
                        height: `${seededRange(i + 127, 2, 5)}px`,
                        left: `${seededRange(i + 149, 0, 100)}%`,
                        top: `${seededRange(i + 173, 0, 70)}%`,
                        animation: `starTwinkle 1.5s ease both ${seededRange(i + 197, 0.6, 1.8)}s`,
                      }}
                    />
                  ))}
                </div>
              </div>
              <div className="text-left">
                <div
                  className="font-extrabold text-[4.5rem] leading-none tracking-tighter"
                  style={{ color: accentColor }}
                >
                  {countPct}
                </div>
                <div className="font-mono text-[1.2rem] text-[#9a9ab0] font-bold mt-1">
                  / 100
                </div>
                <div className="mt-3">
                  <StarRating filled={starCount} size={24} />
                </div>
                <div className="text-[0.75rem] text-[#9a9ab0] font-semibold mt-3">
                  {hero.altitude}
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-center gap-3 flex-wrap">
            {[
              `👤 ${studentName}`,
              `✅ ${correctCount}/${totalQuestions} Correct`,
              `⏱ ${formatCompactDuration(totalTimeTakenMs)} Total`,
              `📝 ${report.topic}`,
            ].map((pill) => (
              <span
                key={pill}
                className="text-[0.78rem] text-[#6B7280] font-semibold flex items-center gap-1.5 bg-[#F8F9FA] border border-gray-100 px-3.5 py-1.5 rounded-full"
              >
                {pill}
              </span>
            ))}
          </div>
        </div>
      )}

      {selectedReportTopics.length > 0 && (
        <section className="v1-card p-5 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-mono text-[0.65rem] font-extrabold uppercase tracking-[0.16em] text-[#7C5CFC]">
                Multi-topic test
              </div>
              <h2 className="mt-1 text-[1.05rem] font-extrabold text-[#1B4A4A]">
                Selected topics
              </h2>
            </div>
            <span className="rounded-full bg-[#F0ECFF] px-3 py-1 font-mono text-[0.68rem] font-bold text-[#6547D8]">
              {selectedReportTopics.length} topic
              {selectedReportTopics.length === 1 ? "" : "s"}
            </span>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {selectedReportTopics.map((item) => (
              <div
                key={item.topic}
                className="rounded-[13px] border border-[#7C5CFC]/15 bg-[#FAF8FF] px-4 py-3"
              >
                <div className="text-[0.84rem] font-extrabold leading-snug text-[#1B4A4A]">
                  {item.topic}
                </div>
                <div className="mt-1.5 font-mono text-[0.65rem] font-bold text-[#7A7890]">
                  {item.questionCount} question
                  {item.questionCount === 1 ? "" : "s"} · {item.correctCount}{" "}
                  correct
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {report.mode === "placement" && (
        <section className="rounded-[16px] border border-[#DED8FF] bg-white px-5 py-4 shadow-[0_8px_20px_rgba(77,65,180,0.06)]">
          <p className="text-[14px] font-medium leading-6 text-[#404765]">
            <span className="float-left mr-3 mt-0.5 grid h-9 w-9 place-items-center rounded-full bg-[#F1ECFF] text-[#6B4FD8]">
              <Pin className="h-4 w-4" />
            </span>
            Based on today&apos;s placement test, we&apos;ve identified the
            skills to work on first and the areas where focused practice can
            make the biggest difference. Use the learning plan below as your{" "}
            <span className="font-extrabold text-[#4B35D6]">
              starting point
            </span>{" "}
            for moving up.
          </p>
        </section>
      )}

      <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
        {/* Removed Run New Diagnostic button from here */}
      </div>

      <div className="v1-kpi-strip">
        {[
          {
            icon: "📊",
            bg: "rgba(245,166,35,0.10)",
            color: "#F5A623",
            val: `${roundedScore}%`,
            label: "Score",
            detail: `Scaled to 100 · ${correctCount}/${totalQuestions} correct`,
          },
          {
            icon: "✅",
            bg: "rgba(34,197,94,0.08)",
            color: "#22C55E",
            val: String(correctCount),
            label: "Correct Answers",
            detail: `${totalQuestions - correctCount} incorrect out of ${totalQuestions} total`,
          },
          {
            icon: "⚡",
            bg: "rgba(46,196,182,0.10)",
            color: "#2EC4B6",
            val: String(rapidCount),
            label: "Rapid Answers",
            detail: "Answered in under 2s (flagged)",
          },
          {
            icon: "⏳",
            bg: "rgba(34,197,94,0.08)",
            color: "#22C55E",
            val: formatDuration(avgTimeTakenMs),
            label: "Avg Time / Question",
            detail: `${formatCompactDuration(totalTimeTakenMs)} total test time`,
          },
        ].map((kpi) => (
          <div key={kpi.label} className="v1-kpi">
            <div
              className="w-10 h-10 rounded-[12px] grid place-items-center text-[1.1rem] mb-2.5"
              style={{ background: kpi.bg, color: kpi.color }}
            >
              {kpi.icon}
            </div>
            <div className="v1-kpi-val">{kpi.val}</div>
            <div className="text-[0.75rem] text-[#5a5a72] mt-1 font-medium">
              {kpi.label}
            </div>
            <div className="text-[0.7rem] text-[#9a9ab0] mt-1.5 font-medium leading-relaxed">
              {kpi.detail}
            </div>
          </div>
        ))}
      </div>

      {results.length > 0 && selectedReviewRecord && (
        <div className="v1-card">
          <div className="px-5 pt-4 pb-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="font-bold text-[0.95rem] flex items-center gap-2">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-[#F5A623] text-white">
                    ✓
                  </span>
                  Review your answers
                </div>
                <div className="mt-1 text-[0.72rem] text-[#6B7280] font-medium">
                  Tap any question to see your answer, the correct answer, and
                  the explanation.
                </div>
              </div>
              <div className="hidden items-center gap-3 font-mono text-[0.68rem] font-bold text-[#6B7280] sm:flex">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#2E9E5B]" />
                  Correct
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#F46853]" />
                  Wrong
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#D97706]" />
                  Partial
                </span>
              </div>
            </div>
          </div>

          <div className="px-5 pb-5">
            <div className="grid grid-cols-6 gap-2 sm:grid-cols-9 lg:grid-cols-[repeat(18,minmax(0,1fr))]">
              {results.map((record, index) => {
                const isSelected =
                  record.question.id === selectedReviewRecord.question.id;
                const isCorrect = record.verdict === "correct";
                const isPartial = record.verdict === "partial";
                const tileClass = isCorrect
                  ? "border-[#2E9E5B] bg-[#EAF8EF] text-[#1F7A45]"
                  : isPartial
                    ? "border-[#D97706] bg-[#FFF7E6] text-[#92400E]"
                    : "border-[#F46853] bg-[#FDEDE9] text-[#D63B28]";
                return (
                  <button
                    key={record.question.id}
                    type="button"
                    onClick={() =>
                      setSelectedReviewQuestionId(record.question.id)
                    }
                    className={`flex aspect-square min-h-[48px] items-center justify-center rounded-[10px] border-2 font-mono text-[0.82rem] font-extrabold transition-all hover:-translate-y-0.5 ${tileClass} ${
                      isSelected
                        ? "shadow-[0_0_0_3px_rgba(245,166,35,0.40)] ring-2 ring-[#F5A623]"
                        : ""
                    }`}
                    aria-label={`Review question ${index + 1}`}
                  >
                    {index + 1}
                  </button>
                );
              })}
            </div>

            <div className="mt-5 rounded-[16px] border border-[#E8E3D8] bg-[#F8F9FA] p-5">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-mono text-[0.72rem] font-bold uppercase tracking-widest text-[#6B7280]">
                    Question {selectedReviewIndex + 1}
                  </div>
                  <div className="mt-2 max-w-[920px] text-[1rem] font-extrabold leading-relaxed text-[#111827]">
                    {selectedReviewRecord.question.question}
                  </div>
                  {selectedReviewQuestionSvg && (
                    <div
                      className="mt-4 flex min-h-[140px] max-w-[560px] items-center justify-center rounded-[14px] border border-[#E8E3D8] bg-white p-4 shadow-sm [&_svg]:h-auto [&_svg]:max-h-[210px] [&_svg]:w-full [&_svg]:max-w-[520px]"
                      dangerouslySetInnerHTML={{
                        __html: selectedReviewQuestionSvg,
                      }}
                    />
                  )}
                </div>
                <span
                  className={`rounded-full px-3 py-1 font-mono text-[0.68rem] font-extrabold uppercase tracking-wider ${
                    selectedReviewRecord.verdict === "correct"
                      ? "bg-[#EAF8EF] text-[#1F7A45]"
                      : selectedReviewRecord.verdict === "partial"
                        ? "bg-[#FFF7E6] text-[#92400E]"
                        : "bg-[#FDEDE9] text-[#D63B28]"
                  }`}
                >
                  {selectedReviewRecord.verdict === "correct"
                    ? "Got it right"
                    : selectedReviewRecord.verdict === "partial"
                      ? "Partial"
                      : "Got it wrong"}
                </span>
              </div>

              <div className="grid gap-3 md:grid-cols-[150px_1fr]">
                <div className="font-mono text-[0.72rem] font-bold uppercase tracking-widest text-[#4B5563]">
                  Your answer
                </div>
                <div
                  className={`rounded-[10px] border px-4 py-3 text-[0.92rem] font-semibold ${
                    selectedReviewRecord.verdict === "correct"
                      ? "border-[#2E9E5B] bg-[#F6FBF7]"
                      : "border-[#F46853] bg-[#FFF7F5]"
                  }`}
                >
                  {formatAnswerSummary(
                    selectedReviewRecord.question as QuestionDisplayData,
                    selectedReviewRecord.studentAnswer,
                  )}
                </div>

                <div className="font-mono text-[0.72rem] font-bold uppercase tracking-widest text-[#4B5563]">
                  Correct answer
                </div>
                <div className="rounded-[10px] border border-[#2E9E5B] bg-[#F6FBF7] px-4 py-3 text-[0.92rem] font-semibold">
                  {getCorrectAnswerSummary(
                    selectedReviewRecord.question as QuestionDisplayData,
                  )}
                </div>

                <div className="font-mono text-[0.72rem] font-bold uppercase tracking-widest text-[#4B5563]">
                  Why
                </div>
                <div className="rounded-[10px] border-l-4 border-[#F5A623] bg-white px-4 py-3 text-[0.92rem] font-medium leading-relaxed text-[#334155]">
                  {questionReviewNotes.get(selectedReviewRecord.question.id) ??
                    getQuestionExplanation(selectedReviewRecord)}
                </div>
              </div>

              <div className="mt-5 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => {
                    const previous =
                      results[Math.max(0, selectedReviewIndex - 1)];
                    if (previous)
                      setSelectedReviewQuestionId(previous.question.id);
                  }}
                  disabled={selectedReviewIndex <= 0}
                  className="rounded-full border border-[#E2DED4] bg-white px-5 py-2 text-[0.82rem] font-bold text-[#4B5563] transition-all hover:bg-[#FAFAF7] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  ← Previous
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next =
                      results[
                        Math.min(results.length - 1, selectedReviewIndex + 1)
                      ];
                    if (next) setSelectedReviewQuestionId(next.question.id);
                  }}
                  disabled={selectedReviewIndex >= results.length - 1}
                  className="rounded-full border border-[#E2DED4] bg-white px-5 py-2 text-[0.82rem] font-bold text-[#111827] transition-all hover:bg-[#FAFAF7] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Next →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {report.mode === "placement" && (
        <section className="v1-card p-6 sm:p-8">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-[1.25rem] font-extrabold text-[#0F1226]">
                {firstName}'s Placement Plan
              </div>
              <div className="mt-2 max-w-[760px] text-[0.88rem] font-medium leading-relaxed text-[#525978]">
                Our AI placed {firstName} among {classLabel(report.classLevel)}{" "}
                learners by skill profile and pinpointed the topics to act on
                next.
              </div>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[#4338CA]/20 bg-[#4338CA]/[0.08] px-4 py-2 font-mono text-[0.72rem] font-extrabold uppercase tracking-wider text-[#4338CA]">
              <span className="h-2 w-2 rounded-full bg-[#4338CA]" />
              AI placement by Codeyoung
            </div>
          </div>

          <div className="rounded-[18px] border border-[#D8D7FF] bg-[linear-gradient(135deg,#FBFCFF,#F1F4FC)] p-5 sm:p-6">
            <div className="mb-1 text-[1rem] font-extrabold text-[#0F1226]">
              You sit in the{" "}
              <span className="text-[#4338CA]">{placementBand}</span> cohort
            </div>
            <div className="mb-5 text-[0.78rem] font-medium text-[#525978]">
              Each dot is a {classLabel(report.classLevel)} student. Position is
              mapped on speed x accuracy across {placementTopicCount || 4}{" "}
              topics.
            </div>

            <svg
              className="block h-auto w-full rounded-[14px] border border-[#E0E4EF] bg-white"
              viewBox="0 0 800 280"
              preserveAspectRatio="xMidYMid meet"
              aria-label="Placement cohort map"
            >
              <defs>
                <linearGradient id="cohortBand1" x1="0" x2="1">
                  <stop offset="0%" stopColor="rgba(244,104,83,0.08)" />
                  <stop offset="100%" stopColor="rgba(244,104,83,0.02)" />
                </linearGradient>
                <linearGradient id="cohortBand2" x1="0" x2="1">
                  <stop offset="0%" stopColor="rgba(255,154,60,0.10)" />
                  <stop offset="100%" stopColor="rgba(255,154,60,0.03)" />
                </linearGradient>
                <linearGradient id="cohortBand3" x1="0" x2="1">
                  <stop offset="0%" stopColor="rgba(58,92,204,0.08)" />
                  <stop offset="100%" stopColor="rgba(58,92,204,0.02)" />
                </linearGradient>
                <linearGradient id="cohortBand4" x1="0" x2="1">
                  <stop offset="0%" stopColor="rgba(46,204,135,0.10)" />
                  <stop offset="100%" stopColor="rgba(46,204,135,0.03)" />
                </linearGradient>
              </defs>
              <rect
                x="0"
                y="0"
                width="200"
                height="280"
                fill="url(#cohortBand1)"
              />
              <rect
                x="200"
                y="0"
                width="200"
                height="280"
                fill="url(#cohortBand2)"
              />
              <rect
                x="400"
                y="0"
                width="200"
                height="280"
                fill="url(#cohortBand3)"
              />
              <rect
                x="600"
                y="0"
                width="200"
                height="280"
                fill="url(#cohortBand4)"
              />
              {[200, 400, 600].map((x) => (
                <line
                  key={x}
                  x1={x}
                  y1="0"
                  x2={x}
                  y2="280"
                  stroke="rgba(15,18,38,0.07)"
                  strokeDasharray="3 4"
                />
              ))}
              <text
                x="100"
                y="24"
                textAnchor="middle"
                fontSize="10"
                fontWeight="800"
                fill="#F46853"
                letterSpacing="2"
              >
                EARLY START
              </text>
              <text
                x="300"
                y="24"
                textAnchor="middle"
                fontSize="10"
                fontWeight="800"
                fill="#FF8A2A"
                letterSpacing="2"
              >
                FOUNDATION BUILDER
              </text>
              <text
                x="500"
                y="24"
                textAnchor="middle"
                fontSize="10"
                fontWeight="800"
                fill="#3A5CCC"
                letterSpacing="2"
              >
                CONFIDENT SOLVER
              </text>
              <text
                x="700"
                y="24"
                textAnchor="middle"
                fontSize="10"
                fontWeight="800"
                fill="#20C97A"
                letterSpacing="2"
              >
                GRADE-AHEAD
              </text>
              <text
                x="16"
                y="56"
                fontSize="9"
                fill="#9AA0B5"
                fontWeight="800"
                letterSpacing="1.5"
              >
                ↑ ACCURACY
              </text>
              <text
                x="780"
                y="268"
                textAnchor="end"
                fontSize="9"
                fill="#9AA0B5"
                fontWeight="800"
                letterSpacing="1.5"
              >
                SKILL PROFILE →
              </text>
              <g fill="#9AA0B5" opacity="0.48">
                {peerDotSeeds.map((seed) => (
                  <circle
                    key={seed}
                    cx={seededRange(seed + 80, 40, 765)}
                    cy={
                      seededRange(seed + 160, 70, 238) -
                      seededRange(seed + 220, 0, 70)
                    }
                    r="4"
                  />
                ))}
              </g>
              <path
                d={`M ${Math.max(32, Math.min(768, roundedScore * 8)) + 20} ${Math.max(58, 238 - roundedScore * 1.75)} Q ${Math.max(380, Math.min(560, roundedScore * 8 + 130))} 95 540 112`}
                fill="none"
                stroke="#7C5CFC"
                strokeWidth="2"
                strokeDasharray="5 6"
              />
              <polygon points="540,112 531,106 532,119" fill="#7C5CFC" />
              <text
                x="455"
                y="95"
                textAnchor="middle"
                fontSize="10"
                fontWeight="800"
                fill="#7C5CFC"
                letterSpacing="1"
              >
                NEXT GOAL
              </text>
              <g>
                <circle
                  cx={Math.max(32, Math.min(768, roundedScore * 8))}
                  cy={Math.max(56, 238 - roundedScore * 1.75)}
                  r="14"
                  fill="rgba(244,104,83,0.18)"
                />
                <circle
                  cx={Math.max(32, Math.min(768, roundedScore * 8))}
                  cy={Math.max(56, 238 - roundedScore * 1.75)}
                  r="8"
                  fill="#F46853"
                  stroke="#FFFFFF"
                  strokeWidth="3"
                />
                <rect
                  x={Math.max(42, Math.min(690, roundedScore * 8 - 48))}
                  y={Math.max(24, 208 - roundedScore * 1.75)}
                  width="104"
                  height="24"
                  rx="6"
                  fill="#0F1226"
                />
                <text
                  x={Math.max(94, Math.min(742, roundedScore * 8 + 4))}
                  y={Math.max(40, 224 - roundedScore * 1.75)}
                  textAnchor="middle"
                  fill="#FFFFFF"
                  fontSize="10"
                  fontWeight="800"
                  letterSpacing="1"
                >
                  {firstName.toUpperCase()} - {roundedScore} / 100
                </text>
              </g>
            </svg>

            <div className="mt-4 grid gap-2 md:grid-cols-4">
              {[
                ["Early Start", "0-30", "~22% peers"],
                ["Foundation Builder", "30-55", "~36% peers"],
                ["Confident Solver", "55-80", "~28% peers"],
                ["Grade-Ahead", "80+", "~14% peers"],
              ].map(([name, range, peers]) => {
                const isCurrent = name === placementBand;
                return (
                  <div
                    key={name}
                    className={`rounded-[10px] border bg-white p-3 text-center text-[0.74rem] ${
                      isCurrent
                        ? "border-[#FF8A2A] ring-2 ring-[#FF8A2A]/20"
                        : "border-[#E0E4EF]"
                    }`}
                  >
                    <div className="font-extrabold text-[#0F1226]">{name}</div>
                    <div className="mt-1 text-[#525978]">
                      {range} - {peers}
                      {isCurrent ? " - YOU" : ""}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-5 grid gap-3 rounded-[14px] border border-[#D8D7FF] bg-white p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center">
              <div className="grid h-10 w-10 place-items-center rounded-[10px] bg-[#4338CA] text-white">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="text-[0.86rem] font-medium leading-relaxed text-[#0F1226]">
                {firstName} answered{" "}
                <b className="text-[#4338CA]">
                  {correctCount}/{totalQuestions}
                </b>{" "}
                correctly, placing around{" "}
                <b className="text-[#4338CA]">P{placementPercentile}</b>. To
                move into <b className="text-[#4338CA]">{placementNextBand}</b>,
                focus first on {weakTopicCount || 1} weaker topic
                {(weakTopicCount || 1) === 1 ? "" : "s"}.
              </div>
              <div className="font-mono text-[0.66rem] font-extrabold uppercase tracking-wider text-[#9AA0B5]">
                Sample
                <br />
                dynamic
              </div>
            </div>
          </div>
        </section>
      )}

      {report.mode === "placement" && (
        <PlacementTopicInsightsSection
          report={report}
          studentFirstName={firstName}
        />
      )}

      {report.mode !== "placement" && (
        <div className="rounded-[18px] border border-[#F5DDD0] bg-[linear-gradient(135deg,#FFF8F2_0%,#FDF0E8_100%)] p-5 shadow-[0_2px_20px_rgba(26,26,46,0.04)] sm:p-8">
          {/* Needs Practice + Recurring Button Section */}
          {roundedScore < 60 && (
            <div className="mb-10 w-full rounded-[24px] border-2 border-[#F5A623]/20 bg-white/70 p-7 shadow-sm transition-all">
              <div className="flex flex-col items-center text-center">
                <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-[#f46853]/10 text-[#f46853]">
                  <AlertCircle className="h-6 w-6" />
                </div>
                <h3 className="text-[1.1rem] font-extrabold text-[#1B4A4A]">
                  Focus Area: Improving your score
                </h3>
                <p className="mt-2 max-w-[500px] text-[0.92rem] font-medium leading-relaxed text-[#111827]">
                  Based on your results, you can significantly boost your
                  performance by focusing on these specific topics:
                </p>
              </div>

              {sortedLearningObjectives.filter((lo) => lo.score < 60).length >
                0 && (
                <div className="my-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {sortedLearningObjectives
                    .filter((lo) => lo.score < 60)
                    .slice(0, 6)
                    .map((lo) => (
                      <div
                        key={lo.learningObjective}
                        className="flex items-center gap-3 rounded-[14px] border border-[#F5A623]/20 bg-white p-3.5 shadow-[0_2px_8px_rgba(0,0,0,0.02)] transition-all hover:border-[#F5A623]/40"
                      >
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#F5A623]/10 text-[#F5A623]">
                          <span className="text-[10px] font-bold">🎯</span>
                        </div>
                        <span className="text-left text-[14px] font-bold leading-tight text-[#1B4A4A]">
                          {formatLearningObjectiveLabel(lo.learningObjective)}
                        </span>
                      </div>
                    ))}
                </div>
              )}

              <div className="mt-8 flex flex-col items-center border-t border-dashed border-[#F5A623]/20 pt-8">
                <p className="mb-5 text-center text-[0.92rem] font-bold text-[#111827]">
                  Ready to improve? Take a targeted practice test on these
                  topics.
                </p>
                <button
                  onClick={() => {
                    const assessmentId =
                      (report as any).id || (report as any).assessmentId;
                    if (assessmentId) onRecurring(assessmentId);
                  }}
                  disabled={isBusy}
                  className="group relative flex min-w-[280px] items-center justify-center gap-3 rounded-full bg-[#F5A623] px-10 py-4 text-[16px] font-bold text-white shadow-[0_8px_24px_rgba(245,166,35,0.30)] transition-all hover:-translate-y-1 hover:bg-[#E0941A] hover:shadow-[0_12px_36px_rgba(245,166,35,0.40)] disabled:opacity-50"
                >
                  <RotateCcw className="h-5 w-5 transition-transform group-hover:rotate-45" />
                  {isBusy ? "Preparing..." : "Start Improvement Test"}
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>
            </div>
          )}

          <div className="mb-5 text-[1.1rem] font-extrabold text-[#1B4A4A] sm:text-[1.2rem]">
            What went well &amp; what to work on next
          </div>

          <p className="mb-5 max-w-[980px] text-[0.95rem] font-medium leading-[1.8] text-[#111827] sm:text-[1rem]">
            {resultCopy.mainSummary}
          </p>

          <div className="mb-4 rounded-[12px] bg-white/75 px-4 py-3 text-[0.92rem] font-semibold leading-relaxed text-[#1B4A4A]">
            {resultCopy.whatWentWell}
          </div>

          <p className="mb-6 max-w-[980px] text-[1rem] font-medium leading-[1.8] text-[#111827]">
            {resultCopy.whatNeedsPractice}
          </p>

          <div className="my-6 h-px bg-[rgba(0,0,0,0.08)]" />

          <div className="mb-4 font-mono text-[0.72rem] font-extrabold uppercase tracking-[0.16em] text-[#6B7280]">
            How to get a higher score
          </div>

          <div className="flex flex-col gap-2">
            {resultCopy.practiceSteps.map((item, index) => (
              <div
                key={item}
                className="flex items-start gap-3 rounded-[10px] bg-white/75 px-4 py-3 text-[0.92rem] leading-relaxed text-[#111827]"
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#F5A623] font-mono text-[0.75rem] font-extrabold text-white">
                  {index + 1}
                </span>
                <span className="flex-1">{item}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="v1-card">
        <div className="px-5 pt-4 pb-3 flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="font-bold text-[0.95rem]">
              📋 Question-by-Question Breakdown
            </div>
            <div className="text-[0.72rem] text-[#9a9ab0] font-medium">
              Detailed analysis per question
            </div>
          </div>
          <button
            onClick={() => setShowMethodology(true)}
            className="px-4 py-1.5 rounded-full font-bold text-[0.78rem] border border-[rgba(245,166,35,0.25)] bg-[rgba(245,166,35,0.06)] text-[#F5A623] transition-all hover:bg-[rgba(245,166,35,0.12)]"
          >
            🔬 Methodology
          </button>
        </div>
        <div className="px-5 pb-5 overflow-x-auto">
          <table className="v1-student-table min-w-[1000px] whitespace-nowrap">
            <thead>
              <tr>
                <th>Q</th>
                <th>Difficulty</th>
                <th>Your Answer</th>
                <th>Correct</th>
                <th>Result</th>
                <th>Time</th>
                <th>Pts</th>
                <th>Earned</th>
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {results.map((record, index) => {
                const difficulty = normalizeDifficultyLevel(
                  record.question.difficultyLevel,
                );
                const isCorrect = record.verdict === "correct";
                const isRapid =
                  (record.timeTakenMs ?? 0) > 0 &&
                  (record.timeTakenMs ?? 0) < RAPID_RESPONSE_THRESHOLD_MS;
                const finalPoints = getQuestionFinalPoints(record);
                const basePoints = getQuestionBasePoints(difficulty);
                const scoreColor = finalPoints === 0 ? "#f46853" : "#2ecc87";
                return (
                  <tr key={record.question.id}>
                    <td>
                      <div className="flex h-[30px] w-[30px] items-center justify-center rounded-[8px] bg-white font-mono text-[0.82rem] font-bold">
                        {index + 1}
                      </div>
                    </td>
                    <td>
                      <span className={`v1-diff-badge ${difficulty}`}>
                        {difficulty}
                      </span>
                    </td>
                    <td className="max-w-[180px]">
                      <span
                        className={`font-mono font-bold text-[0.85rem] block truncate ${isCorrect ? "text-[#2ecc87]" : "text-[#f46853]"}`}
                      >
                        {formatAnswerSummary(
                          record.question as QuestionDisplayData,
                          record.studentAnswer,
                        )}
                      </span>
                    </td>
                    <td className="max-w-[180px]">
                      <span className="font-mono font-bold text-[0.85rem] text-[#2ecc87] block truncate">
                        {getCorrectAnswerSummary(
                          record.question as QuestionDisplayData,
                        )}
                      </span>
                    </td>
                    <td className="font-bold text-[1.05rem]">
                      {isCorrect ? "✓" : "✗"}
                    </td>
                    <td>
                      <span className="font-mono text-[0.82rem] font-bold text-[#5a5a72]">
                        {formatDuration(record.timeTakenMs)}
                      </span>
                    </td>
                    <td>
                      <span className="font-mono text-[0.88rem] font-bold text-[#5a5a72]">
                        {basePoints}
                      </span>
                    </td>
                    <td>
                      <span
                        className="font-mono text-[0.88rem] font-bold"
                        style={{ color: scoreColor }}
                      >
                        {formatPoints(finalPoints)}
                      </span>
                    </td>
                    <td>
                      <div className="flex gap-1.5">
                        {isRapid && (
                          <span className="text-[0.68rem] font-bold px-2.5 py-1 rounded-full bg-[rgba(245,166,35,0.10)] text-[#F5A623]">
                            ⚡ Rapid
                          </span>
                        )}
                        {isCorrect && !isRapid && (
                          <span className="text-[0.68rem] font-bold px-2.5 py-1 rounded-full bg-[rgba(46,204,135,0.08)] text-[#2ecc87]">
                            ✓ Clean
                          </span>
                        )}
                        {!isCorrect && !isRapid && null}
                      </div>
                    </td>
                  </tr>
                );
              })}
              <tr style={{ background: "rgba(245,166,35,0.04)" }}>
                <td
                  colSpan={5}
                  className="text-right py-3 font-bold text-[0.92rem]"
                >
                  Total
                </td>
                <td className="font-mono text-[0.82rem] font-bold">
                  {formatCompactDuration(totalTimeTakenMs)}
                </td>
                <td></td>
                <td className="font-mono text-[0.95rem] font-bold text-[#F5A623]">
                  {roundedScore}%
                </td>
                <td></td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {report.mode !== "placement" && (
        <ProgressComparisonCard
          report={report}
          currentCorrectCount={correctCount}
          currentTotalQuestions={totalQuestions}
        />
      )}

      {/* Parent notes */}
      <div
        className="hidden"
        style={{
          background: "linear-gradient(135deg,#F6F8FB 0%,#EEF3FA 100%)",
          border: "1px solid #E2E8F0",
        }}
      >
        <div className="p-6">
          <div className="mb-1 flex items-center gap-2 text-[1.05rem] font-extrabold text-[#1B4A4A]">
            <span>📝</span> For Parents
          </div>
          <div className="mb-4 text-[0.85rem] font-medium text-[#5a6b85]">
            A quick readout from this diagnostic.
          </div>

          <div className="flex flex-col gap-2">
            {resultCopy.parentNotes.map((note) => (
              <div
                key={note}
                className="flex items-start gap-3 rounded-[12px] bg-white/80 px-4 py-3 text-[0.88rem] font-medium leading-relaxed text-[#334155]"
              >
                <span className="mt-[8px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#5a6b85]" />
                <span>{note}</span>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-[12px] bg-white/75 px-4 py-3 text-[0.88rem] font-semibold text-[#1B4A4A]">
            {correctCount}/{totalQuestions} correct this time. Next focus:{" "}
            {resultCopy.practiceSteps[0] ??
              "review the recommended practice steps."}
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
        <button
          onClick={onReset}
          className="flex min-w-[240px] items-center justify-center gap-2 rounded-full bg-[#F5A623] px-10 py-4 text-[16px] font-bold text-white shadow-[0_8px_24px_rgba(245,166,35,0.30)] transition-all hover:bg-[#E0941A] hover:-translate-y-1 hover:shadow-[0_12px_36px_rgba(245,166,35,0.40)]"
        >
          <RotateCcw className="h-4 w-4" />{" "}
          {report.mode === "placement"
            ? "Run New Placement Test"
            : "Run New Diagnostic"}
        </button>
      </div>

      {showMethodology && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[rgba(0,0,0,0.3)] backdrop-blur-[4px]"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowMethodology(false);
          }}
        >
          <div className="bg-white rounded-[18px] max-w-[580px] w-full max-h-[85vh] overflow-y-auto shadow-[0_20px_60px_rgba(0,0,0,0.18)]">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[rgba(0,0,0,0.08)] bg-white p-6">
              <h3 className="font-bold text-[1.05rem] flex items-center gap-2">
                🔬 Scoring Methodology
              </h3>
              <button
                onClick={() => setShowMethodology(false)}
                className="w-8 h-8 rounded-full border border-[rgba(0,0,0,0.08)] flex items-center justify-center text-[#6B7280] hover:bg-[#F8F9FA]"
              >
                ✕
              </button>
            </div>
            <div className="p-6 space-y-5">
              <p className="text-[0.84rem] text-[#5a5a72] leading-relaxed">
                Your diagnostic score reflects how well you understand each
                concept. Harder questions reward more points.
              </p>
              <div>
                <h4 className="font-bold text-[0.9rem] mb-2">
                  📐 Points by Difficulty
                </h4>
                <div className="border border-[rgba(0,0,0,0.08)] rounded-xl overflow-hidden">
                  <table className="w-full text-[0.82rem]">
                    <thead className="bg-[#F8F9FA] border-b border-[rgba(0,0,0,0.08)]">
                      <tr>
                        <th className="text-left px-3 py-2 font-bold text-[#9a9ab0] uppercase text-[0.7rem]">
                          Difficulty
                        </th>
                        <th className="text-left px-3 py-2 font-bold text-[#9a9ab0] uppercase text-[0.7rem]">
                          Score
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[rgba(0,0,0,0.06)]">
                      {[
                        ["Easy", "easy", "2 pts"],
                        ["Medium", "medium", "3 pts"],
                        ["Hard", "hard", "4 pts"],
                      ].map(([label, cls, pts]) => (
                        <tr key={cls}>
                          <td className="px-3 py-2">
                            <span className={`v1-diff-badge ${cls}`}>
                              {label}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-bold">{pts}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="p-4 rounded-xl bg-[rgba(245,166,35,0.04)] border border-[rgba(245,166,35,0.12)] text-[0.82rem] text-[#5a5a72] leading-relaxed">
                <strong className="text-[#F5A623]">💡 Time tracking:</strong>{" "}
                Time spent on each question is recorded to help identify
                confidence or hesitation — but there is no time limit or
                penalty.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Result Tabs (V1 / V2) ────────────────────────────────────────────────────
export function ResultTabs({
  report,
  onReset,
  onRecurring,
  isBusy = false,
}: {
  report: DiagnosticReport;
  onReset: () => void;
  onRecurring: (assessmentId: string) => void;
  isBusy?: boolean;
}) {
  return (
    <ReportView
      report={report}
      onReset={onReset}
      onRecurring={onRecurring}
      isBusy={isBusy}
    />
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
export function DiagnosticDemo({
  quizCatalog,
  defaultTopicEntry,
  defaultTopicLearningObjectives,
  assessmentKind = "diagnostic",
}: {
  quizCatalog: DemoQuizCatalog;
  defaultTopicEntry: DemoQuizCatalogEntry | null;
  defaultTopicLearningObjectives: string[];
  assessmentKind?: AssessmentKind;
}) {
  const assessmentCopy = ASSESSMENT_COPY[assessmentKind];
  const visibleQuizCatalog = {
    entries: quizCatalog.entries.filter((entry) =>
      isClassLevelAvailableForAssessment(assessmentKind, entry.classLevel),
    ),
  };
  const initialTopicEntry =
    defaultTopicEntry &&
    isClassLevelAvailableForAssessment(
      assessmentKind,
      defaultTopicEntry.classLevel,
    )
      ? defaultTopicEntry
      : (visibleQuizCatalog.entries[0] ?? defaultTopicEntry);
  const initialClassLevel =
    initialTopicEntry?.classLevel ?? DIAGNOSTIC_CONTENT_DEFAULTS.classLevel;
  const [appScreen, setAppScreen] = useState<AppScreen>("student-info");
  const [studentSetup, setStudentSetup] = useState<StudentSetup>({
    studentId: "Riya Sharma",
    classLevel: initialClassLevel,
    region: DEFAULT_DIAGNOSTIC_REGION,
  });
  const [testMode, setTestMode] = useState<
    "topic" | "multi_topic" | "grade" | "recurring" | "placement"
  >("topic");
  const [selectedGradeClass, setSelectedGradeClass] =
    useState<string>(initialClassLevel);
  const [selectedGradeSubject, setSelectedGradeSubject] = useState<string>(
    initialTopicEntry?.subject ?? "Maths",
  );
  const [selectedTopicEntry, setSelectedTopicEntry] =
    useState<DemoQuizCatalogEntry | null>(() => initialTopicEntry);
  const [toast, setToast] = useState<{
    emoji: string;
    title: string;
    message: string;
  } | null>(null);

  const [form, setForm] = useState<CreateSessionInput>(() =>
    buildDefaultForm(
      initialTopicEntry,
      "Riya Sharma",
      DEFAULT_DIAGNOSTIC_REGION,
    ),
  );
  const [quiz, setQuiz] = useState<DemoLoadedQuiz | null>(null);
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentAnswer, setCurrentAnswer] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [questionElapsedMs, setQuestionElapsedMs] = useState(0);
  const [responseMeta, setResponseMeta] = useState<
    Record<
      string,
      { timeTakenMs: number; allocatedTimeMs: number; wasAutoSkipped: boolean }
    >
  >({});
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"load" | "submit" | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();

  const currentQuestion = quiz?.questions[currentIndex] ?? null;
  const isBusy = isPending || pendingAction !== null;
  const isSubmitting = pendingAction === "submit";
  const classLevels = useMemo(() => {
    const availableClassLevels = Array.from(
      new Set(visibleQuizCatalog.entries.map((entry) => entry.classLevel)),
    ).sort();
    return availableClassLevels.length > 0
      ? availableClassLevels
      : [initialClassLevel];
  }, [initialClassLevel, visibleQuizCatalog.entries]);

  const quizRef = useRef<DemoLoadedQuiz | null>(quiz);
  const currentIndexRef = useRef(currentIndex);
  const currentAnswerRef = useRef(currentAnswer);
  const answersRef = useRef<Record<string, string>>(answers);
  const responseMetaRef = useRef(responseMeta);
  const advanceLockRef = useRef(false);
  const questionStartedAtRef = useRef<number>(Date.now());
  const advanceRef = useRef<
    (overrideAnswer?: string, meta?: { wasAutoSkipped?: boolean }) => void
  >(() => {});
  const setToastRef = useRef(setToast);

  useEffect(() => {
    setToastRef.current = setToast;
  }, [setToast]);

  useEffect(() => {
    quizRef.current = quiz;
    currentIndexRef.current = currentIndex;
    currentAnswerRef.current = currentAnswer;
    answersRef.current = answers;
    responseMetaRef.current = responseMeta;
  }, [answers, currentAnswer, currentIndex, quiz, responseMeta]);

  const finalizeQuiz = (
    finalAnswers: Record<string, string>,
    finalResponseMeta: Record<
      string,
      { timeTakenMs: number; allocatedTimeMs: number; wasAutoSkipped: boolean }
    >,
  ) => {
    const activeQuiz = quizRef.current;
    if (!activeQuiz) return;
    setPendingAction("submit");
    startTransition(() => {
      void (async () => {
        try {
          setError(null);
          const finalReport = await submitQuiz(
            activeQuiz,
            finalAnswers,
            finalResponseMeta,
          );
          setReport(finalReport);
          setQuiz(null);
          setPendingAction(null);
        } catch (err) {
          setError(toErrorMessage(err));
          setPendingAction(null);
        }
      })();
    });
  };

  advanceRef.current = (
    overrideAnswer = currentAnswerRef.current,
    meta = {},
  ) => {
    if (advanceLockRef.current) return;
    const activeQuiz = quizRef.current;
    const questionIndex = currentIndexRef.current;
    const question = activeQuiz?.questions[questionIndex];
    if (!activeQuiz || !question) return;

    advanceLockRef.current = true;

    // Trigger toast at certain question indices
    const toastIdx = TOAST_TRIGGERS.indexOf(questionIndex);
    if (toastIdx >= 0) {
      setToastRef.current(TOAST_CONFIGS[toastIdx] ?? null);
    }

    const questionTimeLimitMs = getQuestionTimeLimitMs(
      question.difficultyLevel,
    );
    const nextAnswers = {
      ...answersRef.current,
      [question.id]: overrideAnswer,
    };
    const timeTakenMs = Math.max(0, Date.now() - questionStartedAtRef.current);
    const nextResponseMeta = {
      ...responseMetaRef.current,
      [question.id]: {
        timeTakenMs,
        allocatedTimeMs: questionTimeLimitMs,
        wasAutoSkipped: meta.wasAutoSkipped === true,
      },
    };
    answersRef.current = nextAnswers;
    responseMetaRef.current = nextResponseMeta;
    setAnswers(nextAnswers);
    setResponseMeta(nextResponseMeta);

    if (questionIndex >= activeQuiz.questions.length - 1) {
      finalizeQuiz(nextAnswers, nextResponseMeta);
      return;
    }

    const nextIndex = questionIndex + 1;
    questionStartedAtRef.current = Date.now();
    setCurrentIndex(nextIndex);
    setCurrentAnswer(nextAnswers[activeQuiz.questions[nextIndex].id] ?? "");
  };

  useEffect(() => {
    if (!currentQuestion) return;
    advanceLockRef.current = false;
    questionStartedAtRef.current = Date.now();
    setQuestionElapsedMs(0);
  }, [currentQuestion]);

  useEffect(() => {
    if (!currentQuestion || !quiz) return;
    const timer = window.setInterval(() => {
      setQuestionElapsedMs(
        Math.max(0, Date.now() - questionStartedAtRef.current),
      );
    }, 250);
    return () => window.clearInterval(timer);
  }, [currentQuestion, quiz]);

  const answerAllRandomly = useCallback(() => {
    const activeQuiz = quizRef.current;
    if (!activeQuiz || isBusy) return;

    const { randomAnswers, randomResponseMeta } =
      buildRandomQuizSubmission(activeQuiz);

    answersRef.current = randomAnswers;
    responseMetaRef.current = randomResponseMeta;
    setAnswers(randomAnswers);
    setResponseMeta(randomResponseMeta);
    setCurrentAnswer(
      activeQuiz.questions[currentIndexRef.current]
        ? (randomAnswers[activeQuiz.questions[currentIndexRef.current].id] ??
            "")
        : "",
    );
    finalizeQuiz(randomAnswers, randomResponseMeta);
  }, [isBusy]);

  const startRandomPlacementRun = useCallback(() => {
    if (isBusy) return;
    setPendingAction("submit");
    startTransition(() => {
      void (async () => {
        try {
          setError(null);
          const loadedQuiz = await loadQuiz({ ...form, testMode: "placement" });
          const { randomAnswers, randomResponseMeta } =
            buildRandomQuizSubmission(loadedQuiz);
          const finalReport = await submitQuiz(
            loadedQuiz,
            randomAnswers,
            randomResponseMeta,
          );
          setReport(finalReport);
          setQuiz(null);
          setCurrentIndex(0);
          setAnswers(randomAnswers);
          setResponseMeta(randomResponseMeta);
          setCurrentAnswer("");
          setQuestionElapsedMs(0);
        } catch (err) {
          setError(toErrorMessage(err));
        } finally {
          setPendingAction(null);
        }
      })();
    });
  }, [form, isBusy]);

  const startQuizRun = useCallback(
    (sessionInput = form) => {
      setPendingAction("load");
      startTransition(() => {
        void (async () => {
          try {
            setError(null);
            const loadedQuiz = await loadQuiz(sessionInput);
            setQuiz(loadedQuiz);
            setReport(null);
            setCurrentIndex(0);
            setAnswers({});
            setQuestionElapsedMs(0);
            setResponseMeta({});
            setCurrentAnswer("");
          } catch (err) {
            setError(toErrorMessage(err));
          } finally {
            setPendingAction(null);
          }
        })();
      });
    },
    [form],
  );

  const startRecurringTest = useCallback(
    (assessmentId: string) => {
      setPendingAction("load");
      startTransition(() => {
        void (async () => {
          try {
            setError(null);
            const studentId = studentSetup.studentId.trim() || "Student";
            const recurringQuiz = await loadRecurringQuiz(
              assessmentId,
              studentId,
            );
            setQuiz(recurringQuiz);
            setTestMode("recurring" as any);
            setReport(null);
            setCurrentIndex(0);
            setAnswers({});
            setQuestionElapsedMs(0);
            setResponseMeta({});
            setCurrentAnswer("");
          } catch (err) {
            setError(toErrorMessage(err));
          } finally {
            setPendingAction(null);
          }
        })();
      });
    },
    [studentSetup.studentId],
  );

  const continueFromStudentInfo = () => {
    const studentId = studentSetup.studentId.trim() || "Placement Student";
    if (assessmentKind !== "placement" && !studentSetup.studentId.trim())
      return;

    const entry = getCatalogEntryForClass(
      visibleQuizCatalog,
      studentSetup.classLevel,
    );
    setSelectedGradeClass(studentSetup.classLevel);
    setSelectedTopicEntry(entry);
    setForm(buildDefaultForm(entry, studentId, studentSetup.region));
    setError(null);

    if (assessmentKind === "placement") {
      setTestMode("placement");
      setForm((prev) => ({
        ...prev,
        testMode: "placement",
        region: undefined,
      }));
      setAppScreen("grade-start");
    } else {
      setAppScreen("selector");
    }
  };

  const resetQuiz = () => {
    setQuiz(null);
    setReport(null);
    setCurrentIndex(0);
    setCurrentAnswer("");
    setAnswers({});
    setQuestionElapsedMs(0);
    setResponseMeta({});
    setError(null);
    setPendingAction(null);
    setAppScreen("student-info");
    setSelectedTopicEntry(initialTopicEntry);
    setSelectedGradeClass(studentSetup.classLevel);
    setForm(
      buildDefaultForm(
        initialTopicEntry,
        studentSetup.studentId.trim(),
        studentSetup.region,
      ),
    );
  };

  const canSubmitCurrent =
    !isBusy &&
    !!currentQuestion &&
    (currentQuestion.questionType === "matching" ||
    currentQuestion.questionType === "drag_drop"
      ? Object.keys(getAnswerMap(currentAnswer)).length > 0
      : currentAnswer.trim() !== "");

  const answeredCount = Object.keys(responseMeta).length;

  // Grade test: get topics for selected class
  const gradeTopics = useMemo(() => {
    if (!selectedGradeClass || !selectedGradeSubject) return [];
    return visibleQuizCatalog.entries
      .filter(
        (e) =>
          e.classLevel === selectedGradeClass &&
          e.subject === selectedGradeSubject,
      )
      .map((e) => e.topic);
  }, [visibleQuizCatalog.entries, selectedGradeClass, selectedGradeSubject]);

  const gradeSubject = selectedGradeSubject;

  const topicEntriesForFormGrade = useMemo(
    () =>
      visibleQuizCatalog.entries.filter(
        (entry) => entry.classLevel === form.classLevel,
      ),
    [form.classLevel, visibleQuizCatalog.entries],
  );

  const selectTopicEntryForTest = (
    topicEntry: DemoQuizCatalogEntry,
    studentId = studentSetup.studentId.trim() || "Student",
  ) => {
    setSelectedTopicEntry(topicEntry);
    setSelectedGradeClass(topicEntry.classLevel);
    setForm({
      studentId,
      testMode: "topic",
      subject: topicEntry.subject,
      classLevel: topicEntry.classLevel,
      topic: topicEntry.topic,
      maxQuestions: getTopicQuestionCountForEntry(topicEntry),
      region: studentSetup.region,
    });
  };

  const selectFixedTopicTest = () => {
    const studentId = studentSetup.studentId.trim() || "Student";
    const topicEntry = getCatalogEntryForClass(
      visibleQuizCatalog,
      studentSetup.classLevel,
    );

    if (topicEntry) {
      selectTopicEntryForTest(topicEntry, studentId);
    }
    setTestMode("topic");
    setAppScreen("topic-start");
  };

  const selectFixedGradeTest = () => {
    const studentId = studentSetup.studentId.trim() || "Student";
    const gradeClass = studentSetup.classLevel;
    const gradeEntry =
      visibleQuizCatalog.entries.find(
        (entry) => entry.classLevel === gradeClass,
      ) ?? getDefaultCatalogEntry(visibleQuizCatalog);

    setSelectedGradeClass(gradeClass);
    if (gradeEntry) {
      setForm({
        studentId,
        testMode: "grade",
        subject: gradeEntry.subject,
        classLevel: gradeClass,
        topic: gradeEntry.topic,
        maxQuestions: getGradeQuestionCountForClass(gradeClass),
        region: studentSetup.region,
      });
    }
    setTestMode("grade");
    setAppScreen("grade-start");
  };

  const selectMultiTopicTest = () => {
    setTestMode("multi_topic");
    setAppScreen("multi-topic-setup");
  };

  const handleSelectGradeClass = (cl: string, subject: string) => {
    setSelectedGradeClass(cl);
    setSelectedGradeSubject(subject);
    const firstEntry = visibleQuizCatalog.entries.find(
      (e) => e.classLevel === cl && e.subject === subject,
    );
    if (firstEntry) {
      setForm((prev) => ({
        ...prev,
        studentId: studentSetup.studentId.trim() || prev.studentId,
        classLevel: cl as never,
        subject: firstEntry.subject,
        testMode: "grade",
        topic: firstEntry.topic,
        maxQuestions: getGradeQuestionCountForClass(
          cl as CreateSessionInput["classLevel"],
        ),
        region: studentSetup.region,
      }));
    }
    setAppScreen("grade-start");
  };

  const isQuizActive = !!quiz && !!currentQuestion;
  const showResult = !!report;

  return (
    <div className={THEME.page}>
      <div className="mx-auto max-w-[1480px] px-4 py-4 sm:px-6 lg:px-10">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div
              className={`flex h-[40px] w-[40px] shrink-0 items-center justify-center border-2 border-[#F5A623] bg-white text-[20px] ${
                assessmentCopy.headerShape === "square"
                  ? "rounded-[10px]"
                  : "rounded-full"
              }`}
            >
              {assessmentCopy.headerEmoji}
            </div>
            <div className="flex flex-col leading-tight">
              <span className="font-bold text-[15px] tracking-[0.02em] text-[#1B4A4A] uppercase sm:text-[18px]">
                <span className="hidden sm:inline">{assessmentCopy.brand}</span>
                <span className="sm:hidden">{assessmentCopy.shortBrand}</span>
              </span>
              <span className="hidden text-[11px] font-medium tracking-[0.08em] text-[#6B7280] uppercase sm:inline">
                {assessmentCopy.tagline}
              </span>
            </div>
          </div>

          {isQuizActive || isSubmitting || showResult ? (
            <button
              onClick={resetQuiz}
              className="flex items-center gap-1 text-[14px] text-[#6B7280] transition-colors hover:text-[#1a1a1a]"
            >
              ‹ Back
            </button>
          ) : appScreen === "selector" ? (
            <button
              onClick={() => setAppScreen("student-info")}
              className="flex items-center gap-1 text-[14px] text-[#6B7280] transition-colors hover:text-[#1a1a1a]"
            >
              â€¹ Back
            </button>
          ) : appScreen !== "student-info" ? (
            <button
              onClick={() =>
                setAppScreen(
                  assessmentKind === "placement" ? "student-info" : "selector",
                )
              }
              className="flex items-center gap-1 text-[14px] text-[#6B7280] transition-colors hover:text-[#1a1a1a]"
            >
              ‹ Back
            </button>
          ) : (
            <Link
              href="/"
              className="flex items-center gap-1 text-[14px] text-[#6B7280] transition-colors hover:text-[#1a1a1a]"
            >
              <ChevronLeft className="h-4 w-4" /> Back
            </Link>
          )}
        </div>

        {error && (
          <div className="mb-6 flex items-center gap-3 rounded-[12px] border border-[#f46853]/20 bg-[#f46853]/5 p-4 text-[#f46853]">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span className="text-[15px] font-semibold">{error}</span>
          </div>
        )}

        {/* Student Info */}
        {!isQuizActive &&
          !isSubmitting &&
          !showResult &&
          appScreen === "student-info" && (
            <StudentInfoScreen
              setup={studentSetup}
              classLevels={classLevels}
              assessmentCopy={assessmentCopy}
              assessmentKind={assessmentKind}
              onChange={setStudentSetup}
              onContinue={continueFromStudentInfo}
            />
          )}

        {/* Selector */}
        {!isQuizActive &&
          !isSubmitting &&
          !showResult &&
          appScreen === "selector" && (
            <SelectorScreen
              onSelectTopic={selectFixedTopicTest}
              onSelectMultiTopic={selectMultiTopicTest}
              onSelectGrade={selectFixedGradeTest}
              studentName={studentSetup.studentId.trim() || "Student"}
              classLevel={studentSetup.classLevel}
              assessmentCopy={assessmentCopy}
            />
          )}

        {/* Multi-topic Setup */}
        {!isQuizActive &&
          !isSubmitting &&
          !showResult &&
          appScreen === "multi-topic-setup" && (
            <MultiTopicSetupScreen
              quizCatalog={visibleQuizCatalog}
              classLevel={studentSetup.classLevel}
              isBusy={isBusy}
              onBack={() => setAppScreen("selector")}
              onBegin={({ subject, topics, maxQuestions }) => {
                const multiTopicForm: CreateSessionInput = {
                  studentId: studentSetup.studentId.trim() || "Student",
                  testMode: "multi_topic",
                  subject,
                  classLevel: studentSetup.classLevel,
                  topic: "",
                  topics,
                  maxQuestions,
                  region: studentSetup.region,
                };
                setTestMode("multi_topic");
                setForm(multiTopicForm);
                startQuizRun(multiTopicForm);
              }}
            />
          )}

        {/* Topic Browse */}
        {!isQuizActive &&
          !isSubmitting &&
          !showResult &&
          appScreen === "topic-browse" && (
            <TopicBrowseScreen
              form={form}
              setForm={setForm}
              quizCatalog={visibleQuizCatalog}
              defaultTopicEntry={initialTopicEntry}
              assessmentCopy={assessmentCopy}
              onContinue={() => setAppScreen("topic-start")}
              onBack={() => setAppScreen("selector")}
              onSelectEntry={(entry) => setSelectedTopicEntry(entry)}
            />
          )}

        {/* Topic Start */}
        {!isQuizActive &&
          !isSubmitting &&
          !showResult &&
          appScreen === "topic-start" && (
            <TopicStartScreen
              form={form}
              learningObjectives={
                selectedTopicEntry?.learningObjectives ??
                defaultTopicLearningObjectives
              }
              topicEntries={topicEntriesForFormGrade}
              assessmentCopy={assessmentCopy}
              onSelectTopic={(entry) => {
                selectTopicEntryForTest(entry);
              }}
              onBegin={() => {
                startQuizRun();
              }}
              onBack={() => setAppScreen("selector")}
              isBusy={isBusy}
            />
          )}

        {/* Grade Browse */}
        {!isQuizActive &&
          !isSubmitting &&
          !showResult &&
          appScreen === "grade-browse" && (
            <GradeBrowseScreen
              quizCatalog={visibleQuizCatalog}
              assessmentCopy={assessmentCopy}
              onSelect={handleSelectGradeClass}
              onBack={() => setAppScreen("selector")}
            />
          )}

        {/* Grade Start */}
        {!isQuizActive &&
          !isSubmitting &&
          !showResult &&
          appScreen === "grade-start" && (
            <GradeStartScreen
              classLevel={selectedGradeClass}
              subject={gradeSubject}
              assessmentCopy={assessmentCopy}
              onBegin={() => {
                startQuizRun();
              }}
              onBeginRandom={startRandomPlacementRun}
              onBack={() =>
                setAppScreen(
                  assessmentKind === "placement" ? "student-info" : "selector",
                )
              }
              isBusy={isBusy}
              testMode={testMode}
            />
          )}

        {/* Quiz */}
        {isQuizActive && quiz && currentQuestion && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Question header card */}
            <div
              className={`mb-5 rounded-[16px] bg-white px-4 py-4 sm:px-5 ${
                assessmentKind === "placement"
                  ? ""
                  : "border border-[rgba(0,0,0,0.08)] shadow-sm"
              }`}
              style={
                assessmentKind === "placement"
                  ? {
                      border: "2px solid rgba(46,196,182,0.25)",
                      boxShadow:
                        "0 6px 0 rgba(46,196,182,0.18), 0 4px 14px rgba(26,26,46,0.06)",
                    }
                  : undefined
              }
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-mono text-[11px] font-bold uppercase tracking-widest text-[#2EC4B6]">
                    {testMode === "placement"
                      ? "PLACEMENT TEST"
                      : testMode === "grade"
                        ? "GRADE TEST"
                        : testMode === "multi_topic"
                          ? "MULTI-TOPIC TEST"
                          : "TOPIC TEST"}{" "}
                    / {classLabel(quiz.classLevel)}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[18px] font-extrabold text-[#1a1a1a] sm:text-[20px]">
                    <span>
                      Question {currentIndex + 1} of {quiz.questions.length}
                    </span>
                    {(currentQuestion as any).region && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[#6B7280]">
                        <Globe2 className="h-3 w-3 text-[#2EC4B6]" />
                        {(currentQuestion as any).region} VERSION
                      </span>
                    )}
                    {testMode === "placement" &&
                      (currentQuestion as any).gradeLevel && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-[#2EC4B6]/30 bg-[#E6F8F6] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[#1B4A4A]">
                          <span className="text-[#2EC4B6]">●</span>
                          {`Grade ${String(
                            (currentQuestion as any).gradeLevel,
                          ).replace(/^grade\s*/i, "")} question`}
                        </span>
                      )}
                  </div>
                  {quiz.topic && (
                    <div className="mt-1 text-[12px] font-medium text-[#6B7280]">
                      {quiz.topic}
                    </div>
                  )}
                  {testMode === "multi_topic" && currentQuestion.topic && (
                    <div className="mt-1 text-[12px] font-semibold text-[#7C5CFC]">
                      {currentQuestion.topic}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {testMode === "placement" && (
                    <button
                      type="button"
                      onClick={answerAllRandomly}
                      disabled={isBusy}
                      className="inline-flex items-center justify-center gap-2 rounded-full border border-dashed border-[#2563EB]/35 bg-[#EFF6FF] px-4 py-2.5 font-mono text-[11px] font-bold uppercase tracking-wider text-[#2563EB] transition hover:bg-[#DBEAFE] disabled:opacity-40"
                    >
                      <Shuffle className="h-3.5 w-3.5" />
                      Random submit
                    </button>
                  )}
                  <div className="rounded-[14px] bg-[#F8F9FA] px-3 py-2 text-right sm:px-4">
                    <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-[#9CA3AF]">
                      Time taken
                    </div>
                    <div className="font-mono text-[20px] font-extrabold text-[#1B4A4A] sm:text-[22px]">
                      {(() => {
                        const totalSeconds = Math.floor(
                          questionElapsedMs / 1000,
                        );
                        if (totalSeconds < 60) return `${totalSeconds}s`;
                        const m = Math.floor(totalSeconds / 60);
                        const s = totalSeconds % 60;
                        return `${m}m ${String(s).padStart(2, "0")}s`;
                      })()}
                    </div>
                    <div className="mt-0.5 font-mono text-[9px] font-bold uppercase tracking-widest text-[#9CA3AF]">
                      This question
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Mobile progress bar — visible only below lg (when sidebar is hidden) */}
            <div className="mb-4 lg:hidden">
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-mono text-[11px] font-bold text-[#6B7280]">
                  Progress
                </span>
                <span className="font-mono text-[11px] font-bold text-[#6B7280]">
                  {answeredCount}/{quiz.questions.length} answered
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-[#F0EDE6]">
                <div
                  className="h-full rounded-full bg-[#F5A623] transition-all duration-500"
                  style={{
                    width: `${(answeredCount / quiz.questions.length) * 100}%`,
                  }}
                />
              </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
              {/* Question card */}
              <div
                className={`overflow-hidden rounded-[16px] bg-white ${
                  assessmentKind === "placement"
                    ? ""
                    : "border border-[rgba(0,0,0,0.08)]"
                }`}
                style={
                  assessmentKind === "placement"
                    ? {
                        border: "2px solid rgba(46,196,182,0.25)",
                        boxShadow:
                          "0 6px 0 rgba(46,196,182,0.18), 0 4px 14px rgba(26,26,46,0.06)",
                      }
                    : undefined
                }
              >
                {/* Question top */}
                <div className="relative border-b border-[rgba(0,0,0,0.08)] px-4 pb-5 pt-6 sm:px-7">
                  <div className="pointer-events-none absolute right-3 top-1 z-0 hidden font-mono text-[80px] font-extrabold leading-none text-[#1a1a1a] opacity-[0.06] select-none sm:block">
                    {assessmentKind === "placement"
                      ? toRomanNumeral(currentIndex + 1)
                      : String(currentIndex + 1).padStart(2, "0")}
                  </div>

                  <div className="relative z-10">
                    {"scenario" in (currentQuestion.payload ?? {}) && (
                      <div className="mb-4 rounded-[12px] border border-[#F5A623]/10 bg-[#FFF8E7] p-4">
                        <div className="mb-1.5 font-mono text-[10px] font-bold uppercase tracking-widest text-[#F5A623]">
                          Scenario
                        </div>
                        <p className="text-[15px] font-semibold leading-relaxed text-[#1a1a1a]">
                          {String(
                            (currentQuestion.payload as { scenario?: string })
                              .scenario ?? "",
                          )}
                        </p>
                      </div>
                    )}

                    {typeof (
                      currentQuestion.payload as
                        | { questionSvg?: unknown }
                        | undefined
                    )?.questionSvg === "string" && (
                      <div className="mb-5 flex justify-center rounded-[14px] border border-[#E8E3D8] bg-[#FAFAF7] p-4">
                        <div
                          className="h-[180px] w-full max-w-[360px] [&_svg]:h-full [&_svg]:w-full"
                          dangerouslySetInnerHTML={{
                            __html: String(
                              (
                                currentQuestion.payload as {
                                  questionSvg?: string;
                                }
                              ).questionSvg,
                            ),
                          }}
                        />
                      </div>
                    )}

                    <h3 className="text-[17px] font-semibold leading-normal text-[#1a1a1a]">
                      {renderFormattedQuestionText(currentQuestion.question)}
                    </h3>
                  </div>
                </div>

                {/* Answer area */}
                <div className="px-4 py-5 sm:px-7">
                  <QuestionInput
                    question={currentQuestion}
                    answer={currentAnswer}
                    setAnswer={setCurrentAnswer}
                    assessmentKind={assessmentKind}
                  />
                </div>

                {/* Next button */}
                <div className="flex items-center justify-between gap-3 border-t border-[rgba(0,0,0,0.08)] px-4 py-4 sm:px-7">
                  <button
                    type="button"
                    onClick={answerAllRandomly}
                    disabled={isBusy}
                    className="flex items-center gap-1.5 rounded-full border border-dashed border-[#F5A623] bg-[#FFFBF4] px-4 py-2.5 text-[12px] font-extrabold text-[#F5A623] transition-all hover:bg-[#FFF7E6] disabled:opacity-55"
                  >
                    🎲 Complete Test Instantly
                  </button>
                  <button
                    onClick={() => advanceRef.current(currentAnswer)}
                    disabled={!canSubmitCurrent || isBusy}
                    className={`flex items-center gap-2 rounded-full bg-[#F5A623] px-7 py-3 font-bold text-[15px] text-white transition-all hover:bg-[#E0941A] disabled:opacity-50 ${
                      assessmentKind === "placement"
                        ? "shadow-[0_6px_0_#C68213] hover:translate-y-0.5 hover:shadow-[0_3px_0_#C68213] active:translate-y-1 active:shadow-[0_0_0_#C68213] disabled:translate-y-0 disabled:shadow-[0_6px_0_#C68213]"
                        : "shadow-sm hover:-translate-y-0.5"
                    }`}
                  >
                    {isBusy ? (
                      <span className="flex items-center gap-2.5">
                        <span className="relative flex h-4 w-4 items-center justify-center">
                          <Sparkles className="h-4 w-4 animate-[ai-pulse_1.4s_ease-in-out_infinite]" />
                        </span>
                        <span className="bg-[linear-gradient(90deg,rgba(255,255,255,0.55)_0%,#fff_50%,rgba(255,255,255,0.55)_100%)] bg-[length:200%_100%] bg-clip-text text-transparent animate-[ai-shimmer_1.8s_linear_infinite]">
                          Analyzing
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="h-1 w-1 rounded-full bg-white animate-[ai-dot_1.2s_ease-in-out_infinite]" />
                          <span className="h-1 w-1 rounded-full bg-white animate-[ai-dot_1.2s_ease-in-out_0.2s_infinite]" />
                          <span className="h-1 w-1 rounded-full bg-white animate-[ai-dot_1.2s_ease-in-out_0.4s_infinite]" />
                        </span>
                      </span>
                    ) : (
                      <>
                        {currentIndex === quiz.questions.length - 1
                          ? "Finish Test"
                          : "Next Question"}
                        <ChevronRight className="h-4 w-4" />
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Sidebar */}
              <aside>
                <div
                  className={`rounded-2xl bg-white p-5 ${
                    assessmentKind === "placement"
                      ? ""
                      : "border border-[rgba(0,0,0,0.08)] shadow-sm"
                  }`}
                  style={
                    assessmentKind === "placement"
                      ? {
                          border: "2px solid rgba(46,196,182,0.25)",
                          boxShadow:
                            "0 6px 0 rgba(46,196,182,0.18), 0 4px 14px rgba(26,26,46,0.06)",
                        }
                      : undefined
                  }
                >
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <h4 className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-[#6B7280]">
                      Question Map
                    </h4>
                    <span className="font-mono text-[10px] font-bold text-[#9CA3AF]">
                      {answeredCount}/{quiz.questions.length}
                    </span>
                  </div>
                  <div className="grid grid-cols-5 gap-1.5">
                    {quiz.questions.map((q, i) => {
                      const isActive = i === currentIndex;
                      const hasResponded = q.id in responseMeta;
                      const ans = answers[q.id] || "";
                      const isAnswered =
                        hasResponded &&
                        (q.questionType === "matching" ||
                        q.questionType === "drag_drop"
                          ? Object.keys(getAnswerMap(ans)).length > 0
                          : ans.trim() !== "");
                      const mapTileClass = isAnswered
                        ? "border-[#F5A623] bg-[#FFF8E7] text-[#1B4A4A]"
                        : "border-gray-200 bg-[#F8F9FA] text-[#8B95A5]";
                      return (
                        <div
                          key={q.id}
                          className={`flex aspect-square items-center justify-center rounded-xl border-2 font-mono text-[11px] font-bold transition-all ${
                            isActive
                              ? `${isAnswered ? mapTileClass : "border-[#F5A623] bg-white text-[#1B4A4A]"} shadow-[0_0_0_3px_rgba(245,166,35,0.20)]`
                              : mapTileClass
                          }`}
                        >
                          {i + 1}
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2.5 font-mono text-[10px] text-[#6B7280]">
                    <span className="flex items-center gap-1">
                      <span className="h-2.5 w-2.5 rounded-full border border-[#F5A623] bg-[#FFF8E7]" />
                      Answered
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2.5 w-2.5 rounded-full border-2 border-[#F5A623] bg-white" />
                      Current
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2.5 w-2.5 rounded-full border border-[#E2DED4] bg-[#F8F9FA]" />
                      Upcoming
                    </span>
                  </div>
                </div>
              </aside>
            </div>
          </div>
        )}

        {/* Submitting */}
        {isSubmitting && (
          <MultiStageLoadingScreen
            onBack={resetQuiz}
            studentName={studentSetup.studentId}
            assessmentKind={assessmentKind}
          />
        )}

        {/* Result */}
        {showResult && report && (
          <ResultTabs
            report={report}
            onReset={resetQuiz}
            onRecurring={startRecurringTest}
            isBusy={isBusy}
          />
        )}
      </div>

      {/* AI Tutor Chat Bubble */}
      <AIChatBubble config={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

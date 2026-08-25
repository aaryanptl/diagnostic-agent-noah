import { buildLessonPlan, colorForStatus } from "./core/diagnosticEngine";
import {
  getGradeQuizQuestions,
  getMultiTopicQuizQuestions,
  getPlacementQuestionsByIds,
  getQuizQuestionsByIds,
  getTopicQuizQuestions,
} from "./tools/contentQuiz";
import type {
  AskedQuestionRecord,
  BloomLevel,
  BloomResult,
  DiagnosticConfig,
  DiagnosticQuestionResponse,
  DiagnosticReport,
  DragDropQuestionPayload,
  LearningObjectiveResult,
  MasteryState,
  MatchingQuestionPayload,
  QuestionBankQuestion,
  QuestionDistractorAnalysis,
  QuestionVerdict,
  ReliabilityCheck,
  ReportDistractorInsight,
  SubtopicBloomStatus,
  SubtopicResult,
  TopicMasteryStatus,
  TopicResult,
} from "./types/index";

const BLOOM_WEIGHTS: Record<BloomLevel, number> = {
  remember: 1,
  understand: 2,
  apply: 3,
};

function verdictScore(verdict: QuestionVerdict): number {
  switch (verdict) {
    case "correct":
      return 1;
    case "partial":
      return 0.5;
    case "incorrect":
    case "non_attempt":
      return 0;
  }
}

function scoreRecord(record: AskedQuestionRecord): number {
  return verdictScore(record.verdict);
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function isNonAttemptAnswer(answer: string): boolean {
  const normalized = normalizeText(answer);
  if (normalized === "") return true;
  if (/^[?.\-_/\\]+$/.test(normalized)) return true;
  return [
    "idk",
    "i dont know",
    "i don't know",
    "dont know",
    "don't know",
    "skip",
    "pass",
    "na",
    "n/a",
    "blank",
  ].includes(normalized);
}

function normalizeChoice(value: string): string {
  const trimmed = value.trim().toUpperCase();
  if (["A", "B", "C", "D"].includes(trimmed)) {
    return trimmed;
  }

  const match = trimmed.match(/^([A-D])[).\s-]?.*$/);
  return match?.[1] ?? trimmed;
}

function parseAnswerMap(answer: string): Record<string, string> {
  if (isNonAttemptAnswer(answer)) return {};

  try {
    const parsed = JSON.parse(answer) as Record<string, string>;
    if (parsed && typeof parsed === "object") {
      return Object.fromEntries(
        Object.entries(parsed).map(([key, value]) => [
          String(key),
          String(value),
        ]),
      );
    }
  } catch {
    // ignore parse failures and treat as empty
  }

  return {};
}

function extractSignalTokens(value: string): string[] {
  return Array.from(
    new Set(
      normalizeText(value)
        .split(/[^a-z0-9\-+.]+/i)
        .filter((token) => token.length >= 2),
    ),
  );
}

function overlapRatio(studentAnswer: string, expectedAnswer: string): number {
  const expectedTokens = extractSignalTokens(expectedAnswer);
  if (expectedTokens.length === 0) return 0;

  const studentTokens = new Set(extractSignalTokens(studentAnswer));
  const matched = expectedTokens.filter((token) =>
    studentTokens.has(token),
  ).length;
  return matched / expectedTokens.length;
}

function feedbackFromVerdict(
  verdict: QuestionVerdict,
  correctAnswer: string,
  extra?: string,
) {
  if (verdict === "correct") {
    return extra ? `Correct. ${extra}` : "Correct.";
  }
  if (verdict === "partial") {
    return extra ? `Partly correct. ${extra}` : "Partly correct.";
  }
  if (verdict === "non_attempt") {
    return "No attempt recorded.";
  }
  return extra
    ? `Incorrect. Correct answer: ${correctAnswer}. ${extra}`
    : `Incorrect. Correct answer: ${correctAnswer}.`;
}

function sentenceCase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed[0].toUpperCase() + trimmed.slice(1);
}

function inferMcqMisconception(
  question: QuestionBankQuestion,
  selectedText: string,
  correctText: string,
): string {
  const loweredSelected = normalizeText(selectedText);
  const loweredQuestion = normalizeText(question.question);
  const loweredFocus = normalizeText(question.focus ?? "");

  if (loweredSelected.includes("left") && loweredQuestion.includes("right")) {
    return "The learner appears to be reversing left and right on the number line.";
  }
  if (loweredSelected.includes("right") && loweredQuestion.includes("left")) {
    return "The learner appears to be reversing left and right on the number line.";
  }
  if (
    loweredSelected.includes("decimal") ||
    loweredSelected.includes("fraction")
  ) {
    return "The learner appears to be confusing integers with decimals or fractions.";
  }
  if (
    loweredSelected.includes("only positive") ||
    loweredSelected.includes("greater than 0")
  ) {
    return "The learner appears to think integers include only positive whole numbers.";
  }
  if (
    loweredSelected.includes("only negative") ||
    loweredSelected.includes("less than 0")
  ) {
    return "The learner appears to think integers include only negative numbers.";
  }
  if (loweredFocus.includes("order") || loweredQuestion.includes("order")) {
    return "The learner appears unsure about the ordering rule being tested in this item.";
  }

  return `The learner selected "${selectedText}", suggesting a competing idea instead of "${correctText}".`;
}

function inferQuestionDistractor(
  question: QuestionBankQuestion,
  studentAnswer: string,
): QuestionDistractorAnalysis | undefined {
  if (question.questionType === "mcq") {
    const selectedLabel = normalizeChoice(studentAnswer);
    const correctLabel = normalizeChoice(question.correctAnswer ?? "");
    const selectedIndex = ["A", "B", "C", "D"].indexOf(selectedLabel);
    const correctIndex = ["A", "B", "C", "D"].indexOf(correctLabel);
    const selectedText =
      selectedIndex >= 0
        ? question.options?.[selectedIndex]
        : studentAnswer.trim();
    const correctText =
      correctIndex >= 0
        ? question.options?.[correctIndex]
        : (question.correctAnswer ?? "").trim();

    if (!selectedText || selectedLabel === correctLabel) {
      return undefined;
    }

    return {
      selectedLabel,
      selectedText,
      correctLabel,
      correctText,
      likelyMisconception: inferMcqMisconception(
        question,
        selectedText,
        correctText ?? "",
      ),
    };
  }

  if (question.questionType === "true_false") {
    const payload = question.payload as
      | { misconceptionNote?: string }
      | undefined;
    return {
      selectedText: sentenceCase(studentAnswer),
      correctText:
        (question.payload as { correctAnswer?: boolean } | undefined)
          ?.correctAnswer === true
          ? "True"
          : "False",
      likelyMisconception:
        payload?.misconceptionNote?.trim() ||
        "The learner appears to hold the opposite truth condition for this concept.",
    };
  }

  if (question.questionType === "fitb") {
    const payload = question.payload as { distractors?: string[] } | undefined;
    const normalizedAnswer = normalizeText(studentAnswer);
    const matchedDistractor = (payload?.distractors ?? []).find(
      (option) => normalizeText(option) === normalizedAnswer,
    );

    if (!matchedDistractor) {
      return undefined;
    }

    return {
      selectedText: matchedDistractor,
      correctText: question.modelAnswer ?? "",
      likelyMisconception: `The learner produced a common distractor "${matchedDistractor}", suggesting confusion around ${question.focus || "the core definition in this item"}.`,
    };
  }

  return undefined;
}

function inferWhyWrong(
  question: QuestionBankQuestion,
  verdict: QuestionVerdict,
  distractor?: QuestionDistractorAnalysis,
): string | undefined {
  if (verdict === "correct") return undefined;
  if (verdict === "non_attempt") {
    return "The learner did not produce enough evidence on this item, so this looks more like a gap in access or confidence than a scored misconception.";
  }
  if (distractor) {
    return distractor.likelyMisconception;
  }
  if (question.focus) {
    return `The learner is not yet secure on ${question.focus.toLowerCase()}.`;
  }
  return "The learner's response shows that the target idea is not yet stable.";
}

function evaluateMatchingMap(
  studentAnswer: string,
  answerKey: Array<{ key: string; expected: string }>,
  label: string,
  rejectExtraPlacements = false,
): Pick<AskedQuestionRecord, "verdict" | "feedback"> {
  const studentMap = parseAnswerMap(studentAnswer);
  const attemptedCount = Object.keys(studentMap).length;
  if (attemptedCount === 0) {
    return { verdict: "non_attempt", feedback: "No attempt recorded." };
  }

  let correctCount = 0;
  for (const pair of answerKey) {
    if (
      normalizeText(studentMap[pair.key] ?? "") === normalizeText(pair.expected)
    ) {
      correctCount += 1;
    }
  }

  const expectedKeys = new Set(answerKey.map((pair) => pair.key));
  const expectedTargets = new Set(
    answerKey.map((pair) => normalizeText(pair.expected)),
  );
  const extraPlacementCount = rejectExtraPlacements
    ? Object.entries(studentMap).filter(
        ([key, target]) =>
          !expectedKeys.has(key) && expectedTargets.has(normalizeText(target)),
      ).length
    : 0;

  const verdict =
    correctCount === answerKey.length && extraPlacementCount === 0
      ? "correct"
      : correctCount > 0 || extraPlacementCount > 0
        ? "partial"
        : "incorrect";

  return {
    verdict,
    feedback: `${label}: ${correctCount}/${answerKey.length} correct.`,
  };
}

function evaluateQuestion(
  question: QuestionBankQuestion,
  studentAnswer: string,
): Pick<AskedQuestionRecord, "verdict" | "feedback"> {
  if (isNonAttemptAnswer(studentAnswer)) {
    return { verdict: "non_attempt", feedback: "No attempt recorded." };
  }

  if (question.questionType === "mcq") {
    const verdict =
      normalizeChoice(studentAnswer) ===
      normalizeChoice(question.correctAnswer ?? "")
        ? "correct"
        : "incorrect";

    const correctOption =
      question.options?.find(
        (_option, index) =>
          ["A", "B", "C", "D"][index] ===
          normalizeChoice(question.correctAnswer ?? ""),
      ) ??
      question.correctAnswer ??
      "";

    return {
      verdict,
      feedback: feedbackFromVerdict(
        verdict,
        correctOption,
        question.explanation,
      ),
    };
  }

  if (question.questionType === "true_false") {
    const expectedTrue =
      (question.payload as { correctAnswer?: boolean } | undefined)
        ?.correctAnswer === true;
    const normalized = normalizeText(studentAnswer);
    const isTrue = normalized === "true";
    const verdict = isTrue === expectedTrue ? "correct" : "incorrect";
    const correctValue = expectedTrue ? "True" : "False";
    return {
      verdict,
      feedback: feedbackFromVerdict(
        verdict,
        correctValue,
        question.explanation,
      ),
    };
  }

  if (question.questionType === "fitb") {
    const expected = normalizeText(question.modelAnswer ?? "");
    const actual = normalizeText(studentAnswer);
    const verdict =
      actual === expected ||
      actual.includes(expected) ||
      expected.includes(actual)
        ? "correct"
        : overlapRatio(actual, expected) >= 0.6
          ? "partial"
          : "incorrect";

    return {
      verdict,
      feedback: feedbackFromVerdict(
        verdict,
        question.modelAnswer ?? "",
        question.explanation,
      ),
    };
  }

  if (question.questionType === "matching") {
    const payload = question.payload as MatchingQuestionPayload | undefined;
    const answerKey = (payload?.answerKey ?? []).map((pair) => ({
      key: pair.prompt,
      expected: pair.match,
    }));
    return evaluateMatchingMap(studentAnswer, answerKey, "Matching score");
  }

  if (question.questionType === "drag_drop") {
    const payload = question.payload as DragDropQuestionPayload | undefined;
    const answerKey = (payload?.answerKey ?? []).map((pair) => ({
      key: pair.item ?? pair.prompt ?? "",
      expected: pair.target ?? pair.match ?? "",
    }));
    return evaluateMatchingMap(
      studentAnswer,
      answerKey,
      "Placement score",
      true,
    );
  }

  const expected =
    question.modelAnswer ??
    (
      question.payload as
        | { finalAnswer?: string; exemplarAnswer?: string }
        | undefined
    )?.finalAnswer ??
    (question.payload as { exemplarAnswer?: string } | undefined)
      ?.exemplarAnswer ??
    "";
  const score = overlapRatio(studentAnswer, expected);
  const verdict =
    score >= 0.85
      ? "correct"
      : score >= 0.45 ||
          normalizeText(studentAnswer).includes(normalizeText(expected))
        ? "partial"
        : "incorrect";

  return {
    verdict,
    feedback: feedbackFromVerdict(verdict, expected, question.explanation),
  };
}

function isFastGuessResponse(
  response: DiagnosticQuestionResponse,
  verdict: QuestionVerdict,
) {
  if (verdict === "correct" || verdict === "non_attempt") return false;
  const allocatedTimeMs = response.allocatedTimeMs ?? 0;
  const timeTakenMs = response.timeTakenMs ?? 0;
  if (allocatedTimeMs <= 0 || timeTakenMs <= 0) return false;
  return timeTakenMs <= Math.min(5000, allocatedTimeMs * 0.2);
}

function isLongStruggleResponse(
  response: DiagnosticQuestionResponse,
  verdict: QuestionVerdict,
) {
  if (verdict === "correct" || verdict === "non_attempt") return false;
  const allocatedTimeMs = response.allocatedTimeMs ?? 0;
  const timeTakenMs = response.timeTakenMs ?? 0;
  if (allocatedTimeMs <= 0 || timeTakenMs <= 0) return false;
  return timeTakenMs >= allocatedTimeMs * 0.75;
}

function deriveBehavioralSignals(
  response: DiagnosticQuestionResponse,
  verdict: QuestionVerdict,
): string[] {
  const signals: string[] = [];

  if (response.wasAutoSkipped) {
    signals.push("Timed out before submitting an answer.");
  } else if (verdict === "non_attempt") {
    signals.push("Skipped without attempting the question.");
  }

  if (isFastGuessResponse(response, verdict)) {
    signals.push(
      "Answered very quickly and incorrectly, suggesting a fast guess or low-effort response.",
    );
  }

  if (isLongStruggleResponse(response, verdict)) {
    signals.push(
      "Spent most of the available time but still answered incorrectly, suggesting confusion or overload.",
    );
  }

  return signals;
}

function attemptedRecords(
  records: AskedQuestionRecord[],
): AskedQuestionRecord[] {
  return records.filter((record) => record.verdict !== "non_attempt");
}

function averageScore(
  records: AskedQuestionRecord[],
  excludeNonAttempts = false,
): number {
  const scoredRecords = excludeNonAttempts
    ? attemptedRecords(records)
    : records;
  if (scoredRecords.length === 0) return 0;
  const total = scoredRecords.reduce(
    (sum, record) => sum + scoreRecord(record),
    0,
  );
  return total / scoredRecords.length;
}

function countNonAttempts(records: AskedQuestionRecord[]): number {
  return records.filter((record) => record.verdict === "non_attempt").length;
}

function deriveMasteryState(records: AskedQuestionRecord[]): MasteryState {
  if (records.length === 0 || attemptedRecords(records).length === 0) {
    return "not_started";
  }

  const attemptedScore = averageScore(records, true);
  const highestBloom = highestReachedBloom(records);

  if (
    attemptedScore >= 0.9 &&
    highestBloom === "apply" &&
    attemptedRecords(records).length >= 3
  ) {
    return "advanced";
  }
  if (attemptedScore >= 0.75) {
    return "secure";
  }
  if (attemptedScore >= 0.45) {
    return "developing";
  }
  return "emerging";
}

function buildReliabilityCheck(
  records: AskedQuestionRecord[],
): ReliabilityCheck {
  const attempted = attemptedRecords(records);
  const bloomCoverage = new Set(
    records
      .filter((record) => record.verdict !== "non_attempt")
      .map((record) => record.question.bloomLevel),
  ).size;
  const questionTypeCoverage = new Set(
    records.map((record) => record.question.questionType),
  ).size;
  const reasons: string[] = [];

  if (records.length < 2) {
    reasons.push(
      "Very limited evidence was collected for this learning objective.",
    );
  }
  if (attempted.length === 0) {
    reasons.push("All observed items were non-attempts.");
  }
  if (bloomCoverage <= 1) {
    reasons.push("Evidence comes from a narrow Bloom level range.");
  }
  if (questionTypeCoverage <= 1) {
    reasons.push("Evidence comes from only one question format.");
  }

  let confidenceScore = 0.35;
  confidenceScore += Math.min(records.length, 4) * 0.12;
  confidenceScore += Math.min(bloomCoverage, 3) * 0.08;
  confidenceScore += Math.min(questionTypeCoverage, 2) * 0.05;
  confidenceScore -= attempted.length === 0 ? 0.2 : 0;
  confidenceScore = Math.max(0.05, Math.min(0.98, confidenceScore));

  let band: ReliabilityCheck["band"] = "low";
  if (confidenceScore >= 0.8) {
    band = "high";
  } else if (confidenceScore >= 0.55) {
    band = "medium";
  }

  if (reasons.length === 0) {
    reasons.push(
      "Evidence is broad enough to support a stable diagnostic call.",
    );
  }

  return {
    band,
    confidenceScore: Math.round(confidenceScore * 100),
    evidenceCount: records.length,
    reasons,
    statusLocked: band !== "low",
  };
}

function highestReachedBloom(
  records: AskedQuestionRecord[],
): BloomLevel | "not_attempted" {
  const attempted = attemptedRecords(records);
  for (const bloomLevel of ["apply", "understand", "remember"] as const) {
    const bloomRecords = attempted.filter(
      (record) => record.question.bloomLevel === bloomLevel,
    );
    if (bloomRecords.length > 0 && averageScore(bloomRecords, true) >= 0.5) {
      return bloomLevel;
    }
  }
  return attempted.length > 0 ? "remember" : "not_attempted";
}

function deriveTopicStatus(records: AskedQuestionRecord[]): TopicMasteryStatus {
  if (records.length === 0) return "needs_teaching";
  const attempted = attemptedRecords(records);
  if (attempted.length === 0) return "needs_teaching";

  const weightedPossible = attempted.reduce(
    (sum, record) => sum + BLOOM_WEIGHTS[record.question.bloomLevel],
    0,
  );
  const weightedEarned = attempted.reduce(
    (sum, record) =>
      sum + scoreRecord(record) * BLOOM_WEIGHTS[record.question.bloomLevel],
    0,
  );
  const ratio = weightedPossible === 0 ? 0 : weightedEarned / weightedPossible;

  if (ratio >= 0.85) return "mastered";
  if (ratio >= 0.65) return "developing";
  if (ratio >= 0.4) return "partial";
  return "needs_teaching";
}

function buildTopicResult(
  topic: string,
  results: AskedQuestionRecord[],
): TopicResult {
  const status = deriveTopicStatus(results);
  return {
    topic,
    status,
    highestBloomReached: highestReachedBloom(results),
    color: colorForStatus(status),
    questionsAsked: results.length,
  };
}

function deriveBloomTestStatus(
  records: AskedQuestionRecord[],
): SubtopicBloomStatus["status"] {
  if (records.length === 0) return "not_tested";
  const attemptedScore = Math.round(averageScore(records, true) * 100);
  if (attemptedScore === 0) return "tested_failed";
  if (attemptedScore < 60) return "tested_partial";
  return "tested_mastered";
}

function computeBloomResults(results: AskedQuestionRecord[]): BloomResult[] {
  return (["remember", "understand", "apply"] as const).map((bloomLevel) => {
    const bloomRecords = results.filter(
      (record) => record.question.bloomLevel === bloomLevel,
    );
    const questionTypes = Array.from(
      new Set(bloomRecords.map((record) => record.question.questionType)),
    );
    return {
      bloomLevel,
      questionType: questionTypes.length === 1 ? questionTypes[0] : "mixed",
      questionsAsked: bloomRecords.length,
      attemptedCount: attemptedRecords(bloomRecords).length,
      nonAttemptCount: countNonAttempts(bloomRecords),
      correctCount: bloomRecords.filter(
        (record) => record.verdict === "correct",
      ).length,
      partialCount: bloomRecords.filter(
        (record) => record.verdict === "partial",
      ).length,
      incorrectCount: bloomRecords.filter(
        (record) => record.verdict === "incorrect",
      ).length,
      score: Math.round(averageScore(bloomRecords, true) * 100),
      overallScore: Math.round(averageScore(bloomRecords, false) * 100),
    };
  });
}

function computeSubtopicBloomStatuses(
  records: AskedQuestionRecord[],
): SubtopicBloomStatus[] {
  return (["remember", "understand", "apply"] as const).map((bloomLevel) => {
    const bloomRecords = records.filter(
      (record) => record.question.bloomLevel === bloomLevel,
    );
    const questionTypes = Array.from(
      new Set(bloomRecords.map((record) => record.question.questionType)),
    );

    return {
      bloomLevel,
      questionType: questionTypes.length === 1 ? questionTypes[0] : "mixed",
      status: deriveBloomTestStatus(bloomRecords),
      questionsAsked: bloomRecords.length,
      attemptedCount: attemptedRecords(bloomRecords).length,
      nonAttemptCount: countNonAttempts(bloomRecords),
      attemptedScore: Math.round(averageScore(bloomRecords, true) * 100),
      overallScore: Math.round(averageScore(bloomRecords, false) * 100),
    };
  });
}

function computeSubtopicResults(
  results: AskedQuestionRecord[],
): SubtopicResult[] {
  const subtopics = Array.from(
    new Set(results.map((record) => record.question.subtopic).filter(Boolean)),
  ) as string[];

  return subtopics.map((subtopic) => {
    const subtopicRecords = results.filter(
      (record) => record.question.subtopic === subtopic,
    );
    return {
      subtopic,
      status: deriveTopicStatus(subtopicRecords),
      highestBloomReached: highestReachedBloom(subtopicRecords),
      questionsAsked: subtopicRecords.length,
      attemptedCount: attemptedRecords(subtopicRecords).length,
      nonAttemptCount: countNonAttempts(subtopicRecords),
      correctCount: subtopicRecords.filter(
        (record) => record.verdict === "correct",
      ).length,
      partialCount: subtopicRecords.filter(
        (record) => record.verdict === "partial",
      ).length,
      incorrectCount: subtopicRecords.filter(
        (record) => record.verdict === "incorrect",
      ).length,
      score: Math.round(averageScore(subtopicRecords, true) * 100),
      overallScore: Math.round(averageScore(subtopicRecords, false) * 100),
      bloomStatuses: computeSubtopicBloomStatuses(subtopicRecords),
    };
  });
}

function summarizeRecordIssue(record: AskedQuestionRecord): string {
  if (record.verdict === "non_attempt") {
    return "Student was unable to attempt the item independently.";
  }

  if (record.whyWrong) {
    return record.whyWrong;
  }

  const questionText = record.question.question.toLowerCase();
  const explanation = record.question.explanation.toLowerCase();

  if (
    questionText.includes("bodmas") ||
    questionText.includes("order of operations")
  ) {
    return "Student is not applying the correct order of operations consistently.";
  }
  if (questionText.includes("estimate") || questionText.includes("round")) {
    return "Student is not using rounding and estimation to check reasonableness.";
  }
  if (questionText.includes("mental") || questionText.includes("efficient")) {
    return "Student is not choosing efficient mental calculation strategies.";
  }
  if (
    questionText.includes("divide") ||
    questionText.includes("multiply") ||
    questionText.includes("subtract") ||
    questionText.includes("add") ||
    explanation.includes("place value")
  ) {
    return "Student is making operation or place-value errors while solving multi-step calculations.";
  }
  if (
    record.question.questionType === "matching" ||
    record.question.questionType === "drag_drop"
  ) {
    return "Student is struggling to connect procedures with the correct result.";
  }
  if (record.verdict === "partial") {
    return "Student has some idea of the concept but cannot apply it accurately yet.";
  }

  return "Student's answer shows incomplete understanding of this learning objective.";
}

function deriveLikelyIssues(records: AskedQuestionRecord[]): string[] {
  const issueCounts = new Map<string, number>();

  for (const record of records) {
    if (record.verdict === "correct") continue;
    const issue = summarizeRecordIssue(record);
    issueCounts.set(issue, (issueCounts.get(issue) ?? 0) + 1);
    for (const signal of record.behavioralSignals ?? []) {
      issueCounts.set(signal, (issueCounts.get(signal) ?? 0) + 1);
    }
  }

  return Array.from(issueCounts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([issue]) => issue);
}

function deriveDistractorPatterns(records: AskedQuestionRecord[]): string[] {
  const patternCounts = new Map<string, number>();

  for (const record of records) {
    const misconception = record.distractorAnalysis?.likelyMisconception;
    if (!misconception) continue;
    patternCounts.set(
      misconception,
      (patternCounts.get(misconception) ?? 0) + 1,
    );
  }

  return Array.from(patternCounts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([pattern]) => pattern);
}

function deriveTeacherFocus(
  learningObjective: string,
  records: AskedQuestionRecord[],
): string[] {
  const lowerObjective = learningObjective.toLowerCase();
  const focus: string[] = [];

  if (
    lowerObjective.includes("bodmas") ||
    lowerObjective.includes("order of operations")
  ) {
    focus.push(
      "Re-teach the order of operations with worked examples that separate brackets, exponents, multiplication/division, and addition/subtraction.",
    );
    focus.push(
      "Ask the student to explain each step aloud before calculating.",
    );
  }
  if (lowerObjective.includes("round") || lowerObjective.includes("estimate")) {
    focus.push(
      "Model how to round numbers first and use estimation to judge whether an answer is reasonable.",
    );
  }
  if (
    lowerObjective.includes("mental") ||
    lowerObjective.includes("efficient")
  ) {
    focus.push(
      "Teach explicit mental strategies such as decomposing numbers, compensation, and using known facts.",
    );
  }
  if (
    lowerObjective.includes("operations") ||
    lowerObjective.includes("multiply") ||
    lowerObjective.includes("divide") ||
    lowerObjective.includes("add") ||
    lowerObjective.includes("subtract")
  ) {
    focus.push(
      "Check whether the student is aligning place value correctly and choosing the right operation before computing.",
    );
  }

  const hasNonAttempt = records.some(
    (record) => record.verdict === "non_attempt",
  );
  const hasFastGuess = records.some((record) =>
    (record.behavioralSignals ?? []).some((signal) =>
      signal.includes("very quickly"),
    ),
  );
  const hasLongStruggle = records.some((record) =>
    (record.behavioralSignals ?? []).some((signal) =>
      signal.includes("most of the available time"),
    ),
  );
  if (hasNonAttempt) {
    focus.push(
      "Start with one guided example and one scaffolded practice item before expecting independent work.",
    );
  }
  if (hasFastGuess) {
    focus.push(
      "Slow the student down: require them to explain the operation or strategy before selecting an answer.",
    );
  }
  if (hasLongStruggle) {
    focus.push(
      "Reduce cognitive load with smaller worked steps, then rebuild to full problems once accuracy improves.",
    );
  }

  if (focus.length === 0) {
    focus.push(
      "Review the underlying concept with concrete examples, then move to short guided practice before independent questions.",
    );
  }

  return Array.from(new Set(focus)).slice(0, 3);
}

function buildObjectiveNextSteps(
  masteryState: MasteryState,
  likelyIssues: string[],
  teacherFocus: string[],
  reliabilityCheck: ReliabilityCheck,
): string[] {
  const steps: string[] = [];

  if (masteryState === "not_started" || masteryState === "emerging") {
    steps.push(
      "Re-teach this objective with one fully worked example before independent practice.",
    );
    steps.push(
      "Use 2-3 scaffolded questions at easy level to rebuild accuracy and confidence.",
    );
  } else if (masteryState === "developing") {
    steps.push(
      "Give mixed easy-medium practice so the learner can stabilize the concept across formats.",
    );
    steps.push(
      "Add one verbal check where the learner explains why the method works before solving.",
    );
  } else if (masteryState === "secure") {
    steps.push(
      "Move to medium-hard transfer questions to confirm the skill holds under slightly higher complexity.",
    );
  } else {
    steps.push(
      "Skip routine reteaching and offer enrichment or challenge tasks on this objective.",
    );
  }

  if (likelyIssues[0]) {
    steps.push(
      `Address this first observed issue explicitly: ${likelyIssues[0]}`,
    );
  }

  if (teacherFocus[0]) {
    steps.push(teacherFocus[0]);
  }

  if (reliabilityCheck.band === "low") {
    steps.push(
      "Do not make a hard mastery call yet; collect at least one more question in a different format or Bloom level.",
    );
  }

  return Array.from(new Set(steps)).slice(0, 4);
}

function formatStudentName(studentId: string) {
  const normalized = studentId.trim();
  return normalized.length > 0 ? normalized : "The student";
}

function stripStudentsCanPrefix(learningObjective: string) {
  return learningObjective.replace(/^Students can\s+/i, "").trim();
}

function personalizeNarrative(text: string, studentName: string) {
  return text
    .replace(/\bThe learner's\b/g, `${studentName}'s`)
    .replace(/\bThe learner\b/g, studentName)
    .replace(/\bThe student\b/g, studentName)
    .replace(/\bStudent\b/g, studentName);
}

function buildStudentFriendlySummary(
  studentName: string,
  topic: string,
  attemptedScore: number,
  masteredObjectives: number,
  learningObjectiveCount: number,
  correctCount: number,
  resultsCount: number,
  weakObjectives: number,
) {
  if (attemptedScore >= 90) {
    return `${studentName}, amazing work on ${topic}! You showed strong confidence across almost every skill and got ${correctCount} out of ${resultsCount} questions right. Keep going with challenge questions to stretch your thinking.`;
  }

  if (attemptedScore >= 70) {
    return `${studentName}, you did a strong job in ${topic}. You are already confident in ${masteredObjectives} out of ${learningObjectiveCount} key skills, and just a little more practice will help you feel even stronger.`;
  }

  if (attemptedScore >= 40) {
    return `${studentName}, you’ve made a solid start in ${topic}. You’re beginning to understand some of the ideas, and with a bit more guided practice you can turn this into a big win.`;
  }

  return `${studentName}, this topic is still new, and that’s okay. You’re at the start of your ${topic} journey, and with step-by-step practice you can build confidence in these skills.`;
}

function buildObjectiveDiagnosticSummary(
  studentId: string,
  learningObjective: string,
  records: AskedQuestionRecord[],
  likelyIssues: string[],
) {
  const studentName = formatStudentName(studentId);
  const shortObjective = stripStudentsCanPrefix(learningObjective);
  const incorrectOrPartial = records.filter(
    (record) => record.verdict !== "correct",
  );
  if (incorrectOrPartial.length === 0) {
    return `${studentName} is secure with ${shortObjective.toLowerCase()}.`;
  }

  const attemptedWeakness = incorrectOrPartial.length;
  const issueText =
    likelyIssues.length > 0
      ? likelyIssues[0]
      : "The student is not yet showing stable understanding.";

  return `Across ${attemptedWeakness} question${attemptedWeakness === 1 ? "" : "s"}, ${personalizeNarrative(issueText, studentName)}`;
}

function computeLearningObjectiveResults(
  studentId: string,
  results: AskedQuestionRecord[],
): LearningObjectiveResult[] {
  const learningObjectives = Array.from(
    new Set(
      results
        .map((record) => record.question.learningObjective)
        .filter(Boolean),
    ),
  ) as string[];

  return learningObjectives.map((learningObjective) => {
    const objectiveRecords = results.filter(
      (record) => record.question.learningObjective === learningObjective,
    );
    const likelyIssues = deriveLikelyIssues(objectiveRecords);
    const teacherFocus = deriveTeacherFocus(
      learningObjective,
      objectiveRecords,
    );
    const masteryState = deriveMasteryState(objectiveRecords);
    const reliabilityCheck = buildReliabilityCheck(objectiveRecords);
    const distractorPatterns = deriveDistractorPatterns(objectiveRecords);
    const nextSteps = buildObjectiveNextSteps(
      masteryState,
      likelyIssues,
      teacherFocus,
      reliabilityCheck,
    );
    const evidenceExamples = objectiveRecords
      .filter((record) => record.verdict !== "correct")
      .slice(0, 2)
      .map((record) => `${record.question.question} -> ${record.feedback}`);

    return {
      learningObjective,
      status: deriveTopicStatus(objectiveRecords),
      masteryState,
      highestBloomReached: highestReachedBloom(objectiveRecords),
      questionsAsked: objectiveRecords.length,
      attemptedCount: attemptedRecords(objectiveRecords).length,
      nonAttemptCount: countNonAttempts(objectiveRecords),
      correctCount: objectiveRecords.filter(
        (record) => record.verdict === "correct",
      ).length,
      partialCount: objectiveRecords.filter(
        (record) => record.verdict === "partial",
      ).length,
      incorrectCount: objectiveRecords.filter(
        (record) => record.verdict === "incorrect",
      ).length,
      score: Math.round(averageScore(objectiveRecords, true) * 100),
      overallScore: Math.round(averageScore(objectiveRecords, false) * 100),
      bloomStatuses: computeSubtopicBloomStatuses(objectiveRecords),
      diagnosticSummary: buildObjectiveDiagnosticSummary(
        studentId,
        learningObjective,
        objectiveRecords,
        likelyIssues,
      ),
      likelyIssues,
      teacherFocus,
      evidenceExamples,
      distractorPatterns,
      nextSteps,
      reliabilityCheck,
    };
  });
}

function buildReportDistractorInsights(
  results: AskedQuestionRecord[],
  learningObjectiveResults: LearningObjectiveResult[],
): ReportDistractorInsight[] {
  return learningObjectiveResults
    .flatMap((result) =>
      result.distractorPatterns.map((pattern) => ({
        learningObjective: result.learningObjective,
        count: results.filter(
          (record) =>
            record.question.learningObjective === result.learningObjective &&
            record.distractorAnalysis?.likelyMisconception === pattern,
        ).length,
        pattern,
      })),
    )
    .sort((left, right) => right.count - left.count)
    .slice(0, 5);
}

function buildReportNextSteps(
  learningObjectiveResults: LearningObjectiveResult[],
): string[] {
  const priorityOrder: Record<MasteryState, number> = {
    not_started: 0,
    emerging: 1,
    developing: 2,
    secure: 3,
    advanced: 4,
  };

  return [...learningObjectiveResults]
    .sort((left, right) => {
      const byMastery =
        priorityOrder[left.masteryState] - priorityOrder[right.masteryState];
      if (byMastery !== 0) return byMastery;
      return (
        left.reliabilityCheck.confidenceScore -
        right.reliabilityCheck.confidenceScore
      );
    })
    .flatMap((result) => result.nextSteps)
    .filter(Boolean)
    .filter((step, index, steps) => steps.indexOf(step) === index)
    .slice(0, 6);
}

function buildSummary(
  config: DiagnosticConfig,
  results: AskedQuestionRecord[],
  topicResult: TopicResult,
  learningObjectiveResults: LearningObjectiveResult[],
) {
  const correctCount = results.filter(
    (record) => record.verdict === "correct",
  ).length;
  const partialCount = results.filter(
    (record) => record.verdict === "partial",
  ).length;
  const nonAttemptCount = countNonAttempts(results);
  const attemptedScore = Math.round(averageScore(results, true) * 100);
  const masteredObjectives = learningObjectiveResults.filter(
    (result) => result.status === "mastered",
  ).length;
  const developingObjectives = learningObjectiveResults.filter(
    (result) => result.status === "developing" || result.status === "partial",
  ).length;
  const weakObjectives = learningObjectiveResults.filter(
    (result) =>
      result.status === "needs_teaching" || result.status === "likely_weak",
  ).length;
  const behavioralPatterns = Array.from(
    new Set(results.flatMap((record) => record.behavioralSignals ?? [])),
  );
  const lowReliabilityObjectives = learningObjectiveResults.filter(
    (result) => result.reliabilityCheck.band === "low",
  ).length;
  const studentName = formatStudentName(config.studentId);
  const lines = [
    buildStudentFriendlySummary(
      studentName,
      config.topic,
      attemptedScore,
      masteredObjectives,
      learningObjectiveResults.length,
      correctCount,
      results.length,
      weakObjectives,
    ),
  ];

  if (behavioralPatterns.length > 0) {
    lines.push(
      `${studentName} may do better by slowing down and thinking through each step carefully.`,
    );
  }
  if (lowReliabilityObjectives > 0) {
    lines.push(
      `A few skills need a little more practice before we can be fully sure they have clicked.`,
    );
  }
  if (weakObjectives > 0) {
    lines.push(
      `${studentName} should focus next on ${weakObjectives === 1 ? "one key skill" : `${weakObjectives} key skills`} that still need support.`,
    );
  }
  if (partialCount > 0 || nonAttemptCount > 0) {
    lines.push(
      `There were a few tricky questions here, but each one shows exactly where ${studentName} can grow next.`,
    );
  }

  return lines.join(" ");
}

async function askQuestion(
  config: DiagnosticConfig,
  question: QuestionBankQuestion,
  questionNumber: number,
) {
  return config.onQuestion(question, questionNumber, config.maxQuestions);
}

export async function runDiagnostic(
  config: DiagnosticConfig,
): Promise<DiagnosticReport> {
  const mode = config.testMode ?? "topic";
  const reportTopic =
    mode === "placement"
      ? "Placement Test"
      : mode === "grade"
        ? "Grade Test"
        : mode === "multi_topic"
          ? "Multi-topic Test"
          : mode === "recurring"
            ? "Recurring Test"
            : config.topic;
  let questionBank: {
    questions: QuestionBankQuestion[];
    expectedLearningObjectives: string[];
  };

  if (config.questionIds && config.questionIds.length > 0) {
    if (mode === "placement") {
      questionBank = await getPlacementQuestionsByIds({
        questionIds: config.questionIds,
        subject: config.subject,
        classLevel: config.classLevel,
      });
    } else {
      questionBank = await getQuizQuestionsByIds({
        questionIds: config.questionIds,
        subject: config.subject,
        classLevel: config.classLevel,
        topic: mode === "topic" ? config.topic : null,
      });
    }
  } else if (
    config.preloadedQuestions &&
    config.preloadedQuestions.length > 0
  ) {
    questionBank = {
      questions: config.preloadedQuestions,
      expectedLearningObjectives: Array.from(
        new Set(
          config.preloadedQuestions
            .map((q) => q.learningObjective)
            .filter(Boolean),
        ),
      ) as string[],
    };
  } else {
    questionBank =
      mode === "grade"
        ? await getGradeQuizQuestions({
            subject: config.subject,
            classLevel: config.classLevel,
            region: config.region,
          })
        : mode === "multi_topic"
          ? await getMultiTopicQuizQuestions({
              subject: config.subject,
              classLevel: config.classLevel,
              topics: config.topics ?? [],
              maxQuestions: config.maxQuestions,
              region: config.region,
            })
          : await getTopicQuizQuestions({
              subject: config.subject,
              classLevel: config.classLevel,
              topic: config.topic,
              maxQuestions: config.maxQuestions,
              region: config.region,
            });
  }

  if (questionBank.questions.length === 0) {
    throw new Error(
      `No quiz questions found for ${reportTopic || "this test"}.`,
    );
  }

  const results: AskedQuestionRecord[] = [];
  let totalQuestionsShown = 0;

  for (const question of questionBank.questions) {
    const response = await askQuestion(
      config,
      question,
      totalQuestionsShown + 1,
    );
    const evaluation = evaluateQuestion(question, response.answer);
    const distractorAnalysis = inferQuestionDistractor(
      question,
      response.answer,
    );
    const whyWrong = inferWhyWrong(
      question,
      evaluation.verdict,
      distractorAnalysis,
    );
    const behavioralSignals = deriveBehavioralSignals(
      response,
      evaluation.verdict,
    );
    results.push({
      question,
      studentAnswer: response.answer,
      verdict: evaluation.verdict,
      feedback: evaluation.feedback,
      timeTakenMs: response.timeTakenMs,
      allocatedTimeMs: response.allocatedTimeMs,
      wasAutoSkipped: response.wasAutoSkipped,
      behavioralSignals,
      whyWrong,
      distractorAnalysis,
    });
    totalQuestionsShown += 1;
  }

  const isMultiTopicReport = mode === "grade" || mode === "multi_topic";
  const topicResults = isMultiTopicReport
    ? Array.from(new Set(results.map((record) => record.question.topic)))
        .filter(Boolean)
        .map((topic) =>
          buildTopicResult(
            topic,
            results.filter((record) => record.question.topic === topic),
          ),
        )
    : [buildTopicResult(reportTopic, results)];
  const summaryTopicResult = isMultiTopicReport
    ? buildTopicResult(reportTopic, results)
    : topicResults[0];
  const learningObjectiveResults = computeLearningObjectiveResults(
    config.studentId,
    results,
  );
  const subtopicResults = computeSubtopicResults(results);
  const bloomResults = computeBloomResults(results);
  const attemptedReadinessScore = Math.round(averageScore(results, true) * 100);
  const overallReadinessScore = Math.round(averageScore(results, false) * 100);
  const lessonPlan = buildLessonPlan(topicResults);
  const behavioralPatterns = Array.from(
    new Set(results.flatMap((record) => record.behavioralSignals ?? [])),
  );
  const distractorInsights = buildReportDistractorInsights(
    results,
    learningObjectiveResults,
  );
  const nextSteps = buildReportNextSteps(learningObjectiveResults);

  return {
    studentId: config.studentId,
    mode,
    region: config.region,
    subject: config.subject,
    classLevel: config.classLevel,
    topic: reportTopic,
    expectedLearningObjectives: questionBank.expectedLearningObjectives,
    totalQuestionsShown,
    maxQuestions: config.maxQuestions,
    questionBankSize: questionBank.questions.length,
    results,
    topicResults,
    learningObjectiveResults,
    subtopicResults,
    bloomResults,
    lessonPlan,
    readinessScore: attemptedReadinessScore,
    attemptedReadinessScore,
    overallReadinessScore,
    nonAttemptCount: countNonAttempts(results),
    engagementGaps: subtopicResults
      .filter(
        (result) => result.attemptedCount === 0 && result.nonAttemptCount > 0,
      )
      .map((result) => result.subtopic),
    behavioralPatterns,
    distractorInsights,
    nextSteps,
    aiSummary: buildSummary(
      { ...config, topic: reportTopic },
      results,
      summaryTopicResult,
      learningObjectiveResults,
    ),
    stoppedBecause:
      totalQuestionsShown >= config.maxQuestions
        ? "maxQuestions"
        : "noEligibleQuestions",
  };
}

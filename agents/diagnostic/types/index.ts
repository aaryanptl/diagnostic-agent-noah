export type Subject =
  | "Maths"
  | "Science"
  | "English"
  | "Social Studies"
  | "Python"
  | "WebDev"
  | "coding-python"
  | "coding-webdev";


export type ClassLevel =
  | "classKG"
  | "class1"
  | "class2"
  | "class3"
  | "class4"
  | "class5"
  | "class6"
  | "class7"
  | "class8";
export type TestMode =
  | "topic"
  | "multi_topic"
  | "grade"
  | "recurring"
  | "placement";
export type DiagnosticRegion = "US" | "UK" | "UAE" | "Ontario" | "Australia";

export type BloomLevel = "remember" | "understand" | "apply";
export type ReachedBloomLevel = BloomLevel | "not_attempted";
export type WordProblemStyle = "numerical" | "scenario";
export type DifficultyBand = "easy" | "medium" | "hard";
export type QuestionType =
  | "mcq"
  | "true_false"
  | "fitb"
  | "matching"
  | "drag_drop"
  | "short_answer"
  | "word_problem"
  | "open_response";
export type QuestionVerdict =
  | "correct"
  | "partial"
  | "incorrect"
  | "non_attempt";
export type TopicMasteryStatus =
  | "mastered"
  | "developing"
  | "partial"
  | "needs_teaching"
  | "likely_weak";
export type MasteryState =
  | "not_started"
  | "emerging"
  | "developing"
  | "secure"
  | "advanced";
export type TopicColor = "green" | "yellow" | "orange" | "red";
export type BloomTestStatus =
  | "not_tested"
  | "tested_failed"
  | "tested_partial"
  | "tested_mastered";
export type ReliabilityBand = "low" | "medium" | "high";

export interface McqOption {
  text: string;
  correct: boolean;
  svg?: string;
}

export interface MatchingPair {
  prompt: string;
  match: string;
}

export interface DragDropPair {
  item: string;
  target: string;
  prompt?: string;
  match?: string;
}

export interface McqQuestionPayload {
  options: McqOption[];
  explanation?: string;
}

export interface TrueFalseQuestionPayload {
  correctAnswer: boolean;
  explanation?: string;
  misconceptionNote?: string;
}

export interface FitbQuestionPayload {
  answer: string;
  distractors?: string[];
  hint?: string;
}

export interface MatchingQuestionPayload {
  premises: string[];
  responses: string[];
  answerKey: MatchingPair[];
  scoringGuidance?: string;
}

export interface DragDropQuestionPayload {
  draggableItems: string[];
  dropZones: string[];
  answerKey: DragDropPair[];
  scoringGuidance?: string;
}

export interface ShortAnswerQuestionPayload {
  modelAnswer: string;
  scoringGuidance?: string;
  expectedResponseLength?: string;
}

export interface OpenResponseQuestionPayload {
  exemplarAnswer: string;
  rubric?: unknown;
  scoringGuidance?: string;
}

export interface WordProblemQuestionPayload {
  scenario?: string;
  solutionSteps?: string[];
  finalAnswer: string;
  hints?: string[];
  requiresCalculation?: boolean;
  scoringGuidance?: string;
}

export type QuestionPayload = (
  | McqQuestionPayload
  | TrueFalseQuestionPayload
  | FitbQuestionPayload
  | MatchingQuestionPayload
  | DragDropQuestionPayload
  | ShortAnswerQuestionPayload
  | OpenResponseQuestionPayload
  | WordProblemQuestionPayload
) & {
  questionSvg?: string;
};

export interface QuestionBankQuestion {
  id: string;
  subject?: Subject;
  slot?: number;
  topic: string;
  subtopic?: string;
  learningObjective?: string;
  section?: string;
  difficultyLevel?: string;
  difficultyRating?: number;
  classLevel: ClassLevel;
  bloomLevel: BloomLevel;
  questionType: QuestionType;
  question: string;
  options?: string[];
  correctAnswer?: string;
  modelAnswer?: string;
  minimumCorrect?: string;
  expectedUnit?: string;
  wordProblemStyle?: WordProblemStyle;
  explanation: string;
  focus?: string;
  keywords: string[];
  gradeLevel?: string;
  region?: DiagnosticRegion | "global";
  parentId?: string | null;
  payload?: QuestionPayload;
}

export interface QuestionDistractorAnalysis {
  selectedLabel?: string;
  selectedText?: string;
  correctLabel?: string;
  correctText?: string;
  likelyMisconception: string;
}

export interface ReliabilityCheck {
  band: ReliabilityBand;
  confidenceScore: number;
  evidenceCount: number;
  reasons: string[];
  statusLocked: boolean;
}

export interface QuestionBank {
  subject: Subject;
  classLevel: ClassLevel;
  topic?: string;
  learningObjective?: string;
  section?: string;
  questions: QuestionBankQuestion[];
  coverageWarnings?: string[];
}

export interface AskedQuestionRecord {
  question: QuestionBankQuestion;
  studentAnswer: string;
  verdict: QuestionVerdict;
  feedback: string;
  timeTakenMs?: number;
  allocatedTimeMs?: number;
  wasAutoSkipped?: boolean;
  behavioralSignals?: string[];
  whyWrong?: string;
  distractorAnalysis?: QuestionDistractorAnalysis;
}

export interface DiagnosticQuestionResponse {
  answer: string;
  timeTakenMs?: number;
  allocatedTimeMs?: number;
  wasAutoSkipped?: boolean;
}

export interface TopicResult {
  topic: string;
  status: TopicMasteryStatus;
  highestBloomReached: ReachedBloomLevel;
  color: TopicColor;
  questionsAsked: number;
  skippedDueTo?: string;
}

export interface LearningObjectiveResult {
  learningObjective: string;
  status: TopicMasteryStatus;
  masteryState: MasteryState;
  highestBloomReached: ReachedBloomLevel;
  questionsAsked: number;
  attemptedCount: number;
  nonAttemptCount: number;
  correctCount: number;
  partialCount: number;
  incorrectCount: number;
  score: number;
  overallScore: number;
  bloomStatuses: SubtopicBloomStatus[];
  diagnosticSummary: string;
  likelyIssues: string[];
  teacherFocus: string[];
  evidenceExamples: string[];
  distractorPatterns: string[];
  nextSteps: string[];
  reliabilityCheck: ReliabilityCheck;
}

export interface BloomResult {
  bloomLevel: BloomLevel;
  questionType: QuestionType | "mixed";
  questionsAsked: number;
  attemptedCount: number;
  nonAttemptCount: number;
  correctCount: number;
  partialCount: number;
  incorrectCount: number;
  score: number;
  overallScore: number;
}

export interface SubtopicResult {
  subtopic: string;
  status: TopicMasteryStatus;
  highestBloomReached: ReachedBloomLevel;
  questionsAsked: number;
  attemptedCount: number;
  nonAttemptCount: number;
  correctCount: number;
  partialCount: number;
  incorrectCount: number;
  score: number;
  overallScore: number;
  bloomStatuses: SubtopicBloomStatus[];
}

export interface SubtopicBloomStatus {
  bloomLevel: BloomLevel;
  questionType: QuestionType | "mixed";
  status: BloomTestStatus;
  questionsAsked: number;
  attemptedCount: number;
  nonAttemptCount: number;
  attemptedScore: number;
  overallScore: number;
}

export interface LessonPlanGroup {
  teachFirst: string[];
  reinforceSoon: string[];
  reinforceDeeply: string[];
  enrichOrSkip: string[];
}

export interface ReportDistractorInsight {
  learningObjective: string;
  count: number;
  pattern: string;
}

export interface LearningObjectiveNarrative {
  learningObjective: string;
  feedback: string;
}

export interface QuestionReviewNarrative {
  questionId: string;
  note: string;
}

export interface ResultNarrative {
  heroGreeting: string;
  heroSubtitle: string;
  mainSummary: string;
  whatWentWell: string;
  whatNeedsPractice: string;
  practiceSteps: string[];
  learningObjectiveFeedback: LearningObjectiveNarrative[];
  questionReviewNotes: QuestionReviewNarrative[];
  parentNotes: string[];
}

export interface PlacementFocusArea {
  topic: string;
  learningObjective: string;
  recommendation:
    | "needs_lecture"
    | "high_practice"
    | "light_practice"
    | "on_track";
  reason: string;
}

export interface PlacementPlanInsights {
  bandName: string;
  nextBandName: string;
  placementSummary: string;
  nextGoal: string;
  planSummary: string;
  generalFeedback?: string;
  focusAreas?: PlacementFocusArea[];
  consolidatedInsights?: string;
  actionPlanSteps?: string[];
}

export interface ProgressComparison {
  previousAssessmentId: string;
  previousSubmittedAt: string;
  previousCorrectCount: number;
  previousTotalQuestions: number;
  currentCorrectCount: number;
  currentTotalQuestions: number;
  correctDelta: number;
  topic: string;
  improvedLearningObjective?: string;
}

export interface ShortAnswerSubmission {
  id: string;
  topic: string;
  subtopic?: string;
  bloomLevel: BloomLevel;
  questionType: "short_answer" | "word_problem";
  question: string;
  studentAnswer: string;
  modelAnswer: string;
  minimumCorrect: string;
  expectedUnit?: string;
  wordProblemStyle?: WordProblemStyle;
  keywords: string[];
}

export interface ShortAnswerEvaluation {
  id: string;
  verdict: QuestionVerdict;
  feedback: string;
}

export interface BatchEvaluationResult {
  evaluations: ShortAnswerEvaluation[];
  summary: string;
}

export interface DiagnosticConfig {
  studentId: string;
  testMode?: TestMode;
  region?: DiagnosticRegion;
  subject: Subject;
  classLevel: ClassLevel;
  topic: string;
  topics?: string[];
  maxQuestions: number;
  questionIds?: string[];
  onQuestion: (
    question: QuestionBankQuestion,
    questionNumber: number,
    maxQuestions: number,
  ) => Promise<DiagnosticQuestionResponse>;
  preloadedQuestions?: QuestionBankQuestion[];
}

export interface DiagnosticReport {
  studentId: string;
  mode: "topic" | "multi_topic" | "grade" | "recurring" | "placement";
  region?: DiagnosticRegion;
  subject: Subject;
  classLevel: ClassLevel;
  topic: string;
  expectedLearningObjectives: string[];
  totalQuestionsShown: number;
  maxQuestions: number;
  questionBankSize: number;
  results: AskedQuestionRecord[];
  topicResults: TopicResult[];
  learningObjectiveResults: LearningObjectiveResult[];
  subtopicResults?: SubtopicResult[];
  bloomResults?: BloomResult[];
  lessonPlan: LessonPlanGroup;
  readinessScore: number;
  attemptedReadinessScore?: number;
  overallReadinessScore?: number;
  nonAttemptCount?: number;
  engagementGaps?: string[];
  behavioralPatterns?: string[];
  distractorInsights?: ReportDistractorInsight[];
  nextSteps?: string[];
  aiSummary: string;
  resultNarrative?: ResultNarrative;
  placementTopicInsights?: Array<{ topic: string; insights?: string[] }>;
  placementPlanInsights?: PlacementPlanInsights;
  progressComparison?: ProgressComparison;
  stoppedBecause: "maxQuestions" | "noEligibleQuestions";
}

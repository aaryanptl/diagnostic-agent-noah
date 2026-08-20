export type Priority = "high" | "medium" | "low"
export type EvidenceTone = "strong" | "steady" | "support"
export type PlanItemKind = "teaching" | "checkpoint" | "rdp" | "ptm"
/**
 * "skipped" is a class the plan no longer needs (a topic was compressed) but
 * that keeps its slot, so classes after it are not renumbered.
 */
export type PlanItemStatus = "completed" | "next" | "planned" | "skipped"
export type ClassOutcome = "faster" | "on-track" | "needs-time"

export interface LearningObjective {
  id: string
  subtopic: string
  text: string
}

export interface CurriculumTopic {
  id: number
  sequence: number
  name: string
  family: string
  priority: Priority
  prerequisiteIds: number[]
  idealClasses: number
  /**
   * Rule H1 compression floor: the fewest classes in which the topic can still
   * be taught soundly. No automatic rule (placement reduction, capacity
   * compression, post-class auto-update) may take a topic below this.
   */
  minimumClasses: number
  idealActivities: number
  easyPercent: number
  practicePercent: number
  reason: string
  learningObjectives: LearningObjective[]
}

export interface PlacementResult {
  topicId: number
  score: number
}

export interface CompletedTopic {
  topicId: number
  plannedClasses: number
  actualClasses: number
}

export interface ObjectiveEvidence {
  learningObjectiveId: string
  level: "starter" | "master"
  result: "secure" | "not-secure"
  note: string
}

/** Result of the supplied Starter or Master question set for one objective. */
export interface QuestionAttemptEvidence {
  topicId: number
  learningObjectiveId: string
  level: "starter" | "master"
  correct: number
  attempted: number
  note: string
}

export interface DemoStudent {
  id: string
  scenario: "A" | "B" | "C" | "D"
  name: string
  initials: string
  grade: number
  region: "US"
  classesRemaining: number
  /** Enrolled package shown on the student card, e.g. "Full year · 79 classes". */
  packageLabel?: string
  placementStatus: "completed" | "not-taken" | "not-applicable"
  placementResults: PlacementResult[]
  defaultPlacementScore?: number
  completedTopics: CompletedTopic[]
  currentTopicId?: number
  objectiveEvidence: ObjectiveEvidence[]
  questionAttemptEvidence?: QuestionAttemptEvidence[]
  parentRequestedTopicId?: number
  previousPlanLabel?: string
  /** Classes already taught in the student's active topic. */
  currentTopicClassesUsed?: number
  /** Rule I1: sizes the two-week plan window (classes per week × 2). Default 2. */
  classesPerWeek?: number
}

export interface AiTopicRecommendation {
  topicId: number
  decision: "include" | "skip" | "defer"
  evidence:
    | "placement"
    | "mastery"
    | "priority"
    | "current-progress"
    | "parent-request"
    | "capacity"
  reason: string
}

export interface AiPlanSuggestion {
  selectedTopicIds: number[]
  skippableTopicIds: number[]
  recommendations: AiTopicRecommendation[]
  evidenceSummary: string[]
}

export interface ManualTopicAdjustment {
  classes?: number
  activities?: number
  easyPercent?: number
}

export type ManualAdjustments = Record<number, ManualTopicAdjustment>

export interface PlanTopicAllocation {
  topicId: number
  topicName: string
  sequence: number
  priority: Priority
  classes: number
  idealClasses: number
  /** Rule H1 floor for this topic (0 for compressed prerequisite refreshers). */
  minimumClasses: number
  /** Classes removed by the Rule B2 capacity compression pass. */
  compressedByCapacity?: number
  /** True when Rule B2 compression has taken this topic down to its floor. */
  atMinimum?: boolean
  activities: number
  easyActivities: number
  practiceActivities: number
  easyPercent: number
  practicePercent: number
  /** Ordered for teaching: whatever the student is weakest on comes first. */
  learningObjectives: LearningObjective[]
  /**
   * Per-objective standing, in the same order as `learningObjectives`. Empty
   * when no objective in the topic has been measured.
   */
  objectiveFocus?: ObjectiveFocus[]
  reasons: string[]
  isCompressedRefresher: boolean
  manuallyEdited: boolean
}

/**
 * Where one learning objective stands for this student, and therefore how much
 * of the topic's class time it should get.
 *
 * This is the join between the mastery loop and the planner: the loop measures
 * objectives, and the planner teaches the weak ones first and gives them the
 * reinforcement classes.
 */
export type ObjectiveNeed = "needs-teaching" | "improving" | "secure" | "unmeasured"

export interface ObjectiveFocus {
  objectiveId: string
  need: ObjectiveNeed
  /** One line naming the evidence that put it in this state. */
  reason: string
}

/** One practice/question slot assigned to a class. */
export interface ClassActivity {
  id: string
  level: "starter" | "master"
  label: string
  objectiveId: string
  objectiveSubtopic: string
  objectiveText: string
  prompt: string
  round: number
}

/** AI (or fallback) teaching prose for a single class. */
export interface ClassTeachingContent {
  goal: string
  teachingPoints: string[]
  successCriteria: string
  practice: string
  /** When set, replaces the structural plan reason in the lesson guide. */
  rationale?: string
  source: "ai" | "fallback"
}

export interface PlanItem {
  id: string
  classNumber: number
  kind: PlanItemKind
  status: PlanItemStatus
  title: string
  subtitle: string
  topicId?: number
  topicName?: string
  priority?: Priority
  learningObjectives: LearningObjective[]
  easyActivities: number
  practiceActivities: number
  reason: string
  /** Expanded starter/master activity rows for this class. */
  activities?: ClassActivity[]
  /** Mentor-facing teaching guide prose (AI or fallback). */
  teachingContent?: ClassTeachingContent
}

export interface DroppedTopic {
  topicId: number
  topicName: string
  priority: Priority
  reason: string
}

export interface PlanWarning {
  id: string
  title: string
  message: string
  severity: "warning" | "attention"
}

export interface PlanCapacity {
  available: number
  teaching: number
  /** Checkpoint + RDP classes the builder places in the sequence. */
  structural: number
  /**
   * PTM classes reserved against the package but never placed by the builder —
   * ops schedules them on a fixed calendar. Counted in `total`, and the Rule F3
   * fit ladder cannot shed them.
   */
  opsReserve: number
  total: number
  difference: number
  /** Teaching classes removed by the Rule B2 compression pass. */
  compressedClasses: number
  /** Rule B3: spare classes reserved as "Revision / School Help" (10+ spare). */
  surplusClasses: number
}

export type ModificationType = "manual" | "class" | "auto"

export interface GeneratedPlan {
  id: string
  version: number
  studentId: string
  generatedAt: string
  lastModificationType: ModificationType
  allocations: PlanTopicAllocation[]
  items: PlanItem[]
  droppedTopics: DroppedTopic[]
  warnings: PlanWarning[]
  capacity: PlanCapacity
  explanations: string[]
  changesFromPrevious: string[]
}

export interface QuestionGuideline {
  topicId: number
  learningObjectiveId: string
  /**
   * Distinct prompts for this objective, easiest first.
   *
   * A bank rather than a single prompt: a class can carry several Starter slots
   * on one objective, and serving the same question three times told the
   * student nothing the first one had not. `buildClassActivities` walks the
   * bank so every slot in a class is a different question.
   */
  starters: string[]
  masters: string[]
}

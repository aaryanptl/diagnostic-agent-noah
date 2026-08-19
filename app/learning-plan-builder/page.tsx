"use client"

import {
  MethodologyView,
  methodologyContextForSetupStep,
} from "./methodology"
import type { MethodologyContext } from "./methodology"
import { MethodologySidebar } from "./methodology-sidebar"
import {
  buildClassActivities,
  groupActivitiesByObjective,
} from "@/lib/learning-plan/activities"
import {
  buildLearningPlan,
  getAiAssistedTopicSuggestion,
  getDefaultTopicOrder,
  getSuggestedTopicIds,
} from "@/lib/learning-plan/engine"
import type {
  ClassOutcome,
  ClassTeachingContent,
  CurriculumTopic,
  DemoStudent,
  GeneratedPlan,
  ManualAdjustments,
  ManualTopicAdjustment,
  PlanItem,
  Priority,
} from "@/lib/learning-plan/types"
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  BookOpenCheck,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Clock3,
  Edit3,
  Eye,
  HelpCircle,
  FastForward,
  FileText,
  Gauge,
  GraduationCap,
  GripVertical,
  Layers3,
  Lightbulb,
  ListChecks,
  LockKeyhole,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  UsersRound,
  X,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { getTopicsForGrade } from "./curriculum"
import { demoStudents, questionGuidelines, topicById } from "./data"
import "./learning-plan-builder.css"

const SETUP_STEPS = [
  { id: 1, label: "Student" },
  { id: 2, label: "Evidence" },
  { id: 3, label: "Topic scope" },
  { id: 4, label: "Review" },
]

const SCENARIO_COPY: Record<
  DemoStudent["scenario"],
  { eyebrow: string; title: string; description: string }
> = {
  A: {
    eyebrow: "Placement completed",
    title: "New student with evidence",
    description: "High and low placement scores adjust the first plan.",
  },
  B: {
    eyebrow: "No placement",
    title: "New student without a test",
    description:
      "Half-year package: topics compress toward their class minimums before any are dropped.",
  },
  C: {
    eyebrow: "Plan update",
    title: "Returning student",
    description: "Completed work and current evidence reshape the plan.",
  },
  D: {
    eyebrow: "Parent request",
    title: "Requested starting topic",
    description: "Prerequisite refreshers move before the requested topic.",
  },
}

const DEFAULT_EVIDENCE_STUDENT =
  demoStudents.find((candidate) => candidate.scenario === "C") ?? demoStudents[0]

const PRIORITY_COPY: Record<Priority, { label: string; description: string }> =
  {
    high: {
      label: "High",
      description: "Core Grade 5 outcome",
    },
    medium: {
      label: "Medium",
      description: "Added when capacity allows",
    },
    low: {
      label: "Low",
      description: "First to be dropped",
    },
  }

const KIND_COPY: Record<PlanItem["kind"], { label: string; short: string }> = {
  teaching: { label: "Teaching class", short: "Teaching" },
  checkpoint: { label: "Checkpoint assessment", short: "Checkpoint" },
  rdp: { label: "Revision, doubts & practice", short: "RDP" },
  ptm: { label: "Parent–teacher meeting", short: "PTM" },
}

interface TopicEditDraft {
  classes: number
  activities: number
  easyPercent: number
}

interface PendingPlanUpdate {
  plan: GeneratedPlan
  adjustments: ManualAdjustments
  changes: string[]
}

type PersistenceState = "idle" | "saving" | "saved" | "error"

/** Progress of the build-plan run; null once the finished plan is on screen. */
type BuildStage = null | "structure" | "saving" | "content"

const BUILD_STAGES: { id: Exclude<BuildStage, null>; label: string; detail: string }[] =
  [
    {
      id: "structure",
      label: "Applying the planning rules",
      detail: "Fitting topics, classes and activities into the package capacity.",
    },
    {
      id: "saving",
      label: "Saving the plan version",
      detail: "Recording this version so every later change is traceable.",
    },
    {
      id: "content",
      label: "Writing the teaching guides",
      detail: "Generating goals, teaching points and success criteria per class.",
    },
  ]

function plural(value: number, singular: string, multiple = `${singular}s`) {
  return `${value} ${value === 1 ? singular : multiple}`
}

function placementTone(score: number) {
  if (score >= 75) return "strong"
  if (score < 40) return "support"
  return "steady"
}

function placementLabel(score: number) {
  if (score >= 75) return "Strong"
  if (score < 40) return "Needs support"
  return "On track"
}

type MentorObjectiveLevel = "master" | "stuck" | "not_attempted"

function getMentorObjectiveLevel(
  objectiveId: string,
  student: DemoStudent,
  attempts: NonNullable<DemoStudent["questionAttemptEvidence"]>
): MentorObjectiveLevel {
  const objectiveEvidence = student.objectiveEvidence.filter(
    (evidence) => evidence.learningObjectiveId === objectiveId
  )
  if (objectiveEvidence.some((evidence) => evidence.level === "master" && evidence.result === "secure")) {
    return "master"
  }
  if (objectiveEvidence.some((evidence) => evidence.result === "not-secure")) {
    return "stuck"
  }

  const objectiveAttempts = attempts.filter(
    (attempt) => attempt.learningObjectiveId === objectiveId
  )
  if (objectiveAttempts.some((attempt) => attempt.level === "master" && attempt.correct / attempt.attempted >= 0.75)) {
    return "master"
  }
  if (objectiveAttempts.some((attempt) => attempt.correct / attempt.attempted < 0.5)) {
    return "stuck"
  }
  return "not_attempted"
}

function mentorLevelCopy(level: MentorObjectiveLevel) {
  if (level === "master") return "Master ✓"
  if (level === "stuck") return "Stuck after Starter"
  return "Not attempted"
}

function findNextTeachingItem(items: PlanItem[], completedCount: number) {
  return items.find(
    (item) =>
      item.classNumber > completedCount &&
      item.kind === "teaching" &&
      item.status !== "skipped"
  )
}

/** Skipped classes keep their slot but are not part of the live schedule. */
function isLiveClass(item: PlanItem) {
  return item.status !== "skipped"
}

/** Primary line for a plan row: curriculum topic name, not LO subtopic/family. */
function planItemPrimaryLabel(item: PlanItem) {
  if (item.kind === "teaching") {
    return item.topicName ?? item.title
  }
  return item.title
}

/** Secondary line: class focus (subtopic), structural type, activities. */
function planItemSecondaryLabel(item: PlanItem) {
  if (item.kind !== "teaching") {
    return item.subtitle || KIND_COPY[item.kind].short
  }

  const parts: string[] = []
  const focus = item.title
  const topic = item.topicName
  if (focus && focus !== topic) parts.push(focus)
  if (item.subtitle?.toLowerCase().includes("compressed")) {
    parts.push("compressed refresher")
  }
  parts.push(
    `${item.easyActivities + item.practiceActivities} act.`
  )
  return parts.join(" · ")
}

function getPrerequisiteChainLocal(
  topicId: number,
  topicMap: Map<number, CurriculumTopic>,
  visited = new Set<number>()
): number[] {
  if (visited.has(topicId)) return []
  visited.add(topicId)
  const topic = topicMap.get(topicId)
  if (!topic) return []

  const chain: number[] = []
  for (const prerequisiteId of topic.prerequisiteIds) {
    chain.push(
      ...getPrerequisiteChainLocal(prerequisiteId, topicMap, visited),
      prerequisiteId
    )
  }
  return [...new Set(chain)]
}

function sortTopicsForDisplay(
  topics: CurriculumTopic[],
  student: DemoStudent,
  topicOrder: number[]
) {
  const orderIndex = new Map(topicOrder.map((topicId, index) => [topicId, index]))
  const inMentorOrder = (items: CurriculumTopic[]) =>
    [...items].sort(
      (a, b) =>
        (orderIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
          (orderIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
        a.sequence - b.sequence
    )

  if (!student.parentRequestedTopicId) {
    return inMentorOrder(topics)
  }

  const requestedId = student.parentRequestedTopicId
  const topicMap = new Map(topics.map((t) => [t.id, t]))
  const prereqChain = getPrerequisiteChainLocal(requestedId, topicMap)
  const frontIds = new Set([...prereqChain, requestedId])

  const prereqTopics = prereqChain
    .map((id) => topicMap.get(id))
    .filter((t): t is CurriculumTopic => Boolean(t))
  const requestedTopic = topicMap.get(requestedId)
  const remainingTopics = inMentorOrder(
    topics.filter((t) => !frontIds.has(t.id))
  )

  return [
    ...prereqTopics,
    ...(requestedTopic ? [requestedTopic] : []),
    ...remainingTopics,
  ]
}

function describePlanChanges(
  previousPlan: GeneratedPlan,
  nextPlan: GeneratedPlan
) {
  const changes: string[] = []
  const previousByTopicId = new Map(
    previousPlan.allocations.map((allocation) => [allocation.topicId, allocation])
  )
  const nextByTopicId = new Map(
    nextPlan.allocations.map((allocation) => [allocation.topicId, allocation])
  )

  for (const allocation of nextPlan.allocations) {
    const previous = previousByTopicId.get(allocation.topicId)
    if (!previous) {
      changes.push(`${allocation.topicName} was added to the scheduled plan.`)
      continue
    }
    if (previous.classes !== allocation.classes) {
      changes.push(
        `${allocation.topicName}: ${previous.classes} → ${allocation.classes} classes.`
      )
    }
    if (previous.activities !== allocation.activities) {
      changes.push(
        `${allocation.topicName}: ${previous.activities} → ${allocation.activities} activities.`
      )
    }
  }

  for (const allocation of previousPlan.allocations) {
    if (!nextByTopicId.has(allocation.topicId)) {
      changes.push(`${allocation.topicName} was removed from the scheduled plan.`)
    }
  }

  if (previousPlan.capacity.total !== nextPlan.capacity.total) {
    changes.push(
      `Total planned capacity: ${previousPlan.capacity.total} → ${nextPlan.capacity.total} classes.`
    )
  }

  return changes
}

function mergePlanChanges(...groups: string[][]) {
  return [...new Set(groups.flat().filter(Boolean))]
}

/**
 * What a class *is*, ignoring where it sits in the schedule. Two classes with
 * the same identity teach the same thing, so a written guide stays valid.
 */
function classIdentity(item: PlanItem) {
  return [
    item.kind,
    item.topicId ?? "-",
    item.title,
    item.learningObjectives.map((objective) => objective.id).join("|"),
  ].join("::")
}

/** Identity plus the activity split — a guide is only reusable if this matches. */
function classContentKey(item: PlanItem) {
  return `${classIdentity(item)}::${item.easyActivities}:${item.practiceActivities}`
}

/**
 * The engine rebuilds a plan from scratch and renumbers from 1, which would
 * rewrite history and shift every later class. This keeps the schedule stable:
 * classes already taught are frozen, a class the rebuild no longer needs keeps
 * its slot as "skipped", and only genuinely new classes are inserted.
 */
function reconcilePlanVersion(
  previous: GeneratedPlan,
  next: GeneratedPlan,
  completedCount: number
): GeneratedPlan {
  // Slots are matched on "the Nth class of this topic", not on the objectives
  // taught. Compressing a topic redistributes its objectives across fewer
  // classes, so matching on content would mark every class of that topic as
  // both skipped and re-added.
  const slotKeys = (items: PlanItem[]) => {
    const counts = new Map<string, number>()
    return items.map((item) => {
      const base = `${item.kind}::${item.topicId ?? item.title}`
      const ordinal = (counts.get(base) ?? 0) + 1
      counts.set(base, ordinal)
      return { item, key: `${base}::${ordinal}` }
    })
  }

  const previousSlots = slotKeys(previous.items)
  const nextSlots = slotKeys(next.items)
  const nextByKey = new Map(nextSlots.map((slot) => [slot.key, slot.item]))
  const claimedKeys = new Set<string>()

  // Taught classes are history: keep them exactly as they were.
  const frozen: PlanItem[] = []
  const future: PlanItem[] = []
  const placedKeyByIndex: string[] = []
  for (const { item, key } of previousSlots) {
    if (item.classNumber <= completedCount) {
      claimedKeys.add(key)
      frozen.push({ ...item, status: "completed" })
      continue
    }
    const match = nextByKey.get(key)
    if (match) {
      claimedKeys.add(key)
      future.push(match)
    } else {
      future.push({ ...item, status: "skipped" })
    }
    placedKeyByIndex.push(key)
  }

  // Classes the rebuild added go next to the class they follow in the new plan.
  for (let index = 0; index < nextSlots.length; index += 1) {
    const { item, key } = nextSlots[index]
    if (claimedKeys.has(key)) continue
    let insertAt = 0
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const placedIndex = placedKeyByIndex.indexOf(nextSlots[cursor].key)
      if (placedIndex >= 0) {
        insertAt = placedIndex + 1
        break
      }
    }
    future.splice(insertAt, 0, item)
    placedKeyByIndex.splice(insertAt, 0, key)
    claimedKeys.add(key)
  }

  const ordered = [...frozen, ...future]
  const nextUpId = ordered.find(
    (item, index) => index >= completedCount && item.status !== "skipped"
  )?.id

  // A skipped class and its replacement can carry the same engine id; ids must
  // stay unique or the content merge collapses two rows into one.
  const usedIds = new Set<string>()
  return {
    ...next,
    items: ordered.map((item, index) => {
      let id = item.id
      while (usedIds.has(id)) id = `${id}~`
      usedIds.add(id)
      return {
        ...item,
        id,
        classNumber: index + 1,
        status:
          item.status === "skipped"
            ? ("skipped" as const)
            : index < completedCount
              ? ("completed" as const)
              : item.id === nextUpId
                ? ("next" as const)
                : ("planned" as const),
      }
    }),
  }
}

interface ClassDiffEntry {
  type: "added" | "moved" | "updated" | "skipped"
  fromClassNumber?: number
  activitiesChanged?: boolean
}

interface PlanClassDiff {
  byItemId: Record<string, ClassDiffEntry>
  removed: { classNumber: number; label: string }[]
  addedCount: number
  movedCount: number
  updatedCount: number
  skippedCount: number
}

/** Class-level diff between two plan versions: added, removed, renumbered. */
function diffPlanClasses(
  previous: GeneratedPlan,
  next: GeneratedPlan
): PlanClassDiff {
  // Buckets, not a plain map: a plan can hold several identical structural
  // classes (three RDP blocks, say), and each must match only once.
  const previousBuckets = new Map<string, PlanItem[]>()
  for (const item of previous.items) {
    const key = classIdentity(item)
    const bucket = previousBuckets.get(key)
    if (bucket) bucket.push(item)
    else previousBuckets.set(key, [item])
  }

  const byItemId: Record<string, ClassDiffEntry> = {}
  let addedCount = 0
  let movedCount = 0
  let updatedCount = 0
  let skippedCount = 0

  for (const item of next.items) {
    const match = previousBuckets.get(classIdentity(item))?.shift()
    if (!match) {
      byItemId[item.id] = { type: "added" }
      addedCount += 1
      continue
    }

    if (item.status === "skipped") {
      if (match.status !== "skipped") {
        byItemId[item.id] = { type: "skipped" }
        skippedCount += 1
      }
      continue
    }

    const activitiesChanged =
      match.easyActivities !== item.easyActivities ||
      match.practiceActivities !== item.practiceActivities

    if (match.classNumber !== item.classNumber) {
      byItemId[item.id] = {
        type: "moved",
        fromClassNumber: match.classNumber,
        activitiesChanged,
      }
      movedCount += 1
    } else if (activitiesChanged) {
      byItemId[item.id] = { type: "updated", activitiesChanged: true }
      updatedCount += 1
    }
  }

  const removed = [...previousBuckets.values()]
    .flat()
    .map((item) => ({
      classNumber: item.classNumber,
      label: planItemPrimaryLabel(item),
    }))
    .sort((a, b) => a.classNumber - b.classNumber)

  return { byItemId, removed, addedCount, movedCount, updatedCount, skippedCount }
}

function ClassLessonGuide({
  item,
  student,
  contentGenerating,
  contentSource,
}: {
  item: PlanItem
  student: DemoStudent
  contentGenerating: boolean
  contentSource: "ai" | "fallback" | null
}) {
  const activities =
    item.activities ?? buildClassActivities(item, questionGuidelines)
  const activityGroups = groupActivitiesByObjective(activities)
  const totalActivities = item.easyActivities + item.practiceActivities
  const teaching: ClassTeachingContent | undefined = item.teachingContent
  const topicAttempts = (student.questionAttemptEvidence ?? []).filter(
    (attempt) => attempt.topicId === item.topicId
  )
  const starterAttempt = topicAttempts.find((attempt) => attempt.level === "starter")
  const masterAttempt = topicAttempts.find((attempt) => attempt.level === "master")

  return (
    <div className="lpb-lesson-plan-card lpb-lesson-minimal">
      <p className="lpb-lesson-goal">
        {teaching?.goal ??
          `Master ${item.title} through instruction, guided practice, and application.`}
        {contentGenerating ? (
          <span className="lpb-content-source generating">Generating…</span>
        ) : teaching?.source === "ai" ? (
          <span className="lpb-content-source ai">AI</span>
        ) : null}
      </p>

      {starterAttempt && masterAttempt ? (
        <section className="lpb-class-attempt-score" aria-label="Question attempt evidence">
          <div>
            <span className="lpb-detail-label">Student attempt evidence</span>
            <strong>Use these results to decide what to teach</strong>
          </div>
          <div className="lpb-class-attempt-badges">
            <span className={starterAttempt.correct / starterAttempt.attempted >= 0.75 ? "secure" : "not-secure"}>
              Starter <b>{starterAttempt.correct}/{starterAttempt.attempted}</b>
            </span>
            <span className={masterAttempt.correct / masterAttempt.attempted >= 0.75 ? "secure" : "not-secure"}>
              Master <b>{masterAttempt.correct}/{masterAttempt.attempted}</b>
            </span>
          </div>
          <p>{starterAttempt.note} {masterAttempt.note}</p>
        </section>
      ) : null}

      {item.learningObjectives.length > 0 ? (
        <div className="lpb-lesson-block">
          <span className="lpb-detail-label">Objectives</span>
          <ul className="lpb-lesson-bullets">
            {item.learningObjectives.map((objective) => (
              <li key={objective.id}>
                {objective.subtopic ? (
                  <strong>{objective.subtopic}: </strong>
                ) : null}
                {objective.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="lpb-lesson-block">
        <span className="lpb-detail-label">Teach</span>
        <ul className="lpb-lesson-bullets points">
          {(
            teaching?.teachingPoints ?? [
              "Introduce vocabulary with 2 worked examples.",
              "Guide starter questions with feedback.",
              "Close with a master application question.",
            ]
          ).map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </div>

      <div className="lpb-lesson-block">
        <span className="lpb-detail-label">Success</span>
        <p className="lpb-rationale-text">
          {teaching?.successCriteria ??
            "≥80% on starter questions; attempts a master word problem with reasoning."}
        </p>
      </div>

      <div className="lpb-lesson-block">
        <span className="lpb-detail-label">
          Activities · {totalActivities} ({item.easyActivities} starter ·{" "}
          {item.practiceActivities} master)
        </span>
        {activityGroups.length > 0 ? (
          <div className="lpb-question-pairs lpb-question-pairs-flat">
            {activityGroups.flatMap((group) =>
              group.items.map((activity) => (
                <div key={activity.id} className="lpb-question-item">
                  <span className={`lpb-q-badge ${activity.level}`}>
                    {activity.label}
                  </span>
                  <p>
                    {activity.prompt}
                    {activity.round > 1 ? (
                      <em className="lpb-activity-round">
                        {" "}
                        · Round {activity.round}
                      </em>
                    ) : null}
                  </p>
                </div>
              ))
            )}
          </div>
        ) : (
          <p className="lpb-muted-text">No activities on this class.</p>
        )}
      </div>

      {(teaching?.rationale ?? item.reason) ? (
        <p className="lpb-lesson-why">{teaching?.rationale ?? item.reason}</p>
      ) : null}
    </div>
  )
}

/**
 * `savedPlanId` opens an existing plan from the database (the
 * /learning-plan-builder/[planId] route); without it the page starts at setup.
 */
export default function LearningPlanBuilderPage({
  savedPlanId,
}: {
  savedPlanId?: string
} = {}) {
  const router = useRouter()
  const [student, setStudent] = useState<DemoStudent>(DEFAULT_EVIDENCE_STUDENT)
  const [studentSelected, setStudentSelected] = useState(false)
  /**
   * The teaching sequence for this student's grade. Every grade KG-8 is
   * available; the prototype's demo students are all Grade 5.
   */
  const gradeTopics = useMemo(
    () => getTopicsForGrade(student.grade),
    [student.grade]
  )
  const [setupStep, setSetupStep] = useState(1)
  const [selectedTopicIds, setSelectedTopicIds] = useState<number[]>(() =>
    getSuggestedTopicIds(
      getTopicsForGrade(DEFAULT_EVIDENCE_STUDENT.grade),
      DEFAULT_EVIDENCE_STUDENT
    )
  )
  const [topicOrder, setTopicOrder] = useState<number[]>(() =>
    getDefaultTopicOrder(getTopicsForGrade(DEFAULT_EVIDENCE_STUDENT.grade))
  )
  const [draggedTopicId, setDraggedTopicId] = useState<number | null>(null)
  const [scopeMode, setScopeMode] = useState<"manual" | "evidence">("manual")
  /** Topic the mentor view is focused on. null = follow the active topic. */
  const [mentorTopicId, setMentorTopicId] = useState<number | null>(null)
  const [manualAdjustments, setManualAdjustments] = useState<ManualAdjustments>(
    {}
  )
  const [manualOverrideActive, setManualOverrideActive] = useState(false)
  const [plan, setPlan] = useState<GeneratedPlan | null>(null)
  const [planTab, setPlanTab] = useState<
    "classes" | "topics" | "structure" | "next2weeks" | "mentor" | "methodology"
  >("classes")
  const [methodologyOpen, setMethodologyOpen] = useState(false)
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null)
  const [detailTopicId, setDetailTopicId] = useState<number | null>(null)
  const [editingTopicId, setEditingTopicId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState<TopicEditDraft | null>(null)
  const [completedCount, setCompletedCount] = useState(0)
  const [outcomeOpen, setOutcomeOpen] = useState(false)
  const [outcome, setOutcome] = useState<ClassOutcome>("on-track")
  const [outcomeNote, setOutcomeNote] = useState("")
  const [pendingUpdate, setPendingUpdate] = useState<PendingPlanUpdate | null>(
    null
  )
  const [aiParentExplanation, setAiParentExplanation] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [contentGenerating, setContentGenerating] = useState(false)
  const [contentSource, setContentSource] = useState<"ai" | "fallback" | null>(
    null
  )
  const [buildStage, setBuildStage] = useState<BuildStage>(null)
  const [classDiff, setClassDiff] = useState<PlanClassDiff | null>(null)
  const [loadingSavedPlan, setLoadingSavedPlan] = useState(Boolean(savedPlanId))
  const [savedPlanError, setSavedPlanError] = useState<string | null>(null)
  const [databasePlanId, setDatabasePlanId] = useState<string | null>(null)
  const [persistenceState, setPersistenceState] =
    useState<PersistenceState>("idle")

  // Reopen a saved plan by id. The stored snapshot holds the exact plan
  // document, so the board renders without regenerating anything.
  useEffect(() => {
    if (!savedPlanId) return
    let cancelled = false

    setLoadingSavedPlan(true)
    fetch(`/api/learning-plan/prototype?planId=${encodeURIComponent(savedPlanId)}`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            response.status === 404
              ? "That plan is not saved in the database."
              : "Could not load the saved plan."
          )
        }
        return (await response.json()) as {
          student: DemoStudent
          plan: GeneratedPlan
          completedCount: number
        }
      })
      .then((snapshot) => {
        if (cancelled) return
        setStudent(snapshot.student)
        setStudentSelected(true)
        setSelectedTopicIds(
          snapshot.plan.allocations.map((allocation) => allocation.topicId)
        )
        setTopicOrder(
          snapshot.plan.allocations.map((allocation) => allocation.topicId)
        )
        setCompletedCount(snapshot.completedCount)
        setDatabasePlanId(snapshot.plan ? savedPlanId : null)
        setPersistenceState("saved")
        setPlan(snapshot.plan)
        setPlanTab("classes")
        setSavedPlanError(null)
      })
      .catch((error: Error) => {
        if (cancelled) return
        console.error("Saved plan load failed:", error)
        setSavedPlanError(error.message)
      })
      .finally(() => {
        if (!cancelled) setLoadingSavedPlan(false)
      })

    return () => {
      cancelled = true
    }
  }, [savedPlanId])

  const runAiAnalysisOnChooseScope = () => {
    setSetupStep(3)

    if (!student.parentRequestedTopicId) {
      setAiParentExplanation(null)
      return
    }

    const targetTopic = topicById.get(student.parentRequestedTopicId)
    if (!targetTopic) return

    const prereqIds = targetTopic.prerequisiteIds || []
    const prereqNames = prereqIds
      .map((id) => topicById.get(id)?.name)
      .filter((name): name is string => Boolean(name))

    const explanation =
      prereqNames.length > 0
        ? `Starting with ${targetTopic.name} as requested. Prerequisites (${prereqNames.join(", ")}) are scheduled first as compressed refreshers.`
        : `Starting with ${targetTopic.name} as requested. This topic has no unmet prerequisites.`

    setAiParentExplanation(explanation)
    setAiLoading(false)
  }

  const suggestedTopicIds = useMemo(
    () => getSuggestedTopicIds(gradeTopics, student),
    [gradeTopics, student]
  )
  const highTopicIds = useMemo(
    () =>
      gradeTopics
        .filter(
          (topic) =>
            topic.priority === "high" &&
            !student.completedTopics.some(
              (completed) => completed.topicId === topic.id
            )
        )
        .map((topic) => topic.id),
    [gradeTopics, student]
  )
  const suggestedSet = useMemo(
    () => new Set(suggestedTopicIds),
    [suggestedTopicIds]
  )
  const selectedSet = useMemo(
    () => new Set(selectedTopicIds),
    [selectedTopicIds]
  )
  const displayTopics = useMemo(
    () => sortTopicsForDisplay(gradeTopics, student, topicOrder),
    [gradeTopics, student, topicOrder]
  )
  // Rows are numbered by their place in the teaching sequence, not by
  // curriculum sequence, so "Requires #03" points at the row above it.
  const displayPositionById = useMemo(
    () => new Map(displayTopics.map((topic, index) => [topic.id, index + 1])),
    [displayTopics]
  )
  const positionLabel = (topicId: number) =>
    String(displayPositionById.get(topicId) ?? 0).padStart(2, "0")
  const aiSuggestion = useMemo(
    () => getAiAssistedTopicSuggestion(gradeTopics, student),
    [gradeTopics, student]
  )
  const aiRecommendationById = useMemo(
    () =>
      new Map(
        aiSuggestion.recommendations.map((recommendation) => [
          recommendation.topicId,
          recommendation,
        ])
      ),
    [aiSuggestion]
  )
  const aiSkippableSet = useMemo(
    () => new Set(aiSuggestion.skippableTopicIds),
    [aiSuggestion.skippableTopicIds]
  )
  const selectedAiSkippableCount = aiSuggestion.skippableTopicIds.filter(
    (topicId) => selectedSet.has(topicId)
  ).length

  const reviewPlan = useMemo(
    () =>
      buildLearningPlan({
        topics: gradeTopics,
        student,
        selectedTopicIds,
        topicOrder,
        manualAdjustments,
        version: plan?.version ?? 1,
      }),
    [
      gradeTopics,
      manualAdjustments,
      plan?.version,
      selectedTopicIds,
      student,
      topicOrder,
    ]
  )
  const reviewAllocationById = useMemo(
    () =>
      new Map(
        reviewPlan.allocations.map((allocation) => [
          allocation.topicId,
          allocation,
        ])
      ),
    [reviewPlan]
  )
  const placementClassAdjustments = useMemo(
    () =>
      reviewPlan.allocations.flatMap((allocation) => {
        const score = student.placementResults.find(
          (result) => result.topicId === allocation.topicId
        )?.score
        // Capacity compression is reported separately, so it is excluded here.
        const savedClasses =
          allocation.idealClasses -
          allocation.classes -
          (allocation.compressedByCapacity ?? 0)

        if (score === undefined || score < 75 || savedClasses <= 0) {
          return []
        }

        return [
          {
            topicName: allocation.topicName,
            score,
            idealClasses: allocation.idealClasses,
            classes: allocation.classes + (allocation.compressedByCapacity ?? 0),
            savedClasses,
          },
        ]
      }),
    [reviewPlan.allocations, student.placementResults]
  )
  const placementClassesSaved = placementClassAdjustments.reduce(
    (total, adjustment) => total + adjustment.savedClasses,
    0
  )
  const attemptProfiles = useMemo(() => {
    const attempts = student.questionAttemptEvidence ?? []
    return [...new Set(attempts.map((attempt) => attempt.topicId))].map(
      (topicId) => ({
        topic: topicById.get(topicId),
        starter: attempts.find(
          (attempt) => attempt.topicId === topicId && attempt.level === "starter"
        ),
        master: attempts.find(
          (attempt) => attempt.topicId === topicId && attempt.level === "master"
        ),
      })
    )
  }, [student.questionAttemptEvidence])

  const activeDetailTopic =
    detailTopicId === null ? null : topicById.get(detailTopicId)
  const activeEditAllocation =
    editingTopicId === null
      ? null
      : plan?.allocations.find(
          (allocation) => allocation.topicId === editingTopicId
        )
  const editWouldExceedCapacity = Boolean(
    plan &&
      activeEditAllocation &&
      editDraft &&
      plan.capacity.total - activeEditAllocation.classes + editDraft.classes >
        student.classesRemaining
  )
  const nextTeachingItem = plan
    ? findNextTeachingItem(plan.items, completedCount)
    : undefined
  /** First class still to run — skipped slots are passed over. */
  const nextUpItem = plan?.items.find(
    (item) => item.classNumber > completedCount && isLiveClass(item)
  )
  const liveClassCount = plan
    ? plan.items.filter(isLiveClass).length
    : 0
  const skippedClassCount = plan
    ? plan.items.length - liveClassCount
    : 0
  /** Headline numbers for the generated-plan page. */
  const planStats = useMemo(() => {
    if (!plan) return null
    const liveItems = plan.items.filter(isLiveClass)
    const teachingItems = liveItems.filter((item) => item.kind === "teaching")
    return {
      // Counted from the rendered schedule so the numbers always agree with it.
      totalClasses: liveItems.length,
      availableClasses: plan.capacity.available,
      teachingClasses: teachingItems.length,
      structuralClasses: liveItems.length - teachingItems.length,
      topics: plan.allocations.length,
      activities: teachingItems.reduce(
        (total, item) => total + item.easyActivities + item.practiceActivities,
        0
      ),
      completed: completedCount,
      upcoming: Math.max(0, liveItems.length - completedCount),
      skipped: plan.items.length - liveItems.length,
    }
  }, [completedCount, plan])
  const structuralItems = plan
    ? plan.items.filter((item) => item.kind !== "teaching")
    : []
  // Mentor-selected topic wins; otherwise fall back to the active topic, then
  // to the first topic in the plan. Selecting a topic that later leaves the
  // plan falls back rather than showing an empty panel.
  const mentorTopic =
    (mentorTopicId !== null
      ? plan?.allocations.find(
          (allocation) => allocation.topicId === mentorTopicId
        )
      : undefined) ??
    plan?.allocations.find((allocation) => allocation.topicId === student.currentTopicId) ??
    plan?.allocations[0]
  const mentorAttempts = (student.questionAttemptEvidence ?? []).filter(
    (attempt) => attempt.topicId === mentorTopic?.topicId
  )
  const isNewStudent = student.completedTopics.length === 0 && !student.currentTopicId
  const mentorObjectiveLevels = useMemo(
    () =>
      new Map(
        (mentorTopic?.learningObjectives ?? []).map((objective) => [
          objective.id,
          getMentorObjectiveLevel(objective.id, student, mentorAttempts),
        ])
      ),
    [mentorAttempts, mentorTopic?.learningObjectives, student]
  )
  const mentorFixText = useMemo(() => {
    if (!mentorTopic) return ""
    const needsFocus = mentorTopic.learningObjectives.filter((objective) => {
      const level = mentorObjectiveLevels.get(objective.id)
      return level === "stuck" || level === "not_attempted"
    })
    const focusText = needsFocus.length
      ? `Prioritize ${needsFocus.map((objective) => objective.subtopic).filter((value, index, values) => values.indexOf(value) === index).join(", ")}.`
      : "Continue extending the secure objectives with Master-level application."
    const testText = mentorTopic.classes < 2
      ? " A topic test should be scheduled before moving on."
      : ""
    return `${focusText}${testText}`
  }, [mentorObjectiveLevels, mentorTopic])

  /**
   * Per-topic read of the student's evidence across the whole plan, not just
   * the active topic: which objectives are stuck, and how Starter accuracy
   * compares with Master accuracy.
   */
  const mentorDiagnostics = useMemo(() => {
    if (!plan) return []
    const allAttempts = student.questionAttemptEvidence ?? []
    const accuracyFor = (
      attempts: typeof allAttempts,
      level: "starter" | "master"
    ) => {
      const scoped = attempts.filter((attempt) => attempt.level === level)
      const attempted = scoped.reduce((total, a) => total + a.attempted, 0)
      if (attempted === 0) return undefined
      const correct = scoped.reduce((total, a) => total + a.correct, 0)
      return { correct, attempted, ratio: correct / attempted }
    }

    return plan.allocations.map((allocation) => {
      const attempts = allAttempts.filter(
        (attempt) => attempt.topicId === allocation.topicId
      )
      const levels = new Map(
        allocation.learningObjectives.map((objective) => [
          objective.id,
          getMentorObjectiveLevel(objective.id, student, attempts),
        ])
      )
      return {
        allocation,
        levels,
        stuck: allocation.learningObjectives.filter(
          (objective) => levels.get(objective.id) === "stuck"
        ),
        mastered: allocation.learningObjectives.filter(
          (objective) => levels.get(objective.id) === "master"
        ),
        starter: accuracyFor(attempts, "starter"),
        master: accuracyFor(attempts, "master"),
      }
    })
  }, [plan, student])

  const mentorStuckTopics = useMemo(
    () =>
      mentorDiagnostics
        .filter((diagnostic) => diagnostic.stuck.length > 0)
        .sort((a, b) => b.stuck.length - a.stuck.length),
    [mentorDiagnostics]
  )

  /**
   * One instruction per stuck topic. The Starter/Master split decides the
   * instruction: a weak Starter means the routine itself is broken, while a
   * secure Starter with a weak Master means it is transfer that is missing.
   */
  const mentorActions = useMemo(
    () =>
      mentorStuckTopics.map((diagnostic) => {
        const subtopics = [
          ...new Set(diagnostic.stuck.map((objective) => objective.subtopic)),
        ].join(", ")
        const starterWeak = diagnostic.starter && diagnostic.starter.ratio < 0.5
        const masterWeak = diagnostic.master && diagnostic.master.ratio < 0.5
        let instruction: string
        if (starterWeak && !masterWeak) {
          instruction = `Repair the core routine in ${subtopics} before any Master-level work — the reasoning is ahead of the method.`
        } else if (!starterWeak && masterWeak) {
          instruction = `The method is secure in ${subtopics} but transfer is not. Teach unfamiliar, multi-step problems rather than more drill.`
        } else if (starterWeak && masterWeak) {
          instruction = `Reteach ${subtopics} from the Starter level up — neither the routine nor the application is holding.`
        } else {
          instruction = `Re-test ${subtopics} and close the gaps the evidence flagged before moving on.`
        }
        return {
          topicId: diagnostic.allocation.topicId,
          topicName: diagnostic.allocation.topicName,
          extended:
            diagnostic.allocation.classes > diagnostic.allocation.idealClasses,
          instruction,
        }
      }),
    [mentorStuckTopics]
  )

  const chooseStudent = (nextStudent: DemoStudent) => {
    setStudent(nextStudent)
    setStudentSelected(true)
    const nextTopics = getTopicsForGrade(nextStudent.grade)
    setSelectedTopicIds(getSuggestedTopicIds(nextTopics, nextStudent))
    setTopicOrder(getDefaultTopicOrder(nextTopics))
    setMentorTopicId(null)
    setScopeMode("manual")
    setManualAdjustments({})
    setManualOverrideActive(false)
    setPlan(null)
    setSetupStep(1)
    setPlanTab("classes")
    setCompletedCount(0)
    setExpandedItemId(null)
    setDetailTopicId(null)
    setEditingTopicId(null)
    setPendingUpdate(null)
    setDatabasePlanId(null)
    setPersistenceState("idle")
  }

  const savePlanToDatabase = async (nextPlan: GeneratedPlan) => {
    setPersistenceState("saving")
    try {
      const response = await fetch("/api/learning-plan/prototype", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", student, plan: nextPlan }),
      })
      if (!response.ok) throw new Error("Could not save the plan")
      const data = (await response.json()) as { planId: string }
      setDatabasePlanId(data.planId)
      setPersistenceState("saved")
      return data.planId
    } catch (error) {
      console.error("Plan save failed:", error)
      setPersistenceState("error")
      return null
    }
  }

  /**
   * Store the plan document itself (teaching guides included) so the saved
   * plan reopens exactly as built. The initial save happens before the guides
   * exist, so this runs again once enrichment finishes.
   */
  const savePlanSnapshot = async (
    planId: string,
    nextPlan: GeneratedPlan,
    nextCompletedCount: number
  ) => {
    try {
      await fetch("/api/learning-plan/prototype", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          planId,
          student,
          plan: nextPlan,
          update: {
            kind: "auto",
            changes: [],
            completedCount: nextCompletedCount,
          },
        }),
      })
    } catch (error) {
      console.error("Plan snapshot save failed:", error)
    }
  }

  const savePlanUpdate = async ({
    nextPlan,
    kind,
    changes,
    completedCount: nextCompletedCount,
    outcome: recordedOutcome,
    note,
    taughtPrototypeTopicId,
    autoApplied,
  }: {
    nextPlan: GeneratedPlan
    kind: "manual" | "class"
    changes: string[]
    completedCount: number
    outcome?: ClassOutcome
    note?: string
    taughtPrototypeTopicId?: number
    autoApplied?: boolean
  }) => {
    if (!databasePlanId) return
    setPersistenceState("saving")
    try {
      const response = await fetch("/api/learning-plan/prototype", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          planId: databasePlanId,
          student,
          plan: nextPlan,
          update: {
            kind,
            changes,
            completedCount: nextCompletedCount,
            outcome: recordedOutcome,
            note,
            taughtPrototypeTopicId,
            autoApplied,
          },
        }),
      })
      if (!response.ok) throw new Error("Could not save the plan update")
      setPersistenceState("saved")
    } catch (error) {
      console.error("Plan update save failed:", error)
      setPersistenceState("error")
    }
  }

  const toggleTopic = (topicId: number) => {
    setManualOverrideActive(true)
    setSelectedTopicIds((current) =>
      current.includes(topicId)
        ? current.filter((id) => id !== topicId)
        : [...current, topicId]
    )
  }

  const applyEvidencePlan = () => {
    if (manualOverrideActive) return
    setScopeMode("evidence")
    setAiLoading(true)
    fetch("/api/learning-plan/ai-plan-generator", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        student,
        topics: gradeTopics,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.strategy) {
          setAiParentExplanation(data.strategy)
        }
        if (data.classAdjustments && typeof data.classAdjustments === "object") {
          const newAdjustments: ManualAdjustments = { ...manualAdjustments }
          for (const [topicIdStr, adj] of Object.entries(data.classAdjustments)) {
            const topicId = Number(topicIdStr)
            const castAdj = adj as { classes: number; activities: number }
            // Rule H1: an AI adjustment may not go below the topic minimum.
            const minimumClasses = topicById.get(topicId)?.minimumClasses ?? 1
            newAdjustments[topicId] = {
              classes: Math.max(minimumClasses, castAdj.classes),
              activities: castAdj.activities,
            }
          }
          setManualAdjustments(newAdjustments)
        }
        setSelectedTopicIds(aiSuggestion.selectedTopicIds)
        setTopicOrder(getDefaultTopicOrder(gradeTopics))
      })
      .catch((err) => console.error("AI Plan error:", err))
      .finally(() => setAiLoading(false))
  }

  const unselectAiSkippableTopics = () => {
    if (manualOverrideActive) return
    setSelectedTopicIds((current) =>
      current.filter((topicId) => !aiSkippableSet.has(topicId))
    )
    setScopeMode("evidence")
  }

  const unselectTopic = (topicId: number) => {
    setManualOverrideActive(true)
    setSelectedTopicIds((current) =>
      current.filter((selectedId) => selectedId !== topicId)
    )
  }

  const moveTopic = (targetTopicId: number) => {
    if (draggedTopicId === null || draggedTopicId === targetTopicId) return
    setTopicOrder((current) => {
      const nextOrder = current.filter((topicId) => topicId !== draggedTopicId)
      const targetIndex = nextOrder.indexOf(targetTopicId)
      nextOrder.splice(targetIndex < 0 ? nextOrder.length : targetIndex, 0, draggedTopicId)
      return nextOrder
    })
    setManualOverrideActive(true)
    setDraggedTopicId(null)
  }

  /**
   * Build structure deterministically, then generate mentor prose the same way
   * /teacher/plans does (llmStructured when a key is present; fallback templates otherwise).
   * Always attach expanded activity rows so "N total activities" lists N items.
   *
   * A rebuilt plan arrives with no teaching guides, so guides are carried over
   * from `previousPlan` for every class that teaches the same thing; only new
   * or changed classes are sent to the model.
   */
  const enrichPlan = async (
    basePlan: GeneratedPlan,
    previousPlan?: GeneratedPlan | null
  ): Promise<GeneratedPlan> => {
    const reusableContent = new Map<string, ClassTeachingContent>()
    for (const item of previousPlan?.items ?? []) {
      if (item.kind === "teaching" && item.teachingContent) {
        reusableContent.set(classContentKey(item), item.teachingContent)
      }
    }

    const withLocalActivities: GeneratedPlan = {
      ...basePlan,
      items: basePlan.items.map((item) => {
        if (item.kind !== "teaching") return item
        const carried =
          item.teachingContent ?? reusableContent.get(classContentKey(item))
        return {
          ...item,
          activities: buildClassActivities(item, questionGuidelines),
          teachingContent: carried,
          reason: carried?.rationale ?? item.reason,
        }
      }),
    }

    const pendingItems = withLocalActivities.items.filter(
      (item) => item.kind === "teaching" && !item.teachingContent
    )

    // Nothing new to write — an outcome that only renumbered classes lands here.
    if (pendingItems.length === 0) {
      return withLocalActivities
    }

    setContentGenerating(true)
    try {
      const response = await fetch("/api/learning-plan/generate-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          student,
          items: pendingItems,
          guidelines: questionGuidelines,
        }),
      })
      if (!response.ok) {
        throw new Error(`generate-content failed: ${response.status}`)
      }
      const data = (await response.json()) as {
        items: PlanItem[]
        source: "ai" | "fallback"
      }
      setContentSource(data.source)
      const generatedById = new Map(data.items.map((item) => [item.id, item]))
      return {
        ...withLocalActivities,
        items: withLocalActivities.items.map(
          (item) => generatedById.get(item.id) ?? item
        ),
        explanations: [
          data.source === "ai"
            ? `Teaching guide prose was generated by AI for ${plural(pendingItems.length, "class", "classes")} (structure stayed rule-based).`
            : "Teaching guide prose used local fallback templates (AI provider unavailable).",
          ...withLocalActivities.explanations,
        ],
      }
    } catch (error) {
      console.error("Plan content enrichment failed:", error)
      setContentSource("fallback")
      return withLocalActivities
    } finally {
      setContentGenerating(false)
    }
  }

  const buildPlan = async () => {
    const basePlan = buildLearningPlan({
      topics: gradeTopics,
      student,
      selectedTopicIds,
      topicOrder,
      manualAdjustments,
      version: 1,
      changesFromPrevious:
        student.scenario === "C"
          ? [
              "Removed completed Number Sense and Multi-Digit Operations topic blocks.",
              "Refitted the remaining topics into the new 24-class window.",
            ]
          : [],
      lastModificationType: manualOverrideActive ? "manual" : "auto",
    })
    if (basePlan.capacity.difference > 0) {
      setSetupStep(4)
      return
    }
    // Attach activity rows up front so the count matches the list.
    const withActivities: GeneratedPlan = {
      ...basePlan,
      items: basePlan.items.map((item) =>
        item.kind === "teaching"
          ? {
              ...item,
              activities: buildClassActivities(item, questionGuidelines),
            }
          : item
      ),
    }

    // Hold the plan back until the teaching guides are ready, so the
    // final page renders complete instead of filling in behind the user.
    setCompletedCount(0)
    setPlanTab("classes")
    setClassDiff(null)
    setBuildStage("structure")
    window.scrollTo({ top: 0, behavior: "smooth" })
    try {
      setBuildStage("saving")
      const planId = await savePlanToDatabase(withActivities)
      setBuildStage("content")
      const enriched = await enrichPlan(withActivities)
      setPlan(enriched)
      if (planId) {
        // Persist the enriched plan, then move to its own URL so the plan can
        // be reopened and shared by id.
        await savePlanSnapshot(planId, enriched, 0)
        router.replace(`/learning-plan-builder/${planId}`)
      }
    } finally {
      setBuildStage(null)
    }
  }

  const returnToSetup = () => {
    setPlan(null)
    setSetupStep(4)
    setCompletedCount(0)
    setClassDiff(null)
    setDatabasePlanId(null)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const startEdit = (topicId: number) => {
    const allocation = plan?.allocations.find(
      (item) => item.topicId === topicId
    )
    if (!allocation) return
    setEditingTopicId(topicId)
    setEditDraft({
      classes: allocation.classes,
      activities: allocation.activities,
      easyPercent: allocation.easyPercent,
    })
  }

  const saveTopicEdit = () => {
    if (!plan || editingTopicId === null || !editDraft) return
    const previous = plan.allocations.find(
      (allocation) => allocation.topicId === editingTopicId
    )
    if (!previous) return

    const adjustment: ManualTopicAdjustment = {
      classes: editDraft.classes,
      activities: editDraft.activities,
      easyPercent: editDraft.easyPercent,
    }
    const nextAdjustments = {
      ...manualAdjustments,
      [editingTopicId]: adjustment,
    }
    const changes = [
      `${previous.topicName}: ${previous.classes} → ${editDraft.classes} classes.`,
      `${previous.activities} → ${editDraft.activities} activities with a ${editDraft.easyPercent}:${100 - editDraft.easyPercent} Easy-to-Practice split.`,
      "The teacher override is locked into this plan version.",
    ]

    setManualAdjustments(nextAdjustments)
    setManualOverrideActive(true)
    const nextBasePlan = buildLearningPlan({
      topics: gradeTopics,
      student,
      selectedTopicIds,
      topicOrder,
      manualAdjustments: nextAdjustments,
      version: plan.version + 1,
      lastModificationType: "manual",
    })
    if (nextBasePlan.capacity.difference > 0) return
    const nextPlan: GeneratedPlan = {
      ...reconcilePlanVersion(plan, nextBasePlan, completedCount),
      changesFromPrevious: mergePlanChanges(
        changes,
        describePlanChanges(plan, nextBasePlan)
      ),
    }
    setPlan(nextPlan)
    setClassDiff(diffPlanClasses(plan, nextPlan))
    void enrichPlan(nextPlan, plan).then((enriched) => {
      setPlan(enriched)
      if (databasePlanId) {
        void savePlanSnapshot(databasePlanId, enriched, completedCount)
      }
    })
    void savePlanUpdate({
      nextPlan,
      kind: "manual",
      changes: nextPlan.changesFromPrevious,
      completedCount,
    })
    setEditingTopicId(null)
    setEditDraft(null)
  }

  const previewClassOutcome = () => {
    if (!plan || !nextTeachingItem?.topicId) return
    const allocation = plan.allocations.find(
      (item) => item.topicId === nextTeachingItem.topicId
    )
    if (!allocation) return

    const changes: string[] = [
      `Marked Class ${nextTeachingItem.classNumber} as completed.`,
    ]
    let nextClasses = allocation.classes

    if (outcome === "faster") {
      // Rule H1: an auto-update never takes a topic below its class minimum.
      nextClasses = Math.max(
        allocation.minimumClasses,
        allocation.classes - 1
      )
      changes.push(
        nextClasses === allocation.classes
          ? `${allocation.topicName} is already at its ${allocation.minimumClasses}-class minimum, so the allocation is unchanged.`
          : `${allocation.topicName} is progressing faster: ${allocation.classes} → ${nextClasses} classes.`
      )
    } else if (outcome === "needs-time") {
      const idealPlusTwo = allocation.idealClasses + 2
      nextClasses = Math.min(idealPlusTwo, allocation.classes + 1)
      changes.push(
        `${allocation.topicName} needs reinforcement: ${allocation.classes} → ${nextClasses} classes.`
      )
    } else {
      changes.push(
        `${allocation.topicName} remains on its approved allocation.`
      )
    }

    if (outcomeNote.trim()) {
      changes.push(`Teacher note saved: “${outcomeNote.trim()}”`)
    }

    const nextAdjustments = {
      ...manualAdjustments,
      [allocation.topicId]: {
        ...manualAdjustments[allocation.topicId],
        classes: nextClasses,
      },
    }
    const nextBasePlan = buildLearningPlan({
      topics: gradeTopics,
      student,
      selectedTopicIds,
      topicOrder,
      manualAdjustments: nextAdjustments,
      version: plan.version + 1,
      lastModificationType: "class",
    })
    if (nextBasePlan.capacity.difference > 0) return
    // The class being graded is taught once approved, so it freezes too.
    const nextPlan: GeneratedPlan = {
      ...reconcilePlanVersion(plan, nextBasePlan, completedCount + 1),
      changesFromPrevious: mergePlanChanges(
        changes,
        describePlanChanges(plan, nextBasePlan)
      ),
    }

    setPendingUpdate({
      plan: nextPlan,
      adjustments: nextAdjustments,
      changes,
    })
  }

  const approveClassOutcome = () => {
    if (!pendingUpdate) return
    const previousPlan = plan
    setPlan(pendingUpdate.plan)
    if (previousPlan) {
      setClassDiff(diffPlanClasses(previousPlan, pendingUpdate.plan))
    }
    void enrichPlan(pendingUpdate.plan, previousPlan).then((enriched) => {
      setPlan(enriched)
      if (databasePlanId) {
        void savePlanSnapshot(databasePlanId, enriched, completedCount + 1)
      }
    })
    setManualAdjustments(pendingUpdate.adjustments)
    setManualOverrideActive(false)
    setCompletedCount((current) => current + 1)
    void savePlanUpdate({
      nextPlan: pendingUpdate.plan,
      kind: "class",
      changes: pendingUpdate.changes,
      completedCount: completedCount + 1,
      outcome,
      note: outcomeNote,
      taughtPrototypeTopicId: nextTeachingItem?.topicId,
      autoApplied: outcome !== "on-track",
    })
    setPendingUpdate(null)
    setOutcomeOpen(false)
    setOutcome("on-track")
    setOutcomeNote("")
  }

  /**
   * Mark every class up to `targetCompleted` as taught on track, in one step.
   * On track means "keep the approved allocation", so nothing is adjusted —
   * this only moves the plan's position so the interesting class can be
   * reached without clicking through every class before it.
   */
  const fastForwardTo = (targetCompleted: number) => {
    if (!plan) return
    const liveTotal = plan.items.filter(isLiveClass).length
    const target = Math.min(Math.max(targetCompleted, 0), liveTotal)
    const advanced = target - completedCount
    if (advanced <= 0) return

    const rebuilt = buildLearningPlan({
      topics: gradeTopics,
      student,
      selectedTopicIds,
      topicOrder,
      manualAdjustments,
      version: plan.version,
      lastModificationType: "class",
    })
    const nextPlan: GeneratedPlan = {
      ...reconcilePlanVersion(plan, rebuilt, target),
      changesFromPrevious: [
        `Fast-forwarded to Class ${target}: ${advanced} ${advanced === 1 ? "class" : "classes"} marked as taught on track. Allocations are unchanged — on track never resizes a topic.`,
      ],
    }
    setPlan(nextPlan)
    setCompletedCount(target)
    setClassDiff(null)
    if (databasePlanId) {
      void savePlanSnapshot(databasePlanId, nextPlan, target)
    }
  }

  /**
   * The allocation move behind a pending outcome, as slot counts the meeting
   * can read off a bar: what has been taught, what is left, what the outcome
   * added or released, and where the Rule H1 floor sits.
   */
  const outcomeImpact = useMemo(() => {
    if (!pendingUpdate || !plan || !nextTeachingItem?.topicId) return null
    const topicId = nextTeachingItem.topicId
    const current = plan.allocations.find((a) => a.topicId === topicId)
    const next = pendingUpdate.plan.allocations.find((a) => a.topicId === topicId)
    if (!current || !next) return null

    // Classes of this topic already taught, including the one being graded.
    // `allocation.classes` is the topic's total in this plan, so the taught
    // count is a slice of it, never added on top.
    const taught = plan.items.filter(
      (item) =>
        item.topicId === topicId &&
        item.kind === "teaching" &&
        item.status !== "skipped" &&
        item.classNumber <= nextTeachingItem.classNumber
    ).length
    const currentTotal = current.classes
    const nextTotal = next.classes
    const delta = next.classes - current.classes

    const explanation =
      delta < 0
        ? `Completed faster, so one class returns to the pool. ${next.topicName} goes from ${current.classes} to ${next.classes} classes — the ${current.minimumClasses}-class floor is respected, and the freed class stays in the package.`
        : delta > 0
          ? `Needs more time, so one reinforcement class is added. ${next.topicName} goes from ${current.classes} to ${next.classes} classes, capped at two above the ideal of ${current.idealClasses}.`
          : current.classes <= current.minimumClasses
            ? `${next.topicName} is already at its ${current.minimumClasses}-class minimum, so no automatic rule can shorten it further. Only a teacher override can.`
            : `On track keeps the approved allocation. ${next.topicName} stays at ${next.classes} classes, ${Math.max(0, next.classes - taught)} of them still to teach.`

    return {
      topicName: next.topicName,
      taught,
      currentTotal,
      nextTotal,
      nextRemaining: Math.max(0, nextTotal - taught),
      delta,
      minimum: current.minimumClasses,
      ideal: current.idealClasses,
      scaleMax: Math.max(currentTotal, nextTotal, current.idealClasses),
      explanation,
    }
  }, [nextTeachingItem, pendingUpdate, plan])

  const resetPrototype = () => {
    chooseStudent(DEFAULT_EVIDENCE_STUDENT)
    setStudentSelected(false)
  }

  // Which methodology rules explain the screen currently on show. The overlay
  // opens on these, so the reference is useful mid-presentation rather than
  // being a wall of rules to scroll.
  const methodologyContext: MethodologyContext = plan
    ? planTab === "methodology"
      ? "topics"
      : planTab
    : buildStage
      ? "building"
      : methodologyContextForSetupStep(setupStep)

  return (
    <div className={`lpb${methodologyOpen ? " why-open" : ""}`}>
      <link
        href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=Space+Mono:wght@400;700&display=swap"
        rel="stylesheet"
      />

      <header className="lpb-topbar">
        <Link href="/" className="lpb-brand" aria-label="Noah home">
          <span className="lpb-logo" aria-hidden="true">
            <span />
          </span>
          <span className="lpb-brand-word">
            Noah <b>2.0</b>
          </span>
        </Link>
        <span className="lpb-top-divider" />
        <span className="lpb-product-name">Learning Plan Builder</span>
        <div className="lpb-top-actions">
          {plan ? (
            <button
              type="button"
              className="lpb-button lpb-button-ghost"
              onClick={() => {
                if (savedPlanId) {
                  router.push("/learning-plan-builder")
                } else {
                  returnToSetup()
                }
              }}
            >
              <ArrowLeft size={15} />
              Back to setup
            </button>
          ) : null}
          <button
            type="button"
            className={`lpb-button lpb-button-ghost${methodologyOpen ? " active" : ""}`}
            onClick={() => setMethodologyOpen((current) => !current)}
            aria-pressed={methodologyOpen}
          >
            <HelpCircle size={15} />
            Why this
          </button>
          <button
            type="button"
            className="lpb-button lpb-button-ghost"
            onClick={resetPrototype}
          >
            <RotateCcw size={15} />
            Reset
          </button>
        </div>
      </header>

      {savedPlanId && (loadingSavedPlan || savedPlanError) ? (
        <main className="lpb-setup-shell lpb-building-shell">
          <section className="lpb-building-card">
            {savedPlanError ? (
              <>
                <span className="lpb-kicker">Plan unavailable</span>
                <h1>Could not open this plan</h1>
                <p>{savedPlanError}</p>
                <p className="lpb-saved-plan-id">{savedPlanId}</p>
                <Link
                  href="/learning-plan-builder"
                  className="lpb-button lpb-button-primary"
                >
                  Build a new plan
                </Link>
              </>
            ) : (
              <>
                <span className="lpb-building-orb" aria-hidden="true">
                  <Sparkles size={22} />
                </span>
                <span className="lpb-kicker">Saved plan</span>
                <h1>Loading the plan…</h1>
                <p>Fetching the saved plan from the database.</p>
              </>
            )}
          </section>
        </main>
      ) : buildStage !== null ? (
        <main className="lpb-setup-shell lpb-building-shell">
          <section className="lpb-building-card">
            <span className="lpb-building-orb" aria-hidden="true">
              <Sparkles size={22} />
            </span>
            <span className="lpb-kicker">Building the plan</span>
            <h1>Generating {student.name}&apos;s learning plan…</h1>
            <p>
              The structure comes from the planning rules; the teaching guides
              are written per class. This can take a minute on a full-year
              package.
            </p>
            <ol className="lpb-building-steps">
              {BUILD_STAGES.map((stage) => {
                const currentIndex = BUILD_STAGES.findIndex(
                  (candidate) => candidate.id === buildStage
                )
                const stageIndex = BUILD_STAGES.findIndex(
                  (candidate) => candidate.id === stage.id
                )
                const state =
                  stageIndex < currentIndex
                    ? "done"
                    : stageIndex === currentIndex
                      ? "active"
                      : "waiting"
                return (
                  <li key={stage.id} className={state}>
                    <span className="lpb-building-step-mark">
                      {state === "done" ? <Check size={13} /> : null}
                    </span>
                    <div>
                      <strong>{stage.label}</strong>
                      <small>{stage.detail}</small>
                    </div>
                  </li>
                )
              })}
            </ol>
          </section>
        </main>
      ) : plan === null ? (
        <main className="lpb-setup-shell">
          <section className="lpb-setup-heading">
            <div>
              <span className="lpb-kicker">
                Maths · Grade 5 · US curriculum
              </span>
              <h1>Build a plan a teacher can trust.</h1>
              <p>
                Turn curriculum priorities and student evidence into a
                class-by-class plan—without hiding the rules.
              </p>
            </div>
          </section>

          <nav className="lpb-stepper" aria-label="Plan setup">
            {SETUP_STEPS.map((step) => (
              <button
                key={step.id}
                type="button"
                className={
                  setupStep === step.id
                    ? "active"
                    : setupStep > step.id
                      ? "complete"
                      : ""
                }
                onClick={() => {
                  if (step.id <= setupStep) setSetupStep(step.id)
                }}
              >
                <span>
                  {setupStep > step.id ? <Check size={15} /> : step.id}
                </span>
                {step.label}
              </button>
            ))}
          </nav>

          <section className="lpb-setup-card">
            {setupStep === 1 ? (
              <>
                <header className="lpb-section-head">
                  <div>
                    <span className="lpb-section-no">01</span>
                    <h2>Choose a demo student</h2>
                    <p>
                      Each student shows a different planning path from the
                      supplied test scenarios.
                    </p>
                  </div>
                  <span className="lpb-count-chip">4 profiles</span>
                </header>

                <div className="lpb-student-grid">
                  {demoStudents.map((candidate) => {
                    const copy = SCENARIO_COPY[candidate.scenario]
                    const selected = studentSelected && candidate.id === student.id
                    return (
                      <button
                        type="button"
                        key={candidate.id}
                        className={`lpb-student-card${selected ? " selected" : ""}`}
                        onClick={() => chooseStudent(candidate)}
                      >
                        <span className="lpb-scenario-tag">
                          Demo {candidate.scenario}
                        </span>
                        <span className="lpb-student-card-top">
                          <span className="lpb-avatar">
                            {candidate.initials}
                          </span>
                          {selected ? (
                            <span className="lpb-selected-check">
                              <Check size={14} />
                            </span>
                          ) : null}
                        </span>
                        <strong>{candidate.name}</strong>
                        <span className="lpb-card-eyebrow">{copy.eyebrow}</span>
                        <b>{copy.title}</b>
                        <p>{copy.description}</p>
                      </button>
                    )
                  })}
                </div>

                {studentSelected ? (
                <div className="lpb-profile-strip">
                  <div>
                    <span>Student</span>
                    <strong>{student.name}</strong>
                  </div>
                  <div>
                    <span>Grade</span>
                    <strong>Grade {student.grade}</strong>
                  </div>
                  <div>
                    <span>Region</span>
                    <strong>United States</strong>
                  </div>
                  <div>
                    <span>Package</span>
                    <strong>
                      {student.packageLabel?.split(" · ")[0] ?? "—"}
                    </strong>
                  </div>
                  <div>
                    <span>Classes remaining</span>
                    <strong>{student.classesRemaining}</strong>
                  </div>
                  <div>
                    <span>Class frequency</span>
                    <strong>
                      {student.classesPerWeek ?? 2}/week
                    </strong>
                  </div>
                  <div>
                    <span>Placement</span>
                    <strong>
                      {student.placementStatus === "completed"
                        ? "Completed"
                        : student.placementStatus === "not-taken"
                          ? "Not taken"
                          : "Previous plan"}
                    </strong>
                  </div>
                </div>
                ) : null}

                <footer className="lpb-setup-footer">
                  <button
                    type="button"
                    className="lpb-button lpb-button-primary"
                    onClick={() => setSetupStep(2)}
                    disabled={!studentSelected}
                  >
                    Review evidence
                    <ArrowRight size={16} />
                  </button>
                </footer>
              </>
            ) : null}

            {setupStep === 2 ? (
              <>
                <header className="lpb-section-head">
                  <div>
                    <span className="lpb-section-no">02</span>
                    <h2>Review the evidence</h2>
                    <p>
                      This is the information the rules will use. Nothing is
                      inferred outside the dummy dataset.
                    </p>
                  </div>
                  <span className="lpb-count-chip">
                    Demo {student.scenario}
                  </span>
                </header>

                {student.placementStatus === "completed" ? (
                  <div className="lpb-evidence-layout">
                    <section className="lpb-evidence-panel">
                      <div className="lpb-panel-title">
                        <Target size={18} />
                        <div>
                          <h3>Placement results</h3>
                          <p>Scores out of 100 by assessed topic</p>
                        </div>
                      </div>
                      <div className="lpb-score-list">
                        {student.placementResults.map((result) => {
                          const topic = topicById.get(result.topicId)
                          return (
                            <div className="lpb-score-row" key={result.topicId}>
                              <div>
                                <strong>{topic?.name}</strong>
                                <span>{topic?.family}</span>
                              </div>
                              <div className="lpb-score-track">
                                <span
                                  style={{ width: `${result.score}%` }}
                                  className={placementTone(result.score)}
                                />
                              </div>
                              <b className={placementTone(result.score)}>
                                {result.score}%
                              </b>
                              <span
                                className={`lpb-evidence-status ${placementTone(result.score)}`}
                              >
                                {placementLabel(result.score)}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                      <div className="lpb-evidence-note">
                        Other assessed topics use a mid-range prototype score of{" "}
                        {student.defaultPlacementScore}%.
                      </div>
                    </section>

                    <aside className="lpb-rule-preview">
                      <div className="lpb-rule-preview-topline">
                        <span className="lpb-rule-preview-icon">
                          <Lightbulb size={20} />
                        </span>
                        <span>Placement rule analysis</span>
                      </div>
                      <h3>How scores change the plan</h3>
                      <ul>
                        <li>
                          <strong>Below 40%</strong>
                          <span>Keep the full class allocation and add more Practice activities.</span>
                        </li>
                        <li>
                          <strong>75% or more</strong>
                          <span>Shorten the topic and add Easy consolidation.</span>
                        </li>
                        <li>
                          <strong>40%–74%</strong>
                          <span>Keep the ideal workbook class and activity values.</span>
                        </li>
                      </ul>
                    </aside>
                  </div>
                ) : null}

                {student.placementStatus === "not-taken" &&
                student.parentRequestedTopicId === undefined ? (
                  <div className="lpb-empty-evidence">
                    <span className="lpb-empty-icon">
                      <BookOpenCheck size={28} />
                    </span>
                    <div>
                      <span className="lpb-kicker">No placement test</span>
                      <h3>Use the academic defaults.</h3>
                      <p>
                        Every selected topic starts with its ideal class,
                        activity and Easy-to-Practice allocation from the
                        workbook. If the package is smaller than the full year,
                        topics compress toward their class minimums before any
                        topic is dropped.
                      </p>
                    </div>
                    <div className="lpb-default-summary">
                      <span>13 curriculum topics</span>
                      <span>66 teaching + 13 structural = 79 classes</span>
                      <span>43 classes at the minimums</span>
                      <span>
                        {student.packageLabel ??
                          `${student.classesRemaining} classes available`}
                      </span>
                    </div>
                  </div>
                ) : null}

                {student.scenario === "C" ? (
                  <>
                    <div className="lpb-returning-layout">
                      <section className="lpb-evidence-panel">
                      <div className="lpb-panel-title">
                        <CheckCircle2 size={18} />
                        <div>
                          <h3>Completed since the previous plan</h3>
                          <p>{student.previousPlanLabel}</p>
                        </div>
                      </div>
                      <div className="lpb-completed-list">
                        {student.completedTopics.map((completed) => {
                          const topic = topicById.get(completed.topicId)
                          const saved =
                            completed.plannedClasses - completed.actualClasses
                          return (
                            <div key={completed.topicId}>
                              <span className="lpb-mini-check">
                                <Check size={13} />
                              </span>
                              <div>
                                <strong>{topic?.name}</strong>
                                <span>
                                  {completed.actualClasses} of{" "}
                                  {completed.plannedClasses} planned classes
                                </span>
                              </div>
                              <b>{saved > 0 ? `${saved} saved` : "On plan"}</b>
                            </div>
                          )
                        })}
                      </div>
                      </section>
                      <section className="lpb-evidence-panel">
                      <div className="lpb-panel-title">
                        <Gauge size={18} />
                        <div>
                          <h3>Current-topic evidence</h3>
                          <p>
                            {topicById.get(student.currentTopicId ?? 0)?.name}
                          </p>
                        </div>
                      </div>
                      <div className="lpb-signal-list">
                        {student.objectiveEvidence.map((evidence) => (
                          <div
                            key={`${evidence.learningObjectiveId}-${evidence.level}`}
                            className={evidence.result}
                          >
                            {evidence.result === "secure" ? (
                              <TrendingUp size={16} />
                            ) : (
                              <TrendingDown size={16} />
                            )}
                            <span>{evidence.note}</span>
                          </div>
                        ))}
                      </div>
                      </section>
                    </div>
                    <section className="lpb-attempt-evidence">
                      <div>
                        <span className="lpb-detail-label">Attempted questions</span>
                        <h3>What the plan will teach next</h3>
                        <p>Starter and Master results are used to choose the teaching response—not just to list questions.</p>
                      </div>
                      <div className="lpb-attempt-profile-list">
                        {attemptProfiles.map(({ topic, starter, master }) => {
                          if (!topic || !starter || !master) return null
                          const starterStrong = starter.correct / starter.attempted >= 0.75
                          const masterStrong = master.correct / master.attempted >= 0.75
                          const focus = starterStrong && !masterStrong
                            ? "Bridge secure methods into unfamiliar Master tasks."
                            : !starterStrong && masterStrong
                              ? "Repair the Starter routine so the stronger reasoning is reliable."
                              : "Use both levels to confirm the next teaching step."
                          return (
                            <article key={topic.id}>
                              <strong>{topic.name}</strong>
                              <div className="lpb-attempt-scores">
                                <span className={starterStrong ? "secure" : "not-secure"}>Starter {starter.correct}/{starter.attempted}</span>
                                <span className={masterStrong ? "secure" : "not-secure"}>Master {master.correct}/{master.attempted}</span>
                              </div>
                              <p>{focus}</p>
                            </article>
                          )
                        })}
                      </div>
                    </section>
                  </>
                ) : null}

                {student.scenario === "D" || student.parentRequestedTopicId ? (
                  <div className="lpb-parent-request">
                    <span className="lpb-parent-icon">
                      <UsersRound size={24} />
                    </span>
                    <div style={{ flex: 1 }}>
                      <span className="lpb-kicker">Parent request</span>
                      <div className="lpb-parent-header-row">
                        <h3>Start with:</h3>
                        <select
                          className="lpb-parent-select"
                          value={student.parentRequestedTopicId ?? gradeTopics[0]?.id}
                          onChange={(e) => {
                            const newTopicId = Number(e.target.value)
                            const updatedStudent = {
                              ...student,
                              parentRequestedTopicId: newTopicId,
                            }
                            setStudent(updatedStudent)
                            const newSuggested = getSuggestedTopicIds(gradeTopics, updatedStudent)
                            setSelectedTopicIds(newSuggested)
                            const newTopicOrder = getDefaultTopicOrder(gradeTopics)
                            setTopicOrder(newTopicOrder)
                            if (plan !== null) {
                              const currentPlan = plan as GeneratedPlan
                              const nextBasePlan = buildLearningPlan({
                                topics: gradeTopics,
                                student: updatedStudent,
                                selectedTopicIds: newSuggested,
                                topicOrder: newTopicOrder,
                                manualAdjustments,
                                version: currentPlan.version + 1,
                              })
                              if (nextBasePlan.capacity.difference <= 0) {
                                setPlan({
                                  ...nextBasePlan,
                                  changesFromPrevious: mergePlanChanges(
                                    [
                                      `Parent requested starting topic changed to: ${topicById.get(newTopicId)?.name ?? "selected topic"}.`,
                                      "Prerequisite refreshers were re-scheduled before the requested topic.",
                                    ],
                                    describePlanChanges(currentPlan, nextBasePlan)
                                  ),
                                })
                              }
                            }
                          }}
                        >
                          {gradeTopics.map((topic) => (
                            <option key={topic.id} value={topic.id}>
                              Topic {topic.sequence}: {topic.name} ({topic.priority} priority, {topic.idealClasses} classes)
                            </option>
                          ))}
                        </select>
                      </div>
                      <p className="lpb-parent-subtext">
                        The plan will move unmet prerequisite topics forward as
                        compressed refreshers, then return to the normal
                        curriculum sequence.
                      </p>
                    </div>
                    <span className="lpb-request-pill">Requested start</span>
                  </div>
                ) : null}

                <footer className="lpb-setup-footer">
                  <button
                    type="button"
                    className="lpb-button lpb-button-secondary"
                    onClick={() => setSetupStep(1)}
                  >
                    <ArrowLeft size={16} />
                    Back
                  </button>
                  <button
                    type="button"
                    className="lpb-button lpb-button-primary"
                    onClick={runAiAnalysisOnChooseScope}
                  >
                    Choose topic scope
                    <ArrowRight size={16} />
                  </button>
                </footer>
              </>
            ) : null}

            {setupStep === 3 ? (
              <>
                <header className="lpb-section-head lpb-topic-scope-head">
                  <div>
                    <span className="lpb-section-no">03</span>
                    <h2>Choose the topic scope</h2>
                    <p>
                      Recommended topics are preselected. The teacher controls
                      the final scope.
                    </p>
                  </div>
                  <span className="lpb-count-chip">
                    {selectedTopicIds.length} selected
                  </span>
                </header>

                {aiLoading ? (
                  <div className="lpb-prereq-note" style={{ marginBottom: "14px" }}>
                    <Sparkles size={14} className="animate-spin lpb-prereq-note-icon" />
                    <span>Analyzing topic scope & prerequisites...</span>
                  </div>
                ) : student.parentRequestedTopicId && aiParentExplanation ? (
                  <div className="lpb-prereq-note" style={{ marginBottom: "14px" }}>
                    <Sparkles size={14} className="lpb-prereq-note-icon" />
                    <span>
                      <strong>Prerequisite note:</strong> {aiParentExplanation}
                    </span>
                  </div>
                ) : null}


                {manualOverrideActive ? (
                  <output className="lpb-manual-override-notice">
                    <LockKeyhole size={16} />
                    Manual change recorded — automatic updates stay paused until the next class data arrives.
                  </output>
                ) : null}

                <div className="lpb-topic-tools">
                  <div className="lpb-priority-legend">
                    {(["high", "medium", "low"] as const).map((priority) => (
                      <span key={priority} className={priority}>
                        <i />
                        {PRIORITY_COPY[priority].label}
                      </span>
                    ))}
                  </div>
                  <div>
                    <button
                      type="button"
                      onClick={() => {
                        setScopeMode("manual")
                        setManualOverrideActive(true)
                        setSelectedTopicIds(
                          gradeTopics
                            .filter(
                              (topic) =>
                                !student.completedTopics.some(
                                  (completed) => completed.topicId === topic.id
                                )
                            )
                            .map((topic) => topic.id)
                        )
                      }}
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setScopeMode("manual")
                        setManualOverrideActive(true)
                        setSelectedTopicIds(highTopicIds)
                      }}
                    >
                      Clear optional
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setScopeMode("manual")
                        setManualOverrideActive(true)
                        setSelectedTopicIds(suggestedTopicIds)
                      }}
                    >
                      Restore recommended
                    </button>
                  </div>
                </div>

                <p className="lpb-topic-order-hint">
                  <GripVertical size={15} />
                  Drag topics into the teaching sequence. High priority runs
                  first, then Medium and Low, except where a prerequisite has to
                  come earlier. A prerequisite already scored 75% or more is
                  kept but shortened to a refresher.
                </p>

                <div className="lpb-topic-list">
                  {displayTopics.map((topic) => {
                      const completed = student.completedTopics.some(
                        (item) => item.topicId === topic.id
                      )
                      const selected = selectedSet.has(topic.id)
                      const suggested = suggestedSet.has(topic.id)
                      const aiRecommendation = aiRecommendationById.get(
                        topic.id
                      )
                      const previewAllocation = reviewAllocationById.get(
                        topic.id
                      )
                      // Placement/mastery compression, or the Rule B2 capacity
                      // pass, can shorten a topic in either scope mode.
                      const evidenceCompressed =
                        selected &&
                        previewAllocation !== undefined &&
                        (previewAllocation.classes < topic.idealClasses ||
                          previewAllocation.activities < topic.idealActivities)
                      const capacityCompressed =
                        (previewAllocation?.compressedByCapacity ?? 0) > 0

                      const isRequestedStartTopic = student.parentRequestedTopicId === topic.id
                      const requestedPrereqChain = student.parentRequestedTopicId
                        ? getPrerequisiteChainLocal(student.parentRequestedTopicId, topicById)
                        : []
                      const isRequestedPrereqRefresher = requestedPrereqChain.includes(topic.id) && !completed

                      const directPrereqs = (topic.prerequisiteIds || [])
                        .map((id) => topicById.get(id))
                        .filter((t): t is CurriculumTopic => Boolean(t))
                        .filter((t) => !student.completedTopics.some((c) => c.topicId === t.id))

                      const dependentTopics = gradeTopics.filter(
                        (t) => selectedSet.has(t.id) && (t.prerequisiteIds || []).includes(topic.id)
                      )

                      const prereqSeqList = directPrereqs.map((t) => `#${positionLabel(t.id)}`).join(", ")
                      const depSeqList = dependentTopics.map((t) => `#${positionLabel(t.id)}`).join(", ")

                      const isClassCompressed =
                        selected &&
                        previewAllocation !== undefined &&
                        previewAllocation.classes < topic.idealClasses

                      const isAtMinimum =
                        selected &&
                        previewAllocation !== undefined &&
                        previewAllocation.classes <= topic.minimumClasses

                      const statusText = !selected
                        ? "Not selected"
                        : completed
                        ? "Completed"
                        : isAtMinimum
                        ? "At class minimum"
                        : isClassCompressed
                        ? "Compressed"
                        : topic.priority === "high"
                        ? "Full allocation"
                        : scopeMode === "evidence" && aiRecommendation?.decision === "defer"
                        ? "Deferred for capacity"
                        : scopeMode === "evidence"
                        ? "Evidence suggested"
                        : suggested
                        ? "Recommended"
                        : "Teacher added"

                      const statusTone = completed
                        ? "completed"
                        : statusText === "Full allocation" || statusText === "At class minimum" || statusText === "Recommended" || statusText === "Teacher added"
                        ? "green"
                        : statusText === "Compressed"
                        ? "amber"
                        : statusText === "Not selected"
                        ? "muted"
                        : "blue"

                      return (
                        <button
                          type="button"
                          key={topic.id}
                          disabled={completed}
                          draggable={!completed}
                          aria-disabled={completed}
                          className={`lpb-topic-option${selected ? " selected" : ""}${completed ? " completed" : ""}${draggedTopicId === topic.id ? " dragging" : ""}`}
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = "move"
                            event.dataTransfer.setData("text/plain", String(topic.id))
                            setDraggedTopicId(topic.id)
                          }}
                          onDragEnd={() => setDraggedTopicId(null)}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => {
                            event.preventDefault()
                            moveTopic(topic.id)
                          }}
                          onClick={() => toggleTopic(topic.id)}
                        >
                          <span className="lpb-topic-drag" title={`Drag ${topic.name} to reorder`}>
                            <GripVertical size={17} />
                          </span>
                          <span className="lpb-topic-check">
                            {completed || selected ? <Check size={14} /> : null}
                          </span>
                          <span className="lpb-topic-sequence">
                            {positionLabel(topic.id)}
                          </span>
                          <span className="lpb-topic-main">
                            <strong>{topic.name}</strong>
                            <small>
                              {topic.family} ·{" "}
                              {plural(
                                topic.learningObjectives.length,
                                "learning objective"
                              )}
                            </small>
                          </span>
                          <span
                            className={`lpb-priority-pill ${topic.priority}`}
                          >
                            {PRIORITY_COPY[topic.priority as Priority].label}
                          </span>
                          <span className="lpb-topic-metrics">
                            <b>
                              {selected && previewAllocation
                                ? previewAllocation.classes
                                : topic.idealClasses}
                            </b>
                            <small>
                              {evidenceCompressed
                                ? `of ${topic.idealClasses} · min ${topic.minimumClasses}`
                                : `classes · min ${topic.minimumClasses}`}
                            </small>
                          </span>
                          <span className="lpb-topic-metrics">
                            <b>
                              {selected && previewAllocation
                                ? previewAllocation.activities
                                : topic.idealActivities}
                            </b>
                            <small>
                              {evidenceCompressed
                                ? `of ${topic.idealActivities} activities`
                                : "activities"}
                            </small>
                          </span>
                          <span className="lpb-topic-state">
                            {isRequestedStartTopic ? (
                              <span className="lpb-prereq-badge requested">★ Requested Start</span>
                            ) : isRequestedPrereqRefresher ? (
                              <span className="lpb-prereq-badge refresher">⚡ Prerequisite Refresher</span>
                            ) : directPrereqs.length > 0 ? (
                              <span className="lpb-prereq-badge requires" title={`Needs ${directPrereqs.map((t) => t.name).join(", ")}`}>
                                Requires {prereqSeqList}
                              </span>
                            ) : dependentTopics.length > 0 ? (
                              <span className="lpb-prereq-badge prerequisite" title={`Prerequisite for ${dependentTopics.map((t) => t.name).join(", ")}`}>
                                Prereq for {depSeqList}
                              </span>
                            ) : null}
                            <span className={`lpb-status-pill ${statusTone}`}>
                              {statusText}
                            </span>
                          </span>
                        </button>
                      )
                    })}
                </div>

                <footer className="lpb-setup-footer">
                  <button
                    type="button"
                    className="lpb-button lpb-button-secondary"
                    onClick={() => setSetupStep(2)}
                  >
                    <ArrowLeft size={16} />
                    Back
                  </button>
                  <button
                    type="button"
                    className="lpb-button lpb-button-primary"
                    onClick={() => setSetupStep(4)}
                    disabled={selectedTopicIds.length === 0}
                  >
                    Review capacity
                    <ArrowRight size={16} />
                  </button>
                </footer>
              </>
            ) : null}

            {setupStep === 4 ? (
              <>
                <header className="lpb-section-head">
                  <div>
                    <span className="lpb-section-no">04</span>
                    <h2>Review before building</h2>
                    <p>
                      Check the selected scope, structural reserve and any
                      capacity warnings.
                    </p>
                  </div>
                  <span className="lpb-count-chip">
                    {reviewPlan.capacity.difference > 0
                      ? "Capacity warning"
                      : "Ready to build"}
                  </span>
                </header>

                <div className="lpb-review-layout">
                  <section className="lpb-capacity-card">
                    <div className="lpb-capacity-top">
                      <div>
                        <span className="lpb-kicker">Capacity check</span>
                        <h3>
                          {reviewPlan.capacity.difference > 0
                            ? `${reviewPlan.capacity.difference} classes over the package`
                            : reviewPlan.capacity.difference === 0
                              ? "Fits the package exactly"
                              : `Reduced by ${Math.abs(reviewPlan.capacity.difference)} classes`}
                        </h3>
                      </div>
                      <span
                        className={`lpb-capacity-orb${reviewPlan.capacity.difference > 0 ? " over" : ""}`}
                      >
                        {reviewPlan.capacity.total}
                        <small>planned</small>
                      </span>
                    </div>
                    {reviewPlan.capacity.compressedClasses > 0 ? (
                      <div className="lpb-placement-capacity-note">
                        <div className="lpb-placement-capacity-head">
                          <span>
                            <TrendingUp size={17} />
                            Compressed to fit the package
                          </span>
                          <b>−{reviewPlan.capacity.compressedClasses} classes</b>
                        </div>
                        <strong>
                          Topics were shortened toward their class minimums,
                          lowest priority first. No topic goes below its
                          minimum.
                        </strong>
                        <p>
                          {reviewPlan.allocations
                            .filter(
                              (allocation) =>
                                (allocation.compressedByCapacity ?? 0) > 0
                            )
                            .map(
                              (allocation) =>
                                `${allocation.topicName}: ${allocation.idealClasses} → ${allocation.classes} (min ${allocation.minimumClasses})`
                            )
                            .join(" · ")}
                        </p>
                      </div>
                    ) : null}
                    {reviewPlan.capacity.surplusClasses > 0 ? (
                      <div className="lpb-placement-capacity-note">
                        <div className="lpb-placement-capacity-head">
                          <span>
                            <TrendingUp size={17} />
                            Spare capacity reserved
                          </span>
                          <b>
                            +{reviewPlan.capacity.surplusClasses} classes
                          </b>
                        </div>
                        <strong>
                          Only the required classes are planned.
                        </strong>
                        <p>
                          The remaining{" "}
                          {reviewPlan.capacity.surplusClasses} classes are held
                          as &lsquo;Revision / School Help&rsquo; rather than
                          padded into topics.
                        </p>
                      </div>
                    ) : null}
                    {placementClassesSaved > 0 ? (
                      <div className="lpb-placement-capacity-note">
                        <div className="lpb-placement-capacity-head">
                          <span>
                            <TrendingUp size={17} />
                            Important capacity adjustment
                          </span>
                          <b>−{placementClassesSaved} classes</b>
                        </div>
                        <strong>
                          Strong placement reduced teaching from {reviewPlan.capacity.teaching + placementClassesSaved} to {reviewPlan.capacity.teaching} classes.
                        </strong>
                        <p>
                          {placementClassAdjustments
                            .map(
                              (adjustment) =>
                                `${adjustment.topicName} (${adjustment.score}%): ${adjustment.idealClasses} → ${adjustment.classes}`
                            )
                            .join(" · ")}
                        </p>
                      </div>
                    ) : null}
                    <div className="lpb-capacity-bar">
                      <span
                        style={{
                          width: `${Math.min(
                            100,
                            (reviewPlan.capacity.total /
                              reviewPlan.capacity.available) *
                              100
                          )}%`,
                        }}
                        className={
                          reviewPlan.capacity.difference > 0 ? "over" : ""
                        }
                      />
                    </div>
                    <div className="lpb-capacity-breakdown">
                      <div>
                        <span>In package</span>
                        <b>{reviewPlan.capacity.available}</b>
                      </div>
                      <div>
                        <span>Teaching</span>
                        <b>{reviewPlan.capacity.teaching}</b>
                      </div>
                      <div>
                        <span>Checkpoint &amp; RDP</span>
                        <b>{reviewPlan.capacity.structural}</b>
                      </div>
                      <div title="Parent–teacher meetings. Reserved against the package, scheduled by ops.">
                        <span>Ops reserve</span>
                        <b>{reviewPlan.capacity.opsReserve}</b>
                      </div>
                      <div>
                        <span>Planned</span>
                        <b>{reviewPlan.capacity.total}</b>
                      </div>
                    </div>
                    {reviewPlan.capacity.difference > 0 ? (
                      <div className="lpb-inline-warning">
                        <AlertTriangle size={18} />
                        <div>
                          <strong>
                            Plan is still over available capacity.
                          </strong>
                          <span>
                            {scopeMode === "evidence"
                              ? "Evidence provides a starting recommendation. Remove topics or adjust allocations before generating the plan."
                              : "Unselect topics or adjust allocations before generating the plan."}
                          </span>
                        </div>
                      </div>
                    ) : null}
                  </section>

                  <section className="lpb-review-list-card">
                    <div className="lpb-panel-title">
                      <ListChecks size={18} />
                      <div>
                        <h3>Selected plan scope</h3>
                        <p>
                          {plural(reviewPlan.allocations.length, "topic")} in
                          mentor-selected order
                        </p>
                      </div>
                    </div>
                    <div className="lpb-review-topic-list">
                      {reviewPlan.allocations.map((allocation, index) => {
                        const aiRecommendation = aiRecommendationById.get(
                          allocation.topicId
                        )
                        const isRequiredPrerequisite = !selectedSet.has(
                          allocation.topicId
                        )
                        return (
                          <div key={allocation.topicId}>
                            <span>{index + 1}</span>
                            <div>
                              <strong>{allocation.topicName}</strong>
                              <small>
                                {allocation.isCompressedRefresher
                                  ? "Compressed refresher · "
                                  : ""}
                                {allocation.classes} classes ·{" "}
                                {allocation.activities} activities
                              </small>
                              {scopeMode === "evidence" && aiRecommendation ? (
                                <em>
                                  {aiRecommendation.decision === "defer"
                                    ? `Teacher kept this topic. ${aiRecommendation.reason}`
                                    : aiRecommendation.reason}
                                </em>
                              ) : null}
                            </div>
                            <div className="lpb-review-topic-actions">
                              <span
                                className={`lpb-priority-pill ${allocation.priority}`}
                              >
                                {PRIORITY_COPY[allocation.priority].label}
                              </span>
                              {isRequiredPrerequisite ? (
                                <span className="lpb-required-topic">
                                  Required prerequisite
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => unselectTopic(allocation.topicId)}
                                  aria-label={`Unselect ${allocation.topicName}`}
                                >
                                  <X size={14} />
                                  Unselect
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </section>
                </div>

                <footer className="lpb-setup-footer">
                  <button
                    type="button"
                    className="lpb-button lpb-button-secondary"
                    onClick={() => setSetupStep(3)}
                  >
                    <ArrowLeft size={16} />
                    Back
                  </button>
                  <button
                    type="button"
                    className="lpb-button lpb-button-primary"
                    onClick={() => void buildPlan()}
                    disabled={
                      selectedTopicIds.length === 0 ||
                      contentGenerating ||
                      reviewPlan.capacity.difference > 0
                    }
                  >
                    <CalendarDays size={16} />
                    {reviewPlan.capacity.difference > 0
                      ? "Resolve capacity to build"
                      : contentGenerating
                      ? "Generating AI teaching guides…"
                      : "Build learning plan"}
                  </button>
                </footer>
              </>
            ) : null}
          </section>
        </main>
      ) : (
        <main className="lpb-plan-shell lpb-plan-minimal">
          <section className="lpb-plan-masthead">
            <div className="lpb-masthead-top">
            <div className="lpb-plan-student">
              <span className="lpb-avatar">{student.initials}</span>
              <div>
                <h1>{student.name}</h1>
                <p className="lpb-identity-meta">
                  <span>Grade {student.grade}</span>
                  <span>Plan v{plan.version}</span>
                  <span>
                    {plural(plan.allocations.length, "topic", "topics")}
                  </span>
                  <span>
                    {plan.capacity.teaching}/{plan.capacity.available} classes
                  </span>
                  {plan.capacity.difference > 0 ? (
                    <span className="over">
                      {plan.capacity.difference} over capacity
                    </span>
                  ) : null}
                </p>
              </div>
            </div>
            <div className="lpb-hero-actions">
              <button
                type="button"
                className="lpb-button lpb-button-secondary"
                onClick={() => {
                  if (savedPlanId) {
                    router.push("/learning-plan-builder")
                  } else {
                    returnToSetup()
                  }
                }}
              >
                <ArrowLeft size={16} />
                Back to setup
              </button>
              <button
                type="button"
                className="lpb-button lpb-button-ghost"
                onClick={returnToSetup}
              >
                Edit scope
              </button>
              <button
                type="button"
                className="lpb-button lpb-button-primary"
                onClick={() => setOutcomeOpen(true)}
                disabled={!nextTeachingItem}
              >
                Record outcome
              </button>
            </div>
            </div>

          {planStats ? (
            <div className="lpb-plan-stats" aria-label="Plan summary">
              <div>
                <span>Total classes</span>
                <b>{planStats.totalClasses}</b>
                <small>
                  {planStats.teachingClasses} teaching ·{" "}
                  {planStats.structuralClasses} structural
                </small>
              </div>
              <div>
                <span>Topics</span>
                <b>{planStats.topics}</b>
                <small>in the scheduled plan</small>
              </div>
              <div>
                <span>Activities</span>
                <b>{planStats.activities}</b>
                <small>starter + master</small>
              </div>
              <div>
                <span>Completed</span>
                <b>{planStats.completed}</b>
                <small>classes taught</small>
              </div>
              <div>
                <span>Upcoming</span>
                <b>{planStats.upcoming}</b>
                <small>
                  of {planStats.availableClasses} in the package
                </small>
              </div>
            </div>
          ) : null}

          {planStats && planStats.availableClasses > 0 ? (
            <div className="lpb-plan-progress">
              <div
                className="lpb-plan-progress-track"
                role="img"
                aria-label={`${planStats.completed} of ${planStats.totalClasses} scheduled classes taught, ${planStats.availableClasses} in the package`}
              >
                <span
                  className="taught"
                  style={{
                    width: `${(planStats.completed / planStats.availableClasses) * 100}%`,
                  }}
                />
                <span
                  className="scheduled"
                  style={{
                    width: `${(Math.max(planStats.totalClasses - planStats.completed, 0) / planStats.availableClasses) * 100}%`,
                  }}
                />
              </div>
              <p className="lpb-plan-progress-legend">
                <span className="taught">
                  {planStats.completed} taught
                </span>
                <span className="scheduled">
                  {Math.max(planStats.totalClasses - planStats.completed, 0)}{" "}
                  scheduled
                </span>
                {planStats.availableClasses - planStats.totalClasses > 0 ? (
                  <span className="free">
                    {planStats.availableClasses - planStats.totalClasses} unused
                  </span>
                ) : null}
              </p>
            </div>
          ) : null}
          </section>

          {(contentGenerating ||
            persistenceState !== "idle" ||
            plan.warnings.length > 0 ||
            manualOverrideActive) && (
            <div className="lpb-status-strip">
              {persistenceState === "saving" ? (
                <span className="lpb-status-chip generating">
                  <Save size={13} />
                  Saving plan changes…
                </span>
              ) : null}
              {persistenceState === "saved" ? (
                <span className="lpb-status-chip muted">
                  <CheckCircle2 size={13} />
                  Saved to plan history
                </span>
              ) : null}
              {databasePlanId ? (
                <Link
                  href={`/learning-plan-builder/${databasePlanId}`}
                  className="lpb-status-chip link"
                  title="Open this saved plan by id"
                >
                  <FileText size={13} />
                  Plan id: {databasePlanId.slice(0, 8)}…
                </Link>
              ) : null}
              {persistenceState === "error" ? (
                <span className="lpb-status-chip warning">
                  <CircleAlert size={13} />
                  Could not save changes. Try again after editing or recording an outcome.
                </span>
              ) : null}
              {contentGenerating ? (
                <span className="lpb-status-chip generating">
                  <Sparkles size={13} />
                  Writing teaching guides…
                </span>
              ) : null}
              {plan.warnings.map((warning) => (
                <button
                  key={warning.id}
                  type="button"
                  className="lpb-status-chip warning"
                  onClick={returnToSetup}
                >
                  <AlertTriangle size={13} />
                  {warning.title}
                </button>
              ))}
              {manualOverrideActive ? (
                <span className="lpb-status-chip manual">
                  <LockKeyhole size={13} />
                  Manual change recorded — automatic updates paused until the next class data arrives.
                </span>
              ) : null}
            </div>
          )}

          {plan.changesFromPrevious.length > 0 ? (
            <details className="lpb-plan-changes">
              <summary className="lpb-plan-changes-head">
                <Clock3 size={15} />
                <span className="lpb-kicker">Plan v{plan.version}</span>
                <b>What changed</b>
                <span className="lpb-changes-count">
                  {plural(plan.changesFromPrevious.length, "update", "updates")}
                </span>
                <ChevronDown size={15} className="lpb-changes-caret" />
              </summary>
              <div className="lpb-plan-changes-body">
              {classDiff &&
              (classDiff.addedCount > 0 ||
                classDiff.removed.length > 0 ||
                classDiff.movedCount > 0 ||
                classDiff.updatedCount > 0) ? (
                <div className="lpb-class-diff">
                  <div className="lpb-class-diff-chips">
                    {classDiff.addedCount > 0 ? (
                      <span className="added">
                        +{plural(classDiff.addedCount, "class", "classes")} added
                      </span>
                    ) : null}
                    {classDiff.skippedCount > 0 ? (
                      <span className="skipped">
                        {plural(classDiff.skippedCount, "class", "classes")}{" "}
                        skipped
                      </span>
                    ) : null}
                    {classDiff.removed.length > 0 ? (
                      <span className="removed">
                        −{plural(classDiff.removed.length, "class", "classes")}{" "}
                        removed
                      </span>
                    ) : null}
                    {classDiff.movedCount > 0 ? (
                      <span className="moved">
                        {plural(classDiff.movedCount, "class", "classes")}{" "}
                        renumbered
                      </span>
                    ) : null}
                    {classDiff.updatedCount > 0 ? (
                      <span className="updated">
                        {plural(classDiff.updatedCount, "class", "classes")}{" "}
                        updated
                      </span>
                    ) : null}
                  </div>
                  {classDiff.skippedCount > 0 ? (
                    <p className="lpb-class-diff-removed">
                      Skipped classes keep their slot, so no class after them
                      was renumbered.
                    </p>
                  ) : null}
                  {classDiff.removed.length > 0 ? (
                    <p className="lpb-class-diff-removed">
                      Removed:{" "}
                      {classDiff.removed
                        .map(
                          (entry) =>
                            `Class ${String(entry.classNumber).padStart(2, "0")} ${entry.label}`
                        )
                        .join(" · ")}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <ul>
                {plan.changesFromPrevious.map((change) => (
                  <li key={change}>{change}</li>
                ))}
              </ul>
              </div>
            </details>
          ) : null}

          <div className="lpb-plan-grid lpb-plan-grid-minimal">
            <div className="lpb-plan-main">
              <section className="lpb-plan-board lpb-plan-board-minimal">
                <header className="lpb-plan-board-head">
                  <div>
                    <h2>Sequence</h2>
                    <p className="lpb-board-meta">
                      {liveClassCount} classes
                      {skippedClassCount > 0
                        ? ` · ${skippedClassCount} skipped`
                        : ""}
                      {nextTeachingItem
                        ? ` · next: ${planItemPrimaryLabel(nextTeachingItem)}`
                        : ""}
                    </p>
                  </div>
                  <div className="lpb-view-tabs">
                    <button
                      type="button"
                      className={planTab === "classes" ? "active" : ""}
                      onClick={() => setPlanTab("classes")}
                    >
                      Classes
                    </button>
                    <button
                      type="button"
                      className={planTab === "topics" ? "active" : ""}
                      onClick={() => setPlanTab("topics")}
                    >
                      Topics
                    </button>
                    <button
                      type="button"
                      className={planTab === "structure" ? "active" : ""}
                      onClick={() => setPlanTab("structure")}
                    >
                      Structure
                    </button>
                    <button
                      type="button"
                      className={planTab === "next2weeks" ? "active" : ""}
                      onClick={() => setPlanTab("next2weeks")}
                    >
                      2 weeks
                    </button>
                    <button
                      type="button"
                      className={planTab === "mentor" ? "active" : ""}
                      onClick={() => setPlanTab("mentor")}
                    >
                      Mentor view
                    </button>
                    <button
                      type="button"
                      className={planTab === "methodology" ? "active" : ""}
                      onClick={() => setPlanTab("methodology")}
                    >
                      Methodology
                    </button>
                  </div>
                </header>

                {planTab === "classes" ? (
                  <div className="lpb-class-list">
                    {plan.items.map((item) => {
                      const expanded = expandedItemId === item.id
                      const displayStatus =
                        item.status === "skipped"
                          ? "skipped"
                          : item.classNumber <= completedCount
                            ? "completed"
                            : item.id === nextUpItem?.id
                              ? "next"
                              : "planned"
                      const diff = classDiff?.byItemId[item.id]
                      return (
                        <article
                          key={item.id}
                          className={`lpb-class-row ${item.kind} ${displayStatus}${diff ? ` diff-${diff.type}` : ""}`}
                        >
                          <button
                            type="button"
                            className="lpb-class-summary"
                            onClick={() =>
                              setExpandedItemId(expanded ? null : item.id)
                            }
                          >
                            <span className="lpb-class-number">
                              {displayStatus === "completed" ? (
                                <Check size={15} />
                              ) : (
                                <>Class {String(item.classNumber).padStart(2, "0")}</>
                              )}
                            </span>
                            <span className="lpb-class-title">
                              <strong>{planItemPrimaryLabel(item)}</strong>
                              <small>{planItemSecondaryLabel(item)}</small>
                            </span>
                            <span className="lpb-class-badges">
                              {item.kind === "teaching" ? (
                                <span className="lpb-class-activity-badge">
                                  {item.easyActivities + item.practiceActivities} activities
                                </span>
                              ) : (
                                <span
                                  className={`lpb-class-kind-badge ${item.kind}`}
                                >
                                  {item.kind === "checkpoint" ? (
                                    <ClipboardCheck size={12} />
                                  ) : item.kind === "rdp" ? (
                                    <RotateCcw size={12} />
                                  ) : (
                                    <UsersRound size={12} />
                                  )}
                                  {KIND_COPY[item.kind].short}
                                </span>
                              )}
                              {item.status === "skipped" ? (
                                <span className="lpb-diff-badge skipped">
                                  Skipped
                                </span>
                              ) : diff ? (
                                <span className={`lpb-diff-badge ${diff.type}`}>
                                  {diff.type === "added"
                                    ? "New"
                                    : diff.type === "moved"
                                      ? `Was Class ${String(diff.fromClassNumber).padStart(2, "0")}`
                                      : "Updated"}
                                </span>
                              ) : null}
                              {displayStatus === "next" ? (
                                <span className="lpb-status-badge next">Next</span>
                              ) : displayStatus === "completed" ? (
                                <span className="lpb-status-badge completed">
                                  Done
                                </span>
                              ) : null}
                            </span>
                            {expanded ? (
                              <ChevronDown size={17} />
                            ) : (
                              <ChevronRight size={17} />
                            )}
                          </button>
                          {displayStatus === "planned" &&
                          item.status !== "skipped" ? (
                            <button
                              type="button"
                              className="lpb-class-fastforward"
                              onClick={() =>
                                fastForwardTo(item.classNumber - 1)
                              }
                              title={`Mark Classes ${String(completedCount + 1).padStart(2, "0")}–${String(item.classNumber - 1).padStart(2, "0")} as taught on track, then stop here`}
                            >
                              <FastForward size={12} />
                              Teach to here
                            </button>
                          ) : null}
                          {expanded ? (
                            <div className="lpb-class-detail">
                              {item.kind === "teaching" ? (
                                <ClassLessonGuide
                                  item={item}
                                  student={student}
                                  contentGenerating={contentGenerating}
                                  contentSource={contentSource}
                                />
                              ) : (
                                <div className="lpb-lesson-plan-card">
                                  <div className="lpb-lesson-header">
                                    <BookOpen size={18} />
                                    <div>
                                      <h4>{KIND_COPY[item.kind].label}</h4>
                                      <p>{item.reason}</p>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : null}
                        </article>
                      )
                    })}
                  </div>
                ) : planTab === "topics" ? (
                  <div className="lpb-allocation-grid">
                    {plan.allocations.map((allocation, index) => (
                      <article
                        className="lpb-allocation-card"
                        key={allocation.topicId}
                      >
                        <div className="lpb-allocation-top">
                          <span className="lpb-allocation-index">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <span
                            className={`lpb-priority-pill ${allocation.priority}`}
                          >
                            {PRIORITY_COPY[allocation.priority].label}
                          </span>
                          {allocation.manuallyEdited ? (
                            <span className="lpb-lock-chip">
                              <LockKeyhole size={11} />
                              Teacher locked
                            </span>
                          ) : null}
                        </div>
                        <h3>{allocation.topicName}</h3>
                        <p>{allocation.reasons.at(-1)}</p>
                        <div className="lpb-allocation-stats">
                          <div>
                            <b>{allocation.classes}</b>
                            <span>classes</span>
                          </div>
                          <div>
                            <b>{allocation.activities}</b>
                            <span>activities</span>
                          </div>
                          <div>
                            <b>
                              {allocation.easyPercent}:
                              {allocation.practicePercent}
                            </b>
                            <span>Easy : Practice</span>
                          </div>
                        </div>
                        <div className="lpb-allocation-actions">
                          <button
                            type="button"
                            onClick={() => setDetailTopicId(allocation.topicId)}
                          >
                            <Eye size={14} />
                            View progression
                          </button>
                          <button
                            type="button"
                            onClick={() => startEdit(allocation.topicId)}
                          >
                            <Edit3 size={14} />
                            Edit
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : planTab === "structure" ? (
                  <div className="lpb-structural-view">
                    <header>
                      <span className="lpb-detail-label">Structural classes</span>
                      <h3>{plan.capacity.structural} checkpoint &amp; RDP classes</h3>
                      <p>
                        Checkpoints assess the preceding block and produce the
                        evidence that resizes the rest of the plan. Each is
                        followed by revision, doubts and practice where capacity
                        allows — RDP is dropped first when the plan is tight.
                        {plan.capacity.opsReserve > 0
                          ? ` A further ${plan.capacity.opsReserve} ${plan.capacity.opsReserve === 1 ? "class is" : "classes are"} reserved for parent–teacher meetings, which ops schedules on its own calendar.`
                          : ""}
                      </p>
                    </header>
                    <div className="lpb-structural-list">
                      {structuralItems.map((item) => (
                        <article key={item.id} className={item.kind}>
                          <span>Class {String(item.classNumber).padStart(2, "0")}</span>
                          <div>
                            <strong>{KIND_COPY[item.kind].label}</strong>
                            <p>{item.title} · {item.reason}</p>
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                ) : planTab === "next2weeks" ? (
                  <div className="lpb-next2weeks-view">
                    {(() => {
                      const classesPerWeek = student.classesPerWeek ?? 2
                      const twoWeekClassCount = classesPerWeek * 2
                      return (
                        <>
                          <div className="lpb-next2weeks-header">
                            <h3>Descriptive Plan for Next 2 Weeks</h3>
                            <p>
                              Based on {student.name}&rsquo;s schedule of {classesPerWeek} classes/week ({twoWeekClassCount} classes over 2 weeks).
                            </p>
                          </div>

                          {plan.allocations[0] && plan.allocations[0].classes <= 2 ? (
                            <div className="lpb-test-warning-banner">
                              <AlertTriangle size={18} />
                              <div>
                                <strong>Topic Test Scheduled in Next 2 Weeks</strong>
                                <p>
                                  Less than 2 classes remaining for topic &ldquo;{plan.allocations[0].topicName}&rdquo;. A topic test will be conducted in the next 2 weeks to evaluate mastery before transitioning.
                                </p>
                              </div>
                            </div>
                          ) : null}

                          <div className="lpb-next2weeks-list">
                            {plan.items.slice(0, twoWeekClassCount).map((item, idx) => (
                              <div key={item.id} className="lpb-next2weeks-card">
                                <span className="lpb-next2weeks-num">Class {idx + 1}</span>
                                <div style={{ flex: 1 }}>
                                  <h4>{planItemPrimaryLabel(item)}</h4>
                                  <p>{planItemSecondaryLabel(item)}</p>
                                  {item.learningObjectives.length > 0 ? (
                                    <ul className="lpb-next2weeks-los">
                                      {item.learningObjectives.map((lo) => (
                                        <li key={lo.id}>{lo.text}</li>
                                      ))}
                                    </ul>
                                  ) : null}
                                </div>
                                <span className="lpb-next2weeks-badge">
                                  {item.easyActivities + item.practiceActivities} Questions
                                </span>
                              </div>
                            ))}
                          </div>
                        </>
                      )
                    })()}
                  </div>
                ) : planTab === "mentor" ? (
                  <div className="lpb-mentor-view">
                    <section className="lpb-mentor-snapshot">
                      <div>
                        <span>Classes remaining</span>
                        <b>{student.classesRemaining}</b>
                      </div>
                      <div>
                        <span>Topics completed</span>
                        <b>{student.completedTopics.length} of 13</b>
                      </div>
                      <div>
                        <span>Current topic</span>
                        <b>{mentorTopic?.topicName ?? "No topic selected"}</b>
                      </div>
                      <div>
                        <span>Structural classes</span>
                        <b>{plan.capacity.structural} planned</b>
                      </div>
                    </section>

                    <section className="lpb-mentor-timeline">
                      <span className="lpb-detail-label">Plan at a glance</span>
                      <div>
                        {student.completedTopics.map((completed) => (
                          <span className="done" key={completed.topicId}>
                            {topicById.get(completed.topicId)?.name}
                          </span>
                        ))}
                        {plan.allocations.map((allocation) => (
                          <button
                            type="button"
                            className={allocation.topicId === mentorTopic?.topicId ? "current" : ""}
                            key={allocation.topicId}
                            onClick={() => setMentorTopicId(allocation.topicId)}
                            aria-pressed={allocation.topicId === mentorTopic?.topicId}
                            title={`Show the mentor plan for ${allocation.topicName}`}
                          >
                            {allocation.topicName} ({allocation.classes})
                          </button>
                        ))}
                        {structuralItems.filter((item) => item.kind === "checkpoint").map((item) => (
                          <span className="checkpoint" key={item.id}>{item.title}</span>
                        ))}
                      </div>
                    </section>

                    <section className="lpb-mentor-diagnosis">
                      <div className="lpb-mentor-section-head">
                        <div>
                          <span className="lpb-detail-label">
                            Question-level diagnosis ·{" "}
                            {mentorTopicId !== null
                              ? "selected topic"
                              : "active topic"}
                          </span>
                          <h3>{mentorTopic?.topicName ?? "Selected topic"}</h3>
                        </div>
                        <div className="lpb-mentor-head-actions">
                          {mentorTopicId !== null ? (
                            <button
                              type="button"
                              onClick={() => setMentorTopicId(null)}
                            >
                              <RotateCcw size={14} /> Active topic
                            </button>
                          ) : null}
                          {mentorTopic ? (
                            <button type="button" onClick={() => startEdit(mentorTopic.topicId)}>
                              <SlidersHorizontal size={14} /> Adjust classes
                            </button>
                          ) : null}
                        </div>
                      </div>
                      {mentorTopic ? (
                        <div className="lpb-mentor-table-wrap">
                          {isNewStudent ? (
                            <p className="lpb-mentor-guidance">Starter and Master questions are shown as teaching guidance because this student has no attempt data yet.</p>
                          ) : null}
                          <table>
                            <thead><tr><th>Learning objective</th>{!isNewStudent ? <th>Level</th> : null}<th>Starter question</th><th>Master question</th></tr></thead>
                            <tbody>
                              {mentorTopic.learningObjectives.map((objective) => {
                                const guideline = questionGuidelines.find((item) => item.learningObjectiveId === objective.id)
                                const level = mentorObjectiveLevels.get(objective.id) ?? "not_attempted"
                                return <tr key={objective.id}>
                                  <td>{objective.text}</td>
                                  {!isNewStudent ? <td><span className={`lpb-diagnosis-pill ${level === "master" ? "secure" : level === "stuck" ? "support" : "neutral"}`}>{mentorLevelCopy(level)}</span></td> : null}
                                  <td>{guideline?.starter ?? "No supplied question"}</td>
                                  <td>{guideline?.master ?? "No supplied question"}</td>
                                </tr>
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : null}
                    </section>

                    <section className="lpb-mentor-stuck">
                      <div className="lpb-mentor-section-head">
                        <div>
                          <span className="lpb-detail-label">
                            Where the student is stuck
                          </span>
                          <h3>
                            {mentorStuckTopics.length > 0
                              ? `${mentorStuckTopics.length} ${mentorStuckTopics.length === 1 ? "topic" : "topics"} across the plan`
                              : "No stuck objectives in the evidence"}
                          </h3>
                        </div>
                      </div>
                      {mentorStuckTopics.length > 0 ? (
                        <div className="lpb-mentor-stuck-list">
                          {mentorStuckTopics.map((diagnostic) => (
                            <article
                              key={diagnostic.allocation.topicId}
                              className={
                                diagnostic.allocation.topicId ===
                                mentorTopic?.topicId
                                  ? "focused"
                                  : undefined
                              }
                            >
                              <header>
                                <button
                                  type="button"
                                  className="lpb-stuck-focus"
                                  onClick={() =>
                                    setMentorTopicId(
                                      diagnostic.allocation.topicId
                                    )
                                  }
                                  title={`Show the mentor plan for ${diagnostic.allocation.topicName}`}
                                >
                                  <Eye size={12} />
                                  Open
                                </button>
                                <strong>
                                  {diagnostic.allocation.topicName}
                                </strong>
                                <span className="lpb-diagnosis-pill support">
                                  {diagnostic.stuck.length} of{" "}
                                  {
                                    diagnostic.allocation.learningObjectives
                                      .length
                                  }{" "}
                                  not secure
                                </span>
                                {diagnostic.allocation.classes >
                                diagnostic.allocation.idealClasses ? (
                                  <span className="lpb-diagnosis-pill neutral">
                                    Extended to{" "}
                                    {diagnostic.allocation.classes} classes
                                  </span>
                                ) : null}
                              </header>
                              <div className="lpb-mentor-accuracy">
                                <span>
                                  Starter{" "}
                                  <b>
                                    {diagnostic.starter
                                      ? `${diagnostic.starter.correct}/${diagnostic.starter.attempted}`
                                      : "—"}
                                  </b>
                                </span>
                                <span>
                                  Master{" "}
                                  <b>
                                    {diagnostic.master
                                      ? `${diagnostic.master.correct}/${diagnostic.master.attempted}`
                                      : "—"}
                                  </b>
                                </span>
                              </div>
                              <p>
                                {diagnostic.stuck
                                  .map((objective) => objective.text)
                                  .join(" · ")}
                              </p>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <p className="lpb-mentor-guidance">
                          No objective has come back not-secure yet. Keep
                          checkpoint results up to date — the plan resizes
                          topics from them.
                        </p>
                      )}
                    </section>

                    <section className="lpb-mentor-next">
                      <Lightbulb size={18} />
                      <div>
                        <span className="lpb-detail-label">
                          What to fix in upcoming classes
                        </span>
                        {mentorActions.length > 0 ? (
                          <ul className="lpb-mentor-actions">
                            {mentorActions.map((action) => (
                              <li key={action.topicId}>
                                <strong>{action.topicName}</strong>
                                <span>{action.instruction}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p>{mentorFixText}</p>
                        )}
                      </div>
                    </section>
                  </div>
                ) : (
                  <MethodologyView plan={plan} student={student} />
                )}
              </section>

              {plan.droppedTopics.length > 0 ? (
                <section className="lpb-dropped-minimal">
                  <span className="lpb-detail-label">
                    Not scheduled · {plan.droppedTopics.length}
                  </span>
                  <div className="lpb-dropped-list">
                    {plan.droppedTopics.map((topic) => (
                      <article
                        key={topic.topicId}
                      >
                        <div>
                          <strong>{topic.topicName}</strong>
                          <span className={`lpb-priority-pill ${topic.priority}`}>
                            {PRIORITY_COPY[topic.priority].label}
                          </span>
                        </div>
                        <p>{topic.reason}</p>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          </div>
        </main>
      )}

      <MethodologySidebar
        open={methodologyOpen}
        onClose={() => setMethodologyOpen(false)}
        context={methodologyContext}
        student={student}
        topics={gradeTopics}
        // Before the plan is built, `reviewPlan` holds the same allocations and
        // capacity the review screen is showing, so the panel can explain the
        // arithmetic on screen rather than waiting for a build.
        plan={plan ?? reviewPlan}
        selectedTopicIds={selectedTopicIds}
        onOpenFullMethodology={
          plan
            ? () => {
                setPlanTab("methodology")
                setMethodologyOpen(false)
              }
            : undefined
        }
      />

      {activeEditAllocation && editDraft ? (
        <div
          className="lpb-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setEditingTopicId(null)
              setEditDraft(null)
            }
          }}
        >
          <aside className="lpb-drawer" aria-label="Edit topic allocation">
            <header>
              <div>
                <span className="lpb-kicker">Teacher override</span>
                <h2>Edit {activeEditAllocation.topicName}</h2>
                <p>
                  Preview the new capacity after saving. This override will be
                  locked into the next plan version.
                </p>
              </div>
              <button
                type="button"
                className="lpb-icon-button"
                onClick={() => {
                  setEditingTopicId(null)
                  setEditDraft(null)
                }}
                aria-label="Close edit panel"
              >
                <X size={18} />
              </button>
            </header>

            <div className="lpb-edit-form">
              <div className="lpb-edit-field">
                <span>
                  Classes
                  <small>
                    Workbook ideal: {activeEditAllocation.idealClasses} ·
                    minimum: {activeEditAllocation.minimumClasses}
                  </small>
                </span>
                <div className="lpb-step-input">
                  <button
                    type="button"
                    onClick={() =>
                      setEditDraft((current) =>
                        current
                          ? {
                              ...current,
                              classes: Math.max(1, current.classes - 1),
                            }
                          : current
                      )
                    }
                  >
                    −
                  </button>
                  <b>{editDraft.classes}</b>
                  <button
                    type="button"
                    onClick={() =>
                      setEditDraft((current) =>
                        current
                          ? { ...current, classes: current.classes + 1 }
                          : current
                      )
                    }
                  >
                    +
                  </button>
                </div>
              </div>

              <label>
                <span>
                  Activities
                  <small>Current: {activeEditAllocation.activities}</small>
                </span>
                <input
                  type="number"
                  min={0}
                  value={editDraft.activities}
                  onChange={(event) =>
                    setEditDraft((current) =>
                      current
                        ? {
                            ...current,
                            activities: Number(event.target.value),
                          }
                        : current
                    )
                  }
                />
              </label>

              <label className="lpb-split-field">
                <span>
                  Activity split
                  <small>
                    {editDraft.easyPercent}% Easy ·{" "}
                    {100 - editDraft.easyPercent}% Practice
                  </small>
                </span>
                <input
                  type="range"
                  min={30}
                  max={80}
                  step={5}
                  value={editDraft.easyPercent}
                  onChange={(event) =>
                    setEditDraft((current) =>
                      current
                        ? {
                            ...current,
                            easyPercent: Number(event.target.value),
                          }
                        : current
                    )
                  }
                />
                <div>
                  <span>More Practice</span>
                  <span>More Easy</span>
                </div>
              </label>
            </div>

            <div className="lpb-edit-impact">
              <span className="lpb-kicker">Impact preview</span>
              <div>
                <span>
                  Current plan
                  <b>{plan?.capacity.total}</b>
                </span>
                <ArrowRight size={16} />
                <span>
                  After edit
                  <b>
                    {(plan?.capacity.total ?? 0) -
                      activeEditAllocation.classes +
                      editDraft.classes}
                  </b>
                </span>
              </div>
              {(plan?.capacity.total ?? 0) -
                activeEditAllocation.classes +
                editDraft.classes >
              student.classesRemaining ? (
                <p>
                  <AlertTriangle size={15} />
                  The over-capacity warning will remain visible.
                </p>
              ) : (
                <p className="fits">
                  <Check size={15} />
                  This edit fits within the available capacity.
                </p>
              )}
              {editDraft.classes < activeEditAllocation.minimumClasses ? (
                <p>
                  <AlertTriangle size={15} />
                  Below the {activeEditAllocation.minimumClasses}-class minimum
                  for this topic. Automatic rules never go this low—only a
                  teacher can.
                </p>
              ) : null}
            </div>

            <footer>
              <button
                type="button"
                className="lpb-button lpb-button-secondary"
                onClick={() => {
                  setEditingTopicId(null)
                  setEditDraft(null)
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="lpb-button lpb-button-primary"
                onClick={saveTopicEdit}
                disabled={editWouldExceedCapacity}
              >
                <Save size={15} />
                {editWouldExceedCapacity
                  ? "Reduce classes to save"
                  : "Save new version"}
              </button>
            </footer>
          </aside>
        </div>
      ) : null}

      {activeDetailTopic ? (
        <div
          className="lpb-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDetailTopicId(null)
          }}
        >
          <section className="lpb-detail-modal">
            <header>
              <div>
                <span className="lpb-kicker">Detailed Plan Viewer</span>
                <h2>{activeDetailTopic.name}</h2>
                <p>
                  Starter-to-Master question guidance for each learning
                  objective.
                </p>
              </div>
              <button
                type="button"
                className="lpb-icon-button"
                onClick={() => setDetailTopicId(null)}
                aria-label="Close detailed plan viewer"
              >
                <X size={18} />
              </button>
            </header>

            <div className="lpb-progression-key">
              <span>
                <i className="starter" /> Starter: familiar, single-step
              </span>
              <span>
                <i className="master" /> Master: new context, multi-step
              </span>
              <span>
                <i className="evidence" /> Current activity evidence
              </span>
            </div>

            {student.objectiveEvidence.length > 0 &&
            activeDetailTopic.id === student.currentTopicId ? (
              <div className="lpb-mentor-focus-box">
                <Lightbulb size={18} />
                <div>
                  <strong>Mentor Teaching Focus (Activity Evidence)</strong>
                  <p>
                    Student solves Starter-level HCF & LCM questions correctly, but gets Master-level word problems wrong on &ldquo;Apply HCF and LCM to real-world problems&rdquo; and factor trees. Next classes should focus on applying HCF/LCM to real-world word problems and index notation.
                  </p>
                </div>
              </div>
            ) : null}

            <div className="lpb-objective-list">
              {activeDetailTopic.learningObjectives.map(
                (learningObjective, index) => {
                  const guideline = questionGuidelines.find(
                    (item) => item.learningObjectiveId === learningObjective.id
                  )
                  const evidence = student.objectiveEvidence.find(
                    (item) => item.learningObjectiveId === learningObjective.id
                  )
                  return (
                    <article key={learningObjective.id}>
                      <div className="lpb-objective-head">
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        <div>
                          <small>{learningObjective.subtopic}</small>
                          <h3>{learningObjective.text}</h3>
                        </div>
                        {evidence ? (
                          <span
                            className={`lpb-current-level ${evidence.result}`}
                          >
                            {evidence.result === "secure"
                              ? "Secure at Starter"
                              : "Not secure at Master"}
                          </span>
                        ) : (
                          <span className="lpb-current-level no-data">
                            No activity evidence
                          </span>
                        )}
                      </div>

                      {guideline ? (
                        <div className="lpb-question-pair">
                          <div>
                            <span>Starter question</span>
                            <p>{guideline.starter}</p>
                          </div>
                          <span className="lpb-question-arrow">
                            <ArrowRight size={17} />
                          </span>
                          <div>
                            <span>Master question</span>
                            <p>{guideline.master}</p>
                          </div>
                        </div>
                      ) : (
                        <div className="lpb-no-guideline">
                          <FileText size={16} />A Starter/Master question pair
                          was not supplied for this objective in the dummy
                          workbook.
                        </div>
                      )}

                      {evidence ? (
                        <div
                          className={`lpb-evidence-callout ${evidence.result}`}
                        >
                          {evidence.result === "secure" ? (
                            <CheckCircle2 size={16} />
                          ) : (
                            <CircleAlert size={16} />
                          )}
                          <div>
                            <span>Current evidence</span>
                            <p>{evidence.note}</p>
                          </div>
                        </div>
                      ) : null}
                    </article>
                  )
                }
              )}
            </div>

            <footer>
              <span className="lpb-modal-lock-note">
                <LockKeyhole size={14} />
                <span>Questions are workbook samples—no live generation.</span>
              </span>
              <button
                type="button"
                className="lpb-button lpb-button-primary"
                onClick={() => setDetailTopicId(null)}
              >
                Done
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {outcomeOpen && nextTeachingItem ? (
        <div
          className="lpb-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setOutcomeOpen(false)
              setPendingUpdate(null)
            }
          }}
        >
          <section className="lpb-outcome-modal">
            <header>
              <div>
                <span className="lpb-kicker">
                  After Class {nextTeachingItem.classNumber}
                </span>
                <h2>
                  {pendingUpdate
                    ? "Review the plan update"
                    : "How did the class go?"}
                </h2>
                <p>
                  {pendingUpdate
                    ? "Nothing changes until the teacher approves this version."
                    : planItemPrimaryLabel(nextTeachingItem)}
                </p>
              </div>
              <button
                type="button"
                className="lpb-icon-button"
                onClick={() => {
                  setOutcomeOpen(false)
                  setPendingUpdate(null)
                }}
                aria-label="Close class outcome"
              >
                <X size={18} />
              </button>
            </header>

            {pendingUpdate ? (
              <>
                <div className="lpb-update-comparison">
                  <div>
                    <span>Current plan</span>
                    <b>{plan?.capacity.total} classes</b>
                    <small>Version {plan?.version}</small>
                  </div>
                  <ArrowRight size={20} />
                  <div>
                    <span>Proposed plan</span>
                    <b>{pendingUpdate.plan.capacity.total} classes</b>
                    <small>Version {pendingUpdate.plan.version}</small>
                  </div>
                </div>
                {outcomeImpact ? (
                  <div className="lpb-alloc-impact">
                    <div className="lpb-alloc-impact-head">
                      <span className="lpb-detail-label">
                        {outcomeImpact.topicName} · allocation
                      </span>
                      <b
                        className={
                          outcomeImpact.delta > 0
                            ? "up"
                            : outcomeImpact.delta < 0
                              ? "down"
                              : "flat"
                        }
                      >
                        {outcomeImpact.delta > 0
                          ? `+${outcomeImpact.delta} class`
                          : outcomeImpact.delta < 0
                            ? `${outcomeImpact.delta} class`
                            : "No change"}
                      </b>
                    </div>
                    <div className="lpb-alloc-scale">
                      {Array.from(
                        { length: outcomeImpact.scaleMax },
                        (_, index) => {
                          const slot = index + 1
                          const state =
                            slot <= outcomeImpact.taught
                              ? "taught"
                              : slot <= outcomeImpact.nextTotal
                                ? slot > outcomeImpact.currentTotal
                                  ? "gained"
                                  : "remaining"
                                : slot <= outcomeImpact.currentTotal
                                  ? "released"
                                  : "empty"
                          return (
                            <i
                              key={`alloc-slot-${slot}`}
                              className={state}
                              data-minimum={
                                slot === outcomeImpact.minimum ? "true" : undefined
                              }
                            />
                          )
                        }
                      )}
                    </div>
                    <div className="lpb-alloc-legend">
                      <span className="taught">
                        Taught {outcomeImpact.taught}
                      </span>
                      <span className="remaining">
                        Remaining {outcomeImpact.nextRemaining}
                      </span>
                      <span className="floor">
                        Minimum {outcomeImpact.minimum}
                      </span>
                      <span className="ideal">
                        Ideal {outcomeImpact.ideal}
                      </span>
                    </div>
                    <p>{outcomeImpact.explanation}</p>
                  </div>
                ) : null}
                <div className="lpb-update-list">
                  {pendingUpdate.changes.map((change) => (
                    <div key={change}>
                      <Check size={14} />
                      <span>{change}</span>
                    </div>
                  ))}
                </div>
                {pendingUpdate.plan.capacity.difference > 0 ? (
                  <div className="lpb-inline-warning">
                    <AlertTriangle size={18} />
                    <div>
                      <strong>
                        The updated plan is{" "}
                        {pendingUpdate.plan.capacity.difference} classes over
                        capacity.
                      </strong>
                      <span>The warning will stay visible after approval.</span>
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <div className="lpb-outcome-options">
                  <button
                    type="button"
                    className={outcome === "faster" ? "selected" : ""}
                    onClick={() => setOutcome("faster")}
                  >
                    <TrendingUp size={20} />
                    <strong>Completed faster</strong>
                    <span>Return one class to the pool</span>
                  </button>
                  <button
                    type="button"
                    className={outcome === "on-track" ? "selected" : ""}
                    onClick={() => setOutcome("on-track")}
                  >
                    <CheckCircle2 size={20} />
                    <strong>On track</strong>
                    <span>Keep the approved allocation</span>
                  </button>
                  <button
                    type="button"
                    className={outcome === "needs-time" ? "selected" : ""}
                    onClick={() => setOutcome("needs-time")}
                  >
                    <Clock3 size={20} />
                    <strong>Needs more time</strong>
                    <span>Add reinforcement, up to +2</span>
                  </button>
                </div>
                <label className="lpb-note-field">
                  <span>
                    Optional teacher note
                    <small>Saved as evidence; not interpreted by AI</small>
                  </span>
                  <textarea
                    value={outcomeNote}
                    onChange={(event) => setOutcomeNote(event.target.value)}
                    placeholder="What did the student understand or struggle with?"
                    rows={4}
                  />
                </label>
              </>
            )}

            <footer>
              {pendingUpdate ? (
                <>
                  <button
                    type="button"
                    className="lpb-button lpb-button-secondary"
                    onClick={() => setPendingUpdate(null)}
                  >
                    <ArrowLeft size={15} />
                    Change outcome
                  </button>
                  <button
                    type="button"
                    className="lpb-button lpb-button-primary"
                    onClick={approveClassOutcome}
                  >
                    <Check size={15} />
                    Approve version {pendingUpdate.plan.version}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="lpb-button lpb-button-secondary"
                    onClick={() => setOutcomeOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="lpb-button lpb-button-primary"
                    onClick={previewClassOutcome}
                  >
                    Preview plan update
                    <ArrowRight size={15} />
                  </button>
                </>
              )}
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  )
}

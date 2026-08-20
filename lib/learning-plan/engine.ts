import type {
  AiPlanSuggestion,
  AiTopicRecommendation,
  CurriculumTopic,
  DemoStudent,
  DroppedTopic,
  GeneratedPlan,
  LearningObjective,
  ManualAdjustments,
  PlanItem,
  PlanTopicAllocation,
  PlanWarning,
  Priority,
} from "./types"

const PRIORITY_RANK: Record<Priority, number> = {
  high: 0,
  medium: 1,
  low: 2,
}

/** Placement score at or above which a topic counts as already secure. */
const STRONG_PLACEMENT_SCORE = 75
/** Placement score below which a topic counts as needing full support. */
const WEAK_PLACEMENT_SCORE = 40

/** Why a prerequisite is being taught as a shortened refresher. */
type RefresherReason = "parent-request" | "placement"

const CHECKPOINT_LABELS = [
  "Foundation checkpoint",
  "Progress checkpoint",
  "Mid-plan checkpoint",
  "Application checkpoint",
  "Final checkpoint",
]

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function getTopicMap(topics: CurriculumTopic[]) {
  return new Map(topics.map((topic) => [topic.id, topic]))
}

function getCompletedTopicIds(student: DemoStudent) {
  return new Set(student.completedTopics.map((topic) => topic.topicId))
}

/** Placement score for this exact topic, ignoring the student-level default. */
function getExactPlacementScore(student: DemoStudent, topicId: number) {
  return student.placementResults.find((result) => result.topicId === topicId)
    ?.score
}

function getPlacementScore(student: DemoStudent, topicId: number) {
  return getExactPlacementScore(student, topicId) ?? student.defaultPlacementScore
}

function getPrerequisiteChain(
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
      ...getPrerequisiteChain(prerequisiteId, topicMap, visited),
      prerequisiteId
    )
  }
  return [...new Set(chain)]
}

/**
 * Prerequisites that are taught as shortened refreshers instead of in full.
 * A refresher is never dropped — the prerequisite still runs before the topic
 * that depends on it — it just takes half the ideal classes (Rule H2).
 *
 * Two sources:
 *  - Parent request: the unmet prerequisite chain in front of the requested
 *    topic, so the requested topic is reached sooner.
 *  - Placement led: a prerequisite the student has already proven
 *    (score >= 75%) sitting in front of a topic they are weak in (< 40%).
 *    The exact score is required; the student-level default is not evidence
 *    that a specific topic is secure.
 */
function getRefresherPrerequisites(
  student: DemoStudent,
  topicMap: Map<number, CurriculumTopic>,
  isAvailable: (topicId: number) => boolean
) {
  const refreshers = new Map<number, RefresherReason>()

  if (student.parentRequestedTopicId) {
    for (const prerequisiteId of getPrerequisiteChain(
      student.parentRequestedTopicId,
      topicMap
    )) {
      if (isAvailable(prerequisiteId)) {
        refreshers.set(prerequisiteId, "parent-request")
      }
    }
  }

  if (student.placementStatus === "completed") {
    const weakTopicIds = student.placementResults
      .filter((result) => result.score < WEAK_PLACEMENT_SCORE)
      .map((result) => result.topicId)

    for (const weakTopicId of weakTopicIds) {
      for (const prerequisiteId of getPrerequisiteChain(weakTopicId, topicMap)) {
        if (refreshers.has(prerequisiteId)) continue
        if (!isAvailable(prerequisiteId)) continue
        const score = getExactPlacementScore(student, prerequisiteId)
        if (score !== undefined && score >= STRONG_PLACEMENT_SCORE) {
          refreshers.set(prerequisiteId, "placement")
        }
      }
    }
  }

  return refreshers
}

/**
 * Structural (non-teaching) classes from the Grade 5 workbook:
 *   Full year = 66 teaching + 13 structural = 79 classes
 *   Structural breakdown: 5 checkpoints + 5 RDP + 3 PTM
 *
 * PTMs are scheduled by ops on a fixed calendar, so the builder reserves their
 * classes against the package but never places or generates them. They are
 * reported separately as `opsReserve` and the fit ladder cannot shed them —
 * ops runs those meetings whether or not the teaching plan is tight.
 *
 * Checkpoints and RDP scale with the selected topic count. When classes are
 * tight, structural scales down before High-priority teaching is cut.
 */
function estimateStructuralCounts(
  topicCount: number,
  classesRemaining: number
) {
  if (topicCount === 0) {
    return { checkpoints: 0, rdps: 0, opsReserve: 0, total: 0 }
  }

  // Workbook full-year anchors: 13 topics → 5 CP, 79-class package → 3 PTM
  const proportionalCheckpoints = Math.ceil((topicCount / 13) * 5)
  const checkpoints = clamp(
    proportionalCheckpoints,
    topicCount > 1 ? 2 : 1,
    5
  )
  const rdps = checkpoints
  const proportionalPtms = Math.ceil((classesRemaining / 79) * 3)
  const opsReserve = clamp(proportionalPtms, 1, 3)

  return {
    checkpoints,
    rdps,
    opsReserve,
    total: checkpoints + rdps + opsReserve,
  }
}

function adjustTopic(
  topic: CurriculumTopic,
  student: DemoStudent,
  manualAdjustments: ManualAdjustments,
  refresherPrerequisites: Map<number, RefresherReason>
): PlanTopicAllocation {
  let classes = topic.idealClasses
  let easyPercent = topic.easyPercent
  const reasons = [
    `${topic.priority[0].toUpperCase()}${topic.priority.slice(1)} priority in the Grade 5 US curriculum.`,
  ]

  const placementScore = getPlacementScore(student, topic.id)
  if (student.placementStatus === "completed" && placementScore !== undefined) {
    if (placementScore < 40) {
      easyPercent = clamp(topic.easyPercent - 15, 40, 80)
      reasons.push(
        `Placement score ${placementScore}% is below 40%, so the full class allocation is kept and practice is increased.`
      )
    } else if (placementScore >= 75) {
      const reduction = Math.ceil(topic.idealClasses * 0.3)
      classes = Math.max(topic.minimumClasses, topic.idealClasses - reduction)
      easyPercent = clamp(topic.easyPercent + 15, 40, 80)
      reasons.push(
        classes === topic.minimumClasses
          ? `Placement score ${placementScore}% is 75% or higher, so the topic is shortened to its ${topic.minimumClasses}-class minimum and shifted toward easier consolidation.`
          : `Placement score ${placementScore}% is 75% or higher, so the topic is shortened and shifted toward easier consolidation.`
      )
    } else {
      reasons.push(
        `Placement score ${placementScore}% is in the mid-range, so the ideal allocation is retained.`
      )
    }
  } else if (student.placementStatus === "not-taken") {
    reasons.push(
      "No placement result is available, so the ideal allocation is used."
    )
  }

  const topicObjectiveIds = new Set(
    topic.learningObjectives.map((objective) => objective.id)
  )
  const secureMasterCount = student.objectiveEvidence.filter(
    (evidence) =>
      topicObjectiveIds.has(evidence.learningObjectiveId) &&
      evidence.level === "master" &&
      evidence.result === "secure"
  ).length
  const secureMasterRatio =
    topic.learningObjectives.length === 0
      ? 0
      : secureMasterCount / topic.learningObjectives.length
  const placementAlreadyReduced =
    student.placementStatus === "completed" &&
    placementScore !== undefined &&
    placementScore >= 75
  const topicAttempts = (student.questionAttemptEvidence ?? []).filter(
    (attempt) => attempt.topicId === topic.id
  )
  const starterAttempt = topicAttempts.find((attempt) => attempt.level === "starter")
  const masterAttempt = topicAttempts.find((attempt) => attempt.level === "master")
  const starterAccuracy = starterAttempt
    ? starterAttempt.correct / starterAttempt.attempted
    : undefined
  const masterAccuracy = masterAttempt
    ? masterAttempt.correct / masterAttempt.attempted
    : undefined
  const hasMasterGap = masterAccuracy !== undefined && masterAccuracy < 0.5

  if (
    !placementAlreadyReduced &&
    !hasMasterGap &&
    secureMasterCount >= 2 &&
    secureMasterRatio >= 0.75
  ) {
    const reduction = Math.ceil(topic.idealClasses * 0.3)
    classes = Math.max(topic.minimumClasses, topic.idealClasses - reduction)
    easyPercent = clamp(topic.easyPercent + 15, 40, 80)
    reasons.push(
      "Secure Master-level evidence shortens this topic without removing it from the plan, and never below its class minimum."
    )
  }

  // Mastery moves the allocation in both directions. Secure Master evidence
  // shortens a topic (above); objectives the student is stuck on lengthen it,
  // capped two classes over the ideal so one weak topic cannot eat the package.
  const secureMasterObjectiveIds = new Set(
    student.objectiveEvidence
      .filter(
        (evidence) =>
          evidence.level === "master" && evidence.result === "secure"
      )
      .map((evidence) => evidence.learningObjectiveId)
  )
  const stuckObjectiveIds = new Set<string>()
  for (const evidence of student.objectiveEvidence) {
    if (
      topicObjectiveIds.has(evidence.learningObjectiveId) &&
      evidence.result === "not-secure" &&
      !secureMasterObjectiveIds.has(evidence.learningObjectiveId)
    ) {
      stuckObjectiveIds.add(evidence.learningObjectiveId)
    }
  }
  for (const attempt of topicAttempts) {
    if (
      attempt.attempted > 0 &&
      attempt.correct / attempt.attempted < 0.5 &&
      !secureMasterObjectiveIds.has(attempt.learningObjectiveId)
    ) {
      stuckObjectiveIds.add(attempt.learningObjectiveId)
    }
  }
  const stuckCount = stuckObjectiveIds.size
  const stuckRatio =
    topic.learningObjectives.length === 0
      ? 0
      : stuckCount / topic.learningObjectives.length

  // Two unsecure objectives is a real signal on any topic size, and half the
  // objectives is a real signal on a small one — either triggers an extension.
  if (stuckCount >= 2 || (stuckCount > 0 && stuckRatio >= 0.5)) {
    const extended = Math.min(
      topic.idealClasses + 2,
      Math.max(classes, topic.idealClasses) + Math.ceil(stuckCount / 2)
    )
    if (extended > classes) {
      classes = extended
      easyPercent = clamp(topic.easyPercent - 10, 40, 80)
      reasons.push(
        `${stuckCount} of ${topic.learningObjectives.length} objectives are not secure, so the topic is extended to ${classes} classes (ideal ${topic.idealClasses}, capped at ideal + 2) with more practice weight.`
      )
    }
  }

  if (starterAccuracy !== undefined && masterAccuracy !== undefined) {
    if (starterAccuracy >= 0.75 && masterAccuracy < 0.5) {
      classes = Math.max(classes, topic.idealClasses)
      reasons.push(
        `Starter accuracy is ${starterAttempt!.correct}/${starterAttempt!.attempted}, but Master accuracy is ${masterAttempt!.correct}/${masterAttempt!.attempted}; keep the full topic allocation and teach transfer to unfamiliar problems.`
      )
    } else if (starterAccuracy < 0.5 && masterAccuracy >= 0.75) {
      reasons.push(
        `Starter accuracy is ${starterAttempt!.correct}/${starterAttempt!.attempted} while Master accuracy is ${masterAttempt!.correct}/${masterAttempt!.attempted}; repair the core routine first so the stronger reasoning is reliable.`
      )
    }
  }

  // Rule H1 floor for this allocation. For an in-progress topic the floor
  // covers the whole topic, so classes already taught count toward it.
  let allocationFloor = topic.minimumClasses

  if (student.currentTopicId === topic.id && student.currentTopicClassesUsed) {
    // Subtract taught classes from the mastery-adjusted total, not from the
    // ideal. Early mastery has already shortened `classes` above, so this is
    // what makes it reduce the classes that are actually left.
    const adjustedTotal = classes
    classes = Math.max(1, adjustedTotal - student.currentTopicClassesUsed)
    allocationFloor = Math.max(
      1,
      topic.minimumClasses - student.currentTopicClassesUsed
    )
    reasons.push(
      adjustedTotal === topic.idealClasses
        ? `${student.currentTopicClassesUsed} ${student.currentTopicClassesUsed === 1 ? "class has" : "classes have"} already been taught in this active topic, so ${classes} of the ideal ${topic.idealClasses} remain.`
        : `${student.currentTopicClassesUsed} ${student.currentTopicClassesUsed === 1 ? "class has" : "classes have"} already been taught and evidence resized this topic from ${topic.idealClasses} to ${adjustedTotal} classes, so ${classes} remain.`
    )
  }

  // Rule H2: refreshers are half the ideal classes, rounded up, minimum 1.
  // Rule B2 exempts them from any further capacity compression.
  const refresherReason = refresherPrerequisites.get(topic.id)
  const isCompressedRefresher = refresherReason !== undefined
  if (isCompressedRefresher) {
    classes = Math.max(1, Math.ceil(topic.idealClasses / 2))
    allocationFloor = classes
    reasons.push(
      refresherReason === "parent-request"
        ? "This prerequisite is scheduled as a compressed refresher before the parent-requested topic (half the ideal classes, rounded up)."
        : `Placement score ${placementScore}% is already secure, so this prerequisite runs as a compressed refresher (half the ideal classes, rounded up) before the weaker topic that depends on it.`
    )
  }

  const manual = manualAdjustments[topic.id]
  if (manual?.classes !== undefined) classes = Math.max(1, manual.classes)
  if (manual?.easyPercent !== undefined) {
    easyPercent = clamp(manual.easyPercent, 0, 100)
  }

  let activities = Math.max(
    1,
    Math.round(topic.idealActivities * (classes / topic.idealClasses))
  )
  if (manual?.activities !== undefined) {
    activities = Math.max(0, manual.activities)
  }

  if (manual) {
    reasons.push(
      "A teacher override has been applied and locked into this version."
    )
    if (manual.classes !== undefined && classes < allocationFloor) {
      // Rule H1: only a teacher may take a topic below its minimum.
      reasons.push(
        `This override is below the ${allocationFloor}-class minimum for the topic; automatic rules never go this low.`
      )
    }
  }

  // Rule G1: Weekly activity workload cap for Grade 5 (max 7 questions/week, ~3.5 per class)
  const maxActivitiesG1 = Math.floor(classes * 3.5)
  if (activities > maxActivitiesG1 && maxActivitiesG1 > 0 && !manual?.activities) {
    activities = maxActivitiesG1
    reasons.push(
      "Activity count adjusted per Rule G1 (max 7 questions/week cap for Grade 5)."
    )
  }

  // Recompute split after any activity cap so class rows stay consistent.
  const easyActivities = Math.round(activities * (easyPercent / 100))
  const practiceActivities = activities - easyActivities

  return {
    topicId: topic.id,
    topicName: topic.name,
    sequence: topic.sequence,
    priority: topic.priority,
    classes,
    idealClasses: topic.idealClasses,
    minimumClasses: allocationFloor,
    compressedByCapacity: 0,
    atMinimum: classes <= allocationFloor,
    activities,
    easyActivities,
    practiceActivities,
    easyPercent,
    practicePercent: 100 - easyPercent,
    learningObjectives: topic.learningObjectives,
    reasons,
    isCompressedRefresher,
    manuallyEdited: Boolean(manual),
  }
}

/**
 * Rule B2 (first half): when the plan does not fit, compress topics toward
 * their Minimum Classes before anything is dropped. Lowest priority first,
 * latest sequence first. Compressed prerequisite refreshers and topics the
 * teacher has edited by hand are never touched.
 *
 * Returns new allocation objects; the input array is not mutated.
 */
function compressAllocationsToFit(
  allocations: PlanTopicAllocation[],
  overBy: number
): { allocations: PlanTopicAllocation[]; compressed: number } {
  if (overBy <= 0) return { allocations, compressed: 0 }

  const working = allocations.map((allocation) => ({ ...allocation }))
  const order = [...working]
    .filter(
      (allocation) =>
        !allocation.isCompressedRefresher &&
        !allocation.manuallyEdited &&
        allocation.classes > allocation.minimumClasses
    )
    .sort(
      (a, b) =>
        PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] ||
        b.sequence - a.sequence
    )

  let remaining = overBy
  let compressed = 0

  // One class at a time, cycling the queue so the load is spread rather than
  // flattening the first topic straight to its floor.
  let progressed = true
  while (remaining > 0 && progressed) {
    progressed = false
    for (const allocation of order) {
      if (remaining <= 0) break
      if (allocation.classes <= allocation.minimumClasses) continue
      allocation.classes -= 1
      allocation.compressedByCapacity = (allocation.compressedByCapacity ?? 0) + 1
      remaining -= 1
      compressed += 1
      progressed = true
    }
  }

  for (const allocation of order) {
    const removed = allocation.compressedByCapacity ?? 0
    if (removed === 0) continue
    allocation.atMinimum = allocation.classes <= allocation.minimumClasses
    allocation.activities = Math.max(
      1,
      Math.round(
        allocation.activities * (allocation.classes / (allocation.classes + removed))
      )
    )
    allocation.easyActivities = Math.round(
      allocation.activities * (allocation.easyPercent / 100)
    )
    allocation.practiceActivities =
      allocation.activities - allocation.easyActivities
    allocation.reasons = [
      ...allocation.reasons,
      allocation.atMinimum
        ? `Compressed to its ${allocation.minimumClasses}-class minimum to fit the remaining package capacity.`
        : `Compressed by ${removed} ${removed === 1 ? "class" : "classes"} toward its ${allocation.minimumClasses}-class minimum to fit the remaining package capacity.`,
    ]
  }

  return { allocations: working, compressed }
}

/**
 * Rule F3: when classes are tight, structural classes scale down before
 * High-priority teaching classes are reduced further.
 *
 * Order, tightest last:
 *  1. Shed RDP classes down to one. Revision, doubts and practice are the
 *     optional part of the structure — valuable, but not what the plan needs
 *     in order to keep working.
 *  2. Shed checkpoint + RDP pairs, keeping at least two checkpoints (one for
 *     a single-topic plan). Checkpoints are protected this far because they
 *     produce the mastery evidence every later rule reads.
 *  3. Leave the ops PTM reserve alone — ops schedules those regardless.
 */
function shrinkStructuralToFit(
  structural: ReturnType<typeof estimateStructuralCounts>,
  topicCount: number,
  overBy: number
) {
  if (overBy <= 0 || topicCount === 0) return structural

  let { checkpoints, rdps } = structural
  const { opsReserve } = structural
  let remaining = overBy
  const minCheckpoints = topicCount > 1 ? 2 : 1

  while (remaining > 0 && rdps > 1) {
    rdps -= 1
    remaining -= 1
  }
  while (remaining > 0 && checkpoints > minCheckpoints) {
    checkpoints -= 1
    remaining -= 1
    if (rdps > 0) {
      rdps -= 1
      remaining -= 1
    }
  }

  return {
    checkpoints,
    rdps,
    opsReserve,
    total: checkpoints + rdps + opsReserve,
  }
}

/** Teaching + structural classes for a candidate set of allocations. */
function planTotals(
  allocations: PlanTopicAllocation[],
  classesRemaining: number
) {
  const teaching = sum(allocations.map((allocation) => allocation.classes))
  const full = estimateStructuralCounts(allocations.length, classesRemaining)
  const structural = shrinkStructuralToFit(
    full,
    allocations.length,
    teaching + full.total - classesRemaining
  )
  return { teaching, structural, total: teaching + structural.total }
}

function totalPlanClasses(
  allocations: PlanTopicAllocation[],
  classesRemaining: number
) {
  return planTotals(allocations, classesRemaining).total
}

/**
 * Rule B2 in full: compress toward the minimums first, then drop Low topics,
 * then Medium (latest sequence first). High topics are never dropped here —
 * the caller raises a warning instead.
 */
function fitAllocationsToCapacity(
  allocations: PlanTopicAllocation[],
  classesRemaining: number,
  protectedTopicIds: Set<number>,
  topicMap: Map<number, CurriculumTopic>
) {
  const droppedIds = new Set<number>()
  const dropped: PlanTopicAllocation[] = []

  /** Re-derive the plan from the uncompressed allocations for the current scope. */
  const fitCurrentScope = () => {
    const kept = allocations.filter(
      (allocation) => !droppedIds.has(allocation.topicId)
    )
    const overBy = totalPlanClasses(kept, classesRemaining) - classesRemaining
    return compressAllocationsToFit(kept, overBy)
  }

  let attempt = fitCurrentScope()

  while (
    totalPlanClasses(attempt.allocations, classesRemaining) > classesRemaining
  ) {
    // A topic another kept topic depends on cannot be dropped: the plan
    // builder would only add it back as a prerequisite.
    const requiredByKept = new Set<number>()
    for (const allocation of attempt.allocations) {
      for (const prerequisiteId of getPrerequisiteChain(
        allocation.topicId,
        topicMap
      )) {
        requiredByKept.add(prerequisiteId)
      }
    }

    const candidate = [...attempt.allocations]
      .filter(
        (allocation) =>
          allocation.priority !== "high" &&
          !allocation.isCompressedRefresher &&
          !protectedTopicIds.has(allocation.topicId) &&
          !requiredByKept.has(allocation.topicId)
      )
      .sort(
        (a, b) =>
          PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] ||
          b.sequence - a.sequence
      )[0]
    if (!candidate) break

    droppedIds.add(candidate.topicId)
    dropped.push(candidate)
    // Dropping frees classes, so compression restarts from the ideal
    // allocations and only removes what is still needed.
    attempt = fitCurrentScope()
  }

  return {
    allocations: attempt.allocations,
    dropped,
    compressed: attempt.compressed,
  }
}

function distributeObjectives(
  objectives: LearningObjective[],
  classCount: number
) {
  if (classCount <= 0 || objectives.length === 0) return []

  if (classCount <= objectives.length) {
    return Array.from({ length: classCount }, (_, index) => {
      const start = Math.floor((index * objectives.length) / classCount)
      const end = Math.floor(((index + 1) * objectives.length) / classCount)
      return objectives.slice(start, Math.max(start + 1, end))
    })
  }

  const classes = objectives.map((objective) => [objective])
  let extra = classCount - objectives.length
  let cursor = objectives.length - 1
  while (extra > 0) {
    classes.push([objectives[Math.max(0, cursor)]])
    cursor = cursor > 0 ? cursor - 1 : objectives.length - 1
    extra -= 1
  }
  return classes
}

function distributeCount(total: number, slots: number) {
  if (slots <= 0) return []
  const base = Math.floor(total / slots)
  const remainder = total % slots
  return Array.from(
    { length: slots },
    (_, index) => base + (index < remainder ? 1 : 0)
  )
}

function buildTopicItems(allocation: PlanTopicAllocation, hasRdp: boolean) {
  const objectiveGroups = distributeObjectives(
    allocation.learningObjectives,
    allocation.classes
  )
  const easyByClass = distributeCount(
    allocation.easyActivities,
    allocation.classes
  )
  const practiceByClass = distributeCount(
    allocation.practiceActivities,
    allocation.classes
  )

  return objectiveGroups.map((objectives, index) => {
    const repeatedObjective =
      allocation.classes > allocation.learningObjectives.length &&
      index >= allocation.learningObjectives.length
    // The last class of a topic block closes it, so the mentor gets the
    // topic-test instructions alongside the teaching reason.
    const isTopicClose = index === objectiveGroups.length - 1
    const title =
      objectives.length > 1
        ? objectives
            .map((objective) => objective.subtopic)
            .filter(
              (subtopic, position, list) => list.indexOf(subtopic) === position
            )
            .join(" + ")
        : (objectives[0]?.subtopic ?? allocation.topicName)

    return {
      id: `topic-${allocation.topicId}-class-${index + 1}`,
      classNumber: 0,
      kind: "teaching" as const,
      status: "planned" as const,
      title: repeatedObjective
        ? `${title}: reinforcement & application`
        : title,
      subtitle: allocation.isCompressedRefresher
        ? `${allocation.topicName} · compressed prerequisite refresher`
        : allocation.topicName,
      topicId: allocation.topicId,
      topicName: allocation.topicName,
      priority: allocation.priority,
      learningObjectives: objectives,
      easyActivities: easyByClass[index] ?? 0,
      practiceActivities: practiceByClass[index] ?? 0,
      reason: [
        repeatedObjective
          ? "This additional class moves the objective from guided work toward independent application."
          : allocation.reasons[allocation.reasons.length - 1],
        isTopicClose ? buildTopicTestInstructions(allocation.topicName, hasRdp) : "",
      ]
        .filter(Boolean)
        .join(" "),
    }
  })
}

/**
 * Default teaching order before the mentor drags anything: High priority
 * first, then Medium, then Low, using curriculum sequence inside each band,
 * with every prerequisite pulled in front of the topic that depends on it.
 *
 * The scope screen and the generated plan both run on this, so what a mentor
 * sees in the topic list is the order the plan is actually built in.
 */
export function getDefaultTopicOrder(topics: CurriculumTopic[]) {
  const topicMap = getTopicMap(topics)
  const byPriority = [...topics].sort(
    (a, b) =>
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      a.sequence - b.sequence
  )

  const ordered: number[] = []
  const visited = new Set<number>()
  const addWithPrerequisites = (topicId: number) => {
    if (visited.has(topicId)) return
    const topic = topicMap.get(topicId)
    if (!topic) return
    visited.add(topicId)
    for (const prerequisiteId of topic.prerequisiteIds) {
      addWithPrerequisites(prerequisiteId)
    }
    ordered.push(topicId)
  }

  for (const topic of byPriority) addWithPrerequisites(topic.id)
  return ordered
}

function orderAllocations(
  allocations: PlanTopicAllocation[],
  student: DemoStudent,
  topicMap: Map<number, CurriculumTopic>,
  topicOrder?: number[]
) {
  const orderIndex = new Map((topicOrder ?? []).map((topicId, index) => [topicId, index]))
  const byPreference = [...allocations].sort((a, b) => {
    const aOrder = orderIndex.get(a.topicId)
    const bOrder = orderIndex.get(b.topicId)
    if (aOrder !== undefined || bOrder !== undefined) {
      return (aOrder ?? Number.MAX_SAFE_INTEGER) - (bOrder ?? Number.MAX_SAFE_INTEGER)
    }
    // High priority topics run before Medium, then Low. Curriculum sequence
    // breaks ties inside a priority band. The prerequisite walk below still
    // overrides this: a prerequisite is always placed before its dependant,
    // whatever its priority.
    return (
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      a.sequence - b.sequence
    )
  })
  const allocationById = new Map(
    allocations.map((allocation) => [allocation.topicId, allocation])
  )
  const ordered: PlanTopicAllocation[] = []
  const visited = new Set<number>()

  const addWithPrerequisites = (topicId: number) => {
    if (visited.has(topicId)) return
    const topic = topicMap.get(topicId)
    for (const prerequisiteId of topic?.prerequisiteIds ?? []) {
      if (allocationById.has(prerequisiteId)) addWithPrerequisites(prerequisiteId)
    }
    const allocation = allocationById.get(topicId)
    if (allocation) {
      visited.add(topicId)
      ordered.push(allocation)
    }
  }

  if (student.parentRequestedTopicId) {
    const requestedId = student.parentRequestedTopicId
    for (const prerequisiteId of getPrerequisiteChain(requestedId, topicMap)) {
      addWithPrerequisites(prerequisiteId)
    }
    addWithPrerequisites(requestedId)
  }

  for (const allocation of byPreference) addWithPrerequisites(allocation.topicId)
  return ordered
}

/**
 * Mentor instructions for a checkpoint class. A checkpoint is where the plan
 * collects its evidence, so the instruction has to say what to run, how to
 * read it, and what the result changes.
 */
function buildCheckpointInstructions(coveredTopics: string[]) {
  const scope =
    coveredTopics.length > 0 ? coveredTopics.join(", ") : "the topics just taught"
  return [
    `Assess ${scope}. Run the Starter set first, then the Master set for every objective taught since the last checkpoint.`,
    "Score each objective separately — a topic total hides which objective is the problem.",
    "Starter secure but Master weak means the routine is there and transfer is not; reteach through unfamiliar problems, not more drill.",
    "Starter weak means the core routine needs repair before any Master work.",
    "Record the result per objective — the plan resizes the remaining topics from it.",
  ].join(" ")
}

/** Mentor instructions for an RDP (revision, doubts & practice) class. */
function buildRdpInstructions(coveredTopics: string[]) {
  const scope =
    coveredTopics.length > 0 ? coveredTopics.join(", ") : "the recent topics"
  return [
    `Close the gaps the checkpoint exposed in ${scope} — this class is led by the checkpoint result, not by a fresh lesson plan.`,
    "Open with the student's own doubts, then work the objectives scored weakest.",
    "Re-test the two or three objectives you reteach before the class ends; an unverified fix is not a fix.",
    "Leave secure objectives alone. If nothing came back weak, use the class to push Master-level application instead.",
  ].join(" ")
}

/** Mentor instructions for the topic test that closes a teaching block. */
function buildTopicTestInstructions(topicName: string, hasRdp: boolean) {
  return [
    `Test ${topicName} end to end before moving on: Starter and Master items across every objective in the topic.`,
    "Mark against the objectives, not a single percentage.",
    hasRdp
      ? "Any objective below half correct goes into the next RDP class rather than being carried forward silently."
      : "This plan has no RDP class to absorb a gap, so any objective below half correct has to be flagged for a plan revision instead of carried forward silently.",
  ].join(" ")
}

function buildClassSequence(
  allocations: PlanTopicAllocation[],
  structural: ReturnType<typeof estimateStructuralCounts>
) {
  const items: PlanItem[] = []
  const checkpointAfter = new Set<number>()
  let lastCheckpointTopicIndex = 0

  for (
    let checkpoint = 1;
    checkpoint <= structural.checkpoints;
    checkpoint += 1
  ) {
    checkpointAfter.add(
      Math.min(
        allocations.length,
        Math.max(
          1,
          Math.round((checkpoint * allocations.length) / structural.checkpoints)
        )
      )
    )
  }

  let checkpointIndex = 0
  let rdpsPlaced = 0

  allocations.forEach((allocation, topicIndex) => {
    items.push(...buildTopicItems(allocation, structural.rdps > 0))

    if (checkpointAfter.has(topicIndex + 1)) {
      const checkpointTitle =
        CHECKPOINT_LABELS[checkpointIndex] ??
        `Checkpoint ${checkpointIndex + 1}`
      // Topics this checkpoint is assessing: everything since the last one.
      const coveredTopics = allocations
        .slice(lastCheckpointTopicIndex, topicIndex + 1)
        .map((covered) => covered.topicName)
      // A checkpoint is not a generic test. The first one on a topic is the
      // survey that fills an empty scorecard; every later one is the LO check,
      // the only activity allowed to certify an objective. Naming the role here
      // is what lets the plan board say what a checkpoint is actually for.
      const masteryRole =
        checkpointIndex === 0
          ? "Topic survey · 3 questions per objective · fills the scorecard before teaching"
          : "LO check · 5 fresh questions per ready objective · the only activity that certifies"

      items.push({
        id: `checkpoint-${checkpointIndex + 1}`,
        classNumber: 0,
        kind: "checkpoint",
        status: "planned",
        title: checkpointTitle,
        subtitle: `${masteryRole} · ${coveredTopics.join(", ")}`,
        learningObjectives: [],
        easyActivities: 0,
        practiceActivities: 0,
        reason: buildCheckpointInstructions(coveredTopics),
      })
      checkpointIndex += 1
      lastCheckpointTopicIndex = topicIndex + 1

      // RDP is the optional part of the structure (Rule F3), so a tight plan
      // can have fewer RDP classes than checkpoints. Place what survives.
      if (rdpsPlaced < structural.rdps) {
        items.push({
          id: `rdp-${rdpsPlaced + 1}`,
          classNumber: 0,
          kind: "rdp",
          status: "planned",
          title: "Revision, doubts & practice",
          subtitle: `RDP after ${checkpointTitle.toLowerCase()}`,
          learningObjectives: [],
          easyActivities: 0,
          practiceActivities: 0,
          reason: buildRdpInstructions(coveredTopics),
        })
        rdpsPlaced += 1
      }
    }
  })

  return items.map((item, index) => ({
    ...item,
    classNumber: index + 1,
    status: index === 0 ? ("next" as const) : ("planned" as const),
  }))
}

export function getSuggestedTopicIds(
  topics: CurriculumTopic[],
  student: DemoStudent
) {
  const completedIds = getCompletedTopicIds(student)
  const topicMap = getTopicMap(topics)
  const availableTopics = topics.filter((topic) => !completedIds.has(topic.id))
  const highTopics = availableTopics.filter(
    (topic) => topic.priority === "high"
  )
  const selectedIds = new Set(highTopics.map((topic) => topic.id))

  if (student.parentRequestedTopicId) {
    selectedIds.add(student.parentRequestedTopicId)
    for (const prerequisiteId of getPrerequisiteChain(
      student.parentRequestedTopicId,
      topicMap
    )) {
      if (!completedIds.has(prerequisiteId)) selectedIds.add(prerequisiteId)
    }
  }

  // Rule A1: start from every topic in the curriculum, then let Rules B2/H1
  // compress toward the minimums and drop Low before Medium if it still
  // does not fit.
  const refresherPrerequisites = getRefresherPrerequisites(
    student,
    topicMap,
    (id) => !completedIds.has(id)
  )
  const candidateAllocations = availableTopics.map((topic) =>
    adjustTopic(topic, student, {}, refresherPrerequisites)
  )
  const fitted = fitAllocationsToCapacity(
    candidateAllocations,
    student.classesRemaining,
    selectedIds,
    topicMap
  )
  for (const allocation of fitted.allocations) selectedIds.add(allocation.topicId)

  return [...selectedIds]
}

export function getAiAssistedTopicSuggestion(
  topics: CurriculumTopic[],
  student: DemoStudent
): AiPlanSuggestion {
  const completedIds = getCompletedTopicIds(student)
  const topicMap = getTopicMap(topics)
  const availableTopics = topics.filter((topic) => !completedIds.has(topic.id))
  const recommendations = new Map<number, AiTopicRecommendation>()
  const skippableTopicIds = new Set<number>()
  const mustIncludeIds = new Set<number>()
  const refresherPrerequisites = getRefresherPrerequisites(
    student,
    topicMap,
    (id) => !completedIds.has(id)
  )
  const baseAllocations = new Map(
    availableTopics.map((topic) => [
      topic.id,
      adjustTopic(topic, student, {}, refresherPrerequisites),
    ])
  )

  if (student.parentRequestedTopicId) {
    mustIncludeIds.add(student.parentRequestedTopicId)
    for (const prerequisiteId of getPrerequisiteChain(
      student.parentRequestedTopicId,
      topicMap
    )) {
      if (!completedIds.has(prerequisiteId)) mustIncludeIds.add(prerequisiteId)
    }
  }
  if (student.currentTopicId && !completedIds.has(student.currentTopicId)) {
    mustIncludeIds.add(student.currentTopicId)
  }

  for (const topic of availableTopics) {
    const exactPlacement = student.placementResults.find(
      (result) => result.topicId === topic.id
    )
    const topicObjectiveIds = new Set(
      topic.learningObjectives.map((objective) => objective.id)
    )
    const secureMasterEvidence = student.objectiveEvidence.filter(
      (evidence) =>
        topicObjectiveIds.has(evidence.learningObjectiveId) &&
        evidence.level === "master" &&
        evidence.result === "secure"
    )
    const secureMasterRatio =
      topic.learningObjectives.length === 0
        ? 0
        : secureMasterEvidence.length / topic.learningObjectives.length

    if (mustIncludeIds.has(topic.id)) {
      const isRequested = student.parentRequestedTopicId === topic.id
      recommendations.set(topic.id, {
        topicId: topic.id,
        decision: "include",
        evidence: isRequested ? "parent-request" : "current-progress",
        reason: isRequested
          ? "Keep because this is the parent-requested starting topic."
          : "Keep because this topic is active or required before the requested topic.",
      })
      continue
    }

    if (exactPlacement && exactPlacement.score >= 75) {
      const allocation = baseAllocations.get(topic.id)
      recommendations.set(topic.id, {
        topicId: topic.id,
        decision: "include",
        evidence: "placement",
        reason: `Placement score ${exactPlacement.score}% keeps this topic selected and compresses it from ${topic.idealClasses} to ${allocation?.classes ?? topic.idealClasses} classes.`,
      })
      continue
    }

    if (secureMasterEvidence.length >= 2 && secureMasterRatio >= 0.75) {
      const allocation = baseAllocations.get(topic.id)
      recommendations.set(topic.id, {
        topicId: topic.id,
        decision: "include",
        evidence: "mastery",
        reason: `Secure Master-level evidence keeps this topic selected and compresses it from ${topic.idealClasses} to ${allocation?.classes ?? topic.idealClasses} classes.`,
      })
      continue
    }

    if (exactPlacement && exactPlacement.score < 40) {
      mustIncludeIds.add(topic.id)
      recommendations.set(topic.id, {
        topicId: topic.id,
        decision: "include",
        evidence: "placement",
        reason: `Placement score ${exactPlacement.score}% shows support is needed, so this topic stays in the plan.`,
      })
    }
  }

  const selectedIds = new Set<number>(mustIncludeIds)

  for (const topic of availableTopics) {
    if (topic.priority === "high" && !skippableTopicIds.has(topic.id)) {
      selectedIds.add(topic.id)
      if (!recommendations.has(topic.id)) {
        recommendations.set(topic.id, {
          topicId: topic.id,
          decision: "include",
          evidence: "priority",
          reason:
            "No secure mastery evidence was found, so this High-priority topic stays in the plan.",
        })
      }
    }
  }

  const lowerPriorityTopics = availableTopics
    .filter(
      (topic) =>
        topic.priority !== "high" &&
        !selectedIds.has(topic.id) &&
        !skippableTopicIds.has(topic.id)
    )
    .sort(
      (a, b) =>
        PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
        a.sequence - b.sequence
    )

  // Rule B2: try every remaining topic in one pass, compressing the whole
  // scope toward the class minimums before deferring anything.
  const candidateAllocations = [
    ...[...selectedIds],
    ...lowerPriorityTopics.map((topic) => topic.id),
  ]
    .map((topicId) => baseAllocations.get(topicId))
    .filter((allocation): allocation is PlanTopicAllocation =>
      Boolean(allocation)
    )
  const fitted = fitAllocationsToCapacity(
    candidateAllocations,
    student.classesRemaining,
    selectedIds,
    topicMap
  )
  const keptIds = new Set(
    fitted.allocations.map((allocation) => allocation.topicId)
  )
  const compressedById = new Map(
    fitted.allocations.map((allocation) => [allocation.topicId, allocation])
  )

  for (const topic of lowerPriorityTopics) {
    const fits = keptIds.has(topic.id)
    if (!fits || !recommendations.has(topic.id)) {
      recommendations.set(topic.id, {
        topicId: topic.id,
        decision: fits ? "include" : "defer",
        evidence: fits ? "priority" : "capacity",
        reason: fits
          ? `${formatPriority(topic.priority)} priority fits after higher-priority needs.`
          : `${formatPriority(topic.priority)} priority is deferred: even after compressing the selected topics toward their class minimums, there is not enough capacity.`,
      })
    }
    if (fits) selectedIds.add(topic.id)
  }

  for (const topicId of selectedIds) {
    const allocation = compressedById.get(topicId)
    const removed = allocation?.compressedByCapacity ?? 0
    if (!allocation || removed === 0) continue
    recommendations.set(topicId, {
      topicId,
      decision: "include",
      evidence: "capacity",
      reason: `${recommendations.get(topicId)?.reason ?? ""} Compressed from ${allocation.idealClasses} to ${allocation.classes} classes (minimum ${allocation.minimumClasses}) to fit the package.`.trim(),
    })
  }

  for (const topicId of skippableTopicIds) {
    selectedIds.delete(topicId)
  }

  const evidenceSummary = [
    student.placementStatus === "completed"
      ? `${student.placementResults.length} placement topic scores reviewed`
      : "No placement test available",
    student.objectiveEvidence.length > 0
      ? `${student.objectiveEvidence.length} mastery observations reviewed`
      : "No objective-level mastery evidence available",
    `${student.completedTopics.length} completed topics excluded`,
    fitted.compressed > 0
      ? `${fitted.compressed} classes compressed toward topic minimums to fit ${student.classesRemaining} available classes`
      : `Scope fits within ${student.classesRemaining} available classes without compression`,
  ]

  return {
    selectedTopicIds: [...selectedIds],
    skippableTopicIds: [...skippableTopicIds],
    recommendations: availableTopics.map(
      (topic) =>
        recommendations.get(topic.id) ?? {
          topicId: topic.id,
          decision: "defer",
          evidence: "capacity",
          reason: "Deferred after reviewing priority and available classes.",
        }
    ),
    evidenceSummary,
  }
}

function formatPriority(priority: Priority) {
  return `${priority[0].toUpperCase()}${priority.slice(1)}`
}

export function buildLearningPlan({
  topics,
  student,
  selectedTopicIds,
  topicOrder,
  manualAdjustments = {},
  version = 1,
  changesFromPrevious = [],
  lastModificationType,
}: {
  topics: CurriculumTopic[]
  student: DemoStudent
  selectedTopicIds: number[]
  /** Mentor-selected topic order. Any unordered topics fall back to curriculum sequence. */
  topicOrder?: number[]
  manualAdjustments?: ManualAdjustments
  version?: number
  changesFromPrevious?: string[]
  lastModificationType?: "manual" | "class" | "auto"
}): GeneratedPlan {
  const topicMap = getTopicMap(topics)
  const completedIds = getCompletedTopicIds(student)
  const effectiveSelectedSet = new Set(selectedTopicIds)
  const refresherPrerequisites = getRefresherPrerequisites(
    student,
    topicMap,
    (id) => effectiveSelectedSet.has(id) && !completedIds.has(id)
  )
  const requestedPrerequisiteIds = new Set(
    student.parentRequestedTopicId
      ? getPrerequisiteChain(student.parentRequestedTopicId, topicMap)
      : []
  )
  const allocations = topics
    .filter(
      (topic) => effectiveSelectedSet.has(topic.id) && !completedIds.has(topic.id)
    )
    .map((topic) =>
      adjustTopic(topic, student, manualAdjustments, refresherPrerequisites)
    )

  const selectedAllocations = orderAllocations(
    allocations,
    student,
    topicMap,
    topicOrder
  )
  // Rule B2: the mentor owns the topic scope here, so the plan compresses
  // toward the minimums but never drops a selected topic on its own.
  const overBy =
    planTotals(selectedAllocations, student.classesRemaining).total -
    student.classesRemaining
  const compression = compressAllocationsToFit(selectedAllocations, overBy)
  const orderedAllocations = compression.allocations
  const { teaching, structural, total } = planTotals(
    orderedAllocations,
    student.classesRemaining
  )
  const difference = total - student.classesRemaining
  const spare = Math.max(0, student.classesRemaining - total)
  // Rule B3: 10 or more spare classes are reserved rather than padded out.
  const surplusClasses = spare >= 10 ? spare : 0
  const warnings: PlanWarning[] = []

  if (difference > 0) {
    warnings.push({
      id: "over-capacity",
      title: `Plan exceeds capacity by ${difference} ${difference === 1 ? "class" : "classes"}`,
      message:
        "Every eligible topic is already at its class minimum. The mentor can narrow the scope, override an allocation, or keep this visible warning.",
      severity: "warning",
    })
  }

  const compressedAllocations = orderedAllocations.filter(
    (allocation) => (allocation.compressedByCapacity ?? 0) > 0
  )
  if (compressedAllocations.length > 0) {
    warnings.push({
      id: "compressed-to-fit",
      title: `${compressedAllocations.length} ${compressedAllocations.length === 1 ? "topic was" : "topics were"} compressed to fit capacity`,
      message: `${compressedAllocations
        .map(
          (allocation) =>
            `${allocation.topicName} ${allocation.idealClasses} → ${allocation.classes}`
        )
        .join(" · ")}. No topic goes below its class minimum.`,
      severity: "attention",
    })
  }

  const selectedHighIds = new Set(
    topics
      .filter((topic) => topic.priority === "high" && !completedIds.has(topic.id))
      .map((topic) => topic.id)
  )
  const missingHighTopics = topics.filter(
    (topic) => selectedHighIds.has(topic.id) && !effectiveSelectedSet.has(topic.id)
  )
  if (missingHighTopics.length > 0) {
    warnings.push({
      id: "high-priority-removed",
      title: `${missingHighTopics.length} High-priority ${missingHighTopics.length === 1 ? "topic is" : "topics are"} not selected`,
      message:
        "This is a mentor decision. The system will not treat the topic as automatically dropped.",
      severity: "attention",
    })
  }

  const droppedTopics: DroppedTopic[] = topics
    .filter(
      (topic) => !effectiveSelectedSet.has(topic.id) && !completedIds.has(topic.id)
    )
    .sort(
      (a, b) =>
        PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] ||
        b.sequence - a.sequence
    )
    .map((topic) => ({
      topicId: topic.id,
      topicName: topic.name,
      priority: topic.priority,
      reason:
        topic.priority === "low"
          ? "Low priority: dropped first once the remaining topics were already compressed toward their class minimums."
          : topic.priority === "medium"
            ? "Medium priority: dropped after Low topics, once compression toward the class minimums still did not free enough capacity."
            : "Removed by the teacher; High-priority topics are never dropped silently.",
    }))

  if (student.completedTopics.length > 0) {
    const savedClasses = sum(
      student.completedTopics.map(
        (topic) => topic.plannedClasses - topic.actualClasses
      )
    )
    if (savedClasses > 0) {
      changesFromPrevious = [
        `Returned ${savedClasses} saved ${savedClasses === 1 ? "class" : "classes"} from completed topics to the available pool.`,
        ...changesFromPrevious,
      ]
    }
  }

  const explanations = [
    "High priority topics are sequenced first, then Medium and Low, using curriculum order inside each band. Every selected prerequisite is still placed before the topic that depends on it, whatever its priority.",
  ]
  if (student.placementStatus === "completed") {
    explanations.push(
      "Placement scores below 40% keep the full allocation; scores of 75% or more shorten the topic and increase easy consolidation."
    )
  }
  const placementRefreshers = orderedAllocations.filter(
    (allocation) =>
      allocation.isCompressedRefresher &&
      allocation.topicId !== student.parentRequestedTopicId &&
      !requestedPrerequisiteIds.has(allocation.topicId)
  )
  if (placementRefreshers.length > 0) {
    explanations.push(
      `${placementRefreshers.map((allocation) => allocation.topicName).join(", ")} scored 75% or more but sits before a topic the student is weak in, so it is kept as a shortened refresher rather than a full teaching block.`
    )
  }
  if (student.parentRequestedTopicId) {
    explanations.push(
      "The parent-requested topic is moved forward after its unmet prerequisite refreshers."
    )
  }
  const extendedTopics = orderedAllocations.filter(
    (allocation) => allocation.classes > allocation.idealClasses
  )
  if (extendedTopics.length > 0) {
    explanations.push(
      `${extendedTopics.map((allocation) => `${allocation.topicName} (${allocation.idealClasses} → ${allocation.classes})`).join(", ")} gained classes because half or more of the objectives are not secure. Extensions stop two classes above the ideal.`
    )
  }
  if (structural.opsReserve > 0) {
    explanations.push(
      `${structural.opsReserve} ${structural.opsReserve === 1 ? "class is" : "classes are"} reserved for parent–teacher meetings. Ops schedules those on a fixed calendar, so the builder holds the capacity but does not place them in the sequence.`
    )
  }
  const fullStructural = estimateStructuralCounts(
    orderedAllocations.length,
    student.classesRemaining
  )
  if (structural.rdps < fullStructural.rdps) {
    explanations.push(
      `The plan is tight, so ${fullStructural.rdps - structural.rdps} revision, doubts & practice ${fullStructural.rdps - structural.rdps === 1 ? "class was" : "classes were"} dropped first. RDP is the optional part of the structure; checkpoints are kept because the plan resizes itself from what they measure.`
    )
  }
  if (compression.compressed > 0) {
    explanations.push(
      `Capacity was ${overBy} ${overBy === 1 ? "class" : "classes"} short, so ${compression.compressed} teaching ${compression.compressed === 1 ? "class was" : "classes were"} compressed out of the lowest-priority topics first. No topic drops below its minimum, and prerequisite refreshers are never compressed.`
    )
  }
  if (surplusClasses > 0) {
    explanations.push(
      `${surplusClasses} spare classes remain after the plan (${total} of ${student.classesRemaining}). Only the required classes are planned; the surplus is reserved as 'Revision / School Help'.`
    )
  }
  const classesPerWeek = student.classesPerWeek ?? 2
  explanations.push(
    `The student attends ${classesPerWeek} ${classesPerWeek === 1 ? "class" : "classes"} per week, so each plan window covers the next ${classesPerWeek * 2} classes.`
  )

  const hasManualEdits = Object.keys(manualAdjustments).length > 0

  return {
    id: `plan-${student.id}-v${version}`,
    version,
    studentId: student.id,
    generatedAt: new Date().toISOString(),
    lastModificationType: lastModificationType ?? (hasManualEdits ? "manual" : "auto"),
    allocations: orderedAllocations,
    items: buildClassSequence(orderedAllocations, structural),
    droppedTopics,
    warnings,
    capacity: {
      available: student.classesRemaining,
      teaching,
      structural: structural.checkpoints + structural.rdps,
      opsReserve: structural.opsReserve,
      total,
      difference,
      compressedClasses: compression.compressed,
      surplusClasses,
    },
    explanations,
    changesFromPrevious,
  }
}

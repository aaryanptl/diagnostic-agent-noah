/**
 * The Mastery Loop, expressed against the Learning Plan Builder's own data.
 *
 * The builder is the *macro* planner: it decides which topics a student is
 * taught and how many classes each one gets. This module is the *micro*
 * decision layer that runs inside those classes: it reads one scorecard, runs a
 * fixed ladder of rules (R0-R7), and returns exactly one activity.
 *
 * Nothing here invents student data. The starting scorecard is derived from the
 * evidence the builder already holds on a `DemoStudent`:
 *
 *   placementResults        -> the shrunk topic seed
 *   questionAttemptEvidence -> raw attempts (correct / attempted, starter|master)
 *   objectiveEvidence       -> a weaker secure / not-secure signal per objective
 *
 * Everything after the starting scorecard is a *simulation*, run forward one
 * round at a time so the loop can be shown deciding rather than described. It
 * is deterministic (seeded PRNG, no Math.random) so the same student always
 * produces the same run in a demo.
 *
 * Source of the rules: `plans/mastery-loop-flow-ap.html` (§03 activity set,
 * §04 scorecard, §05 router, §06 the LO check, §08 closing the topic).
 */

import type { CurriculumTopic, DemoStudent } from "./types"

/* ------------------------------------------------------------------ *
 * Constants — every threshold below is quoted from the flow document.
 * ------------------------------------------------------------------ */

/** §04 — below this the score reads `null` rather than as a guess. */
export const CONFIDENCE_LOCK = 0.55
/** §06 — the platform's existing `secure` band. Not a new bar. */
export const READY_SCORE = 75
/** §05 R1/R6 — below this an objective is taught, not measured again. */
export const NEEDS_HELP_SCORE = 60
/** §06 — basics must be sound before a score above them is trusted. */
export const EASY_ACCURACY_BAR = 70
/** §05 R5 — a single ready objective waits this many rounds before a check. */
export const SOLO_READY_WAIT = 2
/** §06 — two failed checks means repetition is not the problem. */
export const BLOCK_AFTER_FAILURES = 2
/** §05 R2 — the loop stops itself rather than guessing. */
export const ESCALATE_AFTER_FAILURES = 3
export const STALL_ROUNDS = 4

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

export type MasteryLoState =
  | "untested"
  | "working"
  | "ready"
  | "needs_help"
  | "blocked"
  | "signed_off"

export type MasteryActivityKind =
  | "placement"
  | "survey"
  | "homework"
  | "practice"
  | "check"
  | "class"
  | "topic_class"
  | "escalate"
  | "close"

export type MasteryRuleId = "R0" | "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7"

export interface MasteryLoRow {
  id: string
  /** The curriculum group this objective sits in. Not unique on its own. */
  subtopic: string
  /** The objective itself. This is the label to show — `subtopic` repeats. */
  text: string
  /** Reported score. `null` while confidence is below the lock. */
  score: number | null
  /** The underlying estimate, always present. Rules read this. */
  rawScore: number
  confidence: number
  locked: boolean
  easyAccuracy: number | null
  hardCleared: boolean
  /** Practice hints and retries. Never touches the score (§07). */
  assists: number
  checkFailures: number
  /** Number of scoring records behind the estimate. Drives confidence. */
  records: number
  /** §05 R6 guard — practice may not repeat until something measured it. */
  measuredSincePractice: boolean
  /** Consecutive rounds spent in `ready`. Feeds the R5 solo-ready wait. */
  readyRounds: number
  signedOff: boolean
  state: MasteryLoState
  /** Hidden true ability. Simulation only — never shown as a score. */
  ability: number
  /** Where the starting numbers came from, in one line. */
  provenance: string
}

export interface MasteryScorecard {
  topicId: number
  topicName: string
  studentId: string
  rows: MasteryLoRow[]
  /** Rolled up from the objective rows (§04). Reported, not a gate (§08). */
  topicScore: number
  topicLocked: boolean
  surveyDone: boolean
  round: number
  /** Rounds since any objective's score moved. Feeds R2. */
  stalledRounds: number
  /**
   * R1 guard. A whole-topic class writes no score, so without this the router
   * would re-teach the topic, see the score unchanged, and re-teach it again
   * forever. The same shape of guard R6 uses for practice.
   */
  measuredSinceTopicClass: boolean
  /** Two topic classes on one topic is a flag a mentor can see. Three escalates. */
  topicClassCount: number
  /**
   * Topic score when the last whole-topic class was prescribed. A re-teach is
   * only the right prescription when the previous one did not land — a topic
   * that is climbing does not need teaching again, it needs to keep going.
   */
  topicScoreAtLastTopicClass: number | null
  /**
   * What the router dispatched last round. Practice is per-objective, but the
   * "practice must always be followed by homework" rule is not — without this
   * the router practises objective A, then B, then C, and never finds out
   * whether any of it landed.
   */
  lastActivity: MasteryActivityKind | null
  signedOffCount: number
  closed: boolean
  /** Set when the loop ran out of rounds without certifying everything. */
  exhausted: boolean
  badge: "None" | "Novice" | "Pro" | "Master"
}

export interface MasteryDecision {
  rule: MasteryRuleId
  /** Plain-language name a newcomer can read without the rule id. */
  ruleName: string
  activity: MasteryActivityKind
  activityLabel: string
  /** Which objectives this activity is aimed at. */
  targetLoIds: string[]
  /** Why this rule matched, in this student's own numbers. */
  because: string
  /** What the activity is allowed to do to the scorecard. */
  effect: string
}

export interface MasteryRound {
  round: number
  decision: MasteryDecision
  /** Scorecard *after* the activity ran. */
  scorecard: MasteryScorecard
  /** Newcomer-facing narration for this step. */
  headline: string
  note: string
  /** Objectives certified by this round, if any. */
  certified: string[]
}

/* ------------------------------------------------------------------ *
 * Deterministic PRNG — a demo must replay identically every time.
 * ------------------------------------------------------------------ */

function hashSeed(text: string) {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function mulberry32(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function round1(value: number) {
  return Math.round(value * 10) / 10
}

/* ------------------------------------------------------------------ *
 * §03 — the activity set. This is the table the demo shows so a newcomer
 * can see that "test" is not one thing: the five activities differ in what
 * they are *allowed* to do.
 * ------------------------------------------------------------------ */

export interface MasteryActivitySpec {
  kind: MasteryActivityKind
  name: string
  purpose: string
  /** How much an attempt here moves the estimate. */
  scoreWeight: number
  /** Whether it can end an objective. Only one activity can. */
  certifies: boolean
  /** Which builder artefact this maps onto. */
  builderHome: string
  shape: string
}

export const MASTERY_ACTIVITIES: MasteryActivitySpec[] = [
  {
    kind: "placement",
    name: "Placement test",
    purpose: "Pick the entry topic and seed the topic row",
    scoreWeight: 0,
    certifies: false,
    builderHome: "Step 2 — Review the evidence",
    shape: "20 Q across the grade, once",
  },
  {
    kind: "survey",
    name: "Topic survey",
    purpose: "Fill an empty scorecard before any teaching",
    scoreWeight: 1,
    certifies: false,
    builderHome: "First checkpoint class",
    shape: "3 Q per objective (1 easy · 1 medium · 1 hard)",
  },
  {
    kind: "homework",
    name: "Homework",
    purpose: "Move an objective forward and measure it quietly",
    scoreWeight: 0.5,
    certifies: false,
    builderHome: "Easy + Practice activities on a teaching class",
    shape: "~12 Q across up to 4 objectives",
  },
  {
    kind: "practice",
    name: "Practice",
    purpose: "Teach an objective the student cannot do yet",
    scoreWeight: 0,
    certifies: false,
    builderHome: "Practice activities on a teaching class",
    shape: "5 Q, one objective, hints + unlimited retries",
  },
  {
    kind: "check",
    name: "LO check",
    purpose: "Decide whether an objective is finished",
    scoreWeight: 1,
    certifies: true,
    builderHome: "Later checkpoint classes",
    shape: "5 fresh Q per objective (1E · 2M · 2H), timed, no hints",
  },
  {
    kind: "class",
    name: "Class",
    purpose: "Re-teach a blocked objective with a mentor",
    scoreWeight: 0,
    certifies: false,
    builderHome: "A teaching class in the plan sequence",
    shape: "Mentor-led",
  },
]

/* ------------------------------------------------------------------ *
 * Derivation — the starting scorecard, built only from builder data.
 * ------------------------------------------------------------------ */

/**
 * §03 — placement seeds the *topic* row and nothing per objective. Shrunk
 * toward a neutral 50 so a thin sample cannot reach the mastery bar:
 * `(correct + 2) / (n + 4) * 100`. On this dataset placement is stored as a
 * percentage rather than a raw count, so `correct` is reconstructed from it.
 */
export function placementSeed(placementScore: number | undefined) {
  if (placementScore === undefined) return { seed: 50, explained: "No placement score — the topic row starts at a neutral 50." }
  const questions = 4
  const correct = clamp(Math.round((placementScore / 100) * questions), 0, questions)
  const seed = Math.round(((correct + 2) / (questions + 4)) * 100)
  return {
    seed,
    explained: `Placement ${placementScore}% on this topic ≈ ${correct} of ${questions} questions. Shrunk toward 50 it seeds the topic row at ${seed} — under the ${READY_SCORE} bar by construction, so placement can never certify anything.`,
  }
}

/**
 * §03 — the platform's live confidence formula, re-capped for the topic window.
 *
 * The live gate saturates at four records because it was built to decide
 * whether a *single session's* report may state a mastery. Over a whole topic
 * that cap makes six weeks of homework indistinguishable from one survey, so
 * the record term is widened to 12 and re-weighted to put the lock back where
 * a bar of six questions used to sit.
 */
export function masteryConfidence(records: number, bloomCoverage: number, typeCoverage: number) {
  const value =
    0.35 +
    Math.min(records, 12) * 0.03 +
    Math.min(bloomCoverage, 3) * 0.06 +
    Math.min(typeCoverage, 2) * 0.04
  return round1(clamp(value, 0.05, 0.98) * 100) / 100
}

/**
 * §04 — the score is a weighted moving average with a floored learning rate, so
 * it stays recent. A student who starts a topic at 60 and finishes at 85 should
 * read 85, not the lifetime average of 73.
 *
 * `d` sits on the *gain*, never on the attempt, and is asymmetric: failing an
 * easy question is strong evidence of a gap, failing a hard one is weak.
 */
const DIFFICULTY_GAIN: Record<"easy" | "medium" | "hard", { rising: number; falling: number }> = {
  easy: { rising: 0.5, falling: 1.0 },
  medium: { rising: 0.7, falling: 0.85 },
  hard: { rising: 1.0, falling: 0.6 },
}

export function applyAttempt(
  score: number,
  attempt: number,
  weight: number,
  priorRecords: number,
  band: "easy" | "medium" | "hard"
) {
  if (weight === 0) return score
  const k = Math.max(0.15, 0.8 / (1 + priorRecords / 6))
  const rising = attempt >= score
  const d = rising ? DIFFICULTY_GAIN[band].rising : DIFFICULTY_GAIN[band].falling
  return clamp(score + weight * k * d * (attempt - score), 0, 100)
}

function deriveState(row: MasteryLoRow): MasteryLoState {
  if (row.signedOff) return "signed_off"
  if (row.checkFailures >= BLOCK_AFTER_FAILURES) return "blocked"
  if (row.records === 0) return "untested"
  if (row.rawScore < NEEDS_HELP_SCORE) return "needs_help"
  if (
    row.locked &&
    row.rawScore >= READY_SCORE &&
    (row.easyAccuracy ?? 0) >= EASY_ACCURACY_BAR
  ) {
    return "ready"
  }
  return "working"
}

function refreshRow(row: MasteryLoRow): MasteryLoRow {
  const locked = row.confidence >= CONFIDENCE_LOCK
  const next: MasteryLoRow = {
    ...row,
    locked,
    score: locked ? Math.round(row.rawScore) : null,
  }
  next.state = deriveState(next)
  return next
}

function rollUp(card: MasteryScorecard): MasteryScorecard {
  const rows = card.rows.map(refreshRow)
  const topicScore = rows.length
    ? Math.round(rows.reduce((total, row) => total + row.rawScore, 0) / rows.length)
    : 0
  const signedOffCount = rows.filter((row) => row.signedOff).length
  const topicLocked = rows.every((row) => row.locked)
  const half = Math.ceil(rows.length / 2)
  const badge: MasteryScorecard["badge"] = card.closed
    ? "Master"
    : signedOffCount >= half && signedOffCount > 0
      ? "Pro"
      : card.surveyDone
        ? "Novice"
        : "None"
  return { ...card, rows, topicScore, topicLocked, signedOffCount, badge }
}

/**
 * Build the starting scorecard for one student on one topic, using only
 * evidence the builder already holds.
 */
export function buildScorecard(
  student: DemoStudent,
  topic: CurriculumTopic
): MasteryScorecard {
  const placement = student.placementResults.find((result) => result.topicId === topic.id)
  const { seed } = placementSeed(placement?.score ?? student.defaultPlacementScore)

  const rows: MasteryLoRow[] = topic.learningObjectives.map((objective) => {
    const attempts = (student.questionAttemptEvidence ?? []).filter(
      (attempt) => attempt.learningObjectiveId === objective.id
    )
    const labels = student.objectiveEvidence.filter(
      (evidence) => evidence.learningObjectiveId === objective.id
    )

    let rawScore = seed
    let records = 0
    const bands = new Set<string>()
    const sources: string[] = []

    // Raw attempts first — the strongest evidence the builder carries.
    attempts.forEach((attempt) => {
      const band = attempt.level === "starter" ? "easy" : "hard"
      const percent = attempt.attempted > 0 ? (attempt.correct / attempt.attempted) * 100 : 0
      rawScore = applyAttempt(rawScore, percent, 1, records, band as "easy" | "hard")
      records += attempt.attempted
      bands.add(attempt.level)
      sources.push(`${attempt.correct}/${attempt.attempted} ${attempt.level}`)
    })

    // Secure / not-secure labels are a weaker signal — a verdict rather than a
    // count — so they carry half weight and only fill gaps the attempts leave.
    labels.forEach((label) => {
      const band = label.level === "starter" ? "easy" : "hard"
      const already = attempts.some((attempt) => attempt.level === label.level)
      if (already) return
      const target = label.result === "secure" ? 82 : 38
      rawScore = applyAttempt(rawScore, target, 0.5, records, band as "easy" | "hard")
      records += 2
      bands.add(label.level)
      sources.push(`${label.level} marked ${label.result}`)
    })

    const starterAttempts = attempts.filter((attempt) => attempt.level === "starter")
    const starterLabel = labels.find((label) => label.level === "starter")
    const easyAccuracy = starterAttempts.length
      ? Math.round(
          (starterAttempts.reduce((total, attempt) => total + attempt.correct, 0) /
            Math.max(
              1,
              starterAttempts.reduce((total, attempt) => total + attempt.attempted, 0)
            )) *
            100
        )
      : starterLabel
        ? starterLabel.result === "secure"
          ? 80
          : 40
        : null

    const hardCleared =
      attempts.some((attempt) => attempt.level === "master" && attempt.correct > 0) ||
      labels.some((label) => label.level === "master" && label.result === "secure")

    const bloomCoverage = bands.size
    const typeCoverage = attempts.length > 0 ? Math.min(2, bands.size) : 1
    const confidence = records === 0 ? 0.35 : masteryConfidence(records, bloomCoverage, typeCoverage)

    // Hidden true ability: what the student can actually do right now. The
    // score is our estimate of it; the gap between them is what the loop is
    // trying to close. Clearing a hard question is the strongest single signal
    // that there is more here than the score has caught up with.
    const ability = clamp(rawScore + (hardCleared ? 6 : -3), 8, 96)

    const row: MasteryLoRow = {
      id: objective.id,
      subtopic: objective.subtopic,
      text: objective.text,
      score: null,
      rawScore,
      confidence,
      locked: false,
      easyAccuracy,
      hardCleared,
      assists: 0,
      checkFailures: 0,
      records,
      measuredSincePractice: true,
      readyRounds: 0,
      signedOff: false,
      state: "untested",
      ability,
      provenance: sources.length
        ? sources.join(" · ")
        : `No evidence on this objective — the topic seed of ${seed} is all there is.`,
    }
    return refreshRow(row)
  })

  return rollUp({
    topicId: topic.id,
    topicName: topic.name,
    studentId: student.id,
    rows,
    topicScore: 0,
    topicLocked: false,
    surveyDone: false,
    round: 0,
    stalledRounds: 0,
    measuredSinceTopicClass: true,
    topicClassCount: 0,
    topicScoreAtLastTopicClass: null,
    lastActivity: null,
    signedOffCount: 0,
    closed: false,
    exhausted: false,
    badge: "None",
  })
}

/* ------------------------------------------------------------------ *
 * §05 — the router. Eight rules, top to bottom, first match wins.
 * ------------------------------------------------------------------ */

export interface MasteryRuleSpec {
  id: MasteryRuleId
  name: string
  condition: string
  activity: string
  plain: string
}

export const MASTERY_RULES: MasteryRuleSpec[] = [
  {
    id: "R0",
    name: "Topic finished",
    condition: "every objective signed off",
    activity: "Close the topic",
    plain: "Nothing is left to prove. The topic closes and its unused classes go back to the plan.",
  },
  {
    id: "R1",
    name: "Concept never landed",
    condition: `topic score < ${NEEDS_HELP_SCORE}, confidence locked`,
    activity: "Whole-topic class",
    plain: "A student who is drowning is never handed another worksheet. Teach the topic again.",
  },
  {
    id: "R2",
    name: "Not converging",
    condition: `${ESCALATE_AFTER_FAILURES} check failures, or ${STALL_ROUNDS} rounds stalled`,
    activity: "Flag to teacher",
    plain: "The loop stops itself and asks for a human rather than guessing.",
  },
  {
    id: "R3",
    name: "Nothing to read",
    condition: "no survey has run yet",
    activity: "Topic survey",
    plain: "The scorecard is empty. This is the only activity that can fill it.",
  },
  {
    id: "R4",
    name: "Objective blocked",
    condition: "an objective failed its check twice",
    activity: "Class on that objective",
    plain: "One objective goes to a mentor. The others keep running inside the loop.",
  },
  {
    id: "R5",
    name: "Ready to certify",
    condition: `2+ objectives ready, or 1 ready for ${SOLO_READY_WAIT} rounds`,
    activity: "LO check",
    plain: "Certification never queues behind ordinary work. It is the only thing that ends an objective.",
  },
  {
    id: "R6",
    name: "Needs teaching",
    condition: `an objective below ${NEEDS_HELP_SCORE}, measured since its last practice`,
    activity: "Practice",
    plain: "An objective sitting at 47 does not need another measurement. It needs to be taught.",
  },
  {
    id: "R7",
    name: "Default",
    condition: "everything else",
    activity: "Homework",
    plain: "The only activity that both moves an objective and measures it.",
  },
]

export function routeNext(card: MasteryScorecard): MasteryDecision {
  const rows = card.rows
  const open = rows.filter((row) => !row.signedOff)

  // R0 — the only exit from the loop.
  if (rows.length > 0 && open.length === 0) {
    return {
      rule: "R0",
      ruleName: "Topic finished",
      activity: "close",
      activityLabel: "Close the topic",
      targetLoIds: [],
      because: `All ${rows.length} objectives are signed off.`,
      effect: "The topic closes. Classes booked for it and no longer needed go back to the plan.",
    }
  }

  // R2 sits above R1 in practice for escalation counts; the document orders
  // safety R1 then R2, and both are safety rules, so the ladder is kept as
  // written: R1 first.
  // R1 carries the same guard R6 does: a class writes no score, so the router
  // must see a fresh measurement before it is allowed to prescribe another one.
  // Without it the loop re-teaches, sees nothing move, and re-teaches again.
  if (
    card.topicLocked &&
    card.topicScore < NEEDS_HELP_SCORE &&
    card.surveyDone &&
    card.measuredSinceTopicClass &&
    card.topicClassCount < ESCALATE_AFTER_FAILURES &&
    // A topic that is climbing does not need teaching again. Only re-teach if
    // the last whole-topic class moved the score less than a band's worth.
    (card.topicScoreAtLastTopicClass === null ||
      card.topicScore - card.topicScoreAtLastTopicClass < 5)
  ) {
    return {
      rule: "R1",
      ruleName: "Concept never landed",
      activity: "topic_class",
      activityLabel: "Whole-topic class",
      targetLoIds: open.map((row) => row.id),
      because:
        card.topicClassCount === 0
          ? `Every objective is under the teaching line — topic score ${card.topicScore}, on evidence we trust. This is not one weak spot.`
          : `Topic score is still ${card.topicScore} after ${card.topicClassCount} re-teach${card.topicClassCount === 1 ? "" : "es"}. Two topic classes on one topic is itself a flag a mentor can see.`,
      effect: "Teaches the whole topic again. Writes no score — a class is teaching, not measurement.",
    }
  }

  const escalating = rows.find((row) => row.checkFailures >= ESCALATE_AFTER_FAILURES)
  // Running out of re-teaches only escalates if the topic is still under the
  // line. A topic that climbed out on its own is not a failing topic.
  const reteachExhausted =
    card.topicClassCount >= ESCALATE_AFTER_FAILURES &&
    card.topicScore < NEEDS_HELP_SCORE
  if (escalating || card.stalledRounds >= STALL_ROUNDS || reteachExhausted) {
    return {
      rule: "R2",
      ruleName: "Not converging",
      activity: "escalate",
      activityLabel: "Flag to the teacher",
      targetLoIds: escalating ? [escalating.id] : open.map((row) => row.id),
      because: escalating
        ? `${escalating.text} has failed its check ${escalating.checkFailures} times.`
        : reteachExhausted
          ? `${card.topicClassCount} whole-topic re-teaches and the topic is still at ${card.topicScore}.`
          : `${card.stalledRounds} rounds with no score movement.`,
      effect: "The loop refuses to keep guessing and hands the objective to a human by name.",
    }
  }

  // R3 — nothing in the scorecard to read.
  if (!card.surveyDone) {
    return {
      rule: "R3",
      ruleName: "Nothing to read",
      activity: "survey",
      activityLabel: `Topic survey · ${rows.length * 3} questions`,
      targetLoIds: rows.map((row) => row.id),
      because:
        "No survey has run on this topic, so no objective has been measured on its own terms.",
      effect: `Writes a first score for all ${rows.length} objectives. Full weight, but it can never certify.`,
    }
  }

  const blocked = open.find((row) => row.state === "blocked")
  if (blocked) {
    return {
      rule: "R4",
      ruleName: "Objective blocked",
      activity: "class",
      activityLabel: "Class on one objective",
      targetLoIds: [blocked.id],
      because: `${blocked.text} has failed its check twice — repetition is not the problem.`,
      effect: "A mentor takes over that one objective. The rest keep running inside the loop.",
    }
  }

  const ready = open.filter((row) => row.state === "ready")
  if (ready.length >= 2 || (ready.length === 1 && ready[0].readyRounds >= SOLO_READY_WAIT)) {
    const batch = ready.slice(0, 3)
    return {
      rule: "R5",
      ruleName: "Ready to certify",
      activity: "check",
      activityLabel: `LO check · ${batch.length * 5} fresh questions`,
      targetLoIds: batch.map((row) => row.id),
      because:
        ready.length >= 2
          ? `${ready.length} objectives are over ${READY_SCORE} with sound basics.`
          : `${ready[0].text} has been ready for ${ready[0].readyRounds} rounds. One lucky run is not proof.`,
      effect:
        "The only activity that can finish an objective. Timed, no hints, questions the student has never seen.",
    }
  }

  // Two guards, and both are load-bearing. The per-objective one stops the
  // router practising the same objective forever; the round-level one stops it
  // practising a *different* objective every round and never measuring at all.
  const needsHelp = open.find(
    (row) => row.state === "needs_help" && row.measuredSincePractice
  )
  if (needsHelp && card.lastActivity !== "practice") {
    return {
      rule: "R6",
      ruleName: "Needs teaching",
      activity: "practice",
      activityLabel: "Practice · 5 questions, hints on",
      targetLoIds: [needsHelp.id],
      because: `${needsHelp.text} is at ${Math.round(needsHelp.rawScore)}, under ${NEEDS_HELP_SCORE}.`,
      effect:
        "Teaches. Writes no score at all — hints and retries guarantee a correct answer, so it cannot measure.",
    }
  }

  const targets = [...open]
    .sort((a, b) => a.rawScore - b.rawScore)
    .slice(0, 4)
  return {
    rule: "R7",
    ruleName: "Default",
    activity: "homework",
    activityLabel: "Homework · ~12 questions",
    targetLoIds: targets.map((row) => row.id),
    because: "No safety rule fired, nothing is ready to certify, nothing needs re-teaching.",
    effect:
      "Moves objectives forward and measures them at half weight. 60% gap · 25% probe · 15% maintain.",
  }
}

/* ------------------------------------------------------------------ *
 * Forward simulation — one round at a time.
 * ------------------------------------------------------------------ */

function bandFor(index: number): "easy" | "medium" | "hard" {
  if (index % 3 === 0) return "easy"
  if (index % 3 === 1) return "medium"
  return "hard"
}

/**
 * Run one round: route, apply the activity, roll up. Pure — returns a new
 * scorecard, never mutates the one passed in.
 */
export function runRound(card: MasteryScorecard): MasteryRound {
  const decision = routeNext(card)
  const random = mulberry32(hashSeed(`${card.studentId}:${card.topicId}:${card.round}`))
  const targets = new Set(decision.targetLoIds)
  const certified: string[] = []
  let headline = ""
  let note = ""
  let closed = card.closed
  let surveyDone = card.surveyDone
  let anyScoreMoved = false

  const rows = card.rows.map((row): MasteryLoRow => {
    if (!targets.has(row.id)) {
      return { ...row, readyRounds: row.state === "ready" ? row.readyRounds + 1 : 0 }
    }
    const next = { ...row }

    switch (decision.activity) {
      case "survey": {
        // 3 questions per objective, 1E · 1M · 1H, full weight.
        for (let index = 0; index < 3; index += 1) {
          const band = bandFor(index)
          const noise = (random() - 0.5) * 22
          const attempt = clamp(next.ability + noise, 0, 100)
          next.rawScore = applyAttempt(next.rawScore, attempt, 1, next.records, band)
          next.records += 1
          if (band === "hard" && attempt >= 60) next.hardCleared = true
          if (band === "easy") {
            next.easyAccuracy = Math.round(clamp(attempt, 0, 100))
          }
        }
        next.confidence = masteryConfidence(next.records, 3, 2)
        next.measuredSincePractice = true
        anyScoreMoved = true
        break
      }
      case "homework": {
        for (let index = 0; index < 3; index += 1) {
          const band = bandFor(index)
          const noise = (random() - 0.5) * 18
          const attempt = clamp(next.ability + noise, 0, 100)
          next.rawScore = applyAttempt(next.rawScore, attempt, 0.5, next.records, band)
          next.records += 1
          if (band === "hard" && attempt >= 60) next.hardCleared = true
          if (band === "easy") {
            next.easyAccuracy = Math.round(
              clamp(((next.easyAccuracy ?? attempt) + attempt) / 2, 0, 100)
            )
          }
        }
        // Homework teaches a little as well as measuring.
        next.ability = clamp(next.ability + 5, 0, 97)
        next.confidence = masteryConfidence(next.records, 3, 2)
        next.measuredSincePractice = true
        anyScoreMoved = true
        break
      }
      case "practice": {
        // Weight zero by design. It teaches; it never measures.
        next.ability = clamp(next.ability + 11, 0, 97)
        next.assists += 2 + Math.round(random() * 3)
        next.measuredSincePractice = false
        break
      }
      case "class":
      case "topic_class": {
        next.ability = clamp(next.ability + 13, 0, 97)
        next.measuredSincePractice = false
        if (decision.activity === "class") next.checkFailures = 0
        break
      }
      case "check": {
        // §06 — 5 questions: 1E · 2M · 2H, timed, no hints, fresh only.
        const bands: Array<"easy" | "medium" | "hard"> = [
          "easy",
          "medium",
          "medium",
          "hard",
          "hard",
        ]
        const points = { easy: 2, medium: 3, hard: 4 }
        let earned = 0
        let easyCorrect = false
        let hardCorrect = false
        bands.forEach((band, index) => {
          const difficultyDrag = band === "easy" ? 18 : band === "medium" ? 4 : -10
          const roll = random() * 100
          const correct = roll < clamp(next.ability + difficultyDrag, 3, 97)
          if (correct) {
            earned += points[band]
            if (band === "easy") easyCorrect = true
            if (band === "hard") hardCorrect = true
          }
          const attempt = correct ? 100 : 0
          next.rawScore = applyAttempt(next.rawScore, attempt, 1, next.records + index, band)
        })
        next.records += 5
        next.confidence = masteryConfidence(next.records, 3, 2)
        next.measuredSincePractice = true
        next.hardCleared = next.hardCleared || hardCorrect
        if (easyCorrect) next.easyAccuracy = Math.max(next.easyAccuracy ?? 0, 85)
        anyScoreMoved = true

        // Pass rule: >= 12 of 16, the easy one correct, and at least one hard.
        const passed = earned >= 12 && easyCorrect && hardCorrect
        if (passed) {
          next.signedOff = true
          next.rawScore = Math.max(next.rawScore, READY_SCORE)
          certified.push(next.text)
        } else {
          next.checkFailures += 1
        }
        break
      }
      case "escalate":
      case "close":
      default:
        break
    }

    return refreshRow(next)
  })

  if (decision.activity === "survey") surveyDone = true
  if (decision.activity === "close") closed = true

  const stalledRounds = anyScoreMoved ? 0 : card.stalledRounds + 1
  const isTopicClass = decision.activity === "topic_class"

  const next = rollUp({
    ...card,
    // `readyRounds` counts consecutive rounds an objective has *ended* in the
    // ready state, so it has to be settled after the activity, not before it.
    rows: rows.map((row) => ({
      ...row,
      readyRounds: row.state === "ready" ? row.readyRounds + 1 : 0,
    })),
    round: card.round + 1,
    surveyDone,
    closed,
    stalledRounds,
    measuredSinceTopicClass: isTopicClass ? false : card.measuredSinceTopicClass || anyScoreMoved,
    topicClassCount: isTopicClass ? card.topicClassCount + 1 : card.topicClassCount,
    topicScoreAtLastTopicClass: isTopicClass
      ? card.topicScore
      : card.topicScoreAtLastTopicClass,
    lastActivity: decision.activity,
  })

  // Narration, written for someone who has never seen either system.
  switch (decision.activity) {
    case "survey":
      headline = "The scorecard fills in for the first time."
      note = `Three questions on each of the ${rows.length} objectives — one easy, one medium, one hard. This is the only activity that can turn an empty row into a number, and it runs before any teaching so the plan is aimed at real gaps rather than assumptions.`
      break
    case "practice": {
      const target = next.rows.find((row) => targets.has(row.id))
      headline = `${target?.text ?? "One objective"} gets taught, not tested again.`
      note = "No score moves, and that is the point. Practice has hints and unlimited retries, so a correct answer there is guaranteed by the format — it teaches, it never measures. The next round's homework finds out whether the teaching landed."
      break
    }
    case "homework":
      headline = "Homework moves the objectives it targets."
      note = "The default activity, and the only one that both teaches and measures. It weights the weakest objectives first, probes the least certain ones, and keeps a slice back to maintain anything already signed off."
      break
    case "check": {
      if (certified.length) {
        headline =
          certified.length === 1
            ? `${certified[0]} is certified — permanently.`
            : `${certified.length} objectives certified.`
        note = `Five fresh questions per objective, timed, no hints, nothing the student has seen before. Passing needs 12 of 16 points, the easy question right, and at least one hard question right. Nothing else on the platform can end an objective.`
      } else {
        const failed = next.rows.find((row) => targets.has(row.id))
        headline = "The check did not pass — and that is allowed to happen."
        note = `${failed?.text ?? "The objective"} fell short. A failure resets nothing: the result is evidence at full weight, so the score simply drops and the objective goes back into the loop. Two failures and a human takes over.`
      }
      break
    }
    case "class":
      headline = "A mentor takes over one objective."
      note = "This is the escalation, not the end. Only the stuck objective leaves the automated loop — the others carry on untouched."
      break
    case "topic_class":
      headline = "The whole topic is taught again."
      note = "Every objective is under the teaching line, which reads differently from one weak spot: the concept never landed. Practice on a single objective would be the wrong prescription here."
      break
    case "escalate":
      headline = "The loop stops itself and calls a human."
      note = "Three failed checks, or four rounds with nothing moving. Rather than keep prescribing, the system flags the objective by name to the teacher."
      break
    case "close":
      headline = `${card.topicName} is finished.`
      note = "Every objective is certified. The classes booked for this topic and no longer needed are handed back to the plan, and this scorecard becomes the baseline for the next topic."
      break
    default:
      break
  }

  return { round: next.round, decision, scorecard: next, headline, note, certified }
}

/** Run the loop forward until the topic closes or `maxRounds` is reached. */
export function simulateTopic(card: MasteryScorecard, maxRounds = 32): MasteryRound[] {
  const rounds: MasteryRound[] = []
  let current = card
  for (let index = 0; index < maxRounds; index += 1) {
    const result = runRound(current)
    rounds.push(result)
    current = result.scorecard
    if (current.closed) break
    // An escalation is a full stop for the demo: a human has been asked for.
    if (result.decision.rule === "R2") break
  }
  // Running out of rounds is a real outcome, not a rendering detail — the
  // handback has to be able to say the topic did not finish.
  const last = rounds[rounds.length - 1]
  if (last && !last.scorecard.closed && last.decision.rule !== "R2") {
    last.scorecard = { ...last.scorecard, exhausted: true }
  }
  return rounds
}

/* ------------------------------------------------------------------ *
 * The handshake back into the Learning Plan Builder.
 * ------------------------------------------------------------------ */

/**
 * Loop rounds a single planned class is taken to cover: the mentor session
 * itself plus the homework and practice done between sessions.
 */
export const ROUNDS_PER_CLASS = 3

export interface MasteryHandback {
  classesAllocated: number
  classesUsed: number
  classesFreed: number
  certified: number
  totalObjectives: number
  outcome: "faster" | "on-track" | "needs-time" | "escalated"
  /** Sentence the builder would show on its capacity card. */
  summary: string
}

/**
 * What the loop hands back to the builder when the topic closes.
 *
 * This is the join that makes the two systems one system: the builder decides
 * how many classes a topic gets, the loop spends them, and what it did not need
 * is returned as real headroom — the same mechanic as the builder's existing
 * "completed faster" outcome, except the loop derives it from certification
 * evidence instead of the teacher typing it.
 */
export function buildHandback(
  rounds: MasteryRound[],
  classesAllocated: number
): MasteryHandback {
  const last = rounds[rounds.length - 1]?.scorecard
  const totalObjectives = last?.rows.length ?? 0
  const certified = last?.signedOffCount ?? 0
  const escalated = rounds.some((round) => round.decision.rule === "R2")
  const finished = last?.closed ?? false

  // A plan class is a mentor session; the homework and practice the loop
  // prescribes are done between sessions. So one class carries roughly three
  // rounds — the taught activity plus the self-serve work that measures it.
  // Never clamped to the allocation: an overrun has to be able to show up as
  // an overrun rather than being rounded away into "on track".
  const classesUsed = Math.max(1, Math.round(rounds.length / ROUNDS_PER_CLASS))
  const classesFreed = finished ? Math.max(0, classesAllocated - classesUsed) : 0

  const outcome: MasteryHandback["outcome"] = escalated
    ? "escalated"
    : !finished || classesUsed > classesAllocated
      ? "needs-time"
      : classesFreed > 0
        ? "faster"
        : "on-track"

  const over = classesUsed - classesAllocated
  const summary = escalated
    ? `The loop escalated after ${rounds.length} rounds. ${certified} of ${totalObjectives} objectives certified — the plan holds its classes and the teacher decides what happens next.`
    : !finished
      ? `${certified} of ${totalObjectives} objectives certified after ${rounds.length} rounds, and the topic is not finished. On the ${classesAllocated} classes booked that is an overrun, not headroom — the plan flags it rather than quietly closing the topic.`
      : over > 0
        ? `All ${totalObjectives} objectives certified, but it took ${classesUsed} classes against the ${classesAllocated} booked. The plan asks for ${over} more and shows why, rather than certifying on less evidence.`
          : classesFreed > 0
          ? `All ${totalObjectives} objectives certified in ${classesUsed} of the ${classesAllocated} classes booked. ${classesFreed} ${classesFreed === 1 ? "class goes" : "classes go"} back to the package as real headroom.`
          : `All ${totalObjectives} objectives certified using the full ${classesAllocated} classes booked. Nothing to hand back, nothing over.`

  return {
    classesAllocated,
    classesUsed,
    classesFreed,
    certified,
    totalObjectives,
    outcome,
    summary,
  }
}

/* ------------------------------------------------------------------ *
 * Naming the builder's structural classes in mastery terms.
 * ------------------------------------------------------------------ */

/**
 * The builder already places checkpoints; the loop already needs a survey and
 * then checks. They are the same classes. This maps one onto the other so the
 * plan board can say what a checkpoint is actually *for*.
 */
export function checkpointMasteryRole(index: number, objectiveCount: number) {
  if (index === 0) {
    return {
      role: "Topic survey",
      detail: `${Math.max(3, objectiveCount) * 3} questions · 3 per objective · fills the scorecard before teaching starts`,
      certifies: false,
    }
  }
  return {
    role: "LO check",
    detail: "5 fresh questions per ready objective · timed, no hints · the only activity that can certify",
    certifies: true,
  }
}

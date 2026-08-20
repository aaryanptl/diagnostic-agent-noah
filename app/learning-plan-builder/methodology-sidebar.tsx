"use client"

/**
 * "Why this" side panel — the short, scenario-specific companion to the full
 * Methodology tab.
 *
 * The tab explains the concepts. This panel explains *this* student: a
 * structured read of who they are and what package they are on, then one or two
 * lines per rule naming the actual topics, scores and class counts that made
 * the screen look the way it does. It is openable on every screen so the logic
 * behind whichever step is on show can be pulled up while presenting.
 *
 * Rules quoted here live in `lib/learning-plan/engine.ts`. Keep every line
 * short and specific — anything that needs a paragraph, or that is true of any
 * student, belongs in the Methodology tab instead.
 */

import type { MethodologyContext } from "./methodology"
import type {
  CurriculumTopic,
  DemoStudent,
  GeneratedPlan,
} from "@/lib/learning-plan/types"
import { BookOpen, X } from "lucide-react"
import { useEffect, useMemo } from "react"

/**
 * The small diagram under a note. Numbers a teacher has to hold in their head —
 * a score against its thresholds, classes before and after, a package split —
 * land faster as a picture than as a sentence.
 */
type NoteVisual =
  /** Placement score on the 40% / 75% band scale. */
  | { kind: "score"; score: number }
  /** Class count before and after a rule, with the floor marked. */
  | { kind: "classes"; ideal: number; actual: number; minimum?: number }
  /** Objectives secure vs not secure. */
  | { kind: "objectives"; secure: number; notSecure: number; total: number }
  /** A prerequisite running in front of the topic that depends on it. */
  | {
      kind: "chain"
      steps: { label: string; meta?: string; tone?: "prereq" | "target" }[]
    }
  /** Line-by-line class arithmetic, each row scaled against the package. */
  | {
      kind: "calc"
      rows: {
        label: string
        value: number
        tone: "base" | "cut" | "add" | "total" | "cap"
      }[]
    }
  /** Stacked make-up of a class budget. */
  | {
      kind: "bar"
      total: number
      segments: { label: string; value: number; tone: string }[]
    }

/** One rule, applied to this student, in a line or two. */
interface ScenarioNote {
  /** Short rule name shown as the line's label. */
  tag: string
  text: string
  /** Highlights the note that most explains the screen. */
  key?: boolean
  visual?: NoteVisual
}

/** A labelled fact in the student block at the top of the panel. */
interface StudentFact {
  label: string
  value: string
  /** Second line under the value — the consequence of that fact. */
  note?: string
}

const CONTEXT_HEADING: Partial<Record<MethodologyContext, string>> = {
  evidence: "What this evidence changes",
  scope: "Why these topics, in this order",
  review: "How this fits the package",
  building: "What the builder is doing now",
  classes: "Why the classes fall this way",
  topics: "Why each topic is this long",
  structure: "Why these structural classes",
  next2weeks: "What the next two weeks cover",
  mentor: "Where this student is right now",
}

const SCENARIO_META: Record<
  DemoStudent["scenario"],
  { case: string; rule: string }
> = {
  A: {
    case: "New student with evidence",
    rule: "Placement scores drive the first plan: **75%+ shortens a topic**, **under 40% keeps it full**.",
  },
  B: {
    case: "New student without a test",
    rule: "Nothing to read, so **every topic starts at its ideal length** and capacity alone decides the plan.",
  },
  C: {
    case: "Returning student · plan update",
    rule: "**Completed topics drop out** and **classes already taught are subtracted** from what remains.",
  },
  D: {
    case: "Parent-requested starting topic",
    rule: "The requested topic's unmet prerequisites **run in front of it as shortened refreshers**.",
  },
}

/** Ordering used to spot a prerequisite that outranks its dependant. */
const PRIORITY_RANK: Record<CurriculumTopic["priority"], number> = {
  high: 0,
  medium: 1,
  low: 2,
}

const PRIORITY_LABEL: Record<CurriculumTopic["priority"], string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
}

const PLACEMENT_LABEL: Record<DemoStudent["placementStatus"], string> = {
  completed: "Completed",
  "not-taken": "Not taken",
  "not-applicable": "Not applicable",
}

/**
 * The structured student read at the top of the panel: who, what package, and
 * what that combination means before a single topic is chosen.
 */
function buildStudentFacts(
  student: DemoStudent,
  topics: CurriculumTopic[]
): StudentFact[] {
  const scenario = SCENARIO_META[student.scenario]
  const perWeek = student.classesPerWeek ?? 2
  const weeks = Math.ceil(student.classesRemaining / perWeek)
  const tested = student.placementResults.length

  const facts: StudentFact[] = [
    {
      label: "Case",
      value: `Scenario ${student.scenario} · ${scenario.case}`,
      note: scenario.rule,
    },
    {
      label: "Assessment test",
      value:
        student.placementStatus === "completed"
          ? `${PLACEMENT_LABEL.completed} · ${tested} ${tested === 1 ? "topic" : "topics"} scored`
          : PLACEMENT_LABEL[student.placementStatus],
      note:
        student.placementStatus === "completed"
          ? student.defaultPlacementScore !== undefined
            ? `Untested topics fall back to the **${student.defaultPlacementScore}% student default**.`
            : undefined
          : student.placementStatus === "not-taken"
            ? "No score to read, so **no topic is shortened on placement**."
            : "Returning student — checkpoint mastery is read instead.",
    },
    {
      label: "Grade",
      value: `Grade ${student.grade} · ${student.region === "US" ? "US curriculum" : student.region}`,
      note: `${topics.length} topics in the Grade ${student.grade} teaching sequence.`,
    },
    {
      label: "Package",
      value: student.packageLabel ?? `${student.classesRemaining} classes`,
      note: `**${student.classesRemaining} classes to fill** — teaching, checkpoints, RDP and the PTM reserve all come out of this.`,
    },
    {
      label: "Pace",
      value: `${perWeek} classes / week`,
      note: `About **${weeks} weeks** of teaching, and the two-week view shows the next **${perWeek * 2}**.`,
    },
  ]

  if (student.completedTopics.length > 0) {
    const taught = student.completedTopics.reduce(
      (total, topic) => total + topic.actualClasses,
      0
    )
    facts.push({
      label: "Already taught",
      value: `${student.completedTopics.length} topics · ${taught} classes`,
      note: "**Excluded from the scope** — they are listed as not scheduled, not re-taught.",
    })
  }

  return facts
}

/**
 * Renders `**...**` spans in a note as bold. Notes mark the decision the rule
 * made — the class counts, the floor, the thing that actually changed — so it
 * is readable at a glance while presenting.
 */
function emphasise(text: string) {
  return text
    .split(/\*\*(.+?)\*\*/g)
    .map((part, index) => (index % 2 === 1 ? <b key={index}>{part}</b> : part))
}

/**
 * Placement score against the two thresholds the engine actually branches on.
 * The band the score falls in is what decides whether a topic shortens, holds
 * or keeps its full length, so the thresholds are drawn, not described.
 */
function ScoreMeter({ score }: { score: number }) {
  const band = score >= 75 ? "strong" : score < 40 ? "weak" : "mid"
  return (
    <div className={`lpb-viz-score ${band}`}>
      <div className="lpb-viz-score-track">
        <span className="zone weak" style={{ width: "40%" }} />
        <span className="zone mid" style={{ width: "35%" }} />
        <span className="zone strong" style={{ width: "25%" }} />
        <span className="marker" style={{ left: `${score}%` }}>
          <b>{score}%</b>
        </span>
      </div>
      <div className="lpb-viz-score-scale">
        <span style={{ left: "40%" }}>40</span>
        <span style={{ left: "75%" }}>75</span>
      </div>
    </div>
  )
}

/**
 * One cell per class. Kept classes are solid, classes a rule removed are
 * struck through, classes it added are outlined — so the size of the change is
 * visible without reading the numbers.
 */
function ClassChips({
  ideal,
  actual,
  minimum,
}: {
  ideal: number
  actual: number
  minimum?: number
}) {
  const cells = Math.max(ideal, actual)
  return (
    <div className="lpb-viz-classes">
      <div className="lpb-viz-cells">
        {Array.from({ length: cells }, (_, index) => {
          const position = index + 1
          const state =
            position > actual ? "removed" : position > ideal ? "added" : "kept"
          const floor = minimum !== undefined && position === minimum
          return (
            <span
              key={index}
              className={`${state}${floor ? " floor" : ""}`}
              aria-hidden="true"
            />
          )
        })}
      </div>
      <span className="lpb-viz-caption">
        {ideal} → <b>{actual}</b> classes
        {minimum !== undefined ? ` · floor ${minimum}` : ""}
      </span>
    </div>
  )
}

/** Objectives secure vs not secure — the ratio the extension rule reads. */
function ObjectiveDots({
  secure,
  notSecure,
  total,
}: {
  secure: number
  notSecure: number
  total: number
}) {
  return (
    <div className="lpb-viz-classes">
      <div className="lpb-viz-cells">
        {Array.from({ length: total }, (_, index) => {
          const state =
            index < secure
              ? "kept"
              : index < secure + notSecure
                ? "gap"
                : "untested"
          return <span key={index} className={state} aria-hidden="true" />
        })}
      </div>
      <span className="lpb-viz-caption">
        <b>{notSecure}</b> not secure · {secure} secure · {total} objectives
      </span>
    </div>
  )
}

/** Stacked make-up of a class budget, with a legend under it. */
function StackedBar({
  total,
  segments,
}: {
  total: number
  segments: { label: string; value: number; tone: string }[]
}) {
  const used = segments.reduce((sum, segment) => sum + segment.value, 0)
  const spare = Math.max(0, total - used)
  return (
    <div className="lpb-viz-bar">
      <div className="lpb-viz-bar-track">
        {segments.map((segment) => (
          <span
            key={segment.label}
            className={`seg ${segment.tone}`}
            style={{ width: `${(segment.value / Math.max(total, used)) * 100}%` }}
          />
        ))}
        {spare > 0 ? (
          <span
            className="seg spare"
            style={{ width: `${(spare / Math.max(total, used)) * 100}%` }}
          />
        ) : null}
      </div>
      <div className="lpb-viz-legend">
        {segments.map((segment) => (
          <span key={segment.label} className={segment.tone}>
            <i />
            {segment.label} {segment.value}
          </span>
        ))}
        {spare > 0 ? (
          <span className="spare">
            <i />
            Spare {spare}
          </span>
        ) : null}
      </div>
    </div>
  )
}

/**
 * A prerequisite and the topic waiting on it, drawn top to bottom. Ordering is
 * the one rule that overrides priority, so it is worth seeing as a sequence
 * rather than reading as a clause.
 */
function PrereqChain({
  steps,
}: {
  steps: { label: string; meta?: string; tone?: "prereq" | "target" }[]
}) {
  return (
    <div className="lpb-viz-chain">
      {steps.map((step, index) => (
        <div key={step.label} className={`step ${step.tone ?? ""}`}>
          <strong>{step.label}</strong>
          {step.meta ? <span>{step.meta}</span> : null}
          {index < steps.length - 1 ? (
            <i className="arrow" aria-hidden="true" />
          ) : null}
        </div>
      ))}
    </div>
  )
}

/**
 * The class arithmetic as a receipt: what the topics ideally need, what
 * evidence took off or added, what structure costs, and what that lands on
 * against the package. Each row carries a bar scaled to the largest figure, so
 * the size of every adjustment is visible next to the number.
 */
function CalcRows({
  rows,
}: {
  rows: {
    label: string
    value: number
    tone: "base" | "cut" | "add" | "total" | "cap"
  }[]
}) {
  const scale = Math.max(...rows.map((row) => Math.abs(row.value)), 1)
  return (
    <div className="lpb-viz-calc">
      {rows.map((row) => (
        <div key={row.label} className={`row ${row.tone}`}>
          <span className="label">{row.label}</span>
          <span className="track">
            <i style={{ width: `${(Math.abs(row.value) / scale) * 100}%` }} />
          </span>
          <span className="value">
            {row.tone === "cut" || row.tone === "add"
              ? `${row.value > 0 ? "+" : "−"}${Math.abs(row.value)}`
              : row.value}
          </span>
        </div>
      ))}
    </div>
  )
}

function NoteFigure({ visual }: { visual: NoteVisual }) {
  switch (visual.kind) {
    case "score":
      return <ScoreMeter score={visual.score} />
    case "classes":
      return (
        <ClassChips
          ideal={visual.ideal}
          actual={visual.actual}
          minimum={visual.minimum}
        />
      )
    case "objectives":
      return (
        <ObjectiveDots
          secure={visual.secure}
          notSecure={visual.notSecure}
          total={visual.total}
        />
      )
    case "chain":
      return <PrereqChain steps={visual.steps} />
    case "calc":
      return <CalcRows rows={visual.rows} />
    case "bar":
      return <StackedBar total={visual.total} segments={visual.segments} />
  }
}

function pct(value: number) {
  return `${value}%`
}

/** "A, B and C" — keeps the score lists readable at panel width. */
function joinList(parts: string[]) {
  if (parts.length <= 1) return parts[0] ?? ""
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
}

/**
 * Builds the notes for one screen. Everything is derived from the student and
 * plan on screen — every line names a topic, a score or a class count.
 */
function buildNotes(
  context: MethodologyContext,
  student: DemoStudent,
  topics: CurriculumTopic[],
  plan: GeneratedPlan | null,
  selectedTopicIds: number[]
): ScenarioNote[] {
  const notes: ScenarioNote[] = []
  const topicById = new Map(topics.map((topic) => [topic.id, topic]))
  const nameOf = (id: number) =>
    plan?.allocations.find((allocation) => allocation.topicId === id)
      ?.topicName ??
    topicById.get(id)?.name ??
    `Topic ${id}`

  const selected = selectedTopicIds
    .map((id) => topicById.get(id))
    .filter((topic): topic is CurriculumTopic => Boolean(topic))
  const byPriority = (priority: CurriculumTopic["priority"]) =>
    selected.filter((topic) => topic.priority === priority)
  const highTopics = byPriority("high")
  const mediumTopics = byPriority("medium")
  const lowTopics = byPriority("low")
  const idealOf = (list: CurriculumTopic[]) =>
    list.reduce((total, topic) => total + topic.idealClasses, 0)

  const strongPlacements = student.placementResults
    .filter((result) => result.score >= 75)
    .sort((a, b) => b.score - a.score)
  const weakPlacements = student.placementResults
    .filter((result) => result.score < 40)
    .sort((a, b) => a.score - b.score)
  const midPlacements = student.placementResults.filter(
    (result) => result.score >= 40 && result.score < 75
  )

  // Objective evidence is recorded per objective; group it back to its topic so
  // a note can name the topic the teacher is looking at.
  const topicOfObjective = new Map<string, number>()
  for (const topic of topics) {
    for (const objective of topic.learningObjectives) {
      topicOfObjective.set(objective.id, topic.id)
    }
  }
  const notSecureByTopic = new Map<number, number>()
  const secureByTopic = new Map<number, number>()
  for (const evidence of student.objectiveEvidence) {
    const topicId = topicOfObjective.get(evidence.learningObjectiveId)
    if (topicId === undefined) continue
    const bucket =
      evidence.result === "not-secure" ? notSecureByTopic : secureByTopic
    bucket.set(topicId, (bucket.get(topicId) ?? 0) + 1)
  }

  switch (context) {
    case "evidence": {
      if (student.placementStatus === "not-taken") {
        notes.push({
          tag: "No placement",
          text: `Nothing to read, so all ${topics.length} topics keep their ideal class count and capacity alone decides the plan.`,
          key: true,
        })
      }
      for (const result of strongPlacements.slice(0, 3)) {
        const topic = topicById.get(result.topicId)
        const shortened = topic
          ? Math.max(
              topic.minimumClasses,
              topic.idealClasses - Math.ceil(topic.idealClasses * 0.3)
            )
          : undefined
        notes.push({
          tag: `${nameOf(result.topicId)} · ${pct(result.score)}`,
          text: topic
            ? `75%+, so the topic is shortened and the split shifts toward easy consolidation.`
            : "75%+, so the topic is shortened toward its minimum.",
          key: true,
          visual: topic
            ? {
                kind: "classes",
                ideal: topic.idealClasses,
                actual: shortened ?? topic.idealClasses,
                minimum: topic.minimumClasses,
              }
            : { kind: "score", score: result.score },
        })
      }
      for (const result of weakPlacements.slice(0, 3)) {
        const topic = topicById.get(result.topicId)
        notes.push({
          tag: `${nameOf(result.topicId)} · ${pct(result.score)}`,
          text: topic
            ? `Under 40%, so **all ${topic.idealClasses} classes are kept** and practice rises to about ${Math.min(80, topic.practicePercent + 15)}% of activities.`
            : "Under 40%, so the full allocation is kept with more practice.",
          key: true,
          visual: { kind: "score", score: result.score },
        })
      }
      if (midPlacements.length > 0) {
        notes.push({
          tag: "Mid-range",
          text: `${joinList(midPlacements.map((result) => `${nameOf(result.topicId)} ${pct(result.score)}`))} sit in 40–74%, so they **run at their ideal allocation** untouched.`,
        })
      }
      for (const [topicId, count] of Array.from(notSecureByTopic).slice(0, 3)) {
        const topic = topicById.get(topicId)
        const secure = secureByTopic.get(topicId) ?? 0
        notes.push({
          tag: `${nameOf(topicId)} · mastery`,
          text: topic
            ? `So the topic **extends beyond ${topic.idealClasses} classes**, capped at ${topic.idealClasses + 2}.`
            : `${count} objectives not secure, so the topic is extended.`,
          key: true,
          visual: topic
            ? {
                kind: "objectives",
                secure,
                notSecure: count,
                total: topic.learningObjectives.length,
              }
            : undefined,
        })
      }
      if (student.questionAttemptEvidence?.length) {
        const gap = student.questionAttemptEvidence.find(
          (attempt) =>
            attempt.level === "master" && attempt.correct / attempt.attempted < 0.5
        )
        if (gap) {
          notes.push({
            tag: "Starter vs Master",
            text: `Master questions on ${nameOf(gap.topicId)} are ${gap.correct}/${gap.attempted} — **the full allocation is held** and the teaching note asks for transfer, not more drill.`,
          })
        }
      }
      break
    }

    case "scope": {
      notes.push({
        tag: `${highTopics.length} High locked in`,
        text: "**High topics cannot be unselected** — evidence can shorten them, never remove them. Medium and Low follow only while classes remain.",
        key: true,
        visual: {
          kind: "bar",
          total: student.classesRemaining,
          segments: [
            { label: "High", value: idealOf(highTopics), tone: "high" },
            { label: "Medium", value: idealOf(mediumTopics), tone: "medium" },
            { label: "Low", value: idealOf(lowTopics), tone: "low" },
          ],
        },
      })
      notes.push({
        tag: "Then capacity",
        text: `${mediumTopics.length} Medium (${idealOf(mediumTopics)} classes) and ${lowTopics.length} Low (${idealOf(lowTopics)} classes) are added after that, while classes remain.`,
      })
      // Prerequisite pairs inside the selection — the "Requires #nn" badges on
      // the topic list, and the one rule that outranks priority order.
      const selectedIds = new Set(selected.map((topic) => topic.id))
      const prereqPairs = selected.flatMap((topic) =>
        topic.prerequisiteIds
          .map((id) => topicById.get(id))
          .filter(
            (prereq): prereq is CurriculumTopic =>
              Boolean(prereq) && selectedIds.has(prereq!.id)
          )
          .map((prereq) => ({ topic, prereq }))
      )
      if (prereqPairs.length > 0) {
        const example =
          // Prefer a pair that shows the override: a lower-priority
          // prerequisite pulled in front of a higher-priority topic.
          prereqPairs.find(
            (pair) =>
              PRIORITY_RANK[pair.prereq.priority] >
              PRIORITY_RANK[pair.topic.priority]
          ) ?? prereqPairs[0]
        notes.push({
          tag: `${prereqPairs.length} prerequisite links`,
          text: "Each prerequisite is placed **ahead of the topic that needs it** — this outranks the priority order, so a Medium prerequisite still runs before the High topic depending on it.",
          key: true,
          visual: {
            kind: "chain",
            steps: [
              {
                label: example.prereq.name,
                meta: `${PRIORITY_LABEL[example.prereq.priority]} · taught first`,
                tone: "prereq",
              },
              {
                label: example.topic.name,
                meta: `${PRIORITY_LABEL[example.topic.priority]} · needs it`,
                tone: "target",
              },
            ],
          },
        })
      }

      // Rule H2: a prerequisite the student has already proven, sitting in
      // front of one they are weak in, is shortened rather than skipped.
      const scoreOf = (id: number) =>
        student.placementResults.find((result) => result.topicId === id)?.score
      const refresherPair = prereqPairs.find((pair) => {
        const prereqScore = scoreOf(pair.prereq.id)
        const topicScore = scoreOf(pair.topic.id)
        return (
          prereqScore !== undefined &&
          topicScore !== undefined &&
          prereqScore >= 75 &&
          topicScore < 40
        )
      })
      if (refresherPair) {
        const halved = Math.max(1, Math.ceil(refresherPair.prereq.idealClasses / 2))
        notes.push({
          tag: "Refresher, not a skip",
          text: `Already proven at ${pct(scoreOf(refresherPair.prereq.id)!)} in front of a topic at ${pct(scoreOf(refresherPair.topic.id)!)}, so it is **halved rather than dropped** and the weak topic is reached sooner.`,
          key: true,
          visual: {
            kind: "chain",
            steps: [
              {
                label: refresherPair.prereq.name,
                meta: `${pct(scoreOf(refresherPair.prereq.id)!)} · ${refresherPair.prereq.idealClasses} → ${halved} classes`,
                tone: "prereq",
              },
              {
                label: refresherPair.topic.name,
                meta: `${pct(scoreOf(refresherPair.topic.id)!)} · full ${refresherPair.topic.idealClasses} classes`,
                tone: "target",
              },
            ],
          },
        })
      }

      // Scenario D: the requested topic's own prerequisite chain.
      if (student.parentRequestedTopicId) {
        const requested = topicById.get(student.parentRequestedTopicId)
        const chain = (requested?.prerequisiteIds ?? [])
          .map((id) => topicById.get(id))
          .filter((topic): topic is CurriculumTopic => Boolean(topic))
        if (requested && chain.length > 0) {
          notes.push({
            tag: "Parent request",
            text: `${requested.name} was asked for, so its unmet prerequisites run **in front of it as refreshers** rather than being skipped to reach it.`,
            key: true,
            visual: {
              kind: "chain",
              steps: [
                ...chain.map((topic) => ({
                  label: topic.name,
                  meta: `refresher · ${Math.max(1, Math.ceil(topic.idealClasses / 2))} of ${topic.idealClasses} classes`,
                  tone: "prereq" as const,
                })),
                {
                  label: requested.name,
                  meta: "requested topic",
                  tone: "target" as const,
                },
              ],
            },
          })
        }
      }
      const totalIdeal =
        idealOf(highTopics) + idealOf(mediumTopics) + idealOf(lowTopics)
      notes.push({
        tag: "Running total",
        text: `**${totalIdeal} teaching classes** selected against **${student.classesRemaining} available**, before structural classes are reserved.`,
        key: true,
      })
      break
    }

    case "review":
    case "structure": {
      if (!plan) break
      const { capacity } = plan
      const checkpoints = plan.items.filter(
        (item) => item.kind === "checkpoint"
      ).length
      const rdp = plan.items.filter((item) => item.kind === "rdp").length
      // Ideal length of everything selected, before any rule touched it — the
      // figure the evidence and capacity adjustments are measured against.
      const idealTeaching = plan.allocations.reduce(
        (total, allocation) => total + allocation.idealClasses,
        0
      )
      const teachingDelta = capacity.teaching - idealTeaching
      notes.push({
        tag: "The class calculation",
        text: `**${capacity.total} of ${capacity.available} classes** are accounted for.`,
        key: true,
        visual: {
          kind: "calc",
          rows: [
            { label: "Topics at ideal", value: idealTeaching, tone: "base" },
            ...(teachingDelta !== 0
              ? [
                  {
                    label:
                      teachingDelta < 0
                        ? "Evidence & compression"
                        : "Mastery extensions",
                    value: teachingDelta,
                    tone: (teachingDelta < 0 ? "cut" : "add") as "cut" | "add",
                  },
                ]
              : []),
            { label: "Teaching planned", value: capacity.teaching, tone: "total" },
            {
              label: "Checkpoints & RDP",
              value: capacity.structural,
              tone: "add",
            },
            { label: "PTM reserve", value: capacity.opsReserve, tone: "add" },
            { label: "Planned total", value: capacity.total, tone: "total" },
            { label: "In the package", value: capacity.available, tone: "cap" },
          ],
        },
      })
      if (capacity.difference < 0) {
        notes.push({
          tag: `${Math.abs(capacity.difference)} classes spare`,
          text:
            capacity.surplusClasses > 0
              ? "10 or more are left over, so they are **held as “Revision / School Help”** rather than padded into topics."
              : "**Real headroom under the package** — every class a rule saved shows up here rather than being absorbed by the curriculum.",
          visual: {
            kind: "bar",
            total: capacity.available,
            segments: [
              { label: "Teaching", value: capacity.teaching, tone: "high" },
              {
                label: "Structural",
                value: capacity.structural,
                tone: "medium",
              },
              { label: "PTM", value: capacity.opsReserve, tone: "ops" },
            ],
          },
        })
      }
      if (capacity.difference > 0) {
        notes.push({
          tag: `Over by ${capacity.difference}`,
          text: "High-priority topics still do not fit, so the plan **warns for a manual decision** instead of dropping one on its own.",
          key: true,
        })
      }
      if (capacity.compressedClasses > 0) {
        const squeezed = plan.allocations.filter(
          (allocation) => (allocation.compressedByCapacity ?? 0) > 0
        )
        notes.push({
          tag: `${capacity.compressedClasses} classes compressed`,
          text: squeezed.length
            ? `${joinList(squeezed.slice(0, 3).map((allocation) => `${allocation.topicName} ${allocation.idealClasses}→${allocation.classes}`))} — **lowest priority and latest sequence first**, never under a minimum.`
            : "**Lowest priority and latest sequence first**, never under a topic's minimum.",
          key: true,
        })
      }
      if (plan.droppedTopics.length > 0) {
        notes.push({
          tag: `${plan.droppedTopics.length} not scheduled`,
          text: `${joinList(plan.droppedTopics.slice(0, 3).map((topic) => topic.topicName))} — **Low goes before Medium**, and nothing another topic depends on is dropped.`,
        })
      }
      notes.push({
        tag: "Structure kept",
        text: `${checkpoints} checkpoints and ${rdp} RDP survive here. **RDP is always shed before a checkpoint**, because checkpoints produce the evidence.`,
      })
      if (capacity.opsReserve > 0) {
        notes.push({
          tag: `${capacity.opsReserve} PTM reserved`,
          text: "Held against the package but **never placed in the sequence** — ops schedules those on its own calendar.",
        })
      }
      break
    }

    case "building": {
      notes.push({
        tag: "Sequencing",
        text: `**Prerequisites first, then High → Medium → Low** across the ${selected.length} selected topics, using curriculum order inside each band.`,
        key: true,
      })
      notes.push({
        tag: "Then filling",
        text: "Each class picks up its learning objectives and an Easy / Practice activity split from the topic's allocation.",
      })
      break
    }

    case "classes":
    case "next2weeks": {
      if (!plan) break
      const firstTeaching = plan.items.find((item) => item.kind === "teaching")
      if (firstTeaching) {
        notes.push({
          tag: `Class ${firstTeaching.classNumber} · ${firstTeaching.topicName}`,
          text: "Opens the plan — **nothing it depends on is unmet**, and it is the earliest topic in the highest band still to teach.",
          key: true,
        })
      }
      const nextCheckpoint = plan.items.find(
        (item) => item.kind === "checkpoint"
      )
      if (nextCheckpoint) {
        notes.push({
          tag: `Checkpoint at class ${nextCheckpoint.classNumber}`,
          text: "Assesses the block before it. Its result is **the evidence that resizes every class after it**.",
          key: true,
        })
      }
      const skipped = plan.items.filter((item) => item.status === "skipped")
      if (skipped.length > 0) {
        notes.push({
          tag: `${skipped.length} slots freed`,
          text: "A shortened topic leaves its class numbers in place, so **nothing already taught gets renumbered**.",
        })
      }
      if (context === "next2weeks") {
        const perWeek = student.classesPerWeek ?? 2
        notes.push({
          tag: "Window",
          text: `${perWeek} classes a week, so this view is **the next ${perWeek * 2} classes** — the part the parent is shown.`,
          key: true,
        })
      }
      notes.push({
        tag: "After each class",
        text: "**Faster returns a class to the pool** (never below the minimum), **needs-more-time adds one**, capped at ideal + 2.",
      })
      break
    }

    case "topics": {
      if (!plan) break
      const changed = plan.allocations
        .filter((allocation) => allocation.classes !== allocation.idealClasses)
        .slice(0, 5)
      for (const allocation of changed) {
        const shorter = allocation.classes < allocation.idealClasses
        notes.push({
          tag: `${allocation.topicName} · ${allocation.idealClasses}→${allocation.classes}`,
          text: `${shorter ? "**Shortened**" : "**Extended**"}${allocation.atMinimum ? ", now at its floor" : ""}. ${allocation.reasons[allocation.reasons.length - 1] ?? ""}`,
          key: true,
          visual: {
            kind: "classes",
            ideal: allocation.idealClasses,
            actual: allocation.classes,
            minimum: allocation.minimumClasses || undefined,
          },
        })
      }
      if (changed.length === 0) {
        notes.push({
          tag: "All at ideal",
          text: `Nothing resized this student — **all ${plan.allocations.length} topics run at their ideal class count**.`,
          key: true,
        })
      }
      notes.push({
        tag: "The floor",
        text: "**No automatic rule goes under a topic's minimum.** Only a teacher override can, and the plan flags it when it does.",
      })
      break
    }

    case "mentor": {
      if (student.currentTopicId) {
        const stuck = notSecureByTopic.get(student.currentTopicId) ?? 0
        const secure = secureByTopic.get(student.currentTopicId) ?? 0
        const activeTopic = topicById.get(student.currentTopicId)
        notes.push({
          tag: `Active · ${nameOf(student.currentTopicId)}`,
          text: `**${student.currentTopicClassesUsed ?? 0} classes taught** so far${stuck > 0 ? `, with ${stuck} objectives still not secure` : ""}.`,
          key: true,
          visual: activeTopic
            ? {
                kind: "objectives",
                secure,
                notSecure: stuck,
                total: activeTopic.learningObjectives.length,
              }
            : undefined,
        })
      }
      for (const evidence of student.objectiveEvidence
        .filter((item) => item.result === "not-secure")
        .slice(0, 2)) {
        notes.push({
          tag: `${evidence.level === "master" ? "Master" : "Starter"} gap`,
          text: evidence.note,
          key: true,
        })
      }
      notes.push({
        tag: "What to teach",
        text: "Secure Starter with weak Master means **teach transfer, not more drill**. The reverse means **repair the routine first**.",
      })
      notes.push({
        tag: "Feeding back",
        text: "Recording an outcome previews the new allocation; **a new plan version is written only once the teacher approves**.",
      })
      break
    }
  }

  return notes
}

interface MethodologySidebarProps {
  open: boolean
  onClose: () => void
  context: MethodologyContext
  student: DemoStudent
  topics: CurriculumTopic[]
  plan: GeneratedPlan | null
  selectedTopicIds: number[]
  /** Opens the plan board's full Methodology tab. Absent before a plan exists. */
  onOpenFullMethodology?: () => void
}

export function MethodologySidebar({
  open,
  onClose,
  context,
  student,
  topics,
  plan,
  selectedTopicIds,
  onOpenFullMethodology,
}: MethodologySidebarProps) {
  const notes = useMemo(
    () => buildNotes(context, student, topics, plan, selectedTopicIds),
    [context, student, topics, plan, selectedTopicIds]
  )
  const facts = useMemo(
    () => buildStudentFacts(student, topics),
    [student, topics]
  )
  // The first screen is the student read and nothing else — the rules only
  // start mattering once there is evidence and a scope to apply them to. Later
  // screens drop the fact block and carry the rule notes instead.
  const isStudentStep = context === "student"

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, onClose])

  return (
    <aside
      className={`lpb-why-panel${open ? " open" : ""}`}
      aria-label="Why this plan looks like this"
      aria-hidden={!open}
    >
      <header>
        <div className="lpb-why-id">
          <span className="lpb-why-avatar" aria-hidden="true">
            {student.initials}
          </span>
          <div>
            <strong>{student.name}</strong>
            <span>
              Grade {student.grade} ·{" "}
              {student.packageLabel ?? `${student.classesRemaining} classes`}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="lpb-icon-button"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={15} />
        </button>
      </header>

      <div className="lpb-why-body">
        {isStudentStep ? (
          <section className="lpb-why-facts">
            {facts.map((fact) => (
              <div key={fact.label}>
                <span>{fact.label}</span>
                <strong>{fact.value}</strong>
                {fact.note ? <small>{emphasise(fact.note)}</small> : null}
              </div>
            ))}
          </section>
        ) : null}

        {isStudentStep ? null : (
          <section className="lpb-why-notes">
            <span className="lpb-detail-label">{CONTEXT_HEADING[context]}</span>
            {notes.length > 0 ? (
              notes.map((note, index) => (
                <article
                  key={`${note.tag}-${index}`}
                  className={note.key ? "key" : ""}
                >
                  <span>{note.tag}</span>
                  <p>{emphasise(note.text)}</p>
                  {note.visual ? <NoteFigure visual={note.visual} /> : null}
                </article>
              ))
            ) : (
              <p className="lpb-why-empty">
                Build the plan to see the rules that shaped this screen.
              </p>
            )}
          </section>
        )}
      </div>

      {onOpenFullMethodology ? (
        <footer>
          <button
            type="button"
            onClick={() => {
              onOpenFullMethodology()
              onClose()
            }}
          >
            <BookOpen size={14} />
            About this tool
          </button>
        </footer>
      ) : null}
    </aside>
  )
}

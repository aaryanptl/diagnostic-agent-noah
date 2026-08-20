"use client"

/**
 * Methodology — the plain-language explanation of how the builder decides what
 * goes into a plan, in what order, and what changes it afterwards. Rendered as
 * the plan board's Methodology tab.
 *
 * This is the concept, read at leisure. The short, scenario-specific version —
 * which rule fired for *this* student, in a line or two — is the "Why this"
 * side panel in `methodology-sidebar.tsx`, which is reachable on every screen.
 *
 * Everything here mirrors `lib/learning-plan/engine.ts` and `README.md`. When a
 * rule changes in the engine, the matching card has to change with it — the
 * rule ids in the card eyebrows are the link between the two.
 */

import type { DemoStudent, GeneratedPlan } from "@/lib/learning-plan/types"
import { demoStudents, topicById } from "./data"
import {
  ArrowRight,
  CalendarDays,
  ClipboardCheck,
  Compass,
  Gauge,
  History,
  Layers,
  Lightbulb,
  ListOrdered,
  PieChart,
  Repeat,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  SquareStack,
  Wand2,
  Wrench,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { useMemo, type ReactNode } from "react"

/**
 * Where the teacher is in the builder. Setup screens use the stepper's names,
 * the plan board uses its tab names. Sections declare which of these they
 * explain, and the "Why this" panel keys its notes off the same values.
 */
export type MethodologyContext =
  | "student"
  | "evidence"
  | "scope"
  | "review"
  | "building"
  | "classes"
  | "topics"
  | "structure"
  | "next2weeks"
  | "mentor"

/** Maps the setup stepper's numeric step onto a methodology context. */
export function methodologyContextForSetupStep(
  step: number
): MethodologyContext {
  if (step <= 1) return "student"
  if (step === 2) return "evidence"
  if (step === 3) return "scope"
  return "review"
}

interface PipelineStep {
  title: string
  body: string
}

const PIPELINE: PipelineStep[] = [
  {
    title: "Read the evidence",
    body: "Placement scores, objective mastery, question attempts, completed and in-progress topics.",
  },
  {
    title: "Pick the scope",
    body: "High priority is locked in; Medium and Low are added while capacity allows.",
  },
  {
    title: "Size each topic",
    body: "Evidence stretches or shortens a topic between its minimum and ideal + 2 classes.",
  },
  {
    title: "Fit the package",
    body: "If the scope overruns, the fit ladder sheds structure, compresses, then drops.",
  },
  {
    title: "Sequence and teach",
    body: "Prerequisites first, then priority order; each class gets objectives and activities.",
  },
  {
    title: "Update after class",
    body: "Faster / on track / needs more time re-sizes the remaining topic on approval.",
  },
]

/**
 * The four demo scenarios read as *history*: what the builder already knows
 * about a student before it picks a single topic.
 *
 * The rule cards below explain each rule once. This block explains why the same
 * rules produce four different-looking plans — B starts from nothing, C starts
 * from thirteen taught classes and a checkpoint, and the distance between those
 * two is the whole point. Everything here is read off `demoStudents`, so it
 * cannot drift from the students the prototype actually loads.
 */
type HistoryDepth = "none" | "evidence" | "taught"

interface ScenarioHistoryRow {
  scenario: DemoStudent["scenario"]
  name: string
  case: string
  depth: HistoryDepth
  depthLabel: string
  /** Fixed set of rows, in the same order on every card, so the four compare. */
  facts: { label: string; value: string; empty: boolean }[]
  consequence: string
  /** True for the student currently loaded in the builder. */
  current: boolean
}

const SCENARIO_CASE: Record<DemoStudent["scenario"], string> = {
  A: "New student · test taken",
  B: "New student · no test",
  C: "Returning student · plan update",
  D: "New student · parent request",
}

const SCENARIO_CONSEQUENCE: Record<DemoStudent["scenario"], string> = {
  A: "Scores are the only history there is, so they alone stretch or shorten topics. Nothing is excluded — none of it has been taught yet.",
  B: "Nothing to read at all. Every topic starts at its ideal length and capacity alone decides what fits.",
  C: "The full history: taught topics leave the scope, classes already used are subtracted, and checkpoint mastery re-sizes what is left.",
  D: "No past classes either. The only input is the requested topic, which pulls its unmet prerequisites in front of it as refreshers.",
}

const DEPTH_LABEL: Record<HistoryDepth, string> = {
  none: "No history",
  evidence: "Evidence only · never taught",
  taught: "Taught history",
}

function buildScenarioHistory(student: DemoStudent | null): ScenarioHistoryRow[] {
  return demoStudents.map((demo) => {
    const taughtClasses =
      demo.completedTopics.reduce(
        (total, topic) => total + topic.actualClasses,
        0
      ) + (demo.currentTopicClassesUsed ?? 0)
    const scored = demo.placementResults.length
    const objectives = demo.objectiveEvidence?.length ?? 0
    const attempts = demo.questionAttemptEvidence?.length ?? 0
    const requested = demo.parentRequestedTopicId
      ? topicById.get(demo.parentRequestedTopicId)
      : undefined
    const depth: HistoryDepth =
      taughtClasses > 0 ? "taught" : scored > 0 ? "evidence" : "none"

    return {
      scenario: demo.scenario,
      name: demo.name,
      case: SCENARIO_CASE[demo.scenario],
      depth,
      depthLabel:
        depth === "taught"
          ? `${taughtClasses} classes already taught`
          : DEPTH_LABEL[depth],
      facts: [
        {
          label: "Classes taught",
          value: taughtClasses > 0 ? `${taughtClasses} classes` : "None",
          empty: taughtClasses === 0,
        },
        {
          label: "Topics finished",
          value:
            demo.completedTopics.length > 0
              ? `${demo.completedTopics.length} excluded`
              : "None",
          empty: demo.completedTopics.length === 0,
        },
        {
          label: "Placement test",
          value:
            demo.placementStatus === "completed"
              ? `${scored} topics scored`
              : demo.placementStatus === "not-taken"
                ? "Not taken"
                : "Not applicable",
          empty: scored === 0,
        },
        {
          label: "Checkpoint mastery",
          value:
            objectives > 0 ? `${objectives} objectives, ${attempts} sets` : "None",
          empty: objectives === 0,
        },
        {
          label: "Parent request",
          value: requested ? requested.name : "None",
          empty: !requested,
        },
      ],
      consequence: SCENARIO_CONSEQUENCE[demo.scenario],
      current: student?.scenario === demo.scenario,
    }
  })
}

/* ------------------------------------------------------------------ *
 * What the tool is, and how a teacher drives it
 * ------------------------------------------------------------------ */

/**
 * The opener. Someone reading this tab may never have seen the builder before,
 * so it answers "what am I looking at" and "what do I do with it" before any
 * rule is quoted.
 */
const WHAT_IT_IS: string[] = [
  "A planner that turns a student's evidence and their remaining class package into a class-by-class teaching plan for the year.",
  "It decides three things: which topics are in, how many classes each one gets, and what order they are taught in.",
  "Every decision carries a written reason. There is no score the teacher cannot see and no rule the plan will not name.",
  "The teacher stays in charge — every number is editable, and the builder flags an override rather than blocking it.",
]

interface UseStep {
  step: string
  title: string
  body: string
  where: string
}

const HOW_TO_USE: UseStep[] = [
  {
    step: "01",
    title: "Pick the student",
    body: "Four demo students, each a different starting point. Open View profile to see exactly what evidence is on record before planning.",
    where: "Setup · Student",
  },
  {
    step: "02",
    title: "Read the evidence",
    body: "Placement scores, checkpoint objectives and question attempts, shown as they will be used. Nothing is inferred beyond this.",
    where: "Setup · Evidence",
  },
  {
    step: "03",
    title: "Choose the scope",
    body: "High-priority topics are locked in. Add or remove Medium and Low while the capacity bar shows what still fits.",
    where: "Setup · Topic scope",
  },
  {
    step: "04",
    title: "Generate and read the plan",
    body: "Classes, Topics, Structure and 2 weeks are four views of one plan. Every allocation carries the reasons that produced it.",
    where: "Plan board",
  },
  {
    step: "05",
    title: "Teach, then record the outcome",
    body: "After each class mark faster, on track or needs more time. The change is previewed first and written as a new version only on approval.",
    where: "Plan board · Record outcome",
  },
]

/* ------------------------------------------------------------------ *
 * Reference tables — the thresholds, in full
 * ------------------------------------------------------------------ */

/**
 * The numbers behind the rules, laid out so they can be checked rather than
 * taken on trust. Every figure here is quoted from `lib/learning-plan/engine.ts`;
 * when a threshold moves in the engine it has to move here too.
 */
interface RefRow {
  cells: ReactNode[]
  /** Marks the summed row at the foot of a table. */
  total?: boolean
}

interface RefTable {
  id: string
  title: string
  eyebrow: string
  Icon: LucideIcon
  intro: string
  columns: string[]
  rows: RefRow[]
  callout?: { title: string; text: string }
}

function pill(tone: string, label: string) {
  return <span className={`lpb-mt-pill ${tone}`}>{label}</span>
}

const REFERENCE_TABLES: RefTable[] = [
  {
    id: "bands",
    title: "Placement score bands",
    eyebrow: "Evidence · sizing a topic",
    Icon: Gauge,
    intro:
      "A placement score is not read as a mark out of 100. It is read as one of three bands, and the band decides what happens to the topic's class count and to the balance between easier and practice activities.",
    columns: ["Band", "Reading", "Classes", "Activity split"],
    rows: [
      {
        cells: [
          pill("low", "Below 40%"),
          "The topic has not landed",
          "Full allocation kept",
          "15 points toward practice",
        ],
      },
      {
        cells: [
          pill("mid", "40 – 74%"),
          "Partly there",
          "Ideal allocation, unchanged",
          "Curriculum default",
        ],
      },
      {
        cells: [
          pill("high", "75% and above"),
          "Largely secure",
          "Shortened by 30% of ideal, never under the minimum",
          "15 points toward easier consolidation",
        ],
      },
    ],
    callout: {
      title: "Why a band and not the number",
      text: "A 76% and an 84% are not different instructions — both mean the same thing: teach this in less time. Bands keep the plan stable against small differences in a single test, and keep the rule explainable to a parent.",
    },
  },
  {
    id: "signals",
    title: "Mastery and question-attempt signals",
    eyebrow: "Evidence · the second read",
    Icon: ClipboardCheck,
    intro:
      "Once a student has been taught, checkpoints and question sets replace the placement test as the evidence. These signals move a topic in both directions, and the extension is capped so one weak topic cannot eat the package.",
    columns: ["Signal", "Fires when", "Effect on the topic"],
    rows: [
      {
        cells: [
          pill("high", "Secure at Master"),
          "2 or more Master objectives secure, and 75% of the topic's objectives",
          "Shortened by 30% of ideal — never removed, never below the minimum",
        ],
      },
      {
        cells: [
          pill("low", "Not secure"),
          "2 objectives not secure, or half of them on a small topic",
          "Extended, capped at ideal + 2 classes, with more practice weight",
        ],
      },
      {
        cells: [
          pill("mid", "Starter strong, Master weak"),
          "Starter accuracy 75%+ while Master is under 50%",
          "Full allocation kept — the gap is transfer, not the routine",
        ],
      },
      {
        cells: [
          pill("mid", "Starter weak, Master strong"),
          "Starter under 50% while Master is 75%+",
          "Flagged: repair the core routine before trusting the reasoning",
        ],
      },
    ],
    callout: {
      title: "Two accuracies, not one",
      text: "Starter questions test whether the routine is reliable; Master questions test whether the student knows when to use it. Averaging them into a single score hides the only thing worth teaching next.",
    },
  },
  {
    id: "budget",
    title: "Where a full-year package goes",
    eyebrow: "Capacity · the 79 classes",
    Icon: PieChart,
    intro:
      "Structure is part of the package, not an extra on top of it. Checkpoints and RDP scale with the number of topics; the PTM reserve is held against the package but never placed in the sequence.",
    columns: ["Component", "Classes", "What it is for", "Can it be shed?"],
    rows: [
      {
        cells: [
          "Teaching",
          <b key="v">66</b>,
          "The topics themselves",
          pill("mid", "Last resort"),
        ],
      },
      {
        cells: [
          "Checkpoints",
          <b key="v">5</b>,
          "Produce the mastery evidence every later rule reads",
          pill("mid", "Only in pairs, min 2"),
        ],
      },
      {
        cells: [
          "RDP",
          <b key="v">5</b>,
          "Revision, doubts and practice",
          pill("low", "First to go"),
        ],
      },
      {
        cells: [
          "PTM reserve",
          <b key="v">3</b>,
          "Parent–teacher meetings, scheduled by ops on a fixed calendar",
          pill("high", "Never"),
        ],
      },
      {
        cells: ["Package total", <b key="v">79</b>, "", ""],
        total: true,
      },
    ],
    callout: {
      title: "Reserved is not unused",
      text: "The builder holds the PTM classes against the package but does not place them in the sequence, because ops owns that calendar. They are counted, not scheduled — and the fit ladder cannot take them.",
    },
  },
  {
    id: "classkinds",
    title: "The four kinds of class",
    eyebrow: "Anatomy · what is in the plan",
    Icon: SquareStack,
    intro:
      "Every row in the sequence is one class of one of four kinds. Only teaching classes carry objectives and activities; the other three are structure, and they are budgeted for from the same package.",
    columns: ["Kind", "Full year", "What happens in it", "Placed by"],
    rows: [
      {
        cells: [
          pill("high", "Teaching"),
          <b key="v">66</b>,
          "Objectives from one topic, plus its Starter and Master activities",
          "The builder, in sequence order",
        ],
      },
      {
        cells: [
          pill("mid", "Checkpoint"),
          <b key="v">5</b>,
          "Measures objectives and writes the mastery evidence later rules read",
          "The builder, spaced across the plan",
        ],
      },
      {
        cells: [
          pill("mid", "RDP"),
          <b key="v">5</b>,
          "Revision, doubts and practice on what has been taught so far",
          "The builder, paired with checkpoints",
        ],
      },
      {
        cells: [
          pill("low", "PTM"),
          <b key="v">3</b>,
          "Parent–teacher meeting",
          "Ops, on a fixed calendar — reserved but never placed",
        ],
      },
    ],
    callout: {
      title: "Inside one teaching class",
      text: "A class carries the topic's learning objectives and a set of activities split between easier consolidation and practice. Each activity is a real Starter or Master prompt from the workbook guidelines, and the count is capped by Rule G1 — 7 questions a week for Grade 5, about 3.5 per class — so a long topic cannot quietly become a workload spike.",
    },
  },
  {
    id: "outcomes",
    title: "What each class outcome does",
    eyebrow: "After teaching",
    Icon: RefreshCw,
    intro:
      "Grading a class is the only routine way the plan changes after it is approved. Each outcome moves the remaining allocation by at most one class, and both directions are bounded.",
    columns: ["Outcome", "Change", "Bounded by", "Then"],
    rows: [
      {
        cells: [
          pill("high", "Completed faster"),
          "−1 class",
          "The topic's minimum",
          "The class returns to the pool",
        ],
      },
      {
        cells: [
          pill("mid", "On track"),
          "No change",
          "—",
          "The approved allocation stands",
        ],
      },
      {
        cells: [
          pill("low", "Needs more time"),
          "+1 class",
          "Ideal + 2 classes",
          "Reinforcement is added to the topic",
        ],
      },
    ],
    callout: {
      title: "Nothing changes without approval",
      text: "The outcome produces a preview showing the current plan against the proposed one. A new plan version is written only when the teacher approves it, and a class that is no longer needed keeps its slot as skipped so later classes are not renumbered.",
    },
  },
]

/* ------------------------------------------------------------------ *
 * A worked example
 * ------------------------------------------------------------------ */

/**
 * One topic, sized end to end. The rules above are individually simple and
 * collectively hard to picture, so this walks a single real allocation from
 * curriculum ideal to final class count — including the floor that stops it.
 */
interface ExampleStep {
  label: string
  value: string
  body: string
  tone: "base" | "cut" | "floor"
}

const EXAMPLE_IDEAL = 5
const EXAMPLE_FINAL = 3

const EXAMPLE_STEPS: ExampleStep[] = [
  {
    label: "Curriculum ideal",
    value: "5 classes",
    body: "Data Analysis is a 5-class topic in the Grade 5 sequence, with a 3-class minimum.",
    tone: "base",
  },
  {
    label: "Placement 80%",
    value: "−2 classes",
    body: "80% is in the 75%+ band, so the topic is shortened by 30% of the ideal — 30% of 5, rounded up, is 2.",
    tone: "cut",
  },
  {
    label: "Result",
    value: "3 classes",
    body: "The split also shifts 15 points toward easier consolidation, because the student is being reminded rather than taught.",
    tone: "base",
  },
  {
    label: "Floor check",
    value: "At the minimum",
    body: "3 is the topic's minimum, so nothing — not capacity compression, not another strong result — can take it lower automatically.",
    tone: "floor",
  },
]

/* ------------------------------------------------------------------ *
 * Where AI is used, and where it is not
 * ------------------------------------------------------------------ */

/**
 * The question every reviewer asks about a planner like this: how much of it
 * did a model decide? The honest answer is "none of the structure", and it is
 * worth stating plainly rather than leaving to be inferred.
 */
const RULES_OWN: string[] = [
  "Which topics are in the plan, and which are dropped",
  "How many classes each topic gets, and the minimum it may never go under",
  "Teaching order, including pulling a prerequisite in front of its dependant",
  "How many checkpoints and RDP classes fit, and what the fit ladder sheds first",
  "What every class outcome does to the remaining allocation",
]

const AI_OWNS: string[] = [
  "The mentor-facing teaching guide for a class: goal, teaching points, practice and success criteria",
  "The parent-facing explanation of why the plan looks the way it does",
  "A suggested set of class adjustments, which the rules then clamp and the teacher approves",
]

interface AiTouchpoint {
  where: string
  what: string
  guard: string
}

const AI_TOUCHPOINTS: AiTouchpoint[] = [
  {
    where: "Teaching guide prose",
    what: "Structured generation against a fixed schema — one goal, teaching points, a practice line and success criteria per class.",
    guard:
      "Structure stays rule-based. If the provider is unavailable the plan falls back to local templates and says which was used.",
  },
  {
    where: "Plan strategy suggestion",
    what: "Proposes per-topic class adjustments and a short strategy when evidence is applied to the scope.",
    guard:
      "Every suggested count is clamped to the topic minimum before it is applied — Rule H1 holds against the model.",
  },
  {
    where: "Parent explanation",
    what: "Turns the plan's own reasons into a paragraph a parent can read.",
    guard: "Describes the plan; it cannot change it.",
  },
]

function AiSplit() {
  return (
    <section className="lpb-methodology-ai">
      <header>
        <Wand2 size={16} />
        <div>
          <strong>What the AI plans, and what it does not</strong>
          <p>
            The plan is produced by a deterministic engine: the same student and
            the same package always produce the same plan. AI writes the prose
            around that plan and proposes adjustments a teacher approves — it
            never decides a class count on its own.
          </p>
        </div>
      </header>

      <div className="lpb-methodology-ai-split">
        <article className="rules">
          <span className="lpb-detail-label">Rules decide</span>
          <ul>
            {RULES_OWN.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </article>
        <article className="ai">
          <span className="lpb-detail-label">AI writes</span>
          <ul>
            {AI_OWNS.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </article>
      </div>

      <div className="lpb-methodology-ai-table">
        <table>
          <thead>
            <tr>
              <th>Where</th>
              <th>What the model produces</th>
              <th>What holds it in place</th>
            </tr>
          </thead>
          <tbody>
            {AI_TOUCHPOINTS.map((touchpoint) => (
              <tr key={touchpoint.where}>
                <td>{touchpoint.where}</td>
                <td>{touchpoint.what}</td>
                <td>{touchpoint.guard}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="lpb-methodology-callout">
        <ShieldCheck size={14} />
        <p>
          <b>Prototype status:</b> the evidence in this build is the supplied
          dummy dataset, and AI output falls back to local templates whenever a
          provider is not configured — so the builder is fully demonstrable with
          no model connected at all.
        </p>
      </div>
    </section>
  )
}

function WorkedExample() {
  return (
    <section className="lpb-methodology-example">
      <header>
        <Wrench size={16} />
        <div>
          <strong>Worked example · one topic, end to end</strong>
          <p>
            Each rule is simple on its own. This is what they look like applied
            in order to a single topic for a student who scored 80% on it.
          </p>
        </div>
      </header>

      <div className="lpb-methodology-example-grid">
        {EXAMPLE_STEPS.map((step, index) => (
          <article key={step.label} className={`tone-${step.tone}`}>
            <span className="lpb-methodology-example-no">
              {String(index + 1).padStart(2, "0")}
            </span>
            <strong>{step.label}</strong>
            <b>{step.value}</b>
            <p>{step.body}</p>
          </article>
        ))}
      </div>

      {/* The same class-square visual the "Why this" panel uses, so the two
          read as one language. Filled squares survive; hatched ones were cut. */}
      <div className="lpb-methodology-squares">
        <span className="lpb-detail-label">Data Analysis</span>
        <div>
          {Array.from({ length: EXAMPLE_IDEAL }, (_, index) => (
            <i
              key={index}
              className={index < EXAMPLE_FINAL ? "kept" : "cut"}
              aria-hidden="true"
            />
          ))}
          <small>
            5 &rarr; <b>3</b> classes · floor 3
          </small>
        </div>
      </div>
    </section>
  )
}

interface MethodologySection {
  id: string
  title: string
  eyebrow: string
  Icon: LucideIcon
  body: ReactNode
}

/**
 * The rule cards. Live counts are read off the plan on screen when there is
 * one, so a rule can be shown in effect rather than only described; before a
 * plan is built the cards still read as a complete reference.
 */
function buildSections(
  plan: GeneratedPlan | null,
  student: DemoStudent | null
): MethodologySection[] {
  const checkpointCount =
    plan?.items.filter((item) => item.kind === "checkpoint").length ?? 0
  const rdpCount = plan?.items.filter((item) => item.kind === "rdp").length ?? 0
  const refresherCount =
    plan?.allocations.filter((allocation) => allocation.isCompressedRefresher)
      .length ?? 0
  const atMinimumCount =
    plan?.allocations.filter((allocation) => allocation.atMinimum).length ?? 0
  const completedCount = student?.completedTopics.length ?? 0

  return [
    {
      id: "priority",
      title: "Priority decides what is in the plan",
      eyebrow: "Scope rules",
      Icon: Layers,
      body: (
        <ul>
          <li>
            <b>High</b> topics are always included and cannot be unselected.
            Strong evidence can make a High topic shorter, never absent.
          </li>
          <li>
            <b>Medium</b> topics are added once every High topic fits.
          </li>
          <li>
            <b>Low</b> topics are added last, from whatever capacity is left.
          </li>
          <li>
            Evidence may recommend <b>skipping only Medium or Low</b> topics. A
            skip recommendation is a suggestion the teacher accepts, not an
            automatic removal.
          </li>
        </ul>
      ),
    },
    {
      id: "sequence",
      title: "Prerequisites beat priority in the order",
      eyebrow: "Sequencing · Rule H2",
      Icon: ListOrdered,
      body: (
        <ul>
          <li>
            Teaching order is High, then Medium, then Low — using curriculum
            sequence inside each band.
          </li>
          <li>
            A prerequisite is always pulled in front of the topic that needs it.{" "}
            <b>This overrides the priority order</b>: a Medium prerequisite runs
            ahead of the High topic depending on it.
          </li>
          <li>
            A prerequisite already scored <b>75% or more</b> sitting in front of
            a topic scored <b>below 40%</b> is kept but shortened to a{" "}
            <b>refresher</b> — half the ideal classes, rounded up — so the weak
            topic is reached sooner. A refresher is never skipped and never
            compressed further.
          </li>
          {refresherCount > 0 ? (
            <li className="lpb-methodology-live">
              In this plan: {refresherCount}{" "}
              {refresherCount === 1 ? "topic runs" : "topics run"} as a shortened
              refresher.
            </li>
          ) : null}
        </ul>
      ),
    },
    {
      id: "evidence",
      title: "Evidence resizes topics in both directions",
      eyebrow: "Placement & mastery",
      Icon: Gauge,
      body: (
        <ul>
          <li>
            Placement <b>below 40%</b> — the full allocation is kept and the
            split shifts toward practice.
          </li>
          <li>
            Placement <b>40–74%</b> — the ideal allocation is used unchanged.
          </li>
          <li>
            Placement <b>75% or above</b> — the topic is shortened (about 30% of
            the ideal, never below its minimum) and shifted toward easier
            consolidation.
          </li>
          <li>
            <b>Secure Master evidence shortens</b> a topic; two or more
            objectives not secure — or half the objectives on a small topic —{" "}
            <b>extends</b> it, capped at ideal + 2 classes so one weak topic
            cannot eat the package.
          </li>
          <li>
            Strong Starter accuracy with weak Master accuracy keeps the full
            allocation and flags transfer as the thing to teach. The reverse
            flags repairing the core routine first.
          </li>
        </ul>
      ),
    },
    {
      id: "history",
      title: "What the student already did is subtracted",
      eyebrow: "Student history",
      Icon: History,
      body: (
        <ul>
          <li>
            <b>Completed topics are excluded</b> from the scope entirely — they
            are listed as not scheduled with the reason, not silently dropped.
          </li>
          <li>
            The <b>in-progress topic is always included</b>, and the classes
            already taught are subtracted from the{" "}
            <b>evidence-adjusted total</b>, not from the ideal. That is what
            makes early mastery genuinely reduce the classes remaining.
          </li>
          <li>
            A <b>parent-requested starting topic</b> pulls its unmet
            prerequisite chain in as refreshers so the requested topic is
            reached sooner rather than being taught out of order.
          </li>
          <li>
            Grading a class never rewrites history. A class that is no longer
            needed keeps its slot as <b>skipped</b>, so classes after it are not
            renumbered.
          </li>
          {completedCount > 0 ? (
            <li className="lpb-methodology-live">
              This student: {completedCount} completed{" "}
              {completedCount === 1 ? "topic" : "topics"} excluded
              {student?.currentTopicClassesUsed
                ? `, ${student.currentTopicClassesUsed} ${
                    student.currentTopicClassesUsed === 1 ? "class" : "classes"
                  } already taught in the active topic`
                : ""}
              .
            </li>
          ) : null}
        </ul>
      ),
    },
    {
      id: "structure",
      title: "Structure is part of the package, not extra",
      eyebrow: "Checkpoints, RDP & PTM",
      Icon: ClipboardCheck,
      body: (
        <ul>
          <li>
            The full-year package is <b>66 teaching + 13 structural = 79</b>{" "}
            classes, where the 13 is 5 checkpoints + 5 RDP + 3 PTM.
          </li>
          <li>
            <b>Checkpoints</b> produce the mastery evidence every later rule
            reads, so they are protected the longest.
          </li>
          <li>
            <b>RDP</b> (revision, doubts &amp; practice) is the optional part of
            the structure and is shed first when capacity is tight.
          </li>
          <li>
            <b>PTMs are scheduled by ops</b> on a fixed calendar. The builder
            reserves their classes against the package but never places them in
            the sequence, and the fit ladder cannot shed them.
          </li>
          {plan ? (
            <li className="lpb-methodology-live">
              In this plan: {checkpointCount}{" "}
              {checkpointCount === 1 ? "checkpoint" : "checkpoints"}, {rdpCount}{" "}
              RDP, {plan.capacity.opsReserve} reserved for PTM.
            </li>
          ) : null}
        </ul>
      ),
    },
    {
      id: "fit",
      title: "When the plan does not fit",
      eyebrow: "Fit ladder · Rules B2, F3, H1",
      Icon: Repeat,
      body: (
        <>
          <ol className="lpb-methodology-ladder">
            <li>
              <b>Shed RDP</b> down to one class.
            </li>
            <li>
              <b>Shed checkpoint + RDP pairs</b>, keeping at least two
              checkpoints (one on a single-topic plan). The PTM reserve is left
              alone.
            </li>
            <li>
              <b>Compress toward minimum classes</b> — lowest priority first,
              latest sequence first. Refreshers and teacher-edited topics are
              never touched.
            </li>
            <li>
              <b>Drop topics</b> — Low first, then Medium (latest sequence
              first). A topic another selected topic depends on is never dropped.
            </li>
            <li>
              <b>Warn</b> — if High topics still do not fit, the plan raises a
              warning for a manual decision instead of dropping anything
              silently.
            </li>
          </ol>
          {atMinimumCount > 0 ? (
            <p className="lpb-methodology-live">
              In this plan: {atMinimumCount}{" "}
              {atMinimumCount === 1 ? "topic sits" : "topics sit"} at the class
              minimum after compression.
            </p>
          ) : null}
        </>
      ),
    },
    {
      id: "floors",
      title: "Floors the builder will not cross on its own",
      eyebrow: "Rule H1",
      Icon: ShieldCheck,
      body: (
        <ul>
          <li>
            Every topic carries a <b>minimum</b> — the fewest classes in which it
            can still be taught soundly. No automatic rule goes below it: not a
            placement reduction, not capacity compression, not a post-class
            update.
          </li>
          <li>
            A <b>teacher override is the only way below the minimum</b>, and the
            plan flags the topic when it happens.
          </li>
          <li>
            With <b>10 or more spare classes</b>, only the required classes are
            planned and the surplus is reserved as “Revision / School Help”
            rather than padded out.
          </li>
          <li>
            An over-capacity plan stays fully editable — it shows a persistent
            warning instead of blocking the teacher.
          </li>
        </ul>
      ),
    },
    {
      id: "updates",
      title: "Every class feeds the next version",
      eyebrow: "After teaching",
      Icon: CalendarDays,
      body: (
        <ul>
          <li>
            After a class the teacher records{" "}
            <b>completed faster · on track · needed more time</b>.
          </li>
          <li>
            <b>Faster</b> returns one class to the pool, respecting the minimum.{" "}
            <b>Needed more time</b> adds one, capped at ideal + 2.{" "}
            <b>On track</b> leaves the allocation alone.
          </li>
          <li>
            The change is shown as a preview first; a{" "}
            <b>new plan version is written only after the teacher approves</b>.
          </li>
          <li>
            Checkpoint results feed back in as mastery evidence, so the resizing
            rules above run again on the classes still ahead.
          </li>
        </ul>
      ),
    },
  ]
}

interface MethodologyViewProps {
  plan?: GeneratedPlan | null
  student?: DemoStudent | null
}

/** The methodology itself, rendered as the plan board's Methodology tab. */
export function MethodologyView({
  plan = null,
  student = null,
}: MethodologyViewProps) {
  const sections = useMemo(() => buildSections(plan, student), [plan, student])
  const scenarioHistory = useMemo(() => buildScenarioHistory(student), [student])

  return (
    <div className="lpb-methodology">
      <header className="lpb-methodology-intro">
        <span className="lpb-detail-label">Methodology</span>
        <h3>How this plan is decided</h3>
        <p>
          The builder does not pick topics by feel. It reads what the student has
          already proven, fits the required teaching into the classes the package
          actually has left, and keeps a written reason on every decision. This
          page is the whole method: what the tool does, how a teacher drives it,
          every threshold it uses, and a worked example of the lot applied to one
          topic.
        </p>
      </header>

      {/*
        What the tool is and how it is driven, before any rule is quoted — this
        tab is read by people who have not used the builder.
      */}
      <section className="lpb-methodology-about">
        <article className="lpb-methodology-what">
          <header>
            <Compass size={16} />
            <strong>What this tool is</strong>
          </header>
          <ul>
            {WHAT_IT_IS.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </article>
        <article className="lpb-methodology-how">
          <header>
            <ListOrdered size={16} />
            <strong>How to use it</strong>
          </header>
          <ol>
            {HOW_TO_USE.map((step) => (
              <li key={step.step}>
                <span className="lpb-methodology-how-no">{step.step}</span>
                <div>
                  <strong>{step.title}</strong>
                  <p>{step.body}</p>
                  <span className="lpb-methodology-how-where">{step.where}</span>
                </div>
              </li>
            ))}
          </ol>
        </article>
      </section>

      <AiSplit />

      <section className="lpb-methodology-pipeline">
        {PIPELINE.map((step, index) => (
          <article key={step.title}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div>
              <strong>{step.title}</strong>
              <p>{step.body}</p>
            </div>
            {index < PIPELINE.length - 1 ? (
              <ArrowRight size={13} className="lpb-methodology-arrow" />
            ) : null}
          </article>
        ))}
      </section>

      <section className="lpb-methodology-history">
        <header>
          <History size={16} />
          <div>
            <strong>What history each scenario starts with</strong>
            <p>
              The rules are the same for all four. What differs is how much the
              builder already knows before it starts — from nothing at all, to
              thirteen classes already taught.
            </p>
          </div>
        </header>
        <div className="lpb-methodology-history-grid">
          {scenarioHistory.map((row) => (
            <article
              key={row.scenario}
              className={`lpb-scenario-history lpb-scenario-${row.scenario.toLowerCase()} depth-${row.depth}${
                row.current ? " current" : ""
              }`}
            >
              {row.current ? (
                <span className="lpb-scenario-history-now">On screen</span>
              ) : null}
              <header>
                <span className="lpb-scenario-history-badge">
                  {row.scenario}
                </span>
                <div>
                  <strong>{row.name}</strong>
                  <span>{row.case}</span>
                </div>
              </header>
              <p className="lpb-scenario-history-depth">{row.depthLabel}</p>
              <dl>
                {row.facts.map((fact) => (
                  <div
                    key={fact.label}
                    className={fact.empty ? "is-empty" : undefined}
                  >
                    <dt>{fact.label}</dt>
                    <dd>{fact.value}</dd>
                  </div>
                ))}
              </dl>
              <p className="lpb-scenario-history-note">{row.consequence}</p>
            </article>
          ))}
        </div>
      </section>

      {/* The thresholds in full, so a number can be checked rather than trusted. */}
      <section className="lpb-methodology-tables">
        {REFERENCE_TABLES.map((table) => (
          <article key={table.id} className="lpb-methodology-table-card">
            <header>
              <table.Icon size={18} />
              <div>
                <strong>{table.title}</strong>
                <span>{table.eyebrow}</span>
              </div>
            </header>
            <p className="lpb-methodology-table-intro">{table.intro}</p>
            <div className="lpb-methodology-table-wrap">
              <table>
                <thead>
                  <tr>
                    {table.columns.map((column) => (
                      <th key={column}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, rowIndex) => (
                    <tr key={rowIndex} className={row.total ? "total" : undefined}>
                      {row.cells.map((cell, cellIndex) => (
                        <td key={cellIndex}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {table.callout ? (
              <div className="lpb-methodology-callout">
                <Lightbulb size={14} />
                <p>
                  <b>{table.callout.title}:</b> {table.callout.text}
                </p>
              </div>
            ) : null}
          </article>
        ))}
      </section>

      <WorkedExample />

      <div className="lpb-methodology-grid">
        {sections.map((section) => (
          <article key={section.id} className="lpb-methodology-card">
            <header>
              <section.Icon size={18} />
              <div>
                <strong>{section.title}</strong>
                <span>{section.eyebrow}</span>
              </div>
            </header>
            {section.body}
          </article>
        ))}
      </div>

      <footer className="lpb-methodology-foot">
        <Sparkles size={14} />
        <p>
          Every allocation on the Topics tab carries the reasons that produced
          it, and every unscheduled topic carries the reason it was left out. If
          a number here does not match the plan, the plan’s own reasons are the
          record.
        </p>
      </footer>
    </div>
  )
}

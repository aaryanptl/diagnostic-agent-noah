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
import {
  ArrowRight,
  CalendarDays,
  ClipboardCheck,
  Gauge,
  History,
  Layers,
  ListOrdered,
  Repeat,
  ShieldCheck,
  Sparkles,
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

  return (
    <div className="lpb-methodology">
      <header className="lpb-methodology-intro">
        <span className="lpb-detail-label">Methodology</span>
        <h3>How this plan is decided</h3>
        <p>
          The builder does not pick topics by feel. It reads what the student has
          already proven, fits the required teaching into the classes the package
          actually has left, and keeps a written reason on every decision. The
          rules below are the ones running behind the screen you are on.
        </p>
      </header>

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

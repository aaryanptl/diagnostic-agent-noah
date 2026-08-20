"use client"

/**
 * Student profile — the record the builder holds on one student, before any
 * planning happens.
 *
 * Opened from a demo card on Step 1 and shown as a right-hand sidebar so it can
 * be pulled up mid-presentation without leaving the picker.
 *
 * The one rule this panel keeps: **it never invents a number.** Every figure is
 * read off the `DemoStudent` record — placement scores, completed topics,
 * checkpoint objectives, question attempts. A student with no history shows a
 * stated empty record rather than zeroes dressed up as data, because "there is
 * nothing to read" is exactly the fact that drives their plan.
 */

import type {
  CurriculumTopic,
  DemoStudent,
  LearningObjective,
} from "@/lib/learning-plan/types"
import { topicById } from "./data"
import {
  BookOpenCheck,
  CircleSlash,
  ClipboardList,
  GraduationCap,
  Target,
  UserRound,
  X,
} from "lucide-react"
import { useEffect, useMemo } from "react"

/** Placement bands, quoted from the engine's evidence rules. */
const BAND_FLOOR = 40
const BAND_STRONG = 75

type PlacementBand = "low" | "mid" | "high"

function bandFor(score: number): PlacementBand {
  if (score >= BAND_STRONG) return "high"
  if (score < BAND_FLOOR) return "low"
  return "mid"
}

const BAND_COPY: Record<PlacementBand, { label: string; effect: string }> = {
  low: { label: "Below 40%", effect: "Full allocation kept, shifted to practice" },
  mid: { label: "40–74%", effect: "Ideal allocation used unchanged" },
  high: { label: "75%+", effect: "Topic shortened toward its minimum" },
}

const PLACEMENT_STATUS_COPY: Record<
  DemoStudent["placementStatus"],
  { label: string; blank: string }
> = {
  completed: { label: "Completed", blank: "" },
  "not-taken": {
    label: "Not taken",
    blank:
      "No assessment test on record. There is no score to read, so no topic is shortened on placement — every topic starts at its ideal length.",
  },
  "not-applicable": {
    label: "Not applicable",
    blank:
      "A returning student does not re-sit the placement test. Checkpoint mastery and question attempts are read instead — see below.",
  },
}

/** One row of the placement table. */
interface PlacementRow {
  topicId: number
  name: string
  score: number
  band: PlacementBand
}

/** Everything the panel renders, derived once from the student record. */
function buildProfile(student: DemoStudent, topics: CurriculumTopic[]) {
  const objectiveById = new Map<string, LearningObjective & { topicName: string }>()
  for (const topic of topics) {
    for (const objective of topic.learningObjectives) {
      objectiveById.set(objective.id, { ...objective, topicName: topic.name })
    }
  }

  const placementRows: PlacementRow[] = student.placementResults.map((result) => ({
    topicId: result.topicId,
    name: topicById.get(result.topicId)?.name ?? `Topic ${result.topicId}`,
    score: result.score,
    band: bandFor(result.score),
  }))

  /**
   * The test's own headline number. Averaged across the topics actually sat —
   * the untested-topic fallback is a separate figure and is labelled as one.
   */
  const testScore = placementRows.length
    ? Math.round(
        placementRows.reduce((total, row) => total + row.score, 0) /
          placementRows.length
      )
    : null

  const completed = student.completedTopics.map((entry) => ({
    ...entry,
    name: topicById.get(entry.topicId)?.name ?? `Topic ${entry.topicId}`,
  }))
  const classesTaught =
    completed.reduce((total, entry) => total + entry.actualClasses, 0) +
    (student.currentTopicClassesUsed ?? 0)

  const currentTopic = student.currentTopicId
    ? topicById.get(student.currentTopicId)
    : undefined
  const requestedTopic = student.parentRequestedTopicId
    ? topicById.get(student.parentRequestedTopicId)
    : undefined

  const objectives = student.objectiveEvidence.map((entry) => ({
    ...entry,
    text: objectiveById.get(entry.learningObjectiveId)?.text ?? entry.learningObjectiveId,
    topicName: objectiveById.get(entry.learningObjectiveId)?.topicName ?? "",
  }))

  const attempts = (student.questionAttemptEvidence ?? []).map((entry) => ({
    ...entry,
    text: objectiveById.get(entry.learningObjectiveId)?.text ?? entry.learningObjectiveId,
    topicName: topicById.get(entry.topicId)?.name ?? `Topic ${entry.topicId}`,
  }))

  return {
    placementRows,
    testScore,
    completed,
    classesTaught,
    currentTopic,
    requestedTopic,
    objectives,
    attempts,
    /**
     * A parent request is an instruction, not history — D has one and still has
     * an empty record, which is the whole point of that scenario.
     */
    hasHistory:
      placementRows.length > 0 ||
      completed.length > 0 ||
      objectives.length > 0 ||
      attempts.length > 0 ||
      Boolean(student.currentTopicId),
  }
}

/** A score on the 0–100 scale with the two decision bands marked. */
function ScoreMeter({ score, band }: { score: number; band: PlacementBand }) {
  return (
    <div className="lpb-sp-meter" aria-hidden="true">
      <span className={`fill ${band}`} style={{ width: `${score}%` }} />
      <i style={{ left: `${BAND_FLOOR}%` }} />
      <i style={{ left: `${BAND_STRONG}%` }} />
    </div>
  )
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="lpb-sp-empty">
      <CircleSlash size={14} />
      <span>{children}</span>
    </p>
  )
}

interface StudentProfilePanelProps {
  student: DemoStudent
  topics: CurriculumTopic[]
  scenarioTitle: string
  onClose: () => void
}

export function StudentProfilePanel({
  student,
  topics,
  scenarioTitle,
  onClose,
}: StudentProfilePanelProps) {
  const profile = useMemo(() => buildProfile(student, topics), [student, topics])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const perWeek = student.classesPerWeek ?? 2

  return (
    <div
      className="lpb-sp-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <aside
        className={`lpb-sp-panel lpb-scenario-${student.scenario.toLowerCase()}`}
        role="dialog"
        aria-modal="true"
        aria-label={`${student.name} — student profile`}
      >
        <header className="lpb-sp-head">
          <div className="lpb-sp-identity">
            <span className="lpb-sp-avatar">{student.initials}</span>
            <div>
              <span className="lpb-sp-kicker">Student profile</span>
              <h2>{student.name}</h2>
              <p className="lpb-sp-chips">
                <span>Grade {student.grade}</span>
                <span>
                  {student.region === "US" ? "US curriculum" : student.region}
                </span>
                <span className="accent">Demo {student.scenario}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            className="lpb-icon-button"
            onClick={onClose}
            aria-label="Close student profile"
          >
            <X size={18} />
          </button>
        </header>

        <div className="lpb-sp-body">
          <p className="lpb-sp-case">{scenarioTitle}</p>

          {/*
            Enrolment, not performance: these four are true of the package the
            student is on and are known before any evidence exists.
          */}
          <dl className="lpb-sp-stats">
            <div>
              <dt>Package</dt>
              <dd>{student.packageLabel ?? `${student.classesRemaining} classes`}</dd>
            </div>
            <div>
              <dt>Pace</dt>
              <dd>{perWeek} classes / week</dd>
            </div>
            <div>
              <dt>Classes taught</dt>
              <dd className={profile.classesTaught === 0 ? "blank" : undefined}>
                {profile.classesTaught > 0 ? profile.classesTaught : "None"}
              </dd>
            </div>
            <div>
              <dt>Topics finished</dt>
              <dd className={profile.completed.length === 0 ? "blank" : undefined}>
                {profile.completed.length > 0 ? profile.completed.length : "None"}
              </dd>
            </div>
          </dl>

          {/* ── Assessment test ─────────────────────────────────────────── */}
          <section className="lpb-sp-section">
            <div className="lpb-sp-section-head">
              <Target size={16} />
              <div>
                <h3>Assessment test</h3>
                <span>{PLACEMENT_STATUS_COPY[student.placementStatus].label}</span>
              </div>
              {profile.testScore !== null ? (
                <span className="lpb-sp-score">
                  <b>{profile.testScore}%</b>
                  <small>test score</small>
                </span>
              ) : null}
            </div>

            {profile.placementRows.length > 0 ? (
              <>
                <ul className="lpb-sp-scores">
                  {profile.placementRows.map((row) => (
                    <li key={row.topicId}>
                      <div>
                        <strong>{row.name}</strong>
                        <b className={row.band}>{row.score}%</b>
                      </div>
                      <ScoreMeter score={row.score} band={row.band} />
                      <small>
                        {BAND_COPY[row.band].label} · {BAND_COPY[row.band].effect}
                      </small>
                    </li>
                  ))}
                </ul>
                {student.defaultPlacementScore !== undefined ? (
                  <p className="lpb-sp-foot">
                    Topics not on the test fall back to the{" "}
                    <b>{student.defaultPlacementScore}% student default</b>.
                  </p>
                ) : null}
              </>
            ) : (
              <EmptyNote>
                {PLACEMENT_STATUS_COPY[student.placementStatus].blank}
              </EmptyNote>
            )}
          </section>

          {/* ── Teaching history ────────────────────────────────────────── */}
          <section className="lpb-sp-section">
            <div className="lpb-sp-section-head">
              <BookOpenCheck size={16} />
              <div>
                <h3>Teaching history</h3>
                <span>
                  {student.previousPlanLabel ?? "Classes taught before this plan"}
                </span>
              </div>
            </div>

            {profile.completed.length > 0 || profile.currentTopic ? (
              <ul className="lpb-sp-history">
                {profile.completed.map((entry) => (
                  <li key={entry.topicId}>
                    <span className="dot done" />
                    <div>
                      <strong>{entry.name}</strong>
                      <small>
                        {entry.actualClasses} of {entry.plannedClasses} planned
                        classes used · excluded from the new scope
                      </small>
                    </div>
                    <span className="lpb-sp-tag done">Finished</span>
                  </li>
                ))}
                {profile.currentTopic ? (
                  <li>
                    <span className="dot active" />
                    <div>
                      <strong>{profile.currentTopic.name}</strong>
                      <small>
                        {student.currentTopicClassesUsed ?? 0} classes already
                        taught · subtracted from what remains
                      </small>
                    </div>
                    <span className="lpb-sp-tag active">In progress</span>
                  </li>
                ) : null}
              </ul>
            ) : (
              <EmptyNote>
                No classes have been taught. Nothing is excluded from the scope and
                nothing is subtracted from a topic&rsquo;s allocation.
              </EmptyNote>
            )}
          </section>

          {/* ── Checkpoint & question evidence ──────────────────────────── */}
          <section className="lpb-sp-section">
            <div className="lpb-sp-section-head">
              <ClipboardList size={16} />
              <div>
                <h3>Checkpoint evidence</h3>
                <span>Objectives measured, and how the questions went</span>
              </div>
            </div>

            {profile.objectives.length > 0 ? (
              <ul className="lpb-sp-objectives">
                {profile.objectives.map((entry) => (
                  <li key={`${entry.learningObjectiveId}-${entry.level}`}>
                    <div>
                      <strong>{entry.text}</strong>
                      <span className={`lpb-sp-pill ${entry.result}`}>
                        {entry.result === "secure" ? "Secure" : "Not secure"}
                      </span>
                    </div>
                    <small>
                      {entry.level === "starter" ? "Starter" : "Master"} level ·{" "}
                      {entry.note}
                    </small>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyNote>
                No objective has been measured. There is no mastery evidence to
                stretch or shorten a topic with.
              </EmptyNote>
            )}

            {profile.attempts.length > 0 ? (
              <div className="lpb-sp-attempts">
                <span className="lpb-detail-label">Question attempts</span>
                <ul>
                  {profile.attempts.map((entry, index) => (
                    <li key={`${entry.learningObjectiveId}-${entry.level}-${index}`}>
                      <span className={`lpb-sp-ratio ${entry.correct / entry.attempted >= 0.6 ? "ok" : "weak"}`}>
                        {entry.correct}/{entry.attempted}
                      </span>
                      <div>
                        <strong>{entry.text}</strong>
                        <small>
                          {entry.topicName} ·{" "}
                          {entry.level === "starter" ? "Starter" : "Master"}
                        </small>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          {/* ── Parent request ──────────────────────────────────────────── */}
          {profile.requestedTopic ? (
            <section className="lpb-sp-section">
              <div className="lpb-sp-section-head">
                <GraduationCap size={16} />
                <div>
                  <h3>Parent request</h3>
                  <span>A starting topic asked for by the parent</span>
                </div>
              </div>
              <div className="lpb-sp-request">
                <strong>{profile.requestedTopic.name}</strong>
                <small>
                  {profile.requestedTopic.prerequisiteIds.length > 0
                    ? `${profile.requestedTopic.prerequisiteIds.length} prerequisite ${
                        profile.requestedTopic.prerequisiteIds.length === 1
                          ? "topic runs"
                          : "topics run"
                      } in front of it as shortened refreshers.`
                    : "No prerequisites — it can be taught first."}
                </small>
              </div>
            </section>
          ) : null}

          {!profile.hasHistory ? (
            <div className="lpb-sp-blank">
              <UserRound size={18} />
              <div>
                <strong>Nothing on record yet</strong>
                <p>
                  No test, no classes taught, no objective measured. The builder
                  reads no evidence for this student, so every topic starts at its
                  ideal length and capacity alone decides the plan.
                </p>
              </div>
            </div>
          ) : null}
        </div>

        <footer className="lpb-sp-foot-bar">
          Everything above is read from this student&rsquo;s record. Nothing is
          inferred or estimated.
        </footer>
      </aside>
    </div>
  )
}

"use client"

/**
 * The "Mastery" tab on the plan board.
 *
 * Written for someone who has seen neither system before. It answers four
 * questions in order, and never uses a term before defining it:
 *
 *   1. What are the two systems and why are there two?
 *   2. What does the platform already know about this student?
 *   3. What happens inside one class, decision by decision?
 *   4. What does that send back to the plan?
 *
 * Every number on this screen is derived from the same demo data the rest of
 * the builder runs on. Nothing is hard-coded per student.
 */

import { useMemo, useState } from "react"
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  GraduationCap,
  Layers,
  Play,
  RotateCcw,
  Sparkles,
  Target,
} from "lucide-react"

import {
  CONFIDENCE_LOCK,
  MASTERY_ACTIVITIES,
  MASTERY_RULES,
  NEEDS_HELP_SCORE,
  READY_SCORE,
  buildHandback,
  buildScorecard,
  placementSeed,
  routeNext,
  simulateTopic,
  type MasteryLoState,
  type MasteryRuleId,
  type MasteryScorecard,
} from "@/lib/learning-plan/mastery"
import type {
  CurriculumTopic,
  DemoStudent,
  GeneratedPlan,
} from "@/lib/learning-plan/types"

const STATE_COPY: Record<MasteryLoState, { label: string; plain: string }> = {
  untested: { label: "Untested", plain: "No evidence yet on this skill." },
  working: { label: "Working", plain: "In progress. Not weak, not ready." },
  ready: { label: "Ready", plain: "Looks masterable — worth testing properly." },
  needs_help: { label: "Needs help", plain: "Below the line. Teach it, don't test it." },
  blocked: { label: "Blocked", plain: "Failed its check twice. A human is needed." },
  signed_off: { label: "Certified", plain: "Finished. It will not come back." },
}

const GLOSSARY: { term: string; plain: string }[] = [
  {
    term: "Learning objective",
    plain:
      "One specific skill inside a topic — \"find the lowest common multiple\", not \"be good at fractions\". The smallest thing this system tracks.",
  },
  {
    term: "Scorecard",
    plain:
      "One row per objective: a score, how much we trust it, and what state it is in. The only thing that survives between sessions.",
  },
  {
    term: "Confidence",
    plain:
      `A separate 0–1 number answering "how much do we trust that score?" A score of 82 from three questions and a score of 82 from twenty are not the same claim. Below ${CONFIDENCE_LOCK} the platform shows no score at all rather than a guess.`,
  },
  {
    term: "Router",
    plain:
      "The piece that decides what the student gets next. It reads the scorecard, runs down a fixed list of rules, and picks one activity. Same scorecard in, same answer out, every time.",
  },
  {
    term: "Round",
    plain:
      "One decision. A planned class covers roughly three of them — the mentor session itself, plus the homework and practice done between sessions.",
  },
  {
    term: "Certified",
    plain:
      "An objective is finished and stops being re-tested. Exactly one activity is allowed to do this, no matter how high a score gets elsewhere.",
  },
]

function stateClass(state: MasteryLoState) {
  return `lpb-ml-state ${state.replace("_", "-")}`
}

function ScoreBar({ value, muted }: { value: number | null; muted?: boolean }) {
  const width = value ?? 0
  const tone = value === null ? "unknown" : value >= READY_SCORE ? "strong" : value < NEEDS_HELP_SCORE ? "support" : "steady"
  return (
    <div className={`lpb-ml-bar ${muted ? "muted" : ""}`}>
      <span className={`fill ${tone}`} style={{ width: `${width}%` }} />
      <i className="mark help" style={{ left: `${NEEDS_HELP_SCORE}%` }} />
      <i className="mark ready" style={{ left: `${READY_SCORE}%` }} />
    </div>
  )
}

export function MasteryView({
  plan,
  student,
  topics,
}: {
  plan: GeneratedPlan
  student: DemoStudent
  topics: CurriculumTopic[]
}) {
  const topicById = useMemo(
    () => new Map(topics.map((topic) => [topic.id, topic])),
    [topics]
  )

  // Focus topic: the student's in-progress topic if the plan still carries it,
  // otherwise the first topic the plan will teach.
  const defaultAllocation =
    plan.allocations.find((allocation) => allocation.topicId === student.currentTopicId) ??
    plan.allocations[0]

  const [focusTopicId, setFocusTopicId] = useState<number | undefined>(
    defaultAllocation?.topicId
  )
  const [step, setStep] = useState(0)
  const [glossaryOpen, setGlossaryOpen] = useState(false)
  const [ledgerOpen, setLedgerOpen] = useState(false)

  const allocation =
    plan.allocations.find((item) => item.topicId === focusTopicId) ?? defaultAllocation
  const topic = allocation ? topicById.get(allocation.topicId) : undefined

  const startCard: MasteryScorecard | null = useMemo(
    () => (topic ? buildScorecard(student, topic) : null),
    [student, topic]
  )

  const rounds = useMemo(
    () => (startCard ? simulateTopic(startCard) : []),
    [startCard]
  )

  const handback = useMemo(
    () => (rounds.length && allocation ? buildHandback(rounds, allocation.classes) : null),
    [rounds, allocation]
  )
  const handbackTrackLength = handback
    ? Math.max(handback.classesAllocated, handback.classesUsed)
    : 0

  if (!allocation || !topic || !startCard) {
    return (
      <div className="lpb-ml-empty">
        <CircleAlert size={22} />
        <p>This plan has no teaching topics, so there is nothing for the loop to run on.</p>
      </div>
    )
  }

  const totalSteps = rounds.length
  const current = step === 0 ? null : rounds[step - 1]
  const card = current ? current.scorecard : startCard
  const decision = current ? routeNext(card) : routeNext(startCard)
  const firingRule: MasteryRuleId = current ? current.decision.rule : decision.rule

  const placement = student.placementResults.find(
    (result) => result.topicId === topic.id
  )
  const seedInfo = placementSeed(placement?.score ?? student.defaultPlacementScore)

  const attemptCount = (student.questionAttemptEvidence ?? []).filter(
    (attempt) => attempt.topicId === topic.id
  ).length
  const labelCount = student.objectiveEvidence.filter((evidence) =>
    topic.learningObjectives.some((objective) => objective.id === evidence.learningObjectiveId)
  ).length

  return (
    <div className="lpb-ml">
      {/* ---------------------------------------------------------------- *
       * 1. Orientation. Two systems, one sentence each, then the join.
       * ---------------------------------------------------------------- */}
      <section className="lpb-ml-intro">
        <span className="lpb-kicker">Start here</span>
        <h2>Two systems, one loop.</h2>
        <p className="lpb-ml-lede">
          Everything on the other tabs is <b>the plan</b>: which topics {student.name.split(" ")[0]} is
          taught, in what order, and how many classes each one gets. This tab is{" "}
          <b>the loop</b>: what actually happens inside one of those classes, decided fresh
          every session from what the student has proved so far. They are not two products —
          the plan sets the budget, the loop spends it, and what the loop learns is what the
          plan re-plans on.
        </p>

        <div className="lpb-ml-triptych">
          <article>
            <span className="lpb-ml-tri-icon plan">
              <Layers size={18} />
            </span>
            <h3>The plan decides the shape</h3>
            <p>
              Reads the package, the curriculum and the evidence. Outputs a class-by-class
              sequence. Slow-moving — it changes when a topic finishes, not when a question
              is answered.
            </p>
            <div className="lpb-ml-tri-fact">
              <b>{allocation.classes}</b> classes booked for {topic.name}
            </div>
          </article>
          <article className="lpb-ml-tri-arrow" aria-hidden="true">
            <ArrowRight size={18} />
          </article>
          <article>
            <span className="lpb-ml-tri-icon loop">
              <RotateCcw size={18} />
            </span>
            <h3>The loop decides the content</h3>
            <p>
              Reads one scorecard, runs a fixed ladder of eight rules, and hands back exactly
              one activity — a test, a practice set or a class. Fast-moving: once per session.
            </p>
            <div className="lpb-ml-tri-fact">
              <b>{topic.learningObjectives.length}</b> objectives to certify
            </div>
          </article>
          <article className="lpb-ml-tri-arrow" aria-hidden="true">
            <ArrowRight size={18} />
          </article>
          <article>
            <span className="lpb-ml-tri-icon join">
              <Sparkles size={18} />
            </span>
            <h3>The handshake closes it</h3>
            <p>
              When every objective is certified the topic closes and the classes it did not
              need go back into the package. The plan resizes itself on evidence rather than
              on a teacher&rsquo;s estimate.
            </p>
            <div className="lpb-ml-tri-fact">
              {handback && handback.classesUsed > handback.classesAllocated ? (
                <>
                  <b>{handback.classesUsed - handback.classesAllocated}</b> more classes
                  asked for in this run
                </>
              ) : (
                <>
                  <b>{handback?.classesFreed ?? 0}</b> classes handed back in this run
                </>
              )}
            </div>
          </article>
        </div>

        <button
          type="button"
          className="lpb-ml-disclosure"
          onClick={() => setGlossaryOpen((open) => !open)}
          aria-expanded={glossaryOpen}
        >
          {glossaryOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          Six words this tab uses, in one line each
        </button>
        {glossaryOpen ? (
          <dl className="lpb-ml-glossary">
            {GLOSSARY.map((entry) => (
              <div key={entry.term}>
                <dt>{entry.term}</dt>
                <dd>{entry.plain}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </section>

      {/* ---------------------------------------------------------------- *
       * 2. The map. Where every test we have built actually sits.
       * ---------------------------------------------------------------- */}
      <section className="lpb-ml-block">
        <header className="lpb-ml-block-head">
          <div>
            <span className="lpb-section-no">01</span>
            <h3>Where every test we have built actually sits</h3>
            <p>
              The prototype has six assessment flows. None of them decided anything on its
              own. Placed on the loop, each one has exactly one job — and the arrow out of the
              bottom is the one that was missing.
            </p>
          </div>
        </header>

        <figure className="lpb-ml-map">
          <svg viewBox="0 0 980 400" role="img" aria-label="The mastery loop, from placement through to classes handed back to the plan">
            <defs>
              <marker id="ml-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" className="ml-arrowhead" />
              </marker>
            </defs>

            {/* Row 1 — the sequencer, outside the loop */}
            <g className="ml-node outside">
              <rect x="20" y="26" width="180" height="62" rx="10" />
              <text x="110" y="52" className="ml-lbl">Placement / Grade test</text>
              <text x="110" y="70" className="ml-sub">picks the topic · seeds the row</text>
            </g>
            <path d="M200 57 H262" className="ml-flow" markerEnd="url(#ml-arrow)" />

            <g className="ml-node plan">
              <rect x="262" y="26" width="196" height="62" rx="10" />
              <text x="360" y="52" className="ml-lbl">Learning Plan Builder</text>
              <text x="360" y="70" className="ml-sub">{allocation.classes} classes → {topic.name}</text>
            </g>
            <path d="M458 57 H520" className="ml-flow" markerEnd="url(#ml-arrow)" />

            <g className="ml-node scorecard">
              <rect x="520" y="26" width="176" height="62" rx="10" />
              <text x="608" y="52" className="ml-lbl">The scorecard</text>
              <text x="608" y="70" className="ml-sub">{topic.learningObjectives.length} objective rows</text>
            </g>
            <path d="M696 57 H760" className="ml-flow" markerEnd="url(#ml-arrow)" />

            <g className="ml-node router">
              <rect x="760" y="26" width="200" height="62" rx="10" />
              <text x="860" y="52" className="ml-lbl">The router</text>
              <text x="860" y="70" className="ml-sub">8 rules · first match wins</text>
            </g>

            {/* Router down to activities */}
            <path d="M860 88 V128" className="ml-flow" markerEnd="url(#ml-arrow)" />
            <text x="872" y="112" className="ml-edge">one activity</text>

            {/* Row 2 — the activities */}
            <text x="490" y="152" className="ml-band">THE FIVE THINGS IT CAN HAND BACK</text>
            {[
              { x: 30, label: "Topic survey", sub: "fills the card", tone: "measure" },
              { x: 218, label: "Homework", sub: "teaches + measures", tone: "measure" },
              { x: 406, label: "Practice", sub: "teaches only", tone: "teach" },
              { x: 594, label: "Class", sub: "re-teaches", tone: "teach" },
              { x: 782, label: "LO check", sub: "certifies", tone: "certify" },
            ].map((box) => (
              <g key={box.label} className={`ml-node act-${box.tone}`}>
                <rect x={box.x} y="168" width="168" height="58" rx="9" />
                <text x={box.x + 84} y="192" className="ml-lbl">{box.label}</text>
                <text x={box.x + 84} y="210" className="ml-sub">{box.sub}</text>
              </g>
            ))}
            <path d="M860 128 H114 V168" className="ml-flow" markerEnd="url(#ml-arrow)" />
            <path d="M302 128 V168" className="ml-flow" />
            <path d="M490 128 V168" className="ml-flow" />
            <path d="M678 128 V168" className="ml-flow" />
            <path d="M866 128 V168" className="ml-flow" />

            {/* Row 3 — back into the scorecard */}
            <path d="M114 226 V268 H600" className="ml-flow-back" markerEnd="url(#ml-arrow)" />
            <path d="M302 226 V268" className="ml-flow-back" />
            <path d="M490 226 V268" className="ml-flow-back" />
            <path d="M678 226 V268" className="ml-flow-back" />
            <path d="M866 226 V268 H612" className="ml-flow-back" />
            <text x="150" y="262" className="ml-edge">every attempt writes back to the scorecard</text>

            <g className="ml-node scorecard">
              <rect x="600" y="248" width="176" height="40" rx="9" />
              <text x="688" y="273" className="ml-lbl">scorecard updated</text>
            </g>
            <path d="M776 268 H900 V90" className="ml-flow" markerEnd="url(#ml-arrow)" />
            <text x="790" y="288" className="ml-edge">next round</text>

            {/* Row 4 — the handback */}
            <g className="ml-node close">
              <rect x="20" y="318" width="240" height="62" rx="10" />
              <text x="140" y="344" className="ml-lbl">All objectives certified</text>
              <text x="140" y="362" className="ml-sub">the only exit from the loop</text>
            </g>
            <path d="M114 288 V318" className="ml-flow" markerEnd="url(#ml-arrow)" />
            <path d="M260 349 H340" className="ml-flow-hi" markerEnd="url(#ml-arrow)" />

            <g className="ml-node plan hi">
              <rect x="340" y="318" width="300" height="62" rx="10" />
              <text x="490" y="344" className="ml-lbl">
                {handback && handback.classesUsed > handback.classesAllocated
                  ? `the plan asks for ${handback.classesUsed - handback.classesAllocated} more`
                  : `${handback?.classesFreed ?? 0} classes go back to the plan`}
              </text>
              <text x="490" y="362" className="ml-sub">the plan resizes on evidence, not estimate</text>
            </g>
            <path d="M640 349 H720 V90" className="ml-flow-hi" markerEnd="url(#ml-arrow)" />
            <text x="654" y="340" className="ml-edge">re-plan</text>
          </svg>
          <figcaption>
            <b>The bottom arrow is the new part.</b> Every flow in the prototype already read a
            config and wrote a report. What did not exist was anything that read those reports
            and decided what the student does next — and nothing that could tell the plan a
            topic was genuinely finished.
          </figcaption>
        </figure>

        <button
          type="button"
          className="lpb-ml-disclosure"
          onClick={() => setLedgerOpen((open) => !open)}
          aria-expanded={ledgerOpen}
        >
          {ledgerOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          Why &ldquo;a test&rdquo; is not one thing — what each activity is allowed to do
        </button>
        {ledgerOpen ? (
          <div className="lpb-ml-table-wrap">
            <table className="lpb-ml-table">
              <thead>
                <tr>
                  <th>Activity</th>
                  <th>What it is for</th>
                  <th>Shape</th>
                  <th className="num">Moves the score</th>
                  <th className="num">Can certify</th>
                  <th>Lives in the plan as</th>
                </tr>
              </thead>
              <tbody>
                {MASTERY_ACTIVITIES.map((activity) => (
                  <tr key={activity.kind}>
                    <td className="term">{activity.name}</td>
                    <td>{activity.purpose}</td>
                    <td className="dim">{activity.shape}</td>
                    <td className="num">
                      {activity.scoreWeight === 0 ? (
                        <span className="lpb-ml-zero">no</span>
                      ) : (
                        <span className="lpb-ml-weight">×{activity.scoreWeight}</span>
                      )}
                    </td>
                    <td className="num">
                      {activity.certifies ? (
                        <span className="lpb-ml-yes">
                          <Check size={13} /> yes
                        </span>
                      ) : (
                        <span className="lpb-ml-zero">no</span>
                      )}
                    </td>
                    <td className="dim">{activity.builderHome}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="lpb-ml-caption">
              Practice is a fifth of the questions a student answers and zero percent of the
              score — deliberately. It has hints and unlimited retries, so a correct answer
              there is guaranteed by the format. It teaches; it never measures. Only one row in
              this table can end an objective.
            </p>
          </div>
        ) : null}
      </section>

      {/* ---------------------------------------------------------------- *
       * 3. What we already know. Real builder data, mastery lens.
       * ---------------------------------------------------------------- */}
      <section className="lpb-ml-block">
        <header className="lpb-ml-block-head">
          <div>
            <span className="lpb-section-no">02</span>
            <h3>What the platform already knows about {student.name.split(" ")[0]}</h3>
            <p>
              Same evidence as Step 2 of the builder, read as a scorecard. Nothing here is new
              data — it is the same placement scores and question attempts, turned into the
              one record the loop reads.
            </p>
          </div>
          {plan.allocations.length > 1 ? (
            <label className="lpb-ml-topic-select">
              <span>Topic</span>
              <select
                value={focusTopicId}
                onChange={(event) => {
                  setFocusTopicId(Number(event.target.value))
                  setStep(0)
                }}
              >
                {plan.allocations.map((item) => (
                  <option key={item.topicId} value={item.topicId}>
                    {item.topicName}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </header>

        <div className="lpb-ml-provenance">
          <div>
            <span>Placement</span>
            <b>{placement ? `${placement.score}%` : "not taken"}</b>
            <p>{seedInfo.explained}</p>
          </div>
          <div>
            <span>Question attempts on file</span>
            <b>{attemptCount}</b>
            <p>
              {attemptCount
                ? "Real correct-out-of-attempted records, split by Starter and Master level. These move the score."
                : "None on this topic — which is exactly why the survey has to run first."}
            </p>
          </div>
          <div>
            <span>Objective verdicts</span>
            <b>{labelCount}</b>
            <p>
              {labelCount
                ? "Secure / not-secure labels. A verdict rather than a count, so they carry half weight and only fill gaps."
                : "None recorded yet."}
            </p>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- *
       * 4. The run. One decision at a time.
       * ---------------------------------------------------------------- */}
      <section className="lpb-ml-block">
        <header className="lpb-ml-block-head">
          <div>
            <span className="lpb-section-no">03</span>
            <h3>Watch it decide</h3>
            <p>
              Step through {topic.name} one decision at a time. The left column is the
              scorecard as it stands; the right is the rule that fired and why. Nothing is
              scheduled in advance — the number of activities is an output of the loop, never
              an input to it.
            </p>
          </div>
          <div className="lpb-ml-transport">
            <button
              type="button"
              onClick={() => setStep(0)}
              disabled={step === 0}
              title="Back to the start"
            >
              <RotateCcw size={15} />
            </button>
            <button
              type="button"
              onClick={() => setStep((value) => Math.max(0, value - 1))}
              disabled={step === 0}
            >
              Prev
            </button>
            <span className="lpb-ml-step-count">
              {step === 0 ? "Start" : `Round ${step}`} <i>/ {totalSteps}</i>
            </span>
            <button
              type="button"
              className="primary"
              onClick={() => setStep((value) => Math.min(totalSteps, value + 1))}
              disabled={step >= totalSteps}
            >
              {step === 0 ? (
                <>
                  <Play size={14} /> Run the first round
                </>
              ) : (
                <>
                  Next <ArrowRight size={14} />
                </>
              )}
            </button>
          </div>
        </header>

        <div className="lpb-ml-run">
          {/* ---- left: the scorecard ---- */}
          <div className="lpb-ml-card-col">
            <div className="lpb-ml-topic-strip">
              <div>
                <span>Topic score</span>
                <b>{card.topicLocked ? card.topicScore : "—"}</b>
                <small>
                  {card.topicLocked
                    ? "reported, never a gate"
                    : "not enough evidence to state one"}
                </small>
              </div>
              <div>
                <span>Certified</span>
                <b>
                  {card.signedOffCount}
                  <i> / {card.rows.length}</i>
                </b>
                <small>one-way — a certified objective never comes back</small>
              </div>
              <div>
                <span>Badge</span>
                <b className="badge">{card.badge}</b>
                <small>earned on coverage, not on the score</small>
              </div>
            </div>

            <ul className="lpb-ml-lo-list">
              {card.rows.map((row) => (
                <li key={row.id} className={row.signedOff ? "done" : ""}>
                  <div className="lpb-ml-lo-head">
                    <div>
                      <strong>{row.text}</strong>
                      <p>{row.subtopic}</p>
                    </div>
                    <span className={stateClass(row.state)} title={STATE_COPY[row.state].plain}>
                      {row.signedOff ? <Check size={12} /> : null}
                      {STATE_COPY[row.state].label}
                    </span>
                  </div>
                  <ScoreBar value={row.score} muted={!row.locked} />
                  <div className="lpb-ml-lo-meta">
                    <span className={row.locked ? "" : "dim"}>
                      {row.score === null ? (
                        <>
                          score withheld · confidence {row.confidence.toFixed(2)} is under{" "}
                          {CONFIDENCE_LOCK}
                        </>
                      ) : (
                        <>
                          score <b>{row.score}</b> · confidence {row.confidence.toFixed(2)}
                        </>
                      )}
                    </span>
                    <span className="dim">
                      {row.easyAccuracy !== null ? `basics ${row.easyAccuracy}%` : "basics untested"}
                      {" · "}
                      {row.hardCleared ? "hard question cleared" : "no hard question cleared"}
                      {row.assists > 0 ? ` · ${row.assists} hints used` : ""}
                      {row.checkFailures > 0 ? ` · ${row.checkFailures} check failed` : ""}
                    </span>
                  </div>
                  {step === 0 ? (
                    <p className="lpb-ml-lo-prov">{row.provenance}</p>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="lpb-ml-caption">
              A score is only shown once there is enough evidence behind it. Two questions and
              twenty questions are not the same claim, so below the confidence line the platform
              returns nothing at all rather than a number that looks like a fact.
            </p>
          </div>

          {/* ---- right: the router ---- */}
          <div className="lpb-ml-router-col">
            <div className="lpb-ml-decision">
              <span className="lpb-kicker">
                {step === 0 ? "If a session started right now" : `Round ${step}`}
              </span>
              <h4>
                {current ? current.headline : decision.activityLabel}
              </h4>
              <p>{current ? current.note : decision.because}</p>
              <div className="lpb-ml-decision-foot">
                <span className="lpb-ml-rule-chip">
                  {firingRule} · {current ? current.decision.ruleName : decision.ruleName}
                </span>
                <span>{current ? current.decision.activityLabel : decision.activityLabel}</span>
              </div>
              <p className="lpb-ml-effect">
                <b>What it may do:</b>{" "}
                {current ? current.decision.effect : decision.effect}
              </p>
            </div>

            <div className="lpb-ml-ladder">
              <span className="lpb-detail-label">The ladder · read top to bottom, first match wins</span>
              {MASTERY_RULES.map((rule) => {
                const active = rule.id === firingRule
                const skipped =
                  MASTERY_RULES.findIndex((item) => item.id === rule.id) <
                  MASTERY_RULES.findIndex((item) => item.id === firingRule)
                return (
                  <div
                    key={rule.id}
                    className={`lpb-ml-rule ${active ? "active" : ""} ${skipped ? "skipped" : ""}`}
                  >
                    <span className="id">{rule.id}</span>
                    <div>
                      <strong>{rule.name}</strong>
                      <small>{rule.condition}</small>
                      {active ? <p>{rule.plain}</p> : null}
                    </div>
                    <span className="act">{rule.activity}</span>
                  </div>
                )
              })}
            </div>
            <p className="lpb-ml-caption">
              The order <i>is</i> the design. Safety sits above certification, certification
              above teaching, teaching above the default. Move &ldquo;ready to certify&rdquo;
              below &ldquo;homework&rdquo; and objectives never get signed off — they just keep
              being practised.
            </p>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- *
       * 5. The handback into the plan.
       * ---------------------------------------------------------------- */}
      {handback ? (
        <section className="lpb-ml-block">
          <header className="lpb-ml-block-head">
            <div>
              <span className="lpb-section-no">04</span>
              <h3>And this is what goes back to the plan</h3>
              <p>
                The builder already has a &ldquo;completed faster&rdquo; outcome that returns a
                class to the package. Today a teacher types it. Here the loop derives it from
                certification evidence — same mechanic, evidence instead of estimate.
              </p>
            </div>
          </header>

          <div className="lpb-ml-handback">
            {/* Both rows are drawn to the same length so they compare directly,
                and that length is whichever is larger — otherwise an overrun
                would be invisible. */}
            <div className="lpb-ml-handback-bars">
              <div className="lpb-ml-hb-row">
                <span>Booked by the plan</span>
                <div className="lpb-ml-hb-track">
                  {Array.from({ length: handbackTrackLength }).map((_, index) => (
                    <i
                      key={index}
                      className={index < handback.classesAllocated ? "booked" : "empty"}
                    />
                  ))}
                </div>
                <b>{handback.classesAllocated}</b>
              </div>
              <div className="lpb-ml-hb-row">
                <span>Spent by the loop</span>
                <div className="lpb-ml-hb-track">
                  {Array.from({ length: handbackTrackLength }).map((_, index) => (
                    <i
                      key={index}
                      className={
                        index >= handback.classesUsed
                          ? "freed"
                          : index >= handback.classesAllocated
                            ? "over"
                            : "used"
                      }
                    />
                  ))}
                </div>
                <b>{handback.classesUsed}</b>
              </div>
              <p className="lpb-ml-hb-key">
                <i className="used" /> spent
                {handback.classesFreed > 0 ? (
                  <>
                    <i className="freed" /> handed back
                  </>
                ) : null}
                {handback.classesUsed > handback.classesAllocated ? (
                  <>
                    <i className="over" /> over the booking
                  </>
                ) : null}
              </p>
            </div>

            <div className="lpb-ml-handback-note">
              <span className={`lpb-ml-outcome ${handback.outcome}`}>
                <GraduationCap size={14} />
                {handback.outcome === "faster"
                  ? "Completed faster"
                  : handback.outcome === "escalated"
                    ? "Escalated to a teacher"
                    : handback.outcome === "needs-time"
                      ? "Needed more time"
                      : "On track"}
              </span>
              <p>{handback.summary}</p>
              <p className="dim">
                {handback.certified} of {handback.totalObjectives} objectives certified across{" "}
                {rounds.length} rounds. Those objectives now feed the maintenance slice of every
                later homework set, so what was proved here keeps being checked — lightly, and
                on hard questions only — while the next topic runs.
              </p>
            </div>
          </div>

          <div className="lpb-ml-closing">
            <BookOpen size={18} />
            <p>
              <b>The one sentence.</b> The plan decides which topic and how many classes; the
              loop decides what happens inside each of those classes; and because the loop can
              say an objective is genuinely finished, the plan stops being a schedule and
              becomes something that resizes itself as the student proves things.
            </p>
          </div>
        </section>
      ) : null}
    </div>
  )
}

/**
 * A compact version of the scorecard for Step 2, so the evidence screen can be
 * read either as a teacher's case notes or as the record the loop will act on.
 */
export function MasteryEvidenceLens({
  student,
  topic,
}: {
  student: DemoStudent
  topic: CurriculumTopic
}) {
  const card = useMemo(() => buildScorecard(student, topic), [student, topic])
  const decision = useMemo(() => routeNext(card), [card])

  return (
    <div className="lpb-ml-lens">
      <div className="lpb-panel-title">
        <Target size={18} />
        <div>
          <h3>The same evidence, as a scorecard</h3>
          <p>
            One row per skill inside {topic.name} — this is the record the personalisation
            loop reads before every session
          </p>
        </div>
      </div>

      <ul className="lpb-ml-lens-list">
        {card.rows.map((row) => (
          <li key={row.id}>
            <div>
              <strong>{row.text}</strong>
              <span className={stateClass(row.state)}>{STATE_COPY[row.state].label}</span>
            </div>
            <ScoreBar value={row.score} muted={!row.locked} />
            <small>
              {row.score === null
                ? `No score stated — confidence ${row.confidence.toFixed(2)} is under the ${CONFIDENCE_LOCK} line, and a guess is worse than a blank.`
                : `Score ${row.score} · confidence ${row.confidence.toFixed(2)} · ${row.provenance}`}
            </small>
          </li>
        ))}
      </ul>

      <div className="lpb-ml-lens-decision">
        <span className="lpb-ml-rule-chip">
          {decision.rule} · {decision.ruleName}
        </span>
        <p>
          <b>If a session started right now:</b> {decision.activityLabel}. {decision.because}
        </p>
      </div>
    </div>
  )
}

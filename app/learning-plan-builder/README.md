# Learning Plan Builder Summary

The Learning Plan Builder creates and continuously updates a class-by-class Maths plan for an individual student. The demo students are all Grade 5, but the curriculum covers Kindergarten through Grade 8.

### Where the curriculum comes from

`curriculum.generated.ts` holds the teaching sequence for every grade and is built from `files/Maths Teaching Sequence All Grades.xlsx`. Do not edit it by hand — change the workbook and regenerate:

```
npx tsx --env-file=.env.local scripts/build-curriculum-from-workbook.ts
```

Topic IDs are the live `topics.id` values from the curriculum tables, so a topic missing from the database fails the build rather than getting an invented ID.

The workbook supplies topic order, prerequisites, subtopics, and learning objectives. It does **not** carry class counts, activity counts, priority, or the easy/practice split. Grade 5 keeps the hand-tuned values that were signed off earlier; every other grade uses heuristics calibrated against those Grade 5 numbers (see the generator for the rules). Treat KG–4 and 6–8 class counts as defaults to be reviewed, not agreed figures.

### Inputs

- Student profile, package and remaining classes
- Classes per week (default 2) — sizes the two-week plan window
- Placement-test results
- Topic and learning-objective mastery
- Completed and current topics
- Parent-requested starting topic
- Curriculum priorities, prerequisites, ideal **and minimum** classes, activities

### Teacher workflow

1. Select a student scenario.
2. Review available student evidence.
3. Choose the topic scope:
   - **Plan manually**
   - **Plan from evidence** (rules over placement, mastery, capacity)
4. Review capacity, structural classes and topic allocations.
5. Build the class-by-class learning plan (AI writes mentor teaching guides).

The rules below are surfaced in the UI two ways, and both need updating when `lib/learning-plan/engine.ts` changes:

- **“Why this” panel** (`methodology-sidebar.tsx`) — a right-hand panel toggled from the topbar on every screen. One or two lines per rule, computed from the student's own package, placement, mastery and capacity numbers: which rule fired here and what it did. Its notes are keyed by `MethodologyContext`, so a new screen needs a new context and a `buildNotes` case.
- **Methodology dialog** (`methodology.tsx`) — the long-form concept, opened as a dialog from the plan board (`How this works`) or from the "Why this" rail footer. It is no longer a tab: it describes the tool rather than the plan on screen, so it is reachable from every step. It covers what the builder is and how to drive it, every threshold as a reference table, the four class kinds, a worked example of one topic sized end to end, and which parts are rule-based versus AI-written. It opens with a **scenario history** block — the four demo students side by side on the same five rows (classes taught, topics finished, placement, checkpoint mastery, parent request), so it is obvious that B starts from nothing and C starts from 13 taught classes. That block is derived from `demoStudents`, so adding or editing a demo student updates it automatically.

### Planning rules

- High-priority topics are always included and cannot be unselected.
- Strong performance can reduce a High topic’s classes and activities, but never remove it.
- Medium topics are added after High topics when capacity remains.
- Low topics are added last.
- Evidence rules can recommend skipping only Medium or Low topics.
- Topics are sequenced High first, then Medium, then Low, using curriculum sequence inside each band.
- Prerequisites are placed before dependent topics. This overrides the priority order — a Medium prerequisite still runs ahead of the High topic that needs it.
- A prerequisite scoring 75% or more in front of a topic scored below 40% is kept but shortened to a refresher (half the ideal classes, rounded up), so the weak topic is reached sooner. The prerequisite is never skipped.
- Checkpoints, revision classes, practice classes and PTMs count toward capacity.
- Over-capacity plans remain editable but show a persistent warning.

**Structural classes**

The full-year workbook package is 66 teaching + 13 structural = 79 classes, where the structural 13 is 5 checkpoints + 5 RDP + 3 PTM.

The Grade 5 ideal class counts add up to exactly those 66 teaching classes. That is deliberate: an untouched full-year plan runs every topic at its ideal length, keeps the full structural reserve, and lands on 79 with nothing compressed. Every class the plan then saves — a placement score of 75% or more shortening a topic to its minimum, a completed topic dropping out — shows up on the capacity card as real headroom under the package instead of being swallowed by an overage that was baked into the curriculum. `scripts/build-curriculum-from-workbook.ts` throws if the Grade 5 totals drift off 66, and `tests/learning-plan-capacity.test.ts` (`npm test`) covers the invariant end to end.

- **Checkpoints** produce the mastery evidence every later rule reads, so they are protected the longest.
- **RDP (revision, doubts & practice)** is the optional part of the structure and is shed first when the plan is tight.
- **PTMs are scheduled by ops on a fixed calendar.** The builder reserves their classes against the package (reported as `capacity.opsReserve`) but never generates or places them in the class sequence, and the fit ladder cannot shed them.

**Fitting a plan into the package (Rules B2, F3, H1)**

When the selected scope does not fit the remaining classes, the builder works in this order:

1. **Shed RDP classes** down to one. Revision, doubts and practice are optional when capacity is tight.
2. **Shed checkpoint + RDP pairs**, keeping at least two checkpoints (one for a single-topic plan). The ops PTM reserve is left alone.
3. **Compress toward Minimum Classes** — lowest priority first, latest sequence first. Every topic carries a minimum (the fewest classes in which it can still be taught soundly); no automatic rule may go below it. Prerequisite refreshers are never compressed.
4. **Drop topics** — Low first, then Medium (latest sequence first). A topic another selected topic depends on is never dropped.
5. **Warn** — if High-priority topics still do not fit, the plan shows a warning for manual decision instead of dropping anything silently.

**Mastery resizes topics in both directions**

- Two or more objectives not secure (or half the objectives on a small topic) **extends** the topic, capped at two classes above the ideal, with the split shifted toward practice.
- Secure Master-level evidence **shortens** it, never below the class minimum.
- For the in-progress topic, classes already taught are subtracted from the *evidence-adjusted* total, so early mastery genuinely reduces the classes that remain.

A teacher override is the only way a topic can go below its minimum, and the plan flags it when that happens.

**Spare capacity (Rule B3)**

With 10 or more classes spare, only the required classes are planned and the surplus is reserved as “Revision / School Help”.

### Generated output

- Ordered class-by-class teaching sequence
- Learning objectives for every class
- Easy and Practice activity allocation
- Explanation for every recommendation
- Structural classes such as checkpoints, RDP and PTM
- Topics not scheduled and the reason why
- Starter-to-Master question examples

### Updating the plan

After a class, the teacher records whether the student:

- Completed it faster
- Stayed on track
- Needed more time

The builder previews the updated allocation and creates a new plan version only after teacher approval. A “faster” outcome never takes a topic below its minimum classes.

### Personalisation — the mastery loop

`lib/learning-plan/mastery.ts` is the decision layer that runs *inside* a planned
class. The builder decides which topics get taught and how many classes each one
gets; the loop decides what happens in each session, one activity at a time,
until every learning objective in the topic has been certified.

It is surfaced on the plan board only — no setup screen changed shape:

- **The `Personalisation` tab** on the plan board (`MasteryView`) — the two
  systems and how they join, a map of where every assessment flow sits, the
  activity ledger, a steppable run of the loop over the focused topic, and what
  the run hands back to the plan.

The loop's own rules, in short:

- The **scorecard** is one row per objective — score, confidence, state. It is
  the only thing that survives between sessions.
- A **score is withheld** below a confidence of 0.55. Two questions and twenty
  questions are not the same claim, so the platform returns nothing rather than
  a guess.
- The **router** is eight rules read top to bottom, first match wins: safety
  (R0–R2), then certification (R5), then teaching (R6), then homework as the
  default (R7). The order is the design — move R5 below R7 and nothing ever gets
  signed off.
- **Only the LO check can certify** an objective, on 5 fresh questions, and
  sign-off is permanent within the topic. Practice carries score weight zero: it
  has hints and unlimited retries, so it teaches and never measures.
- Three guards stop the loop spinning, and all three are load-bearing: practice
  may not repeat on an objective until something measured it, practice may not
  run two rounds in a row at all, and a whole-topic re-teach may not repeat
  until a measurement has run *and* the previous re-teach failed to move the
  score.

**Where the numbers come from.** The starting scorecard is derived entirely from
data already on `DemoStudent` — `placementResults` seed the topic row through the
shrinkage formula, `questionAttemptEvidence` are raw attempts, `objectiveEvidence`
is a weaker secure/not-secure signal at half weight. Everything after that is a
deterministic simulation (seeded PRNG, no `Math.random`) so a demo replays
identically. The scoring model, thresholds and confidence formula are the ones in
`plans/mastery-loop-flow-ap.html`; the confidence record cap is widened from 4 to
12 because the live gate was built for a single session's report, not a whole
topic window.

**Checkpoints now carry their mastery role.** `engine.ts` labels the first
checkpoint on a plan as the topic survey (fills the scorecard before teaching)
and every later one as an LO check (the only activity that certifies). Same
classes as before, named for what they are for.

**Known fidelity gap.** The mastery flow document is sized on 2–3 objectives per
topic; the Grade 5 workbook gives 4–6. The router does not care, but survey
sizing does — a 6-objective topic needs an 18-question survey, and the static
materialiser's golden LO rule silently drops objectives it cannot give 3
questions to. Validate `survey total >= 3 x LOs` before this leaves prototype.

### Objective-level planning — the join with the mastery loop

The loop measures learning objectives; the planner teaches them. `buildObjectiveFocus()`
in `engine.ts` reads the same evidence the sizing rules use and gives every objective
a standing: `needs-teaching` (recorded not secure, or question attempts under half
right), `improving`, `secure` (secure at Master), or `unmeasured`.

That standing does two things inside a topic whose length is already decided:

- **Teaching order** — objectives are sorted weakest-first, so a topic is not taught
  front-to-back regardless of what the evidence says. Ties keep curriculum order.
- **Reinforcement classes** — when a topic has more classes than objectives, the spare
  classes go to the `needs-teaching` objectives instead of walking back from the last
  one. With no evidence the original behaviour stands.

The standing rides on `PlanTopicAllocation.objectiveFocus` and is shown on each class
in the lesson guide, so a mentor sees which objective the class exists for.

### Question banks

`questionGuidelines` holds a **bank** per objective — `starters: string[]` and
`masters: string[]`, currently 4 and 3 — not a single prompt each. A class can carry
several Starter slots on one objective, and serving the same question three times told
the student nothing the first one had not.

`buildClassActivities()` walks the bank so every slot in a class is a different
question. Each class starts at its own offset in the bank, derived from the class id,
so an objective taught across several classes does not open with the same question
every time — and the offset is a hash, not a random pick, because the plan has to stay
deterministic. Objectives with no bank yet fall back to a rotating set of differently
framed tasks rather than one sentence repeated.

### The Master bar

`MASTER_SCORE = 80` in `mastery.ts`. Certification (R5) makes an objective's pass
permanent; **Master** is the stronger claim on top of it — every objective in the topic
certified *and* still scoring 80 or better. A topic can close with everything certified
and stop at **Pro**. `READY_SCORE` stays 75 (ready to sit the check) and
`NEEDS_HELP_SCORE` stays 60 (teach rather than measure).

### The student journey simulation

`public/student-journey.html` is the mastery-loop simulation, reached from the
**Student journey** button on the plan board — the second half of the parent demo.
It is re-pointed at the real curriculum: Fraction Arithmetic, ideal 8, floor 5, with
the real Grade 5 topic sequence around it. The allocation stretches to cover teaching
that runs long but stops at ideal + 2, and the topic paying for those extra classes
cannot go below its own minimum either.

### Colour

The UI is deliberately near-monochrome — deep green on warm paper — with one
exception: the four demo scenarios. Each carries an accent (A teal, B amber,
C indigo, D coral) declared once as `--accent` / `--accent-soft` /
`--accent-line` / `--accent-glow` on `.lpb-scenario-a` … `-d`, and every
scenario-aware element reads those variables rather than naming a colour.

That means a student is the same colour everywhere they appear — the picker
card, the `Demo B` chip on Step 2, the plan masthead avatar, the methodology
scenario-history card. Adding a scenario means adding one four-line block; do
not hardcode a hex anywhere else.

### AI in the prototype

AI recommendations are currently simulated locally from the dummy placement and mastery data. No external AI model is connected yet. The workflow, design and exact production output are still prototype decisions rather than finalized specifications.

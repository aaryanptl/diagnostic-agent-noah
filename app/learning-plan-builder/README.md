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
- **Methodology tab** (`methodology.tsx`) — the long-form concept on the plan board, for reading rather than presenting.

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

It is surfaced in two places, both additive — no existing screen changed shape:

- **Step 2** gets a scorecard lens (`MasteryEvidenceLens`) under the evidence
  panels: the same placement scores and question attempts, read as one row per
  objective, plus the rule the router would fire if a session started now.
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

### AI in the prototype

AI recommendations are currently simulated locally from the dummy placement and mastery data. No external AI model is connected yet. The workflow, design and exact production output are still prototype decisions rather than finalized specifications.

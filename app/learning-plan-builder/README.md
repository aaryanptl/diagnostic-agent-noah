# Learning Plan Builder Summary

The Learning Plan Builder creates and continuously updates a class-by-class Grade 5 Maths plan for an individual student.

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

### AI in the prototype

AI recommendations are currently simulated locally from the dummy placement and mastery data. No external AI model is connected yet. The workflow, design and exact production output are still prototype decisions rather than finalized specifications.

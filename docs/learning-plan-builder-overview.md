# Learning Plan Builder — What It Is and How It Works

A plain-language description of the product. No code, no file names — this is the
document to read before a demo, or to hand to someone who has never seen the app.

---

## The one-paragraph version

A parent buys a package of maths classes. A teacher has to decide what to teach in
those classes, in what order, and for how long each topic runs. The Learning Plan
Builder makes that decision — it reads what the student has already proven, weighs it
against the curriculum's priorities, fits the required teaching into the number of
classes actually left, and produces a class-by-class plan with a written reason
attached to every choice. The teacher stays in charge: they can change anything, and
the plan tells them what that change costs.

## Who it is for

- **Teachers and mentors** — the primary users. They pick the student, review the
  evidence, approve the scope, and teach from the generated plan.
- **Academic operations** — they see how a package is being spent, and where a plan
  is running over or under.
- **Parents** — indirectly. They see the next two weeks of classes and a plain
  explanation of why their child is being taught what they are being taught.

The demo covers Grade 5 maths on the US curriculum. The underlying teaching sequence
covers Kindergarten through Grade 8.

---

## The core idea

Three things are in tension, and the builder's whole job is resolving them:

1. **What the curriculum says must be taught.** Every topic carries a priority —
   High, Medium or Low — and an ideal number of classes.
2. **What this student actually needs.** Placement scores, checkpoint results and
   question attempts show where they are strong and where they are stuck.
3. **How many classes are left in the package.** A full year is 79 classes. A
   half-year package is 40. A returning student mid-way through might have 24.

A plan that ignores the first is unstructured. One that ignores the second wastes the
student's time. One that ignores the third is a plan nobody can actually teach.

---

## Walking through the app

The builder is four setup steps, then a plan board.

### Step 1 — Choose the student

Four demo students, each showing a different planning path. Picking one loads their
package, their history and whatever evidence exists.

### Step 2 — Review the evidence

Everything known about the student, laid out: placement scores per topic, which
learning objectives are secure and which are not, how they did on Starter versus
Master questions, what has already been taught. Nothing is decided here — this is the
teacher reading the case before agreeing to a plan.

### Step 3 — Choose the topic scope

The topic list, pre-selected on the evidence. High-priority topics are locked in and
cannot be removed. Medium and Low are ticked while capacity allows. The teacher can
add, remove and drag topics into a different teaching order. Each row shows the
topic's priority, how many classes it will take against its ideal, how many activities
it carries, and whether another topic depends on it.

The teacher can plan **manually** or **from evidence** — the second applies the rules
described below and explains each recommendation.

### Step 4 — Review before building

The arithmetic, before anything is committed: what the topics need, what evidence
took off or added, what the structural classes cost, and whether that lands inside the
package or over it. If it is over, the plan says so rather than quietly dropping
something.

### The plan board

Once built, the plan is shown six ways:

- **Classes** — the class-by-class sequence, each with its learning objectives,
  activities, and the reason it is there.
- **Topics** — every topic's allocation and why it ended up that length.
- **Structure** — the checkpoints and revision classes holding the plan together.
- **2 weeks** — the next fortnight, the view a parent is shown.
- **Mentor view** — where the student is right now, what they are stuck on, and what
  to do about it in the next class.
- **Methodology** — the rules themselves, explained.

---

## The rules, in plain English

### What gets taught

- **High-priority topics are always in.** Strong evidence can make a High topic
  shorter. It can never remove it.
- **Medium topics come next**, once every High topic fits.
- **Low topics come last**, from whatever capacity is left.
- The system may *suggest* skipping a Medium or Low topic. It never skips one on its
  own, and it never suggests skipping a High topic.

### What order it is taught in

- Priority order first: High, then Medium, then Low, following the curriculum's own
  sequence inside each band.
- **Except for prerequisites.** If topic B needs topic A, A is taught first — even if
  A is a lower priority than B. This is the one rule that outranks priority.
- If the student has *already proven* a prerequisite (scored 75% or more) and is
  weak in the topic that follows it (below 40%), the prerequisite is **shortened to a
  refresher** — about half its normal length — rather than skipped. They still get
  the recap; they just reach the topic they actually need sooner.

### How long each topic runs

Every topic has an ideal length and a **minimum** — the fewest classes in which it can
still be taught properly. Evidence moves the topic between those two ends:

| What the evidence shows | What happens |
|---|---|
| Placement below 40% | Full length kept, more practice weight |
| Placement 40–74% | Ideal length, unchanged |
| Placement 75% or above | Shortened toward the minimum, easier activity mix |
| Master-level objectives secure | Shortened, never below the minimum |
| Two or more objectives not secure | **Extended**, capped at two classes over ideal |
| Strong on familiar questions, weak on unfamiliar ones | Full length kept, and the teaching note says to teach transfer rather than more drill |

The cap matters: one weak topic cannot be allowed to eat the whole package.

### Classes that are not teaching

A full-year package is **66 teaching classes plus 13 structural ones** — 5
checkpoints, 5 revision/doubts/practice classes, and 3 parent–teacher meetings.

- **Checkpoints** are where the plan collects its evidence. Everything downstream
  depends on them, so they are protected longest.
- **Revision, doubts and practice** are valuable but optional. They are the first
  thing dropped when the plan is tight.
- **Parent–teacher meetings** are scheduled by operations on a fixed calendar. The
  builder holds their classes against the package but never places them in the
  teaching sequence, and can never drop them to make room.

### When the plan does not fit

The builder works down a ladder, in this order, and stops as soon as it fits:

1. Drop revision classes down to one.
2. Drop checkpoint-and-revision pairs, keeping at least two checkpoints.
3. Compress topics toward their minimums — lowest priority first, latest in the
   sequence first. Prerequisite refreshers and anything the teacher has edited by hand
   are left alone.
4. Drop topics — Low first, then Medium. Never a topic that another selected topic
   depends on.
5. **Warn.** If High-priority topics still do not fit, the plan raises a warning and
   asks the teacher to decide. It does not drop a High topic on its own.

### When there is room to spare

If ten or more classes are left over, they are held back as "Revision / School Help"
rather than padded into topics that do not need the extra time.

### The floor

No automatic rule may take a topic below its minimum — not a strong placement score,
not capacity pressure, not a class going faster than expected. **Only a teacher can**,
and the plan flags the topic when they do.

---

## After each class

The teacher records one of three outcomes:

- **Completed faster** — one class returns to the pool, unless the topic is already at
  its minimum.
- **On track** — nothing changes.
- **Needed more time** — one class is added, up to the ideal-plus-two cap.

The change is shown as a preview first. A new version of the plan is written only
after the teacher approves it. Classes already taught keep their numbers, so history
is never rewritten — a class that is no longer needed simply drops out of the sequence
without renumbering everything after it.

Checkpoint results feed back in as fresh evidence, so the sizing rules run again on
the classes still ahead.

---

## The four demo students

Each one exists to show a different path through the rules.

**Maya Thompson — placement completed, full year (79 classes).**
She scored 85% and 80% on two topics and 30% and 35% on two others. The strong topics
shorten toward their minimums, the weak ones keep their full length with extra
practice. One of her strong topics is a prerequisite for one of her weak ones, so it
runs first as a shortened refresher. Net effect: teaching drops from 66 classes to 62,
and those 4 classes show up as real headroom.

**Ethan Carter — no placement test, half year (40 classes).**
Nothing to read, so every topic starts at its ideal length — and immediately does not
fit. This is the student who demonstrates the fit ladder: compress toward the
minimums, then drop Low and Medium topics, in order, with a reason recorded for each.

**Aarav Shah — returning student, 24 classes left.**
Two topics are already finished and excluded. A third is in progress with three
classes already taught, and those are subtracted from what is left rather than being
re-planned. His checkpoint evidence shows he is secure on the basics of that topic but
not on the real-world problems, so it is extended rather than shortened.

**Sofia Martinez — parent-requested starting topic, full year.**
The parent asked for a specific topic. Rather than jumping to it or refusing, the
builder pulls its unmet prerequisite in front of it as a refresher, then teaches the
requested topic.

---

## How the app explains itself

Two features exist purely so nobody has to take the plan on trust.

**The "Why this" panel** — opens on the right of any screen and stays docked beside
the content. It explains the screen you are actually on, using this student's own
numbers: which placement scores fired which rule, how many prerequisite links are in
the current selection, exactly how the class arithmetic adds up. Small diagrams carry
the numbers — a score shown against the 40% and 75% thresholds, a topic's classes
shown as blocks with the removed ones struck through, the package shown as a stacked
budget.

**The Methodology tab** — the same rules at length, as concepts rather than as this
student's case. This is the reference; the panel is the running commentary.

Beyond those, every topic in a built plan carries the reasons that produced its
length, and every topic left out carries the reason it was left out.

---

## What is real and what is still prototype

- The **planning rules are real** and are driven by the signed-off Grade 5 workbook.
  The class counts, minimums, priorities and prerequisites come from that source, not
  from anything invented in the app.
- Grade 5's numbers are agreed. **Other grades use estimates** calibrated against
  Grade 5 and should be reviewed before being trusted.
- **Topic recommendations are computed by the rules**, not by a language model.
- **AI writes the per-class teaching guides** — the goal, the teaching points, the
  success criteria — with a written fallback if the model is unavailable.
- Student data in the demo is fixed test data, not live student records.
- The workflow, screens and exact output are prototype decisions, not final
  specifications.

---

## The short version to say out loud

> The builder does not pick topics by feel. It reads what the student has already
> proven, fits the required teaching into the classes the package actually has left,
> and keeps a written reason on every decision — and where it cannot fit everything,
> it tells the teacher instead of quietly dropping something.

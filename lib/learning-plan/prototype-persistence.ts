import pool from "@/lib/db";
import type {
  ClassOutcome,
  DemoStudent,
  GeneratedPlan,
  ModificationType,
  PlanItem,
} from "@/lib/learning-plan/types";

const PROTOTYPE_STUDENT_IDS: Record<string, string> = {
  "student-a": "5a500001-2d5f-4b7a-8fb0-000000000001",
  "student-b": "5a500001-2d5f-4b7a-8fb0-000000000002",
  "student-c": "5a500001-2d5f-4b7a-8fb0-000000000003",
  "student-d": "5a500001-2d5f-4b7a-8fb0-000000000004",
};

// Curriculum topic IDs in app/learning-plan-builder/curriculum.generated.ts are
// the live `topics.id` values, so no translation is needed to satisfy the
// learning_plan_topics foreign key.
function databaseTopicId(topicId: number): string {
  return String(topicId);
}

const PRIORITY_VALUE = { high: 1, medium: 2, low: 3 } as const;
const FOCUS_BY_ITEM_KIND: Record<PlanItem["kind"], "teach" | "review" | "assess"> = {
  teaching: "teach",
  checkpoint: "assess",
  rdp: "review",
  ptm: "review",
};

function sourceForKind(kind: Exclude<ModificationType, "initial"> | "initial") {
  if (kind === "initial") return "ai";
  if (kind === "manual") return "manual";
  if (kind === "class") return "class";
  return "auto";
}

export interface PrototypePlanUpdate {
  plan: GeneratedPlan;
  completedCount: number;
  kind: Exclude<ModificationType, "initial">;
  changes: string[];
  outcome?: ClassOutcome;
  note?: string;
  taughtPrototypeTopicId?: number;
  autoApplied?: boolean;
}

function databaseStudentId(student: DemoStudent): string {
  const id = PROTOTYPE_STUDENT_IDS[student.id];
  if (!id) throw new Error(`Unknown prototype student: ${student.id}`);
  return id;
}

function sessionDate(start: Date, classNumber: number): string {
  const date = new Date(start);
  date.setUTCDate(date.getUTCDate() + classNumber - 1);
  return date.toISOString().slice(0, 10);
}

function planStartDate(generatedAt: string): Date {
  const parsed = new Date(generatedAt);
  // Older prototype plans used a display label instead of an ISO timestamp.
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function itemActivity(item: PlanItem): string {
  const activities = item.activities?.map((activity) => activity.prompt).join(" ");
  return activities || item.reason || item.subtitle || item.title;
}

async function ensurePrototypeStudent(
  client: { query: typeof pool.query },
  student: DemoStudent,
) {
  const studentId = databaseStudentId(student);
  await client.query(
    `INSERT INTO diagnostic_students (id, display_name, normalized_name, current_class_level)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       normalized_name = EXCLUDED.normalized_name,
       current_class_level = EXCLUDED.current_class_level`,
    [
      studentId,
      student.name,
      student.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
      String(student.grade),
    ],
  );
  return studentId;
}

async function syncTopics(
  client: { query: typeof pool.query },
  planId: string,
  plan: GeneratedPlan,
  kind: Exclude<ModificationType, "initial"> | "initial",
) {
  for (const allocation of plan.allocations) {
    const topicId = databaseTopicId(allocation.topicId);
    await client.query(
      `INSERT INTO learning_plan_topics
         (plan_id, topic_id, topic_name, sequence, planned_classes,
          planned_activities, priority, source, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (plan_id, topic_id) WHERE topic_id IS NOT NULL DO UPDATE SET
         topic_name = EXCLUDED.topic_name,
         sequence = EXCLUDED.sequence,
         planned_classes = EXCLUDED.planned_classes,
         planned_activities = EXCLUDED.planned_activities,
         priority = EXCLUDED.priority,
         source = EXCLUDED.source,
         reason = EXCLUDED.reason,
         status = CASE
           WHEN learning_plan_topics.status = 'dropped' THEN 'planned'
           ELSE learning_plan_topics.status
         END`,
      [
        planId,
        topicId,
        allocation.topicName,
        allocation.sequence,
        allocation.classes,
        allocation.activities,
        PRIORITY_VALUE[allocation.priority],
        sourceForKind(kind),
        allocation.reasons.join(" "),
      ],
    );
  }

  for (const dropped of plan.droppedTopics) {
    const topicId = databaseTopicId(dropped.topicId);
    await client.query(
      `UPDATE learning_plan_topics
       SET status = 'dropped', reason = $3, source = $4
       WHERE plan_id = $1 AND topic_id = $2`,
      [
        planId,
        topicId,
        dropped.reason,
        sourceForKind(kind),
      ],
    );
  }
}

/**
 * The relational tables store a flattened projection (week/day/focus/activity),
 * which cannot rebuild the builder's view. This keeps the exact plan document
 * alongside it so a saved plan can be reopened by id.
 */
async function saveSnapshot(
  client: { query: typeof pool.query },
  planId: string,
  student: DemoStudent,
  plan: GeneratedPlan,
  completedCount: number,
) {
  await client.query(
    `INSERT INTO learning_plan_snapshots (plan_id, student, plan, completed_count)
     VALUES ($1, $2::jsonb, $3::jsonb, $4)
     ON CONFLICT (plan_id) DO UPDATE SET
       student = EXCLUDED.student,
       plan = EXCLUDED.plan,
       completed_count = EXCLUDED.completed_count,
       updated_at = now()`,
    [planId, JSON.stringify(student), JSON.stringify(plan), completedCount],
  );
}

export interface PrototypePlanSnapshot {
  planId: string;
  student: DemoStudent;
  plan: GeneratedPlan;
  completedCount: number;
  updatedAt: string;
}

export async function getPrototypePlanSnapshot(
  planId: string,
): Promise<PrototypePlanSnapshot | null> {
  const result = await pool.query(
    `SELECT plan_id::text AS "planId", student, plan,
            completed_count AS "completedCount",
            updated_at AS "updatedAt"
     FROM learning_plan_snapshots
     WHERE plan_id = $1`,
    [planId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    planId: row.planId,
    student: row.student as DemoStudent,
    plan: row.plan as GeneratedPlan,
    completedCount: Number(row.completedCount ?? 0),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

export async function savePrototypePlan(student: DemoStudent, plan: GeneratedPlan) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const studentId = await ensurePrototypeStudent(client, student);
    const start = planStartDate(plan.generatedAt);
    const created = await client.query(
      `INSERT INTO learning_plans
         (student_id, title, subject, grade, duration_weeks, start_date, status,
          notes, total_classes, classes_remaining, last_update_kind)
       VALUES ($1, $2, 'Maths', $3, $4, $5, 'active', $6, $7, $7, 'initial')
       RETURNING id::text AS id`,
      [
        studentId,
        `Grade ${student.grade} learning plan — ${student.name}`,
        String(student.grade),
        Math.max(1, Math.ceil(plan.items.length / 7)),
        sessionDate(start, 1),
        "Saved from the Learning Plan Builder prototype.",
        plan.capacity.available,
      ],
    );
    const planId: string = created.rows[0].id;
    await syncTopics(client, planId, plan, "initial");

    for (const item of plan.items) {
      await client.query(
        `INSERT INTO learning_plan_items
           (plan_id, week, day, session_date, sort_order, focus, topic,
            subject, learning_objective, activity)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'Maths', $8, $9)`,
        [
          planId,
          Math.floor((item.classNumber - 1) / 7) + 1,
          ((item.classNumber - 1) % 7) + 1,
          sessionDate(start, item.classNumber),
          item.classNumber,
          FOCUS_BY_ITEM_KIND[item.kind],
          item.topicName ?? item.title,
          item.learningObjectives[0]?.text ?? null,
          itemActivity(item),
        ],
      );
    }

    await client.query(
      `INSERT INTO learning_plan_revisions (plan_id, kind, actor, summary, diff)
       VALUES ($1, 'initial', 'learning-plan-builder', $2, $3::jsonb)`,
      [
        planId,
        "Initial prototype plan saved.",
        JSON.stringify({ version: plan.version, explanations: plan.explanations }),
      ],
    );
    await saveSnapshot(client, planId, student, plan, 0);
    await client.query("COMMIT");
    return { planId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updatePrototypePlan(
  planId: string,
  student: DemoStudent,
  update: PrototypePlanUpdate,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const studentId = await ensurePrototypeStudent(client, student);
    const ownership = await client.query(
      `SELECT id FROM learning_plans WHERE id = $1 AND student_id = $2 FOR UPDATE`,
      [planId, studentId],
    );
    if (!ownership.rows[0]) throw new Error("Saved plan was not found for this student.");

    await syncTopics(client, planId, update.plan, update.kind);
    if (update.kind === "class" && update.taughtPrototypeTopicId) {
      await client.query(
        `UPDATE learning_plan_topics
           SET classes_done = LEAST(classes_done + 1, planned_classes),
               status = CASE WHEN status = 'planned' THEN 'in_progress' ELSE status END
           WHERE plan_id = $1 AND topic_id = $2`,
        [planId, databaseTopicId(update.taughtPrototypeTopicId)],
      );
    }
    await client.query(
      `UPDATE learning_plans
       SET classes_remaining = $2, last_update_kind = $3
       WHERE id = $1`,
      [
        planId,
        Math.max(0, update.plan.capacity.available - update.completedCount),
        update.autoApplied ? "auto" : update.kind,
      ],
    );
    await client.query(
      `INSERT INTO learning_plan_revisions (plan_id, kind, actor, summary, diff)
       VALUES ($1, $2, 'learning-plan-builder', $3, $4::jsonb)`,
      [
        planId,
        update.kind,
        update.changes.join(" "),
        JSON.stringify({
          version: update.plan.version,
          changes: update.changes,
          outcome: update.outcome ?? null,
          note: update.note ?? null,
        }),
      ],
    );
    if (update.autoApplied) {
      await client.query(
        `INSERT INTO learning_plan_revisions (plan_id, kind, actor, summary, diff)
         VALUES ($1, 'auto', 'learning-plan-builder', $2, $3::jsonb)`,
        [
          planId,
          "Automatic refit applied after the recorded class outcome.",
          JSON.stringify({ version: update.plan.version, changes: update.changes }),
        ],
      );
    }
    await saveSnapshot(client, planId, student, update.plan, update.completedCount);
    await client.query("COMMIT");
    return { planId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

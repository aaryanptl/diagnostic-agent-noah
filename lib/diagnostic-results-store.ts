import "server-only";

import type { PoolClient } from "pg";

import type {
  AskedQuestionRecord,
  DiagnosticRegion,
  DiagnosticReport,
  LearningObjectiveResult,
  ProgressComparison,
} from "@/agents/diagnostic/types/index";
import pool from "@/lib/db";

const DEFAULT_DIAGNOSTIC_REGION: DiagnosticRegion = "US";

export interface StoredDiagnosticResult {
  assessmentId: string;
  studentDbId: string;
  progressComparison?: ProgressComparison;
  parentAssessmentId?: string;
}

function normalizeStudentName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function displayStudentName(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : "Student";
}

function gradeForStorage(classLevel: DiagnosticReport["classLevel"]) {
  return classLevel === "classKG" ? "kg" : classLevel.replace(/^class/, "");
}

function reportTopicForStorage(report: DiagnosticReport) {
  return report.mode === "grade" || report.mode === "multi_topic"
    ? null
    : report.topic;
}

function reportRegionForStorage(report: DiagnosticReport) {
  return report.mode === "placement"
    ? DEFAULT_DIAGNOSTIC_REGION
    : (report.region ?? DEFAULT_DIAGNOSTIC_REGION);
}

function questionJson(record: AskedQuestionRecord) {
  return JSON.stringify(record.question);
}

function correctCount(report: DiagnosticReport) {
  return report.results.filter((record) => record.verdict === "correct").length;
}

function asLearningObjectiveResults(value: unknown): LearningObjectiveResult[] {
  return Array.isArray(value) ? (value as LearningObjectiveResult[]) : [];
}

function bestImprovedLearningObjective(
  previous: LearningObjectiveResult[],
  current: LearningObjectiveResult[],
) {
  const previousByObjective = new Map(
    previous.map((result) => [result.learningObjective, result]),
  );

  return current
    .map((result) => {
      const previousResult = previousByObjective.get(result.learningObjective);
      return {
        learningObjective: result.learningObjective,
        delta: result.correctCount - (previousResult?.correctCount ?? 0),
        scoreDelta: result.score - (previousResult?.score ?? 0),
      };
    })
    .filter((result) => result.delta > 0 || result.scoreDelta > 0)
    .sort((left, right) => {
      if (right.delta !== left.delta) return right.delta - left.delta;
      return right.scoreDelta - left.scoreDelta;
    })[0]?.learningObjective;
}

async function getPreviousProgressComparison(input: {
  client: PoolClient;
  studentDbId: string;
  report: DiagnosticReport;
}): Promise<ProgressComparison | undefined> {
  const { client, report, studentDbId } = input;
  const topic = reportTopicForStorage(report);

  if (report.mode !== "topic" || !topic) return undefined;

  const previousResult = await client.query<{
    id: string;
    submitted_at: Date;
    total_questions_shown: number;
    learning_objective_results: unknown;
    correct_count: string;
  }>(
    `
      SELECT
        a.id::text,
        a.submitted_at,
        a.total_questions_shown,
        a.learning_objective_results,
        count(qr.id) FILTER (WHERE qr.verdict = 'correct')::int AS correct_count
      FROM public.diagnostic_assessments a
      LEFT JOIN public.diagnostic_question_results qr
        ON qr.assessment_id = a.id
      WHERE a.student_id = $1
        AND a.test_mode = 'topic'
        AND a.subject = $2
        AND a.class_level = $3
        AND a.topic = $4
        AND COALESCE(a.region, $5) = $5
      GROUP BY a.id
      ORDER BY a.submitted_at DESC
      LIMIT 1
    `,
    [
      studentDbId,
      report.subject,
      gradeForStorage(report.classLevel),
      topic,
      reportRegionForStorage(report),
    ],
  );
  const previous = previousResult.rows[0];
  if (!previous) return undefined;

  return {
    previousAssessmentId: previous.id,
    previousSubmittedAt: previous.submitted_at.toISOString(),
    previousCorrectCount: Number(previous.correct_count) || 0,
    previousTotalQuestions: previous.total_questions_shown,
    currentCorrectCount: correctCount(report),
    currentTotalQuestions: report.totalQuestionsShown,
    correctDelta: correctCount(report) - (Number(previous.correct_count) || 0),
    topic,
    improvedLearningObjective: bestImprovedLearningObjective(
      asLearningObjectiveResults(previous.learning_objective_results),
      report.learningObjectiveResults,
    ),
  };
}

export async function saveDiagnosticResult(
  report: DiagnosticReport,
  options?: { parentAssessmentId?: string },
): Promise<StoredDiagnosticResult> {
  const isCoding =
    report.subject === "coding-python" ||
    report.subject === "coding-webdev" ||
    report.subject === "Python" ||
    report.subject === "WebDev";

  if (isCoding) {
    return {
      assessmentId: `demo-coding-${Date.now()}`,
      studentDbId: `demo-student-${Date.now()}`,
      parentAssessmentId: options?.parentAssessmentId,
    };
  }

  const client = await pool.connect();
  const studentDisplayName = displayStudentName(report.studentId);
  const normalizedName = normalizeStudentName(studentDisplayName);
  const grade = gradeForStorage(report.classLevel);

  try {
    await client.query("BEGIN");

    const studentResult = await client.query<{ id: string }>(
      `
        INSERT INTO public.diagnostic_students (
          display_name,
          normalized_name,
          current_class_level,
          updated_at
        )
        VALUES ($1, $2, $3, now())
        ON CONFLICT (normalized_name)
        DO UPDATE SET
          display_name = EXCLUDED.display_name,
          current_class_level = EXCLUDED.current_class_level,
          updated_at = now()
        RETURNING id
      `,
      [studentDisplayName, normalizedName, grade],
    );
    const studentDbId = studentResult.rows[0].id;
    const progressComparison = await getPreviousProgressComparison({
      client,
      studentDbId,
      report,
    });

    const assessmentResult = await client.query<{ id: string }>(
      `
        INSERT INTO public.diagnostic_assessments (
          student_id,
          student_display_name,
          test_mode,
          subject,
          class_level,
          region,
          topic,
          readiness_score,
          attempted_readiness_score,
          overall_readiness_score,
          non_attempt_count,
          max_questions,
          total_questions_shown,
          question_bank_size,
          stopped_because,
          expected_learning_objectives,
          topic_results,
          learning_objective_results,
          subtopic_results,
          bloom_results,
          lesson_plan,
          distractor_insights,
          next_steps,
          engagement_gaps,
          behavioral_patterns,
          result_narrative,
          report_json,
          ai_summary,
          parent_assessment_id
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16::jsonb, $17::jsonb, $18::jsonb,
          $19::jsonb, $20::jsonb, $21::jsonb, $22::jsonb, $23::jsonb,
          $24::jsonb, $25::jsonb, $26::jsonb, $27::jsonb, $28, $29
        )
        RETURNING id
      `,
      [
        studentDbId,
        studentDisplayName,
        report.mode,
        report.subject,
        grade,
        reportRegionForStorage(report),
        reportTopicForStorage(report),
        report.readinessScore,
        report.attemptedReadinessScore ?? null,
        report.overallReadinessScore ?? null,
        report.nonAttemptCount ?? null,
        report.maxQuestions,
        report.totalQuestionsShown,
        report.questionBankSize,
        report.stoppedBecause,
        JSON.stringify(report.expectedLearningObjectives ?? []),
        JSON.stringify(report.topicResults ?? []),
        JSON.stringify(report.learningObjectiveResults ?? []),
        JSON.stringify(report.subtopicResults ?? []),
        JSON.stringify(report.bloomResults ?? []),
        JSON.stringify(report.lessonPlan ?? {}),
        JSON.stringify(report.distractorInsights ?? []),
        JSON.stringify(report.nextSteps ?? []),
        JSON.stringify(report.engagementGaps ?? []),
        JSON.stringify(report.behavioralPatterns ?? []),
        report.resultNarrative ? JSON.stringify(report.resultNarrative) : null,
        JSON.stringify(report),
        report.aiSummary,
        options?.parentAssessmentId ?? null,
      ],
    );
    const assessmentId = assessmentResult.rows[0].id;

    await client
      .query(
        `ALTER TABLE public.diagnostic_question_results ALTER COLUMN question_id TYPE text;`,
      )
      .catch(() => {});

    for (const [index, record] of report.results.entries()) {
      await client.query(
        `
          INSERT INTO public.diagnostic_question_results (
            assessment_id,
            question_id,
            question_order,
            question_text,
            question_type,
            topic,
            subtopic,
            learning_objective,
            bloom_level,
            difficulty_level,
            student_answer,
            verdict,
            feedback,
            why_wrong,
            time_taken_ms,
            allocated_time_ms,
            was_auto_skipped,
            question_snapshot,
            behavioral_signals,
            distractor_analysis
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16, $17, $18::jsonb,
            $19::jsonb, $20::jsonb
          )
        `,
        [
          assessmentId,
          record.question.id,
          index + 1,
          record.question.question,
          record.question.questionType,
          record.question.topic,
          record.question.subtopic ?? null,
          record.question.learningObjective ?? null,
          record.question.bloomLevel,
          record.question.difficultyLevel ?? null,
          record.studentAnswer,
          record.verdict,
          record.feedback,
          record.whyWrong ?? null,
          record.timeTakenMs ?? null,
          record.allocatedTimeMs ?? null,
          record.wasAutoSkipped === true,
          questionJson(record),
          JSON.stringify(record.behavioralSignals ?? []),
          record.distractorAnalysis
            ? JSON.stringify(record.distractorAnalysis)
            : null,
        ],
      );
    }

    await client.query("COMMIT");
    return {
      assessmentId,
      studentDbId,
      progressComparison,
      parentAssessmentId: options?.parentAssessmentId,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.warn("[diagnostic-results-store] Skipping DB storage due to error:", error);
    return {
      assessmentId: `demo-fallback-${Date.now()}`,
      studentDbId: `demo-student-${Date.now()}`,
      parentAssessmentId: options?.parentAssessmentId,
    };
  } finally {
    client.release();
  }
}

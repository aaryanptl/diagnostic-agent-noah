/**
 * Read-only export of every Vedic Math question version.
 *
 * The CSV contains every non-ID column from questions and question_versions,
 * plus resolved subject/topic/subtopic/learning-objective names. ID columns are
 * intentionally omitted.
 *
 * Run:
 *   .\node_modules\.bin\tsx.cmd scripts\export-vedic-math-question-bank.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Pool, type PoolConfig } from "pg";

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    process.env[key] = value;
  }
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function baseConfig(): PoolConfig {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (url) return { connectionString: url };
  return {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || "postgres",
    port: Number.parseInt(process.env.DB_PORT || "5432", 10),
  };
}

async function connect(): Promise<Pool> {
  const base = baseConfig();
  let lastError: unknown;
  for (const ssl of [{ rejectUnauthorized: false }, false] as const) {
    const pool = new Pool({
      ...base,
      ssl,
      connectionTimeoutMillis: 8000,
      max: 2,
    });
    try {
      await pool.query("SELECT 1");
      return pool;
    } catch (error) {
      lastError = error;
      await pool.end().catch(() => {});
    }
  }
  throw lastError ?? new Error("could not connect");
}

function isIdColumn(column: string): boolean {
  return column === "id" || column.endsWith("_id") || column === "external_id";
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text: string;
  if (value instanceof Date) text = value.toISOString();
  else if (typeof value === "object") text = JSON.stringify(value);
  else text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function valueForRow(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  return value;
}

async function main() {
  loadEnvLocal();
  const pool = await connect();
  const output = path.resolve(
    process.cwd(),
    "exports",
    "vedic-math-question-bank.csv",
  );

  try {
    const columnsResult = await pool.query<{
      table_name: string;
      column_name: string;
      ordinal_position: number;
    }>(
      `
      SELECT table_name, column_name, ordinal_position
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ANY($1)
      ORDER BY table_name, ordinal_position
      `,
      [["questions", "question_versions"]],
    );

    const questionColumns = columnsResult.rows
      .filter((row) => row.table_name === "questions")
      .map((row) => row.column_name);
    const versionColumns = columnsResult.rows
      .filter((row) => row.table_name === "question_versions")
      .map((row) => row.column_name);

    if (!questionColumns.length || !versionColumns.length) {
      throw new Error("questions or question_versions table was not found");
    }
    if (!versionColumns.includes("question_id")) {
      throw new Error("question_versions.question_id was not found");
    }

    const questionSelect = questionColumns.map(
      (column) =>
        `q.${quoteIdentifier(column)} AS ${quoteIdentifier(`question__${column}`)}`,
    );
    const versionSelect = versionColumns.map(
      (column) =>
        `qv.${quoteIdentifier(column)} AS ${quoteIdentifier(`version__${column}`)}`,
    );

    const result = await pool.query(
      `
      SELECT
        s.name AS __subject_name,
        t.name AS __topic_name,
        t.subject_label AS __topic_subject_label,
        t.grade AS __topic_grade,
        st.name AS __subtopic_name,
        COALESCE(NULLIF(lo.display_name, ''), lo.description) AS __learning_objective_name,
        lo.code AS __learning_objective_code,
        (q.current_version_id = qv.id) AS __is_current_version,
        ${[...questionSelect, ...versionSelect].join(",\n        ")}
      FROM public.questions q
      JOIN public.question_versions qv ON qv.question_id = q.id
      LEFT JOIN public.topics t ON t.id = q.topic_id
      LEFT JOIN public.subjects s ON s.id = t.subject_id
      LEFT JOIN public.subtopics st ON st.id = q.subtopic_id
      LEFT JOIN public.learning_objectives lo ON lo.id = q.learning_objective_id
      WHERE LOWER(t.name) LIKE '%vedic math%'
      ORDER BY
        t.grade,
        t.name,
        st.name NULLS FIRST,
        lo.code NULLS FIRST,
        q.id,
        qv.version_number,
        qv.id
      `,
    );

    const columns: string[] = [
      "subject",
      "topic",
      "topic_subject_label",
      "topic_grade",
      "subtopic",
      "learning_objective",
      "learning_objective_code",
      "is_current_version",
    ];
    const selectedKeys: string[] = [
      "__subject_name",
      "__topic_name",
      "__topic_subject_label",
      "__topic_grade",
      "__subtopic_name",
      "__learning_objective_name",
      "__learning_objective_code",
      "__is_current_version",
    ];

    for (const column of questionColumns) {
      if (isIdColumn(column)) continue;
      columns.push(`question_${column}`);
      selectedKeys.push(`question__${column}`);
    }
    for (const column of versionColumns) {
      if (isIdColumn(column)) continue;
      columns.push(`version_${column}`);
      selectedKeys.push(`version__${column}`);
    }

    const header = columns.join(",");
    const lines = [header];
    for (const row of result.rows) {
      lines.push(
        selectedKeys.map((key) => csvCell(valueForRow(row[key]))).join(","),
      );
    }

    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(output, `\uFEFF${lines.join("\n")}\n`, "utf8");

    const topicNames = [
      ...new Set(result.rows.map((row) => row.__topic_name).filter(Boolean)),
    ];
    const questionCount = new Set(
      result.rows.map((row) => row.question__id).filter(Boolean),
    ).size;
    console.log(`Source: ${process.env.DATABASE_URL ? "DATABASE_URL" : "DB_HOST vars"}`);
    console.log(`Topic match: ${topicNames.join(", ") || "none"}`);
    console.log(`Questions: ${questionCount}`);
    console.log(`Question versions / CSV rows: ${result.rows.length}`);
    console.log(`Columns: ${columns.length} (all non-ID fields from both tables plus resolved names)`);
    console.log(`Wrote: ${output}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Export failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});

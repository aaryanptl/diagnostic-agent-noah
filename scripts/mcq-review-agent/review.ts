import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { Agent, run } from "@openai/agents";
import { z } from "zod";

function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) return;
  const contents = readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const match = line
      .trim()
      .match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// Load the local env first, then the shared env. Existing process variables win,
// and .env.local wins over .env when both files define the same key.
loadEnvFile(path.resolve(process.cwd(), ".env.local"));
loadEnvFile(path.resolve(process.cwd(), ".env"));

const DEFAULT_INPUT = "files/mcq_fixed_final_uk_20p.csv";
const DEFAULT_REASON = "files/reason_mcq.csv";
const DEFAULT_LIMIT = 1_000;
const DEFAULT_MODEL = "gpt-5.6-luna";
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_CONCURRENCY = 3;

type CsvRow = Record<string, string>;
type SelectionStrategy = "first" | "spread" | "random";
type TokenUsage = {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputTokensDetails: Array<Record<string, number>>;
  outputTokensDetails: Array<Record<string, number>>;
  requestUsageEntries: Array<{
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    inputTokensDetails: Record<string, number>;
    outputTokensDetails: Record<string, number>;
    endpoint?: string;
  }>;
};

const optionSchema = z.object({
  text: z.string().min(1),
  correct: z.boolean(),
});

const correctedContentSchema = z.object({
  questionText: z.string().min(1),
  options: z.array(optionSchema).length(4),
  explanation: z.string().min(1),
});

const reviewOutputSchema = z.object({
  verdict: z.enum(["pass", "needs_review", "fail"]),
  confidence: z.enum(["high", "medium", "low"]),
  summary: z.string().min(1),
  issues: z.array(
    z.object({
      category: z.enum([
        "incorrect_answer",
        "ambiguous",
        "region_mismatch",
        "global_localization",
        "unit_or_currency_error",
        "question_option_mismatch",
        "explanation_mismatch",
        "duplicate_or_equivalent_option",
        "weird_value",
        "wording",
        "json_or_schema",
        "other",
      ]),
      severity: z.enum(["low", "medium", "high"]),
      detail: z.string().min(1),
    }),
  ),
  corrected: correctedContentSchema.nullable(),
});

type ReviewOutput = z.infer<typeof reviewOutputSchema>;

const reviewAgent = new Agent({
  name: "MCQ content reviewer",
  model: DEFAULT_MODEL,
  instructions: `
You are a meticulous educational MCQ reviewer.

Review one CSV MCQ row at a time. Check all of these:
1. The question is mathematically, factually, and grammatically correct and makes sense for the grade.
2. Exactly one option is correct. Reject ties, ambiguous answers, duplicate/equivalent options, and distractors that are also correct.
3. The question, options, correct flag, and explanation all agree. The explanation must actually justify the marked answer.
4. The question is region-aware. Regional rows must use the region's normal currency and units. Global rows must not use a regional currency or region-specific unit unless the question is explicitly about that region.
5. Flag strange values, impossible arithmetic, negative change, stale denomination references, or any other issue that would confuse a student.

Be conservative: use needs_review when the source is unclear instead of inventing a fix.
Do not change a valid computed total just because it equals a coin denomination. For example, a total of 25p made from 2x10p + 1x5p is valid; a question that claims a standard 25p UK coin is the denomination issue.

When verdict is pass, corrected must be null.
When verdict is fail and you can make a safe correction, return corrected with the complete corrected question text, exactly four options, exactly one correct=true, and a complete matching explanation. Keep the same educational intent and regional context. If a safe correction is not possible, return corrected as null.
When verdict is needs_review, usually return corrected as null.
Return only the structured output requested by the agent schema.
`,
  outputType: reviewOutputSchema,
});

function usage(): string {
  return `
MCQ reviewer

Review a configurable number of questions with the OpenAI Agents SDK.

Usage:
  pnpm exec tsx scripts/mcq-review-agent/review.ts [options]

Options:
  --input <path>          Input CSV. Default: ${DEFAULT_INPUT}
  --reason <path>         Optional reason CSV. Default: ${DEFAULT_REASON} when present
  --limit <number>        Number of rows to review. Default: ${DEFAULT_LIMIT}
  --offset <number>       Offset used by --first. Default: 0
  --selection <mode>      first | spread | random. Default: spread
  --seed <number>         Seed for random selection. Default: 42
  --batch-size <number>   Rows shown in each progress batch. Default: ${DEFAULT_BATCH_SIZE}
  --concurrency <number>  Concurrent agent calls. Default: ${DEFAULT_CONCURRENCY}
  --model <model>         Override the model. Default: ${DEFAULT_MODEL}
  --output-dir <path>     Report directory. Default: scripts/mcq-review-agent/out
  --fix                   Apply safe agent corrections to a new CSV
  --help                  Show this help

Environment:
  OPENAI_API_KEY          Required for review calls
`;
}

function parseArgs(argv: string[]) {
  const args = {
    input: DEFAULT_INPUT,
    reason: DEFAULT_REASON,
    limit: DEFAULT_LIMIT,
    offset: 0,
    selection: "spread" as SelectionStrategy,
    seed: 42,
    batchSize: DEFAULT_BATCH_SIZE,
    concurrency: DEFAULT_CONCURRENCY,
    model: DEFAULT_MODEL,
    outputDir: "scripts/mcq-review-agent/out",
    fix: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--fix") {
      args.fix = true;
      continue;
    }
    if (!arg.startsWith("--")) throw new Error(`Unknown argument: ${arg}`);

    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--"))
      throw new Error(`Missing value for ${arg}`);
    index += 1;

    if (key === "input") args.input = value;
    else if (key === "reason") args.reason = value;
    else if (key === "limit") args.limit = positiveInt(value, "limit");
    else if (key === "offset") args.offset = nonNegativeInt(value, "offset");
    else if (key === "selection") {
      if (!["first", "spread", "random"].includes(value))
        throw new Error("selection must be first, spread, or random");
      args.selection = value as SelectionStrategy;
    } else if (key === "seed") args.seed = Number(value);
    else if (key === "batch-size")
      args.batchSize = positiveInt(value, "batch-size");
    else if (key === "concurrency")
      args.concurrency = positiveInt(value, "concurrency");
    else if (key === "model") args.model = value;
    else if (key === "output-dir") args.outputDir = value;
    else throw new Error(`Unknown option: ${arg}`);
  }

  if (!Number.isFinite(args.seed)) throw new Error("seed must be a number");
  if (!process.env.OPENAI_API_KEY?.trim())
    throw new Error(
      "OPENAI_API_KEY is required. Set it before running the reviewer.",
    );
  return args;
}

function positiveInt(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function nonNegativeInt(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0)
    throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}

function resolveFromCwd(filePath: string): string {
  return path.resolve(process.cwd(), filePath);
}

async function readCsv(
  filePath: string,
): Promise<{ rows: CsvRow[]; headers: string[] }> {
  const text = await readFile(filePath, "utf8");
  const rows = parse(text, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    relax_column_count: false,
  }) as CsvRow[];
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  if (!headers.includes("id"))
    throw new Error(`${filePath} does not contain an id column`);
  return { rows, headers };
}

function parseOptions(
  row: CsvRow,
): { text: string; correct: boolean }[] | null {
  try {
    const parsed = JSON.parse(row.options ?? "");
    if (!Array.isArray(parsed)) return null;
    return parsed.map((option) => ({
      text: String(option.text ?? ""),
      correct: option.correct === true,
    }));
  } catch {
    return null;
  }
}

function currencyOrUnitMention(text: string): boolean {
  return /(?:[$€£₹¥]\s*\d|\b\d+(?:\.\d+)?\s*(?:dollars?|cents?|pounds?|pence|pennies|dirhams?|fils?|rupees?|aed|cad|aud|gbp|usd|inr|eur)\b|\b(?:dollars?|cents?|pounds?|pence|dirhams?|fils?|rupees?)\b)/i.test(
    text,
  );
}

function localPrecheck(
  row: CsvRow,
  options: { text: string; correct: boolean }[] | null,
): string[] {
  const issues: string[] = [];
  if (!row.question_text?.trim()) issues.push("question_text is blank");
  if ((row.question_type ?? "").toLowerCase() !== "mcq")
    issues.push("question_type is not mcq");
  if (!options) issues.push("options is not valid JSON");
  else {
    if (options.length !== 4)
      issues.push(`expected 4 options, found ${options.length}`);
    const correctCount = options.filter((option) => option.correct).length;
    if (correctCount !== 1)
      issues.push(`expected exactly 1 correct option, found ${correctCount}`);
    const normalized = options.map((option) =>
      option.text.trim().toLowerCase(),
    );
    if (new Set(normalized).size !== normalized.length)
      issues.push("duplicate option text");
  }
  if ((row.region ?? "").trim().toLowerCase() === "global") {
    const allText = [
      row.question_text,
      row.explanation,
      ...(options ?? []).map((option) => option.text),
    ].join(" ");
    if (currencyOrUnitMention(allText))
      issues.push(
        "global row contains a possible regional currency/unit mention",
      );
  }
  return issues;
}

function hashString(value: string, seed: number): number {
  let hash = 2166136261 ^ seed;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function selectRows(
  rows: CsvRow[],
  limit: number,
  strategy: SelectionStrategy,
  offset: number,
  seed: number,
): CsvRow[] {
  if (strategy === "first") return rows.slice(offset, offset + limit);
  if (strategy === "spread") {
    return [...rows]
      .sort(
        (left, right) =>
          hashString(left.id ?? "", seed) - hashString(right.id ?? "", seed),
      )
      .slice(0, limit);
  }

  const shuffled = [...rows];
  let state = seed >>> 0;
  const nextRandom = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(nextRandom() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }
  return shuffled.slice(0, limit);
}

function loadReasonIndex(rows: CsvRow[]): Map<string, CsvRow> {
  return new Map(rows.map((row) => [row.id, row]));
}

function makePrompt(
  row: CsvRow,
  options: { text: string; correct: boolean }[] | null,
  reason?: CsvRow,
  precheck?: string[],
) {
  return JSON.stringify({
    task: "Review this MCQ row and return the structured review result.",
    localPrecheck: precheck ?? [],
    row: {
      id: row.id,
      region: row.region || "unknown",
      subject: row.subject || "unknown",
      grade: row.grade || "unknown",
      topic: row.topic || "unknown",
      subtopic: row.subtopic || "unknown",
      difficulty: row.difficulty_level || row.difficulty_rating || "unknown",
      questionType: row.question_type,
      questionText: row.question_text,
      options,
      explanation: row.explanation,
      reasonContext: reason
        ? { fixed: reason.fixed, grade: reason.grade }
        : null,
    },
  });
}

function snapshotUsage(usage: {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputTokensDetails: Array<Record<string, number>>;
  outputTokensDetails: Array<Record<string, number>>;
  requestUsageEntries?: Array<{
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    inputTokensDetails: Record<string, number>;
    outputTokensDetails: Record<string, number>;
    endpoint?: string;
  }>;
}): TokenUsage {
  return {
    requests: usage.requests,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    inputTokensDetails: usage.inputTokensDetails,
    outputTokensDetails: usage.outputTokensDetails,
    requestUsageEntries: usage.requestUsageEntries ?? [],
  };
}

async function reviewOne(
  row: CsvRow,
  reason: CsvRow | undefined,
  model: string,
  maxAttempts = 3,
): Promise<{ review: ReviewOutput; usage: TokenUsage }> {
  const options = parseOptions(row);
  const precheck = localPrecheck(row, options);
  const agent =
    model === DEFAULT_MODEL ? reviewAgent : reviewAgent.clone({ model });
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await run(
        agent,
        makePrompt(row, options, reason, precheck),
      );
      return {
        review: reviewOutputSchema.parse(result.finalOutput),
        usage: snapshotUsage(result.state.usage),
      };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(2_000 * attempt, 6_000)),
      );
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function consume() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () =>
      consume(),
    ),
  );
  return results;
}

function safeCorrection(row: CsvRow, review: ReviewOutput): CsvRow | null {
  if (review.verdict !== "fail" || !review.corrected) return null;
  const corrected = review.corrected;
  if (corrected.options.filter((option) => option.correct).length !== 1)
    return null;
  const normalized = corrected.options.map((option) =>
    option.text.trim().toLowerCase(),
  );
  if (new Set(normalized).size !== normalized.length) return null;
  return {
    ...row,
    question_text: corrected.questionText,
    options: JSON.stringify(corrected.options),
    explanation: corrected.explanation,
  };
}

function csvEscape(value: string): string {
  const text = value ?? "";
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows: CsvRow[], headers: string[]): string {
  const lines = rows.map((row) =>
    headers.map((header) => csvEscape(row[header] ?? "")).join(","),
  );
  return `${headers.map(csvEscape).join(",")}\r\n${lines.join("\r\n")}\r\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = resolveFromCwd(args.input);
  const reasonPath = resolveFromCwd(args.reason);
  const outputDir = resolveFromCwd(args.outputDir);

  console.log(`Reading ${inputPath}`);
  const input = await readCsv(inputPath);
  let reasonIndex = new Map<string, CsvRow>();
  try {
    const reason = await readCsv(reasonPath);
    reasonIndex = loadReasonIndex(reason.rows);
    console.log(`Loaded ${reason.rows.length} reason rows`);
  } catch {
    console.log(`No reason CSV found at ${reasonPath}; continuing without it`);
  }

  const selected = selectRows(
    input.rows,
    args.limit,
    args.selection,
    args.offset,
    args.seed,
  );
  console.log(
    `Selected ${selected.length} of ${input.rows.length} rows using ${args.selection}`,
  );
  console.log(`Model: ${args.model}; concurrency: ${args.concurrency}`);

  const startedAt = new Date().toISOString();
  const results = await mapWithConcurrency(
    selected,
    args.concurrency,
    async (row, index) => {
      try {
        const review = await reviewOne(
          row,
          reasonIndex.get(row.id),
          args.model,
        );
        if ((index + 1) % args.batchSize === 0 || index === selected.length - 1)
          console.log(`Reviewed ${index + 1}/${selected.length}`);
        return { id: row.id, ...review, error: null as string | null };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Review failed for ${row.id}: ${message}`);
        return { id: row.id, review: null, usage: null, error: message };
      }
    },
  );

  await mkdir(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const resultPath = path.join(outputDir, `review-results-${timestamp}.jsonl`);
  const summaryPath = path.join(outputDir, `review-summary-${timestamp}.json`);
  await writeFile(
    resultPath,
    `${results.map((result) => JSON.stringify(result)).join("\n")}\n`,
    "utf8",
  );

  let appliedFixes = 0;
  let skippedFixes = 0;
  const tokenUsage = results.reduce<TokenUsage>(
    (total, result) => {
      if (!result.usage) return total;
      total.requests += result.usage.requests;
      total.inputTokens += result.usage.inputTokens;
      total.outputTokens += result.usage.outputTokens;
      total.totalTokens += result.usage.totalTokens;
      total.inputTokensDetails.push(...result.usage.inputTokensDetails);
      total.outputTokensDetails.push(...result.usage.outputTokensDetails);
      total.requestUsageEntries.push(...result.usage.requestUsageEntries);
      return total;
    },
    {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      inputTokensDetails: [],
      outputTokensDetails: [],
      requestUsageEntries: [],
    },
  );
  if (args.fix) {
    const byId = new Map(results.map((result) => [result.id, result.review]));
    const fixedRows = input.rows.map((row) => {
      const review = byId.get(row.id);
      if (!review) return row;
      const corrected = safeCorrection(row, review);
      if (corrected) {
        appliedFixes += 1;
        return corrected;
      }
      if (review.verdict === "fail") skippedFixes += 1;
      return row;
    });
    const inputExtension = path.extname(inputPath) || ".csv";
    const fixedPath = path.join(
      outputDir,
      `${path.basename(inputPath, inputExtension)}.reviewed${inputExtension}`,
    );
    await writeFile(fixedPath, toCsv(fixedRows, input.headers), "utf8");
    console.log(`Fixed CSV: ${fixedPath}`);
  }

  const summary = {
    input: inputPath,
    totalRows: input.rows.length,
    selectedRows: selected.length,
    selection: args.selection,
    limit: args.limit,
    offset: args.offset,
    model: args.model,
    startedAt,
    finishedAt: new Date().toISOString(),
    pass: results.filter((result) => result.review?.verdict === "pass").length,
    needsReview: results.filter(
      (result) => result.review?.verdict === "needs_review",
    ).length,
    fail: results.filter((result) => result.review?.verdict === "fail").length,
    requestErrors: results.filter((result) => result.error).length,
    appliedFixes,
    skippedFixes,
    tokenUsage,
    resultPath,
  };
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(`Results: ${resultPath}`);
  console.log(`Summary: ${summaryPath}`);
  console.log(`Completed: ${summary.pass} pass, ${summary.needsReview} needs review, ${summary.fail} fail`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Agent, run } from "@openai/agents";
import { parse } from "csv-parse/sync";
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
type VisualScope = "nonvisual" | "visual" | "all";
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
        "visual_asset_mismatch",
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

Review one CSV MCQ row at a time. Do a strict semantic coherence and language-quality review, not just an answer-key check.

For every row, work through this checklist before choosing pass:
1. Restate the task in plain language. Confirm the question has a clear subject, action, comparison, and requested answer for the stated grade.
2. Perform a full awkward-language audit. Read the question as a teacher reading it aloud to the stated grade. Check sentence structure, grammar, singular/plural agreement, articles, countable nouns, subject-verb agreement, adjective order, punctuation, fragments, unnatural collocations, vague pronouns, unclear references, unnecessary repetition, strange story framing, and words that do not fit the learning task. Flag wording that a teacher would naturally rewrite, even when a student could guess the intended meaning.
3. Check every fact, noun, adjective, quantity, label, and relationship in the question. Also flag wording that is vague, internally contradictory, dependent on an undefined group, object, rule, or visual, or unclear about whether an object belongs in or is excluded from a group.
4. Check the option set against the question's meaning. Exactly one option must answer the question. Reject ties, ambiguous answers, duplicate/equivalent options, and distractors that are also correct.
5. Check option grounding. If the question describes an exact collection or list of objects, an option that introduces an object not in that collection is a mismatch unless the question explicitly asks for a possible new candidate. If the options are hypothetical candidates, the question must make that clear.
6. Check the explanation against both the question and the options. It must explain why the marked option is correct, use the same facts and units, and not contain filler, unsupported claims, or reasoning for a different question.
7. Check that question text, options, correct flags, and explanation form one coherent educational item. Do not return pass merely because one option can be inferred or the arithmetic happens to be correct.
8. Check for answer restatement. The question must not directly state the answer and then ask the student to repeat it. For example, "A scarf is 7 linking cubes long. How many linking cubes long is the scarf?" is a wording and assessment-quality failure because the answer is already given. Do not pass a question merely because the answer and explanation are consistent.
9. Check the visual context supplied with the row. An actual embedded visual is present when the row contains SVG markup such as "<svg ...>". Inline emoji or repeated Unicode symbols in the question are also available text-embedded visual data; for example, repeated fish emoji can form a self-contained pictograph even when question_svg is blank. A visual_mode value of "question_svg" without SVG markup and without an inline text visual means the visual asset is missing.
10. If there is no embedded SVG or inline text visual, decide semantically whether the wording refers to an unavailable page, picture, figure, diagram, chart, number line, sticker collection, or visual movement. Do not rely only on exact keywords. Rewrite visual framing when the text can be made self-contained from the facts already present. If it cannot be made self-contained safely, use needs_review with corrected as null.
11. For mixed-unit comparisons and conversions, reason about the relationship between the units and the learner's required action. This applies to any values, currencies, or measurement units, not just familiar examples. A phrase such as "change one of them" or "compare after changing" is too vague when the question does not identify which amount or measurement to convert and the target unit. The question must say what to convert and into which unit, or state that both amounts should be written in the same unit. Do not pass just because the explanation silently performs the missing conversion. This is a semantic judgment: do not rely on fixed numbers, currency symbols, or keyword matching.

Use this failure pattern as a concrete guide: if the question says a page contains a big purple heart, a small purple heart, and a big purple star, then an option "small yellow heart" is not one of the described objects. Flag the mismatch, and either add the missing object to the question or rewrite the task as an attribute question such as which object is big, purple, and heart-shaped. If the page is not represented by an SVG, remove the page-dependent framing.

Use this grammar failure pattern too: "These shapes are big blue circle, big blue circle, and small blue circle" is not acceptable because the count and noun forms do not agree. Rewrite it as "There are three shapes: two big blue circles and one small blue circle." Mark the original as a wording issue even though its intended meaning is understandable.

Use this pictograph wording pattern too: "Choose the label that matches 2 in this pictograph of little fish bowls" is awkward because it makes the learner match a number to an unexplained label. When the displayed data already names the bowls, rewrite it as "Which bowl has 2 fish?" Keep the options and explanation consistent, and do not flag the item merely because the fish are inline emoji instead of SVG.

Use this assessment-quality failure pattern too: if the stem says an object's exact measurement, count, or label and then asks for that same value, flag it as a wording issue. A correction must create a real question rather than simply repeating the same fact with different words. Only return corrected as null when the source truly lacks enough information for any safe correction.

Use this group-membership failure pattern too: "Bus, car, and train. A cake is left out." is not precise enough for a sorting question. "Left out" could mean omitted, forgotten, or physically outside the group. Rewrite it with explicit membership, such as "Bus, car, and train are in a group. A cake is not in the group. Which rule describes the group?" Keep the options and explanation consistent with the clearer wording.

Use this mixed-unit failure pattern too: when a question compares values expressed in different units and says only "change one of them" or gives another vague conversion instruction, flag it even when the numbers and units are different from the example. Rewrite it by naming the exact value to convert and the target unit, then keep the comparison options and explanation aligned with that explicit conversion.

Language-quality gate: pass only when the question sounds natural when read aloud, is concise, uses age-appropriate words, and clearly tells the learner what to do. Meaning that can be guessed is not enough. Flag generated-sounding constructions such as "Choose the sentence that is correct about this sorted group", "Compare these choices for a kitten", "A tiny path is 1 footstep longer than that", or "Which group name fits the matching shapes" when a simpler teacher-written sentence would be clearer. For a wording issue, return a corrected full bundle that improves the language without making the answer easier or changing the learning objective.

For an answer-restatement failure, do not stop at corrected null when the row contains a usable measurement, count, label, or set of options. Create a new, age-appropriate question that tests a small inference using the available facts, and update all four options and the explanation as needed. For example, a stated 7-cube length can become a comparison or one-step change question using a clearly stated second length. The corrected question must not repeat the answer.

Correction quality gate: the corrected question must not reveal the correct answer. Do not put the exact correct option, its defining attribute combination, or a direct answer phrase into the question. Do not repair an ambiguous item by turning it into an obvious definition question. For example, if the correct option is "kitten", do not write "Which choice is the same kind of animal as the example: kitten?" If the existing options cannot support a clear, non-leading question, redesign the option set and explanation as part of the complete corrected bundle while preserving the learning objective. Do not return needs_review merely because the options need to change. Use needs_review only when the source does not contain enough information for a safe correction or the intended learning objective cannot be determined.

Be conservative: use needs_review when the source is unclear instead of inventing a fix.
Do not change a valid computed total just because it equals a coin denomination. For example, a total of 25p made from 2x10p + 1x5p is valid; a question that claims a standard 25p UK coin is the denomination issue.

When verdict is pass, corrected must be null.
When verdict is fail and the issue is clear, return corrected as a complete corrected bundle: question text, exactly four options, exactly one correct=true, and a complete matching explanation. If the question changes, update any dependent options or explanation so all three fields remain consistent. You may replace distractors or change the correct option when necessary to create a fair, non-leading MCQ, but preserve the educational intent and regional context. Even when only the wording needs changing, return the complete bundle with the unchanged options and explanation included. Use corrected as null only when the source does not contain enough information for a safe correction.
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
  --offset <number>       Zero-based source CSV row offset used by --first. Default: 0
  --source-start <number> Zero-based source row range start (inclusive)
  --source-end <number>   Zero-based source row range end (exclusive)
  --selection <mode>      first | spread | random. Default: spread
  --seed <number>         Seed for random selection. Default: 42
  --pool-size <number>    Only sample from the first N input rows
  --batch-size <number>   Rows shown in each progress batch. Default: ${DEFAULT_BATCH_SIZE}
  --concurrency <number>  Concurrent agent calls. Default: ${DEFAULT_CONCURRENCY}
  --model <model>         Override the model. Default: ${DEFAULT_MODEL}
  --output-dir <path>     Report directory. Default: scripts/mcq-review-agent/out
  --apply-report <path>   Apply an existing JSONL report; repeatable
  --output <path>         Corrected CSV output path for --apply-report
  --include-visual        Include question_svg and option_svg rows
  --visual-only           Review only question_svg and option_svg rows
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
    sourceStart: null as number | null,
    sourceEnd: null as number | null,
    selection: "spread" as SelectionStrategy,
    seed: 42,
    poolSize: null as number | null,
    batchSize: DEFAULT_BATCH_SIZE,
    concurrency: DEFAULT_CONCURRENCY,
    model: DEFAULT_MODEL,
    outputDir: "scripts/mcq-review-agent/out",
    applyReports: [] as string[],
    outputPath: null as string | null,
    visualScope: "nonvisual" as VisualScope,
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
    if (arg === "--include-visual") {
      args.visualScope = "all";
      continue;
    }
    if (arg === "--visual-only") {
      args.visualScope = "visual";
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
    else if (key === "source-start")
      args.sourceStart = nonNegativeInt(value, "source-start");
    else if (key === "source-end")
      args.sourceEnd = nonNegativeInt(value, "source-end");
    else if (key === "selection") {
      if (!["first", "spread", "random"].includes(value))
        throw new Error("selection must be first, spread, or random");
      args.selection = value as SelectionStrategy;
    } else if (key === "seed") args.seed = Number(value);
    else if (key === "pool-size")
      args.poolSize = positiveInt(value, "pool-size");
    else if (key === "batch-size")
      args.batchSize = positiveInt(value, "batch-size");
    else if (key === "concurrency")
      args.concurrency = positiveInt(value, "concurrency");
    else if (key === "model") args.model = value;
    else if (key === "output-dir") args.outputDir = value;
    else if (key === "apply-report") args.applyReports.push(value);
    else if (key === "output") args.outputPath = value;
    else throw new Error(`Unknown option: ${arg}`);
  }

  if (!Number.isFinite(args.seed)) throw new Error("seed must be a number");
  if ((args.sourceStart === null) !== (args.sourceEnd === null))
    throw new Error("source-start and source-end must be provided together");
  if (
    args.sourceStart !== null &&
    args.sourceEnd !== null &&
    args.sourceEnd <= args.sourceStart
  )
    throw new Error("source-end must be greater than source-start");
  if (
    args.sourceStart !== null &&
    (args.offset !== 0 || args.poolSize !== null)
  )
    throw new Error(
      "source-start/source-end cannot be combined with offset or pool-size",
    );
  if (args.applyReports.length > 0 && !args.outputPath)
    throw new Error("--output is required when using --apply-report");
  if (args.applyReports.length === 0 && args.outputPath)
    throw new Error("--output can only be used with --apply-report");
  if (args.applyReports.length > 0) return args;
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

const VISUAL_REFERENCE_PATTERN =
  /\b(?:look\s+at|look\s+closely|shown|shows|picture|image|figure|diagram|illustration|chart|graph|table|pictograph|number\s+line|sticker\s+trail)\b/gi;

const INLINE_TEXT_VISUAL_PATTERN = /[\u{1f000}-\u{1faff}\u{2600}-\u{27bf}]/u;

type VisualContext = {
  hasEmbeddedSvg: boolean;
  hasInlineTextVisual: boolean;
  svgFields: string[];
  declaredVisualMode: string | null;
  questionTextVisualReferences: string[];
};

function declaredVisualMode(row: CsvRow): string | null {
  const direct = row.visual_mode?.trim();
  if (direct) return direct;

  const metadata = row.generation_metadata?.trim();
  if (!metadata) return null;
  const match = metadata.match(
    /["'](?:visualMode|visual_mode)["']\s*:\s*["']([^"']+)["']/i,
  );
  return match?.[1] ?? null;
}

function extractVisualReferences(text: string): string[] {
  return [...(text.match(VISUAL_REFERENCE_PATTERN) ?? [])].map((value) =>
    value.toLowerCase(),
  );
}

function getVisualContext(row: CsvRow): VisualContext {
  const allValues = Object.values(row);
  const svgFields = Object.entries(row)
    .filter(([, value]) => /<svg\b/i.test(value ?? ""))
    .map(([field]) => field);
  const questionTextVisualReferences = extractVisualReferences(
    row.question_text ?? "",
  );

  return {
    hasEmbeddedSvg: svgFields.length > 0,
    hasInlineTextVisual: allValues.some((value) =>
      INLINE_TEXT_VISUAL_PATTERN.test(value ?? ""),
    ),
    svgFields,
    declaredVisualMode: declaredVisualMode(row),
    questionTextVisualReferences: [...new Set(questionTextVisualReferences)],
  };
}

function isVisualModeRow(row: CsvRow): boolean {
  const mode = declaredVisualMode(row)?.toLowerCase();
  return mode === "question_svg" || mode === "option_svg";
}

function matchesVisualScope(row: CsvRow, scope: VisualScope): boolean {
  if (scope === "all") return true;
  return scope === "visual" ? isVisualModeRow(row) : !isVisualModeRow(row);
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
  const visual = getVisualContext(row);
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
  if (
    !visual.hasEmbeddedSvg &&
    !visual.hasInlineTextVisual &&
    visual.questionTextVisualReferences.length > 0
  )
    issues.push(
      `question text references visual content (${visual.questionTextVisualReferences.join(", ")}) but no embedded SVG was found`,
    );
  if (
    !visual.hasEmbeddedSvg &&
    visual.declaredVisualMode?.toLowerCase() === "question_svg"
  )
    issues.push(
      "visual mode declares question_svg but no embedded SVG was found",
    );
  const correctOption = options?.find((option) => option.correct);
  if (correctOption) {
    const questionText = normalizedComparableText(row.question_text ?? "");
    const correctText = normalizedComparableText(correctOption.text);
    if (
      correctText.length >= 3 &&
      /[a-z]/i.test(correctText) &&
      questionText.includes(correctText)
    )
      issues.push(
        "question text appears to state the marked answer directly; check for an answer-restatement question",
      );
  }
  if (
    /\bleft\s+out\b/i.test(row.question_text ?? "") &&
    /\b(?:group|sorted|sorting|rule)\b/i.test(row.question_text ?? "")
  )
    issues.push(
      "sorting question uses ambiguous group-membership wording: replace 'left out' with explicit in-group or not-in-group language",
    );
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
  const visual = getVisualContext(row);
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
      questionSvg: row.question_svg || null,
      visualMode: row.visual_mode || null,
      visualContext: visual,
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
): Promise<{ review: ReviewOutput; usage: TokenUsage }> {
  const options = parseOptions(row);
  const precheck = localPrecheck(row, options);
  const agent =
    model === DEFAULT_MODEL ? reviewAgent : reviewAgent.clone({ model });
  const result = await run(agent, makePrompt(row, options, reason, precheck));
  return {
    review: sanitizeReview(reviewOutputSchema.parse(result.finalOutput)),
    usage: snapshotUsage(result.state.usage),
  };
}

function normalizedComparableText(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gi, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function correctionRevealsAnswer(
  corrected: ReviewOutput["corrected"],
): boolean {
  if (!corrected) return false;
  const correctOption = corrected.options.find((option) => option.correct);
  if (!correctOption) return false;
  const answer = normalizedComparableText(correctOption.text);
  if (answer.length < 3 || /^\d+(?:\.\d+)?$/.test(answer)) return false;

  // A correct option can legitimately appear as a neutral data label in a
  // table or pictograph, such as `Bowl C: 🐟🐟`. Remove only that label form
  // before checking for an answer statement; do not remove ordinary mentions.
  const rawAnswer = correctOption.text.trim();
  const labelPattern = new RegExp(
    `(^|[\\n,;.])\\s*${escapeRegExp(rawAnswer)}\\s*[:：]`,
    "giu",
  );
  const questionWithoutDataLabel = corrected.questionText.replace(
    labelPattern,
    "$1",
  );
  return normalizedComparableText(questionWithoutDataLabel).includes(answer);
}

function sanitizeReview(review: ReviewOutput): ReviewOutput {
  if (!correctionRevealsAnswer(review.corrected)) return review;
  return {
    ...review,
    corrected: null,
    summary: `${review.summary} The proposed correction revealed the correct option, so no automatic correction is safe.`,
    issues: [
      ...review.issues,
      {
        category: "wording",
        severity: "high",
        detail:
          "The proposed corrected question contains the correct option or its defining answer phrase and would give away the answer.",
      },
    ],
  };
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
  const visual = getVisualContext(row);

  // A missing visual must not survive a correction. The full corrected bundle
  // is still validated below so dependent options and explanations can change.
  if (
    !visual.hasEmbeddedSvg &&
    visual.questionTextVisualReferences.length > 0 &&
    extractVisualReferences(corrected.questionText).length > 0
  ) {
    return null;
  }
  if (correctionRevealsAnswer(corrected)) return null;

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
  // Excel uses the UTF-8 BOM to detect UTF-8 CSV files instead of opening
  // them as a legacy Windows code page.
  return `\uFEFF${headers.map(csvEscape).join(",")}\r\n${lines.join("\r\n")}\r\n`;
}

type ReportEntry = {
  review: ReviewOutput | null;
  error: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readReviewReports(
  reportPaths: string[],
): Promise<Map<string, ReportEntry>> {
  const entries = new Map<string, ReportEntry>();
  for (const reportPath of reportPaths) {
    const resolvedPath = resolveFromCwd(reportPath);
    const contents = await readFile(resolvedPath, "utf8");
    const lines = contents.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (!line) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        throw new Error(
          `Invalid JSON in ${resolvedPath} at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (!isRecord(parsed) || typeof parsed.id !== "string")
        throw new Error(
          `Invalid review item in ${resolvedPath} at line ${index + 1}: id is required`,
        );
      if (entries.has(parsed.id))
        throw new Error(
          `Duplicate review ID ${parsed.id} found in ${resolvedPath}; refuse to choose between reports`,
        );

      const errorMessage =
        typeof parsed.error === "string" ? parsed.error : null;
      let review: ReviewOutput | null = null;
      if (parsed.review !== null && parsed.review !== undefined)
        review = reviewOutputSchema.parse(parsed.review);
      entries.set(parsed.id, { review, error: errorMessage });
    }
  }
  return entries;
}

async function applyReviewReports(
  inputPath: string,
  reportPaths: string[],
  outputPath: string,
) {
  const input = await readCsv(inputPath);
  const reports = await readReviewReports(reportPaths);
  const inputIds = new Set(input.rows.map((row) => row.id));
  const unknownReportIds = [...reports.keys()].filter(
    (id) => !inputIds.has(id),
  );
  if (unknownReportIds.length > 0)
    throw new Error(
      `${unknownReportIds.length} report IDs were not found in the input CSV; refuse to create a partial mismatch`,
    );

  let applied = 0;
  let skippedFails = 0;
  let pass = 0;
  let needsReview = 0;
  let requestErrors = 0;
  const updatedColumn = "review_updated";
  const fixedRows = input.rows.map((row) => {
    const entry = reports.get(row.id);
    if (!entry) return { ...row, [updatedColumn]: "false" };
    if (!entry.review) {
      if (entry.error) requestErrors += 1;
      return { ...row, [updatedColumn]: "false" };
    }
    if (entry.review.verdict === "pass") pass += 1;
    if (entry.review.verdict === "needs_review") needsReview += 1;
    const corrected = safeCorrection(row, entry.review);
    if (corrected) {
      applied += 1;
      return { ...corrected, [updatedColumn]: "true" };
    }
    if (entry.review.verdict === "fail") skippedFails += 1;
    return { ...row, [updatedColumn]: "false" };
  });

  const resolvedOutputPath = resolveFromCwd(outputPath);
  await mkdir(path.dirname(resolvedOutputPath), { recursive: true });
  const outputHeaders = input.headers.includes(updatedColumn)
    ? input.headers
    : [...input.headers, updatedColumn];
  await writeFile(resolvedOutputPath, toCsv(fixedRows, outputHeaders), "utf8");
  console.log(`Applied reports: ${reportPaths.length}`);
  console.log(`Report rows: ${reports.size}`);
  console.log(`Applied corrections: ${applied}`);
  console.log(`Skipped fail corrections: ${skippedFails}`);
  console.log(
    `Pass: ${pass}; needs review: ${needsReview}; request errors: ${requestErrors}`,
  );
  console.log(`Corrected CSV: ${resolvedOutputPath}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = resolveFromCwd(args.input);
  if (args.applyReports.length > 0) {
    await applyReviewReports(
      inputPath,
      args.applyReports,
      args.outputPath as string,
    );
    return;
  }
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

  const sourceStart = args.sourceStart ?? 0;
  const sourceEnd =
    args.sourceEnd ??
    (args.poolSize === null ? input.rows.length : args.poolSize);
  const sourcePool = input.rows.slice(sourceStart, sourceEnd);
  const visualRows = sourcePool.filter(isVisualModeRow);
  const reviewPool = sourcePool.filter((row) =>
    matchesVisualScope(row, args.visualScope),
  );
  // `--offset` is a source CSV row offset, not an offset into the filtered
  // non-visual pool. This keeps a sheet row and a CSV row pointing to the same
  // question even when visual rows before it are skipped.
  const selected =
    args.selection === "first"
      ? sourcePool
          .slice(args.offset)
          .filter((row) => matchesVisualScope(row, args.visualScope))
          .slice(0, args.limit)
      : selectRows(reviewPool, args.limit, args.selection, 0, args.seed);
  console.log(
    `Selected ${selected.length} of ${reviewPool.length} ${args.visualScope} rows using ${args.selection} from source rows ${sourceStart}-${sourceEnd}`,
  );
  console.log(
    `Sampling pool: source rows ${sourceStart}-${sourceEnd}; visual rows: ${visualRows.length}; excluded from this run: ${args.visualScope === "nonvisual" ? visualRows.length : 0}`,
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
        return {
          id: row.id,
          ...review,
          error: null as string | null,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Review failed for ${row.id}: ${message}`);
        return {
          id: row.id,
          review: null,
          usage: null,
          error: message,
        };
      }
    },
  );

  await mkdir(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const rangeLabel = `${sourceStart}-${sourceEnd}`;
  const resultPath = path.join(
    outputDir,
    `review-results-rows-${rangeLabel}-${timestamp}.jsonl`,
  );
  const summaryPath = path.join(
    outputDir,
    `review-summary-rows-${rangeLabel}-${timestamp}.json`,
  );
  const jsonlResults = results.map((result) => ({
    id: result.id,
    review: result.review,
    ...(result.error ? { error: result.error } : {}),
  }));
  await writeFile(
    resultPath,
    `${jsonlResults.map((result) => JSON.stringify(result)).join("\n")}\n`,
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
    sourceStart,
    sourceEnd,
    sourcePoolRows: sourcePool.length,
    poolSize: args.poolSize,
    visualRows: visualRows.length,
    excludedVisualRows:
      args.visualScope === "nonvisual" ? visualRows.length : 0,
    reviewPoolRows: reviewPool.length,
    selectedRows: selected.length,
    visualScope: args.visualScope,
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
  console.log(
    `Completed: ${summary.pass} pass, ${summary.needsReview} needs review, ${summary.fail} fail`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

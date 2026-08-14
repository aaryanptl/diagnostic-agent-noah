# MCQ review agent

This folder contains a configurable semantic reviewer for the MCQ CSV files.

It uses the OpenAI Agents SDK with `gpt-luna-5.6` by default. The source CSV is never overwritten.

## What it checks

- question correctness and grade-level sense
- semantic coherence across the question, option set, and explanation
- full language-quality review for awkward, unnatural, vague, or grade-inappropriate wording
- answer-restatement questions where the stem already gives the answer
- ambiguous group-membership wording such as “left out” in sorting questions
- exactly one correct answer
- question/options/explanation consistency
- regional currency and unit usage
- global rows accidentally containing regional currency or units
- duplicate/equivalent options
- weird values, impossible arithmetic, and confusing wording
- visual/SVG consistency, including wording that refers to a missing picture, figure, diagram, chart, number line, or sticker trail
- local CSV/JSON integrity before the model call

The optional reason CSV is loaded by ID and passed to the agent as context. This lets the reviewer understand why a row was previously changed.

## Review only

From the repository root, run a 1,000-row review. The script automatically loads `OPENAI_API_KEY` from `.env.local` first, then `.env`:

```powershell
pnpm exec tsx scripts/mcq-review-agent/review.ts --limit 1000
```

By default, rows whose `visual_mode` is `question_svg` or `option_svg` are skipped. Review those rows separately with:

```powershell
pnpm exec tsx scripts/mcq-review-agent/review.ts --visual-only --limit 1000
```

Use `--include-visual` when you want the normal review to include every row.

The default input is `files/mcq_fixed_final_uk_20p.csv` and the default reason file is `files/reason_mcq.csv` when it exists.

The default `spread` selection distributes rows across the whole CSV instead of taking only the first region. Other options:

```powershell
# first 5,000 rows
pnpm exec tsx scripts/mcq-review-agent/review.ts --limit 5000 --selection first

# deterministic 50,000-row sample
pnpm exec tsx scripts/mcq-review-agent/review.ts --limit 50000 --seed 42

# 20 random questions from the first 1,000 data rows
pnpm exec tsx scripts/mcq-review-agent/review.ts --pool-size 1000 --selection random --limit 20 --seed 42
```

For `--selection first`, `--offset` is zero-based against the original source
CSV data rows. Visual rows skipped by the default non-visual scope do not shift
the offset. If a spreadsheet includes a header row, use `spreadsheet row - 2`.

To review exact source-row ranges, use `--source-start` inclusive and
`--source-end` exclusive. These are zero-based data-row indexes, so the ranges
below review the first 10,000 data rows while skipping visual rows:

```powershell
.\node_modules\.bin\tsx.CMD scripts/mcq-review-agent/review.ts --selection first --source-start 0 --source-end 1000 --limit 1000
.\node_modules\.bin\tsx.CMD scripts/mcq-review-agent/review.ts --selection first --source-start 1000 --source-end 5000 --limit 4000
.\node_modules\.bin\tsx.CMD scripts/mcq-review-agent/review.ts --selection first --source-start 5000 --source-end 10000 --limit 5000
```

Visual rows are excluded by default. Do not add `--include-visual` or
`--visual-only` for this run. The JSONL files include the source range in their
names, for example `review-results-rows-0-1000-<timestamp>.jsonl`.

Reports are written to `scripts/mcq-review-agent/out/` as JSONL results and a JSON summary. Each JSONL item contains only the row ID, review result, and an error when applicable. Token usage and run-level details stay in the JSON summary.

Each selected row makes one model request. The reviewer uses the full semantic and language-quality rules in that single prompt; it does not retry correction or failed requests.

## Apply existing JSONL reports to a new CSV

After reviewing, apply the existing JSONL without making new AI calls:

```powershell
pnpm exec tsx scripts/mcq-review-agent/review.ts `
  --input files/mcq_fixed_final_uk_20p.csv `
  --apply-report scripts/mcq-review-agent/out/review-results-rows-0-1000-<timestamp>.jsonl `
  --output files/mcq_import_ready_0_1000.csv
```

Repeat `--apply-report` for additional JSONL files. The applier matches by ID,
applies only safe `fail` corrections, and leaves passes, unresolved failures,
needs-review rows, and request errors unchanged. It refuses unknown or duplicate
report IDs. The generated CSV includes `review_updated=true` only for rows where
a correction was applied; all other rows are marked `false`. Remove this
tracking column before importing if the AWS DB importer requires the original
CSV schema.

The reviewer checks all CSV fields for embedded `<svg>` markup and also recognizes inline emoji or repeated Unicode symbols used as text-based pictographs. It passes this visual context to the agent. If a non-visual question uses wording that depends on an unavailable visual, such as "look at the picture" or "in two jumps," the agent can rewrite the question using only facts already present in the text. Every applied correction is a complete question bundle: `question_text`, `options`, and `explanation` are updated together whenever one field depends on another.

## Review and create a corrected copy

Use `--fix` only after checking the review report:

```powershell
pnpm exec tsx scripts/mcq-review-agent/review.ts --limit 1000 --fix
```

This writes a new `.reviewed.csv` in the report folder. It only applies model corrections that contain exactly four unique options and exactly one correct option. Rows marked `needs_review`, rows with no safe correction, and request failures stay unchanged.

Automatic corrections are also rejected when the rewritten question contains the exact correct option or directly gives away its defining answer phrase. Those rows remain flagged for manual review instead of receiving an easier question.

## Important

`gpt-luna-5.6` is the requested default model string. The API account must have access to that model. If the provider exposes a different model ID, pass it explicitly with `--model`.

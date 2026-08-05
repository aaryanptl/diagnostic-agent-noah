# MCQ review agent

This folder contains a configurable semantic reviewer for the MCQ CSV files.

It uses the OpenAI Agents SDK with `gpt-luna-5.6` by default. The source CSV is never overwritten.

## What it checks

- question correctness and grade-level sense
- exactly one correct answer
- question/options/explanation consistency
- regional currency and unit usage
- global rows accidentally containing regional currency or units
- duplicate/equivalent options
- weird values, impossible arithmetic, and confusing wording
- local CSV/JSON integrity before the model call

The optional reason CSV is loaded by ID and passed to the agent as context. This lets the reviewer understand why a row was previously changed.

## Review only

From the repository root, run a 1,000-row review. The script automatically loads `OPENAI_API_KEY` from `.env.local` first, then `.env`:

```powershell
pnpm exec tsx scripts/mcq-review-agent/review.ts --limit 1000
```

The default input is `files/mcq_fixed_final_uk_20p.csv` and the default reason file is `files/reason_mcq.csv` when it exists.

The default `spread` selection distributes rows across the whole CSV instead of taking only the first region. Other options:

```powershell
# first 5,000 rows
pnpm exec tsx scripts/mcq-review-agent/review.ts --limit 5000 --selection first

# deterministic 50,000-row sample
pnpm exec tsx scripts/mcq-review-agent/review.ts --limit 50000 --seed 42
```

Reports are written to `scripts/mcq-review-agent/out/` as JSONL results and a JSON summary. Each result includes `usage` with request count, input tokens, output tokens, total tokens, token details, and per-request usage entries. The summary includes totals for the full run.

## Review and create a corrected copy

Use `--fix` only after checking the review report:

```powershell
pnpm exec tsx scripts/mcq-review-agent/review.ts --limit 1000 --fix
```

This writes a new `.reviewed.csv` in the report folder. It only applies model corrections that contain exactly four unique options and exactly one correct option. Rows marked `needs_review`, rows with no safe correction, and request failures stay unchanged.

## Important

`gpt-luna-5.6` is the requested default model string. The API account must have access to that model. If the provider exposes a different model ID, pass it explicitly with `--model`.

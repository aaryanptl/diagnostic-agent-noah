// Pure helpers for expanding a class's activity counts into visible rows.
// Safe to import from client components.

import type {
  ClassActivity,
  LearningObjective,
  PlanItem,
  QuestionGuideline,
} from "./types"

/**
 * Fallback prompts, used only for objectives the workbook has no question bank
 * for yet. They are deliberately different tasks rather than the same sentence
 * repeated, so a class never serves a student the identical question twice.
 */
const STARTER_FALLBACKS: ((text: string) => string)[] = [
  (text) => `Starter practice: ${text}.`,
  (text) => `Work a second example of the same kind: ${text}.`,
  (text) => `Change the numbers and try again: ${text}.`,
  (text) => `Talk through each step aloud as you ${lowerFirst(text)}.`,
]

const MASTER_FALLBACKS: ((text: string) => string)[] = [
  (text) => `Master practice: ${text} in a multi-step context.`,
  (text) => `Put it in a word problem: ${text}, then explain the answer in a sentence.`,
  (text) => `Check someone else's work: find and correct a mistake where a student had to ${lowerFirst(text)}.`,
]

function lowerFirst(text: string) {
  return text.charAt(0).toLowerCase() + text.slice(1)
}

/**
 * A stable starting point in the bank for one class.
 *
 * An objective can be taught across several classes, and each class counts its
 * own rounds from one. Without an offset every class would open with the same
 * first question. The offset is derived from the class id, so it is different
 * per class and identical on every rebuild — the plan has to stay
 * deterministic.
 */
function bankOffset(itemId: string, size: number) {
  if (size <= 0) return 0
  let hash = 0
  for (let index = 0; index < itemId.length; index += 1) {
    hash = (hash * 31 + itemId.charCodeAt(index)) % 100000
  }
  return hash % size
}

/**
 * Pick the prompt for one slot: the bank first, then the fallbacks. Combining
 * the two pools means the text only ever repeats inside a single class if that
 * class asks for more questions on one objective than both pools hold together.
 */
function promptFor(
  bank: string[],
  fallbacks: ((text: string) => string)[],
  objective: LearningObjective,
  itemId: string,
  round: number
) {
  const text = objective.text.replace(/\.$/, "")
  if (bank.length === 0) {
    return fallbacks[(round - 1) % fallbacks.length](text)
  }
  const step = round - 1
  if (step < bank.length) {
    return bank[(bankOffset(itemId, bank.length) + step) % bank.length]
  }
  return fallbacks[(step - bank.length) % fallbacks.length](text)
}

/**
 * Expand a class's easy/practice counts into visible activity rows.
 * Each row is a real starter or master prompt from the workbook guidelines
 * (or a clear placeholder), so "N total activities" always means N rows —
 * and every row on the same objective is a different question.
 */
export function buildClassActivities(
  item: Pick<
    PlanItem,
    "id" | "learningObjectives" | "easyActivities" | "practiceActivities"
  >,
  guidelines: QuestionGuideline[]
): ClassActivity[] {
  const objectives = item.learningObjectives
  if (objectives.length === 0) return []

  const activities: ClassActivity[] = []
  const easyTotal = Math.max(0, item.easyActivities)
  const practiceTotal = Math.max(0, item.practiceActivities)

  const guidelineFor = (objectiveId: string) =>
    guidelines.find((entry) => entry.learningObjectiveId === objectiveId)

  for (let index = 0; index < easyTotal; index += 1) {
    const objective = objectives[index % objectives.length]
    const guideline = guidelineFor(objective.id)
    const round = Math.floor(index / objectives.length) + 1
    activities.push({
      id: `${item.id}-starter-${index + 1}`,
      level: "starter",
      label: easyTotal > 1 ? `Starter Q${index + 1}` : "Starter Q",
      objectiveId: objective.id,
      objectiveSubtopic: objective.subtopic,
      objectiveText: objective.text,
      prompt: promptFor(
        guideline?.starters ?? [],
        STARTER_FALLBACKS,
        objective,
        item.id,
        round
      ),
      round,
    })
  }

  for (let index = 0; index < practiceTotal; index += 1) {
    const objective = objectives[index % objectives.length]
    const guideline = guidelineFor(objective.id)
    const round = Math.floor(index / objectives.length) + 1
    activities.push({
      id: `${item.id}-master-${index + 1}`,
      level: "master",
      label: practiceTotal > 1 ? `Master Q${index + 1}` : "Master Q",
      objectiveId: objective.id,
      objectiveSubtopic: objective.subtopic,
      objectiveText: objective.text,
      prompt: promptFor(
        guideline?.masters ?? [],
        MASTER_FALLBACKS,
        objective,
        item.id,
        round
      ),
      round,
    })
  }

  return activities
}

export function groupActivitiesByObjective(activities: ClassActivity[]) {
  const groups: {
    objectiveId: string
    subtopic: string
    text: string
    items: ClassActivity[]
  }[] = []

  for (const activity of activities) {
    const existing = groups.find(
      (group) => group.objectiveId === activity.objectiveId
    )
    if (existing) {
      existing.items.push(activity)
    } else {
      groups.push({
        objectiveId: activity.objectiveId,
        subtopic: activity.objectiveSubtopic,
        text: activity.objectiveText,
        items: [activity],
      })
    }
  }

  return groups
}

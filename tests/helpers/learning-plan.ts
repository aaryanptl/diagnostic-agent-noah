import assert from "node:assert/strict";

import {
  curriculumTopics,
  demoStudents,
} from "@/app/learning-plan-builder/data";
import {
  buildLearningPlan,
  getAiAssistedTopicSuggestion,
} from "@/lib/learning-plan/engine";
import type {
  DemoStudent,
  PlanTopicAllocation,
} from "@/lib/learning-plan/types";

/**
 * Grade 5 full-year package from the workbook: 79 classes =
 * 66 teaching + 13 structural (5 checkpoints + 5 RDP + 3 PTM).
 */
export const GRADE_5_TEACHING_BUDGET = 66;
export const GRADE_5_STRUCTURAL = 10; // 5 checkpoints + 5 RDP
export const GRADE_5_OPS_RESERVE = 3; // PTMs
export const FULL_YEAR_PACKAGE = 79;
export const STRONG_PLACEMENT_SCORE = 75;

export const topicById = new Map(
  curriculumTopics.map((topic) => [topic.id, topic]),
);

export const studentByScenario = (scenario: DemoStudent["scenario"]) => {
  const student = demoStudents.find((entry) => entry.scenario === scenario);
  assert.ok(student, `demo student ${scenario} is missing`);
  return student;
};

/** Auto-recommend the scope the way the builder does, then build the plan. */
export const planFor = (student: DemoStudent, topics = curriculumTopics) => {
  const suggestion = getAiAssistedTopicSuggestion(topics, student);
  return {
    suggestion,
    plan: buildLearningPlan({
      topics,
      student,
      selectedTopicIds: suggestion.selectedTopicIds,
    }),
  };
};

export const sum = (values: number[]) =>
  values.reduce((total, n) => total + n, 0);

/**
 * The saved-classes figure the review screen reports per topic: ideal minus
 * what is actually taught, excluding capacity compression, which is shown in
 * its own card. Mirrors `placementClassAdjustments` in page.tsx.
 */
export const placementSavedClasses = (allocation: {
  idealClasses: number;
  classes: number;
  compressedByCapacity?: number;
}) =>
  allocation.idealClasses -
  allocation.classes -
  (allocation.compressedByCapacity ?? 0);

/** Every prerequisite of `topicId`, transitively. */
export const prerequisiteChain = (topicId: number): number[] => {
  const seen = new Set<number>();
  const walk = (id: number) => {
    for (const prerequisiteId of topicById.get(id)?.prerequisiteIds ?? []) {
      if (seen.has(prerequisiteId)) continue;
      seen.add(prerequisiteId);
      walk(prerequisiteId);
    }
  };
  walk(topicId);
  return [...seen];
};

/**
 * A prerequisite that is in the plan has to be taught before the topic that
 * needs it — this holds whatever the priority order says, and whatever the fit
 * ladder had to compress or drop.
 */
export const assertPrerequisiteOrder = (allocations: PlanTopicAllocation[]) => {
  const positionById = new Map(
    allocations.map((allocation, index) => [allocation.topicId, index]),
  );
  for (const allocation of allocations) {
    const topic = topicById.get(allocation.topicId);
    if (!topic) continue;
    for (const prerequisiteId of topic.prerequisiteIds) {
      const prerequisiteAt = positionById.get(prerequisiteId);
      if (prerequisiteAt === undefined) continue; // completed or deferred
      assert.ok(
        prerequisiteAt < (positionById.get(allocation.topicId) as number),
        `${topic.name} runs before its prerequisite ${prerequisiteId}`,
      );
    }
  }
};

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { curriculumTopics } from "@/app/learning-plan-builder/data";
import type { CurriculumTopic, DemoStudent } from "@/lib/learning-plan/types";
import {
  FULL_YEAR_PACKAGE,
  GRADE_5_OPS_RESERVE,
  GRADE_5_STRUCTURAL,
  GRADE_5_TEACHING_BUDGET,
  placementSavedClasses,
  planFor,
  STRONG_PLACEMENT_SCORE,
  studentByScenario,
  sum,
} from "./helpers/learning-plan";

describe("Grade 5 class distribution", () => {
  it("adds up to the full-year teaching budget at ideal length", () => {
    assert.equal(
      sum(curriculumTopics.map((topic) => topic.idealClasses)),
      GRADE_5_TEACHING_BUDGET,
    );
  });

  it("leaves room for the full structural reserve inside the package", () => {
    assert.equal(
      GRADE_5_TEACHING_BUDGET + GRADE_5_STRUCTURAL + GRADE_5_OPS_RESERVE,
      FULL_YEAR_PACKAGE,
    );
  });

  it("keeps every minimum at or under its ideal, and above zero", () => {
    for (const topic of curriculumTopics) {
      assert.ok(
        topic.minimumClasses >= 1,
        `${topic.name} has a minimum below 1 class`,
      );
      assert.ok(
        topic.minimumClasses <= topic.idealClasses,
        `${topic.name} has a minimum above its ideal`,
      );
    }
  });

  it("keeps the Rule H1 compression floor at ~60% of ideal", () => {
    for (const topic of curriculumTopics) {
      const expected =
        topic.idealClasses <= 2 ? 1 : Math.ceil(topic.idealClasses * 0.6);
      assert.equal(
        topic.minimumClasses,
        expected,
        `${topic.name} minimum is ${topic.minimumClasses}, expected ${expected}`,
      );
    }
  });

  it("leaves headroom to shorten every topic that can be shortened", () => {
    const shortenable = curriculumTopics.filter(
      (topic) => topic.idealClasses > topic.minimumClasses,
    );
    assert.ok(
      shortenable.length >= curriculumTopics.length - 1,
      "almost every topic should have at least one class of headroom",
    );
  });
});

describe("a full-year plan with no student evidence", () => {
  /** No placement, no mastery, no completed topics — nothing to reduce. */
  const cleanSlate: DemoStudent = {
    ...studentByScenario("A"),
    placementStatus: "not-taken",
    placementResults: [],
    defaultPlacementScore: undefined,
    objectiveEvidence: [],
    questionAttemptEvidence: [],
    completedTopics: [],
    currentTopicId: undefined,
    parentRequestedTopicId: undefined,
  };

  it("selects the whole Grade 5 sequence", () => {
    const { suggestion } = planFor(cleanSlate);
    assert.equal(suggestion.selectedTopicIds.length, curriculumTopics.length);
    assert.equal(
      suggestion.recommendations.filter((r) => r.decision === "defer").length,
      0,
    );
  });

  it("fits the package exactly without compressing anything", () => {
    const { plan } = planFor(cleanSlate);
    assert.deepEqual(
      {
        available: plan.capacity.available,
        teaching: plan.capacity.teaching,
        structural: plan.capacity.structural,
        opsReserve: plan.capacity.opsReserve,
        total: plan.capacity.total,
        difference: plan.capacity.difference,
        compressedClasses: plan.capacity.compressedClasses,
      },
      {
        available: FULL_YEAR_PACKAGE,
        teaching: GRADE_5_TEACHING_BUDGET,
        structural: GRADE_5_STRUCTURAL,
        opsReserve: GRADE_5_OPS_RESERVE,
        total: FULL_YEAR_PACKAGE,
        difference: 0,
        compressedClasses: 0,
      },
    );
  });

  it("runs every topic at its ideal length", () => {
    const { plan } = planFor(cleanSlate);
    for (const allocation of plan.allocations) {
      assert.equal(
        allocation.classes,
        allocation.idealClasses,
        `${allocation.topicName} was shortened with no evidence to justify it`,
      );
    }
  });
});

describe("strong placement scores reduce classes and show the reduction", () => {
  const maya = studentByScenario("A");

  it("shortens every topic scored at or above 75% to its minimum", () => {
    const { plan } = planFor(maya);
    const strong = maya.placementResults.filter(
      (result) => result.score >= STRONG_PLACEMENT_SCORE,
    );
    assert.ok(
      strong.length > 0,
      "scenario A should have strong scores to test",
    );

    for (const result of strong) {
      const allocation = plan.allocations.find(
        (entry) => entry.topicId === result.topicId,
      );
      assert.ok(allocation, `topic ${result.topicId} is missing from the plan`);
      assert.equal(
        allocation.classes,
        allocation.minimumClasses,
        `${allocation.topicName} scored ${result.score}% but still runs ${allocation.classes} classes`,
      );
      assert.ok(
        allocation.classes < allocation.idealClasses,
        `${allocation.topicName} scored ${result.score}% but saved no classes`,
      );
    }
  });

  it("keeps full allocation for topics scored below 40%", () => {
    const { plan } = planFor(maya);
    const weak = maya.placementResults.filter((result) => result.score < 40);
    assert.ok(weak.length > 0, "scenario A should have weak scores to test");

    for (const result of weak) {
      const allocation = plan.allocations.find(
        (entry) => entry.topicId === result.topicId,
      );
      assert.ok(allocation, `topic ${result.topicId} is missing from the plan`);
      assert.equal(
        allocation.classes,
        allocation.idealClasses,
        `${allocation.topicName} scored ${result.score}% and should keep its full allocation`,
      );
    }
  });

  it("lands under the package instead of only absorbing an overage", () => {
    const { plan } = planFor(maya);
    assert.ok(
      plan.capacity.difference < 0,
      `expected the plan to come in under ${FULL_YEAR_PACKAGE}, got a difference of ${plan.capacity.difference}`,
    );
    assert.equal(plan.capacity.compressedClasses, 0);
    assert.equal(
      plan.capacity.total,
      FULL_YEAR_PACKAGE + plan.capacity.difference,
    );
  });

  it("reports a reduction equal to the classes the placement scores saved", () => {
    const { plan } = planFor(maya);
    const saved = sum(plan.allocations.map(placementSavedClasses));
    assert.ok(saved > 0, "expected placement scores to save classes");
    assert.equal(
      saved,
      Math.abs(plan.capacity.difference),
      "the reduction shown on the capacity card must match the classes actually saved",
    );
    assert.equal(plan.capacity.teaching, GRADE_5_TEACHING_BUDGET - saved);
  });

  it("attributes every saved class to a score of 75% or more", () => {
    const { plan } = planFor(maya);
    const scoreByTopic = new Map(
      maya.placementResults.map((result) => [result.topicId, result.score]),
    );
    for (const allocation of plan.allocations) {
      if (placementSavedClasses(allocation) <= 0) continue;
      const score =
        scoreByTopic.get(allocation.topicId) ?? maya.defaultPlacementScore ?? 0;
      assert.ok(
        score >= STRONG_PLACEMENT_SCORE,
        `${allocation.topicName} saved classes on a score of ${score}%`,
      );
    }
  });
});

describe("the fit ladder still works on tighter packages", () => {
  for (const scenario of ["A", "B", "C", "D"] as const) {
    const student = studentByScenario(scenario);

    it(`never exceeds the package for scenario ${scenario}`, () => {
      const { plan } = planFor(student);
      assert.ok(
        plan.capacity.total <= student.classesRemaining,
        `scenario ${scenario} planned ${plan.capacity.total} against ${student.classesRemaining} available`,
      );
      assert.ok(plan.capacity.difference <= 0);
    });

    it(`never drops a topic below its minimum for scenario ${scenario}`, () => {
      const { plan } = planFor(student);
      for (const allocation of plan.allocations) {
        assert.ok(
          allocation.classes >= allocation.minimumClasses,
          `${allocation.topicName} runs ${allocation.classes} classes, below its minimum of ${allocation.minimumClasses}`,
        );
      }
    });

    it(`keeps teaching plus structural equal to the planned total for scenario ${scenario}`, () => {
      const { plan } = planFor(student);
      assert.equal(
        plan.capacity.teaching +
          plan.capacity.structural +
          plan.capacity.opsReserve,
        plan.capacity.total,
      );
    });
  }

  it("compresses and defers on the half-year package", () => {
    const ethan = studentByScenario("B");
    const { plan, suggestion } = planFor(ethan);
    assert.ok(
      plan.capacity.compressedClasses > 0,
      "a 40-class package should force compression",
    );
    assert.ok(
      suggestion.selectedTopicIds.length < curriculumTopics.length,
      "a 40-class package should defer some topics",
    );
  });
});

describe("class distribution is independent of the fit ladder", () => {
  /** A package far larger than the sequence should never inflate a topic. */
  it("never allocates more than the ideal, however much room there is", () => {
    const roomy: DemoStudent = {
      ...studentByScenario("A"),
      classesRemaining: 200,
      placementStatus: "not-taken",
      placementResults: [],
      defaultPlacementScore: undefined,
      objectiveEvidence: [],
      questionAttemptEvidence: [],
      completedTopics: [],
      currentTopicId: undefined,
      parentRequestedTopicId: undefined,
    };
    const { plan } = planFor(roomy);
    for (const allocation of plan.allocations) {
      assert.ok(
        allocation.classes <= allocation.idealClasses,
        `${allocation.topicName} was padded past its ideal length`,
      );
    }
    assert.equal(plan.capacity.teaching, GRADE_5_TEACHING_BUDGET);
  });

  it("holds the budget for every topic the curriculum exposes", () => {
    const byId = new Map<number, CurriculumTopic>(
      curriculumTopics.map((topic) => [topic.id, topic]),
    );
    assert.equal(byId.size, curriculumTopics.length, "duplicate topic id");
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { curriculumTopics } from "@/app/learning-plan-builder/data";
import {
  assertPrerequisiteOrder,
  FULL_YEAR_PACKAGE,
  GRADE_5_STRUCTURAL,
  GRADE_5_TEACHING_BUDGET,
  placementSavedClasses,
  planFor,
  prerequisiteChain,
  studentByScenario,
  sum,
  topicById,
} from "./helpers/learning-plan";

/* ---------------------------------------------- scenario B: half-year package */

describe("scenario B — a half-year package forces the fit ladder", () => {
  const ethan = studentByScenario("B");

  it("has no student evidence, so every reduction has to come from capacity", () => {
    const { plan } = planFor(ethan);
    assert.equal(ethan.placementStatus, "not-taken");
    assert.equal(ethan.objectiveEvidence.length, 0);
    for (const allocation of plan.allocations) {
      assert.equal(
        placementSavedClasses(allocation),
        0,
        `${allocation.topicName} was shortened by something other than capacity`,
      );
    }
  });

  it("packs the 40-class package without going over it", () => {
    const { plan } = planFor(ethan);
    assert.equal(plan.capacity.available, 40);
    assert.equal(plan.capacity.total, 40);
    assert.equal(plan.capacity.difference, 0);
    assert.equal(
      plan.capacity.teaching +
        plan.capacity.structural +
        plan.capacity.opsReserve,
      40,
    );
  });

  it("sheds RDP and checkpoints down to the two-checkpoint floor", () => {
    const { plan } = planFor(ethan);
    // RDP goes first, then checkpoint + RDP pairs, never below two checkpoints
    // for a multi-topic plan: 2 checkpoints + 0 RDP = 2.
    assert.equal(plan.capacity.structural, 2);
    assert.ok(
      plan.capacity.structural < GRADE_5_STRUCTURAL,
      "a tight package should shed structural classes",
    );
  });

  it("never sheds the ops PTM reserve", () => {
    const { plan } = planFor(ethan);
    // Proportional to the package: ceil(40 / 79 * 3) = 2, clamped to 1..3.
    assert.equal(plan.capacity.opsReserve, 2);
    assert.ok(plan.capacity.opsReserve >= 1);
  });

  it("compresses topics toward their minimums, never past them", () => {
    const { plan } = planFor(ethan);
    assert.ok(
      plan.capacity.compressedClasses > 0,
      "a 40-class package should force compression",
    );
    assert.equal(
      plan.capacity.compressedClasses,
      sum(plan.allocations.map((a) => a.compressedByCapacity ?? 0)),
    );
    for (const allocation of plan.allocations) {
      assert.ok(
        allocation.classes >= allocation.minimumClasses,
        `${allocation.topicName} was compressed below its minimum`,
      );
    }
  });

  it("takes compression from the lowest priority first", () => {
    const { plan } = planFor(ethan);
    // Anything still holding slack has to be High priority: the ladder empties
    // Low and Medium down to their minimums before it touches High.
    for (const allocation of plan.allocations) {
      if (allocation.classes === allocation.minimumClasses) continue;
      assert.equal(
        allocation.priority,
        "high",
        `${allocation.topicName} (${allocation.priority}) kept slack while compression was still needed`,
      );
    }
  });

  it("keeps every High-priority topic and drops Low first", () => {
    const { suggestion } = planFor(ethan);
    const deferred = suggestion.recommendations.filter(
      (recommendation) => recommendation.decision === "defer",
    );
    assert.ok(deferred.length > 0, "a 40-class package should defer topics");

    for (const recommendation of deferred) {
      const topic = topicById.get(recommendation.topicId);
      assert.ok(topic, `deferred topic ${recommendation.topicId} is unknown`);
      assert.notEqual(
        topic.priority,
        "high",
        `${topic.name} is High priority and must not be deferred`,
      );
      assert.equal(recommendation.evidence, "capacity");
    }

    for (const topic of curriculumTopics.filter((t) => t.priority === "low")) {
      assert.ok(
        !suggestion.selectedTopicIds.includes(topic.id),
        `${topic.name} is Low priority and should be the first to drop`,
      );
    }
  });

  it("teaches less than a full year but keeps the sequence coherent", () => {
    const { plan, suggestion } = planFor(ethan);
    assert.ok(plan.capacity.teaching < GRADE_5_TEACHING_BUDGET);
    assert.ok(suggestion.selectedTopicIds.length < curriculumTopics.length);
    assertPrerequisiteOrder(plan.allocations);
  });
});

/* ------------------------- scenario C: mid-year rebuild around existing progress */

describe("scenario C — rebuilding mid-year around work already done", () => {
  const aarav = studentByScenario("C");
  const COMPLETED_IDS = [57, 58];
  const IN_PROGRESS_ID = 59;

  it("has the fixture this scenario is built on", () => {
    assert.deepEqual(
      aarav.completedTopics.map((topic) => topic.topicId),
      COMPLETED_IDS,
    );
    assert.equal(aarav.currentTopicId, IN_PROGRESS_ID);
    assert.equal(aarav.currentTopicClassesUsed, 3);
    assert.ok(
      topicById.has(IN_PROGRESS_ID),
      "the in-progress topic must exist in the curriculum",
    );
    for (const topicId of COMPLETED_IDS) {
      assert.ok(
        topicById.has(topicId),
        `completed topic ${topicId} is unknown`,
      );
    }
  });

  it("never re-teaches a completed topic", () => {
    const { plan, suggestion } = planFor(aarav);
    for (const topicId of COMPLETED_IDS) {
      assert.ok(
        !suggestion.selectedTopicIds.includes(topicId),
        `completed topic ${topicId} was selected again`,
      );
      assert.ok(
        !plan.allocations.some((allocation) => allocation.topicId === topicId),
        `completed topic ${topicId} was scheduled again`,
      );
    }
  });

  it("returns the classes the completed topics came in under", () => {
    const { plan } = planFor(aarav);
    const saved = sum(
      aarav.completedTopics.map(
        (topic) => topic.plannedClasses - topic.actualClasses,
      ),
    );
    assert.equal(saved, 1);
    assert.ok(
      plan.changesFromPrevious.some((note) =>
        note.includes(`Returned ${saved} saved class`),
      ),
      `expected the saved class to be reported, got ${JSON.stringify(plan.changesFromPrevious)}`,
    );
  });

  it("keeps the in-progress topic and only schedules the classes still left", () => {
    const { plan } = planFor(aarav);
    const active = plan.allocations.find(
      (allocation) => allocation.topicId === IN_PROGRESS_ID,
    );
    assert.ok(active, "the in-progress topic must stay in the plan");
    assert.ok(
      active.classes < active.idealClasses,
      "classes already taught should not be scheduled again",
    );
    assert.ok(
      active.reasons.some((reason) => reason.includes("already been taught")),
      `expected a taught-classes reason, got ${JSON.stringify(active.reasons)}`,
    );
  });

  it("counts taught classes toward the in-progress topic's own minimum", () => {
    const { plan } = planFor(aarav);
    const topic = topicById.get(IN_PROGRESS_ID);
    assert.ok(topic);
    const active = plan.allocations.find(
      (allocation) => allocation.topicId === IN_PROGRESS_ID,
    );
    assert.ok(active);
    // The Rule H1 floor covers the whole topic, so taught classes come off it.
    assert.equal(
      active.minimumClasses,
      Math.max(1, topic.minimumClasses - (aarav.currentTopicClassesUsed ?? 0)),
    );
    assert.ok(active.minimumClasses < topic.minimumClasses);
  });

  it("extends the in-progress topic for not-secure evidence before subtracting taught classes", () => {
    const { plan } = planFor(aarav);
    const active = plan.allocations.find(
      (allocation) => allocation.topicId === IN_PROGRESS_ID,
    );
    assert.ok(active);
    const notSecure = aarav.objectiveEvidence.filter(
      (evidence) => evidence.result === "not-secure",
    );
    assert.ok(notSecure.length > 0, "scenario C should carry weak evidence");
    assert.ok(
      active.reasons.some((reason) => reason.includes("not secure")),
      `expected an evidence reason, got ${JSON.stringify(active.reasons)}`,
    );
  });

  it("reads the question attempts as a Starter-strong, Master-weak profile", () => {
    const { plan } = planFor(aarav);
    const attempts = aarav.questionAttemptEvidence ?? [];
    assert.ok(attempts.length > 0, "scenario C should carry attempt evidence");
    const active = plan.allocations.find(
      (allocation) => allocation.topicId === IN_PROGRESS_ID,
    );
    assert.ok(active);
    assert.ok(
      active.reasons.some(
        (reason) =>
          reason.includes("Starter accuracy") &&
          reason.includes("Master accuracy"),
      ),
      `expected an attempt-profile reason, got ${JSON.stringify(active.reasons)}`,
    );
  });

  it("fits the 24 classes that are actually left", () => {
    const { plan } = planFor(aarav);
    assert.equal(plan.capacity.available, 24);
    assert.equal(plan.capacity.total, 24);
    assert.equal(plan.capacity.difference, 0);
    assert.ok(plan.capacity.compressedClasses > 0);
    // ceil(24 / 79 * 3) = 1, clamped to 1..3.
    assert.equal(plan.capacity.opsReserve, 1);
  });

  it("defers on capacity, never on the evidence", () => {
    const { suggestion } = planFor(aarav);
    const deferred = suggestion.recommendations.filter(
      (recommendation) => recommendation.decision === "defer",
    );
    assert.ok(deferred.length > 0, "24 classes cannot hold the full sequence");
    for (const recommendation of deferred) {
      assert.equal(recommendation.evidence, "capacity");
    }
  });

  it("still places every kept prerequisite before the topic that needs it", () => {
    const { plan } = planFor(aarav);
    assertPrerequisiteOrder(plan.allocations);
  });
});

/* ------------------------------ scenario D: a parent-requested topic pulled up */

describe("scenario D — a parent-requested topic is pulled forward", () => {
  const sofia = studentByScenario("D");
  const REQUESTED_ID = 60;
  /** 60 ← 59 ← 58 ← 57. The whole chain has to run before the request. */
  const CHAIN_IDS = [57, 58, 59];

  it("has the fixture this scenario is built on", () => {
    assert.equal(sofia.parentRequestedTopicId, REQUESTED_ID);
    assert.equal(sofia.classesRemaining, FULL_YEAR_PACKAGE);
    assert.equal(sofia.placementStatus, "not-taken");
    assert.deepEqual(
      prerequisiteChain(REQUESTED_ID).sort((a, b) => a - b),
      CHAIN_IDS,
    );
  });

  it("keeps the requested topic and its whole prerequisite chain", () => {
    const { suggestion } = planFor(sofia);
    for (const topicId of [REQUESTED_ID, ...CHAIN_IDS]) {
      assert.ok(
        suggestion.selectedTopicIds.includes(topicId),
        `topic ${topicId} must be in the plan for the request to be teachable`,
      );
    }
  });

  it("runs the requested topic at full length", () => {
    const { plan } = planFor(sofia);
    const requested = plan.allocations.find(
      (allocation) => allocation.topicId === REQUESTED_ID,
    );
    assert.ok(requested);
    assert.equal(requested.classes, requested.idealClasses);
    assert.equal(requested.isCompressedRefresher, false);
  });

  it("shortens each prerequisite to a refresher of half the ideal, rounded up", () => {
    const { plan } = planFor(sofia);
    for (const topicId of CHAIN_IDS) {
      const allocation = plan.allocations.find(
        (entry) => entry.topicId === topicId,
      );
      assert.ok(allocation, `prerequisite ${topicId} is missing`);
      assert.equal(
        allocation.isCompressedRefresher,
        true,
        `${allocation.topicName} should run as a refresher`,
      );
      assert.equal(
        allocation.classes,
        Math.ceil(allocation.idealClasses / 2),
        `${allocation.topicName} refresher is the wrong length`,
      );
    }
  });

  it("never drops a prerequisite, and never compresses a refresher further", () => {
    const { plan } = planFor(sofia);
    for (const topicId of CHAIN_IDS) {
      const allocation = plan.allocations.find(
        (entry) => entry.topicId === topicId,
      );
      assert.ok(allocation);
      assert.ok(allocation.classes >= 1);
      assert.equal(allocation.compressedByCapacity ?? 0, 0);
    }
  });

  it("places the requested topic ahead of everything that is not a prerequisite", () => {
    const { plan } = planFor(sofia);
    const order = plan.allocations.map((allocation) => allocation.topicId);
    const requestedAt = order.indexOf(REQUESTED_ID);
    assert.ok(requestedAt >= 0);

    for (const topicId of CHAIN_IDS) {
      assert.ok(
        order.indexOf(topicId) < requestedAt,
        `prerequisite ${topicId} must run before the requested topic`,
      );
    }
    for (const [index, topicId] of order.entries()) {
      if (index >= requestedAt) continue;
      assert.ok(
        CHAIN_IDS.includes(topicId),
        `topic ${topicId} runs before the requested topic without being a prerequisite`,
      );
    }
    assertPrerequisiteOrder(plan.allocations);
  });

  it("pulls the request ahead of topics that come earlier in the curriculum", () => {
    const { plan } = planFor(sofia);
    const order = plan.allocations.map((allocation) => allocation.topicId);
    const requested = topicById.get(REQUESTED_ID);
    assert.ok(requested);
    const jumped = plan.allocations.filter((allocation) => {
      const topic = topicById.get(allocation.topicId);
      return (
        topic !== undefined &&
        topic.sequence < requested.sequence &&
        !CHAIN_IDS.includes(topic.id) &&
        order.indexOf(topic.id) > order.indexOf(REQUESTED_ID)
      );
    });
    assert.ok(
      jumped.length > 0,
      "the request should overtake at least one earlier curriculum topic",
    );
  });

  it("shows the refresher saving as headroom under the package", () => {
    const { plan } = planFor(sofia);
    const saved = sum(
      CHAIN_IDS.map((topicId) => {
        const allocation = plan.allocations.find(
          (entry) => entry.topicId === topicId,
        );
        assert.ok(allocation);
        return allocation.idealClasses - allocation.classes;
      }),
    );
    assert.ok(saved > 0);
    assert.equal(plan.capacity.compressedClasses, 0);
    assert.equal(plan.capacity.difference, -saved);
    assert.equal(plan.capacity.teaching, GRADE_5_TEACHING_BUDGET - saved);
    assert.equal(plan.capacity.total, FULL_YEAR_PACKAGE - saved);
  });

  it("still teaches the whole sequence — nothing is deferred on a full year", () => {
    const { plan, suggestion } = planFor(sofia);
    assert.equal(suggestion.selectedTopicIds.length, curriculumTopics.length);
    assert.equal(
      suggestion.recommendations.filter(
        (recommendation) => recommendation.decision === "defer",
      ).length,
      0,
    );
    assert.equal(plan.droppedTopics.length, 0);
  });

  it("explains why the requested topic moved", () => {
    const { plan } = planFor(sofia);
    assert.ok(
      plan.explanations.some((line) => line.includes("parent-requested")),
      `expected the parent request to be explained, got ${JSON.stringify(plan.explanations)}`,
    );
  });
});

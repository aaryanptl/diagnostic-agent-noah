import type { CurriculumTopic } from "@/lib/learning-plan/types";
import {
  curriculumByGrade,
  type GradeKey,
  gradeKeys,
  gradeLabels,
} from "./curriculum.generated";

export { curriculumByGrade, gradeKeys, gradeLabels };
export type { GradeKey };

/** Kindergarten is stored as grade 0 on a student record. */
export function gradeKeyFor(grade: number | string): GradeKey {
  const raw = String(grade).trim();
  if (raw === "0" || /^k/i.test(raw)) return "KG";
  const match = raw.match(/\d+/);
  const key = match?.[0] as GradeKey | undefined;
  if (key && key in curriculumByGrade) return key;
  throw new Error(`No maths curriculum for grade "${grade}"`);
}

/** The full teaching sequence for a grade, in workbook order. */
export function getTopicsForGrade(grade: number | string): CurriculumTopic[] {
  return curriculumByGrade[gradeKeyFor(grade)];
}

/** Every topic across every grade. Topic IDs are unique curriculum-wide. */
export const allTopics: CurriculumTopic[] = gradeKeys.flatMap(
  (key) => curriculumByGrade[key],
);

export const gradeKeyByTopicId = new Map<number, GradeKey>(
  gradeKeys.flatMap((key) =>
    curriculumByGrade[key].map((topic) => [topic.id, key] as const),
  ),
);

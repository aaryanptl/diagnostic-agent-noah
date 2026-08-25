import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import type { Subject, ClassLevel, BloomLevel, QuestionType } from "@/agents/diagnostic/types";
import type { QuestionBankQuestion } from "@/agents/diagnostic/types";
import type { DemoQuizCatalogEntry } from "@/lib/demo-types";

const ALL_CLASS_LEVELS: ClassLevel[] = [
  "classKG",
  "class1",
  "class2",
  "class3",
  "class4",
  "class5",
  "class6",
  "class7",
  "class8",
];

function toClassLevel(levelStr: string): ClassLevel {
  const norm = (levelStr || "").toLowerCase().trim();
  const match = norm.match(/\d+/);
  if (match) {
    const num = parseInt(match[0], 10);
    if (num >= 1 && num <= 8) return `class${num}` as ClassLevel;
  }
  return "class1";
}

function toBloomLevel(bloomStr: string): BloomLevel {
  const norm = (bloomStr || "").toLowerCase().trim();
  if (norm.includes("remember")) return "remember";
  if (norm.includes("understand")) return "understand";
  return "apply";
}

function toQuestionType(qTypeStr: string): QuestionType {
  const norm = (qTypeStr || "").toLowerCase().trim();
  if (norm === "mcq") return "mcq";
  if (norm === "fitb") return "fitb";
  if (norm === "dnd" || norm === "drag_drop") return "drag_drop";
  if (norm === "matching") return "matching";
  if (norm === "true_false") return "true_false";
  if (norm === "short_answer") return "short_answer";
  return "mcq";
}

function safeJsonParse(jsonStr: string | null | undefined): any {
  if (!jsonStr) return null;
  try {
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

interface LoadedCodingData {
  questions: QuestionBankQuestion[];
  catalogEntries: DemoQuizCatalogEntry[];
}

let cachedCodingData: LoadedCodingData | null = null;

export function getCodingData(): LoadedCodingData {
  if (cachedCodingData) return cachedCodingData;

  const questions: QuestionBankQuestion[] = [];
  const catalogMap = new Map<string, DemoQuizCatalogEntry>();

  const codingDir = path.resolve(process.cwd(), "data/coding");

  if (!fs.existsSync(codingDir)) {
    cachedCodingData = { questions, catalogEntries: [] };
    return cachedCodingData;
  }

  const csvFiles = fs.readdirSync(codingDir).filter((f) => f.endsWith(".csv"));

  for (const file of csvFiles) {
    const filePath = path.join(codingDir, file);
    const content = fs.readFileSync(filePath, "utf8");

    try {
      const records: any[] = parse(content, { columns: true, skip_empty_lines: true, relax_column_count: true });
      let rowIdx = 0;

      for (const row of records) {
        rowIdx++;
        if (row.questionText && row.questionType) {
          const subject: Subject = row.subject?.toLowerCase().includes("web") ? "coding-webdev" : "coding-python";
          const classLevel = toClassLevel(row.courseLevel || row.grade || "Level 1");
          const topic = (row.topic || row.module || "General Coding").trim();
          const subtopic = (row.subtopic || "").trim();
          const learningObjective = (row.learningObjective || row.learning_objective || "").trim();
          const questionType = toQuestionType(row.questionType);
          const bloomLevel = toBloomLevel(row.bloomsLevel || row.blooms_level || "Remembering");

          const rawOptions = safeJsonParse(row.options) || [];
          let options: string[] | undefined = undefined;
          let correctAnswer: string | undefined = undefined;

          if (Array.isArray(rawOptions) && rawOptions.length > 0) {
            options = rawOptions.map((o: any) => typeof o === "string" ? o : o.text || String(o));
            const correctIdx = rawOptions.findIndex((o: any) => o.correct === true || o.correct === "true");
            if (correctIdx >= 0) {
              correctAnswer = ["A", "B", "C", "D"][correctIdx];
            }
          }

          const parsedPayload = safeJsonParse(row.payload) || {};
          const parsedMetadata = safeJsonParse(row.generationMetadata) || {};
          const combinedPayload: Record<string, any> = {
            ...parsedPayload,
            ...parsedMetadata,
          };

          let modelAnswer: string | undefined = undefined;

          if (questionType === "fitb") {
            const blanks = combinedPayload.blanks || parsedPayload.blanks || parsedMetadata.blanks;
            if (Array.isArray(blanks) && blanks.length > 0) {
              modelAnswer = blanks
                .map((b: any) => (typeof b === "string" ? b : b.answer || b.text || ""))
                .filter(Boolean)
                .join(", ");
            } else if (combinedPayload.answer || parsedPayload.answer) {
              modelAnswer = combinedPayload.answer || parsedPayload.answer;
            }
            if (modelAnswer) {
              correctAnswer = modelAnswer;
            }
            combinedPayload.answer = modelAnswer || combinedPayload.answer;
            combinedPayload.blanks = blanks || combinedPayload.blanks || [];
          }

          if (questionType === "drag_drop" || questionType === "matching") {
            let draggableItems: string[] = combinedPayload.draggableItems || [];
            let dropZones: string[] = combinedPayload.dropZones || [];
            let answerKey: any[] = combinedPayload.answerKey || [];

            const rawItems = combinedPayload.items || [];
            const rawTargets = combinedPayload.targets || [];

            if (draggableItems.length === 0 && Array.isArray(rawItems)) {
              draggableItems = rawItems
                .map((i: any) => (typeof i === "string" ? i : i.label || i.text || i.value || ""))
                .filter(Boolean);
            }

            if (dropZones.length === 0 && Array.isArray(rawTargets)) {
              dropZones = rawTargets
                .map((t: any) => (typeof t === "string" ? t : t.label || t.text || t.value || ""))
                .filter(Boolean);
            }

            if (answerKey.length === 0 && Array.isArray(rawTargets)) {
              const itemMap = new Map(
                rawItems.map((i: any) => [i.id, typeof i === "string" ? i : i.label || i.text || ""])
              );
              const builtKey: any[] = [];
              for (const t of rawTargets) {
                if (t.correctItemId) {
                  const itemLabel = itemMap.get(t.correctItemId) || t.correctItemId;
                  const targetLabel = t.label || t.text || "";
                  if (itemLabel && targetLabel) {
                    builtKey.push({ item: itemLabel, prompt: itemLabel, target: targetLabel, match: targetLabel });
                  }
                }
              }
              if (builtKey.length > 0) {
                answerKey = builtKey;
              }
            } else if (answerKey.length > 0 && answerKey[0].itemId) {
              const itemMap = new Map(
                rawItems.map((i: any) => [i.id, typeof i === "string" ? i : i.label || i.text || ""])
              );
              const targetMap = new Map(
                rawTargets.map((t: any) => [t.id, typeof t === "string" ? t : t.label || t.text || ""])
              );
              answerKey = answerKey.map((ans: any) => {
                const itemLabel = itemMap.get(ans.itemId) || ans.item || ans.prompt || "";
                const targetLabel = targetMap.get(ans.targetId) || ans.target || ans.match || "";
                return { item: itemLabel, prompt: itemLabel, target: targetLabel, match: targetLabel };
              });
            }

            combinedPayload.draggableItems = draggableItems;
            combinedPayload.dropZones = dropZones;
            combinedPayload.premises = draggableItems;
            combinedPayload.responses = dropZones;
            combinedPayload.answerKey = answerKey;
          }

          const questionObj: QuestionBankQuestion = {
            id: row.queueId || `coding-${file}-${row.rowNumber || rowIdx}`,
            subject,
            topic,
            subtopic,
            learningObjective,
            difficultyLevel: (row.difficultyLevel || "easy").toLowerCase(),
            difficultyRating: parseInt(row.difficultyRating, 10) || 1,
            classLevel,
            bloomLevel,
            questionType,
            question: row.questionText.trim(),
            options,
            correctAnswer,
            modelAnswer,
            explanation: (row.explanation || row.summary || "").trim(),
            keywords: [subject, topic, subtopic, learningObjective].filter(Boolean),
            region: "global",
            payload: {
              ...combinedPayload,
              options: rawOptions,
              explanation: (row.explanation || "").trim(),
            },
          };

          questions.push(questionObj);

          // Replicate topic catalog entries for all class levels so coding is accessible in any grade selection
          for (const cl of ALL_CLASS_LEVELS) {
            const catKey = `${subject}-${cl}-${topic}`;
            const existing = catalogMap.get(catKey);
            if (existing) {
              if (learningObjective && !existing.learningObjectives.includes(learningObjective)) {
                existing.learningObjectives.push(learningObjective);
              }
              existing.questionCount += 1;
            } else {
              catalogMap.set(catKey, {
                subject,
                classLevel: cl,
                topic,
                learningObjectives: learningObjective ? [learningObjective] : [],
                questionCount: 1,
              });
            }
          }
        } else if (row.Module || row["Module (Topic)"] || row.Topic) {
          const isWebDev = file.toLowerCase().includes("webdev");
          const subject: Subject = isWebDev ? "coding-webdev" : "coding-python";
          const topic = (row.Module || row["Module (Topic)"] || row.Topic || "Web Development").trim();
          const subtopic = (row.Topic || row["LO (Subtopic)"] || row["Learning Objective (Sub Topic)"] || "").trim();
          const learningObjective = (row["Full Learning Objective"] || "").trim();

          for (const cl of ALL_CLASS_LEVELS) {
            const catKey = `${subject}-${cl}-${topic}`;
            const existing = catalogMap.get(catKey);
            if (existing) {
              if (learningObjective && !existing.learningObjectives.includes(learningObjective)) {
                existing.learningObjectives.push(learningObjective);
              }
              if (learningObjective) {
                existing.questionCount += 1;
              }
            } else {
              catalogMap.set(catKey, {
                subject,
                classLevel: cl,
                topic,
                learningObjectives: learningObjective ? [learningObjective] : [],
                questionCount: learningObjective ? 1 : 0,
              });
            }
          }

          if (learningObjective) {
            const mcqQuestion: QuestionBankQuestion = {
              id: row["S.No"] ? `webdev-lo-${row["S.No"]}` : `webdev-lo-${file}-${rowIdx}`,
              subject,
              topic,
              subtopic,
              learningObjective,
              difficultyLevel: "easy",
              difficultyRating: 1,
              classLevel: "class1",
              bloomLevel: toBloomLevel(row["Bloom's Level"] || row["Bloom Level"] || "Remembering"),
              questionType: "mcq",
              question: `Which statement correctly applies to: ${subtopic || topic}?`,
              options: [
                `${learningObjective}`,
                `It is an unrelated syntax rule not used in ${subject}.`,
                `It applies only to server compilation.`,
                `It is a deprecated feature replaced in modern standards.`
              ],
              correctAnswer: "A",
              explanation: `${learningObjective}`,
              keywords: [subject, topic, subtopic, learningObjective],
              region: "global",
              payload: {
                options: [
                  { text: learningObjective, correct: true },
                  { text: `It is an unrelated syntax rule not used in ${subject}.`, correct: false },
                  { text: `It applies only to server compilation.`, correct: false },
                  { text: `It is a deprecated feature replaced in modern standards.`, correct: false }
                ],
                explanation: learningObjective
              }
            };
            questions.push(mcqQuestion);
          }
        }
      }
    } catch (err) {
      console.error(`[csv-coding-loader] Error reading ${file}:`, err);
    }
  }

  cachedCodingData = {
    questions,
    catalogEntries: Array.from(catalogMap.values()),
  };

  return cachedCodingData;
}

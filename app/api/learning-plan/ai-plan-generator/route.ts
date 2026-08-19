import { NextResponse } from "next/server"
import OpenAI from "openai"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { student, topics } = body

    if (!student || !topics || !Array.isArray(topics)) {
      return NextResponse.json(
        { error: "student and topics are required" },
        { status: 400 }
      )
    }

    // Full-year package from Grade 5 workbook: 66 teaching + 13 structural = 79
    const availableClasses = student.classesRemaining || 79
    const highPriorityTopics = topics.filter((t: any) => t.priority === "high")
    const totalIdealHighClasses = highPriorityTopics.reduce(
      (sum: number, t: any) => sum + (t.idealClasses || 5),
      0
    )

    const isCapacityExceeded = totalIdealHighClasses > availableClasses

    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      // Local fallback calculation if no API key
      const classAdjustments: Record<number, { classes: number; activities: number; reason: string }> = {}
      let currentTotal = totalIdealHighClasses

      if (isCapacityExceeded) {
        for (const topic of highPriorityTopics) {
          if (currentTotal <= availableClasses) break
          const placementResult = (student.placementResults || []).find((r: any) => r.topicId === topic.id)
          const score = placementResult?.score ?? student.defaultPlacementScore ?? 75

          // Rule H1: never compress a topic below its Minimum Classes.
          const minimumClasses = topic.minimumClasses ?? 3
          if (score >= 60 && topic.idealClasses > minimumClasses) {
            const newClasses = Math.max(minimumClasses, topic.idealClasses - 2)
            const newActivities = Math.floor(newClasses * 3.5)
            classAdjustments[topic.id] = {
              classes: newClasses,
              activities: newActivities,
              reason: `AI reduced allocation from ${topic.idealClasses} to ${newClasses} classes (minimum ${minimumClasses}) based on ${score}% placement score to fit ${availableClasses}-class package capacity.`,
            }
            currentTotal -= topic.idealClasses - newClasses
          }
        }
      }

      return NextResponse.json({
        strategy: isCapacityExceeded
          ? `Package capacity constraint: Total ideal classes (${totalIdealHighClasses}) exceeded available package capacity (${availableClasses}). AI analyzed placement scores and compressed High-priority topics with strong performance to fit your ${availableClasses}-class package.`
          : `Standard curriculum allocation: Total required classes (${totalIdealHighClasses}) fit within available ${availableClasses}-class package capacity.`,
        evidenceSummary: [
          `Package capacity: ${availableClasses} classes`,
          `${Object.keys(classAdjustments).length} High-priority topics compressed by AI`,
        ],
        recommendations: [],
        classAdjustments,
        provider: "fallback-local",
      })
    }

    const openai = new OpenAI({ apiKey })
    const prompt = `
You are an expert AI Maths Curriculum Strategist for Grade 5 Mathematics.
Analyze student "${student.name}" and live Grade 5 DB curriculum:

Student Profile:
- Package Available Classes: ${availableClasses}
- Placement Status: ${student.placementStatus}
- Placement Test Scores: ${JSON.stringify(student.placementResults || [])}
- Mastery Observations: ${JSON.stringify(student.objectiveEvidence || [])}

Live High-Priority Topics (${highPriorityTopics.length} topics, Total Ideal Classes: ${totalIdealHighClasses}):
${JSON.stringify(
  highPriorityTopics.map((t: any) => ({
    id: t.id,
    name: t.name,
    priority: t.priority,
    idealClasses: t.idealClasses,
    minimumClasses: t.minimumClasses,
    idealActivities: t.idealActivities,
  }))
)}

INSTRUCTIONS:
1. Compare total ideal classes (${totalIdealHighClasses}) against package capacity (${availableClasses} classes).
2. If capacity is exceeded or tight, analyze placement test scores and select High-priority topics with strong student performance (score >= 70%) to compress by 1-2 classes.
3. HARD RULE (H1): never allocate a topic fewer classes than its minimumClasses value. Compression stops at that floor.
4. Calculate proportional activities (max 3.5 per class).
5. Output a 1-2 sentence direct AI strategy summary explaining to the user how AI managed classes and activities to fit the package capacity limit.

Return ONLY a valid JSON object in this exact format:
{
  "strategy": "AI strategy explanation for the user...",
  "evidenceSummary": ["Point 1", "Point 2"],
  "recommendations": [],
  "classAdjustments": {
    "<topicId>": {
      "classes": 3,
      "activities": 10,
      "reason": "Compressed by AI from 5 to 3 classes based on 85% placement score to fit package limit."
    }
  }
}
`

    const response = await openai.chat.completions.create({
      model: "gpt-5.6-luna",
      messages: [
        {
          role: "system",
          content:
            "You are a precise AI curriculum engine. Output direct, factual JSON strategy without pleasantries.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
    })

    const content = response.choices[0]?.message?.content || "{}"
    const parsedData = JSON.parse(content)

    return NextResponse.json({
      strategy: parsedData.strategy || "AI learning plan strategy generated.",
      evidenceSummary: parsedData.evidenceSummary || [
        `${student.placementResults?.length || 0} placement topic scores evaluated`,
      ],
      recommendations: parsedData.recommendations || [],
      classAdjustments: parsedData.classAdjustments || {},
      provider: "openai-gpt-5.6-luna",
    })
  } catch (error) {
    console.error("AI Plan Generator API error:", error)
    return NextResponse.json(
      { error: "AI call failed", strategy: "Fallback strategy applied." },
      { status: 500 }
    )
  }
}

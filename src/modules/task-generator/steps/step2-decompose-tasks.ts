import { v4 as uuidv4 } from "uuid";
import { DECOMPOSE_TASKS_INSTRUCTION } from "../system-instruction";
import { PipelineRun, PipelineModule } from "../pipeline-model";
import { ai, GEMINI_MODEL, ExtractedIntent, TaskPlan, StepResult } from "./types";

// ============================================================================
// Step 2: Decompose Tasks
// ============================================================================

export async function runStep2(
    pipelineId: string,
    intent: ExtractedIntent
): Promise<StepResult> {

    const moduleId = uuidv4();
    const mod = new PipelineModule({
        moduleId,
        pipelineId,
        step: 2,
        moduleName: "decompose_tasks",
        status: "running",
        input: intent
    });
    await mod.save();

    console.log(`[Pipeline:Step2] Decomposing tasks...`);

    const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [{ role: "user", parts: [{ text: JSON.stringify(intent) }] }],
        config: {
            systemInstruction: DECOMPOSE_TASKS_INSTRUCTION,
            responseMimeType: "application/json"
        }
    }).catch((err: Error) => {
        console.error(`[Pipeline:Step2] Gemini error:`, err.message);
        return null;
    });

    if (!response || !response.text) {
        mod.status = "error";
        mod.error = "Failed to decompose tasks from Gemini";
        await mod.save();
        await PipelineRun.updateOne({ pipelineId }, { $set: { status: "error" } });
        return { success: false, module: mod, error: mod.error };
    }

    const cleaned = response.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned) as TaskPlan;

    mod.output = parsed as unknown as Record<string, unknown>;
    mod.status = "waiting_confirm";
    await mod.save();

    await PipelineRun.updateOne(
        { pipelineId },
        { $set: { status: "waiting_confirm", currentStep: 2 } }
    );

    console.log(`[Pipeline:Step2] Decomposed into ${parsed.subTasks.length} sub-task(s) - waiting confirm`);
    return { success: true, module: mod };
}

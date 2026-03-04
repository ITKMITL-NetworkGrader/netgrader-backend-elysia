import { v4 as uuidv4 } from "uuid";
import { EXTRACT_INTENT_INSTRUCTION } from "../system-instruction";
import { PipelineRun, PipelineModule } from "../pipeline-model";
import { ai, GEMINI_MODEL, ExtractedIntent, StepResult } from "./types";

// ============================================================================
// Step 1: Extract Intent
// ============================================================================

export async function runStep1(
    pipelineId: string,
    message: string
): Promise<StepResult> {

    const moduleId = uuidv4();
    const mod = new PipelineModule({
        moduleId,
        pipelineId,
        step: 1,
        moduleName: "extract_intent",
        status: "running",
        input: { message }
    });
    await mod.save();

    console.log(`[Pipeline:Step1] Extracting intent...`);

    const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [{ role: "user", parts: [{ text: message }] }],
        config: {
            systemInstruction: EXTRACT_INTENT_INSTRUCTION,
            responseMimeType: "application/json"
        }
    }).catch((err: Error) => {
        console.error(`[Pipeline:Step1] Gemini error:`, err.message);
        return null;
    });

    if (!response || !response.text) {
        mod.status = "error";
        mod.error = "Failed to extract intent from Gemini";
        await mod.save();
        await PipelineRun.updateOne({ pipelineId }, { $set: { status: "error" } });
        return { success: false, module: mod, error: mod.error };
    }

    const cleaned = response.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned) as ExtractedIntent;

    mod.output = parsed as unknown as Record<string, unknown>;
    mod.status = "waiting_confirm";
    await mod.save();

    await PipelineRun.updateOne(
        { pipelineId },
        { $set: { status: "waiting_confirm", currentStep: 1 } }
    );

    console.log(`[Pipeline:Step1] Extracted ${parsed.intent.actions.length} action(s) - waiting confirm`);
    return { success: true, module: mod };
}

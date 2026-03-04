import { env } from "process";
import { v4 as uuidv4 } from "uuid";
import { GENERATE_SCRIPT_INSTRUCTION } from "../system-instruction";
import { PipelineRun, PipelineModule } from "../pipeline-model";
import { ScriptRegistry } from "../script-registry-model";
import {
    ai, GEMINI_MODEL, FASTAPI_URL,
    SubTask, TaskPlan, ScriptMatchResult, StepResult,
    parseArgparseFromCode
} from "./types";
import { runStep5 } from "./step5-execute-tasks";

// ============================================================================
// Step 4: Generate Missing Scripts
// ============================================================================

export async function runStep4(
    pipelineId: string,
    taskPlan: TaskPlan,
    checkResults: ScriptMatchResult[]
): Promise<StepResult> {

    const missingTasks = checkResults
        .filter(r => !r.found)
        .map(r => taskPlan.subTasks.find(t => t.id === r.id))
        .filter((t): t is SubTask => t !== undefined);

    if (missingTasks.length === 0) {
        // No scripts to generate - create skipped module
        const moduleId = uuidv4();
        const mod = new PipelineModule({
            moduleId,
            pipelineId,
            step: 4,
            moduleName: "generate_scripts",
            status: "skipped",
            input: { message: "All scripts already available" },
            output: { generatedScripts: [], skipped: true }
        });
        await mod.save();

        await PipelineRun.updateOne(
            { pipelineId },
            { $set: { currentStep: 4 } }
        );

        // Auto-proceed to step 5
        return runStep5(pipelineId, taskPlan, checkResults);
    }

    const moduleId = uuidv4();
    const mod = new PipelineModule({
        moduleId,
        pipelineId,
        step: 4,
        moduleName: "generate_scripts",
        status: "running",
        input: { missingTasks }
    });
    await mod.save();

    console.log(`[Pipeline:Step4] Generating ${missingTasks.length} script(s)...`);

    const generatedScripts: {
        action: string;
        success: boolean;
        scriptId?: string;
        code?: string;
        savedPath?: string;
        error?: string;
    }[] = [];

    for (const task of missingTasks) {
        const genResult = await generateAndRegisterScript(task);
        generatedScripts.push(genResult);
    }

    const allSuccess = generatedScripts.every(g => g.success);

    mod.output = { generatedScripts } as unknown as Record<string, unknown>;
    mod.status = "waiting_confirm";
    if (!allSuccess) {
        mod.error = "Some scripts failed to generate";
    }
    await mod.save();

    await PipelineRun.updateOne(
        { pipelineId },
        { $set: { status: "waiting_confirm", currentStep: 4 } }
    );

    console.log(`[Pipeline:Step4] Generated ${generatedScripts.filter(g => g.success).length}/${missingTasks.length} - waiting confirm`);
    return { success: true, module: mod };
}

// ============================================================================
// Helper: Generate Script + Register in DB
// ============================================================================

async function generateAndRegisterScript(
    subTask: SubTask
): Promise<{
    action: string;
    success: boolean;
    scriptId?: string;
    code?: string;
    savedPath?: string;
    error?: string;
}> {
    if (!env.GEMINI_API_KEY) {
        return { action: subTask.action, success: false, error: "GEMINI_API_KEY is not configured" };
    }

    console.log(`[Pipeline:Generate] Generating script for: ${subTask.action} (${subTask.deviceType}/${subTask.os})`);

    const prompt = `Generate a Python script for the following network task:
- Action: ${subTask.action}
- Device Type: ${subTask.deviceType}
- OS: ${subTask.os}
- Description: ${subTask.description}
- Parameters: ${JSON.stringify(subTask.params)}

The script must use argparse for parameters and output JSON to stdout.`;

    const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
            systemInstruction: GENERATE_SCRIPT_INSTRUCTION
        }
    }).catch((err: Error) => {
        console.error(`[Pipeline:Generate] Gemini error:`, err.message);
        return null;
    });

    if (!response || !response.text) {
        return { action: subTask.action, success: false, error: "Failed to generate script from Gemini" };
    }

    let code = response.text;
    code = code.replace(/^```python\n?/m, "").replace(/```\n?$/m, "").trim();

    // Save script file via FastAPI
    const savePayload = {
        device_type: subTask.deviceType,
        os: subTask.os,
        action: subTask.action,
        code,
        description: subTask.description
    };

    const saveResponse = await fetch(`${FASTAPI_URL}/task-generator/scripts/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(savePayload)
    }).catch((err: Error) => {
        console.error(`[Pipeline:Generate] FastAPI save error:`, err.message);
        return null;
    });

    if (!saveResponse || !saveResponse.ok) {
        return { action: subTask.action, success: false, error: "Failed to save script to FastAPI" };
    }

    const saveData = await saveResponse.json() as {
        success: boolean;
        script_path: string | null;
    };

    // Parse argparse arguments from generated code
    const parsedArgs = parseArgparseFromCode(code);

    // Register in DB
    const scriptPath = `${subTask.deviceType}/${subTask.os}/${subTask.action}.py`;
    const scriptId = uuidv4();

    await ScriptRegistry.findOneAndUpdate(
        { action: subTask.action, deviceType: subTask.deviceType, os: subTask.os },
        {
            $set: {
                scriptId,
                description: subTask.description,
                arguments: parsedArgs,
                scriptPath,
                source: "generated"
            }
        },
        { upsert: true, new: true }
    );

    console.log(`[Pipeline:Generate] Script saved + registered: ${scriptPath}`);

    return {
        action: subTask.action,
        success: true,
        scriptId,
        code,
        savedPath: saveData.script_path || scriptPath
    };
}

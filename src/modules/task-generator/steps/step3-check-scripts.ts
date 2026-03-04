import { v4 as uuidv4 } from "uuid";
import { PipelineRun, PipelineModule } from "../pipeline-model";
import { ScriptRegistry, IScriptRegistry } from "../script-registry-model";
import { TaskPlan, ScriptMatchResult, StepResult } from "./types";

// ============================================================================
// Step 3: Check Scripts (from DB Registry + argument matching)
// ============================================================================

export async function runStep3(
    pipelineId: string,
    taskPlan: TaskPlan
): Promise<StepResult> {

    const moduleId = uuidv4();
    const mod = new PipelineModule({
        moduleId,
        pipelineId,
        step: 3,
        moduleName: "check_scripts",
        status: "running",
        input: { subTasks: taskPlan.subTasks }
    });
    await mod.save();

    console.log(`[Pipeline:Step3] Checking scripts from DB registry...`);

    const registry = await ScriptRegistry.find({}).lean() as unknown as IScriptRegistry[];
    const results: ScriptMatchResult[] = [];

    for (const subTask of taskPlan.subTasks) {
        const candidates = registry.filter(
            s => s.action === subTask.action
                && s.deviceType === subTask.deviceType
                && s.os === subTask.os
        );

        if (candidates.length === 0) {
            results.push({
                id: subTask.id,
                action: subTask.action,
                deviceType: subTask.deviceType,
                os: subTask.os,
                found: false,
                scriptId: null,
                scriptPath: null,
                matchedArguments: [],
                missingArguments: [],
                argumentMatch: false
            });
            continue;
        }

        let bestMatch: IScriptRegistry | null = null;
        let bestMissingArgs: string[] = [];
        let bestArgumentMatch = false;

        for (const candidate of candidates) {
            const requiredArgs = candidate.arguments
                .filter(a => a.required)
                .map(a => a.name);

            const providedParams = Object.keys(subTask.params || {});
            const missingArgs = requiredArgs.filter(
                arg => !providedParams.includes(arg)
            );

            const allArgNames = candidate.arguments.map(a => a.name);
            const taskParamNames = Object.keys(subTask.params || {});

            const unsupportedArgs = taskParamNames.filter(
                p => !allArgNames.includes(p)
            );

            if (missingArgs.length === 0 && unsupportedArgs.length === 0) {
                bestMatch = candidate;
                bestMissingArgs = [];
                bestArgumentMatch = true;
                break;
            }

            if (!bestMatch || missingArgs.length < bestMissingArgs.length) {
                bestMatch = candidate;
                bestMissingArgs = missingArgs;
                bestArgumentMatch = missingArgs.length === 0;
            }
        }

        if (bestMatch && bestArgumentMatch) {
            results.push({
                id: subTask.id,
                action: subTask.action,
                deviceType: subTask.deviceType,
                os: subTask.os,
                found: true,
                scriptId: bestMatch.scriptId,
                scriptPath: bestMatch.scriptPath,
                matchedArguments: bestMatch.arguments,
                missingArguments: [],
                argumentMatch: true
            });
        } else {
            results.push({
                id: subTask.id,
                action: subTask.action,
                deviceType: subTask.deviceType,
                os: subTask.os,
                found: false,
                scriptId: bestMatch?.scriptId || null,
                scriptPath: null,
                matchedArguments: bestMatch?.arguments || [],
                missingArguments: bestMissingArgs,
                argumentMatch: false
            });
        }
    }

    const foundCount = results.filter(r => r.found).length;
    const missingCount = results.filter(r => !r.found).length;

    mod.output = { results, foundCount, missingCount } as unknown as Record<string, unknown>;
    mod.status = "waiting_confirm";
    await mod.save();

    await PipelineRun.updateOne(
        { pipelineId },
        { $set: { status: "waiting_confirm", currentStep: 3 } }
    );

    console.log(`[Pipeline:Step3] Found: ${foundCount}, Missing: ${missingCount} - waiting confirm`);
    return { success: true, module: mod };
}

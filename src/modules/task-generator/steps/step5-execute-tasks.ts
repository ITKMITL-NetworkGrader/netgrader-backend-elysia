import { v4 as uuidv4 } from "uuid";
import { PipelineRun, PipelineModule } from "../pipeline-model";
import { ScriptRegistry, IScriptRegistry } from "../script-registry-model";
import {
    TaskPlan, ScriptMatchResult, ExecutionPlanItem,
    StepResult, validateArguments
} from "./types";

// ============================================================================
// Step 5: Prepare Execution Plan (show what will run -> wait for confirm)
// ============================================================================

export async function runStep5(
    pipelineId: string,
    taskPlan: TaskPlan,
    checkResults: ScriptMatchResult[]
): Promise<StepResult> {

    const moduleId = uuidv4();
    const mod = new PipelineModule({
        moduleId,
        pipelineId,
        step: 5,
        moduleName: "execute_tasks",
        status: "running",
        input: { subTasks: taskPlan.subTasks }
    });
    await mod.save();

    console.log(`[Pipeline:Step5] Preparing execution plan...`);

    // Validate arguments
    const registry = await ScriptRegistry.find({}).lean() as unknown as IScriptRegistry[];
    const validationResults = validateArguments(taskPlan.subTasks, registry);
    const invalidTasks = validationResults.filter(v => !v.valid);

    if (invalidTasks.length > 0) {
        mod.status = "error";
        mod.error = "Argument validation failed - required arguments are missing";
        mod.output = {
            validationErrors: invalidTasks,
            message: "Required arguments are missing. Please retry from Step 1 to provide the necessary information."
        } as unknown as Record<string, unknown>;
        await mod.save();

        await PipelineRun.updateOne(
            { pipelineId },
            { $set: { status: "error", currentStep: 5 } }
        );

        console.log(`[Pipeline:Step5] Validation failed: ${invalidTasks.length} task(s) missing args`);
        return {
            success: false,
            module: mod,
            error: `Argument validation failed for ${invalidTasks.length} task(s)`
        };
    }

    // Build execution plan: resolve script paths from registry or check results
    const executionPlan: ExecutionPlanItem[] = [];

    for (const subTask of taskPlan.subTasks) {
        // Find script from check results (Step 3) or registry
        const checkResult = checkResults.find(r => r.id === subTask.id);
        let scriptPath = checkResult?.scriptPath || null;

        if (!scriptPath) {
            // Try to find from registry (might have been generated in Step 4)
            const registryEntry = registry.find(
                s => s.action === subTask.action
                    && s.deviceType === subTask.deviceType
                    && s.os === subTask.os
            );
            scriptPath = registryEntry?.scriptPath || `${subTask.deviceType}/${subTask.os}/${subTask.action}.py`;
        }

        // Find script arguments from registry
        const registryEntry = registry.find(
            s => s.action === subTask.action
                && s.deviceType === subTask.deviceType
                && s.os === subTask.os
        );

        executionPlan.push({
            taskId: subTask.id,
            action: subTask.action,
            deviceType: subTask.deviceType,
            os: subTask.os,
            sourceDevice: subTask.sourceDevice,
            targetDevice: subTask.targetDevice,
            scriptPath,
            arguments: subTask.params,
            scriptArguments: registryEntry?.arguments || []
        });
    }

    mod.output = {
        executionPlan,
        taskCount: executionPlan.length,
        message: "Review the execution plan below. Each task shows the script file and arguments that will be used."
    } as unknown as Record<string, unknown>;
    mod.status = "waiting_confirm";
    await mod.save();

    await PipelineRun.updateOne(
        { pipelineId },
        { $set: { status: "waiting_confirm", currentStep: 5 } }
    );

    console.log(`[Pipeline:Step5] Execution plan ready (${executionPlan.length} task(s)) - waiting confirm`);
    return { success: true, module: mod };
}

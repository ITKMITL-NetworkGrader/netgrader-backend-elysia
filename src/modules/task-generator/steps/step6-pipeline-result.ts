import { v4 as uuidv4 } from "uuid";
import { PipelineRun, PipelineModule, IPipelineModule, IPipelineRun } from "../pipeline-model";
import { TaskGeneratorService } from "../service";
import {
    FASTAPI_URL, MODEL_DISPLAY_NAME,
    TaskPlan, ExecutionPlanItem, TaskExecutionResult, ScriptMatchResult, StepResult
} from "./types";

// ============================================================================
// Step 6: Execute Tasks + Build Result Summary (auto-complete, no confirm)
// ============================================================================

export async function runStep6(
    pipelineId: string,
    allModules: IPipelineModule[],
    pipeline: IPipelineRun
): Promise<StepResult> {

    const moduleId = uuidv4();
    const mod = new PipelineModule({
        moduleId,
        pipelineId,
        step: 6,
        moduleName: "pipeline_result",
        status: "running",
        input: { message: "Executing tasks and compiling results..." }
    });
    await mod.save();

    // Get execution plan from Step 5
    const step5Output = allModules.find(m => m.step === 5)?.output as unknown as {
        executionPlan?: ExecutionPlanItem[];
    } | undefined;

    const step2Output = allModules.find(m => m.step === 2)?.output as unknown as TaskPlan | undefined;

    if (!step5Output?.executionPlan || !step2Output) {
        mod.status = "error";
        mod.error = "Step 5 execution plan or Step 2 task plan not found";
        await mod.save();
        await PipelineRun.updateOne({ pipelineId }, { $set: { status: "error" } });
        return { success: false, module: mod, error: mod.error };
    }

    // Execute tasks via FastAPI
    console.log(`[Pipeline:Step6] Executing ${step5Output.executionPlan.length} task(s)...`);

    const payload = {
        tasks: step2Output.subTasks.map(t => ({
            id: t.id,
            action: t.action,
            device_type: t.deviceType,
            os: t.os,
            source_device: t.sourceDevice,
            target_device: t.targetDevice,
            params: t.params
        }))
    };

    const response = await fetch(`${FASTAPI_URL}/task-generator/scripts/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    }).catch((err: Error) => {
        console.error(`[Pipeline:Step6] FastAPI error:`, err.message);
        return null;
    });

    if (!response || !response.ok) {
        mod.status = "error";
        mod.error = "Failed to connect to FastAPI execution service";
        await mod.save();
        await PipelineRun.updateOne({ pipelineId }, { $set: { status: "error" } });
        return { success: false, module: mod, error: mod.error };
    }

    const data = await response.json() as {
        total: number;
        success_count: number;
        failure_count: number;
        results: TaskExecutionResult[];
    };

    // Build text summary (no AI)
    const summary = buildResultSummary(
        step2Output,
        step5Output.executionPlan,
        data.results,
        data.success_count,
        data.failure_count
    );

    mod.output = {
        results: data.results,
        successCount: data.success_count,
        failureCount: data.failure_count,
        summary
    } as unknown as Record<string, unknown>;

    // Auto-complete: set status to confirmed directly (no user confirm needed)
    mod.status = "confirmed";
    mod.confirmedAt = new Date();
    await mod.save();

    // Save summary as model message in chat history
    await TaskGeneratorService.saveMessage(
        pipeline.sessionId,
        "model",
        summary,
        null,
        MODEL_DISPLAY_NAME
    );

    // Mark pipeline as completed
    await PipelineRun.updateOne(
        { pipelineId },
        { $set: { status: "completed", currentStep: 6 } }
    );

    console.log(`[Pipeline:Step6] Execution complete. Success: ${data.success_count}, Failed: ${data.failure_count}. Pipeline completed.`);
    return { success: true, module: mod };
}

// ============================================================================
// Helper: Build Result Summary (plain text, no AI)
// ============================================================================

function buildResultSummary(
    taskPlan: TaskPlan,
    executionPlan: ExecutionPlanItem[],
    results: TaskExecutionResult[],
    successCount: number,
    failureCount: number
): string {
    const lines: string[] = [];
    const total = results.length;

    lines.push(`## Pipeline Execution Results`);
    lines.push(`**Main Task:** ${taskPlan.mainTask}`);
    lines.push(`**Total Tasks:** ${total} | **Passed:** ${successCount} | **Failed:** ${failureCount}`);
    lines.push("");

    for (const r of results) {
        const plan = executionPlan.find(p => p.taskId === r.id);
        const icon = r.success ? "[PASS]" : "[FAIL]";

        lines.push(`### ${icon} Task ${r.id}: ${r.action}`);
        if (plan) {
            lines.push(`- **Script:** \`${plan.scriptPath}\``);
            const argStr = Object.entries(plan.arguments)
                .map(([k, v]) => `--${k} ${v}`)
                .join(" ");
            if (argStr) {
                lines.push(`- **Arguments:** \`${argStr}\``);
            }
        }

        if (r.output) {
            lines.push(`- **Output:**`);
            lines.push(`\`\`\``);
            lines.push(r.output);
            lines.push(`\`\`\``);
        }
        if (r.error) {
            lines.push(`- **Error:** ${r.error}`);
        }
        lines.push("");
    }

    // Overall summary
    if (failureCount === 0) {
        lines.push(`---`);
        lines.push(`All ${total} task(s) completed successfully.`);
    } else {
        lines.push(`---`);
        lines.push(`${failureCount} of ${total} task(s) failed. Please review the errors above.`);
    }

    return lines.join("\n");
}

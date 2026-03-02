import { env } from "process";
import { GoogleGenAI } from "@google/genai";
import { v4 as uuidv4 } from "uuid";
import "dotenv/config";
import {
    EXTRACT_INTENT_INSTRUCTION,
    DECOMPOSE_TASKS_INSTRUCTION,
    GENERATE_SCRIPT_INSTRUCTION
} from "./system-instruction";
import { PipelineRun, PipelineModule, IPipelineRun, IPipelineModule } from "./pipeline-model";
import { ScriptRegistry, IScriptRegistry, IScriptArgument } from "./script-registry-model";
import { TaskGeneratorService } from "./service";

// ============================================================================
// Gemini AI Client
// ============================================================================

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY || "" });
const GEMINI_MODEL = "gemini-2.5-flash";

// FastAPI MCP Server URL
const FASTAPI_URL = env.FASTAPI_MCP_URL || "http://localhost:8000";

// ============================================================================
// Types
// ============================================================================

interface IntentAction {
    action: string;
    sourceDevice: string;
    targetDevice: string | null;
    deviceType: "host" | "network_device";
    os: "linux" | "cisco";
    params: Record<string, string>;
}

interface ExtractedIntent {
    intent: {
        description: string;
        actions: IntentAction[];
    };
}

interface SubTask {
    id: number;
    action: string;
    deviceType: "host" | "network_device";
    os: "linux" | "cisco";
    sourceDevice: string;
    targetDevice: string | null;
    description: string;
    params: Record<string, string>;
}

interface TaskPlan {
    mainTask: string;
    subTasks: SubTask[];
}

interface ScriptMatchResult {
    id: number;
    action: string;
    deviceType: string;
    os: string;
    found: boolean;
    scriptId: string | null;
    scriptPath: string | null;
    matchedArguments: IScriptArgument[];
    missingArguments: string[];
    argumentMatch: boolean;
}

interface ArgumentValidationResult {
    valid: boolean;
    taskId: number;
    action: string;
    missingArgs: string[];
}

interface TaskExecutionResult {
    id: number;
    action: string;
    success: boolean;
    output: string | null;
    error: string | null;
}

// ============================================================================
// Pipeline Service (Step-by-Step)
// ============================================================================

export class PipelineService {

    // ========================================================================
    // Start Pipeline (Step 1)
    // ========================================================================

    static async startPipeline(
        sessionId: string,
        message: string,
        userId: string
    ): Promise<{
        success: boolean;
        pipelineId?: string;
        module?: IPipelineModule;
        error?: string;
    }> {
        if (!env.GEMINI_API_KEY) {
            return { success: false, error: "GEMINI_API_KEY is not configured" };
        }

        // Save user message to chat history
        await TaskGeneratorService.saveMessage(sessionId, "user", message, userId, null);

        // Create PipelineRun
        const pipelineId = uuidv4();
        const pipeline = new PipelineRun({
            pipelineId,
            sessionId,
            userId,
            userMessage: message,
            status: "running",
            currentStep: 1
        });
        await pipeline.save();

        // Run Step 1: Extract Intent
        const moduleResult = await this.runStep1(pipelineId, message);

        return {
            success: moduleResult.success,
            pipelineId,
            module: moduleResult.module,
            error: moduleResult.error
        };
    }

    // ========================================================================
    // Confirm Module -> Run Next Step
    // ========================================================================

    static async confirmModule(
        pipelineId: string,
        moduleId: string
    ): Promise<{
        success: boolean;
        nextModule?: IPipelineModule;
        pipelineCompleted?: boolean;
        validationErrors?: ArgumentValidationResult[];
        error?: string;
    }> {
        // Get current module
        const currentModule = await PipelineModule.findOne({ pipelineId, moduleId });
        if (!currentModule) {
            return { success: false, error: "Module not found" };
        }

        if (currentModule.status !== "waiting_confirm") {
            return { success: false, error: `Module is not waiting for confirmation (status: ${currentModule.status})` };
        }

        // Mark as confirmed
        currentModule.status = "confirmed";
        currentModule.confirmedAt = new Date();
        await currentModule.save();

        // Get pipeline
        const pipeline = await PipelineRun.findOne({ pipelineId });
        if (!pipeline) {
            return { success: false, error: "Pipeline not found" };
        }

        // Determine and run next step
        const nextStep = currentModule.step + 1;

        // Get all previous modules for context
        const allModules = await PipelineModule.find({ pipelineId }).sort({ step: 1 }).lean() as unknown as IPipelineModule[];

        const result = await this.runNextStep(pipelineId, nextStep, allModules, pipeline);
        return result;
    }

    // ========================================================================
    // Retry Module
    // ========================================================================

    static async retryModule(
        pipelineId: string,
        moduleId: string,
        userFeedback?: string
    ): Promise<{
        success: boolean;
        module?: IPipelineModule;
        error?: string;
    }> {
        const currentModule = await PipelineModule.findOne({ pipelineId, moduleId });
        if (!currentModule) {
            return { success: false, error: "Module not found" };
        }

        // Delete all modules AFTER this step
        await PipelineModule.deleteMany({
            pipelineId,
            step: { $gt: currentModule.step }
        });

        // Update pipeline currentStep
        await PipelineRun.updateOne(
            { pipelineId },
            { $set: { currentStep: currentModule.step, status: "running" } }
        );

        // Delete the current module (will re-create)
        await PipelineModule.deleteOne({ pipelineId, moduleId });

        // Get previous modules for context
        const previousModules = await PipelineModule.find({
            pipelineId,
            step: { $lt: currentModule.step }
        }).sort({ step: 1 }).lean() as unknown as IPipelineModule[];

        // Re-run this step
        const result = await this.rerunStep(
            pipelineId,
            currentModule.step,
            currentModule.moduleName,
            previousModules,
            userFeedback
        );

        return result;
    }

    // ========================================================================
    // Get Pipeline Run with Modules
    // ========================================================================

    static async getPipelineRun(pipelineId: string): Promise<{
        pipeline: IPipelineRun | null;
        modules: IPipelineModule[];
    }> {
        const pipeline = await PipelineRun.findOne({ pipelineId }).lean() as unknown as IPipelineRun | null;
        const modules = await PipelineModule.find({ pipelineId })
            .sort({ step: 1 })
            .lean() as unknown as IPipelineModule[];

        return { pipeline, modules };
    }

    // ========================================================================
    // Get Pipeline History for Session
    // ========================================================================

    static async getPipelineHistory(sessionId: string): Promise<IPipelineRun[]> {
        return PipelineRun.find({ sessionId })
            .sort({ createdAt: -1 })
            .lean() as unknown as IPipelineRun[];
    }

    // ========================================================================
    // Script Registry CRUD
    // ========================================================================

    static async getScriptRegistry(): Promise<IScriptRegistry[]> {
        return ScriptRegistry.find({}).lean() as unknown as IScriptRegistry[];
    }

    static async addScriptToRegistry(data: {
        action: string;
        deviceType: "host" | "network_device";
        os: "linux" | "cisco";
        description: string;
        arguments: IScriptArgument[];
        scriptPath: string;
        source: "manual" | "generated";
    }): Promise<IScriptRegistry> {
        const entry = new ScriptRegistry({
            scriptId: uuidv4(),
            ...data
        });
        return entry.save();
    }

    // ========================================================================
    // Internal: Run Steps
    // ========================================================================

    private static async runStep1(
        pipelineId: string,
        message: string
    ): Promise<{ success: boolean; module?: IPipelineModule; error?: string }> {

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

    private static async runStep2(
        pipelineId: string,
        intent: ExtractedIntent
    ): Promise<{ success: boolean; module?: IPipelineModule; error?: string }> {

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

    private static async runStep3(
        pipelineId: string,
        taskPlan: TaskPlan
    ): Promise<{ success: boolean; module?: IPipelineModule; error?: string }> {

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

        // Fetch all scripts from registry
        const registry = await ScriptRegistry.find({}).lean() as unknown as IScriptRegistry[];

        const results: ScriptMatchResult[] = [];

        for (const subTask of taskPlan.subTasks) {
            // Find matching scripts by action + deviceType + os
            const candidates = registry.filter(
                s => s.action === subTask.action
                    && s.deviceType === subTask.deviceType
                    && s.os === subTask.os
            );

            if (candidates.length === 0) {
                // No script found at all
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

            // Check argument matching for each candidate
            let bestMatch: IScriptRegistry | null = null;
            let bestMissingArgs: string[] = [];
            let bestArgumentMatch = false;

            for (const candidate of candidates) {
                // Get required arguments from the script
                const requiredArgs = candidate.arguments
                    .filter(a => a.required)
                    .map(a => a.name);

                // Check which required args are provided by the subTask params
                const providedParams = Object.keys(subTask.params || {});
                const missingArgs = requiredArgs.filter(
                    arg => !providedParams.includes(arg)
                );

                const allArgNames = candidate.arguments.map(a => a.name);
                const taskParamNames = Object.keys(subTask.params || {});

                // Check if task needs args that script doesn't support
                const unsupportedArgs = taskParamNames.filter(
                    p => !allArgNames.includes(p)
                );

                // Perfect match: no missing required args AND no unsupported args
                if (missingArgs.length === 0 && unsupportedArgs.length === 0) {
                    bestMatch = candidate;
                    bestMissingArgs = [];
                    bestArgumentMatch = true;
                    break;
                }

                // Partial match: track the best one
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
                // Script exists but arguments don't match -> needs generation
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

    private static async runStep4(
        pipelineId: string,
        taskPlan: TaskPlan,
        checkResults: ScriptMatchResult[]
    ): Promise<{ success: boolean; module?: IPipelineModule; error?: string }> {

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
            return this.runStep5(pipelineId, taskPlan);
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
            const genResult = await this.generateAndRegisterScript(task);
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

    private static async runStep5(
        pipelineId: string,
        taskPlan: TaskPlan
    ): Promise<{ success: boolean; module?: IPipelineModule; error?: string }> {

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

        console.log(`[Pipeline:Step5] Validating arguments before execution...`);

        // Validate arguments
        const registry = await ScriptRegistry.find({}).lean() as unknown as IScriptRegistry[];
        const validationResults = this.validateArguments(taskPlan.subTasks, registry);
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

        // Execute tasks via FastAPI
        console.log(`[Pipeline:Step5] Executing ${taskPlan.subTasks.length} task(s)...`);

        const payload = {
            tasks: taskPlan.subTasks.map(t => ({
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
            console.error(`[Pipeline:Step5] FastAPI error:`, err.message);
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

        mod.output = {
            results: data.results,
            successCount: data.success_count,
            failureCount: data.failure_count
        } as unknown as Record<string, unknown>;
        mod.status = "waiting_confirm";
        await mod.save();

        await PipelineRun.updateOne(
            { pipelineId },
            { $set: { status: "waiting_confirm", currentStep: 5 } }
        );

        console.log(`[Pipeline:Step5] Success: ${data.success_count}, Failed: ${data.failure_count} - waiting confirm`);
        return { success: true, module: mod };
    }

    // ========================================================================
    // Internal: Run Next Step Router
    // ========================================================================

    private static async runNextStep(
        pipelineId: string,
        nextStep: number,
        allModules: IPipelineModule[],
        pipeline: IPipelineRun
    ): Promise<{
        success: boolean;
        nextModule?: IPipelineModule;
        pipelineCompleted?: boolean;
        validationErrors?: ArgumentValidationResult[];
        error?: string;
    }> {
        // Extract data from previous modules
        const step1Output = allModules.find(m => m.step === 1)?.output as unknown as ExtractedIntent | undefined;
        const step2Output = allModules.find(m => m.step === 2)?.output as unknown as TaskPlan | undefined;
        const step3Output = allModules.find(m => m.step === 3)?.output as unknown as {
            results: ScriptMatchResult[];
            foundCount: number;
            missingCount: number;
        } | undefined;

        let result: { success: boolean; module?: IPipelineModule; error?: string };

        switch (nextStep) {
            case 2:
                if (!step1Output) return { success: false, error: "Step 1 output not found" };
                result = await this.runStep2(pipelineId, step1Output);
                break;

            case 3:
                if (!step2Output) return { success: false, error: "Step 2 output not found" };
                result = await this.runStep3(pipelineId, step2Output);
                break;

            case 4:
                if (!step2Output || !step3Output) return { success: false, error: "Step 2/3 output not found" };
                result = await this.runStep4(pipelineId, step2Output, step3Output.results);
                break;

            case 5:
                if (!step2Output) return { success: false, error: "Step 2 output not found" };
                result = await this.runStep5(pipelineId, step2Output);
                if (!result.success && result.module?.output) {
                    const output = result.module.output as Record<string, unknown>;
                    if (output.validationErrors) {
                        return {
                            success: false,
                            nextModule: result.module,
                            validationErrors: output.validationErrors as ArgumentValidationResult[],
                            error: result.error
                        };
                    }
                }
                break;

            case 6:
                // Pipeline completed after step 5 confirm
                await PipelineRun.updateOne(
                    { pipelineId },
                    { $set: { status: "completed" } }
                );
                return { success: true, pipelineCompleted: true };

            default:
                return { success: false, error: `Unknown step: ${nextStep}` };
        }

        return {
            success: result.success,
            nextModule: result.module,
            error: result.error
        };
    }

    // ========================================================================
    // Internal: Rerun Step (for retry)
    // ========================================================================

    private static async rerunStep(
        pipelineId: string,
        step: number,
        moduleName: string,
        previousModules: IPipelineModule[],
        userFeedback?: string
    ): Promise<{ success: boolean; module?: IPipelineModule; error?: string }> {

        const pipeline = await PipelineRun.findOne({ pipelineId });
        if (!pipeline) return { success: false, error: "Pipeline not found" };

        const step1Output = previousModules.find(m => m.step === 1)?.output as unknown as ExtractedIntent | undefined;
        const step2Output = previousModules.find(m => m.step === 2)?.output as unknown as TaskPlan | undefined;
        const step3Output = previousModules.find(m => m.step === 3)?.output as unknown as {
            results: ScriptMatchResult[];
        } | undefined;

        switch (step) {
            case 1: {
                // For step 1 retry, use original message + user feedback
                let message = pipeline.userMessage;
                if (userFeedback) {
                    message = `${message}\n\nAdditional instruction: ${userFeedback}`;
                }
                return this.runStep1(pipelineId, message);
            }
            case 2: {
                if (!step1Output) return { success: false, error: "Step 1 output not found for retry" };
                // Could modify intent with feedback if needed
                return this.runStep2(pipelineId, step1Output);
            }
            case 3: {
                if (!step2Output) return { success: false, error: "Step 2 output not found for retry" };
                return this.runStep3(pipelineId, step2Output);
            }
            case 4: {
                if (!step2Output || !step3Output) return { success: false, error: "Previous output not found for retry" };
                return this.runStep4(pipelineId, step2Output, step3Output.results);
            }
            case 5: {
                if (!step2Output) return { success: false, error: "Step 2 output not found for retry" };
                return this.runStep5(pipelineId, step2Output);
            }
            default:
                return { success: false, error: `Cannot retry step ${step}` };
        }
    }

    // ========================================================================
    // Internal: Generate Script + Register in DB
    // ========================================================================

    private static async generateAndRegisterScript(
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
        const parsedArgs = this.parseArgparseFromCode(code);

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

    // ========================================================================
    // Internal: Parse argparse from Python code
    // ========================================================================

    private static parseArgparseFromCode(code: string): IScriptArgument[] {
        const args: IScriptArgument[] = [];

        // Match patterns like: parser.add_argument("--name", required=True, help="description")
        const argRegex = /add_argument\(\s*["']--(\w+)["']\s*(?:,\s*([^)]+))?\)/g;
        let match;

        while ((match = argRegex.exec(code)) !== null) {
            const name = match[1];
            const options = match[2] || "";

            const isRequired = /required\s*=\s*True/i.test(options);
            const hasDefault = /default\s*=/.test(options);

            // Extract help text
            const helpMatch = options.match(/help\s*=\s*["']([^"']+)["']/);
            const description = helpMatch ? helpMatch[1] : "";

            // Extract default value
            const defaultMatch = options.match(/default\s*=\s*["']([^"']+)["']/);
            const defaultValue = defaultMatch ? defaultMatch[1] : undefined;

            args.push({
                name,
                description,
                required: isRequired || !hasDefault,
                defaultValue
            });
        }

        return args;
    }

    // ========================================================================
    // Internal: Validate Arguments
    // ========================================================================

    private static validateArguments(
        subTasks: SubTask[],
        registry: IScriptRegistry[]
    ): ArgumentValidationResult[] {
        const results: ArgumentValidationResult[] = [];

        for (const task of subTasks) {
            const script = registry.find(
                s => s.action === task.action
                    && s.deviceType === task.deviceType
                    && s.os === task.os
            );

            if (!script) {
                results.push({
                    valid: false,
                    taskId: task.id,
                    action: task.action,
                    missingArgs: ["script_not_found"]
                });
                continue;
            }

            const requiredArgs = script.arguments
                .filter(a => a.required)
                .map(a => a.name);

            const providedParams = Object.keys(task.params || {});
            const missingArgs = requiredArgs.filter(arg => !providedParams.includes(arg));

            results.push({
                valid: missingArgs.length === 0,
                taskId: task.id,
                action: task.action,
                missingArgs
            });
        }

        return results;
    }
}

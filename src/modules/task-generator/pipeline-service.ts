import { env } from "process";
import { v4 as uuidv4 } from "uuid";
import "dotenv/config";
import { PipelineRun, PipelineModule, IPipelineRun, IPipelineModule } from "./pipeline-model";
import { ScriptRegistry, IScriptRegistry, IScriptArgument } from "./script-registry-model";
import { TaskGeneratorService } from "./service";

// Import step functions
import {
    ExtractedIntent, TaskPlan, ScriptMatchResult,
    ArgumentValidationResult, StepResult
} from "./steps/types";
import { runStep1 } from "./steps/step1-extract-intent";
import { runStep2 } from "./steps/step2-decompose-tasks";
import { runStep3 } from "./steps/step3-check-scripts";
import { runStep4 } from "./steps/step4-generate-scripts";
import { runStep5 } from "./steps/step5-execute-tasks";
import { runStep6 } from "./steps/step6-pipeline-result";

// ============================================================================
// Pipeline Service (Orchestrator)
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
        const moduleResult = await runStep1(pipelineId, message);

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

        let result: StepResult;

        switch (nextStep) {
            case 2:
                if (!step1Output) return { success: false, error: "Step 1 output not found" };
                result = await runStep2(pipelineId, step1Output);
                break;

            case 3:
                if (!step2Output) return { success: false, error: "Step 2 output not found" };
                result = await runStep3(pipelineId, step2Output);
                break;

            case 4:
                if (!step2Output || !step3Output) return { success: false, error: "Step 2/3 output not found" };
                result = await runStep4(pipelineId, step2Output, step3Output.results);
                break;

            case 5:
                if (!step2Output || !step3Output) return { success: false, error: "Step 2/3 output not found" };
                result = await runStep5(pipelineId, step2Output, step3Output.results);
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

            case 6: {
                // Step 6: Execute tasks + build result (auto-complete)
                const resultStep = await runStep6(pipelineId, allModules, pipeline);
                return {
                    success: resultStep.success,
                    nextModule: resultStep.module,
                    pipelineCompleted: resultStep.success, // auto-complete
                    error: resultStep.error
                };
            }

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
    ): Promise<StepResult> {

        const pipeline = await PipelineRun.findOne({ pipelineId });
        if (!pipeline) return { success: false, error: "Pipeline not found" };

        const step1Output = previousModules.find(m => m.step === 1)?.output as unknown as ExtractedIntent | undefined;
        const step2Output = previousModules.find(m => m.step === 2)?.output as unknown as TaskPlan | undefined;
        const step3Output = previousModules.find(m => m.step === 3)?.output as unknown as {
            results: ScriptMatchResult[];
        } | undefined;

        switch (step) {
            case 1: {
                let message = pipeline.userMessage;
                if (userFeedback) {
                    message = `${message}\n\nAdditional instruction: ${userFeedback}`;
                }
                return runStep1(pipelineId, message);
            }
            case 2: {
                if (!step1Output) return { success: false, error: "Step 1 output not found for retry" };
                return runStep2(pipelineId, step1Output);
            }
            case 3: {
                if (!step2Output) return { success: false, error: "Step 2 output not found for retry" };
                return runStep3(pipelineId, step2Output);
            }
            case 4: {
                if (!step2Output || !step3Output) return { success: false, error: "Previous output not found for retry" };
                return runStep4(pipelineId, step2Output, step3Output.results);
            }
            case 5: {
                if (!step2Output || !step3Output) return { success: false, error: "Step 2/3 output not found for retry" };
                return runStep5(pipelineId, step2Output, step3Output.results);
            }
            default:
                return { success: false, error: `Cannot retry step ${step}` };
        }
    }
}

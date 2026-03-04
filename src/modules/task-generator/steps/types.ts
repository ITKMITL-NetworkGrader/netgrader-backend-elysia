import { env } from "process";
import { GoogleGenAI } from "@google/genai";
import "dotenv/config";
import { IScriptArgument, IScriptRegistry } from "../script-registry-model";
import { IPipelineModule } from "../pipeline-model";

// ============================================================================
// Gemini AI Client (shared)
// ============================================================================

export const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY || "" });
export const GEMINI_MODEL = "gemini-2.5-flash";
export const MODEL_DISPLAY_NAME = "Gemini";

// FastAPI MCP Server URL
export const FASTAPI_URL = env.FASTAPI_MCP_URL || "http://localhost:8000";

// ============================================================================
// Types
// ============================================================================

export interface IntentAction {
    action: string;
    sourceDevice: string;
    targetDevice: string | null;
    deviceType: "host" | "network_device";
    os: "linux" | "cisco";
    params: Record<string, string>;
}

export interface ExtractedIntent {
    intent: {
        description: string;
        actions: IntentAction[];
    };
}

export interface SubTask {
    id: number;
    action: string;
    deviceType: "host" | "network_device";
    os: "linux" | "cisco";
    sourceDevice: string;
    targetDevice: string | null;
    description: string;
    params: Record<string, string>;
}

export interface TaskPlan {
    mainTask: string;
    subTasks: SubTask[];
}

export interface ScriptMatchResult {
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

export interface ArgumentValidationResult {
    valid: boolean;
    taskId: number;
    action: string;
    missingArgs: string[];
}

export interface TaskExecutionResult {
    id: number;
    action: string;
    success: boolean;
    output: string | null;
    error: string | null;
}

export interface ExecutionPlanItem {
    taskId: number;
    action: string;
    deviceType: string;
    os: string;
    sourceDevice: string;
    targetDevice: string | null;
    scriptPath: string;
    arguments: Record<string, string>;
    scriptArguments: IScriptArgument[];
}

export interface StepResult {
    success: boolean;
    module?: IPipelineModule;
    error?: string;
}

// ============================================================================
// Helper: Parse argparse from Python code
// ============================================================================

export function parseArgparseFromCode(code: string): IScriptArgument[] {
    const args: IScriptArgument[] = [];

    const argRegex = /add_argument\(\s*["']--(\\w+)["']\s*(?:,\s*([^)]+))?\)/g;
    let match;

    while ((match = argRegex.exec(code)) !== null) {
        const name = match[1];
        const options = match[2] || "";

        const isRequired = /required\s*=\s*True/i.test(options);
        const hasDefault = /default\s*=/.test(options);

        const helpMatch = options.match(/help\s*=\s*["']([^"']+)["']/);
        const description = helpMatch ? helpMatch[1] : "";

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

// ============================================================================
// Helper: Validate Arguments
// ============================================================================

export function validateArguments(
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

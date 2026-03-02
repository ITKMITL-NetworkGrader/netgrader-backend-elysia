import { env } from "process";
import { GoogleGenAI } from "@google/genai";
import { v4 as uuidv4 } from "uuid";
import "dotenv/config";
import {
    EXTRACT_INTENT_INSTRUCTION,
    DECOMPOSE_TASKS_INSTRUCTION,
    GENERATE_SCRIPT_INSTRUCTION,
    TASK_GENERATOR_INSTRUCTION
} from "./system-instruction";
import {
    TaskGeneratorSession,
    TaskGeneratorMessage,
    ITaskGeneratorSession,
    ITaskGeneratorMessage
} from "./model";

// ============================================================================
// Gemini AI Client
// ============================================================================

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY || "" });
const GEMINI_MODEL = "gemini-2.5-flash";
const MODEL_DISPLAY_NAME = "Gemini";

// FastAPI MCP Server URL
const FASTAPI_URL = env.FASTAPI_MCP_URL || "http://localhost:8000";

// ============================================================================
// Types for Pipeline
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

interface ScriptCheckResult {
    id: number;
    action: string;
    device_type: string;
    os: string;
    found: boolean;
    script_path: string | null;
}

interface TaskExecutionResult {
    id: number;
    action: string;
    success: boolean;
    output: string | null;
    error: string | null;
}

// ============================================================================
// Task Generator Service
// ============================================================================

export class TaskGeneratorService {

    // ========================================================================
    // Session CRUD (unchanged)
    // ========================================================================

    static async createSession(
        userId: string,
        title?: string
    ): Promise<{ success: boolean; errors: string[]; data?: ITaskGeneratorSession }> {
        const errors: string[] = [];

        if (!userId || userId.trim() === "") {
            errors.push("User ID is required");
            return { success: false, errors };
        }

        const sessionId = uuidv4();
        const session = new TaskGeneratorSession({
            sessionId,
            userId,
            title: title?.trim() || "Untitled",
            status: "active",
            lastMessageAt: new Date()
        });

        const saved = await session.save().catch((err: Error) => {
            errors.push(`Failed to save session: ${err.message}`);
            return null;
        });

        if (!saved) {
            return { success: false, errors };
        }

        return { success: true, errors: [], data: saved };
    }

    static async listSessions(userId: string): Promise<ITaskGeneratorSession[]> {
        return TaskGeneratorSession
            .find({ userId })
            .sort({ lastMessageAt: -1 })
            .lean() as unknown as ITaskGeneratorSession[];
    }

    static async getSession(sessionId: string): Promise<ITaskGeneratorSession | null> {
        return TaskGeneratorSession.findOne({ sessionId });
    }

    static async deleteSession(sessionId: string): Promise<void> {
        await TaskGeneratorMessage.deleteMany({ sessionId });
        await TaskGeneratorSession.deleteOne({ sessionId });
    }

    // ========================================================================
    // Message CRUD (unchanged)
    // ========================================================================

    static async getMessages(sessionId: string): Promise<ITaskGeneratorMessage[]> {
        return TaskGeneratorMessage
            .find({ sessionId })
            .sort({ timestamp: 1 })
            .lean() as unknown as ITaskGeneratorMessage[];
    }

    static async saveMessage(
        sessionId: string,
        role: "user" | "model",
        content: string,
        userId: string | null,
        modelName: string | null
    ): Promise<ITaskGeneratorMessage> {
        const message = new TaskGeneratorMessage({
            sessionId,
            messageId: uuidv4(),
            role,
            userId,
            modelName,
            content,
            timestamp: new Date()
        });

        await message.save();

        await TaskGeneratorSession.updateOne(
            { sessionId },
            { $set: { lastMessageAt: new Date() } }
        );

        return message;
    }

    // ========================================================================
    // Chat with Gemini (general fallback)
    // ========================================================================

    static async chat(
        sessionId: string,
        message: string,
        userId: string
    ): Promise<{ success: true; result: string; userMessageId: string; modelMessageId: string } | { success: false; error: string; statusCode: number }> {

        if (!env.GEMINI_API_KEY) {
            return { success: false, error: "GEMINI_API_KEY is not configured", statusCode: 500 };
        }

        const userMsg = await this.saveMessage(sessionId, "user", message, userId, null);
        const allMessages = await this.getMessages(sessionId);

        const contents = allMessages.map((msg) => ({
            role: msg.role,
            parts: [{ text: msg.content }]
        }));

        const response = await ai.models.generateContent({
            model: GEMINI_MODEL,
            contents,
            config: {
                systemInstruction: TASK_GENERATOR_INSTRUCTION
            }
        }).catch((err: Error) => {
            console.error(`[TaskGenerator] Gemini error:`, err.message);
            return null;
        });

        if (!response) {
            return { success: false, error: "Failed to get response from Gemini", statusCode: 502 };
        }

        const resultText = response.text || "";

        const modelMsg = await this.saveMessage(sessionId, "model", resultText, null, MODEL_DISPLAY_NAME);

        return {
            success: true,
            result: resultText,
            userMessageId: userMsg.messageId,
            modelMessageId: modelMsg.messageId
        };
    }

    // ========================================================================
    // Pipeline Step 1: Extract Intent
    // ========================================================================

    static async extractIntent(
        message: string
    ): Promise<{ success: true; intent: ExtractedIntent } | { success: false; error: string }> {

        if (!env.GEMINI_API_KEY) {
            return { success: false, error: "GEMINI_API_KEY is not configured" };
        }

        console.log(`[Pipeline:Step1] Extracting intent from: "${message.slice(0, 100)}..."`);

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
            return { success: false, error: "Failed to extract intent from Gemini" };
        }

        const cleaned = response.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

        const parsed = JSON.parse(cleaned) as ExtractedIntent;
        console.log(`[Pipeline:Step1] Extracted ${parsed.intent.actions.length} action(s)`);

        return { success: true, intent: parsed };
    }

    // ========================================================================
    // Pipeline Step 2: Decompose Tasks
    // ========================================================================

    static async decomposeTasks(
        intent: ExtractedIntent
    ): Promise<{ success: true; taskPlan: TaskPlan } | { success: false; error: string }> {

        if (!env.GEMINI_API_KEY) {
            return { success: false, error: "GEMINI_API_KEY is not configured" };
        }

        console.log(`[Pipeline:Step2] Decomposing ${intent.intent.actions.length} action(s)...`);

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
            return { success: false, error: "Failed to decompose tasks from Gemini" };
        }

        const cleaned = response.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

        const parsed = JSON.parse(cleaned) as TaskPlan;
        console.log(`[Pipeline:Step2] Decomposed into ${parsed.subTasks.length} sub-task(s)`);

        return { success: true, taskPlan: parsed };
    }

    // ========================================================================
    // Pipeline Step 3: Check Scripts via FastAPI
    // ========================================================================

    static async checkScripts(
        subTasks: SubTask[]
    ): Promise<{ success: true; results: ScriptCheckResult[]; foundCount: number; missingCount: number } | { success: false; error: string }> {

        console.log(`[Pipeline:Step3] Checking ${subTasks.length} script(s) via FastAPI...`);

        const payload = {
            tasks: subTasks.map(t => ({
                id: t.id,
                action: t.action,
                device_type: t.deviceType,
                os: t.os
            }))
        };

        const response = await fetch(`${FASTAPI_URL}/task-generator/scripts/check`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        }).catch((err: Error) => {
            console.error(`[Pipeline:Step3] FastAPI error:`, err.message);
            return null;
        });

        if (!response || !response.ok) {
            return { success: false, error: "Failed to connect to FastAPI script service" };
        }

        const data = await response.json() as {
            total: number;
            found_count: number;
            missing_count: number;
            tasks: ScriptCheckResult[];
        };

        console.log(`[Pipeline:Step3] Found: ${data.found_count}, Missing: ${data.missing_count}`);

        return {
            success: true,
            results: data.tasks,
            foundCount: data.found_count,
            missingCount: data.missing_count
        };
    }

    // ========================================================================
    // Pipeline Step 5: Generate Missing Script via LLM
    // ========================================================================

    static async generateScript(
        subTask: SubTask
    ): Promise<{ success: true; code: string; savedPath: string } | { success: false; error: string }> {

        if (!env.GEMINI_API_KEY) {
            return { success: false, error: "GEMINI_API_KEY is not configured" };
        }

        console.log(`[Pipeline:Step5] Generating script for: ${subTask.action} (${subTask.deviceType}/${subTask.os})`);

        // Ask LLM to generate the script
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
            console.error(`[Pipeline:Step5] Gemini error:`, err.message);
            return null;
        });

        if (!response || !response.text) {
            return { success: false, error: "Failed to generate script from Gemini" };
        }

        // Clean code fences if present
        let code = response.text;
        code = code.replace(/^```python\n?/m, "").replace(/```\n?$/m, "").trim();

        // Save via FastAPI
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
            console.error(`[Pipeline:Step5] FastAPI save error:`, err.message);
            return null;
        });

        if (!saveResponse || !saveResponse.ok) {
            return { success: false, error: "Failed to save generated script to FastAPI" };
        }

        const saveData = await saveResponse.json() as {
            success: boolean;
            message: string;
            script_path: string | null;
        };

        console.log(`[Pipeline:Step5] Script saved: ${saveData.script_path}`);

        return {
            success: true,
            code,
            savedPath: saveData.script_path || ""
        };
    }

    // ========================================================================
    // Pipeline Step 6: Execute Tasks via FastAPI
    // ========================================================================

    static async executeTasks(
        subTasks: SubTask[]
    ): Promise<{ success: true; results: TaskExecutionResult[]; successCount: number; failureCount: number } | { success: false; error: string }> {

        console.log(`[Pipeline:Step6] Executing ${subTasks.length} task(s) via FastAPI...`);

        const payload = {
            tasks: subTasks.map(t => ({
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
            return { success: false, error: "Failed to connect to FastAPI execution service" };
        }

        const data = await response.json() as {
            total: number;
            success_count: number;
            failure_count: number;
            results: TaskExecutionResult[];
        };

        console.log(`[Pipeline:Step6] Success: ${data.success_count}, Failed: ${data.failure_count}`);

        return {
            success: true,
            results: data.results,
            successCount: data.success_count,
            failureCount: data.failure_count
        };
    }

    // ========================================================================
    // Full Pipeline Orchestration
    // ========================================================================

    /**
     * Run the full 6-step pipeline:
     * 1. Extract intent from NL
     * 2. Decompose into sub-tasks
     * 3. Check script availability
     * 4-5. Generate missing scripts if needed
     * 6. Execute all tasks
     */
    static async runPipeline(
        sessionId: string,
        message: string,
        userId: string
    ): Promise<{
        success: boolean;
        step: string;
        intent?: ExtractedIntent;
        taskPlan?: TaskPlan;
        scriptCheck?: { results: ScriptCheckResult[]; foundCount: number; missingCount: number };
        generatedScripts?: { action: string; success: boolean }[];
        execution?: { results: TaskExecutionResult[]; successCount: number; failureCount: number };
        error?: string;
    }> {
        // Save user message
        await this.saveMessage(sessionId, "user", message, userId, null);

        // Step 1: Extract Intent
        const intentResult = await this.extractIntent(message);
        if (!intentResult.success) {
            const errMsg = `[Step 1 Failed] ${intentResult.error}`;
            await this.saveMessage(sessionId, "model", errMsg, null, MODEL_DISPLAY_NAME);
            return { success: false, step: "extract_intent", error: intentResult.error };
        }

        // Step 2: Decompose Tasks
        const decomposeResult = await this.decomposeTasks(intentResult.intent);
        if (!decomposeResult.success) {
            const errMsg = `[Step 2 Failed] ${decomposeResult.error}`;
            await this.saveMessage(sessionId, "model", errMsg, null, MODEL_DISPLAY_NAME);
            return {
                success: false, step: "decompose_tasks",
                intent: intentResult.intent,
                error: decomposeResult.error
            };
        }

        // Step 3: Check Scripts
        const checkResult = await this.checkScripts(decomposeResult.taskPlan.subTasks);
        if (!checkResult.success) {
            const errMsg = `[Step 3 Failed] ${checkResult.error}`;
            await this.saveMessage(sessionId, "model", errMsg, null, MODEL_DISPLAY_NAME);
            return {
                success: false, step: "check_scripts",
                intent: intentResult.intent,
                taskPlan: decomposeResult.taskPlan,
                error: checkResult.error
            };
        }

        // Step 4-5: Generate Missing Scripts
        const generatedScripts: { action: string; success: boolean }[] = [];
        const missingTasks = checkResult.results
            .filter(r => !r.found)
            .map(r => decomposeResult.taskPlan.subTasks.find(t => t.id === r.id))
            .filter((t): t is SubTask => t !== undefined);

        for (const task of missingTasks) {
            const genResult = await this.generateScript(task);
            generatedScripts.push({
                action: task.action,
                success: genResult.success
            });
        }

        // Step 6: Execute All Tasks
        const execResult = await this.executeTasks(decomposeResult.taskPlan.subTasks);
        if (!execResult.success) {
            const errMsg = `[Step 6 Failed] ${execResult.error}`;
            await this.saveMessage(sessionId, "model", errMsg, null, MODEL_DISPLAY_NAME);
            return {
                success: false, step: "execute_tasks",
                intent: intentResult.intent,
                taskPlan: decomposeResult.taskPlan,
                scriptCheck: checkResult,
                generatedScripts,
                error: execResult.error
            };
        }

        // Save summary as model message
        const summary = this.buildPipelineSummary(
            decomposeResult.taskPlan,
            checkResult,
            generatedScripts,
            execResult
        );
        await this.saveMessage(sessionId, "model", summary, null, MODEL_DISPLAY_NAME);

        return {
            success: true,
            step: "completed",
            intent: intentResult.intent,
            taskPlan: decomposeResult.taskPlan,
            scriptCheck: checkResult,
            generatedScripts,
            execution: execResult
        };
    }

    // ========================================================================
    // Helper: Build pipeline summary
    // ========================================================================

    private static buildPipelineSummary(
        taskPlan: TaskPlan,
        scriptCheck: { results: ScriptCheckResult[]; foundCount: number; missingCount: number },
        generatedScripts: { action: string; success: boolean }[],
        execution: { results: TaskExecutionResult[]; successCount: number; failureCount: number }
    ): string {
        const lines: string[] = [];
        lines.push(`## Pipeline Results: ${taskPlan.mainTask}`);
        lines.push("");

        // Task Plan
        lines.push(`### Sub-Tasks (${taskPlan.subTasks.length})`);
        for (const t of taskPlan.subTasks) {
            lines.push(`- **${t.id}. ${t.action}** on ${t.sourceDevice}${t.targetDevice ? ` -> ${t.targetDevice}` : ""}`);
            lines.push(`  ${t.description}`);
        }
        lines.push("");

        // Script Check
        lines.push(`### Script Check`);
        lines.push(`- Found: ${scriptCheck.foundCount}/${scriptCheck.results.length}`);
        if (scriptCheck.missingCount > 0) {
            lines.push(`- Missing: ${scriptCheck.missingCount} (auto-generated)`);
        }
        lines.push("");

        // Generated Scripts
        if (generatedScripts.length > 0) {
            lines.push(`### Generated Scripts`);
            for (const g of generatedScripts) {
                lines.push(`- ${g.action}: ${g.success ? "Generated OK" : "Failed"}`);
            }
            lines.push("");
        }

        // Execution Results
        lines.push(`### Execution Results`);
        lines.push(`- Success: ${execution.successCount}/${execution.results.length}`);
        lines.push(`- Failed: ${execution.failureCount}/${execution.results.length}`);
        lines.push("");

        for (const r of execution.results) {
            const icon = r.success ? "[PASS]" : "[FAIL]";
            lines.push(`**${icon} Task ${r.id}: ${r.action}**`);
            if (r.output) lines.push(`\`\`\`\n${r.output}\n\`\`\``);
            if (r.error) lines.push(`Error: ${r.error}`);
            lines.push("");
        }

        return lines.join("\n");
    }
}

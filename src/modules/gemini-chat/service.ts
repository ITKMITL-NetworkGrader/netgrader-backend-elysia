import { env } from "process";
import { GoogleGenAI, FunctionDeclaration } from "@google/genai";
import { ChatSession, ChatMessage, IChatSession, IChatMessage } from "./model";
import { LabService } from "../labs/service";
import { PartService } from "../parts/service";
import { Course } from "../courses/model";
import { v4 as uuidv4 } from "uuid";
import { ArgumentExtractor } from "./argument-extractor";
import "dotenv/config";

// Initialize Gemini client
const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY || "" });

// ============================================================================
// MCP Function Declarations
// ============================================================================

const functionDeclarations: FunctionDeclaration[] = [
    {
        name: "list_courses",
        description: "ดึงรายการ Course ที่อาจารย์สอนหรือเป็นเจ้าของ"
    },
    {
        name: "list_labs",
        description: "ดึงรายการ Lab ใน Course ที่กำหนด",
        parametersJsonSchema: {
            type: "object",
            properties: {
                courseId: { type: "string", description: "Course ID" }
            },
            required: ["courseId"]
        }
    },
    {
        name: "list_parts",
        description: "ดึงรายการ Part ทั้งหมดใน Lab ที่กำหนด พร้อมแสดง title, order, type, และจำนวน task",
        parametersJsonSchema: {
            type: "object",
            properties: {
                labId: { type: "string", description: "Lab ID" }
            },
            required: ["labId"]
        }
    },
    {
        name: "create_lab",
        description: "สร้าง Lab ใหม่ใน Course ที่กำหนด",
        parametersJsonSchema: {
            type: "object",
            properties: {
                courseId: { type: "string", description: "Course ID ที่ต้องการสร้าง Lab" },
                title: { type: "string", description: "ชื่อ Lab" },
                description: { type: "string", description: "คำอธิบาย Lab" },
                type: { type: "string", enum: ["lab", "exam"], description: "ประเภท Lab" }
            },
            required: ["courseId", "title", "type"]
        }
    },
    {
        name: "create_part",
        description: "สร้าง Part ใหม่ใน Lab ที่กำหนด",
        parametersJsonSchema: {
            type: "object",
            properties: {
                labId: { type: "string", description: "Lab ID ที่ต้องการสร้าง Part" },
                title: { type: "string", description: "ชื่อ Part" },
                description: { type: "string", description: "คำอธิบาย Part" },
                order: { type: "number", description: "ลำดับของ Part" }
            },
            required: ["labId", "title"]
        }
    },
    {
        name: "add_task",
        description: "เพิ่ม Task ใหม่ลงใน Part ที่กำหนด",
        parametersJsonSchema: {
            type: "object",
            properties: {
                partId: { type: "string", description: "Part ID ที่ต้องการเพิ่ม Task" },
                title: { type: "string", description: "ชื่อ Task" },
                instruction: { type: "string", description: "คำสั่งสำหรับนักศึกษา" },
                maxScore: { type: "number", description: "คะแนนเต็ม" }
            },
            required: ["partId", "title", "instruction", "maxScore"]
        }
    }
];

const SYSTEM_INSTRUCTION = `คุณคือ Netgrader Assistant ผู้ช่วยสอนวิชา Computer Network สำหรับอาจารย์
หน้าที่ของคุณคือช่วยอาจารย์จัดการ Lab, Part และ Task ในระบบ Netgrader

คุณสามารถ:
1. ดึงข้อมูล Course, Lab, Part ที่มีอยู่ (ใช้ list_courses, list_labs, list_parts)
2. ช่วยอาจารย์ออกแบบและสร้าง Lab ใหม่
3. ช่วยอาจารย์สร้าง Part และ Task ต่างๆ

เมื่อคุณต้องการสร้างสิ่งใหม่ (Lab/Part/Task) ให้เรียกใช้ Function ที่กำหนด
หลังจากเรียกใช้ Function คุณจะได้รับผลลัพธ์ว่าสร้างสำเร็จหรือไม่

## การสร้าง Part
เมื่อได้รับ "Part Creation Guide" ให้ทำตามขั้นตอนนี้:
1. อ่าน schema ที่ระบุไว้เพื่อทราบว่าต้องเก็บข้อมูลอะไรบ้าง
2. ถามข้อมูลจากผู้ใช้ทีละ field อย่างเป็นธรรมชาติ (ไม่ต้องถามทุก field พร้อมกัน)
3. ใช้ข้อมูล Topology Context เพื่อเข้าใจชื่ออุปกรณ์, IP, VLAN ที่ผู้ใช้อ้างถึง
4. เมื่อเก็บข้อมูลครบ ให้เรียก create_part function พร้อมข้อมูลทั้งหมด
5. หากผู้ใช้พูดถึงอุปกรณ์เช่น "Host1 ping Host2" ให้ map กับ device ใน topology

กรุณาตอบเป็นภาษาไทยด้วยความสุภาพและเป็นมืออาชีพ`;

// ============================================================================
// Service Class
// ============================================================================

export class GeminiChatService {

    /**
     * Create a new chat session
     */
    static async createSession(userId: string | undefined, title?: string): Promise<{ success: boolean; errors: string[]; data?: IChatSession }> {
        const errors: string[] = [];

        if (!userId || (typeof userId === 'string' && userId.trim() === "")) {
            errors.push("User ID is required to create a session");
            return { success: false, errors };
        }

        const sessionId = uuidv4();

        const session = new ChatSession({
            sessionId,
            userId,
            title: title?.trim() || 'Untitled Chat',
            currentContext: {},
            status: "active",
            lastMessageAt: new Date()
        });

        const savedSession = await session.save().catch((err: Error) => {
            errors.push(`Failed to save session: ${err.message}`);
            return null;
        });

        if (!savedSession) {
            return { success: false, errors };
        }

        // Add welcome message
        await this.saveMessage(sessionId, {
            role: "model",
            textContent: "สวัสดีครับ! ผมคือ Netgrader Assistant\n\nคุณต้องการทำอะไรครับ?\n1. จัดการ Course (สร้าง/แก้ไข/ดูรายการ)\n2. จัดการ Lab (สร้าง/แก้ไข/ดูรายการ)\n3. จัดการ Part (สร้าง/แก้ไข/ดูรายการ)\n\nกรุณาพิมพ์บอกผมได้เลยครับ"
        }).catch((err: Error) => {
            console.error("Failed to save welcome message:", err.message);
            // Non-critical error for session creation
        });

        return { success: true, errors: [], data: savedSession };
    }

    /**
     * Get session by ID
     */
    static async getSession(sessionId: string): Promise<IChatSession | null> {
        return ChatSession.findOne({ sessionId, status: "active" });
    }

    /**
     * Get all sessions for a user
     */
    static async listSessions(userId: string): Promise<IChatSession[]> {
        return ChatSession.find({ userId })
            .sort({ lastMessageAt: -1 })
            .limit(50);
    }

    /**
     * Delete a session and all its messages
     */
    static async deleteSession(sessionId: string): Promise<void> {
        console.log(`[Service] Deleting messages for sessionId: ${sessionId}...`);
        const msgResult = await ChatMessage.deleteMany({ sessionId });
        console.log(`[Service] Deleted ${msgResult.deletedCount} messages.`);

        console.log(`[Service] Deleting session for sessionId: ${sessionId}...`);
        const sessionResult = await ChatSession.deleteOne({ sessionId });
        console.log(`[Service] Session delete result:`, sessionResult);
    }

    /**
     * Get message history for a session
     */
    static async getHistory(sessionId: string): Promise<IChatMessage[]> {
        return ChatMessage.find({ sessionId })
            .sort({ timestamp: 1 });
    }

    /**
     * Save a message to the database
     */
    private static async saveMessage(
        sessionId: string,
        data: Partial<IChatMessage>
    ): Promise<IChatMessage> {
        const message = new ChatMessage({
            sessionId,
            messageId: uuidv4(),
            timestamp: new Date(),
            ...data
        });

        await message.save();

        // Update session lastMessageAt
        await ChatSession.updateOne(
            { sessionId },
            { $set: { lastMessageAt: new Date() } }
        );

        return message;
    }

    /**
     * Read-only function names that should be executed immediately
     */
    private static readonly READ_ONLY_FUNCTIONS = ['list_courses', 'list_labs', 'list_parts'];

    /**
     * Execute a read-only function and return the result
     */
    private static async executeReadOnlyFunction(
        functionName: string,
        args: Record<string, any>,
        userId: string
    ): Promise<{ success: boolean; data?: any; error?: string }> {
        if (functionName === 'list_courses') {
            const courses = await this.getCoursesForUser(userId);
            return { success: true, data: { courses } };
        }
        if (functionName === 'list_labs') {
            if (!args.courseId) return { success: false, error: 'courseId is required' };
            const labs = await this.getLabsForCourse(args.courseId);
            return { success: true, data: { labs } };
        }
        if (functionName === 'list_parts') {
            if (!args.labId) return { success: false, error: 'labId is required' };
            const parts = await this.getPartsForLab(args.labId);
            return { success: true, data: { parts } };
        }
        return { success: false, error: `Unknown read-only function: ${functionName}` };
    }

    /**
     * Send message with streaming response
     * Returns an async generator for SSE
     *
     * Flow:
     * 1. Stream first Gemini response to client
     * 2. If Gemini calls a read-only function (list_*) -> execute, send functionResponse back, repeat (max 5 rounds)
     * 3. If Gemini calls a write function (create_*/add_*) -> create draft for user confirmation
     * 4. If Gemini returns text only -> save and done
     */
    static async *sendMessageStream(
        sessionId: string,
        userMessage: string,
        userId: string,
        context?: { courseId?: string; labId?: string; partId?: string }
    ): AsyncGenerator<{ type: string; content?: string; data?: any; messageId?: string }> {
        // Get session
        const session = await this.getSession(sessionId);
        if (!session) {
            yield { type: "error", content: "Session not found" };
            return;
        }

        // Update session context if provided
        if (context && (context.courseId || context.labId || context.partId)) {
            await ChatSession.updateOne(
                { sessionId },
                {
                    $set: {
                        ...(context.courseId && { 'currentContext.courseId': context.courseId }),
                        ...(context.labId && { 'currentContext.labId': context.labId }),
                        ...(context.partId && { 'currentContext.partId': context.partId })
                    }
                }
            );
        }

        // Save user message
        await this.saveMessage(sessionId, {
            role: "user",
            textContent: userMessage
        });

        // Get conversation history (filter out system messages for Gemini)
        const history = await this.getHistory(sessionId);
        const contents: Array<{ role: string; parts: any[] }> = history
            .filter(msg => msg.role !== "system")
            .map(msg => ({
                role: msg.role === "model" ? "model" : "user",
                parts: [{ text: msg.textContent }]
            }));

        // Build context info for AI
        let contextInfo = '';
        if (context?.courseId || context?.labId || context?.partId) {
            contextInfo = '\n\n[Current Context]\n';
            if (context.courseId) contextInfo += `- Working in Course ID: ${context.courseId}\n`;
            if (context.labId) contextInfo += `- Working in Lab ID: ${context.labId}\n`;
            if (context.partId) contextInfo += `- Working on Part ID: ${context.partId}\n`;
            contextInfo += 'Use these IDs when calling functions that require them.';
        }

        const geminiConfig = {
            systemInstruction: SYSTEM_INSTRUCTION + contextInfo,
            tools: [{ functionDeclarations }]
        };

        const MAX_FUNCTION_CALL_ROUNDS = 5;

        // ---- Round 1: Streaming response ----
        const streamResponse = await ai.models.generateContentStream({
            model: "gemini-2.5-flash",
            contents: contents,
            config: geminiConfig
        }).catch((err: Error) => {
            return null;
        });

        if (!streamResponse) {
            yield { type: "error", content: "Failed to connect to Gemini API" };
            return;
        }

        let fullText = "";
        let functionCall: any = null;
        let assistantContent: any = null;

        // Stream text chunks from first response
        for await (const chunk of streamResponse) {
            const candidate = chunk.candidates?.[0];
            if (candidate?.content) assistantContent = candidate.content;
            const parts = candidate?.content?.parts || [];
            for (const part of parts) {
                if (part.functionCall) {
                    functionCall = part.functionCall;
                }
                if (part.text) {
                    fullText += part.text;
                    yield { type: "text", content: part.text };
                }
            }
        }

        // ---- Function call loop (for read-only functions) ----
        let round = 0;
        while (functionCall && this.READ_ONLY_FUNCTIONS.includes(functionCall.name) && round < MAX_FUNCTION_CALL_ROUNDS) {
            round++;

            const execResult = await this.executeReadOnlyFunction(
                functionCall.name,
                functionCall.args || {},
                userId
            );

            // Build contents with function call + response for next Gemini call
            if (assistantContent) {
                contents.push(assistantContent);
            }
            contents.push({
                role: "user",
                parts: [{
                    functionResponse: {
                        name: functionCall.name,
                        response: execResult.success
                            ? execResult.data
                            : { error: execResult.error }
                    }
                }]
            });

            // Call Gemini again (non-streaming for follow-up rounds)
            const followUpResponse = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: contents,
                config: geminiConfig
            }).catch((err: Error) => {
                return null;
            });

            if (!followUpResponse) {
                yield { type: "error", content: "Failed to get follow-up response from Gemini" };
                return;
            }

            // Process follow-up response
            functionCall = null;
            assistantContent = followUpResponse.candidates?.[0]?.content || null;
            const followUpParts = assistantContent?.parts || [];

            for (const part of followUpParts) {
                if (part.functionCall) {
                    functionCall = part.functionCall;
                }
                if (part.text) {
                    fullText += part.text;
                    yield { type: "text", content: part.text };
                }
            }
        }

        // ---- Handle write function call (create/add) or no function call ----
        if (functionCall && !this.READ_ONLY_FUNCTIONS.includes(functionCall.name)) {
            const extractionResult = ArgumentExtractor.extract(
                functionCall.name,
                functionCall.args || {},
                context
            );

            if (!extractionResult.complete) {
                const followUpText = extractionResult.followUpQuestion ||
                    '\u0e01\u0e23\u0e38\u0e13\u0e32\u0e43\u0e2b\u0e49\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e40\u0e1e\u0e34\u0e48\u0e21\u0e40\u0e15\u0e34\u0e21';

                yield { type: "text", content: followUpText };

                await this.saveMessage(sessionId, {
                    role: "model",
                    textContent: followUpText,
                    functionCall: {
                        name: functionCall.name,
                        args: extractionResult.collectedArgs,
                        status: "collecting"
                    }
                });

                yield { type: "done" };
                return;
            }

            const draft = await this.createDraftFromFunctionCall(
                { ...functionCall, args: extractionResult.collectedArgs },
                userId
            );

            const savedMessage = await this.saveMessage(sessionId, {
                role: "model",
                textContent: fullText || "\u0e01\u0e33\u0e25\u0e31\u0e07\u0e2a\u0e23\u0e49\u0e32\u0e07 draft...",
                humanReadablePreview: draft.previewText,
                jsonPreview: draft.data,
                functionCall: {
                    name: functionCall.name,
                    args: extractionResult.collectedArgs,
                    status: "pending"
                },
                draftData: draft
            });

            yield {
                type: "draft",
                data: {
                    type: draft.type,
                    preview: draft.previewText,
                    data: draft.data,
                    messageId: savedMessage.messageId
                }
            };
        } else {
            await this.saveMessage(sessionId, {
                role: "model",
                textContent: fullText
            });
        }

        yield { type: "done" };
    }

    /**
     * Helper to create draft data from function call args
     */
    private static async createDraftFromFunctionCall(functionCall: any, userId: string): Promise<any> {
        const { name, args } = functionCall;

        if (name === "create_lab") {
            return {
                type: "lab",
                data: {
                    ...args,
                    createdBy: userId,
                    network: {
                        name: args.title,
                        topology: {
                            baseNetwork: "10.0.0.0",
                            subnetMask: 24,
                            allocationStrategy: "student_id_based"
                        }
                    }
                },
                previewText: `[Lab] ต้องการสร้าง Lab: **${args.title}**\nประเภท: ${args.type}\nรายละเอียด: ${args.description || "-"}`
            };
        }

        if (name === "create_part") {
            return {
                type: "part",
                data: args,
                previewText: `[Part] ต้องการสร้าง Part: **${args.title}**\nรายละเอียด: ${args.description || "-"}`
            };
        }

        if (name === "add_task") {
            return {
                type: "task",
                data: args,
                previewText: `[Task] ต้องการเพิ่ม Task: **${args.title}**\nคะแนนเต็ม: ${args.maxScore}`
            };
        }

        return {
            type: "unknown",
            data: args,
            previewText: "Unknown draft action"
        };
    }

    /**
     * Confirm and execute a draft
     */
    static async confirmDraft(
        sessionId: string,
        messageId: string,
        userId: string
    ): Promise<{ success: boolean; result?: any; error?: string }> {
        const message = await ChatMessage.findOne({ sessionId, messageId });
        if (!message || !message.draftData) {
            return { success: false, error: "Draft not found" };
        }

        const { type, data } = message.draftData;
        let result: any;

        if (type === "lab") {
            result = await LabService.createLab(data, userId).catch((err: Error) => null);
            if (!result) return { success: false, error: "Failed to create lab" };
            await ChatSession.updateOne(
                { sessionId },
                { $set: { "currentContext.labId": result._id || result.id } }
            );
        } else if (type === "part") {
            result = await PartService.createPart(data, userId).catch((err: Error) => null);
            if (!result) return { success: false, error: "Failed to create part" };
            await ChatSession.updateOne(
                { sessionId },
                { $set: { "currentContext.partId": result._id || result.id } }
            );
        } else if (type === "task") {
            const partId = data.partId;
            const part = await PartService.getPartById(partId);
            if (!part) return { success: false, error: "Part not found" };

            const updatedTasks = [...(part.tasks || []), data];
            result = await PartService.updatePart(partId, { tasks: updatedTasks }).catch((err: Error) => null);
            if (!result) return { success: false, error: "Failed to add task" };
        } else {
            return { success: false, error: `Unknown draft type: ${type}` };
        }

        // Update message status
        await ChatMessage.updateOne(
            { sessionId, messageId },
            { $set: { "functionCall.status": "executed" } }
        );

        // Add system message
        await this.saveMessage(sessionId, {
            role: "system",
            textContent: `[\u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08] \u0e2a\u0e23\u0e49\u0e32\u0e07 ${type} \u0e40\u0e23\u0e35\u0e22\u0e1a\u0e23\u0e49\u0e2d\u0e22\u0e41\u0e25\u0e49\u0e27`
        });

        return { success: true, result };
    }

    /**
     * Reject a draft
     */
    static async rejectDraft(sessionId: string, messageId: string): Promise<void> {
        await ChatMessage.updateOne(
            { sessionId, messageId },
            { $set: { "functionCall.status": "rejected" } }
        );

        await this.saveMessage(sessionId, {
            role: "system",
            textContent: "[ยกเลิก] ยกเลิกการสร้างแล้ว"
        });
    }

    /**
     * Close/Expire a session
     */
    static async closeSession(sessionId: string): Promise<void> {
        await ChatSession.updateOne(
            { sessionId },
            { $set: { status: "expired" } }
        );
    }

    // ============================================================================
    // Wizard Methods
    // ============================================================================

    /**
     * Get courses that user can manage (created by or enrolled as instructor/TA)
     */
    static async getCoursesForUser(userId: string): Promise<any[]> {
        const { Enrollment } = await import("../enrollments/model");

        // Find enrollments where user is instructor or TA
        const enrollments = await Enrollment.find({
            u_id: userId,
            role: { $in: ['instructor', 'ta'] }
        }).select('course_id');

        const courseIds = enrollments.map((e: any) => e.course_id);

        // Also get courses created by user
        const courses = await Course.find({
            $or: [
                { created_by: userId },
                { _id: { $in: courseIds } }
            ]
        }).select('_id title description visibility createdAt');

        return courses.map(c => ({
            id: c._id.toString(),
            title: c.title,
        if (type === "lab") {
            result = await LabService.createLab(data, userId).catch((err: Error) => null);
            if (!result) return { success: false, error: "Failed to create lab" };
            await ChatSession.updateOne(
                { sessionId },
                { $set: { "currentContext.labId": result._id || result.id } }
            );
        } else if (type === "part") {
            result = await PartService.createPart(data, userId).catch((err: Error) => null);
            if (!result) return { success: false, error: "Failed to create part" };
            await ChatSession.updateOne(
                { sessionId },
                { $set: { "currentContext.partId": result._id || result.id } }
            );
        } else if (type === "task") {
            const partId = data.partId;
            const part = await PartService.getPartById(partId);
            if (!part) return { success: false, error: "Part not found" };

            const updatedTasks = [...(part.tasks || []), data];
            result = await PartService.updatePart(partId, { tasks: updatedTasks }).catch((err: Error) => null);
            if (!result) return { success: false, error: "Failed to add task" };
        } else {
            return { success: false, error: `Unknown draft type: ${type}` };
        }

        // Update message status
        await ChatMessage.updateOne(
            { sessionId, messageId },
            { $set: { "functionCall.status": "executed" } }
        );

        // Add system message
        await this.saveMessage(sessionId, {
            role: "system",
            textContent: `[\u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08] \u0e2a\u0e23\u0e49\u0e32\u0e07 ${type} \u0e40\u0e23\u0e35\u0e22\u0e1a\u0e23\u0e49\u0e2d\u0e22\u0e41\u0e25\u0e49\u0e27`
        });

        return { success: true, result };
        if (!session) return null;
        return session.wizardState || { step: 'course_list' };
    }

    /**
     * Update wizard step and context
     */
    static async setWizardStep(
        sessionId: string,
        step: string,
        context?: { courseId?: string; labId?: string; partId?: string; editSection?: string }
    ): Promise<void> {
        const update: any = {
            'wizardState.step': step
        };

        // Update wizardState context
        if (context?.courseId !== undefined) {
            update['wizardState.courseId'] = context.courseId;
            update['currentContext.courseId'] = context.courseId; // Sync to currentContext
        }
        if (context?.labId !== undefined) {
            update['wizardState.labId'] = context.labId;
            update['currentContext.labId'] = context.labId; // Sync to currentContext
        }
        if (context?.partId !== undefined) {
            update['wizardState.partId'] = context.partId;
            update['currentContext.partId'] = context.partId; // Sync to currentContext
        }
        if (context?.editSection !== undefined) {
            update['wizardState.editSection'] = context.editSection;
        }

        await ChatSession.updateOne(
            { sessionId },
            { $set: { ...update, lastMessageAt: new Date() } }
        );
    }

    /**
     * Navigate back in wizard
     */
    static async navigateBack(sessionId: string): Promise<string> {
        const session = await ChatSession.findOne({ sessionId });
        if (!session) return 'course_list';

        const state = session.wizardState || { step: 'course_list' };
        let newStep = 'course_list';

        switch (state.step) {
            case 'course_create':
            case 'course_edit':
                newStep = 'course_list';
                break;
            case 'lab_list':
                newStep = 'course_list';
                break;
            case 'lab_create':
            case 'lab_edit_menu':
                newStep = 'lab_list';
                break;
            case 'lab_edit':
                newStep = 'lab_edit_menu';
                break;
            case 'part_list':
                newStep = 'lab_edit_menu';
                break;
            case 'part_create':
            case 'part_edit':
                newStep = 'part_list';
                break;
            default:
                newStep = 'course_list';
        }

        await this.setWizardStep(sessionId, newStep);
        return newStep;
    }

    /**
     * Get topology context for Part creation/editing AI prompting
     * Returns structured data about the lab's network configuration
     */
    static async getTopologyContext(labId: string): Promise<{
        success: boolean;
        context?: {
            labTitle: string;
            networkName: string;
            topology: {
                baseNetwork: string;
                subnetMask: number;
                allocationStrategy: string;
            };
            vlans: Array<{
                id: string;
                vlanId?: number;
                baseNetwork: string;
                subnetMask: number;
                description: string;
            }>;
            devices: Array<{
                deviceId: string;
                displayName: string;
                interfaces: Array<{
                    name: string;
                    interfaceName?: string;
                    type: string;
                    vlanIndex?: number;
                }>;
            }>;
            ipv6Enabled: boolean;
            naturalLanguageSummary: string;
        };
        message?: string;
    }> {
        const lab = await LabService.getLabById(labId).catch(() => null);
        if (!lab) {
            return { success: false, message: 'Lab not found' };
        }

        const network = lab.network;
        if (!network) {
            return { success: false, message: 'Network not configured' };
        }

        // Build VLAN info
        const vlans = (network.vlanConfiguration?.vlans || []).map((v: any, idx: number) => ({
            id: v.id,
            vlanId: v.vlanId,
            baseNetwork: v.baseNetwork,
            subnetMask: v.subnetMask,
            description: `VLAN ${idx + 1}: ${v.baseNetwork}/${v.subnetMask}`
        }));

        // Build device info with interfaces
        const devices = (network.devices || []).map((d: any) => ({
            deviceId: d.deviceId,
            displayName: d.displayName,
            interfaces: (d.ipVariables || []).map((v: any) => ({
                name: v.name,
                interfaceName: v.interface,
                type: v.inputType,
                vlanIndex: v.vlanIndex
            }))
        }));

        // Build natural language summary
        let summary = `Lab "${lab.title}" has a network named "${network.name}" with base network ${network.topology.baseNetwork}/${network.topology.subnetMask}.`;

        if (vlans.length > 0) {
            summary += ` It has ${vlans.length} VLAN(s): `;
            summary += vlans.map((v: any) => `${v.baseNetwork}/${v.subnetMask}`).join(', ') + '.';
        }

        if (devices.length > 0) {
            summary += ` The topology includes ${devices.length} device(s): `;
            summary += devices.map((d: any) => d.displayName).join(', ') + '.';
        }

        const ipv6Enabled = network.ipv6Config?.enabled || false;
        if (ipv6Enabled) {
            summary += ' IPv6 is enabled.';
        }

        return {
            success: true,
            context: {
                labTitle: lab.title,
                networkName: network.name,
                topology: {
                    baseNetwork: network.topology.baseNetwork,
                    subnetMask: network.topology.subnetMask,
                    allocationStrategy: network.topology.allocationStrategy
                },
                vlans,
                devices,
                ipv6Enabled,
                naturalLanguageSummary: summary
            }
        };
    }

    // ========================================================================
    // Context Injection for Part Creation
    // ========================================================================

    /**
     * Inject Part creation context (schema + topology) as a system message
     * Called when wizard enters part_create step
     */
    static async injectPartCreationContext(
        sessionId: string,
        labId: string
    ): Promise<void> {
        // 1. Get schema markdown from ArgumentExtractor
        const schemaMarkdown = ArgumentExtractor.toMarkdown('create_part');

        // 2. Get topology context
        let topologySection = '';
        const topoResult = await this.getTopologyContext(labId);
        if (topoResult.success && topoResult.context) {
            const ctx = topoResult.context;
            topologySection = `\n## Topology Context\n${ctx.naturalLanguageSummary}\n`;

            // Add device details
            if (ctx.devices.length > 0) {
                topologySection += '\n### Devices\n';
                for (const device of ctx.devices) {
                    topologySection += `- **${device.displayName}** (ID: ${device.deviceId})`;
                    if (device.interfaces.length > 0) {
                        topologySection += '\n';
                        for (const iface of device.interfaces) {
                            topologySection += `  - ${iface.name}${iface.interfaceName ? ` (${iface.interfaceName})` : ''} -- type: ${iface.type}`;
                            if (iface.vlanIndex !== undefined) {
                                topologySection += `, VLAN index: ${iface.vlanIndex}`;
                            }
                            topologySection += '\n';
                        }
                    } else {
                        topologySection += '\n';
                    }
                }
            }

            // Add VLAN details
            if (ctx.vlans.length > 0) {
                topologySection += '\n### VLANs\n';
                for (const vlan of ctx.vlans) {
                    topologySection += `- ${vlan.description}`;
                    if (vlan.vlanId) topologySection += ` (VLAN ID: ${vlan.vlanId})`;
                    topologySection += '\n';
                }
            }

            if (ctx.ipv6Enabled) {
                topologySection += '\nIPv6 is enabled for this lab.\n';
            }
        }

        // 3. Get existing parts count for auto-order suggestion
        const existingParts = await this.getPartsForLab(labId);
        const nextOrder = existingParts.length + 1;

        // 4. Build the combined context message
        const contextMessage = [
            '## Part Creation Guide',
            `Lab ID: ${labId}`,
            `Suggested next order: ${nextOrder}`,
            '',
            schemaMarkdown,
            topologySection,
            '',
            'Please ask the user for the required information to create a new Part.',
            'Start by asking for the Part title and type.'
        ].join('\n');

        // 5. Save as system message (visible to Gemini, formatted for chat)
        await this.saveMessage(sessionId, {
            role: 'model',
            textContent: `เริ่มสร้าง Part ใหม่ครับ\n\nสำหรับ Lab นี้ ผมต้องการข้อมูลดังนี้:\n1. **ชื่อ Part** -- เช่น "Basic Routing", "VLAN Configuration"\n2. **ประเภท Part** -- network_config (ตรวจจากการรันคำสั่ง), fill_in_blank (ตอบคำถาม), หรือ dhcp_config\n3. **คะแนนรวม**\n\nกรุณาบอกชื่อ Part ที่ต้องการสร้างก่อนเลยครับ`
        });

        // 6. Save the full context as a hidden system message for Gemini
        await this.saveMessage(sessionId, {
            role: 'system',
            textContent: contextMessage
        });
    }
}


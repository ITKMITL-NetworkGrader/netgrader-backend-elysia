import { env } from "process";
import { GoogleGenAI, FunctionDeclaration } from "@google/genai";
import { ChatSession, ChatMessage, IChatSession, IChatMessage } from "./model";
import { LabService } from "../labs/service";
import { PartService } from "../parts/service";
import { Course } from "../courses/model";
import { v4 as uuidv4 } from "uuid";
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
        description: "ดึงรายการ Part ใน Lab ที่กำหนด",
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
1. ดึงข้อมูล Course, Lab, Part ที่มีอยู่
2. ช่วยอาจารย์ออกแบบและสร้าง Lab ใหม่
3. ช่วยอาจารย์สร้าง Part และ Task ต่างๆ

เมื่อคุณต้องการสร้างสิ่งใหม่ (Lab/Part/Task) ให้เรียกใช้ Function ที่กำหนด
หลังจากเรียกใช้ Function คุณจะได้รับผลลัพธ์ว่าสร้างสำเร็จหรือไม่

กรุณาตอบเป็นภาษาไทยด้วยความสุภาพและเป็นมืออาชีพ`;

// ============================================================================
// Service Class
// ============================================================================

export class GeminiChatService {

    /**
     * Create a new chat session
     */
    static async createSession(userId: string | undefined): Promise<{ success: boolean; errors: string[]; data?: IChatSession }> {
        const errors: string[] = [];

        if (!userId || (typeof userId === 'string' && userId.trim() === "")) {
            errors.push("User ID is required to create a session");
            return { success: false, errors };
        }

        const sessionId = uuidv4();

        const session = new ChatSession({
            sessionId,
            userId,
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
     * Send message with streaming response
     * Returns an async generator for SSE
     */
    static async *sendMessageStream(
        sessionId: string,
        userMessage: string,
        userId: string
    ): AsyncGenerator<{ type: string; content?: string; data?: any; messageId?: string }> {
        // Get session
        const session = await this.getSession(sessionId);
        if (!session) {
            yield { type: "error", content: "Session not found" };
            return;
        }

        // Save user message
        await this.saveMessage(sessionId, {
            role: "user",
            textContent: userMessage
        });

        // Get conversation history
        const history = await this.getHistory(sessionId);
        const contents = history.map(msg => ({
            role: msg.role === "model" ? "model" : "user",
            parts: [{ text: msg.textContent }]
        }));

        try {
            // Call Gemini with streaming
            const response = await ai.models.generateContentStream({
                model: "gemini-2.5-flash",
                contents: contents,
                config: {
                    systemInstruction: SYSTEM_INSTRUCTION,
                    tools: [{ functionDeclarations }]
                }
            });

            let fullText = "";
            let functionCall: any = null;

            // Stream text chunks
            for await (const chunk of response) {
                // Check for function call
                const parts = chunk.candidates?.[0]?.content?.parts || [];
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

            // Handle function call if present
            if (functionCall) {
                const draft = await this.createDraftFromFunctionCall(functionCall, userId);

                // Save message with draft
                const savedMessage = await this.saveMessage(sessionId, {
                    role: "model",
                    textContent: fullText || "กำลังสร้าง draft...",
                    humanReadablePreview: draft.previewText,
                    jsonPreview: draft.data,
                    functionCall: {
                        name: functionCall.name,
                        args: functionCall.args,
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
                // Save final model response
                await this.saveMessage(sessionId, {
                    role: "model",
                    textContent: fullText
                });
            }

            yield { type: "done" };

        } catch (error: any) {
            console.error("Gemini Stream Error:", error);
            yield { type: "error", content: error.message };
        }
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

        try {
            if (type === "lab") {
                result = await LabService.createLab(data, userId);
                // Update session context
                await ChatSession.updateOne(
                    { sessionId },
                    { $set: { "currentContext.labId": result._id || result.id } }
                );
            } else if (type === "part") {
                result = await PartService.createPart(data, userId);
                await ChatSession.updateOne(
                    { sessionId },
                    { $set: { "currentContext.partId": result._id || result.id } }
                );
            } else if (type === "task") {
                const partId = data.partId;
                const part = await PartService.getPartById(partId);
                if (!part) throw new Error("Part not found");

                const updatedTasks = [...(part.tasks || []), data];
                result = await PartService.updatePart(partId, { tasks: updatedTasks });
            }

            // Update message status
            await ChatMessage.updateOne(
                { sessionId, messageId },
                { $set: { "functionCall.status": "executed" } }
            );

            // Add system message
            await this.saveMessage(sessionId, {
                role: "system",
                textContent: `[สำเร็จ] สร้าง ${type} เรียบร้อยแล้ว`
            });

            return { success: true, result };
        } catch (error: any) {
            console.error("Confirm Draft Error:", error);
            return { success: false, error: error.message };
        }
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
            description: c.description,
            visibility: c.visibility,
            createdAt: c.createdAt
        }));
    }

    /**
     * Get labs in a course
     */
    static async getLabsForCourse(courseId: string): Promise<any[]> {
        const labs = await LabService.getLabsByCourse(courseId);
        return labs.labs.map((lab: any) => ({
            id: lab._id?.toString() || lab.id,
            title: lab.title,
            description: lab.description,
            type: lab.type,
            status: lab.status,
            createdAt: lab.createdAt
        }));
    }

    /**
     * Get parts in a lab
     */
    static async getPartsForLab(labId: string): Promise<any[]> {
        const result = await PartService.getPartsByLab(labId);
        return result.parts.map((part: any) => ({
            id: part._id?.toString() || part.id,
            title: part.title,
            description: part.description,
            order: part.order,
            createdAt: part.createdAt
        }));
    }

    /**
     * Get wizard state for a session
     */
    static async getWizardState(sessionId: string): Promise<any> {
        const session = await ChatSession.findOne({ sessionId });
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
            { $set: update }
        );

        // Update lastMessageAt
        await ChatSession.updateOne(
            { sessionId },
            { $set: { lastMessageAt: new Date() } }
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
}

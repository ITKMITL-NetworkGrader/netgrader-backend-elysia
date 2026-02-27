import { env } from "process";
import { GoogleGenAI } from "@google/genai";
import { status } from "elysia";
import { v4 as uuidv4 } from "uuid";
import "dotenv/config";
import { TASK_GENERATOR_INSTRUCTION } from "./system-instruction";
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

// ============================================================================
// Task Generator Service
// ============================================================================

export class TaskGeneratorService {

    // ========================================================================
    // Session CRUD
    // ========================================================================

    /**
     * Create a new chat session
     */
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

    /**
     * List all sessions for a user
     */
    static async listSessions(userId: string): Promise<ITaskGeneratorSession[]> {
        return TaskGeneratorSession
            .find({ userId })
            .sort({ lastMessageAt: -1 })
            .lean() as unknown as ITaskGeneratorSession[];
    }

    /**
     * Get a single session by ID
     */
    static async getSession(sessionId: string): Promise<ITaskGeneratorSession | null> {
        return TaskGeneratorSession.findOne({ sessionId });
    }

    /**
     * Delete a session and all its messages
     */
    static async deleteSession(sessionId: string): Promise<void> {
        await TaskGeneratorMessage.deleteMany({ sessionId });
        await TaskGeneratorSession.deleteOne({ sessionId });
    }

    // ========================================================================
    // Message CRUD
    // ========================================================================

    /**
     * Get all messages for a session (ordered by timestamp)
     */
    static async getMessages(sessionId: string): Promise<ITaskGeneratorMessage[]> {
        return TaskGeneratorMessage
            .find({ sessionId })
            .sort({ timestamp: 1 })
            .lean() as unknown as ITaskGeneratorMessage[];
    }

    /**
     * Save a message to the database
     */
    private static async saveMessage(
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

        // Update session lastMessageAt
        await TaskGeneratorSession.updateOne(
            { sessionId },
            { $set: { lastMessageAt: new Date() } }
        );

        return message;
    }

    // ========================================================================
    // Chat with Gemini
    // ========================================================================

    /**
     * Send a message within a session context
     * 1. Save user message to DB
     * 2. Load full history from DB
     * 3. Send to Gemini with system instruction
     * 4. Save model response to DB
     * 5. Return the response
     */
    static async chat(
        sessionId: string,
        message: string,
        userId: string
    ): Promise<{ success: true; result: string; userMessageId: string; modelMessageId: string } | { success: false; error: string; statusCode: number }> {

        if (!env.GEMINI_API_KEY) {
            return { success: false, error: "GEMINI_API_KEY is not configured", statusCode: 500 };
        }

        // 1. Save user message
        const userMsg = await this.saveMessage(
            sessionId, "user", message, userId, null
        );

        // 2. Load full history from DB
        const allMessages = await this.getMessages(sessionId);

        // 3. Build contents array for Gemini
        const contents = allMessages.map((msg) => ({
            role: msg.role,
            parts: [{ text: msg.content }]
        }));

        console.log(`[TaskGenerator] Session: ${sessionId}`);
        console.log(`[TaskGenerator] History turns: ${contents.length}`);
        console.log(`[TaskGenerator] User message: "${message.slice(0, 100)}..."`);

        // 4. Call Gemini
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
        console.log(`[TaskGenerator] Response length: ${resultText.length} chars`);

        // 5. Save model response
        const modelMsg = await this.saveMessage(
            sessionId, "model", resultText, null, MODEL_DISPLAY_NAME
        );

        return {
            success: true,
            result: resultText,
            userMessageId: userMsg.messageId,
            modelMessageId: modelMsg.messageId
        };
    }
}

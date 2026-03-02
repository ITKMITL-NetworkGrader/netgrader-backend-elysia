import { Elysia, t } from "elysia";
import { TaskGeneratorService } from "./service";
import { authPlugin, requireRole } from "../../plugins/plugins";

// ============================================================================
// Request / Response Schemas
// ============================================================================

const createSessionSchema = t.Object({
    title: t.Optional(t.String({ description: "Session title" }))
});

const chatRequestSchema = t.Object({
    message: t.String({ minLength: 1, description: "The user message to send" })
});

const sessionResponseSchema = t.Object({
    success: t.Boolean(),
    data: t.Optional(t.Object({
        sessionId: t.String(),
        title: t.String(),
        status: t.String(),
        lastMessageAt: t.Date()
    })),
    message: t.Optional(t.String()),
    errors: t.Optional(t.Array(t.String()))
});

const sessionsListSchema = t.Object({
    success: t.Boolean(),
    data: t.Optional(t.Object({
        sessions: t.Array(t.Object({
            sessionId: t.String(),
            title: t.String(),
            status: t.String(),
            lastMessageAt: t.Date(),
            createdAt: t.Optional(t.Date())
        }))
    }))
});

const messagesListSchema = t.Object({
    success: t.Boolean(),
    data: t.Optional(t.Object({
        session: t.Object({
            sessionId: t.String(),
            title: t.String(),
            status: t.String()
        }),
        messages: t.Array(t.Object({
            messageId: t.String(),
            role: t.String(),
            userId: t.Nullable(t.String()),
            modelName: t.Nullable(t.String()),
            content: t.String(),
            timestamp: t.Date()
        }))
    })),
    message: t.Optional(t.String())
});

const chatResponseSchema = t.Object({
    success: t.Boolean(),
    data: t.Optional(t.Object({
        result: t.String(),
        userMessageId: t.String(),
        modelMessageId: t.String()
    })),
    message: t.Optional(t.String())
});

const errorSchema = t.Object({
    success: t.Boolean(),
    message: t.Optional(t.String()),
    errors: t.Optional(t.Array(t.String()))
});

// ============================================================================
// Routes
// ============================================================================

export const taskGeneratorRoutes = new Elysia({ prefix: "/task-generator" })
    .use(authPlugin)

    // ========================================================================
    // POST /task-generator/sessions - Create new session
    // ========================================================================
    .post(
        "/sessions",
        async ({ body, authPlugin: auth }) => {
            const u_id = auth?.u_id || (process.env.NODE_ENV !== 'production' ? "dev-instructor" : "");

            const result = await TaskGeneratorService.createSession(u_id, body.title);

            if (!result.success || !result.data) {
                return {
                    success: false,
                    message: result.errors[0] || "Failed to create session",
                    errors: result.errors
                };
            }

            return {
                success: true,
                data: {
                    sessionId: result.data.sessionId,
                    title: result.data.title,
                    status: result.data.status,
                    lastMessageAt: result.data.lastMessageAt
                }
            };
        },
        {
            body: createSessionSchema,
            beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
            detail: {
                summary: "Create Task Generator Session",
                description: "สร้าง session ใหม่สำหรับ Task Generator",
                tags: ["Task Generator"]
            }
        }
    )

    // ========================================================================
    // GET /task-generator/sessions - List all sessions
    // ========================================================================
    .get(
        "/sessions",
        async ({ authPlugin: auth }) => {
            const u_id = auth?.u_id || (process.env.NODE_ENV !== 'production' ? "dev-instructor" : "");

            const sessions = await TaskGeneratorService.listSessions(u_id);

            return {
                success: true,
                data: {
                    sessions: sessions.map(s => ({
                        sessionId: s.sessionId,
                        title: s.title,
                        status: s.status,
                        lastMessageAt: s.lastMessageAt,
                        createdAt: s.createdAt
                    }))
                }
            };
        },
        {
            beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
            detail: {
                summary: "List Task Generator Sessions",
                description: "ดึง session ทั้งหมดของ user",
                tags: ["Task Generator"]
            }
        }
    )

    // ========================================================================
    // GET /task-generator/sessions/:sessionId - Get session with messages
    // ========================================================================
    .get(
        "/sessions/:sessionId",
        async ({ params, authPlugin: auth, set }) => {
            const { sessionId } = params;
            const u_id = auth?.u_id || (process.env.NODE_ENV !== 'production' ? "dev-instructor" : "");

            const session = await TaskGeneratorService.getSession(sessionId);

            if (!session) {
                set.status = 404;
                return { success: false, message: "Session not found" };
            }

            if (session.userId !== u_id && process.env.NODE_ENV === 'production') {
                set.status = 403;
                return { success: false, message: "Access denied" };
            }

            const messages = await TaskGeneratorService.getMessages(sessionId);

            return {
                success: true,
                data: {
                    session: {
                        sessionId: session.sessionId,
                        title: session.title,
                        status: session.status
                    },
                    messages: messages.map(m => ({
                        messageId: m.messageId,
                        role: m.role,
                        userId: m.userId,
                        modelName: m.modelName,
                        content: m.content,
                        timestamp: m.timestamp
                    }))
                }
            };
        },
        {
            params: t.Object({ sessionId: t.String() }),
            beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
            detail: {
                summary: "Get Session with Messages",
                description: "ดึง session พร้อมข้อความทั้งหมด",
                tags: ["Task Generator"]
            }
        }
    )

    // ========================================================================
    // DELETE /task-generator/sessions/:sessionId - Delete session
    // ========================================================================
    .delete(
        "/sessions/:sessionId",
        async ({ params, authPlugin: auth, set }) => {
            const { sessionId } = params;
            const u_id = auth?.u_id || (process.env.NODE_ENV !== 'production' ? "dev-instructor" : "");

            const session = await TaskGeneratorService.getSession(sessionId);

            if (!session) {
                set.status = 404;
                return { success: false, message: "Session not found" };
            }

            if (session.userId !== u_id && process.env.NODE_ENV === 'production') {
                set.status = 403;
                return { success: false, message: "Access denied" };
            }

            await TaskGeneratorService.deleteSession(sessionId);

            return { success: true, message: "Session deleted" };
        },
        {
            params: t.Object({ sessionId: t.String() }),
            beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
            detail: {
                summary: "Delete Task Generator Session",
                description: "ลบ session และข้อความทั้งหมด",
                tags: ["Task Generator"]
            }
        }
    )

    // ========================================================================
    // POST /task-generator/sessions/:sessionId/chat - Send message
    // ========================================================================
    .post(
        "/sessions/:sessionId/chat",
        async ({ params, body, authPlugin: auth, set }) => {
            const { sessionId } = params;
            const u_id = auth?.u_id || (process.env.NODE_ENV !== 'production' ? "dev-instructor" : "");

            const session = await TaskGeneratorService.getSession(sessionId);

            if (!session) {
                set.status = 404;
                return { success: false, message: "Session not found" };
            }

            if (session.userId !== u_id && process.env.NODE_ENV === 'production') {
                set.status = 403;
                return { success: false, message: "Access denied" };
            }

            const result = await TaskGeneratorService.chat(
                sessionId,
                body.message,
                u_id
            );

            if (!result.success) {
                set.status = result.statusCode as 500 | 502;
                return { success: false, message: result.error };
            }

            return {
                success: true,
                data: {
                    result: result.result,
                    userMessageId: result.userMessageId,
                    modelMessageId: result.modelMessageId
                }
            };
        },
        {
            params: t.Object({ sessionId: t.String() }),
            body: chatRequestSchema,
            beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
            detail: {
                summary: "Send Message to Task Generator",
                description: "ส่งข้อความใน session และรับ response จาก Gemini (auto-save ทุกข้อความ)",
                tags: ["Task Generator"]
            }
        }
    )

    // ========================================================================
    // POST /task-generator/sessions/:sessionId/pipeline - Run full pipeline
    // ========================================================================
    .post(
        "/sessions/:sessionId/pipeline",
        async ({ params, body, authPlugin: auth, set }) => {
            const { sessionId } = params;
            const u_id = auth?.u_id || (process.env.NODE_ENV !== 'production' ? "dev-instructor" : "");

            const session = await TaskGeneratorService.getSession(sessionId);

            if (!session) {
                set.status = 404;
                return { success: false, message: "Session not found" };
            }

            if (session.userId !== u_id && process.env.NODE_ENV === 'production') {
                set.status = 403;
                return { success: false, message: "Access denied" };
            }

            const result = await TaskGeneratorService.runPipeline(
                sessionId,
                body.message,
                u_id
            );

            return result;
        },
        {
            params: t.Object({ sessionId: t.String() }),
            body: chatRequestSchema,
            beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
            detail: {
                summary: "Run Task Generator Pipeline",
                description: "รัน pipeline 6 ขั้นตอน: extract intent > decompose > check scripts > generate > execute",
                tags: ["Task Generator Pipeline"]
            }
        }
    )

    // ========================================================================
    // POST /task-generator/extract-intent - Step 1 only (for step-by-step)
    // ========================================================================
    .post(
        "/extract-intent",
        async ({ body }) => {
            const result = await TaskGeneratorService.extractIntent(body.message);
            return result;
        },
        {
            body: chatRequestSchema,
            beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
            detail: {
                summary: "Extract Intent (Step 1)",
                description: "แปลง natural language เป็น structured JSON intent",
                tags: ["Task Generator Pipeline"]
            }
        }
    )

    // ========================================================================
    // POST /task-generator/decompose-tasks - Step 2 only (for step-by-step)
    // ========================================================================
    .post(
        "/decompose-tasks",
        async ({ body }) => {
            const result = await TaskGeneratorService.decomposeTasks(body.intent);
            return result;
        },
        {
            body: t.Object({
                intent: t.Any({ description: "The extracted intent JSON from Step 1" })
            }),
            beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
            detail: {
                summary: "Decompose Tasks (Step 2)",
                description: "แตก intent เป็น sub-tasks ที่สามารถ execute ได้",
                tags: ["Task Generator Pipeline"]
            }
        }
    );


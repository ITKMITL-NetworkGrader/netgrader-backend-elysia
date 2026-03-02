import { Elysia, t } from "elysia";
import { TaskGeneratorService } from "./service";
import { PipelineService } from "./pipeline-service";
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
    )

    // ========================================================================
    // POST /task-generator/sessions/:sessionId/pipeline/start
    // ========================================================================
    .post(
        "/sessions/:sessionId/pipeline/start",
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

            const result = await PipelineService.startPipeline(sessionId, body.message, u_id);
            return result;
        },
        {
            params: t.Object({ sessionId: t.String() }),
            body: t.Object({
                message: t.String({ minLength: 1, description: "Natural language task description" })
            }),
            beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
            detail: {
                summary: "Start Pipeline (Step-by-Step)",
                description: "เริ่ม pipeline step-by-step: รัน Step 1 แล้วหยุดรอ User Confirm",
                tags: ["Task Generator Pipeline v2"]
            }
        }
    )

    // ========================================================================
    // GET /task-generator/sessions/:sessionId/pipeline/:pipelineId
    // ========================================================================
    .get(
        "/sessions/:sessionId/pipeline/:pipelineId",
        async ({ params, authPlugin: auth, set }) => {
            const { sessionId, pipelineId } = params;
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

            const { pipeline, modules } = await PipelineService.getPipelineRun(pipelineId);
            if (!pipeline) {
                set.status = 404;
                return { success: false, message: "Pipeline not found" };
            }

            return { success: true, data: { pipeline, modules } };
        },
        {
            params: t.Object({
                sessionId: t.String(),
                pipelineId: t.String()
            }),
            beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
            detail: {
                summary: "Get Pipeline Run",
                description: "ดึงข้อมูล Pipeline Run พร้อม Modules ทั้งหมด",
                tags: ["Task Generator Pipeline v2"]
            }
        }
    )

    // ========================================================================
    // POST /task-generator/pipeline/:pipelineId/modules/:moduleId/confirm
    // ========================================================================
    .post(
        "/pipeline/:pipelineId/modules/:moduleId/confirm",
        async ({ params }) => {
            const { pipelineId, moduleId } = params;
            const result = await PipelineService.confirmModule(pipelineId, moduleId);
            return result;
        },
        {
            params: t.Object({
                pipelineId: t.String(),
                moduleId: t.String()
            }),
            beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
            detail: {
                summary: "Confirm Module",
                description: "Confirm module ที่ waiting_confirm แล้วรัน step ถัดไป",
                tags: ["Task Generator Pipeline v2"]
            }
        }
    )

    // ========================================================================
    // POST /task-generator/pipeline/:pipelineId/modules/:moduleId/retry
    // ========================================================================
    .post(
        "/pipeline/:pipelineId/modules/:moduleId/retry",
        async ({ params, body }) => {
            const { pipelineId, moduleId } = params;
            const result = await PipelineService.retryModule(
                pipelineId,
                moduleId,
                body.feedback
            );
            return result;
        },
        {
            params: t.Object({
                pipelineId: t.String(),
                moduleId: t.String()
            }),
            body: t.Object({
                feedback: t.Optional(t.String({ description: "Optional user feedback for retry" }))
            }),
            beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
            detail: {
                summary: "Retry Module",
                description: "Retry module ใหม่ พร้อม feedback จาก user (ลบ modules ถัดไปทั้งหมด)",
                tags: ["Task Generator Pipeline v2"]
            }
        }
    )

    // ========================================================================
    // GET /task-generator/scripts/registry - List all registered scripts
    // ========================================================================
    .get(
        "/scripts/registry",
        async () => {
            const scripts = await PipelineService.getScriptRegistry();
            return { success: true, data: scripts };
        },
        {
            beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
            detail: {
                summary: "List Script Registry",
                description: "ดึง Script Registry ทั้งหมดจาก DB",
                tags: ["Task Generator Script Registry"]
            }
        }
    )

    // ========================================================================
    // POST /task-generator/scripts/registry - Add script to registry
    // ========================================================================
    .post(
        "/scripts/registry",
        async ({ body }) => {
            const result = await PipelineService.addScriptToRegistry({
                action: body.action,
                deviceType: body.deviceType as "host" | "network_device",
                os: body.os as "linux" | "cisco",
                description: body.description,
                arguments: body.arguments,
                scriptPath: body.scriptPath,
                source: (body.source || "manual") as "manual" | "generated"
            });
            return { success: true, data: result };
        },
        {
            body: t.Object({
                action: t.String({ description: "Action name e.g. ping" }),
                deviceType: t.String({ description: "host or network_device" }),
                os: t.String({ description: "linux or cisco" }),
                description: t.String({ description: "Script description" }),
                arguments: t.Array(t.Object({
                    name: t.String(),
                    description: t.String(),
                    required: t.Boolean(),
                    defaultValue: t.Optional(t.String())
                })),
                scriptPath: t.String({ description: "Path in script-storage" }),
                source: t.Optional(t.String({ description: "manual or generated" }))
            }),
            beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
            detail: {
                summary: "Add Script to Registry",
                description: "เพิ่ม Script เข้า Registry ด้วยมือ (manual)",
                tags: ["Task Generator Script Registry"]
            }
        }
    )

    // ========================================================================
    // GET /task-generator/sessions/:sessionId/pipeline/history
    // ========================================================================
    .get(
        "/sessions/:sessionId/pipeline/history",
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

            const history = await PipelineService.getPipelineHistory(sessionId);
            return { success: true, data: history };
        },
        {
            params: t.Object({ sessionId: t.String() }),
            beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
            detail: {
                summary: "Pipeline History",
                description: "ดึง Pipeline Run ทั้งหมดของ Session",
                tags: ["Task Generator Pipeline v2"]
            }
        }
    );

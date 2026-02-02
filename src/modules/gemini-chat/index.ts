import { Elysia, t } from "elysia";
import { GeminiChatService } from "./service";
import { GeminiChatValidator } from "./validator";
import { authPlugin, requireRole } from "../../plugins/plugins";

// Request schemas
const createSessionSchema = t.Object({});

const sendMessageSchema = t.Object({
    message: t.String({ minLength: 1, description: "ข้อความที่ต้องการส่ง" })
});

// Response schemas
const sessionResponseSchema = t.Object({
    success: t.Boolean(),
    data: t.Optional(t.Object({
        sessionId: t.String(),
        status: t.String(),
        currentContext: t.Object({
            courseId: t.Optional(t.String()),
            labId: t.Optional(t.String()),
            partId: t.Optional(t.String())
        })
    })),
    message: t.Optional(t.String()),
    errors: t.Optional(t.Array(t.String()))
});

const errorResponseSchema = t.Object({
    success: t.Boolean(),
    message: t.Optional(t.String()),
    errors: t.Optional(t.Array(t.String()))
});

export const geminiChatRoutes = new Elysia({ prefix: "/gemini/chat" })
    .use(authPlugin)
    // ============================================================================
    // POST /gemini/chat - Create new session
    // ============================================================================
    .post(
        "/",
        async ({ authPlugin, set }) => {
            // Fallback for dev mode as plugins.ts returns {} in dev
            const u_id = authPlugin?.u_id || (process.env.NODE_ENV !== 'production' ? "dev-instructor" : "");

            if (!u_id && process.env.NODE_ENV === 'production') {
                set.status = 401;
                return {
                    success: false,
                    message: "Authentication required",
                    errors: ["You must be logged in to create a chat session"]
                };
            }

            // Create session
            const result = await GeminiChatService.createSession(u_id);
            if (!result.success || !result.data) {
                set.status = 500;
                return {
                    success: false,
                    message: result.errors[0] || "Failed to create session",
                    errors: result.errors
                };
            }

            const session = result.data;
            return {
                success: true,
                data: {
                    sessionId: session.sessionId,
                    status: session.status,
                    currentContext: session.currentContext || {}
                }
            };
        },
        {
            body: createSessionSchema,
            response: {
                200: sessionResponseSchema,
                401: errorResponseSchema,
                403: t.Object({ error: t.String() }),
                500: errorResponseSchema
            },
            beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
            detail: {
                summary: "Create Chat Session",
                description: "สร้าง session ใหม่สำหรับแชทกับ Gemini Assistant",
                tags: ["Gemini Chat"]
            }
        }
    )

    // ============================================================================
    // POST /gemini/chat/:sessionId/message - Send message (SSE Streaming)
    // ============================================================================
    .post(
        "/:sessionId/message",
        async function* ({ params, body, authPlugin, set }) {
            // Set SSE headers immediately at the start
            set.headers["Content-Type"] = "text/event-stream";
            set.headers["Cache-Control"] = "no-cache";
            set.headers["Connection"] = "keep-alive";
            set.headers["X-Accel-Buffering"] = "no"; // Disable buffering for Nginx

            const u_id = authPlugin?.u_id || (process.env.NODE_ENV !== 'production' ? "dev-instructor" : "");
            const { sessionId } = params;

            // Validate session ID format
            const sessionIdValidation = GeminiChatValidator.validateSessionId(sessionId);
            if (!sessionIdValidation.valid) {
                yield `data: ${JSON.stringify({ type: "error", message: "Invalid session ID", errors: sessionIdValidation.errors })}\n\n`;
                return;
            }

            // Validate session exists and user owns it
            const sessionValidation = await GeminiChatValidator.validateSessionOwnership(sessionId, u_id);
            if (!sessionValidation.valid) {
                yield `data: ${JSON.stringify({ type: "error", message: "Session validation failed", errors: sessionValidation.errors })}\n\n`;
                return;
            }

            const { message } = body;

            // Validate message content
            const messageValidation = GeminiChatValidator.validateMessageContent(message);
            if (!messageValidation.valid) {
                yield `data: ${JSON.stringify({ type: "error", message: "Message validation failed", errors: messageValidation.errors })}\n\n`;
                return;
            }

            // Stream the response
            for await (const chunk of GeminiChatService.sendMessageStream(
                sessionId,
                message,
                u_id
            )) {
                yield `data: ${JSON.stringify(chunk)}\n\n`;
            }
        },
        {
            params: t.Object({
                sessionId: t.String()
            }),
            body: sendMessageSchema,
            beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
            detail: {
                summary: "Send Message (Streaming)",
                description: "ส่งข้อความและรับ response แบบ SSE streaming",
                tags: ["Gemini Chat"]
            }
        }
    )

    // ============================================================================
    // GET /gemini/chat/:sessionId - Get session with history
    // ============================================================================
    .get(
        "/:sessionId",
        async ({ params, authPlugin, set }) => {
            const u_id = authPlugin?.u_id || (process.env.NODE_ENV !== 'production' ? "dev-instructor" : "");
            const { sessionId } = params;

            // Validate session ID format
            const sessionIdValidation = GeminiChatValidator.validateSessionId(sessionId);
            if (!sessionIdValidation.valid) {
                set.status = 400;
                return {
                    success: false,
                    message: "Invalid session ID",
                    errors: sessionIdValidation.errors
                };
            }

            // Validate session exists
            const sessionValidation = await GeminiChatValidator.validateSessionExists(sessionId);
            if (!sessionValidation.valid) {
                set.status = 404;
                return {
                    success: false,
                    message: "Session not found",
                    errors: sessionValidation.errors
                };
            }

            const session = sessionValidation.session;

            // Get history
            const history = await GeminiChatService.getHistory(sessionId);

            return {
                success: true,
                data: {
                    session: {
                        sessionId: session.sessionId,
                        status: session.status,
                        currentContext: session.currentContext,
                        lastMessageAt: session.lastMessageAt
                    },
                    messages: history.map((msg: any) => ({
                        messageId: msg.messageId,
                        role: msg.role,
                        textContent: msg.textContent,
                        humanReadablePreview: msg.humanReadablePreview,
                        jsonPreview: msg.jsonPreview,
                        functionCall: msg.functionCall,
                        draftData: msg.draftData,
                        timestamp: msg.timestamp
                    }))
                }
            };
        },
        {
            params: t.Object({
                sessionId: t.String()
            }),
            response: {
                200: t.Object({
                    success: t.Boolean(),
                    data: t.Object({
                        session: t.Object({
                            sessionId: t.String(),
                            status: t.String(),
                            currentContext: t.Object({
                                courseId: t.Optional(t.String()),
                                labId: t.Optional(t.String()),
                                partId: t.Optional(t.String())
                            }),
                            lastMessageAt: t.Date()
                        }),
                        messages: t.Array(t.Object({
                            messageId: t.String(),
                            role: t.String(),
                            textContent: t.String(),
                            humanReadablePreview: t.Optional(t.String()),
                            jsonPreview: t.Optional(t.Any()),
                            functionCall: t.Optional(t.Any()),
                            draftData: t.Optional(t.Any()),
                            timestamp: t.Date()
                        }))
                    })
                }),
                400: errorResponseSchema,
                401: errorResponseSchema,
                403: t.Object({ error: t.String() }),
                404: errorResponseSchema,
                500: errorResponseSchema
            },
            beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
            detail: {
                summary: "Get Session History",
                description: "ดึงข้อมูล session และประวัติการแชททั้งหมด",
                tags: ["Gemini Chat"]
            }
        }
    )

    // ============================================================================
    // GET /gemini/chat - List user's sessions
    // ============================================================================
    .get(
        "/",
        async ({ authPlugin, set }) => {
            const u_id = authPlugin?.u_id || (process.env.NODE_ENV !== 'production' ? "dev-instructor" : "");

            // Get sessions
            const sessions = await GeminiChatService.listSessions(u_id);

            return {
                success: true,
                data: {
                    sessions: sessions.map((s: any) => ({
                        sessionId: s.sessionId,
                        status: s.status,
                        currentContext: s.currentContext,
                        lastMessageAt: s.lastMessageAt,
                        createdAt: s.createdAt
                    }))
                }
            };
        },
        {
            response: {
                200: t.Object({
                    success: t.Boolean(),
                    data: t.Object({
                        sessions: t.Array(t.Object({
                            sessionId: t.String(),
                            status: t.String(),
                            currentContext: t.Object({
                                courseId: t.Optional(t.String()),
                                labId: t.Optional(t.String()),
                                partId: t.Optional(t.String())
                            }),
                            lastMessageAt: t.Date(),
                            createdAt: t.Date()
                        }))
                    })
                }),
                401: errorResponseSchema,
                403: t.Object({ error: t.String() }),
                500: errorResponseSchema
            },
            beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
            detail: {
                summary: "List Sessions",
                description: "ดึงรายการ chat sessions ของ user",
                tags: ["Gemini Chat"]
            }
        }
    )

    // ============================================================================
    // POST /gemini/chat/:sessionId/confirm/:messageId - Confirm draft
    // ============================================================================
    .post(
        "/:sessionId/confirm/:messageId",
        async ({ params, authPlugin, set }) => {
            const u_id = authPlugin?.u_id || (process.env.NODE_ENV !== 'production' ? "dev-instructor" : "");
            const { sessionId, messageId } = params;

            // Validate session ID format
            const sessionIdValidation = GeminiChatValidator.validateSessionId(sessionId);
            if (!sessionIdValidation.valid) {
                set.status = 400;
                return {
                    success: false,
                    message: "Invalid session ID",
                    errors: sessionIdValidation.errors
                };
            }

            // Validate draft action (session ownership + draft message)
            const draftValidation = await GeminiChatValidator.validateDraftAction(
                sessionId,
                messageId,
                u_id
            );
            if (!draftValidation.valid) {
                const isNotFound = draftValidation.errors.some(e => e.includes("not found"));
                const isAccessDenied = draftValidation.errors.some(e => e.includes("Access denied"));
                if (isNotFound) {
                    set.status = 404;
                } else if (isAccessDenied) {
                    set.status = 403;
                } else {
                    set.status = 400;
                }
                return {
                    success: false,
                    message: "Draft validation failed",
                    errors: draftValidation.errors
                };
            }

            // Execute the draft
            const result = await GeminiChatService.confirmDraft(
                sessionId,
                messageId,
                u_id
            );

            if (!result.success) {
                set.status = 500;
                return {
                    success: false,
                    message: "Failed to confirm draft",
                    errors: [result.error || "Unknown error"]
                };
            }

            return {
                success: true,
                data: result.result
            };
        },
        {
            params: t.Object({
                sessionId: t.String(),
                messageId: t.String()
            }),
            response: {
                200: t.Object({
                    success: t.Boolean(),
                    data: t.Any()
                }),
                400: errorResponseSchema,
                401: errorResponseSchema,
                403: t.Object({ error: t.String() }),
                404: errorResponseSchema,
                500: errorResponseSchema
            },
            beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
            detail: {
                summary: "Confirm Draft",
                description: "ยืนยันการสร้าง Lab/Part/Task จาก draft",
                tags: ["Gemini Chat"]
            }
        }
    )

    // ============================================================================
    // POST /gemini/chat/:sessionId/reject/:messageId - Reject draft
    // ============================================================================
    .post(
        "/:sessionId/reject/:messageId",
        async ({ params, authPlugin, set }) => {
            const u_id = authPlugin?.u_id || (process.env.NODE_ENV !== 'production' ? "dev-instructor" : "");
            const { sessionId, messageId } = params;

            // Validate session ID format
            const sessionIdValidation = GeminiChatValidator.validateSessionId(sessionId);
            if (!sessionIdValidation.valid) {
                set.status = 400;
                return {
                    success: false,
                    message: "Invalid session ID",
                    errors: sessionIdValidation.errors
                };
            }

            // Validate draft action
            const draftValidation = await GeminiChatValidator.validateDraftAction(
                sessionId,
                messageId,
                u_id
            );
            if (!draftValidation.valid) {
                const isNotFound = draftValidation.errors.some(e => e.includes("not found"));
                const isAccessDenied = draftValidation.errors.some(e => e.includes("Access denied"));
                if (isNotFound) {
                    set.status = 404;
                } else if (isAccessDenied) {
                    set.status = 403;
                } else {
                    set.status = 400;
                }
                return {
                    success: false,
                    message: "Draft validation failed",
                    errors: draftValidation.errors
                };
            }

            // Reject the draft
            await GeminiChatService.rejectDraft(sessionId, messageId);

            return { success: true };
        },
        {
            params: t.Object({
                sessionId: t.String(),
                messageId: t.String()
            }),
            response: {
                200: t.Object({ success: t.Boolean() }),
                400: errorResponseSchema,
                401: errorResponseSchema,
                403: t.Object({ error: t.String() }),
                404: errorResponseSchema,
                500: errorResponseSchema
            },
            beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
            detail: {
                summary: "Reject Draft",
                description: "ปฏิเสธ draft",
                tags: ["Gemini Chat"]
            }
        }
    )

    // ============================================================================
    // DELETE /gemini/chat/:sessionId - Close session
    // ============================================================================
    .delete(
        "/:sessionId",
        async ({ params, authPlugin, set }) => {
            const u_id = authPlugin?.u_id || (process.env.NODE_ENV !== 'production' ? "dev-instructor" : "");
            const { sessionId } = params;

            // Validate session ID format
            const sessionIdValidation = GeminiChatValidator.validateSessionId(sessionId);
            if (!sessionIdValidation.valid) {
                set.status = 400;
                return {
                    success: false,
                    message: "Invalid session ID",
                    errors: sessionIdValidation.errors
                };
            }

            // Validate session ownership
            const sessionValidation = await GeminiChatValidator.validateSessionOwnership(sessionId, u_id);
            if (!sessionValidation.valid) {
                const isNotFound = sessionValidation.errors.some(e => e.includes("not found"));
                const isAccessDenied = sessionValidation.errors.some(e => e.includes("Access denied"));
                if (isNotFound) {
                    set.status = 404;
                } else if (isAccessDenied) {
                    set.status = 403;
                } else {
                    set.status = 400;
                }
                return {
                    success: false,
                    message: "Session validation failed",
                    errors: sessionValidation.errors
                };
            }

            // Close the session
            await GeminiChatService.closeSession(sessionId);

            return { success: true };
        },
        {
            params: t.Object({
                sessionId: t.String()
            }),
            response: {
                200: t.Object({ success: t.Boolean() }),
                400: errorResponseSchema,
                401: errorResponseSchema,
                403: t.Object({ error: t.String() }),
                404: errorResponseSchema,
                500: errorResponseSchema
            },
            beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
            detail: {
                summary: "Close Session",
                description: "ปิด session",
                tags: ["Gemini Chat"]
            }
        }
    );

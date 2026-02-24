import { Elysia, t } from "elysia";
import { GeminiChatService } from "./service";
import { GeminiChatValidator } from "./validator";
import { authPlugin, requireRole } from "../../plugins/plugins";

// Request schemas
const createSessionSchema = t.Object({
    title: t.Optional(t.String({ description: "Chat session name" })),
    contextType: t.Optional(t.Union(
        [t.Literal('course'), t.Literal('lab'), t.Literal('part')],
        { description: "Context level: course, lab, or part" }
    )),
    action: t.Optional(t.Union(
        [t.Literal('create'), t.Literal('edit')],
        { description: "Action: create or edit" }
    )),
    courseId: t.Optional(t.String({ description: "Course ID (for lab/part context or course edit)" })),
    labId: t.Optional(t.String({ description: "Lab ID (for part context or lab edit)" })),
    partId: t.Optional(t.String({ description: "Part ID (for part edit)" }))
});

const sendMessageSchema = t.Object({
    message: t.String({ minLength: 1, description: "ข้อความที่ต้องการส่ง" }),
    courseId: t.Optional(t.String({ description: "Course ID (required for lab/part operations)" })),
    labId: t.Optional(t.String({ description: "Lab ID (required for part operations)" })),
    partId: t.Optional(t.String({ description: "Part ID (required for edit part)" }))
});

// Response schemas
const sessionResponseSchema = t.Object({
    success: t.Boolean(),
    data: t.Optional(t.Object({
        sessionId: t.String(),
        title: t.String(),
        status: t.String(),
        currentContext: t.Object({
            courseId: t.Optional(t.String()),
            labId: t.Optional(t.String()),
            partId: t.Optional(t.String())
        }),
        wizardState: t.Optional(t.Object({
            step: t.String(),
            courseId: t.Optional(t.String()),
            labId: t.Optional(t.String()),
            partId: t.Optional(t.String()),
            editSection: t.Optional(t.String())
        }))
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
        async ({ body, authPlugin, set }) => {
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

            // Create session with optional context
            const result = await GeminiChatService.createSession(u_id, body.title, {
                contextType: body.contextType,
                action: body.action,
                courseId: body.courseId,
                labId: body.labId,
                partId: body.partId
            });
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
                    title: session.title,
                    status: session.status,
                    currentContext: session.currentContext || {},
                    wizardState: session.wizardState || { step: 'course_list' }
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

            // For sending messages, session MUST be active
            if (sessionValidation.session.status !== 'active') {
                yield `data: ${JSON.stringify({ type: "error", message: "Session is no longer active", errors: ["Cannot send message to an inactive session"] })}\n\n`;
                return;
            }

            const { message, courseId, labId, partId } = body;

            // Validate message content
            const messageValidation = GeminiChatValidator.validateMessageContent(message);
            if (!messageValidation.valid) {
                yield `data: ${JSON.stringify({ type: "error", message: "Message validation failed", errors: messageValidation.errors })}\n\n`;
                return;
            }

            // Build context from body
            const context = { courseId, labId, partId };

            // Stream the response
            for await (const chunk of GeminiChatService.sendMessageStream(
                sessionId,
                message,
                u_id,
                context
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
                        title: session.title || 'Untitled Chat',
                        status: session.status,
                        currentContext: session.currentContext,
                        wizardState: session.wizardState || { step: 'course_list' },
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
                            title: t.String(),
                            status: t.String(),
                            currentContext: t.Object({
                                courseId: t.Optional(t.String()),
                                labId: t.Optional(t.String()),
                                partId: t.Optional(t.String())
                            }),
                            wizardState: t.Object({
                                step: t.String(),
                                courseId: t.Optional(t.String()),
                                labId: t.Optional(t.String()),
                                partId: t.Optional(t.String()),
                                editSection: t.Optional(t.String())
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
                        title: s.title || 'Untitled Chat',
                        status: s.status,
                        currentContext: s.currentContext,
                        wizardState: s.wizardState,
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
                            title: t.String(),
                            status: t.String(),
                            currentContext: t.Object({
                                courseId: t.Optional(t.String()),
                                labId: t.Optional(t.String()),
                                partId: t.Optional(t.String())
                            }),
                            wizardState: t.Optional(t.Object({
                                step: t.String(),
                                courseId: t.Optional(t.String()),
                                labId: t.Optional(t.String()),
                                partId: t.Optional(t.String())
                            })),
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
    // DELETE /gemini/chat/:sessionId - Delete session
    // ============================================================================
    .delete(
        "/:sessionId",
        async ({ params, authPlugin, set }) => {
            const u_id = authPlugin?.u_id || (process.env.NODE_ENV !== 'production' ? "dev-instructor" : "");
            const { sessionId } = params;

            // For delete, we only check ownership -- not active status
            const { ChatSession } = await import("./model");
            const sessionDoc = await ChatSession.findOne({ sessionId });
            if (!sessionDoc) {
                set.status = 404;
                return { success: false, errors: ["Session not found"] };
            }
            if (sessionDoc.userId !== u_id) {
                set.status = 403;
                return { success: false, errors: ["Access denied: You do not own this session"] };
            }

            await GeminiChatService.deleteSession(sessionId);
            return { success: true, message: "Session deleted" };
        },
        {
            params: t.Object({ sessionId: t.String() }),
            beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
            detail: { summary: "Delete Session", description: "ลบ chat session และข้อความทั้งหมด", tags: ["Gemini Chat"] }
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
    // POST /gemini/chat/:sessionId/close - Close session
    // ============================================================================
    .post(
        "/:sessionId/close",
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
    )

    // ============================================================================
    // WIZARD ENDPOINTS
    // ============================================================================

    // GET Wizard State
    .get(
        "/:sessionId/wizard/state",
        async ({ params, authPlugin, set }) => {
            const u_id = authPlugin?.u_id || (process.env.NODE_ENV !== 'production' ? "dev-instructor" : "");
            const { sessionId } = params;

            const sessionValidation = await GeminiChatValidator.validateSessionOwnership(sessionId, u_id);
            if (!sessionValidation.valid) {
                set.status = 404;
                return { success: false, errors: sessionValidation.errors };
            }

            const wizardState = await GeminiChatService.getWizardState(sessionId);
            return { success: true, data: wizardState };
        },
        {
            params: t.Object({ sessionId: t.String() }),
            beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
            detail: { summary: "Get Wizard State", tags: ["Gemini Chat Wizard"] }
        }
    )

    // GET Courses for user
    .get(
        "/:sessionId/wizard/courses",
        async ({ params, authPlugin, set }) => {
            const u_id = authPlugin?.u_id || (process.env.NODE_ENV !== 'production' ? "dev-instructor" : "");
            const { sessionId } = params;

            const sessionValidation = await GeminiChatValidator.validateSessionOwnership(sessionId, u_id);
            if (!sessionValidation.valid) {
                set.status = 404;
                return { success: false, errors: sessionValidation.errors };
            }

            const courses = await GeminiChatService.getCoursesForUser(u_id);
            return { success: true, data: courses };
        },
        {
            params: t.Object({ sessionId: t.String() }),
            beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
            detail: { summary: "Get Courses for Wizard", tags: ["Gemini Chat Wizard"] }
        }
    )

    // GET Labs for course
    .get(
        "/:sessionId/wizard/labs",
        async ({ params, authPlugin, set }) => {
            const u_id = authPlugin?.u_id || (process.env.NODE_ENV !== 'production' ? "dev-instructor" : "");
            const { sessionId } = params;

            const sessionValidation = await GeminiChatValidator.validateSessionOwnership(sessionId, u_id);
            if (!sessionValidation.valid) {
                set.status = 404;
                return { success: false, errors: sessionValidation.errors };
            }

            const wizardState = await GeminiChatService.getWizardState(sessionId);
            if (!wizardState?.courseId) {
                set.status = 400;
                return { success: false, message: "No course selected" };
            }

            const labs = await GeminiChatService.getLabsForCourse(wizardState.courseId);
            return { success: true, data: labs };
        },
        {
            params: t.Object({ sessionId: t.String() }),
            beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
            detail: { summary: "Get Labs for Wizard", tags: ["Gemini Chat Wizard"] }
        }
    )

    // GET Parts for lab
    .get(
        "/:sessionId/wizard/parts",
        async ({ params, authPlugin, set }) => {
            const u_id = authPlugin?.u_id || (process.env.NODE_ENV !== 'production' ? "dev-instructor" : "");
            const { sessionId } = params;

            const sessionValidation = await GeminiChatValidator.validateSessionOwnership(sessionId, u_id);
            if (!sessionValidation.valid) {
                set.status = 404;
                return { success: false, errors: sessionValidation.errors };
            }

            const wizardState = await GeminiChatService.getWizardState(sessionId);
            if (!wizardState?.labId) {
                set.status = 400;
                return { success: false, message: "No lab selected" };
            }

            const parts = await GeminiChatService.getPartsForLab(wizardState.labId);
            return { success: true, data: parts };
        },
        {
            params: t.Object({ sessionId: t.String() }),
            beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
            detail: { summary: "Get Parts for Wizard", tags: ["Gemini Chat Wizard"] }
        }
    )

    // POST Select item (course/lab/part)
    .post(
        "/:sessionId/wizard/select",
        async ({ params, body, authPlugin, set }) => {
            const u_id = authPlugin?.u_id || (process.env.NODE_ENV !== 'production' ? "dev-instructor" : "");
            const { sessionId } = params;
            const { type, id } = body;

            const sessionValidation = await GeminiChatValidator.validateSessionOwnership(sessionId, u_id);
            if (!sessionValidation.valid) {
                set.status = 404;
                return { success: false, errors: sessionValidation.errors };
            }

            let newStep: string;
            let context: any = {};

            switch (type) {
                case 'course':
                    newStep = 'lab_list';
                    context.courseId = id;
                    break;
                case 'lab':
                    newStep = 'lab_edit_menu';
                    context.labId = id;
                    break;
                case 'part':
                    newStep = 'part_edit';
                    context.partId = id;
                    break;
                default:
                    set.status = 400;
                    return { success: false, message: "Invalid type" };
            }

            await GeminiChatService.setWizardStep(sessionId, newStep, context);
            const wizardState = await GeminiChatService.getWizardState(sessionId);
            return { success: true, data: wizardState };
        },
        {
            params: t.Object({ sessionId: t.String() }),
            body: t.Object({
                type: t.Union([t.Literal('course'), t.Literal('lab'), t.Literal('part')]),
                id: t.String()
            }),
            beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
            detail: { summary: "Select Item in Wizard", tags: ["Gemini Chat Wizard"] }
        }
    )

    // POST Set wizard action (create/edit)
    .post(
        "/:sessionId/wizard/action",
        async ({ params, body, authPlugin, set }) => {
            const u_id = authPlugin?.u_id || (process.env.NODE_ENV !== 'production' ? "dev-instructor" : "");
            const { sessionId } = params;
            const { target, action, editSection } = body;

            const sessionValidation = await GeminiChatValidator.validateSessionOwnership(sessionId, u_id);
            if (!sessionValidation.valid) {
                set.status = 404;
                return { success: false, errors: sessionValidation.errors };
            }

            let newStep: string;
            let context: any = {};

            if (action === 'create') {
                switch (target) {
                    case 'course': newStep = 'course_create'; break;
                    case 'lab': newStep = 'lab_create'; break;
                    case 'part': newStep = 'part_create'; break;
                    default:
                        set.status = 400;
                        return { success: false, message: "Invalid target" };
                }
            } else if (action === 'edit') {
                switch (target) {
                    case 'course': newStep = 'course_edit'; break;
                    case 'lab':
                        if (editSection) {
                            newStep = 'lab_edit';
                            context.editSection = editSection;
                        } else {
                            newStep = 'lab_edit_menu';
                        }
                        break;
                    case 'part': newStep = 'part_edit'; break;
                    default:
                        set.status = 400;
                        return { success: false, message: "Invalid target" };
                }
            } else {
                set.status = 400;
                return { success: false, message: "Invalid action" };
            }

            await GeminiChatService.setWizardStep(sessionId, newStep, context);

            // Inject Part creation context (schema + topology) when entering part_create
            if (target === 'part' && action === 'create') {
                const session = sessionValidation.session;
                const labId = session?.wizardState?.labId || session?.currentContext?.labId;
                if (labId) {
                    await GeminiChatService.injectPartCreationContext(sessionId, labId);
                }
            }

            const wizardState = await GeminiChatService.getWizardState(sessionId);
            return { success: true, data: wizardState };
        },
        {
            params: t.Object({ sessionId: t.String() }),
            body: t.Object({
                target: t.Union([t.Literal('course'), t.Literal('lab'), t.Literal('part')]),
                action: t.Union([t.Literal('create'), t.Literal('edit')]),
                editSection: t.Optional(t.Union([t.Literal('basic'), t.Literal('network'), t.Literal('parts')]))
            }),
            beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
            detail: { summary: "Set Wizard Action", tags: ["Gemini Chat Wizard"] }
        }
    )

    // POST Navigate back
    .post(
        "/:sessionId/wizard/back",
        async ({ params, authPlugin, set }) => {
            const u_id = authPlugin?.u_id || (process.env.NODE_ENV !== 'production' ? "dev-instructor" : "");
            const { sessionId } = params;

            const sessionValidation = await GeminiChatValidator.validateSessionOwnership(sessionId, u_id);
            if (!sessionValidation.valid) {
                set.status = 404;
                return { success: false, errors: sessionValidation.errors };
            }

            const newStep = await GeminiChatService.navigateBack(sessionId);
            const wizardState = await GeminiChatService.getWizardState(sessionId);
            return { success: true, data: wizardState };
        },
        {
            params: t.Object({ sessionId: t.String() }),
            beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
            detail: { summary: "Navigate Back in Wizard", tags: ["Gemini Chat Wizard"] }
        }
    )

    // GET Topology Context for Part editing
    .get(
        "/:sessionId/wizard/topology-context",
        async ({ params, authPlugin, set }) => {
            const u_id = authPlugin?.u_id || (process.env.NODE_ENV !== 'production' ? "dev-instructor" : "");
            const { sessionId } = params;

            const sessionValidation = await GeminiChatValidator.validateSessionOwnership(sessionId, u_id);
            if (!sessionValidation.valid) {
                set.status = 404;
                return { success: false, errors: sessionValidation.errors };
            }

            const session = sessionValidation.session;
            const labId = session?.wizardState?.labId;
            if (!labId) {
                set.status = 400;
                return { success: false, message: "No lab selected in wizard context" };
            }

            const result = await GeminiChatService.getTopologyContext(labId);
            if (!result.success) {
                set.status = 404;
                return { success: false, message: result.message };
            }

            return {
                success: true,
                data: result.context
            };
        },
        {
            params: t.Object({ sessionId: t.String() }),
            beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
            detail: { summary: "Get Topology Context", description: "Get lab topology context for Part AI prompting", tags: ["Gemini Chat Wizard"] }
        }
    );

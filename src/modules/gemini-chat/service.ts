import { ChatSession, ChatMessage, IChatSession, IChatMessage } from "./model";
import { LabService } from "../labs/service";
import { PartService } from "../parts/service";
import { Course } from "../courses/model";
import { v4 as uuidv4 } from "uuid";
import { ArgumentExtractor, GeminiExtractor, isAllowedFunction, getContextRejectMessage } from "./argument-extractor";
import { buildGeminiConfig, buildContextInfo, streamGeminiResponse, callGemini, MAX_FUNCTION_CALL_ROUNDS } from "./gemini-client";
import { READ_ONLY_FUNCTIONS, executeReadOnlyFunction, createDraftFromFunctionCall, type DataFetchers } from "./function-calling";
import { WelcomeMessage } from "./welcome-message";

// ============================================================================
// Service Class
// ============================================================================

export class GeminiChatService {

    /**
     * Create a new chat session
     */
    static async createSession(
        userId: string | undefined,
        title?: string,
        contextOptions?: {
            contextType?: 'course' | 'lab' | 'part';
            action?: 'create' | 'edit';
            courseId?: string;
            labId?: string;
            partId?: string;
        }
    ): Promise<{ success: boolean; errors: string[]; data?: IChatSession }> {
        const errors: string[] = [];

        if (!userId || (typeof userId === 'string' && userId.trim() === "")) {
            errors.push("User ID is required to create a session");
            return { success: false, errors };
        }

        const sessionId = uuidv4();

        // Build currentContext from context options
        const currentContext: Record<string, string> = {};
        if (contextOptions?.courseId) currentContext.courseId = contextOptions.courseId;
        if (contextOptions?.labId) currentContext.labId = contextOptions.labId;
        if (contextOptions?.partId) currentContext.partId = contextOptions.partId;

        // Map contextType + action to wizard step
        const wizardState = this.mapContextToWizardState(contextOptions);

        const session = new ChatSession({
            sessionId,
            userId,
            title: title?.trim() || 'Untitled Chat',
            currentContext,
            wizardState,
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

        // Generate dynamic welcome message based on context
        const welcomeResult = await WelcomeMessage.generate(wizardState);

        await this.saveMessage(sessionId, {
            role: "model",
            textContent: welcomeResult.message
        }).catch((err: Error) => {
            console.error("Failed to save welcome message:", err.message);
            // Non-critical error for session creation
        });

        return { success: true, errors: [], data: savedSession };
    }

    /**
     * Map context options to wizard state
     */
    private static mapContextToWizardState(
        contextOptions?: {
            contextType?: string;
            action?: string;
            courseId?: string;
            labId?: string;
            partId?: string;
        }
    ): { step: string; courseId?: string; labId?: string; partId?: string } {
        if (!contextOptions?.contextType) {
            return { step: 'course_list' };
        }

        const { contextType, action, courseId, labId, partId } = contextOptions;
        let step = 'course_list';

        if (contextType === 'course') {
            step = action === 'edit' ? 'course_edit' : 'course_create';
        } else if (contextType === 'lab') {
            step = action === 'edit' ? 'lab_edit_menu' : 'lab_create';
        } else if (contextType === 'part') {
            step = action === 'edit' ? 'part_edit' : 'part_create';
        }

        return {
            step,
            ...(courseId && { courseId }),
            ...(labId && { labId }),
            ...(partId && { partId })
        };
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
     * Data fetchers for function calling (dependency injection)
     */
    private static get dataFetchers(): DataFetchers {
        return {
            getCoursesForUser: (userId: string) => this.getCoursesForUser(userId),
            getLabsForCourse: (courseId: string) => this.getLabsForCourse(courseId),
            getPartsForLab: (labId: string) => this.getPartsForLab(labId)
        };
    }

    /**
     * Get labs for a course (wrapper for LabService)
     */
    static async getLabsForCourse(courseId: string): Promise<any[]> {
        const result = await LabService.getLabsByCourse(courseId);
        if (!result || !result.labs) return [];
        return result.labs.map((lab: any) => ({
            id: (lab._id || lab.id)?.toString(),
            title: lab.title,
            description: lab.description,
            type: lab.type || 'lab',
            createdAt: lab.createdAt
        }));
    }

    /**
     * Get parts for a lab (wrapper for PartService)
     */
    static async getPartsForLab(labId: string): Promise<any[]> {
        const result = await PartService.getPartsByLab(labId);
        if (!result || !result.parts) return [];
        return result.parts
            .filter((part: any) => !part.isVirtual)
            .map((part: any) => ({
                id: (part._id || part.id)?.toString(),
                title: part.title,
                description: part.description,
                order: part.order,
                type: part.partType,
                taskCount: part.tasks?.length || 0,
                createdAt: part.createdAt
            }));
    }

    /**
     * Send message with streaming response
     * Returns an async generator for SSE
     *
     * Flow:
     * 1. Stream first Gemini response to client
     * 2. If Gemini calls a read-only function (list_*) -> execute, send functionResponse back, repeat (max 5 rounds)
     * 3. If Gemini calls a write function (*) -> create draft for user confirmation
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

        // Build Gemini config using helpers
        const contextInfo = buildContextInfo(context);
        const geminiConfig = buildGeminiConfig(contextInfo);

        // ---- Round 1: Streaming response ----
        const streamResponse = await streamGeminiResponse(contents, geminiConfig);

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
        while (functionCall && READ_ONLY_FUNCTIONS.includes(functionCall.name) && round < MAX_FUNCTION_CALL_ROUNDS) {
            round++;

            const execResult = await executeReadOnlyFunction(
                functionCall.name,
                functionCall.args || {},
                userId,
                this.dataFetchers
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
            const followUpResponse = await callGemini(contents, geminiConfig);

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
        if (functionCall && !READ_ONLY_FUNCTIONS.includes(functionCall.name)) {
            const wizardStep = session.wizardState?.step || 'course_list';
            const extractor = new GeminiExtractor();

            // Context Validation: reject off-topic intents
            if (!isAllowedFunction(wizardStep, functionCall.name)) {
                const rejectMsg = getContextRejectMessage(wizardStep);
                yield { type: "text", content: rejectMsg };

                await this.saveMessage(sessionId, {
                    role: "model",
                    textContent: rejectMsg
                });

                yield { type: "done" };
                return;
            }

            // Load existing partial args from session (if any)
            const existingArgs = (session.collectingArgs?.functionName === functionCall.name)
                ? session.collectingArgs?.args || {}
                : {};

            // Merge new args with existing partial args
            const newArgs = functionCall.args || {};
            const mergedArgs = extractor.mergeArgs(existingArgs, newArgs);

            // Extract and validate
            const extractionResult = extractor.extract(
                userMessage,
                functionCall.name,
                mergedArgs,
                context
            );

            if (!extractionResult.complete) {
                // Save partial args to session.collectingArgs
                await ChatSession.updateOne(
                    { sessionId },
                    {
                        $set: {
                            collectingArgs: {
                                functionName: functionCall.name,
                                args: extractionResult.collectedArgs,
                                lastUpdated: new Date()
                            }
                        }
                    }
                );

                const followUpText = extractionResult.followUpQuestion ||
                    'กรุณาให้ข้อมูลเพิ่มเติม';

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

            // Data complete -- generate summary for confirmation
            const summaryText = extractor.generateSummary(
                functionCall.name,
                extractionResult.collectedArgs
            );

            // Create draft for confirmation (always requires Confirm before Execute)
            const draft = await createDraftFromFunctionCall(
                { ...functionCall, args: extractionResult.collectedArgs },
                userId
            );

            const savedMessage = await this.saveMessage(sessionId, {
                role: "model",
                textContent: summaryText,
                humanReadablePreview: draft.previewText,
                jsonPreview: draft.data,
                functionCall: {
                    name: functionCall.name,
                    args: extractionResult.collectedArgs,
                    status: "pending"
                },
                draftData: draft
            });

            // Clear collectingArgs since data is now complete
            await ChatSession.updateOne(
                { sessionId },
                { $unset: { collectingArgs: 1 } }
            );

            yield { type: "text", content: summaryText };
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
        let lastError: string | null = null;

        if (type === "lab") {
            result = await LabService.createLab(data, userId).catch((err: Error) => { lastError = err.message; return null; });
            if (!result) return { success: false, error: lastError || "Failed to create lab" };
            await ChatSession.updateOne(
                { sessionId },
                { $set: { "currentContext.labId": result._id || result.id } }
            );
        } else if (type === "part") {
            result = await PartService.createPart(data, userId).catch((err: Error) => { lastError = err.message; return null; });
            if (!result) return { success: false, error: lastError || "Failed to create part" };
            await ChatSession.updateOne(
                { sessionId },
                { $set: { "currentContext.partId": result._id || result.id } }
            );
        } else if (type === "task") {
            const partId = data.partId;
            const part = await PartService.getPartById(partId).catch((err: Error) => { lastError = err.message; return null; });
            if (!part) return { success: false, error: lastError || "Part not found" };

            const updatedTasks = [...(part.tasks || []), data];
            result = await PartService.updatePart(partId, { tasks: updatedTasks }).catch((err: Error) => { lastError = err.message; return null; });
            if (!result) return { success: false, error: lastError || "Failed to add task" };
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
     * Get wizard state
     */
    static async getWizardState(sessionId: string): Promise<any> {
        const session = await ChatSession.findOne({ sessionId });
        if (!session) return null;
        return session.wizardState || { step: 'course_list' };
    }

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

        return courses.map((c: any) => ({
            id: c._id.toString(),
            title: c.title,
            description: c.description,
            visibility: c.visibility,
            createdAt: c.createdAt
        }));
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


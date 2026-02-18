import { ChatSession, ChatMessage } from "./model";

/**
 * Validation result type
 */
export interface ValidationResult {
    valid: boolean;
    errors: string[];
}

/**
 * Session validation result with data
 */
export interface SessionValidationResult extends ValidationResult {
    session?: any;
}

/**
 * Message validation result with data
 */
export interface MessageValidationResult extends ValidationResult {
    message?: any;
}

/**
 * GeminiChatValidator - Static validation methods for Gemini Chat API
 * 
 * This follows the same pattern as VlanValidator, returning { valid: boolean, errors: string[] }
 * to allow handlers to use if-else early returns instead of try-catch blocks.
 */
export class GeminiChatValidator {


    /**
     * Validate session ID format
     */
    static validateSessionId(sessionId: string | undefined): ValidationResult {
        const errors: string[] = [];

        if (!sessionId || sessionId.trim() === "") {
            errors.push("Session ID is required");
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Validate message content
     */
    static validateMessageContent(message: string | undefined): ValidationResult {
        const errors: string[] = [];

        if (!message || message.trim() === "") {
            errors.push("Message content is required");
        }

        if (message && message.length > 10000) {
            errors.push("Message content exceeds maximum length of 10000 characters");
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Validate session exists and is active
     */
    static async validateSessionExists(sessionId: string): Promise<SessionValidationResult> {
        const errors: string[] = [];

        const session = await ChatSession.findOne({ sessionId });

        if (!session) {
            errors.push("Session not found");
            return { valid: false, errors };
        }

        if (session.status !== "active") {
            errors.push("Session is no longer active");
            return { valid: false, errors };
        }

        return {
            valid: true,
            errors,
            session
        };
    }

    /**
     * Validate session ownership
     */
    static async validateSessionOwnership(
        sessionId: string,
        userId: string
    ): Promise<SessionValidationResult> {
        const errors: string[] = [];

        const session = await ChatSession.findOne({ sessionId });

        if (!session) {
            errors.push("Session not found");
            return { valid: false, errors };
        }

        if (session.userId !== userId) {
            errors.push("Access denied: You do not own this session");
            return { valid: false, errors };
        }

        return {
            valid: true,
            errors,
            session
        };
    }

    /**
     * Validate message exists with draft data
     */
    static async validateDraftMessage(
        sessionId: string,
        messageId: string
    ): Promise<MessageValidationResult> {
        const errors: string[] = [];

        if (!messageId || messageId.trim() === "") {
            errors.push("Message ID is required");
            return { valid: false, errors };
        }

        const message = await ChatMessage.findOne({ sessionId, messageId });

        if (!message) {
            errors.push("Message not found");
            return { valid: false, errors };
        }

        if (!message.draftData) {
            errors.push("Message does not contain draft data");
            return { valid: false, errors };
        }

        if (message.functionCall?.status !== "pending") {
            errors.push("Draft has already been processed");
            return { valid: false, errors };
        }

        return {
            valid: true,
            errors,
            message
        };
    }

    /**
     * Validate combined: session exists, user owns it, and draft message is valid
     */
    static async validateDraftAction(
        sessionId: string,
        messageId: string,
        userId: string
    ): Promise<{ valid: boolean; errors: string[]; session?: any; message?: any }> {
        const errors: string[] = [];

        // Validate session ownership first
        const sessionResult = await this.validateSessionOwnership(sessionId, userId);
        if (!sessionResult.valid) {
            return { valid: false, errors: sessionResult.errors };
        }

        // Validate draft message
        const messageResult = await this.validateDraftMessage(sessionId, messageId);
        if (!messageResult.valid) {
            return { valid: false, errors: messageResult.errors };
        }

        return {
            valid: true,
            errors,
            session: sessionResult.session,
            message: messageResult.message
        };
    }

    /**
     * Combine multiple validation results
     */
    static combineResults(...results: ValidationResult[]): ValidationResult {
        const allErrors: string[] = [];

        for (const result of results) {
            if (!result.valid) {
                allErrors.push(...result.errors);
            }
        }

        return {
            valid: allErrors.length === 0,
            errors: allErrors
        };
    }
}

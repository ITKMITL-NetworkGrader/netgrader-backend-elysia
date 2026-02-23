import { env } from "process";
import { GoogleGenAI } from "@google/genai";
import "dotenv/config";
import { SYSTEM_INSTRUCTION } from "./system-instruction";
import { functionDeclarations } from "./function-calling";

// ============================================================================
// Gemini AI Client
// ============================================================================

export const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY || "" });

// Default model name
export const GEMINI_MODEL = "gemini-2.5-flash";

// Max function call rounds to prevent infinite loops
export const MAX_FUNCTION_CALL_ROUNDS = 5;

// ============================================================================
// Build Gemini Config
// ============================================================================

export function buildGeminiConfig(
    contextInfo?: string
): { systemInstruction: string; tools: any[] } {
    return {
        systemInstruction: SYSTEM_INSTRUCTION + (contextInfo || ''),
        tools: [{ functionDeclarations }]
    };
}

// ============================================================================
// Build context info string from context object
// ============================================================================

export function buildContextInfo(
    context?: { courseId?: string; labId?: string; partId?: string }
): string {
    if (!context?.courseId && !context?.labId && !context?.partId) return '';

    let info = '\n\n[Current Context]\n';
    if (context.courseId) info += `- Working in Course ID: ${context.courseId}\n`;
    if (context.labId) info += `- Working in Lab ID: ${context.labId}\n`;
    if (context.partId) info += `- Working on Part ID: ${context.partId}\n`;
    info += 'Use these IDs when calling functions that require them.';
    return info;
}

// ============================================================================
// Stream Gemini Response (first round)
// ============================================================================

export async function streamGeminiResponse(
    contents: Array<{ role: string; parts: any[] }>,
    config: { systemInstruction: string; tools: any[] }
): Promise<AsyncIterable<any> | null> {
    return ai.models.generateContentStream({
        model: GEMINI_MODEL,
        contents,
        config
    }).catch((err: Error) => {
        return null;
    });
}

// ============================================================================
// Call Gemini (non-streaming, for follow-up rounds)
// ============================================================================

export async function callGemini(
    contents: Array<{ role: string; parts: any[] }>,
    config: { systemInstruction: string; tools: any[] }
): Promise<any | null> {
    return ai.models.generateContent({
        model: GEMINI_MODEL,
        contents,
        config
    }).catch((err: Error) => {
        return null;
    });
}

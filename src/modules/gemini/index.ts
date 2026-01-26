import { Elysia, t } from "elysia";
import jwt from "@elysiajs/jwt";
import { env } from "process";
import { GeminiService } from "./service";

// Request schemas
const sendRequestSchema = t.Object({
    text: t.String({ minLength: 1, description: "The text prompt to send to Gemini" }),
});

const mcpRequestSchema = t.Object({
    part_id: t.String({ minLength: 1, description: "The ID of the lab part" }),
    prompt: t.String({ minLength: 1, description: "The instructor's prompt/intent" }),
});

// Response schemas
const sendRequestResponseSchema = t.Object({
    success: t.Boolean(),
    data: t.Optional(t.Object({
        result: t.String(),
    })),
    message: t.Optional(t.String()),
});

const mcpResponseSchema = t.Object({
    success: t.Boolean(),
    data: t.Optional(t.Object({
        result: t.String(),
        history: t.Array(t.Object({
            action: t.String(),
            args: t.Unknown(),
            response: t.Unknown(),
        })),
    })),
    message: t.Optional(t.String()),
});

export const geminiRoutes = new Elysia({ prefix: "/gemini" })
    .use(
        jwt({
            name: "jwt",
            secret: env.JWT_SECRET || "secret",
        })
    )
    // POST /gemini/sendRequest - Basic Gemini text generation
    .post(
        "/sendRequest",
        async ({ body, set }) => {
            try {
                const { text } = body;

                if (!text) {
                    set.status = 400;
                    return {
                        success: false,
                        message: "Text is required",
                    };
                }

                const result = await GeminiService.sendRequest(text);
                return {
                    success: true,
                    data: result,
                };
            } catch (error) {
                set.status = 500;
                return {
                    success: false,
                    message: error instanceof Error ? error.message : "Unknown error occurred",
                };
            }
        },
        {
            body: sendRequestSchema,
            response: sendRequestResponseSchema,
            detail: {
                summary: "Send Request to Gemini",
                description: "Sends a text prompt to Gemini and returns the generated response.",
                tags: ["Gemini"],
            },
        }
    )
    // POST /gemini/mcp - MCP-style interaction with function calling
    .post(
        "/mcp",
        async ({ body, set }) => {
            try {
                const { part_id, prompt } = body;

                if (!prompt) {
                    set.status = 400;
                    return {
                        success: false,
                        message: "Prompt is required",
                    };
                }

                const result = await GeminiService.mcpRequest(part_id, prompt);
                return {
                    success: true,
                    data: result,
                };
            } catch (error) {
                set.status = 500;
                return {
                    success: false,
                    message: error instanceof Error ? error.message : "Unknown error occurred",
                };
            }
        },
        {
            body: mcpRequestSchema,
            response: mcpResponseSchema,
            detail: {
                summary: "MCP Request",
                description: "Translates an instructor's intent into network tasks using MCP-style function calling.",
                tags: ["Gemini"],
            },
        }
    );

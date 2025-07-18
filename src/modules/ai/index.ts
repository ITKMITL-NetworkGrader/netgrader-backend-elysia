import { Elysia, t } from "elysia";
import jwt from "@elysiajs/jwt";
import { env } from "process";
import { AIService } from "./service";


const promptSchema= t.Object({
    prompt: t.String({ minLength: 1 }),
})

export const aiRoutes = new Elysia({ prefix: "/ai" })
.use(
    jwt({
        name: "jwt",
        secret: env.JWT_SECRET || "secret",
    }))
.post(
    "/generate",
    async ({ body, set }) => {
        const { prompt } = body;

        if (!prompt) {
            set.status = 400;
            return {
                success: false,
                data: null,
                message: "Prompt is required",
            };
        }

        // Here you would typically call your AI service to generate a response
        // For demonstration, we will return a mock response
        const aiResponse = await AIService.generateResponse(prompt);
        return { 
            data : aiResponse,
            success: true,
        };
    },
    {
        body: promptSchema,
        response: t.Object({
            success: t.Boolean(),
            data: t.String(),
            message: t.Optional(t.String()),
        }),
        detail: {
            summary: "Generate AI response",
            description: "Endpoint to generate a response from the AI based on the provided prompt.",
            tags: ["AI"],
        }
        
    }

)
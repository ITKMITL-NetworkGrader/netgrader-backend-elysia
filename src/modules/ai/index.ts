import { Elysia, t } from "elysia";
import { AIService } from "./service";
import { authPlugin } from "../../plugins/plugins";

const promptSchema= t.Object({
    prompt: t.String({ minLength: 1 }),
})

export const aiRoutes = new Elysia({ prefix: "/ai" })
.use(authPlugin)
.post(
    "/generate",
    async ({ body, set, authPlugin: auth }) => {
        if (!auth?.u_id) {
            set.status = 401;
            return { success: false, message: "Unauthorized" };
        }
        const { prompt } = body;

        if (!prompt) {
            set.status = 400;
            return {
                success: false,
                message: "Prompt is required",
            };
        }

        // Here you would typically call your AI service to generate a response
        // For demonstration, we will return a mock response
        const aiResponse = await AIService.generateResponse(prompt);
        return { 
            success: true,
            data : aiResponse,
        };
    },
    {
        body: promptSchema,
        response: t.Object({
            success: t.Boolean(),
            data: t.Optional(t.String()),
            message: t.Optional(t.String()),
        }),
        detail: {
            summary: "Generate AI response",
            description: "Endpoint to generate a response from the AI based on the provided prompt.",
            tags: ["AI"],
        }
        
    }

)
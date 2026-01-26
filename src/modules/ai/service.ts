import { env } from "process";
import { GoogleGenAI } from "@google/genai";
import "dotenv/config";

export interface AIConfig {
    aiServiceUrl: string;
    aiApiKey: string;
}

// Initialize the Google Gen AI client
const ai = new GoogleGenAI({ apiKey: env.AI_API_KEY || "" });

export class AIService {

    private static getAIConfig(): AIConfig {
        return {
            aiServiceUrl: env.AI_SERVICE_URL || "https://api.example.com/ai",
            aiApiKey: env.AI_API_KEY || "your-api-key-here",
        };
    }

    static async generateResponse(prompt: string): Promise<string> {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
        });

        const analysis = response.text;
        console.log(analysis);

        return analysis || "No response generated.";
    }
}

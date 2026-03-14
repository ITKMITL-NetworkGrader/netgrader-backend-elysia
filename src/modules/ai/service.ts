import {env } from "process";
import { GoogleGenerativeAI } from "@google/generative-ai";
import "dotenv/config";

export interface AIConfig {
    aiServiceUrl: string;
    aiApiKey: string;
}

// NG-SEC-029: Removed hardcoded API key
if (!env.AI_API_KEY) {
    console.warn("AI_API_KEY not set. AI features will not be available.");
}
const googleGenerativeAI = env.AI_API_KEY ? new GoogleGenerativeAI(env.AI_API_KEY) : null;
const model = googleGenerativeAI ? googleGenerativeAI.getGenerativeModel({ model: "gemini-2.5-pro" }) : null;

export class AIService {
    
    private static getAIConfig(): AIConfig {
        return {
            aiServiceUrl: env.AI_SERVICE_URL || "https://api.example.com/ai",
            aiApiKey: env.AI_API_KEY || "your-api-key-here",
        };
    }

    static async generateResponse(prompt: string): Promise<string> {
        if (!model) {
            throw new Error("AI service is not configured. Set AI_API_KEY environment variable.");
        }
        const result = await model.generateContent(prompt);
        const response = result.response;
        const analysis = response.text();
        console.log(analysis);

        // if (!response.ok) {
        //     throw new Error(`AI service error: ${response.status} ${response.statusText}`);
        // }

        /* `const data = await response.json();` is parsing the JSON response from the AI service into
        a JavaScript object. The `response.json()` method reads the response body to completion as a
        JSON object and returns a promise that resolves with the result of parsing the body text as
        JSON. This allows you to work with the JSON data returned from the AI service in a
        structured format within your TypeScript code. */
        // const data = await response.json();
        return analysis || "No response generated.";
    }
}

import {env } from "process";
import { GoogleGenerativeAI } from "@google/generative-ai";
import "dotenv/config";

export interface AIConfig {
    aiServiceUrl: string;
    aiApiKey: string;
}

const googleGenerativeAI = new GoogleGenerativeAI(env.AI_API_KEY || "AIzaSyD1WHNyXki9wg6PMGwuNG-wgNFb9rK42Zg");
const model = googleGenerativeAI.getGenerativeModel({ model: "gemini-2.5-flash" })

export class AIService {
    
    private static getAIConfig(): AIConfig {
        return {
            aiServiceUrl: env.AI_SERVICE_URL || "https://api.example.com/ai",
            aiApiKey: env.AI_API_KEY || "your-api-key-here",
        };
    }

    static async generateResponse(prompt: string): Promise<string> {
        // const config = this.getAIConfig();
        // const response = await fetch(config.aiServiceUrl, {
        //     method: "POST",
        //     headers: {
        //     "Content-Type": "application/json",
        //     "X-goog-api-key": `${config.aiApiKey}`,
        //     },
        //     body: JSON.stringify({ 
        //         "contents": [
        //             {
        //                 "parts":[
        //                     {
        //                         "text": prompt
        //                     }
        //                 ]
        //             }
        //         ]
        //     }),
        // });
        const result = await model.generateContent(prompt);
        const response = result.response;
        const analysis = response.text();

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

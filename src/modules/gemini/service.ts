import { env } from "process";
import { GoogleGenAI, FunctionDeclaration, Type } from "@google/genai";
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";

// Initialize the Google Gen AI client
const ai = new GoogleGenAI({ apiKey: env.AI_API_KEY || "" });

export interface GeminiRequest {
    text: string;
}

export interface GeminiMCPRequest {
    part_id: string;
    prompt: string;
}

export interface ToolCallHistory {
    action: string;
    args: Record<string, unknown>;
    response: unknown;
}

export class GeminiService {

    /**
     * Basic Gemini text generation
     */
    static async sendRequest(text: string): Promise<{ result: string }> {
        try {
            console.log("Connecting to Gemini...");
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: text,
            });

            return { result: response.text || "" };
        } catch (error) {
            console.error("Gemini request failed:", error);
            throw new Error(`Gemini request failed: ${error}`);
        }
    }

    /**
     * MCP-style interaction with function calling capabilities
     * Translates instructor's intent into network tasks
     */
    static async mcpRequest(partId: string, prompt: string): Promise<{ result: string; history: ToolCallHistory[] }> {
        try {
            // Function declarations for network task tools
            const loginNetgraderDeclaration: FunctionDeclaration = {
                name: "login_netgrader",
                description: "Logs into the Netgrader system. Call this if you receive an Unauthorized error.",
                parametersJsonSchema: {
                    type: "object",
                    properties: {}
                }
            };

            const addNetworkTaskDeclaration: FunctionDeclaration = {
                name: "add_network_task",
                description: "Add a new network verification task (like ping) to the Netgrader system.",
                parametersJsonSchema: {
                    type: "object",
                    properties: {
                        part_id: {
                            type: "string",
                            description: "The ID of the lab part, e.g., 'pingpong'."
                        },
                        source_device: {
                            type: "string",
                            description: "The device executing the test, e.g., 'pc-1'."
                        },
                        target_ip: {
                            type: "string",
                            description: "The destination, e.g., 'pc-2.ens3'."
                        },
                        expected_success: {
                            type: "boolean",
                            description: "True if the ping should work, False if it should be blocked by ACL."
                        }
                    },
                    required: ["part_id", "source_device", "target_ip"]
                }
            };

            // Load topology context if available
            const topologyPath = path.join(process.cwd(), "output", "output.json");
            let topologyContextData = "";

            if (fs.existsSync(topologyPath)) {
                try {
                    const topologyContent = fs.readFileSync(topologyPath, "utf-8");
                    const topologyContext = { topology: JSON.parse(topologyContent) };
                    topologyContextData = `Network Context:\n${JSON.stringify(topologyContext, null, 2)}`;
                } catch (e) {
                    console.warn("Failed to load topology context:", e);
                }
            }

            // System instruction for Task Generation
            const systemInstruction = `
            You are the Netgrader Task Generator.
            Your job is to translate an instructor's intent into a specific network task.
            
            ${topologyContextData}
            
            Guidelines:
            1. When an instructor describes a requirement, map this to the 'add_network_task' tool.
            2. Identify the 'source_device' and 'target_ip'.
            3. Set 'expected_success' to True for connectivity and False for ACL tests.
            4. If you receive an 'Unauthorized' or '401' error from a tool, immediately call 'login_netgrader' and then retry your previous task.
            5. If the instructor doesn't specify a part_id, use 'pingpong' as default.
            6. Confirm once the task has been successfully sent.
            `;

            // Create chat session with tools using the new API
            const chat = ai.chats.create({
                model: "gemini-2.5-flash",
                config: {
                    systemInstruction: systemInstruction,
                    tools: [{ functionDeclarations: [loginNetgraderDeclaration, addNetworkTaskDeclaration] }]
                }
            });

            const fullPrompt = `part_id: ${partId}\n${prompt}`;
            const history: ToolCallHistory[] = [];
            let currentPrompt = fullPrompt;
            const maxIterations = 5;

            // Iterative loop to allow Gemini to think and call tools multiple times
            for (let i = 0; i < maxIterations; i++) {
                const response = await chat.sendMessage({ message: currentPrompt });

                // Check for function calls
                const functionCalls = response.functionCalls;

                if (!functionCalls || functionCalls.length === 0) {
                    // No more tools to call, return final answer
                    return { result: response.text || "Task completed", history };
                }

                // Execute all tool calls requested in this turn
                for (const call of functionCalls) {
                    console.log(`🔧 Turn ${i + 1} - Calling: ${call.name}(${JSON.stringify(call.args)})`);

                    // Simulate tool execution (in real implementation, this would call actual MCP tools)
                    const toolResult = await this.executeToolCall(call.name || "", call.args as Record<string, unknown>);

                    // Store in history for visibility
                    history.push({
                        action: call.name || "",
                        args: call.args as Record<string, unknown>,
                        response: toolResult
                    });

                    // Prepare next prompt with tool result
                    currentPrompt = `Tool '${call.name}' result: ${JSON.stringify(toolResult)}. Continue based on this.`;
                }
            }

            return { result: "Max iterations reached", history };
        } catch (error) {
            console.error("MCP request failed:", error);
            throw new Error(`MCP request failed: ${error}`);
        }
    }

    /**
     * Execute a tool call (stub implementation)
     * In real implementation, this would connect to actual MCP server
     */
    private static async executeToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
        // This is a stub - in real implementation, connect to MCP server
        switch (name) {
            case "login_netgrader":
                return { success: true, message: "Logged in successfully" };
            case "add_network_task":
                return {
                    success: true,
                    message: `Task added: ${args.source_device} -> ${args.target_ip}`,
                    task_id: `task_${Date.now()}`
                };
            default:
                return { success: false, message: `Unknown tool: ${name}` };
        }
    }
}

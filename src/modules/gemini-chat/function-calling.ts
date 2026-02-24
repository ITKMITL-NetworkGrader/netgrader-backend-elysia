import { FunctionDeclaration } from "@google/genai";
import { SchemaReaderService } from "../../services/schema-reader-service";

// ============================================================================
// Function Declarations (Tools for Gemini to call)
// ============================================================================

export const CUSTOM_FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
    {
        name: "list_courses",
        description: "ดึงรายการ Course ที่อาจารย์สอนหรือเป็นเจ้าของ"
    },
    {
        name: "list_labs",
        description: "ดึงรายการ Lab ใน Course ที่กำหนด",
        parametersJsonSchema: {
            type: "object",
            properties: {
                courseId: { type: "string", description: "Course ID" }
            },
            required: ["courseId"]
        }
    } as any,
    {
        name: "list_parts",
        description: "ดึงรายการ Part ทั้งหมดใน Lab ที่กำหนด พร้อมแสดง title, order, type, และจำนวน task",
        parametersJsonSchema: {
            type: "object",
            properties: {
                labId: { type: "string", description: "Lab ID" }
            },
            required: ["labId"]
        }
    } as any
];

export async function getFunctionDeclarations(): Promise<FunctionDeclaration[]> {
    const dynamicDeclarations = await SchemaReaderService.getFunctionDeclarations();
    return [...CUSTOM_FUNCTION_DECLARATIONS, ...dynamicDeclarations];
}

// ============================================================================
// Read-only functions (executed immediately without user confirmation)
// ============================================================================

export const READ_ONLY_FUNCTIONS = ['list_courses', 'list_labs', 'list_parts'];

// ============================================================================
// Data Fetchers Interface (injected from service)
// ============================================================================

export interface DataFetchers {
    getCoursesForUser: (userId: string) => Promise<any[]>;
    getLabsForCourse: (courseId: string) => Promise<any[]>;
    getPartsForLab: (labId: string) => Promise<any[]>;
}

// ============================================================================
// Execute read-only function
// ============================================================================

export async function executeReadOnlyFunction(
    functionName: string,
    args: Record<string, any>,
    userId: string,
    fetchers: DataFetchers
): Promise<{ success: boolean; data?: any; error?: string }> {
    if (functionName === 'list_courses') {
        const courses = await fetchers.getCoursesForUser(userId);
        return { success: true, data: { courses } };
    }
    if (functionName === 'list_labs') {
        if (!args.courseId) return { success: false, error: 'courseId is required' };
        const labs = await fetchers.getLabsForCourse(args.courseId);
        return { success: true, data: { labs } };
    }
    if (functionName === 'list_parts') {
        if (!args.labId) return { success: false, error: 'labId is required' };
        const parts = await fetchers.getPartsForLab(args.labId);
        return { success: true, data: { parts } };
    }
    return { success: false, error: `Unknown read-only function: ${functionName}` };
}

// ============================================================================
// Create draft data from function call
// ============================================================================

export async function createDraftFromFunctionCall(
    functionCall: any,
    userId: string
): Promise<any> {
    const { name, args } = functionCall;

    if (name === "create_lab" || name === "postV0Labs") {
        return {
            type: "lab",
            data: {
                ...args,
                createdBy: userId,
                network: {
                    name: args.title || "Network",
                    topology: {
                        baseNetwork: "10.0.0.0",
                        subnetMask: 24,
                        allocationStrategy: "student_id_based"
                    }
                }
            },
            previewText: `[Lab] ต้องการสร้าง Lab: **${args.title || args.name}**\nประเภท: ${args.type || '-'}\nรายละเอียด: ${args.description || "-"}`
        };
    }

    if (name === "create_part" || name === "postV0Parts") { // TODO: Check actual operationId for post part!
        return {
            type: "part",
            data: args,
            previewText: `[Part] ต้องการสร้าง Part: **${args.title || args.name}**\nรายละเอียด: ${args.description || "-"}`
        };
    }

    if (name === "add_task" || name === "postV0Tasks") { // TODO: Check actual operationId for post task!
        return {
            type: "task",
            data: args,
            previewText: `[Task] ต้องการเพิ่ม Task: **${args.title || args.name}**\nคะแนนเต็ม: ${args.maxScore || '-'}`
        };
    }

    return {
        type: "unknown",
        data: args,
        previewText: "Unknown draft action"
    };
}

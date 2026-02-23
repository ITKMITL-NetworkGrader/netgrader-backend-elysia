import { FunctionDeclaration } from "@google/genai";

// ============================================================================
// Function Declarations (Tools for Gemini to call)
// ============================================================================

export const functionDeclarations: FunctionDeclaration[] = [
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
    },
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
    },
    {
        name: "create_lab",
        description: "สร้าง Lab ใหม่ใน Course ที่กำหนด",
        parametersJsonSchema: {
            type: "object",
            properties: {
                courseId: { type: "string", description: "Course ID ที่ต้องการสร้าง Lab" },
                title: { type: "string", description: "ชื่อ Lab" },
                description: { type: "string", description: "คำอธิบาย Lab" },
                type: { type: "string", enum: ["lab", "exam"], description: "ประเภท Lab" }
            },
            required: ["courseId", "title", "type"]
        }
    },
    {
        name: "create_part",
        description: "สร้าง Part ใหม่ใน Lab ที่กำหนด",
        parametersJsonSchema: {
            type: "object",
            properties: {
                labId: { type: "string", description: "Lab ID ที่ต้องการสร้าง Part" },
                title: { type: "string", description: "ชื่อ Part" },
                description: { type: "string", description: "คำอธิบาย Part" },
                order: { type: "number", description: "ลำดับของ Part" }
            },
            required: ["labId", "title"]
        }
    },
    {
        name: "add_task",
        description: "เพิ่ม Task ใหม่ลงใน Part ที่กำหนด",
        parametersJsonSchema: {
            type: "object",
            properties: {
                partId: { type: "string", description: "Part ID ที่ต้องการเพิ่ม Task" },
                title: { type: "string", description: "ชื่อ Task" },
                instruction: { type: "string", description: "คำสั่งสำหรับนักศึกษา" },
                maxScore: { type: "number", description: "คะแนนเต็ม" }
            },
            required: ["partId", "title", "instruction", "maxScore"]
        }
    }
];

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

    if (name === "create_lab") {
        return {
            type: "lab",
            data: {
                ...args,
                createdBy: userId,
                network: {
                    name: args.title,
                    topology: {
                        baseNetwork: "10.0.0.0",
                        subnetMask: 24,
                        allocationStrategy: "student_id_based"
                    }
                }
            },
            previewText: `[Lab] ต้องการสร้าง Lab: **${args.title}**\nประเภท: ${args.type}\nรายละเอียด: ${args.description || "-"}`
        };
    }

    if (name === "create_part") {
        return {
            type: "part",
            data: args,
            previewText: `[Part] ต้องการสร้าง Part: **${args.title}**\nรายละเอียด: ${args.description || "-"}`
        };
    }

    if (name === "add_task") {
        return {
            type: "task",
            data: args,
            previewText: `[Task] ต้องการเพิ่ม Task: **${args.title}**\nคะแนนเต็ม: ${args.maxScore}`
        };
    }

    return {
        type: "unknown",
        data: args,
        previewText: "Unknown draft action"
    };
}

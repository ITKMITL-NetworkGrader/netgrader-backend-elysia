/**
 * Argument Extractor Module
 * Validates and collects required arguments for MCP function calls
 */

// Schema for function arguments
export interface ArgumentSchema {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'object' | 'array';
    required: boolean;
    description: string;
    descriptionTh: string;
    enum?: string[];
    default?: any;
}

// Result of extraction
export interface ExtractionResult {
    complete: boolean;
    collectedArgs: Record<string, any>;
    missingFields: ArgumentSchema[];
    followUpQuestion?: string;
}

// Partial arguments stored in session
export interface PartialArguments {
    functionName: string;
    args: Record<string, any>;
    lastUpdated: Date;
}

// ============================================================================
// Function Schemas - Define required arguments for each MCP function
// ============================================================================

const functionSchemas: Record<string, ArgumentSchema[]> = {
    // Create Lab
    create_lab: [
        { name: 'courseId', type: 'string', required: true, description: 'Course ID', descriptionTh: 'รหัสคอร์ส' },
        { name: 'title', type: 'string', required: true, description: 'Lab title', descriptionTh: 'ชื่อ Lab' },
        { name: 'type', type: 'string', required: true, description: 'Lab type', descriptionTh: 'ประเภท Lab', enum: ['lab', 'exam'] },
        { name: 'description', type: 'string', required: false, description: 'Lab description', descriptionTh: 'คำอธิบาย Lab' }
    ],

    // Create Part
    create_part: [
        { name: 'labId', type: 'string', required: true, description: 'Lab ID', descriptionTh: 'รหัส Lab' },
        { name: 'title', type: 'string', required: true, description: 'Part title', descriptionTh: 'ชื่อ Part' },
        { name: 'partType', type: 'string', required: true, description: 'Part type', descriptionTh: 'ประเภท Part', enum: ['fill_in_blank', 'network_config'] },
        { name: 'order', type: 'number', required: true, description: 'Display order', descriptionTh: 'ลำดับการแสดง' },
        { name: 'description', type: 'string', required: false, description: 'Part description', descriptionTh: 'คำอธิบาย Part' }
    ],

    // Create Task (within Part)
    create_task: [
        { name: 'partId', type: 'string', required: true, description: 'Part ID', descriptionTh: 'รหัส Part' },
        { name: 'name', type: 'string', required: true, description: 'Task name', descriptionTh: 'ชื่อ Task' },
        { name: 'executionDevice', type: 'string', required: true, description: 'Source device', descriptionTh: 'อุปกรณ์ต้นทาง' },
        { name: 'destDevice', type: 'string', required: true, description: 'Destination device', descriptionTh: 'อุปกรณ์ปลายทาง' },
        { name: 'command', type: 'string', required: true, description: 'Command to execute', descriptionTh: 'คำสั่ง' },
        { name: 'expectedOutput', type: 'string', required: false, description: 'Expected output pattern', descriptionTh: 'รูปแบบผลลัพธ์ที่คาดหวัง' }
    ],

    // Update Lab
    update_lab: [
        { name: 'labId', type: 'string', required: true, description: 'Lab ID', descriptionTh: 'รหัส Lab' },
        { name: 'title', type: 'string', required: false, description: 'New lab title', descriptionTh: 'ชื่อ Lab ใหม่' },
        { name: 'description', type: 'string', required: false, description: 'New description', descriptionTh: 'คำอธิบายใหม่' }
    ],

    // Update Part
    update_part: [
        { name: 'partId', type: 'string', required: true, description: 'Part ID', descriptionTh: 'รหัส Part' },
        { name: 'title', type: 'string', required: false, description: 'New part title', descriptionTh: 'ชื่อ Part ใหม่' },
        { name: 'description', type: 'string', required: false, description: 'New description', descriptionTh: 'คำอธิบายใหม่' }
    ]
};

// ============================================================================
// ArgumentExtractor Class
// ============================================================================

export class ArgumentExtractor {
    /**
     * Get schema for a function
     */
    static getSchemaFor(functionName: string): ArgumentSchema[] | null {
        return functionSchemas[functionName] || null;
    }

    /**
     * Get required fields for a function
     */
    static getRequiredFields(functionName: string): ArgumentSchema[] {
        const schema = this.getSchemaFor(functionName);
        if (!schema) return [];
        return schema.filter(field => field.required);
    }

    /**
     * Check which required fields are missing
     */
    static getMissingFields(
        functionName: string,
        providedArgs: Record<string, any>
    ): ArgumentSchema[] {
        const requiredFields = this.getRequiredFields(functionName);
        return requiredFields.filter(field => {
            const value = providedArgs[field.name];
            return value === undefined || value === null || value === '';
        });
    }

    /**
     * Extract arguments from context and provided data
     */
    static extract(
        functionName: string,
        providedArgs: Record<string, any>,
        context?: { courseId?: string; labId?: string; partId?: string }
    ): ExtractionResult {
        const schema = this.getSchemaFor(functionName);
        if (!schema) {
            return {
                complete: false,
                collectedArgs: {},
                missingFields: [],
                followUpQuestion: `ไม่รู้จัก function: ${functionName}`
            };
        }

        // Merge context with provided args (context provides defaults)
        const mergedArgs: Record<string, any> = { ...providedArgs };

        // Auto-fill from context
        if (context?.courseId && !mergedArgs.courseId) {
            mergedArgs.courseId = context.courseId;
        }
        if (context?.labId && !mergedArgs.labId) {
            mergedArgs.labId = context.labId;
        }
        if (context?.partId && !mergedArgs.partId) {
            mergedArgs.partId = context.partId;
        }

        // Check missing fields
        const missingFields = this.getMissingFields(functionName, mergedArgs);

        if (missingFields.length === 0) {
            return {
                complete: true,
                collectedArgs: mergedArgs,
                missingFields: []
            };
        }

        // Generate follow-up question
        const followUpQuestion = this.generateFollowUp(missingFields, functionName);

        return {
            complete: false,
            collectedArgs: mergedArgs,
            missingFields,
            followUpQuestion
        };
    }

    /**
     * Generate follow-up question for missing fields
     */
    static generateFollowUp(missingFields: ArgumentSchema[], functionName: string): string {
        if (missingFields.length === 0) return '';

        const fieldDescriptions = missingFields.map(field => {
            let desc = field.descriptionTh;
            if (field.enum) {
                desc += ` (${field.enum.join(' / ')})`;
            }
            return desc;
        });

        if (missingFields.length === 1) {
            return `กรุณาระบุ${fieldDescriptions[0]}`;
        }

        return `กรุณาระบุข้อมูลเพิ่มเติม:\n${fieldDescriptions.map((d, i) => `${i + 1}. ${d}`).join('\n')}`;
    }

    /**
     * Validate enum values
     */
    static validateEnumValue(functionName: string, fieldName: string, value: string): boolean {
        const schema = this.getSchemaFor(functionName);
        if (!schema) return true;

        const field = schema.find(f => f.name === fieldName);
        if (!field || !field.enum) return true;

        return field.enum.includes(value);
    }

    /**
     * Get all available function names
     */
    static getAvailableFunctions(): string[] {
        return Object.keys(functionSchemas);
    }
}

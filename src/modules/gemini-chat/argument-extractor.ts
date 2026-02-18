/**
 * Argument Extractor Module
 * Validates and collects required arguments for MCP function calls
 * Also generates readable schema descriptions for Gemini context injection
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
    children?: ArgumentSchema[];  // Nested fields for object/array items
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
    // List Courses
    list_courses: [],

    // List Labs
    list_labs: [
        { name: 'courseId', type: 'string', required: true, description: 'Course ID', descriptionTh: 'รหัสคอร์ส' }
    ],

    // List Parts
    list_parts: [
        { name: 'labId', type: 'string', required: true, description: 'Lab ID', descriptionTh: 'รหัส Lab' }
    ],

    // Create Lab
    create_lab: [
        { name: 'courseId', type: 'string', required: true, description: 'Course ID', descriptionTh: 'รหัสคอร์ส' },
        { name: 'title', type: 'string', required: true, description: 'Lab title', descriptionTh: 'ชื่อ Lab' },
        { name: 'type', type: 'string', required: true, description: 'Lab type', descriptionTh: 'ประเภท Lab', enum: ['lab', 'exam'] },
        { name: 'description', type: 'string', required: false, description: 'Lab description', descriptionTh: 'คำอธิบาย Lab' }
    ],

    // Create Part (expanded with task sub-fields)
    create_part: [
        { name: 'labId', type: 'string', required: true, description: 'Lab ID this part belongs to', descriptionTh: 'รหัส Lab ที่ Part นี้อยู่' },
        { name: 'title', type: 'string', required: true, description: 'Part title', descriptionTh: 'ชื่อ Part' },
        { name: 'partType', type: 'string', required: true, description: 'Part type', descriptionTh: 'ประเภท Part', enum: ['fill_in_blank', 'network_config', 'dhcp_config'] },
        { name: 'order', type: 'number', required: true, description: 'Display order (1, 2, 3...)', descriptionTh: 'ลำดับการแสดง (1, 2, 3...)' },
        { name: 'description', type: 'string', required: false, description: 'Part description', descriptionTh: 'คำอธิบาย Part' },
        { name: 'totalPoints', type: 'number', required: true, description: 'Total points for this part', descriptionTh: 'คะแนนรวมของ Part นี้' },
        {
            name: 'tasks', type: 'array', required: false, description: 'List of grading tasks', descriptionTh: 'รายการ Task สำหรับตรวจให้คะแนน',
            children: [
                { name: 'taskId', type: 'string', required: true, description: 'Unique task ID', descriptionTh: 'รหัส Task (unique)' },
                { name: 'name', type: 'string', required: true, description: 'Task name', descriptionTh: 'ชื่อ Task' },
                { name: 'description', type: 'string', required: false, description: 'Task description', descriptionTh: 'คำอธิบาย Task' },
                { name: 'executionDevice', type: 'string', required: true, description: 'Source device to run command from (e.g. "PC1", "Router1")', descriptionTh: 'อุปกรณ์ต้นทางที่ใช้รันคำสั่ง (เช่น "PC1", "Router1")' },
                { name: 'targetDevices', type: 'array', required: false, description: 'Target devices (e.g. ["PC2"])', descriptionTh: 'อุปกรณ์ปลายทาง (เช่น ["PC2"])' },
                { name: 'templateId', type: 'string', required: true, description: 'Command template ID', descriptionTh: 'รหัส Template คำสั่ง' },
                {
                    name: 'parameters', type: 'object', required: true, description: 'Command parameters (e.g. destination IP)', descriptionTh: 'พารามิเตอร์คำสั่ง (เช่น IP ปลายทาง)',
                    children: [
                        { name: 'destination', type: 'string', required: false, description: 'Destination IP or hostname', descriptionTh: 'IP หรือ hostname ปลายทาง' },
                        { name: 'count', type: 'number', required: false, description: 'Number of attempts', descriptionTh: 'จำนวนครั้ง' }
                    ]
                },
                {
                    name: 'testCases', type: 'array', required: true, description: 'Expected results for grading', descriptionTh: 'ผลลัพธ์ที่คาดหวังสำหรับตรวจคะแนน',
                    children: [
                        { name: 'comparison_type', type: 'string', required: true, description: 'Comparison type', descriptionTh: 'ประเภทการเปรียบเทียบ', enum: ['equals', 'contains', 'regex', 'success', 'ssh_success', 'greater_than', 'not_equals'] },
                        { name: 'expected_result', type: 'string', required: true, description: 'Expected value', descriptionTh: 'ค่าที่คาดหวัง' }
                    ]
                },
                { name: 'order', type: 'number', required: true, description: 'Task order within part', descriptionTh: 'ลำดับ Task ภายใน Part' },
                { name: 'points', type: 'number', required: true, description: 'Points for this task', descriptionTh: 'คะแนนของ Task นี้' }
            ]
        },
        {
            name: 'questions', type: 'array', required: false, description: 'Fill-in-the-blank questions (for fill_in_blank type)', descriptionTh: 'คำถามแบบเติมคำ (สำหรับ fill_in_blank)',
            children: [
                { name: 'questionId', type: 'string', required: true, description: 'Question ID', descriptionTh: 'รหัสคำถาม' },
                { name: 'questionText', type: 'string', required: true, description: 'Question text', descriptionTh: 'ข้อความคำถาม' },
                { name: 'questionType', type: 'string', required: true, description: 'Question type', descriptionTh: 'ประเภทคำถาม', enum: ['network_address', 'first_usable_ip', 'last_usable_ip', 'broadcast_address', 'subnet_mask', 'ip_address', 'number', 'custom_text'] },
                { name: 'order', type: 'number', required: true, description: 'Question order', descriptionTh: 'ลำดับคำถาม' },
                { name: 'points', type: 'number', required: true, description: 'Points for this question', descriptionTh: 'คะแนนของคำถามนี้' }
            ]
        }
    ],

    // Create Task (standalone add_task to existing Part)
    create_task: [
        { name: 'partId', type: 'string', required: true, description: 'Part ID', descriptionTh: 'รหัส Part' },
        { name: 'name', type: 'string', required: true, description: 'Task name', descriptionTh: 'ชื่อ Task' },
        { name: 'executionDevice', type: 'string', required: true, description: 'Source device (e.g. "PC1")', descriptionTh: 'อุปกรณ์ต้นทาง (เช่น "PC1")' },
        { name: 'targetDevices', type: 'array', required: false, description: 'Destination devices', descriptionTh: 'อุปกรณ์ปลายทาง' },
        { name: 'templateId', type: 'string', required: true, description: 'Command template ID', descriptionTh: 'รหัส Template คำสั่ง' },
        { name: 'command', type: 'string', required: false, description: 'Command to execute', descriptionTh: 'คำสั่ง' },
        { name: 'expectedOutput', type: 'string', required: false, description: 'Expected output pattern', descriptionTh: 'รูปแบบผลลัพธ์ที่คาดหวัง' },
        { name: 'points', type: 'number', required: true, description: 'Points for this task', descriptionTh: 'คะแนนของ Task นี้' }
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

    // ========================================================================
    // Schema-to-Markdown for Gemini context injection
    // ========================================================================

    /**
     * Convert a function's schema to readable markdown for Gemini
     * Used to inject context when entering create/edit modes
     */
    static toMarkdown(functionName: string): string {
        const schema = this.getSchemaFor(functionName);
        if (!schema || schema.length === 0) {
            return `No schema defined for function: ${functionName}`;
        }

        const required = schema.filter(f => f.required);
        const optional = schema.filter(f => !f.required);

        let md = `## ${functionName} -- Required Fields\n`;

        if (required.length > 0) {
            md += required.map(f => this.fieldToMarkdown(f, 0)).join('\n');
        } else {
            md += '(no required fields)\n';
        }

        if (optional.length > 0) {
            md += `\n\n## ${functionName} -- Optional Fields\n`;
            md += optional.map(f => this.fieldToMarkdown(f, 0)).join('\n');
        }

        return md;
    }

    /**
     * Convert a single field to markdown line(s), with indentation for nesting
     */
    private static fieldToMarkdown(field: ArgumentSchema, indent: number): string {
        const pad = '  '.repeat(indent);
        let line = `${pad}- **${field.name}** (${field.type}`;
        if (field.required) line += ', required';
        line += ')';
        line += `: ${field.descriptionTh}`;
        if (field.enum) {
            line += ` -- values: \`${field.enum.join('` | `')}\``;
        }
        if (field.default !== undefined) {
            line += ` -- default: ${field.default}`;
        }

        // Render nested children
        if (field.children && field.children.length > 0) {
            line += '\n' + field.children.map(c => this.fieldToMarkdown(c, indent + 1)).join('\n');
        }

        return line;
    }
}

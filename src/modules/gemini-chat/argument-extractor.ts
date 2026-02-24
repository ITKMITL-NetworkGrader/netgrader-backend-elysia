/**
 * Argument Extractor Module
 * Validates and collects required arguments for MCP function calls
 * Also generates readable schema descriptions for Gemini context injection
 */
import { getFunctionDeclarations } from "./function-calling";

export interface ArgumentSchema {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'object' | 'array';
    required: boolean;
    description: string;
    descriptionTh: string;
    enum?: string[];
    default?: any;
    children?: ArgumentSchema[];
}

export interface ExtractionResult {
    complete: boolean;
    collectedArgs: Record<string, any>;
    missingFields: ArgumentSchema[];
    followUpQuestion?: string;
}

export interface PartialArguments {
    functionName: string;
    args: Record<string, any>;
    lastUpdated: Date;
}

export class ArgumentExtractor {

    private static convertGeminiParamsToMeta(parameters?: any): ArgumentSchema[] {
        const paramType = (parameters?.type || '').toLowerCase();
        if (!parameters || paramType !== 'object' || !parameters.properties) return [];
        const requiredFields = parameters.required || [];

        console.log(`[ArgumentExtractor] convertGeminiParamsToMeta - requiredFields: [${requiredFields.join(', ')}]`);
        console.log(`[ArgumentExtractor] allProperties: [${Object.keys(parameters.properties).join(', ')}]`);

        const result: ArgumentSchema[] = [];

        for (const [key, value] of Object.entries(parameters.properties)) {
            const field = value as any;
            result.push({
                name: key,
                type: (field.type || '').toLowerCase() as any,
                required: requiredFields.includes(key),
                description: field.description || key,
                descriptionTh: field.description || key,
                enum: field.enum,
                children: field.properties ? this.convertGeminiParamsToMeta(field) : (field.items && field.items.properties ? this.convertGeminiParamsToMeta(field.items) : undefined)
            });
        }
        return result;
    }

    static async getSchemaFor(functionName: string): Promise<ArgumentSchema[] | null> {
        const declarations = await getFunctionDeclarations();
        const decl = declarations.find(d => d.name === functionName) as any;
        if (!decl) {
            console.warn(`[ArgumentExtractor] getSchemaFor: No declaration found for "${functionName}". Available: [${declarations.map((d: any) => d.name).join(', ')}]`);
            return null;
        }
        console.log(`[ArgumentExtractor] getSchemaFor(${functionName}) - parameters.type: ${decl.parameters?.type}`);
        return this.convertGeminiParamsToMeta(decl.parameters);
    }

    static async getRequiredFields(functionName: string): Promise<ArgumentSchema[]> {
        const schema = await this.getSchemaFor(functionName);
        if (!schema) return [];
        return schema.filter(field => field.required);
    }

    static async getMissingFields(
        functionName: string,
        providedArgs: Record<string, any>
    ): Promise<ArgumentSchema[]> {
        const requiredFields = await this.getRequiredFields(functionName);
        const missing = requiredFields.filter(field => {
            const value = providedArgs[field.name];
            const isMissing = value === undefined || value === null || value === '';
            console.log(`[ArgumentExtractor] getMissingFields - field "${field.name}": value=${JSON.stringify(value)}, missing=${isMissing}`);
            return isMissing;
        });
        console.log(`[ArgumentExtractor] getMissingFields(${functionName}) - provided keys: [${Object.keys(providedArgs).join(', ')}], missing: [${missing.map(f => f.name).join(', ')}]`);
        return missing;
    }

    static async extract(
        functionName: string,
        providedArgs: Record<string, any>,
        context?: { courseId?: string; labId?: string; partId?: string }
    ): Promise<ExtractionResult> {
        console.log(`\n[ArgumentExtractor] ===== extract() called =====`);
        console.log(`[ArgumentExtractor] functionName: ${functionName}`);
        console.log(`[ArgumentExtractor] providedArgs:`, JSON.stringify(providedArgs, null, 2));
        console.log(`[ArgumentExtractor] context:`, JSON.stringify(context));

        const schema = await this.getSchemaFor(functionName);
        if (!schema) {
            console.error(`[ArgumentExtractor] Schema not found for function: ${functionName}`);
            return { complete: false, collectedArgs: {}, missingFields: [], followUpQuestion: `ไม่รู้จัก function: ${functionName}` };
        }

        const mergedArgs: Record<string, any> = { ...providedArgs };

        if (context?.courseId && !mergedArgs.courseId) { mergedArgs.courseId = context.courseId; console.log(`[ArgumentExtractor] Auto-injected courseId: ${context.courseId}`); }
        if (context?.labId && !mergedArgs.labId) { mergedArgs.labId = context.labId; console.log(`[ArgumentExtractor] Auto-injected labId: ${context.labId}`); }
        if (context?.partId && !mergedArgs.partId) { mergedArgs.partId = context.partId; console.log(`[ArgumentExtractor] Auto-injected partId: ${context.partId}`); }

        console.log(`[ArgumentExtractor] mergedArgs after context inject:`, JSON.stringify(mergedArgs, null, 2));

        const missingFields = await this.getMissingFields(functionName, mergedArgs);

        if (missingFields.length === 0) {
            console.log(`[ArgumentExtractor] COMPLETE - all required fields present`);
            return { complete: true, collectedArgs: mergedArgs, missingFields: [] };
        }

        console.log(`[ArgumentExtractor] INCOMPLETE - missing: [${missingFields.map(f => f.name).join(', ')}]`);
        const followUpQuestion = this.generateFollowUp(missingFields, functionName);

        return { complete: false, collectedArgs: mergedArgs, missingFields, followUpQuestion };
    }

    static generateFollowUp(missingFields: ArgumentSchema[], functionName: string): string {
        if (missingFields.length === 0) return '';
        const fieldDescriptions = missingFields.map(field => {
            let desc = field.descriptionTh;
            if (field.enum) desc += ` (${field.enum.join(' / ')})`;
            return desc;
        });
        if (missingFields.length === 1) return `กรุณาระบุ${fieldDescriptions[0]}`;
        return `กรุณาระบุข้อมูลเพิ่มเติม:\n${fieldDescriptions.map((d, i) => `${i + 1}. ${d}`).join('\n')}`;
    }

    static async validateEnumValue(functionName: string, fieldName: string, value: string): Promise<boolean> {
        const schema = await this.getSchemaFor(functionName);
        if (!schema) return true;
        const field = schema.find(f => f.name === fieldName);
        if (!field || !field.enum) return true;
        return field.enum.includes(value);
    }

    static async getAvailableFunctions(): Promise<string[]> {
        const decls = await getFunctionDeclarations();
        return decls.map(d => d.name).filter(n => n !== undefined) as string[];
    }

    static async toMarkdown(functionName: string): Promise<string> {
        const schema = await this.getSchemaFor(functionName);
        if (!schema || schema.length === 0) return `No schema defined for function: ${functionName}`;

        const required = schema.filter(f => f.required);
        const optional = schema.filter(f => !f.required);

        let md = `## ${functionName} -- Required Fields\n`;
        if (required.length > 0) md += required.map(f => this.fieldToMarkdown(f, 0)).join('\n');
        else md += '(no required fields)\n';

        if (optional.length > 0) {
            md += `\n\n## ${functionName} -- Optional Fields\n`;
            md += optional.map(f => this.fieldToMarkdown(f, 0)).join('\n');
        }
        return md;
    }

    private static fieldToMarkdown(field: ArgumentSchema, indent: number): string {
        const pad = '  '.repeat(indent);
        let line = `${pad}- **${field.name}** (${field.type}`;
        if (field.required) line += ', required';
        line += ')';
        line += `: ${field.descriptionTh}`;
        if (field.enum) line += ` -- values: \`${field.enum.join('` | `')}\``;
        if (field.default !== undefined) line += ` -- default: ${field.default}`;

        if (field.children && field.children.length > 0) {
            line += '\n' + field.children.map(c => this.fieldToMarkdown(c, indent + 1)).join('\n');
        }
        return line;
    }
}

export interface IDataExtractor {
    extract(
        input: string,
        functionName: string,
        currentArgs: Record<string, any>,
        context?: { courseId?: string; labId?: string; partId?: string }
    ): Promise<ExtractionResult>;

    generateSummary(functionName: string, args: Record<string, any>): Promise<string>;
}

const ALLOWED_FUNCTIONS: Record<string, string[]> = {
    'course_create': ['create_course', 'postV0Courses'],
    'course_edit': ['update_course', 'putV0CoursesById'],
    'lab_create': ['create_lab', 'postV0Labs'],
    'lab_edit_menu': ['update_lab', 'putV0LabsById'],
    'lab_edit': ['update_lab', 'putV0LabsById'],
    'part_create': ['create_part', 'postV0Parts', 'add_task', 'postV0Tasks'],
    'part_edit': ['update_part', 'putV0PartsById', 'add_task', 'postV0Tasks'],
    'course_list': [],
    'lab_list': [],
    'part_list': [],
};

export function isAllowedFunction(wizardStep: string, functionName: string): boolean {
    const allowed = ALLOWED_FUNCTIONS[wizardStep];
    if (!allowed || allowed.length === 0) return true;
    return allowed.includes(functionName);
}

export function getContextRejectMessage(wizardStep: string): string {
    const stepNames: Record<string, string> = {
        'course_create': 'สร้าง Course',
        'course_edit': 'แก้ไข Course',
        'lab_create': 'สร้าง Lab',
        'lab_edit_menu': 'แก้ไข Lab',
        'lab_edit': 'แก้ไข Lab',
        'part_create': 'สร้าง Part',
        'part_edit': 'แก้ไข Part',
    };
    const name = stepNames[wizardStep] || wizardStep;
    return `ขณะนี้อยู่ในโหมด **${name}** กรุณาใส่ข้อมูลที่เกี่ยวข้อง หรือสร้าง Chat ใหม่สำหรับงานอื่น`;
}

export class GeminiExtractor implements IDataExtractor {
    async extract(
        input: string,
        functionName: string,
        currentArgs: Record<string, any>,
        context?: { courseId?: string; labId?: string; partId?: string }
    ): Promise<ExtractionResult> {
        const result = await ArgumentExtractor.extract(functionName, currentArgs, context);
        return result;
    }

    mergeArgs(
        existingArgs: Record<string, any>,
        newArgs: Record<string, any>
    ): Record<string, any> {
        const merged = { ...existingArgs };
        for (const [key, value] of Object.entries(newArgs)) {
            if (value !== undefined && value !== null && value !== '') {
                merged[key] = value;
            }
        }
        return merged;
    }

    async generateSummary(functionName: string, args: Record<string, any>): Promise<string> {
        const schema = await ArgumentExtractor.getSchemaFor(functionName);
        if (!schema) return JSON.stringify(args, null, 2);

        const lines: string[] = [];
        const fnDisplayNames: Record<string, string> = {
            'create_lab': 'สร้าง Lab',
            'postV0Labs': 'สร้าง Lab',
            'create_part': 'สร้าง Part',
            'postV0Parts': 'สร้าง Part',
            'create_course': 'สร้าง Course',
            'postV0Courses': 'สร้าง Course',
            'update_lab': 'แก้ไข Lab',
            'putV0LabsById': 'แก้ไข Lab',
            'update_part': 'แก้ไข Part',
            'putV0PartsById': 'แก้ไข Part',
            'update_course': 'แก้ไข Course',
            'putV0CoursesById': 'แก้ไข Course',
            'add_task': 'เพิ่ม Task',
            'postV0Tasks': 'เพิ่ม Task',
        };

        lines.push(`**${fnDisplayNames[functionName] || functionName}** -- สรุปข้อมูล:`);
        lines.push('');

        for (const field of schema) {
            const value = args[field.name];
            if (value !== undefined && value !== null) {
                if (typeof value === 'object') {
                    lines.push(`- **${field.descriptionTh}**: ${JSON.stringify(value)}`);
                } else {
                    lines.push(`- **${field.descriptionTh}**: ${value}`);
                }
            }
        }

        lines.push('');
        lines.push('ข้อมูลถูกต้องหรือไม่? พิมพ์ "ยืนยัน" เพื่อดำเนินการ หรือบอกส่วนที่ต้องการแก้ไข');
        return lines.join('\n');
    }
}

export class RegexExtractor implements IDataExtractor {
    async extract(
        _input: string,
        _functionName: string,
        _currentArgs: Record<string, any>,
        _context?: { courseId?: string; labId?: string; partId?: string }
    ): Promise<ExtractionResult> {
        return {
            complete: false,
            collectedArgs: {},
            missingFields: [],
            followUpQuestion: '[RegexExtractor] ยังไม่ได้ implement -- กรุณาใช้ GeminiExtractor'
        };
    }

    async generateSummary(_functionName: string, _args: Record<string, any>): Promise<string> {
        return '[RegexExtractor] ยังไม่ได้ implement';
    }
}

import { Schema, model, Document } from 'mongoose';
import { ai, GEMINI_MODEL } from './gemini-client';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// API Schema Model -- stores function argument schemas in DB
// ============================================================================

export interface IFieldSchema {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'object' | 'array';
    required: boolean;
    description: string;
    descriptionTh: string;
    enum?: string[];
    default?: any;
    children?: IFieldSchema[];
}

export interface IApiSchema extends Document {
    functionName: string;
    displayName: string;
    displayNameTh: string;
    fields: IFieldSchema[];
    sourceFile: string;
    updatedAt: Date;
    updatedBy: 'ai-discovery';
}

const fieldSchemaDefinition: any = {
    name: { type: String, required: true },
    type: { type: String, enum: ['string', 'number', 'boolean', 'object', 'array'], required: true },
    required: { type: Boolean, required: true },
    description: { type: String, required: true },
    descriptionTh: { type: String, required: true },
    enum: { type: [String], required: false },
    default: { type: Schema.Types.Mixed, required: false },
    children: { type: [Schema.Types.Mixed], required: false }
};

const apiSchemaSchema = new Schema<IApiSchema>({
    functionName: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    displayName: {
        type: String,
        required: true
    },
    displayNameTh: {
        type: String,
        required: true
    },
    fields: {
        type: [fieldSchemaDefinition],
        required: true
    },
    sourceFile: {
        type: String,
        required: false
    },
    updatedAt: {
        type: Date,
        default: Date.now,
        required: true
    },
    updatedBy: {
        type: String,
        enum: ['ai-discovery'],
        default: 'ai-discovery',
        required: true
    }
}, {
    timestamps: false
});

export const ApiSchema = model<IApiSchema>('ApiSchema', apiSchemaSchema, 'api_schemas');

// ============================================================================
// Schema Discovery Interface (for future extensibility)
// ============================================================================

export interface ISchemaDiscovery {
    discover(): Promise<SchemaRefreshResult>;
}

export interface SchemaRefreshResult {
    success: boolean;
    totalDiscovered: number;
    updated: string[];
    errors: string[];
    log: string[];
}

// ============================================================================
// API source file config -- which files to read for schema discovery
// ============================================================================

const API_SOURCE_FILES = [
    { path: 'src/modules/labs/service.ts', functions: ['createLab', 'updateLab'] },
    { path: 'src/modules/parts/service.ts', functions: ['createPart', 'updatePart'] },
    { path: 'src/modules/courses/services.ts', functions: ['createCourse', 'updateCourse'] },
];

// ============================================================================
// SchemaManager -- manages API schema CRUD and discovery
// ============================================================================

export class SchemaManager {

    /**
     * Refresh all schemas by having Gemini read API source code
     * This is called when the user presses "Refresh API Schema" button
     * @param onProgress optional callback (percent: 0-100, message: string)
     */
    static async refreshSchemas(
        onProgress?: (percent: number, message: string) => void
    ): Promise<SchemaRefreshResult> {
        const report = (p: number, m: string) => { if (onProgress) onProgress(p, m); };

        const result: SchemaRefreshResult = {
            success: false,
            totalDiscovered: 0,
            updated: [],
            errors: [],
            log: []
        };

        report(0, 'Starting schema discovery...');

        // Step 1: Read source code from API files (0% -> 25%)
        const sourceContents: string[] = [];
        const totalFiles = API_SOURCE_FILES.length;

        for (let i = 0; i < totalFiles; i++) {
            const fileConfig = API_SOURCE_FILES[i];
            const fullPath = path.resolve(process.cwd(), fileConfig.path);
            const filePercent = Math.round((i / totalFiles) * 25);
            report(filePercent, `Reading ${fileConfig.path}...`);
            result.log.push(`[SchemaManager] Reading: ${fileConfig.path}`);

            try {
                const content = fs.readFileSync(fullPath, 'utf-8');
                sourceContents.push(
                    `\n// ===== FILE: ${fileConfig.path} =====\n` +
                    `// Functions of interest: ${fileConfig.functions.join(', ')}\n` +
                    content
                );
                result.log.push(`[SchemaManager] OK: ${fileConfig.path} (${content.length} chars)`);
            } catch (err: any) {
                result.errors.push(`Failed to read ${fileConfig.path}: ${err.message}`);
                result.log.push(`[SchemaManager] ERROR: ${fileConfig.path} -- ${err.message}`);
            }
        }

        report(25, `Read ${sourceContents.length}/${totalFiles} files`);

        if (sourceContents.length === 0) {
            result.errors.push('No source files could be read');
            report(100, 'Failed -- no source files');
            return result;
        }

        // Step 2: Send to Gemini for analysis (25% -> 55%)
        const prompt = this.buildDiscoveryPrompt(sourceContents.join('\n'));
        report(30, 'Sending source code to Gemini for analysis...');
        result.log.push(`[SchemaManager] Sending ${sourceContents.join('').length} chars to Gemini for analysis...`);

        try {
            report(35, 'Waiting for Gemini response...');

            const response = await ai.models.generateContent({
                model: GEMINI_MODEL,
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                config: {
                    responseMimeType: 'application/json'
                }
            });

            const responseText = response?.text || '';
            result.log.push(`[SchemaManager] Gemini responded with ${responseText.length} chars`);
            report(55, `Gemini responded (${responseText.length} chars)`);

            // Step 3: Parse and validate JSON (55% -> 65%)
            report(58, 'Parsing JSON response...');
            let schemas: any[];
            try {
                schemas = JSON.parse(responseText);
                if (!Array.isArray(schemas)) {
                    throw new Error('Response is not an array');
                }
            } catch (parseErr: any) {
                result.errors.push(`Failed to parse Gemini response: ${parseErr.message}`);
                result.log.push(`[SchemaManager] Parse error: ${parseErr.message}`);
                result.log.push(`[SchemaManager] Raw response: ${responseText.substring(0, 500)}`);
                report(100, 'Failed -- parse error');
                return result;
            }

            report(65, `Parsed ${schemas.length} function schemas`);
            result.log.push(`[SchemaManager] Parsed ${schemas.length} function schemas`);

            // Step 4: Validate and upsert each schema (65% -> 95%)
            const totalSchemas = schemas.length;
            for (let i = 0; i < totalSchemas; i++) {
                const schema = schemas[i];
                const upsertPercent = 65 + Math.round(((i + 1) / totalSchemas) * 30);

                const validationError = this.validateSchemaEntry(schema);
                if (validationError) {
                    result.errors.push(`Invalid schema for ${schema.functionName || 'unknown'}: ${validationError}`);
                    result.log.push(`[SchemaManager] SKIP: ${schema.functionName || 'unknown'} -- ${validationError}`);
                    report(upsertPercent, `Skipped: ${schema.functionName || 'unknown'}`);
                    continue;
                }

                try {
                    await ApiSchema.findOneAndUpdate(
                        { functionName: schema.functionName },
                        {
                            functionName: schema.functionName,
                            displayName: schema.displayName,
                            displayNameTh: schema.displayNameTh || schema.displayName,
                            fields: schema.fields,
                            sourceFile: schema.sourceFile || '',
                            updatedAt: new Date(),
                            updatedBy: 'ai-discovery'
                        },
                        { upsert: true, new: true }
                    );

                    result.updated.push(schema.functionName);
                    result.totalDiscovered++;
                    result.log.push(`[SchemaManager] UPSERTED: ${schema.functionName} (${schema.fields.length} fields)`);
                    report(upsertPercent, `Saved: ${schema.functionName}`);
                } catch (dbErr: any) {
                    result.errors.push(`DB error for ${schema.functionName}: ${dbErr.message}`);
                    result.log.push(`[SchemaManager] DB ERROR: ${schema.functionName} -- ${dbErr.message}`);
                }
            }

            result.success = result.errors.length === 0;
            result.log.push(`[SchemaManager] Done. Updated: ${result.updated.length}, Errors: ${result.errors.length}`);
            report(100, `Done -- ${result.updated.length} schemas updated`);

        } catch (geminiErr: any) {
            result.errors.push(`Gemini API error: ${geminiErr.message}`);
            result.log.push(`[SchemaManager] Gemini API error: ${geminiErr.message}`);
            report(100, `Failed -- ${geminiErr.message}`);
        }

        return result;
    }

    /**
     * Get schema for a specific function from DB
     * Returns null if not found (no hardcoded fallback)
     */
    static async getSchema(functionName: string): Promise<IFieldSchema[] | null> {
        const doc = await ApiSchema.findOne({ functionName }).lean();
        return doc ? doc.fields as IFieldSchema[] : null;
    }

    /**
     * Get all schemas from DB
     */
    static async getAllSchemas(): Promise<any[]> {
        return ApiSchema.find().sort({ functionName: 1 }).lean();
    }

    /**
     * Build the prompt for Gemini to analyze API source code
     */
    private static buildDiscoveryPrompt(sourceCode: string): string {
        return `You are an API schema analyzer. Read the following TypeScript source code and extract the argument schemas for each API function.

For each function that creates or updates data (createLab, updateLab, createPart, updatePart, createCourse, updateCourse, etc.), identify:
1. The function name in snake_case format (e.g., createLab -> create_lab)
2. A display name in English (e.g., "Create Lab")
3. A display name in Thai (e.g., "สร้าง Lab")
4. All parameters/fields the function accepts, including:
   - name: field name
   - type: "string" | "number" | "boolean" | "object" | "array"
   - required: true/false
   - description: English description
   - descriptionTh: Thai description
   - enum: allowed values if applicable
   - children: nested field schemas for object/array types
5. The source file path

Focus on the data fields that a user would need to provide, not internal parameters like userId or database-specific fields.
For nested objects (like tasks inside a part, or questions), include the children array describing sub-fields.

Return ONLY a JSON array with this exact format:
[
    {
        "functionName": "create_lab",
        "displayName": "Create Lab",
        "displayNameTh": "สร้าง Lab",
        "sourceFile": "src/modules/labs/service.ts",
        "fields": [
            {
                "name": "title",
                "type": "string",
                "required": true,
                "description": "Lab title",
                "descriptionTh": "ชื่อ Lab"
            },
            {
                "name": "tasks",
                "type": "array",
                "required": false,
                "description": "List of grading tasks",
                "descriptionTh": "รายการ Task",
                "children": [
                    { "name": "taskId", "type": "string", "required": true, "description": "Task ID", "descriptionTh": "รหัส Task" }
                ]
            }
        ]
    }
]

SOURCE CODE:
${sourceCode}`;
    }

    /**
     * Validate a schema entry from Gemini's response
     */
    private static validateSchemaEntry(schema: any): string | null {
        if (!schema.functionName || typeof schema.functionName !== 'string') {
            return 'Missing or invalid functionName';
        }
        if (!schema.displayName || typeof schema.displayName !== 'string') {
            return 'Missing or invalid displayName';
        }
        if (!Array.isArray(schema.fields)) {
            return 'fields must be an array';
        }
        for (const field of schema.fields) {
            if (!field.name || !field.type) {
                return `Field missing name or type: ${JSON.stringify(field)}`;
            }
            if (!['string', 'number', 'boolean', 'object', 'array'].includes(field.type)) {
                return `Invalid field type "${field.type}" for field "${field.name}"`;
            }
        }
        return null;
    }
}

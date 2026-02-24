import { Type } from '@google/genai';
import * as path from 'path';

export class SchemaReaderService {
    private static cachedOpenApi: any = null;
    private static cachedDeclarations: any[] | null = null;

    /**
     * โหลดไฟล์ api-schema/openapi.json
     */
    public static async loadCombinedSchema() {
        if (this.cachedOpenApi) return this.cachedOpenApi;
        try {
            const filePath = path.resolve(process.cwd(), 'api-schema/openapi.json');
            const fileContent = await Bun.file(filePath).text();
            this.cachedOpenApi = JSON.parse(fileContent);
            return this.cachedOpenApi;
        } catch (error) {
            console.error('❌ Error loading openapi.json:', error);
            return null;
        }
    }

    /**
     * แปลง OpenAPI Schema เป็น FunctionDeclaration สำหรับ Gemini
     */
    public static async getFunctionDeclarations(): Promise<any[]> {
        if (this.cachedDeclarations) return this.cachedDeclarations;

        const spec = await this.loadCombinedSchema();
        if (!spec || !spec.paths) return [];

        const declarations: any[] = [];

        for (const [apiPath, methods] of Object.entries(spec.paths)) {
            for (const [method, operation] of Object.entries(methods as Record<string, any>)) {

                const operationId = operation.operationId;
                if (!operationId) continue;

                const description = operation.summary || operation.description || `Call API ${method.toUpperCase()} ${apiPath}`;

                let parameters: any = {
                    type: Type.OBJECT,
                    properties: {},
                };

                // รวม Path/Query Parameters
                if (operation.parameters) {
                    for (const param of operation.parameters) {
                        if (param.in === 'path' || param.in === 'query') {
                            parameters.properties[param.name] = this.openApiToGeminiSchema(param.schema || { type: 'string' });
                            if (param.required) {
                                parameters.required = parameters.required || [];
                                parameters.required.push(param.name);
                            }
                        }
                    }
                }

                // รวม Request Body
                if (operation.requestBody?.content?.['application/json']?.schema) {
                    let bodySchema = operation.requestBody.content['application/json'].schema;

                    // Unwrap 'body' wrapper typical from Elysia Swagger
                    if (bodySchema.properties && bodySchema.properties.body && Object.keys(bodySchema.properties).length === 1) {
                        bodySchema = bodySchema.properties.body;
                    }

                    if (bodySchema.properties) {
                        const mapped = this.openApiToGeminiSchema(bodySchema);
                        if (mapped.properties) {
                            parameters.properties = { ...parameters.properties, ...mapped.properties };
                        }
                    }
                    if (bodySchema.required) {
                        parameters.required = parameters.required || [];
                        parameters.required.push(...bodySchema.required);
                    }
                }

                const declaration: any = {
                    name: operationId,
                    description: description,
                };

                // ถ้ามี properties ค่อยใส่ parameters 
                if (Object.keys(parameters.properties).length > 0) {
                    declaration.parameters = parameters;
                }

                declarations.push(declaration);
            }
        }

        this.cachedDeclarations = declarations;
        return declarations;
    }

    private static openApiToGeminiSchema(schema: any): any {
        if (!schema) return { type: Type.STRING };

        let typeStr = schema.type || "string";
        let typeEnum: Type;

        switch (typeStr) {
            case 'string': typeEnum = Type.STRING; break;
            case 'number':
            case 'integer': typeEnum = Type.NUMBER; break;
            case 'boolean': typeEnum = Type.BOOLEAN; break;
            case 'array': typeEnum = Type.ARRAY; break;
            case 'object': typeEnum = Type.OBJECT; break;
            default: typeEnum = Type.STRING; break;
        }

        const result: any = { type: typeEnum };

        if (schema.description) result.description = schema.description;
        if (schema.enum) result.enum = schema.enum;

        if (typeStr === 'object' && schema.properties) {
            result.properties = {};
            for (const [key, val] of Object.entries(schema.properties)) {
                result.properties[key] = this.openApiToGeminiSchema(val);
            }
            if (schema.required) result.required = schema.required;
        }
        else if (typeStr === 'array' && schema.items) {
            result.items = this.openApiToGeminiSchema(schema.items);
        }

        // Handle anyOf just by picking the first valid type if possible, or fallback
        if (schema.anyOf && Array.isArray(schema.anyOf)) {
            const firstValid = schema.anyOf.find((s: any) => s.type && s.type !== 'null');
            if (firstValid) {
                const sub = this.openApiToGeminiSchema(firstValid);
                result.type = sub.type;
                if (sub.properties) result.properties = sub.properties;
                if (sub.items) result.items = sub.items;
                if (sub.enum) result.enum = sub.enum;
            }
        }

        return result;
    }

    /**
     * ดึงโครงสร้างเฉพาะ Endpoint สำหรับ Context ใน Prompt
     */
    public static async getSchemaForPromptContext(targetOperationId: string): Promise<string | null> {
        const spec = await this.loadCombinedSchema();
        if (!spec || !spec.paths) return null;

        for (const [apiPath, methods] of Object.entries(spec.paths)) {
            for (const [method, operation] of Object.entries(methods as Record<string, any>)) {
                if (operation.operationId === targetOperationId) {
                    const result = {
                        path: apiPath,
                        method: method.toUpperCase(),
                        parameters: operation.parameters,
                        requestBody: operation.requestBody?.content?.['application/json']?.schema
                    };
                    return JSON.stringify(result, null, 2);
                }
            }
        }
        return null;
    }
}

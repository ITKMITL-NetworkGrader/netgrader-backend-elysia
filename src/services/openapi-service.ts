import yaml from 'js-yaml';
import type { Elysia } from 'elysia';

export class OpenAPIService {
    /**
     * รายการ Path และ Method ที่ต้องการให้แสดงใน YAML Spec
     */
    private static readonly INCLUDE_LIST: Record<string, string[]> = {
        '/v0/courses/': ['post'], // Create Course
        '/v0/courses/{id}': ['put'], // Update Course
        '/v0/labs/': ['post'], // Create Lab
        '/v0/labs/{id}': ['put'], // Update Lab
        '/v0/parts/': ['post'], // Create Part
        '/v0/parts/{id}': ['put'], // Update Part
    };

    /**
     * ดึง OpenAPI JSON จาก Elysia app และแปลงเป็น YAML เฉพาะส่วนที่เลือก
     */
    public static async generateYAML(app: Elysia<any, any, any, any, any, any, any>) {
        try {
            // 1. จำลอง Request ไปดึง JSON Spec มาจาก Swagger Plugin
            const response = await app.handle(
                new Request('http://localhost/swagger/json')
            );

            if (!response.ok) {
                console.error('❌ Failed to fetch Swagger JSON');
                return;
            }

            const jsonSpec = (await response.json()) as {
                paths: Record<string, Record<string, any>>;
                [key: string]: any;
            };

            // 2. กรองเฉพาะ path ที่ต้องการ
            const filteredPaths: Record<string, any> = {};

            for (const [path, methods] of Object.entries(jsonSpec.paths)) {
                if (this.INCLUDE_LIST[path]) {
                    const selectedMethods: Record<string, any> = {};

                    // วนลูปเช็คแต่ละ Method ใน Path นั้น
                    this.INCLUDE_LIST[path].forEach((m) => {
                        const methodLower = m.toLowerCase();
                        if (methods[methodLower]) {
                            selectedMethods[methodLower] = methods[methodLower];
                        }
                    });

                    if (Object.keys(selectedMethods).length > 0) {
                        filteredPaths[path] = selectedMethods;
                    }
                }
            }

            // 3. สร้าง Spec ใหม่ที่โดนกรองแล้ว
            const minimalSpec = {
                ...jsonSpec,
                paths: filteredPaths,
            };

            // 4. เขียนลงไฟล์ openapi.yaml
            const yamlContent = yaml.dump(minimalSpec, {
                indent: 2,
                lineWidth: -1,
                noRefs: true,
            });

            await Bun.write('api-yaml/openapi.yaml', yamlContent);

            console.log('✨ [YAML] API Spec updated: api-yaml/openapi.yaml');
        } catch (error) {
            console.error('❌ Error saving YAML spec:', error);
        }
    }
}

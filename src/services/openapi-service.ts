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
     * ดึง OpenAPI JSON จาก Elysia app และกรองเฉพาะส่วนที่เลือก
     * @returns JSON Spec ที่ผ่านการกรองแล้ว
     */
    public static async extractJSON(app: Elysia<any, any, any, any, any, any, any>) {
        try {
            // 1. จำลอง Request ไปดึง JSON Spec มาจาก Swagger Plugin
            const response = await app.handle(
                new Request('http://localhost/swagger/json')
            );

            if (!response.ok) {
                console.error('❌ Failed to fetch Swagger JSON');
                return null;
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
            return {
                ...jsonSpec,
                paths: filteredPaths,
            };
        } catch (error) {
            console.error('❌ Error extracting JSON spec:', error);
            return null;
        }
    }

    /**
     * ดึง OpenAPI JSON จาก Elysia app และเขียนเป็นไฟล์ทั้ง JSON และ YAML แยกตามแต่ละ Path และ Method, รวมไปถึงไฟล์รวมทั้งหมดด้วย
     */
    public static async extractAPI(app: Elysia<any, any, any, any, any, any, any>) {
        try {
            const minimalSpec = await this.extractJSON(app);
            if (!minimalSpec) return;

            // 1. เขียนไฟล์รวม (openapi.json และ openapi.yaml)
            const combinedJsonContent = JSON.stringify(minimalSpec, null, 2);
            await Bun.write('api-schema/openapi.json', combinedJsonContent);
            console.log('✨ [JSON] Combined API Spec updated: api-schema/openapi.json');

            const combinedYamlContent = yaml.dump(minimalSpec, {
                indent: 2,
                lineWidth: -1,
                noRefs: true,
            });
            await Bun.write('api-schema/openapi.yaml', combinedYamlContent);
            console.log('✨ [YAML] Combined API Spec updated: api-schema/openapi.yaml');

            // 2. วนลูปตามแต่ละ path ที่มีในสเปคที่เรากรองมา เพื่อเขียนไฟล์แยก
            for (const [path, methods] of Object.entries(minimalSpec.paths)) {

                // วนลูปตามแต่ละ method ใน path นั้น
                for (const [method, operation] of Object.entries(methods as Record<string, any>)) {

                    // สร้าง Spec สำหรับ path และ method นี้
                    const pathMethodSpec = {
                        ...minimalSpec,
                        paths: {
                            [path]: {
                                [method]: operation
                            }
                        }
                    };

                    // แปลงชื่อ path ให้เป็นชื่อไฟล์ที่ปลอดภัย (แทนที่ / ด้วย - และตัดพารามิเตอร์)
                    let fileName = path
                        .replace(/^\/|\/$/g, '')        // ลบ / หน้าสุดและหลังสุด
                        .replace(/\//g, '-')            // เปลี่ยน / ตรงกลางเป็น -
                        .replace(/\{|\}/g, '');         // ลบปีกกา {} ออก

                    if (!fileName) fileName = 'root';

                    // เติม method ต่อท้ายชื่อไฟล์
                    fileName = `${fileName}-${method.toLowerCase()}`;

                    const jsonFilePath = `api-schema/${fileName}.json`;
                    const yamlFilePath = `api-schema/${fileName}.yaml`;

                    // เขียนไฟล์ JSON
                    const jsonContent = JSON.stringify(pathMethodSpec, null, 2);
                    await Bun.write(jsonFilePath, jsonContent);
                    console.log(`✨ [JSON] API Spec updated: ${jsonFilePath}`);

                    // เขียนไฟล์ YAML
                    const yamlContent = yaml.dump(pathMethodSpec, {
                        indent: 2,
                        lineWidth: -1,
                        noRefs: true,
                    });
                    await Bun.write(yamlFilePath, yamlContent);
                    console.log(`✨ [YAML] API Spec updated: ${yamlFilePath}`);
                }
            }

        } catch (error) {
            console.error('❌ Error saving API spec:', error);
        }
    }
}

import { ArgumentExtractor, ArgumentSchema } from './argument-extractor';
import { LabService } from '../labs/service';
import { PartService } from '../parts/service';

// ============================================================================
// Welcome Message Generator
// Generates dynamic welcome messages based on wizard context
// ============================================================================

type WizardStep = string;

interface WelcomeContext {
    step: WizardStep;
    courseId?: string;
    labId?: string;
    partId?: string;
}

interface WelcomeResult {
    message: string;
    entityData?: Record<string, any>;
}

export class WelcomeMessage {

    /**
     * Generate a welcome message based on wizard context
     */
    static async generate(context?: WelcomeContext): Promise<WelcomeResult> {
        if (!context?.step || context.step === 'course_list') {
            return this.generateDefaultWelcome();
        }

        // Route to appropriate handler based on step
        switch (context.step) {
            case 'course_create':
                return this.generateCreateWelcome('create_course', 'Course');
            case 'course_edit':
                return this.generateCourseEditWelcome(context.courseId);
            case 'lab_create':
                return this.generateCreateWelcome('create_lab', 'Lab');
            case 'lab_edit_menu':
            case 'lab_edit':
                return this.generateLabEditWelcome(context.labId);
            case 'part_create':
                return this.generateCreateWelcome('create_part', 'Part');
            case 'part_edit':
                return this.generatePartEditWelcome(context.partId);
            default:
                return this.generateDefaultWelcome();
        }
    }

    /**
     * Default welcome message (no specific context)
     */
    private static generateDefaultWelcome(): WelcomeResult {
        return {
            message: [
                'สวัสดีครับ! ผมคือ Netgrader Assistant',
                '',
                'คุณต้องการทำอะไรครับ?',
                '1. จัดการ Course (สร้าง/แก้ไข/ดูรายการ)',
                '2. จัดการ Lab (สร้าง/แก้ไข/ดูรายการ)',
                '3. จัดการ Part (สร้าง/แก้ไข/ดูรายการ)',
                '',
                'กรุณาพิมพ์บอกผมได้เลยครับ'
            ].join('\n')
        };
    }

    /**
     * Welcome for CREATE mode -- shows required fields from DB schema
     */
    private static async generateCreateWelcome(
        functionName: string,
        entityName: string
    ): Promise<WelcomeResult> {
        // Map legacy function names to OpenAPI operation IDs
        let opId = functionName;
        if (functionName === 'create_course') opId = 'postV0Courses';
        if (functionName === 'create_lab') opId = 'postV0Labs';
        if (functionName === 'create_part') opId = 'postV0Parts';

        // Fetch schema from dynamically parsed OpenAPI
        const fields = await ArgumentExtractor.getSchemaFor(opId);

        if (!fields || fields.length === 0) {
            return {
                message: [
                    `สวัสดีครับ! มาสร้าง ${entityName} กันเถอะ`,
                    '',
                    'กรุณาบอกรายละเอียดของ ' + entityName + ' ที่ต้องการสร้างได้เลยครับ'
                ].join('\n')
            };
        }

        const required = fields.filter(f => f.required && f.name !== 'courseId' && f.name !== 'labId' && f.name !== 'partId');
        const optional = fields.filter(f => !f.required);

        const lines: string[] = [
            `สวัสดีครับ! มาสร้าง **${entityName}** กันเถอะ`,
            '',
            '**ข้อมูลที่จำเป็น:**'
        ];

        for (const field of required) {
            let line = `- ${field.descriptionTh || field.description} (\`${field.name}\`)`;
            if (field.enum && field.enum.length > 0) {
                line += `\n  - ค่าที่เลือกได้: ${field.enum.join(', ')}`;
            }
            lines.push(line);
        }

        if (optional.length > 0) {
            lines.push('');
            lines.push('**ข้อมูลเพิ่มเติม (ไม่บังคับ):**');
            for (const field of optional) {
                let line = `- ${field.descriptionTh || field.description} (\`${field.name}\`)`;
                if (field.enum && field.enum.length > 0) {
                    line += `\n  - ค่าที่เลือกได้: ${field.enum.join(', ')}`;
                }
                lines.push(line);
            }
        }

        lines.push('');
        lines.push('\nกรุณาบอกข้อมูลที่ต้องการได้เลยครับ จะพิมพ์ทีเดียวหรือทีละส่วนก็ได้');

        return { message: lines.join('\n') };
    }

    /**
     * Welcome for EDIT Course mode -- fetch real data and show
     */
    private static async generateCourseEditWelcome(
        courseId?: string
    ): Promise<WelcomeResult> {
        if (!courseId) {
            return {
                message: [
                    'สวัสดีครับ! ต้องการแก้ไข Course',
                    '',
                    'แต่ยังไม่ได้ระบุ Course ID กรุณาเลือก Course ที่ต้องการแก้ไขก่อนครับ'
                ].join('\n')
            };
        }

        // Course service doesn't have getCourseById yet
        // Show basic message for now
        return {
            message: [
                `สวัสดีครับ! แก้ไข **Course** (ID: \`${courseId}\`)`,
                '',
                'กรุณาบอกว่าต้องการแก้ไขส่วนไหน เช่น:',
                '- ชื่อ Course',
                '- คำอธิบาย',
                '- การตั้งค่าอื่นๆ',
                '',
                'พิมพ์บอกผมได้เลยครับ'
            ].join('\n')
        };
    }

    /**
     * Welcome for EDIT Lab mode -- fetch real lab data and show
     */
    private static async generateLabEditWelcome(
        labId?: string
    ): Promise<WelcomeResult> {
        if (!labId) {
            return {
                message: 'สวัสดีครับ! ต้องการแก้ไข Lab แต่ยังไม่ได้ระบุ Lab กรุณาเลือก Lab ก่อนครับ'
            };
        }

        try {
            const lab: any = await LabService.getLabById(labId);
            if (!lab) {
                return {
                    message: `ไม่พบ Lab ID: \`${labId}\` กรุณาตรวจสอบอีกครั้ง`
                };
            }

            const lines: string[] = [
                `สวัสดีครับ! แก้ไข **Lab**: **${lab.title || 'Untitled'}**`,
                '',
                '**ข้อมูลปัจจุบัน:**',
                `- ชื่อ: ${lab.title || '-'}`,
                `- ประเภท: ${lab.type || '-'}`,
                `- คำอธิบาย: ${lab.description || '-'}`,
            ];

            if (lab.startDate) lines.push(`- วันเริ่มต้น: ${new Date(lab.startDate).toLocaleString('th-TH')}`);
            if (lab.endDate) lines.push(`- วันสิ้นสุด: ${new Date(lab.endDate).toLocaleString('th-TH')}`);
            if (lab.timeLimit) lines.push(`- เวลาจำกัด: ${lab.timeLimit} นาที`);

            lines.push('');
            lines.push('กรุณาบอกว่าต้องการแก้ไขส่วนไหนครับ');

            return { message: lines.join('\n'), entityData: lab };
        } catch (err: any) {
            return {
                message: `เกิดข้อผิดพลาดในการดึงข้อมูล Lab: ${err.message}`
            };
        }
    }

    /**
     * Welcome for EDIT Part mode -- fetch real part data and show
     */
    private static async generatePartEditWelcome(
        partId?: string
    ): Promise<WelcomeResult> {
        if (!partId) {
            return {
                message: 'สวัสดีครับ! ต้องการแก้ไข Part แต่ยังไม่ได้ระบุ Part กรุณาเลือก Part ก่อนครับ'
            };
        }

        try {
            const part = await PartService.getPartById(partId);
            if (!part) {
                return {
                    message: `ไม่พบ Part ID: \`${partId}\` กรุณาตรวจสอบอีกครั้ง`
                };
            }

            const lines: string[] = [
                `สวัสดีครับ! แก้ไข **Part**: **${part.title || 'Untitled'}**`,
                '',
                '**ข้อมูลปัจจุบัน:**',
                `- ชื่อ: ${part.title || '-'}`,
                `- ประเภท: ${part.partType || '-'}`,
                `- คำอธิบาย: ${part.description || '-'}`,
                `- คะแนนรวม: ${part.totalPoints || 0}`,
            ];

            if (part.tasks && Array.isArray(part.tasks)) {
                lines.push(`- จำนวน Tasks: ${part.tasks.length}`);
            }
            if (part.questions && Array.isArray(part.questions)) {
                lines.push(`- จำนวน Questions: ${part.questions.length}`);
            }

            lines.push('');
            lines.push('กรุณาบอกว่าต้องการแก้ไขส่วนไหนครับ');

            return { message: lines.join('\n'), entityData: part };
        } catch (err: any) {
            return {
                message: `เกิดข้อผิดพลาดในการดึงข้อมูล Part: ${err.message}`
            };
        }
    }

    // formatField removed because it was unused
}

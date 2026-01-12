/**
 * IPv6 Configuration Utilities
 * 
 * Template-based IPv6 address generation with Student ID variables.
 * 
 * Available placeholders:
 * - {X}     : Year + Faculty (e.g., 6507)
 * - {Y}     : Sequence number (e.g., 41)
 * - {Z}     : Z value = seq % 1000 (e.g., 41)
 * - {VLAN}  : VLAN ID (e.g., 141 or "A")
 * - {offset}: Interface offset (e.g., 1, 2, 3)
 * - {last3} : Last 3 digits of Student ID (e.g., "041")
 * - {X_hex} : X in hexadecimal (e.g., "196b")
 * - {Y_hex} : Y in hexadecimal (e.g., "29")
 */

export interface StudentIPv6Variables {
    X: number;        // Year * 100 + Faculty (6507)
    Y: number;        // Sequence number (41)
    Z: number;        // seq % 1000 (41)
    last3: string;    // Last 3 digits as string ("041")
    X_hex: string;    // X in hexadecimal
    Y_hex: string;    // Y in hexadecimal
    year: number;     // Enrollment year (65)
    faculty: number;  // Faculty code (07)
    sequence: number; // Full sequence number (41)
}

export interface IPv6TemplatePreset {
    name: string;
    template: string;
    managementTemplate?: string;
    description: string;
}

/**
 * Preset templates for common use cases
 */
export const IPv6_PRESETS: Record<string, IPv6TemplatePreset> = {
    standard_exam: {
        name: 'Standard Exam',
        template: '2001:{X}:{Y}:{VLAN}::{offset}/64',
        managementTemplate: '2001:{X}:{Y}:306::{offset}/64',
        description: 'Format: 2001:YearFaculty:Seq:VLAN::offset/64'
    },
    university_network: {
        name: 'University Network',
        template: '2001:3c8:1106:4{last3}:{VLAN}::{offset}/64',
        managementTemplate: '2001:3c8:1106:4306::{last3}/64',
        description: 'Internet-capable with university prefix'
    },
    simple_lab: {
        name: 'Simple Lab',
        template: '2001:db8:{X}:{VLAN}::{offset}/64',
        managementTemplate: '2001:db8:{X}:mgmt::{offset}/64',
        description: 'Documentation prefix for practice labs'
    }
};

/**
 * Calculate student IPv6 variables from Student ID
 * 
 * Student ID format: YYFFSSSS
 * - YY   : Year of entry (e.g., 65 for 2565)
 * - FF   : Faculty code (e.g., 07)
 * - SSSS : Sequence number (e.g., 0041)
 * 
 * @param studentId 8-digit student ID (e.g., "65070041")
 * @returns Calculated variables for IPv6 template
 */
export function calculateStudentVariables(studentId: string): StudentIPv6Variables {
    // Validate input
    if (!studentId || studentId.length !== 8 || !/^\d{8}$/.test(studentId)) {
        throw new Error(`Invalid student ID format: ${studentId}. Expected 8 digits.`);
    }

    const year = parseInt(studentId.substring(0, 2), 10);     // 65
    const faculty = parseInt(studentId.substring(2, 4), 10);  // 07
    const sequence = parseInt(studentId.substring(4, 8), 10); // 41 (leading zeros stripped)

    // X: Unique per year-faculty combination
    const X = year * 100 + faculty;  // 6507

    // Y: Sequence number (unique within year-faculty)
    const Y = sequence;              // 41

    // Z: For router-to-router links
    const Z = sequence % 1000;       // 41

    // Last 3 digits as string (preserves leading zeros)
    const last3 = studentId.slice(-3);  // "041"

    return {
        X,
        Y,
        Z,
        last3,
        X_hex: X.toString(16),
        Y_hex: Y.toString(16),
        year,
        faculty,
        sequence
    };
}

/**
 * Generate IPv6 address from template
 * 
 * @param template IPv6 template with placeholders
 * @param studentId 8-digit student ID
 * @param vlanId VLAN identifier (number or string like "A")
 * @param offset Interface offset (1, 2, 3, etc.)
 * @returns Generated IPv6 address
 */
export function generateIPv6FromTemplate(
    template: string,
    studentId: string,
    vlanId: string | number,
    offset: number
): string {
    const vars = calculateStudentVariables(studentId);

    return template
        .replace(/\{X\}/g, vars.X.toString())
        .replace(/\{Y\}/g, vars.Y.toString())
        .replace(/\{Z\}/g, vars.Z.toString())
        .replace(/\{VLAN\}/g, vlanId.toString())
        .replace(/\{offset\}/g, offset.toString())
        .replace(/\{last3\}/g, vars.last3)
        .replace(/\{X_hex\}/g, vars.X_hex)
        .replace(/\{Y_hex\}/g, vars.Y_hex);
}

/**
 * Generate preview IPv6 addresses for a given configuration
 * 
 * @param template IPv6 template
 * @param sampleStudentId Sample student ID for preview
 * @param vlans Array of VLAN IDs to preview
 * @returns Object with preview addresses
 */
export function generateIPv6Preview(
    template: string,
    sampleStudentId: string = '65070041',
    vlans: (string | number)[] = ['141', '241']
): Record<string, string> {
    const preview: Record<string, string> = {};

    vlans.forEach((vlanId, index) => {
        const key = `VLAN ${typeof vlanId === 'string' ? vlanId : String.fromCharCode(65 + index)}`;
        preview[key] = generateIPv6FromTemplate(template, sampleStudentId, vlanId, index + 1);
    });

    return preview;
}

/**
 * Validate IPv6 template syntax
 * 
 * @param template IPv6 template to validate
 * @returns Validation result with errors if any
 */
export function validateIPv6Template(template: string): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
} {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for required placeholders
    const requiredPlaceholders = ['{VLAN}', '{offset}'];
    const recommendedPlaceholders = ['{X}', '{Y}'];

    for (const placeholder of requiredPlaceholders) {
        if (!template.includes(placeholder)) {
            errors.push(`Missing required placeholder: ${placeholder}`);
        }
    }

    for (const placeholder of recommendedPlaceholders) {
        if (!template.includes(placeholder)) {
            warnings.push(`Consider using placeholder: ${placeholder} for student uniqueness`);
        }
    }

    // Check for valid IPv6 prefix format (basic check)
    if (!template.includes('::') && !template.includes(':')) {
        errors.push('Template must contain IPv6 colons');
    }

    // Check for prefix length
    if (!template.includes('/')) {
        warnings.push('Template should include prefix length (e.g., /64)');
    }

    // Check for unknown placeholders
    const validPlaceholders = ['{X}', '{Y}', '{Z}', '{VLAN}', '{offset}', '{last3}', '{X_hex}', '{Y_hex}'];
    const placeholderRegex = /\{[^}]+\}/g;
    const foundPlaceholders = template.match(placeholderRegex) || [];

    for (const found of foundPlaceholders) {
        if (!validPlaceholders.includes(found)) {
            errors.push(`Unknown placeholder: ${found}`);
        }
    }

    return {
        isValid: errors.length === 0,
        errors,
        warnings
    };
}

/**
 * Generate VLAN subnet IDs based on sequence number
 * 
 * @param studentId 8-digit student ID
 * @param vlanIndex VLAN index (0, 1, 2, ...)
 * @returns Calculated subnet ID for the VLAN
 */
export function calculateVlanSubnetId(studentId: string, vlanIndex: number): number {
    const vars = calculateStudentVariables(studentId);
    // Base offset + VLAN index * 100 to keep VLANs separate
    return (vars.sequence % 100) + (vlanIndex * 100) + 100;
}

/**
 * IPv6 Lab Configuration for address generation
 */
export interface IPv6LabConfig {
    enabled: boolean;
    template: string;
    managementTemplate?: string;
    presetName?: string;
    globalPrefix?: string;
    prefixMode?: 'template' | 'structured';
    managementOverride?: {
        enabled: boolean;
        fixedPrefix: string;
        useStudentIdSuffix: boolean;
    };
}

/**
 * Generate IPv6 address using structured prefix mode
 * 
 * Format: [GlobalPrefix]:[X]:[Y]:[VLAN_ID]::[InterfaceID]/64
 * 
 * @param globalPrefix Base prefix (e.g., "2001:3c8:1106:4")
 * @param studentId 8-digit student ID
 * @param vlanId VLAN ID or identifier
 * @param interfaceOffset Interface offset (1, 2, 3, etc.)
 * @returns Full IPv6 address with /64 prefix
 * 
 * @example
 * generateStructuredIPv6("2001:3c8:1106:4", "65070041", "141", 1)
 * // Returns: "2001:3c8:1106:4:6507:41:141::1/64"
 */
export function generateStructuredIPv6(
    globalPrefix: string,
    studentId: string,
    vlanId: string | number,
    interfaceOffset: number
): string {
    const vars = calculateStudentVariables(studentId);

    // Build the address: [GlobalPrefix]:[X]:[Y]:[VLAN]::[offset]/64
    return `${globalPrefix}:${vars.X}:${vars.Y}:${vlanId}::${interfaceOffset}/64`;
}

/**
 * Generate IPv6 address based on lab configuration
 * 
 * Intelligently selects between template mode and structured mode
 * based on the lab's ipv6Config settings.
 * 
 * @param config Lab's IPv6 configuration
 * @param studentId 8-digit student ID
 * @param vlanId VLAN ID or identifier
 * @param interfaceOffset Interface offset
 * @param isManagement Whether this is a management interface
 * @returns Full IPv6 address with prefix length
 */
export function generateIPv6Address(
    config: IPv6LabConfig,
    studentId: string,
    vlanId: string | number,
    interfaceOffset: number,
    isManagement: boolean = false
): string {
    if (!config.enabled) {
        throw new Error('IPv6 is not enabled for this lab');
    }

    // Handle management interface with override
    if (isManagement && config.managementOverride?.enabled) {
        const { generateManagementIPv6Address } = require('./ipv6-management');
        return generateManagementIPv6Address(studentId, config.managementOverride, interfaceOffset);
    }

    // Use management template if available for management interfaces
    if (isManagement && config.managementTemplate) {
        return generateIPv6FromTemplate(config.managementTemplate, studentId, vlanId, interfaceOffset);
    }

    // Use structured mode if configured
    if (config.prefixMode === 'structured' && config.globalPrefix) {
        return generateStructuredIPv6(config.globalPrefix, studentId, vlanId, interfaceOffset);
    }

    // Default: Use template mode
    return generateIPv6FromTemplate(config.template, studentId, vlanId, interfaceOffset);
}

/**
 * Generate a preview of IPv6 addresses for lab wizard display
 * 
 * Shows example addresses for different scenarios to help lecturers
 * understand the addressing scheme.
 * 
 * @param config Lab's IPv6 configuration
 * @param sampleStudentId Sample student ID (default: "65070041")
 * @param vlanIds Sample VLAN IDs
 * @returns Object with preview addresses for various scenarios
 */
export function generateIPv6ConfigPreview(
    config: IPv6LabConfig,
    sampleStudentId: string = '65070041',
    vlanIds: (string | number)[] = ['141', '241']
): {
    vlans: Record<string, string>;
    management?: string;
    studentVariables: StudentIPv6Variables;
} {
    const vars = calculateStudentVariables(sampleStudentId);
    const vlans: Record<string, string> = {};

    // Generate preview for each VLAN
    vlanIds.forEach((vlanId, index) => {
        const key = `VLAN ${vlanId}`;
        try {
            vlans[key] = generateIPv6Address(config, sampleStudentId, vlanId, index + 1, false);
        } catch {
            vlans[key] = 'Configuration error';
        }
    });

    // Generate management preview if override is enabled
    let management: string | undefined;
    if (config.managementOverride?.enabled) {
        try {
            management = generateIPv6Address(config, sampleStudentId, '0', 1, true);
        } catch {
            management = 'Configuration error';
        }
    } else if (config.managementTemplate) {
        try {
            management = generateIPv6FromTemplate(config.managementTemplate, sampleStudentId, 'mgmt', 1);
        } catch {
            management = 'Configuration error';
        }
    }

    return {
        vlans,
        management,
        studentVariables: vars
    };
}

/**
 * Management Network IPv6 Override
 * 
 * Regardless of the global prefix, management network can use a special fixed format
 * to enable firewall traversal and Internet access.
 * 
 * Default Format: 2001:3c8:1106:4306::<Last3DigitsStudentID>/64
 * 
 * This module handles:
 * 1. Generating management IPv6 addresses with fixed prefix
 * 2. Detecting management IPv6 addresses
 * 3. Validating management network configuration
 */

export interface ManagementOverrideConfig {
    enabled: boolean;              // Whether management uses a special fixed format
    fixedPrefix: string;           // e.g., "2001:3c8:1106:4306"
    useStudentIdSuffix: boolean;   // Whether to use last 3 digits as interface ID suffix
}

// Default management network configuration (university network)
export const DEFAULT_MANAGEMENT_CONFIG: ManagementOverrideConfig = {
    enabled: true,
    fixedPrefix: '2001:3c8:1106:4306',
    useStudentIdSuffix: true
};

/**
 * Extract last 3 digits from student ID
 * 
 * @param studentId 8-digit student ID (e.g., "65070041")
 * @returns Last 3 digits as string (e.g., "041")
 */
export function extractLast3Digits(studentId: string): string {
    // Remove any non-numeric characters
    const numericId = studentId.replace(/\D/g, '');
    if (numericId.length < 3) {
        return numericId.padStart(3, '0');
    }
    return numericId.slice(-3);
}

/**
 * Generate Management IPv6 address
 * 
 * Uses the fixed prefix format for firewall traversal.
 * Format: <fixedPrefix>::<interfaceId>/64
 * 
 * @param studentId 8-digit student ID
 * @param config Management override configuration
 * @param interfaceOffset Optional interface offset (1, 2, 3, etc.)
 * @returns Full IPv6 address with /64 prefix
 * 
 * @example
 * // Default: use last 3 digits as interface ID
 * generateManagementIPv6Address("65070041", config)
 * // Returns: "2001:3c8:1106:4306::41/64" (leading zero stripped)
 * 
 * @example
 * // With interface offset
 * generateManagementIPv6Address("65070041", config, 1)
 * // Returns: "2001:3c8:1106:4306::41:1/64"
 */
export function generateManagementIPv6Address(
    studentId: string,
    config: ManagementOverrideConfig = DEFAULT_MANAGEMENT_CONFIG,
    interfaceOffset?: number
): string {
    const fixedPrefix = config.fixedPrefix || DEFAULT_MANAGEMENT_CONFIG.fixedPrefix;

    let interfaceId: string;

    if (config.useStudentIdSuffix) {
        const last3 = extractLast3Digits(studentId);
        // Convert to number and back to remove leading zeros in the final address
        // e.g., "041" -> 41 -> "41"
        const numericLast3 = parseInt(last3, 10);

        if (interfaceOffset && interfaceOffset > 0) {
            // Format: <last3>:<offset> e.g., "41:1"
            interfaceId = `${numericLast3}:${interfaceOffset}`;
        } else {
            // Format: just <last3> e.g., "41"
            interfaceId = numericLast3.toString();
        }
    } else {
        // Without student ID suffix, just use the offset or default to 1
        interfaceId = (interfaceOffset || 1).toString();
    }

    return `${fixedPrefix}::${interfaceId}/64`;
}

/**
 * Generate Management IPv6 address preserving leading zeros
 * 
 * Some networks require the full "041" format instead of "41".
 * 
 * @param studentId 8-digit student ID
 * @param config Management override configuration
 * @param interfaceOffset Optional interface offset
 * @returns Full IPv6 address with preserved leading zeros
 */
export function generateManagementIPv6AddressPreservingZeros(
    studentId: string,
    config: ManagementOverrideConfig = DEFAULT_MANAGEMENT_CONFIG,
    interfaceOffset?: number
): string {
    const fixedPrefix = config.fixedPrefix || DEFAULT_MANAGEMENT_CONFIG.fixedPrefix;
    const last3 = extractLast3Digits(studentId);

    let interfaceId: string;

    if (interfaceOffset && interfaceOffset > 0) {
        interfaceId = `${last3}:${interfaceOffset}`;
    } else {
        interfaceId = last3;
    }

    return `${fixedPrefix}::${interfaceId}/64`;
}

/**
 * Check if an IPv6 address is a management network address
 * 
 * @param address IPv6 address to check
 * @param config Management override configuration
 * @returns true if the address belongs to the management network
 */
export function isManagementIPv6Address(
    address: string,
    config: ManagementOverrideConfig = DEFAULT_MANAGEMENT_CONFIG
): boolean {
    if (!address || !config.enabled) {
        return false;
    }

    const fixedPrefix = config.fixedPrefix || DEFAULT_MANAGEMENT_CONFIG.fixedPrefix;
    const normalizedAddress = address.toLowerCase().split('/')[0];
    const normalizedPrefix = fixedPrefix.toLowerCase();

    // Check if address starts with the management prefix
    return normalizedAddress.startsWith(normalizedPrefix + '::') ||
        normalizedAddress.startsWith(normalizedPrefix + ':');
}

/**
 * Validate management override configuration
 * 
 * @param config Management override configuration to validate
 * @returns Validation result with errors if any
 */
export function validateManagementConfig(config: ManagementOverrideConfig): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
} {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config.enabled) {
        return { isValid: true, errors: [], warnings: ['Management override is disabled'] };
    }

    // Validate fixed prefix format
    if (!config.fixedPrefix) {
        errors.push('Fixed prefix is required when management override is enabled');
    } else {
        // Basic IPv6 prefix validation
        const prefixParts = config.fixedPrefix.split(':');

        // Should have at least 2 parts
        if (prefixParts.length < 2) {
            errors.push('Invalid IPv6 prefix format');
        }

        // Each part should be valid hex (1-4 chars)
        for (const part of prefixParts) {
            if (part && !/^[0-9a-fA-F]{1,4}$/.test(part)) {
                errors.push(`Invalid hexadecimal group in prefix: ${part}`);
                break;
            }
        }

        // Should not end with ::
        if (config.fixedPrefix.endsWith('::')) {
            warnings.push('Fixed prefix should not end with ::');
        }
    }

    return {
        isValid: errors.length === 0,
        errors,
        warnings
    };
}

/**
 * Generate all management network IPv6 addresses for a student's devices
 * 
 * @param studentId Student ID
 * @param deviceCount Number of devices with management interfaces
 * @param config Management override configuration
 * @returns Array of management IPv6 addresses
 */
export function generateAllManagementAddresses(
    studentId: string,
    deviceCount: number,
    config: ManagementOverrideConfig = DEFAULT_MANAGEMENT_CONFIG
): string[] {
    const addresses: string[] = [];

    for (let i = 0; i < deviceCount; i++) {
        // First device gets no offset, subsequent devices get offset 1, 2, 3...
        const offset = i === 0 ? undefined : i;
        addresses.push(generateManagementIPv6Address(studentId, config, offset));
    }

    return addresses;
}

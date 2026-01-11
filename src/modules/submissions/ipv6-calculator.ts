/**
 * IPv6 Address Calculation Utilities
 * Implements IPv6 generation algorithm for NetGrader
 *
 * Format: 2001:<VLAN_Alphabet><VLAN_Number>:<Last3DigitsStudentID>::<InterfaceIdentifier>/64
 *
 * Examples:
 * - Student 65071041, VLAN A (ID 210), Interface offset 1:
 *   2001:A210:041::1/64
 *
 * - Student 65070232, VLAN B (ID 117), SLAAC-provided:
 *   2001:B117:232::<SLAAC_Interface_ID>/64
 */

import { ILab } from '../labs/model';

/**
 * Get VLAN alphabet letter from index (A=0, B=1, C=2, etc.)
 */
export function getVlanAlphabet(vlanIndex: number): string {
    if (vlanIndex < 0 || vlanIndex > 25) {
        throw new Error(`Invalid VLAN index: ${vlanIndex}. Must be between 0 and 25.`);
    }
    return String.fromCharCode(65 + vlanIndex); // 65 = 'A'
}

/**
 * Get last 3 digits of student ID (no zero-padding)
 */
export function getLast3DigitsStudentId(studentId: string): string {
    const numericId = studentId.replace(/\D/g, '');
    if (numericId.length < 3) {
        return numericId;
    }
    return numericId.slice(-3);
}

/**
 * Generate student IPv6 prefix based on VLAN configuration
 * Format: 2001:<VLAN_Alphabet><VLAN_Number>:<Last3DigitsStudentID>::
 *
 * @param studentId - Student ID (e.g., "65071041")
 * @param vlanAlphabet - VLAN alphabet letter (A, B, C, etc.)
 * @param vlanId - Calculated VLAN ID (same as IPv4, e.g., 210)
 * @returns IPv6 prefix without interface identifier (e.g., "2001:A210:041::")
 */
export function generateStudentIPv6Prefix(
    studentId: string,
    vlanAlphabet: string,
    vlanId: number
): string {
    const last3Digits = getLast3DigitsStudentId(studentId);
    return `2001:${vlanAlphabet}${vlanId}:${last3Digits}::`;
}

/**
 * Generate full IPv6 address with interface identifier
 *
 * @param prefix - IPv6 prefix (e.g., "2001:A210:041::")
 * @param interfaceId - Interface identifier (e.g., "1", "2", "fe80::1")
 * @returns Full IPv6 address with /64 prefix length
 */
export function generateFullIPv6(prefix: string, interfaceId: string): string {
    // Remove trailing :: if present to avoid double colons
    const cleanPrefix = prefix.replace(/::$/, '');
    return `${cleanPrefix}::${interfaceId}/64`;
}

/**
 * Generate student IPv6 address for a specific VLAN
 *
 * @param studentId - Student ID
 * @param vlanIndex - VLAN index (0-based)
 * @param vlanId - Calculated VLAN ID
 * @param interfaceId - Interface identifier (lecturer-defined or SLAAC)
 * @returns Full IPv6 address with /64 prefix
 */
export function generateStudentIPv6Address(
    studentId: string,
    vlanIndex: number,
    vlanId: number,
    interfaceId: string
): string {
    const vlanAlphabet = getVlanAlphabet(vlanIndex);
    const prefix = generateStudentIPv6Prefix(studentId, vlanAlphabet, vlanId);
    return generateFullIPv6(prefix, interfaceId);
}

/**
 * Validate IPv6 address format (supports both full and compressed formats)
 *
 * @param address - IPv6 address to validate
 * @returns true if valid IPv6 format
 */
export function validateIPv6Address(address: string): boolean {
    if (!address) return false;

    // Remove prefix length if present
    const addressPart = address.split('/')[0];

    // Full IPv6 regex (8 groups of 4 hex chars)
    const fullIPv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;

    // Compressed IPv6 regex (handles :: compression)
    const compressedIPv6Regex = /^(([0-9a-fA-F]{1,4}:){0,7}[0-9a-fA-F]{1,4})?::?(([0-9a-fA-F]{1,4}:){0,7}[0-9a-fA-F]{1,4})?$/;

    // Loopback
    if (addressPart === '::1') return true;

    // Unspecified
    if (addressPart === '::') return true;

    return fullIPv6Regex.test(addressPart) || compressedIPv6Regex.test(addressPart);
}

/**
 * Check if IPv6 address is a link-local address (starts with fe80::)
 */
export function isLinkLocalAddress(address: string): boolean {
    if (!address) return false;
    const normalizedAddress = address.toLowerCase().split('/')[0];
    return normalizedAddress.startsWith('fe80:');
}

/**
 * Expand compressed IPv6 address to full format for comparison
 *
 * @param address - IPv6 address (compressed or full)
 * @returns Expanded IPv6 address in lowercase
 */
export function expandIPv6Address(address: string): string {
    if (!address) return '';

    // Remove prefix length
    const [addressPart, prefixLength] = address.split('/');

    // Handle :: compression
    const parts = addressPart.split('::');
    let groups: string[];

    if (parts.length === 2) {
        const left = parts[0] ? parts[0].split(':') : [];
        const right = parts[1] ? parts[1].split(':') : [];
        const fillCount = 8 - left.length - right.length;
        const fill = Array(fillCount).fill('0000');
        groups = [...left, ...fill, ...right];
    } else {
        groups = addressPart.split(':');
    }

    // Pad each group to 4 characters
    const expandedGroups = groups.map(g => g.padStart(4, '0').toLowerCase());

    return expandedGroups.join(':');
}

/**
 * Compare two IPv6 addresses for equality (handles compression)
 *
 * @param addr1 - First IPv6 address
 * @param addr2 - Second IPv6 address
 * @returns true if addresses are equal
 */
export function compareIPv6Addresses(addr1: string, addr2: string): boolean {
    if (!addr1 || !addr2) return false;

    // Remove prefix length for comparison
    const clean1 = addr1.split('/')[0];
    const clean2 = addr2.split('/')[0];

    // Compare expanded forms
    return expandIPv6Address(clean1) === expandIPv6Address(clean2);
}

/**
 * Validate IPv6 prefix length
 *
 * @param length - Prefix length (e.g., 64)
 * @returns true if valid prefix length
 */
export function validatePrefixLength(length: number): boolean {
    return Number.isInteger(length) && length >= 0 && length <= 128;
}

/**
 * Generate link-local address for an interface
 * Format: fe80::<interface_id>
 */
export function generateLinkLocalAddress(interfaceId: string): string {
    return `fe80::${interfaceId}`;
}

/**
 * Generate IPv6 mappings for all VLAN interfaces in a lab
 * Similar to IPv4 generateIPMappings but for IPv6
 */
export function generateIPv6Mappings(
    lab: ILab,
    studentId: string,
    vlanMappings: Record<string, number>
): Record<string, { ipv6: string; vlan: number | null }> {
    const mappings: Record<string, { ipv6: string; vlan: number | null }> = {};

    for (const device of lab.network.devices) {
        for (const ipVar of device.ipVariables) {
            // Skip if not an IPv6 variable
            if (!ipVar.isIpv6Variable && !ipVar.ipv6InputType) continue;

            let ipv6: string | null = null;
            let vlanId: number | null = null;

            // Handle different IPv6 input types
            if (ipVar.ipv6InputType === 'fullIPv6' && ipVar.fullIpv6) {
                ipv6 = ipVar.fullIpv6;
            } else if (ipVar.ipv6InputType === 'linkLocal') {
                const interfaceId = ipVar.ipv6InterfaceId || '1';
                ipv6 = generateLinkLocalAddress(interfaceId);
            } else if (ipVar.ipv6InputType?.startsWith('studentVlan6_')) {
                // Extract VLAN index from type (studentVlan6_0 -> 0)
                const vlanIndex = parseInt(ipVar.ipv6InputType.replace('studentVlan6_', ''), 10);
                if (!isNaN(vlanIndex)) {
                    const vlanKey = `vlan${vlanIndex}`;
                    vlanId = vlanMappings[vlanKey] ?? null;

                    const vlanConfig = lab.network.vlanConfiguration?.vlans?.[vlanIndex];
                    if (vlanConfig && vlanId !== null) {
                        const interfaceId = ipVar.ipv6InterfaceId || '1';
                        ipv6 = generateStudentIPv6Address(studentId, vlanIndex, vlanId, interfaceId);
                    }
                }
            }

            if (ipv6) {
                const key = `${device.deviceId}.${ipVar.name}_ipv6`;
                mappings[key] = { ipv6, vlan: vlanId };
            }
        }
    }

    return mappings;
}

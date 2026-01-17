/**
 * Subnet Calculation Validators
 * Provides validation functions for subnet calculation question types
 * Used for grading fill-in-blank answers in Large Subnet Mode
 */

/**
 * Parse an IP address into its numeric representation
 */
export function ipToNumber(ip: string): number {
    const octets = ip.split('.').map(Number);
    if (octets.length !== 4 || octets.some(o => isNaN(o) || o < 0 || o > 255)) {
        return NaN;
    }
    return (octets[0] << 24) + (octets[1] << 16) + (octets[2] << 8) + octets[3];
}

/**
 * Convert a numeric representation to an IP address
 */
export function numberToIp(num: number): string {
    return [
        (num >>> 24) & 0xFF,
        (num >>> 16) & 0xFF,
        (num >>> 8) & 0xFF,
        num & 0xFF
    ].join('.');
}

/**
 * Validate IPv4 address format
 */
export function isValidIPv4(ip: string): boolean {
    const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    return ipRegex.test(ip);
}

/**
 * Validate CIDR notation (e.g., "10.0.2.0/26")
 * Returns both validation result and parsed components
 */
export function validateCIDRNotation(cidr: string): {
    isValid: boolean;
    networkAddress?: string;
    prefixLength?: number;
    error?: string;
} {
    const match = cidr.trim().match(/^(.+)\/(\d+)$/);

    if (!match) {
        return { isValid: false, error: 'Invalid CIDR format. Expected format: x.x.x.x/n' };
    }

    const [, ip, prefixStr] = match;
    const prefix = parseInt(prefixStr, 10);

    if (!isValidIPv4(ip)) {
        return { isValid: false, error: 'Invalid IP address in CIDR notation' };
    }

    if (prefix < 0 || prefix > 32) {
        return { isValid: false, error: 'Prefix length must be between 0 and 32' };
    }

    // Verify the IP is actually a network address for this prefix
    const ipNum = ipToNumber(ip);
    const mask = (~((1 << (32 - prefix)) - 1)) >>> 0;
    const networkNum = (ipNum & mask) >>> 0;

    if (ipNum !== networkNum) {
        return {
            isValid: false,
            error: `${ip} is not a valid network address for /${prefix}. Network address would be ${numberToIp(networkNum)}`
        };
    }

    return {
        isValid: true,
        networkAddress: ip,
        prefixLength: prefix
    };
}

/**
 * Validate dotted decimal subnet mask (e.g., "255.255.255.192")
 */
export function validateDottedSubnetMask(mask: string): {
    isValid: boolean;
    prefixLength?: number;
    error?: string;
} {
    if (!isValidIPv4(mask)) {
        return { isValid: false, error: 'Invalid subnet mask format' };
    }

    const maskNum = ipToNumber(mask) >>> 0;

    // Check if this is a valid subnet mask (continuous 1s followed by 0s)
    // Valid mask in binary: 11111111.11111111.11111100.00000000
    let prefix = 0;
    let foundZero = false;

    for (let i = 31; i >= 0; i--) {
        const bit = (maskNum >> i) & 1;
        if (bit === 1) {
            if (foundZero) {
                return { isValid: false, error: 'Invalid subnet mask: non-contiguous 1 bits' };
            }
            prefix++;
        } else {
            foundZero = true;
        }
    }

    return {
        isValid: true,
        prefixLength: prefix
    };
}

/**
 * Validate wildcard/inverse mask (e.g., "0.0.0.63")
 */
export function validateWildcardMask(mask: string): {
    isValid: boolean;
    prefixLength?: number;
    error?: string;
} {
    if (!isValidIPv4(mask)) {
        return { isValid: false, error: 'Invalid wildcard mask format' };
    }

    const maskNum = ipToNumber(mask) >>> 0;

    // Wildcard is inverse of subnet mask - should be continuous 0s followed by 1s
    let hostBits = 0;
    let foundOne = false;

    for (let i = 0; i <= 31; i++) {
        const bit = (maskNum >> i) & 1;
        if (bit === 1) {
            if (!foundOne) {
                foundOne = true;
            }
            hostBits++;
        } else {
            if (foundOne) {
                return { isValid: false, error: 'Invalid wildcard mask: non-contiguous bits' };
            }
        }
    }

    return {
        isValid: true,
        prefixLength: 32 - hostBits
    };
}

/**
 * Convert prefix length to dotted decimal subnet mask
 */
export function prefixToDottedMask(prefix: number): string {
    if (prefix < 0 || prefix > 32) {
        throw new Error('Prefix must be between 0 and 32');
    }
    const mask = (~((1 << (32 - prefix)) - 1)) >>> 0;
    return numberToIp(mask);
}

/**
 * Convert prefix length to wildcard mask
 */
export function prefixToWildcardMask(prefix: number): string {
    if (prefix < 0 || prefix > 32) {
        throw new Error('Prefix must be between 0 and 32');
    }
    const wildcard = ((1 << (32 - prefix)) - 1) >>> 0;
    return numberToIp(wildcard);
}

/**
 * Calculate network address from IP and prefix
 */
export function calculateNetworkAddress(ip: string, prefix: number): string {
    const ipNum = ipToNumber(ip);
    if (isNaN(ipNum)) {
        throw new Error('Invalid IP address');
    }
    const mask = (~((1 << (32 - prefix)) - 1)) >>> 0;
    return numberToIp((ipNum & mask) >>> 0);
}

/**
 * Calculate broadcast address from network address and prefix
 */
export function calculateBroadcastAddress(networkAddress: string, prefix: number): string {
    const netNum = ipToNumber(networkAddress);
    if (isNaN(netNum)) {
        throw new Error('Invalid network address');
    }
    const hostBits = (1 << (32 - prefix)) - 1;
    return numberToIp((netNum | hostBits) >>> 0);
}

/**
 * Validate that a network address is correct for a given CIDR block within a parent subnet
 * Used for validating student subnet calculations
 * 
 * @param studentAnswer - The student's network address answer
 * @param parentNetwork - The parent network address (student's allocated large subnet)
 * @param parentPrefix - The parent subnet prefix (e.g., 23)
 * @param expectedSubnetPrefix - The expected sub-subnet prefix (e.g., 26)
 * @param subnetIndex - Which subnet block (1-based)
 */
export function validateSubVlanNetworkAddress(
    studentAnswer: string,
    parentNetwork: string,
    parentPrefix: number,
    expectedSubnetPrefix: number,
    subnetIndex: number
): {
    isCorrect: boolean;
    expectedAnswer: string;
    error?: string;
} {
    // Calculate the expected network address
    const parentNum = ipToNumber(parentNetwork);
    if (isNaN(parentNum)) {
        return { isCorrect: false, expectedAnswer: '', error: 'Invalid parent network' };
    }

    // Calculate the sub-subnet block size
    const subnetBlockSize = Math.pow(2, 32 - expectedSubnetPrefix);

    // Calculate expected network address (subnetIndex is 1-based)
    const expectedNum = parentNum + ((subnetIndex - 1) * subnetBlockSize);
    const expectedAnswer = numberToIp(expectedNum >>> 0);

    // Validate student answer format
    if (!isValidIPv4(studentAnswer)) {
        return { isCorrect: false, expectedAnswer, error: 'Invalid IP address format' };
    }

    // Check if answer matches
    const studentNum = ipToNumber(studentAnswer);
    const isCorrect = (studentNum >>> 0) === (expectedNum >>> 0);

    return {
        isCorrect,
        expectedAnswer
    };
}

/**
 * Grade a subnet calculation answer based on question type
 */
export function gradeSubnetCalculationAnswer(
    questionType: string,
    studentAnswer: string,
    expectedAnswer: string,
    options?: {
        caseSensitive?: boolean;
        trimWhitespace?: boolean;
    }
): {
    isCorrect: boolean;
    normalizedStudentAnswer: string;
    normalizedExpectedAnswer: string;
    error?: string;
} {
    const trim = options?.trimWhitespace ?? true;
    const caseSensitive = options?.caseSensitive ?? false;

    let normalizedStudent = trim ? studentAnswer.trim() : studentAnswer;
    let normalizedExpected = trim ? expectedAnswer.trim() : expectedAnswer;

    if (!caseSensitive) {
        normalizedStudent = normalizedStudent.toLowerCase();
        normalizedExpected = normalizedExpected.toLowerCase();
    }

    switch (questionType) {
        case 'cidr_notation': {
            // Validate both are valid CIDR
            const studentCIDR = validateCIDRNotation(normalizedStudent);
            const expectedCIDR = validateCIDRNotation(normalizedExpected);

            if (!studentCIDR.isValid) {
                return {
                    isCorrect: false,
                    normalizedStudentAnswer: normalizedStudent,
                    normalizedExpectedAnswer: normalizedExpected,
                    error: studentCIDR.error
                };
            }

            // Compare network address and prefix
            const isCorrect = studentCIDR.networkAddress === expectedCIDR.networkAddress &&
                studentCIDR.prefixLength === expectedCIDR.prefixLength;

            return {
                isCorrect,
                normalizedStudentAnswer: normalizedStudent,
                normalizedExpectedAnswer: normalizedExpected
            };
        }

        case 'dotted_subnet_mask': {
            // Validate and compare subnet masks
            const studentMask = validateDottedSubnetMask(normalizedStudent);
            const expectedMask = validateDottedSubnetMask(normalizedExpected);

            if (!studentMask.isValid) {
                return {
                    isCorrect: false,
                    normalizedStudentAnswer: normalizedStudent,
                    normalizedExpectedAnswer: normalizedExpected,
                    error: studentMask.error
                };
            }

            return {
                isCorrect: studentMask.prefixLength === expectedMask.prefixLength,
                normalizedStudentAnswer: normalizedStudent,
                normalizedExpectedAnswer: normalizedExpected
            };
        }

        case 'wildcard_mask': {
            const studentWildcard = validateWildcardMask(normalizedStudent);
            const expectedWildcard = validateWildcardMask(normalizedExpected);

            if (!studentWildcard.isValid) {
                return {
                    isCorrect: false,
                    normalizedStudentAnswer: normalizedStudent,
                    normalizedExpectedAnswer: normalizedExpected,
                    error: studentWildcard.error
                };
            }

            return {
                isCorrect: studentWildcard.prefixLength === expectedWildcard.prefixLength,
                normalizedStudentAnswer: normalizedStudent,
                normalizedExpectedAnswer: normalizedExpected
            };
        }

        case 'subnet_prefix_length': {
            // Compare as numbers
            const studentPrefix = parseInt(normalizedStudent, 10);
            const expectedPrefix = parseInt(normalizedExpected, 10);

            if (isNaN(studentPrefix) || studentPrefix < 0 || studentPrefix > 32) {
                return {
                    isCorrect: false,
                    normalizedStudentAnswer: normalizedStudent,
                    normalizedExpectedAnswer: normalizedExpected,
                    error: 'Prefix length must be a number between 0 and 32'
                };
            }

            return {
                isCorrect: studentPrefix === expectedPrefix,
                normalizedStudentAnswer: normalizedStudent,
                normalizedExpectedAnswer: normalizedExpected
            };
        }

        case 'network_address':
        case 'subnet_calculation_network':
        case 'broadcast_address':
        case 'first_usable_ip':
        case 'last_usable_ip':
        case 'ip_address': {
            // Validate IP format and compare
            if (!isValidIPv4(normalizedStudent)) {
                return {
                    isCorrect: false,
                    normalizedStudentAnswer: normalizedStudent,
                    normalizedExpectedAnswer: normalizedExpected,
                    error: 'Invalid IP address format'
                };
            }

            // Compare IP addresses numerically to handle leading zeros etc.
            const studentNum = ipToNumber(normalizedStudent);
            const expectedNum = ipToNumber(normalizedExpected);

            return {
                isCorrect: studentNum === expectedNum,
                normalizedStudentAnswer: normalizedStudent,
                normalizedExpectedAnswer: normalizedExpected
            };
        }

        default:
            // For unknown types, do simple string comparison
            return {
                isCorrect: normalizedStudent === normalizedExpected,
                normalizedStudentAnswer: normalizedStudent,
                normalizedExpectedAnswer: normalizedExpected
            };
    }
}

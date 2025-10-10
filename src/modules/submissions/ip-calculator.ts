/**
 * IP and VLAN Calculation Utilities
 * Implements algorithms from IP_VLAN_GENERATION_ALGORITHMS.md
 *
 * IMPORTANT: These algorithms must match frontend implementation exactly
 * for grading accuracy
 */

import { ILab } from '../labs/model';

/**
 * Calculate IP using Student ID-Based algorithm
 * From: IP_VLAN_GENERATION_ALGORITHMS.md lines 172-338
 *
 * Algorithm:
 * 1. subnetOffset = studentIdNum % 100
 * 2. thirdOctet = (baseOctet3 + floor(subnetOffset / 10)) % 256
 * 3. fourthOctet = min(254, (subnetOffset % 10) * 10 + interfaceOffset)
 *
 * @example
 * calculateStudentIdBasedIP("192.168.1.0", "61071234", 5)
 * // Returns: "192.168.4.45"
 */
export function calculateStudentIdBasedIP(
  baseNetwork: string,
  studentId: string,
  interfaceOffset: number
): string {
  // Step 1: Parse student ID to number
  const studentIdNum = parseInt(studentId);

  if (isNaN(studentIdNum)) {
    throw new Error(`Invalid student ID: ${studentId}`);
  }

  // Step 2: Calculate subnet offset (last 2 digits)
  const subnetOffset = studentIdNum % 100;

  // Step 3: Parse base network
  const baseNetworkParts = baseNetwork.split('.').map(Number);

  if (baseNetworkParts.length !== 4) {
    throw new Error(`Invalid base network: ${baseNetwork}`);
  }

  // Step 4: Calculate student-specific subnet
  const studentSubnet = [...baseNetworkParts];

  // Third octet: add tens digit of last 2 digits, use modulo for overflow
  studentSubnet[2] = (baseNetworkParts[2] + Math.floor(subnetOffset / 10)) % 256;

  // Step 5: Calculate host number
  const hostNumber = (subnetOffset % 10) * 10 + interfaceOffset;
  studentSubnet[3] = Math.min(254, hostNumber);

  // Step 6: Join octets
  return studentSubnet.join('.');
}

/**
 * Calculate IP using Advanced Student-Specific algorithm (VLAN-specific)
 * From: IP_VLAN_GENERATION_ALGORITHMS.md lines 573-604
 *
 * Used for complex lab scenarios with calculated VLANs
 *
 * Algorithm:
 * 1. dec2 = floor((studentId/1000000 - 61) * 10 + (studentId % 1000) / 250)
 * 2. dec3 = floor((studentId % 1000) % 250)
 * 3. For calculated VLANs: dec3 = floor((dec3 + calculatedVlanId) % 250)
 * 4. IP = vlanOct1.dec2.dec3.(64 + interfaceOffset)
 *
 * @example
 * // VLAN with multiplier 400:
 * calculateAdvancedStudentIP("61071234", {baseNetwork: "172.16.0.0", calculationMultiplier: 400}, 2)
 * // Returns: "172.1.246.66"
 */
export function calculateAdvancedStudentIP(
  studentId: string,
  vlanConfig: {
    baseNetwork: string;
    calculationMultiplier?: number;
  },
  interfaceOffset: number
): string {
  const student_id = Number(studentId);

  if (isNaN(student_id)) {
    throw new Error(`Invalid student ID: ${studentId}`);
  }

  // Calculate dec2 (second octet for 172.x.x.x)
  const dec2_1 = (student_id / 1000000 - 61) * 10;
  const dec2_2 = (student_id % 1000) / 250;
  let dec2 = Math.floor(dec2_1 + dec2_2);

  // Calculate dec3 (third octet)
  let dec3 = Math.floor((student_id % 1000) % 250);

  // For calculated VLANs with multipliers, modify dec3 for uniqueness
  if (vlanConfig.calculationMultiplier !== undefined) {
    const calculatedVlanId = Math.floor(
      (student_id / 1000000 - 61) * vlanConfig.calculationMultiplier + (student_id % 1000)
    );

    // Modify dec3 for uniqueness (spec line 593)
    dec3 = Math.floor((dec3 + calculatedVlanId) % 250);
  }

  // Get first octet from VLAN base network
  const [vlanOct1] = vlanConfig.baseNetwork.split('.').map(Number);

  // Base VLAN IP starts at .64, then add interface offset
  const hostAddress = 64 + interfaceOffset;

  return `${vlanOct1}.${dec2}.${dec3}.${hostAddress}`;
}

/**
 * Calculate VLAN IDs using Student ID-Based algorithm
 * From: IP_VLAN_GENERATION_ALGORITHMS.md lines 367-436
 *
 * Algorithm:
 * - baseVLAN = (studentIdNum % 100) + 100
 * - vlans = [baseVLAN, baseVLAN + 100, baseVLAN + 200, ...]
 *
 * @example
 * calculateStudentVLANs("61071234", 3)
 * // Returns: [134, 234, 334]
 */
export function calculateStudentVLANs(
  studentId: string,
  vlanCount: number
): number[] {
  const studentIdNum = parseInt(studentId);

  if (isNaN(studentIdNum)) {
    throw new Error(`Invalid student ID: ${studentId}`);
  }

  const baseVLAN = (studentIdNum % 100) + 100;
  const vlans: number[] = [];

  for (let i = 0; i < vlanCount; i++) {
    vlans.push(baseVLAN + (i * 100));
  }

  return vlans;
}

/**
 * Calculate advanced student-specific values (dec2, dec3, vlan1, vlan2)
 * Used for generating complete network data
 * From: IP_VLAN_GENERATION_ALGORITHMS.md lines 452-507
 *
 * @example
 * calculateStudentNetworkValues("61071234")
 * // Returns: { dec2: 1, dec3: 234, vlan1: 262, vlan2: 269 }
 */
export function calculateStudentNetworkValues(studentId: string): {
  dec2: number;
  dec3: number;
  vlan1: number;
  vlan2: number;
} {
  const student_id = Number(studentId);

  if (isNaN(student_id)) {
    throw new Error(`Invalid student ID: ${studentId}`);
  }

  // Calculate dec2
  let dec2_1: number = (student_id / 1000000 - 61) * 10;
  let dec2_2: number = (student_id % 1000) / 250;
  let dec2: number = dec2_1 + dec2_2;
  dec2 = Math.floor(dec2);

  // Calculate dec3
  let dec3: number = (student_id % 1000) % 250;
  dec3 = Math.floor(dec3);

  // Calculate VLAN IDs
  let vlan1: number = (student_id / 1000000 - 61) * 400 + (student_id % 1000);
  let vlan2: number = (student_id / 1000000 - 61) * 500 + (student_id % 1000);
  vlan1 = Math.floor(vlan1);
  vlan2 = Math.floor(vlan2);

  return { dec2, dec3, vlan1, vlan2 };
}

/**
 * Validate IP address format
 */
export function validateIPAddress(ip: string): boolean {
  const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipPattern.test(ip)) return false;

  const octets = ip.split('.').map(Number);
  return octets.every(octet => octet >= 0 && octet <= 255);
}

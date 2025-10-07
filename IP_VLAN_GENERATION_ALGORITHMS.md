# IP and VLAN Generation Algorithms

## Overview

This document provides a comprehensive specification of the IP address and VLAN generation algorithms used in the NetGrader frontend. The backend MUST implement these exact algorithms before submitting grading queues to the grading service to ensure IP addresses match exactly what students see.

**Critical:** These algorithms are deterministic and must produce identical results across frontend and backend to ensure grading accuracy.

---

## Table of Contents

1. [IP Generation Strategies](#ip-generation-strategies)
2. [Group-Based IP Generation](#group-based-ip-generation)
3. [Student ID-Based IP Generation](#student-id-based-ip-generation)
4. [VLAN Generation Algorithm](#vlan-generation-algorithm)
5. [Student-Specific IP Generation (Advanced)](#student-specific-ip-generation-advanced)
6. [Network Validation Utilities](#network-validation-utilities)
7. [Implementation Examples](#implementation-examples)

---

## IP Generation Strategies

The system supports two primary IP generation strategies:

| Strategy | Use Case | Requires Groups | Supports Exams | Description |
|----------|----------|-----------------|----------------|-------------|
| `group_based` | Labs with group work | ✅ Yes | ❌ No | Generates IPs based on group numbers |
| `student_id_based` | Individual exams | ❌ No | ✅ Yes | Generates IPs based on student ID |

**Strategy Selection Logic:**
- If students have `groupNumber` defined → use `group_based`
- If students do NOT have `groupNumber` → use `student_id_based`

---

## Group-Based IP Generation

### Algorithm Description

Group-based generation assigns IP addresses by modifying the third octet based on the group number. All students in the same group share the same subnet.

### Input Parameters

```typescript
interface GroupBasedInput {
  baseNetwork: string;      // e.g., "10.30.6.0"
  subnetMask: number;        // e.g., 24
  groupNumber: number;       // Student's group number (1, 2, 3, ...)
  hostOffset: number;        // Device-specific offset (1-254)
}
```

### Algorithm Steps

```
Step 1: Parse base network into octets
  baseNetworkParts = baseNetwork.split('.').map(Number)
  // Example: "10.30.6.0" → [10, 30, 6, 0]

Step 2: Calculate group subnet
  groupSubnet[0] = baseNetworkParts[0]  // First octet unchanged
  groupSubnet[1] = baseNetworkParts[1]  // Second octet unchanged
  groupSubnet[2] = baseNetworkParts[2] + groupNumber  // Add group number to third octet
  groupSubnet[3] = hostOffset            // Host offset becomes fourth octet

Step 3: Validate subnet doesn't exceed 255
  if groupSubnet[2] > 255:
    ERROR: "Group subnet exceeds valid IP range"

Step 4: Join octets to create final IP
  ipAddress = groupSubnet.join('.')
```

### Examples

**Example 1: Group 1, Device with hostOffset 10**
```
Input:
  - baseNetwork: "10.30.6.0"
  - subnetMask: 24
  - groupNumber: 1
  - hostOffset: 10

Calculation:
  groupSubnet = [10, 30, 6+1, 10]
               = [10, 30, 7, 10]

Output: "10.30.7.10"
```

**Example 2: Group 5, Device with hostOffset 1**
```
Input:
  - baseNetwork: "192.168.1.0"
  - subnetMask: 24
  - groupNumber: 5
  - hostOffset: 1

Calculation:
  groupSubnet = [192, 168, 1+5, 1]
               = [192, 168, 6, 1]

Output: "192.168.6.1"
```

**Example 3: Multiple devices, same group**
```
Input:
  - baseNetwork: "10.30.6.0"
  - groupNumber: 2
  - Device 1 hostOffset: 1
  - Device 2 hostOffset: 2
  - Device 3 hostOffset: 10

Output:
  - Device 1: "10.30.8.1"
  - Device 2: "10.30.8.2"
  - Device 3: "10.30.8.10"
```

### Edge Cases

1. **Group number causes third octet to exceed 255**
   - ERROR: "Group subnet exceeds valid IP range"
   - Maximum safe group number = 255 - base third octet

2. **hostOffset outside 1-254 range**
   - ERROR: "Invalid host offset: must be between 1 and 254"

3. **Students without group numbers**
   - ERROR: "Group-based generation requires all students to have group assignments"

### TypeScript Implementation Reference

```typescript
// From: composables/useIPGeneration.ts (lines 46-134)
function generateGroupBasedIPs(
  students: StudentCSVRow[],
  networkConfig: NetworkConfig,
  deviceConfigs: DeviceConfig[],
  networkInfo: any
): IPGenerationResult {
  const baseNetworkParts = networkConfig.baseNetwork.split('.').map(Number);

  for (const [groupNumber, groupStudents] of groups) {
    // Calculate group subnet
    const groupSubnet = [...baseNetworkParts];
    groupSubnet[2] = baseNetworkParts[2] + groupNumber;

    // Validate
    if (groupSubnet[2] > 255) {
      errors.push(`Group ${groupNumber} subnet exceeds valid IP range`);
      continue;
    }

    // Generate IPs for each device
    deviceConfigs.forEach(deviceConfig => {
      const deviceIP = [...groupSubnet];
      deviceIP[3] = deviceConfig.hostOffset;
      const ipAddress = deviceIP.join('.');

      // Store assignment...
    });
  }
}
```

---

## Student ID-Based IP Generation

### Algorithm Description

Student ID-based generation creates unique IP addresses for each student based on their student ID. This ensures each student gets a personalized network topology for exams.

### Input Parameters

```typescript
interface StudentIdBasedInput {
  baseNetwork: string;      // e.g., "192.168.1.0"
  subnetMask: number;        // e.g., 24
  studentId: string;         // e.g., "61071234"
  hostOffset: number;        // Device-specific offset (1-254)
}
```

### Algorithm Steps

```
Step 1: Parse student ID to number
  studentIdNum = parseInt(studentId)

Step 2: Calculate subnet offset (last 2 digits of student ID)
  subnetOffset = studentIdNum % 100
  // Example: 61071234 % 100 = 34

Step 3: Parse base network
  baseNetworkParts = baseNetwork.split('.').map(Number)

Step 4: Calculate student-specific subnet
  studentSubnet[0] = baseNetworkParts[0]  // First octet unchanged
  studentSubnet[1] = baseNetworkParts[1]  // Second octet unchanged
  studentSubnet[2] = (baseNetworkParts[2] + Math.floor(subnetOffset / 10)) % 256
  // Third octet modified by tens digit of last 2 digits

Step 5: Calculate host number
  hostNumber = (subnetOffset % 10) * 10 + hostOffset
  studentSubnet[3] = Math.min(254, hostNumber)  // Ensure valid host range

Step 6: Join octets
  ipAddress = studentSubnet.join('.')
```

### Mathematical Formula

For a student ID `S` and device hostOffset `H`:

```
subnetOffset = S % 100
thirdOctet = (baseOctet3 + floor(subnetOffset / 10)) % 256
fourthOctet = min(254, (subnetOffset % 10) * 10 + H)

IP = baseOctet1.baseOctet2.thirdOctet.fourthOctet
```

### Examples

**Example 1: Student ID 61071234, hostOffset 5**
```
Input:
  - baseNetwork: "192.168.1.0"
  - studentId: "61071234"
  - hostOffset: 5

Calculation:
  studentIdNum = 61071234
  subnetOffset = 61071234 % 100 = 34

  thirdOctet = (1 + floor(34 / 10)) % 256
             = (1 + 3) % 256
             = 4

  fourthOctet = min(254, (34 % 10) * 10 + 5)
              = min(254, 4 * 10 + 5)
              = min(254, 45)
              = 45

Output: "192.168.4.45"
```

**Example 2: Student ID 61071099, hostOffset 10**
```
Input:
  - baseNetwork: "10.0.0.0"
  - studentId: "61071099"
  - hostOffset: 10

Calculation:
  subnetOffset = 61071099 % 100 = 99

  thirdOctet = (0 + floor(99 / 10)) % 256
             = (0 + 9) % 256
             = 9

  fourthOctet = min(254, (99 % 10) * 10 + 10)
              = min(254, 9 * 10 + 10)
              = min(254, 100)
              = 100

Output: "10.0.9.100"
```

**Example 3: Multiple devices, same student**
```
Input:
  - baseNetwork: "172.16.0.0"
  - studentId: "61071050"
  - Device 1 hostOffset: 1
  - Device 2 hostOffset: 2
  - Device 3 hostOffset: 10

Calculation:
  subnetOffset = 50
  thirdOctet = (0 + floor(50 / 10)) % 256 = 5

  Device 1 fourthOctet = (50 % 10) * 10 + 1 = 0 * 10 + 1 = 1
  Device 2 fourthOctet = (50 % 10) * 10 + 2 = 0 * 10 + 2 = 2
  Device 3 fourthOctet = (50 % 10) * 10 + 10 = 0 * 10 + 10 = 10

Output:
  - Device 1: "172.16.5.1"
  - Device 2: "172.16.5.2"
  - Device 3: "172.16.5.10"
```

### Edge Cases

1. **Fourth octet exceeds 254**
   - Apply `Math.min(254, calculatedValue)` to cap at 254

2. **Third octet overflow**
   - Use modulo 256: `(baseOctet + offset) % 256`

3. **Invalid student ID**
   - If `parseInt(studentId)` returns NaN, throw error

### TypeScript Implementation Reference

```typescript
// From: composables/useIPGeneration.ts (lines 136-201)
function generateStudentBasedIPs(
  students: StudentCSVRow[],
  networkConfig: NetworkConfig,
  deviceConfigs: DeviceConfig[],
  networkInfo: any
): IPGenerationResult {
  students.forEach((student, index) => {
    const studentIdNum = parseInt(student.studentId);
    const subnetOffset = studentIdNum % 100;

    const baseNetworkParts = networkConfig.baseNetwork.split('.').map(Number);
    const studentSubnet = [...baseNetworkParts];

    studentSubnet[2] = (baseNetworkParts[2] + Math.floor(subnetOffset / 10)) % 256;

    deviceConfigs.forEach(deviceConfig => {
      const deviceIP = [...studentSubnet];
      const hostNumber = (subnetOffset % 10) * 10 + deviceConfig.hostOffset;
      deviceIP[3] = Math.min(254, hostNumber);

      const ipAddress = deviceIP.join('.');
      // Store assignment...
    });
  });
}
```

---

## VLAN Generation Algorithm

### Overview

VLANs are generated based on the same strategy as IP generation (group-based or student ID-based). VLANs ensure network isolation between groups or students.

### Group-Based VLAN Generation

**Formula:**
```
baseVLAN = groupNumber * 10
vlans = [baseVLAN, baseVLAN + 1, baseVLAN + 2]
```

**Example:**
```
Group 1:
  baseVLAN = 1 * 10 = 10
  vlans = [10, 11, 12]

Group 5:
  baseVLAN = 5 * 10 = 50
  vlans = [50, 51, 52]
```

### Student ID-Based VLAN Generation

**Formula:**
```
studentIdNum = parseInt(studentId)
baseVLAN = (studentIdNum % 100) + 100
vlans = [baseVLAN, baseVLAN + 100, baseVLAN + 200]
```

**Example:**
```
Student ID: 61071234
  studentIdNum = 61071234
  baseVLAN = (61071234 % 100) + 100
           = 34 + 100
           = 134
  vlans = [134, 234, 334]

Student ID: 61071099
  studentIdNum = 61071099
  baseVLAN = (61071099 % 100) + 100
           = 99 + 100
           = 199
  vlans = [199, 299, 399]
```

### VLAN Range Considerations

- **Group-based VLANs:** Range from 10-999+ (depending on group count)
- **Student ID-based VLANs:** Range from 100-499
  - First VLAN: 100-199
  - Second VLAN: 200-299
  - Third VLAN: 300-399

### TypeScript Implementation Reference

```typescript
// From: composables/useIPGeneration.ts (lines 203-233)
function generateVLANs(
  students: StudentCSVRow[],
  strategy: 'group_based' | 'student_id_based'
): Record<string, number[]> {
  const vlanAssignments: Record<string, number[]> = {};

  if (strategy === 'group_based') {
    students.forEach(student => {
      if (student.groupNumber !== undefined) {
        const baseVLAN = student.groupNumber * 10;
        vlanAssignments[student.studentId] = [
          baseVLAN,
          baseVLAN + 1,
          baseVLAN + 2
        ];
      }
    });
  } else {
    students.forEach(student => {
      const studentIdNum = parseInt(student.studentId);
      const baseVLAN = (studentIdNum % 100) + 100;
      vlanAssignments[student.studentId] = [
        baseVLAN,
        baseVLAN + 100,
        baseVLAN + 200
      ];
    });
  }

  return vlanAssignments;
}
```

---

## Student-Specific IP Generation (Advanced)

### Overview

This is an advanced algorithm for generating complex network configurations based on student IDs following a specific format. Used for sophisticated lab scenarios with multiple VLANs, IPv4/IPv6, and device-specific addressing.

**Student ID Format:** `YYFFFFFF` (8 digits)
- `YY`: Year (e.g., 61 for Buddhist year 2561)
- `FF`: Faculty code (e.g., 07 for IT)
- `FFFF`: Student index (last 4 digits)

### Core Mathematical Formulas

```javascript
// Parse student ID
studentId = 61071234 (example)

// Calculate dec2 (second octet for 172.x.x.x)
dec2_1 = (studentId / 1000000 - 61) * 10
dec2_2 = (studentId % 1000) / 250
dec2 = Math.floor(dec2_1 + dec2_2)

// Calculate dec3 (third octet for 172.x.x.x)
dec3 = Math.floor((studentId % 1000) % 250)

// Calculate VLAN IDs
vlan1 = Math.floor((studentId / 1000000 - 61) * 400 + (studentId % 1000))
vlan2 = Math.floor((studentId / 1000000 - 61) * 500 + (studentId % 1000))
```

### Step-by-Step Calculation Example

**Student ID: 61071234**

```
Step 1: Calculate dec2
  dec2_1 = (61071234 / 1000000 - 61) * 10
         = (61.071234 - 61) * 10
         = 0.071234 * 10
         = 0.71234

  dec2_2 = (61071234 % 1000) / 250
         = 234 / 250
         = 0.936

  dec2 = Math.floor(0.71234 + 0.936)
       = Math.floor(1.64834)
       = 1

Step 2: Calculate dec3
  dec3 = Math.floor((61071234 % 1000) % 250)
       = Math.floor(234 % 250)
       = Math.floor(234)
       = 234

Step 3: Calculate VLAN IDs
  vlan1 = Math.floor((61071234 / 1000000 - 61) * 400 + (61071234 % 1000))
        = Math.floor(0.071234 * 400 + 234)
        = Math.floor(28.4936 + 234)
        = Math.floor(262.4936)
        = 262

  vlan2 = Math.floor((61071234 / 1000000 - 61) * 500 + (61071234 % 1000))
        = Math.floor(0.071234 * 500 + 234)
        = Math.floor(35.617 + 234)
        = Math.floor(269.617)
        = 269
```

### Generated Network Addresses

Using calculated `dec2 = 1` and `dec3 = 234`:

```javascript
// IPv4 Subnet
ipv4_subnet = `172.${dec2}.${dec3}.64/26`
            = "172.1.234.64/26"

// IPv6 Subnet
ipv6_subnet = `2001:${dec2}:${dec3}::/48`
            = "2001:1:234::/48"
```

### Device-Specific IP Assignments

**Router Interfaces:**
```javascript
// VLAN 1 interface
router_vlan1_ip = `172.${dec2}.${dec3}.65`
                = "172.1.234.65"

router_vlan1_ipv6 = `2001:${dec2}:${dec3}:${vlan1}::1`
                  = "2001:1:234:262::1"

// VLAN 2 interface
router_vlan2_ip = `172.${dec2}.${dec3}.97`
                = "172.1.234.97"

router_vlan2_ipv6 = `2001:${dec2}:${dec3}:${vlan2}::1`
                  = "2001:1:234:269::1"

// External interface (deviceNumber = 0)
router_external_ip = `10.30.6.${190 + deviceNumber}`
                   = "10.30.6.190"

router_external_ipv6 = `2001:db8:dada:aaaa::${190 + deviceNumber}`
                     = "2001:db8:dada:aaaa::190"
```

**Switch Management:**
```javascript
switch_management_ip = `172.${dec2}.${dec3}.70`
                     = "172.1.234.70"
```

**PC Addresses:**
```javascript
// PC1
pc1_ip = `172.${dec2}.${dec3}.66`
       = "172.1.234.66"

pc1_ipv6 = `2001:${dec2}:${dec3}:${vlan1}::2`
         = "2001:1:234:262::2"

// PC2 (range)
pc2_ip_start = `172.${dec2}.${dec3}.101`
             = "172.1.234.101"

pc2_ipv6_prefix = `2001:${dec2}:${dec3}:${vlan2}::`
                = "2001:1:234:269::"
```

### VLAN-Specific IP Generation

For calculating IPs within specific VLANs:

```javascript
function generateVlanIP(vlanIndex, interfaceOffset, studentId, vlanConfig) {
  const student_id = Number(studentId);

  // Calculate student-specific octets
  let dec2_1 = (student_id / 1000000 - 61) * 10;
  let dec2_2 = (student_id % 1000) / 250;
  let dec2 = Math.floor(dec2_1 + dec2_2);
  let dec3 = Math.floor((student_id % 1000) % 250);

  // For calculated VLANs with multipliers
  if (vlanConfig.calculationMultiplier !== undefined) {
    const calculatedVlanId = Math.floor(
      (student_id / 1000000 - 61) * vlanConfig.calculationMultiplier + (student_id % 1000)
    );

    // Modify dec3 for uniqueness
    dec3 = Math.floor((dec3 + calculatedVlanId) % 250);
  }

  // Use VLAN base network
  const [vlanOct1] = vlanConfig.baseNetwork.split('.').map(Number);

  // Base VLAN IP starts at .64, then add interface offset
  const hostAddress = 64 + interfaceOffset;

  return `${vlanOct1}.${dec2}.${dec3}.${hostAddress}`;
}
```

### Management IP Generation

**IMPORTANT:** Management IP generation is now handled by the backend, NOT the frontend.

The frontend previously had a `generateManagementIP()` method, but this is **deprecated** and returns a placeholder:

```javascript
// DEPRECATED - Backend handles this now
generateManagementIP(blacklistedIPs, assignedIPs): string {
  console.warn('generateManagementIP is deprecated. Backend handles this.');
  return 'MANAGEMENT_IP_BACKEND_GENERATED';
}
```

**Backend Responsibility:** The backend must generate management IPs using infrastructure-safe ranges that avoid conflicts.

### Complete Example Output

**Student ID: 61071234, deviceNumber: 0**

```json
{
  "student_id": 61071234,
  "calculatedValues": {
    "dec2": 1,
    "dec3": 234,
    "vlan1": 262,
    "vlan2": 269
  },
  "generatedNetworks": {
    "ipv4_subnet": "172.1.234.64/26",
    "ipv6_subnet": "2001:1:234::/48"
  },
  "commonIpAddresses": {
    "router_vlan1_ip": "172.1.234.65",
    "router_vlan2_ip": "172.1.234.97",
    "router_external_ip": "10.30.6.190",
    "router_vlan1_ipv6": "2001:1:234:262::1",
    "router_vlan2_ipv6": "2001:1:234:269::1",
    "router_external_ipv6": "2001:db8:dada:aaaa::190",
    "switch_management_ip": "172.1.234.70",
    "pc1_ip": "172.1.234.66",
    "pc1_ipv6": "2001:1:234:262::2",
    "pc2_ip_start": "172.1.234.101",
    "pc2_ipv6_prefix": "2001:1:234:269::"
  }
}
```

### TypeScript Implementation Reference

```typescript
// From: utils/studentIpGenerator.ts (lines 42-109)
class StudentIpGenerator {
  generateStudentIpData(deviceNumber: number = 0) {
    const student_id = Number(this.config.student_id);

    let dec2_1: number = (student_id / 1000000 - 61) * 10;
    let dec2_2: number = (student_id % 1000) / 250;
    let dec2: number = dec2_1 + dec2_2;
    dec2 = Math.floor(dec2);

    let dec3: number = (student_id % 1000) % 250;
    dec3 = Math.floor(dec3);

    let vlan1: number = (student_id / 1000000 - 61) * 400 + (student_id % 1000);
    let vlan2: number = (student_id / 1000000 - 61) * 500 + (student_id % 1000);
    vlan1 = Math.floor(vlan1);
    vlan2 = Math.floor(vlan2);

    return {
      student_id,
      calculatedValues: { dec2, dec3, vlan1, vlan2 },
      generatedNetworks: {
        ipv4_subnet: `172.${dec2}.${dec3}.64/26`,
        ipv6_subnet: `2001:${dec2}:${dec3}::/48`
      },
      commonIpAddresses: {
        router_vlan1_ip: `172.${dec2}.${dec3}.65`,
        router_vlan2_ip: `172.${dec2}.${dec3}.97`,
        router_external_ip: `10.30.6.${190 + deviceNumber}`,
        // ... etc
      }
    };
  }
}
```

---

## Network Validation Utilities

### CIDR Validation

**Purpose:** Validate CIDR notation (e.g., "192.168.1.0/24")

```javascript
function validateCIDR(cidr: string): NetworkValidationResult {
  // Pattern: x.x.x.x/xx
  const cidrPattern = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;

  if (!cidrPattern.test(cidr)) {
    return { isValid: false, errors: ['Invalid CIDR format'] };
  }

  const [networkPart, prefixPart] = cidr.split('/');
  const prefix = parseInt(prefixPart);

  // Prefix must be 1-30 for host allocation
  if (prefix < 1 || prefix > 30) {
    return { isValid: false, errors: ['Prefix must be /1 to /30'] };
  }

  // Validate octets (0-255)
  const octets = networkPart.split('.').map(Number);
  for (let i = 0; i < octets.length; i++) {
    if (isNaN(octets[i]) || octets[i] < 0 || octets[i] > 255) {
      return { isValid: false, errors: [`Invalid octet: ${octets[i]}`] };
    }
  }

  return { isValid: true, errors: [], warnings: [] };
}
```

### IP Address Validation

**Purpose:** Validate IPv4 address format

```javascript
function validateIPAddress(ip: string): boolean {
  const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipPattern.test(ip)) return false;

  const octets = ip.split('.').map(Number);
  return octets.every(octet => octet >= 0 && octet <= 255);
}
```

### Calculate Network Information

**Purpose:** Calculate network details from base IP and prefix length

```javascript
function calculateNetworkInfo(networkIP: string, prefixLength: number): NetworkInfo {
  const octets = networkIP.split('.').map(Number);
  const ip = (octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3];

  const mask = 0xffffffff << (32 - prefixLength);
  const network = ip & mask;
  const broadcast = network | (~mask);

  const networkOctets = [
    (network >> 24) & 0xff,
    (network >> 16) & 0xff,
    (network >> 8) & 0xff,
    network & 0xff
  ];

  const broadcastOctets = [
    (broadcast >> 24) & 0xff,
    (broadcast >> 16) & 0xff,
    (broadcast >> 8) & 0xff,
    broadcast & 0xff
  ];

  const firstHostOctets = [...networkOctets];
  firstHostOctets[3] += 1;

  const lastHostOctets = [...broadcastOctets];
  lastHostOctets[3] -= 1;

  return {
    network: networkOctets.join('.'),
    broadcast: broadcastOctets.join('.'),
    firstHost: firstHostOctets.join('.'),
    lastHost: lastHostOctets.join('.'),
    totalHosts: Math.max(0, broadcast - network - 1),
    subnetMask: /* calculated mask */,
    cidr: `${networkOctets.join('.')}/${prefixLength}`
  };
}
```

---

## Implementation Examples

### Example 1: Group-Based Lab

**Scenario:** 20 students in 4 groups, 3 devices per group

```javascript
const baseNetwork = "10.30.6.0";
const subnetMask = 24;

const students = [
  { studentId: "61071001", groupNumber: 1 },
  { studentId: "61071002", groupNumber: 1 },
  { studentId: "61071003", groupNumber: 2 },
  // ... more students
];

const deviceConfigs = [
  { deviceId: "router1", hostOffset: 1 },
  { deviceId: "switch1", hostOffset: 2 },
  { deviceId: "pc1", hostOffset: 10 }
];

// Generate IPs
const result = generateIPAssignments(
  students,
  { baseNetwork, subnetMask },
  deviceConfigs,
  'group_based'
);

// Output for Group 1:
// router1: 10.30.7.1
// switch1: 10.30.7.2
// pc1: 10.30.7.10

// Output for Group 2:
// router1: 10.30.8.1
// switch1: 10.30.8.2
// pc1: 10.30.8.10
```

### Example 2: Student ID-Based Exam

**Scenario:** Individual exam with personalized IPs

```javascript
const baseNetwork = "192.168.1.0";
const subnetMask = 24;

const students = [
  { studentId: "61071234" },  // No group number
  { studentId: "61071056" }
];

const deviceConfigs = [
  { deviceId: "router1", hostOffset: 1 },
  { deviceId: "pc1", hostOffset: 5 }
];

// Generate IPs
const result = generateIPAssignments(
  students,
  { baseNetwork, subnetMask },
  deviceConfigs,
  'student_id_based'
);

// Output for Student 61071234 (offset 34):
// router1: 192.168.4.41  (3rd octet: 1+3=4, 4th: 4*10+1=41)
// pc1: 192.168.4.45      (3rd octet: 1+3=4, 4th: 4*10+5=45)

// Output for Student 61071056 (offset 56):
// router1: 192.168.6.51  (3rd octet: 1+5=6, 4th: 6*10+1=61)
// pc1: 192.168.6.55      (3rd octet: 1+5=6, 4th: 6*10+5=65)
```

### Example 3: Advanced Student-Specific Generation

**Scenario:** Complex lab with VLANs and multiple address families

```javascript
import StudentIpGenerator from '@/utils/studentIpGenerator';

const generator = new StudentIpGenerator({
  student_id: 61071234,
  baseNetwork: "172.16.0.0",
  subnetMask: 16
});

const result = generator.generateStudentIpData(0);

console.log(result);
/*
{
  student_id: 61071234,
  calculatedValues: {
    dec2: 1,
    dec3: 234,
    vlan1: 262,
    vlan2: 269
  },
  generatedNetworks: {
    ipv4_subnet: "172.1.234.64/26",
    ipv6_subnet: "2001:1:234::/48"
  },
  commonIpAddresses: {
    router_vlan1_ip: "172.1.234.65",
    router_vlan2_ip: "172.1.234.97",
    router_external_ip: "10.30.6.190",
    // ... all other IPs
  }
}
*/
```

---

## Backend Implementation Checklist

When implementing these algorithms in the backend, ensure:

- [ ] **Exact mathematical parity** - Use identical formulas
- [ ] **Same rounding behavior** - Use `Math.floor()` consistently
- [ ] **Proper modulo operations** - Use `%` for wraparound calculations
- [ ] **IPv4 octet validation** - Ensure 0-255 range
- [ ] **Handle edge cases** - Third/fourth octet overflow
- [ ] **Group validation** - Ensure all students in group-based strategy have groups
- [ ] **Student ID parsing** - Convert to integer properly
- [ ] **VLAN generation** - Use correct multipliers (10 for groups, 100 base for students)
- [ ] **Management IP handling** - Backend generates management IPs (not frontend)
- [ ] **Deterministic output** - Same input always produces same output

---

## Algorithm Verification

### Test Cases

**Test Case 1: Group-Based**
```
Input:
  baseNetwork: "10.30.6.0"
  groupNumber: 3
  hostOffset: 15

Expected Output: "10.30.9.15"
```

**Test Case 2: Student ID-Based**
```
Input:
  baseNetwork: "192.168.1.0"
  studentId: "61071234"
  hostOffset: 5

Expected Output: "192.168.4.45"
```

**Test Case 3: VLAN Generation (Group)**
```
Input:
  groupNumber: 7

Expected Output: [70, 71, 72]
```

**Test Case 4: VLAN Generation (Student ID)**
```
Input:
  studentId: "61071234"

Expected Output: [134, 234, 334]
```

**Test Case 5: Advanced Student IP**
```
Input:
  studentId: "61071234"
  deviceNumber: 0

Expected Output:
  dec2: 1
  dec3: 234
  vlan1: 262
  vlan2: 269
  router_vlan1_ip: "172.1.234.65"
```

---

## Source Code References

| Algorithm | File Location | Line Numbers |
|-----------|---------------|--------------|
| Group-based IP | `composables/useIPGeneration.ts` | 46-134 |
| Student ID-based IP | `composables/useIPGeneration.ts` | 136-201 |
| VLAN Generation | `composables/useIPGeneration.ts` | 203-233 |
| Advanced Student IP | `utils/studentIpGenerator.ts` | 42-109 |
| VLAN-specific IP | `utils/studentIpGenerator.ts` | 306-339 |
| Network Validation | `composables/useNetworkValidation.ts` | 5-110 |

---

## Change Log

| Date | Version | Changes |
|------|---------|---------|
| 2025-10-07 | 1.0 | Initial comprehensive documentation |

---

## Contact & Support

For questions about these algorithms, refer to:
- **Source Code:** `/composables/useIPGeneration.ts`, `/utils/studentIpGenerator.ts`
- **Backend Integration:** `BACKEND_INTEGRATION.md`
- **Project Documentation:** `CLAUDE.md`

---

**End of Documentation**

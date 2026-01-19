import { Elysia, t } from "elysia";
import { PartService } from "./service";
import { authPlugin, requireRole } from "../../plugins/plugins";
import { IFillInBlankQuestionResult } from "../submissions/model";
import { SubmissionService } from "../submissions/service";
import { StudentLabSessionService } from "../student-lab-sessions/service";
import { Types } from "mongoose";
import {
  calculateStudentIdBasedIP,
  calculateAdvancedStudentIP,
  calculateStudentVLANs
} from "../submissions/ip-calculator";
import {
  generateIPv6FromTemplate
} from "../submissions/ipv6-config";
import {
  generateLinkLocalAddress
} from "../submissions/ipv6-calculator";
import {
  LargeSubnetAllocator,
  AllocationResult
} from "../submissions/large-subnet-allocator";

// Rich content schema
const RichContentSchema = t.Object({
  html: t.String(),
  json: t.Any()
});

// IP Table Questionnaire Schema
// Made fields optional to handle partial/empty objects from non-ip_table_questionnaire question types
const IpTableQuestionnaireSchema = t.Object({
  tableId: t.Optional(t.String()),
  rowCount: t.Optional(t.Number()),
  columnCount: t.Optional(t.Number()),
  columns: t.Optional(t.Array(t.Object({
    columnId: t.String(),
    label: t.String(),
    order: t.Number()
  }))),
  rows: t.Optional(t.Array(t.Object({
    rowId: t.String(),
    deviceId: t.String(),
    interfaceName: t.String(),
    displayName: t.String(),
    order: t.Number()
  }))),
  cells: t.Optional(t.Array(t.Array(t.Object({
    cellId: t.String(),
    rowId: t.String(),
    columnId: t.String(),
    cellType: t.Optional(t.Union([
      t.Literal('input'),
      t.Literal('readonly'),
      t.Literal('blank')
    ], { default: 'input' })),
    answerType: t.Optional(t.Union([t.Literal('static'), t.Literal('calculated')])),
    staticAnswer: t.Optional(t.String()),
    calculatedAnswer: t.Optional(t.Object({
      calculationType: t.Union([
        t.Literal('vlan_network_address'),
        t.Literal('vlan_first_usable'),
        t.Literal('vlan_last_usable'),
        t.Literal('vlan_broadcast'),
        t.Literal('vlan_subnet_mask'),
        t.Literal('vlan_lecturer_offset'),
        t.Literal('vlan_lecturer_range'),
        t.Literal('device_interface_ip'),
        t.Literal('vlan_id'),
        // Large Subnet Mode Calculation Types
        t.Literal('subnet_calculation_network'),
        t.Literal('dotted_subnet_mask'),
        t.Literal('subnet_prefix_length'),
        t.Literal('cidr_notation'),
        t.Literal('wildcard_mask'),
        // IPv6 Calculation Types
        t.Literal('ipv6_network_prefix'),
        t.Literal('ipv6_address'),
        t.Literal('ipv6_interface_id'),
        t.Literal('ipv6_link_local'),
        t.Literal('ipv6_slaac'),
        t.Literal('ipv6_prefix_length'),
        t.Literal('device_interface_ipv6')
      ]),
      vlanIndex: t.Optional(t.Number()),
      lecturerOffset: t.Optional(t.Number()),
      lecturerRangeStart: t.Optional(t.Number()),
      lecturerRangeEnd: t.Optional(t.Number()),
      deviceId: t.Optional(t.String()),
      interfaceName: t.Optional(t.String()),
      // IPv6-specific fields
      ipv6Prefix: t.Optional(t.String()),           // Expected prefix for SLAAC validation
      ipv6InterfaceIdType: t.Optional(t.Union([     // How interface ID is determined
        t.Literal('eui64'),
        t.Literal('random'),
        t.Literal('manual')
      ]))
    })),
    readonlyContent: t.Optional(t.String()),
    blankReason: t.Optional(t.String()),
    points: t.Optional(t.Number()),
    autoCalculated: t.Optional(t.Boolean())
  }))))
});

// Question Schema
const QuestionSchema = t.Object({
  questionId: t.String(),
  questionText: t.String(),
  questionType: t.Union([
    t.Literal('network_address'),
    t.Literal('first_usable_ip'),
    t.Literal('last_usable_ip'),
    t.Literal('broadcast_address'),
    t.Literal('subnet_mask'),
    t.Literal('ip_address'),
    t.Literal('number'),
    t.Literal('custom_text'),
    t.Literal('ip_table_questionnaire')
  ]),
  order: t.Number(),
  points: t.Number(),
  schemaMapping: t.Optional(t.Object({
    vlanIndex: t.Number(),
    field: t.Union([
      t.Literal('networkAddress'),
      t.Literal('subnetMask'),
      t.Literal('firstUsableIp'),
      t.Literal('lastUsableIp'),
      t.Literal('broadcastAddress')
    ]),
    deviceId: t.Optional(t.String()),
    variableName: t.Optional(t.String()),
    autoDetected: t.Optional(t.Boolean())
  })),
  answerFormula: t.Optional(t.String()),
  expectedAnswerType: t.Union([t.Literal('exact'), t.Literal('range')]),
  placeholder: t.Optional(t.String()),
  inputFormat: t.Optional(t.Union([
    t.Literal('ip'),
    t.Literal('cidr'),
    t.Literal('number'),
    t.Literal('text')
  ])),
  expectedAnswer: t.Optional(t.String()),
  caseSensitive: t.Optional(t.Boolean()),
  trimWhitespace: t.Optional(t.Boolean()),
  ipTableQuestionnaire: t.Optional(IpTableQuestionnaireSchema)
});

// DHCP Configuration Schema
const DhcpConfigurationSchema = t.Object({
  vlanIndex: t.Number(),
  startOffset: t.Number(),
  endOffset: t.Number(),
  dhcpServerDevice: t.String()
});

// Updated schemas for embedded tasks model
const PartCreateSchema = t.Object({
  labId: t.String({ description: "Lab ID this part belongs to" }),
  partId: t.String({ description: "Human-readable ID within lab" }),
  title: t.String({ description: "Part title" }),
  description: t.String({ default: "" }),
  instructions: t.Union([RichContentSchema, t.String()]), // Accept both rich content and plain HTML string
  order: t.Number({ description: "Part order within lab" }),
  partType: t.Union([
    t.Literal('fill_in_blank'),
    t.Literal('network_config'),
    t.Literal('dhcp_config')
  ], { default: 'network_config', description: "Type of part" }),
  questions: t.Optional(t.Array(QuestionSchema)),
  dhcpConfiguration: t.Optional(DhcpConfigurationSchema),
  tasks: t.Array(t.Object({
    taskId: t.String(),
    name: t.String(),
    description: t.String({ default: "" }),
    templateId: t.String(),
    group_id: t.Optional(t.String({ description: "Optional grouping for grading" })),
    executionDevice: t.String(),
    targetDevices: t.Array(t.String(), { default: [] }),
    parameters: t.Record(t.String(), t.Any()),
    testCases: t.Array(t.Object({
      comparison_type: t.String({ description: "Type of comparison: equals, contains, regex, success, ssh_success, greater_than, not_equals" }),
      expected_result: t.Any({ description: "Expected value/result for comparison" })
    })),
    order: t.Number(),
    points: t.Number({ minimum: 0 })
  })),
  task_groups: t.Array(t.Object({
    group_id: t.String(),
    title: t.String(),
    description: t.String({ default: "" }),
    group_type: t.Union([t.Literal("all_or_nothing"), t.Literal("proportional")]),
    points: t.Number({ minimum: 0 }),
    continue_on_failure: t.Boolean(),
    timeout_seconds: t.Number()
  }), { default: [] }),
  prerequisites: t.Array(t.String(), { default: [] }),
  totalPoints: t.Number({ description: "Total points for this part" })
});

const PartUpdateSchema = t.Object({
  partId: t.Optional(t.String()),
  title: t.Optional(t.String()),
  description: t.String({ default: "" }),
  instructions: t.Optional(t.Union([RichContentSchema, t.String()])), // Accept both rich content and plain HTML string
  order: t.Optional(t.Number()),
  partType: t.Optional(t.Union([
    t.Literal('fill_in_blank'),
    t.Literal('network_config'),
    t.Literal('dhcp_config')
  ])),
  questions: t.Optional(t.Array(QuestionSchema)),
  dhcpConfiguration: t.Optional(DhcpConfigurationSchema),
  tasks: t.Optional(t.Array(t.Object({
    taskId: t.String(),
    name: t.String(),
    description: t.String({ default: "" }),
    templateId: t.String(),
    group_id: t.Optional(t.String({ description: "Optional grouping for grading" })),
    executionDevice: t.String(),
    targetDevices: t.Array(t.String(), { default: [] }),
    parameters: t.Record(t.String(), t.Any()),
    testCases: t.Array(t.Object({
      comparison_type: t.String({ description: "Type of comparison: equals, contains, regex, success, ssh_success, greater_than, not_equals" }),
      expected_result: t.Any({ description: "Expected value/result for comparison" })
    })),
    order: t.Number(),
    points: t.Number({ minimum: 0 })
  }))),
  task_groups: t.Array(t.Object({
    group_id: t.String(),
    title: t.String(),
    description: t.String({ default: "" }),
    group_type: t.Union([t.Literal("all_or_nothing"), t.Literal("proportional")]),
    points: t.Number({ minimum: 0 }),
    continue_on_failure: t.Boolean(),
    timeout_seconds: t.Number()
  }), { default: [] }),
  prerequisites: t.Array(t.String(), { default: [] }),
  totalPoints: t.Optional(t.Number())
});

/**
 * Helper function to calculate network address from IP and subnet mask
 */
function calculateNetworkAddress(ip: string, subnetMask: number): string {
  const octets = ip.split('.').map(Number);
  const maskBits = subnetMask;
  const hostBits = 32 - maskBits;

  // Calculate the network address by zeroing out host bits
  let ipNum = (octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3];
  const mask = ~((1 << hostBits) - 1) >>> 0;
  const networkNum = (ipNum & mask) >>> 0;

  return [
    (networkNum >>> 24) & 0xFF,
    (networkNum >>> 16) & 0xFF,
    (networkNum >>> 8) & 0xFF,
    networkNum & 0xFF
  ].join('.');
}

function ipToNumber(ip: string): number {
  const octets = ip.split('.').map(Number);
  if (octets.length !== 4 || octets.some(octet => Number.isNaN(octet) || octet < 0 || octet > 255)) {
    return Number.NaN;
  }
  return ((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3];
}

/**
 * Helper function to calculate broadcast address from IP and subnet mask
 */
function calculateBroadcastAddress(ip: string, subnetMask: number): string {
  const octets = ip.split('.').map(Number);
  const hostBits = 32 - subnetMask;

  // Calculate the broadcast address by setting all host bits to 1
  let ipNum = (octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3];
  const mask = ~((1 << hostBits) - 1) >>> 0;
  const networkNum = (ipNum & mask) >>> 0;
  const broadcastNum = (networkNum | ((1 << hostBits) - 1)) >>> 0;

  return [
    (broadcastNum >>> 24) & 0xFF,
    (broadcastNum >>> 16) & 0xFF,
    (broadcastNum >>> 8) & 0xFF,
    broadcastNum & 0xFF
  ].join('.');
}

/**
 * Helper function to calculate first usable IP in subnet
 */
function calculateFirstUsableIP(networkAddress: string): string {
  const octets = networkAddress.split('.').map(Number);
  octets[3] += 1;
  return octets.join('.');
}

/**
 * Helper function to calculate last usable IP in subnet
 */
function calculateLastUsableIP(broadcastAddress: string): string {
  const octets = broadcastAddress.split('.').map(Number);
  octets[3] -= 1;
  return octets.join('.');
}

/**
 * Helper function to convert subnet mask number to dotted decimal notation
 */
function subnetMaskToDottedDecimal(subnetMask: number): string {
  const mask = ~((1 << (32 - subnetMask)) - 1) >>> 0;
  return [
    (mask >>> 24) & 0xFF,
    (mask >>> 16) & 0xFF,
    (mask >>> 8) & 0xFF,
    mask & 0xFF
  ].join('.');
}

/**
 * Calculate expected answer for an IP table cell
 * @param calculatedAnswer - The calculation configuration
 * @param lab - The lab document with network configuration
 * @param studentId - The student's ID
 * @returns The expected IP address or value as a string
 */
function calculateCellAnswer(calculatedAnswer: any, lab: any, studentId: string, largeSubnetAllocation?: AllocationResult): string {
  const { calculationType, vlanIndex, lecturerOffset, deviceId, interfaceName } = calculatedAnswer;

  // Get the lab's network topology
  const topology = lab.network?.topology;
  if (!topology) {
    throw new Error('Lab network topology not found');
  }

  const baseNetwork = topology.baseNetwork;
  const subnetMask = topology.subnetMask;
  const allocationStrategy = topology.allocationStrategy;

  // Handle device interface IP calculation FIRST (before checking vlanIndex)
  if (calculationType === 'device_interface_ip') {
    if (!deviceId || !interfaceName) {
      throw new Error('deviceId and interfaceName required for device_interface_ip');
    }

    // Find the device and its IP variable configuration
    const device = lab.network?.devices?.find((d: any) => d.deviceId === deviceId);
    if (!device) {
      throw new Error(`Device ${deviceId} not found in lab`);
    }

    const ipVariable = device.ipVariables?.find((v: any) => v.name === interfaceName);
    if (!ipVariable) {
      throw new Error(`IP variable ${interfaceName} not found for device ${deviceId}`);
    }

    if (ipVariable.inputType === 'fullIP' && ipVariable.fullIp) {
      console.log(`[Device Interface IP] Using static fullIP for ${deviceId}.${interfaceName}:`, {
        fullIp: ipVariable.fullIp
      });
      return ipVariable.fullIp;
    }

    // ❌ REJECT MANAGEMENT INTERFACES
    if (ipVariable.isManagementInterface) {
      throw new Error(
        `Management interface ${deviceId}.${interfaceName} cannot be used in IP questionnaires. ` +
        `Management IPs are auto-generated and should not be included as calculated answers.`
      );
    }

    console.log(`[Device Interface IP] Calculating for ${deviceId}.${interfaceName}:`, {
      baseNetwork,
      studentId,
      hostOffset: ipVariable.hostOffset,
      allocationStrategy
    });

    // For VLAN interfaces, check if this interface is in a VLAN
    if (ipVariable.isVlanInterface && ipVariable.vlanIndex !== undefined) {
      // This is a VLAN interface - use VLAN-based calculation
      const vlans = lab.network?.vlanConfiguration?.vlans || [];
      const vlan = vlans[ipVariable.vlanIndex];

      if (vlan) {
        const vlanMode = lab.network?.vlanConfiguration?.mode;

        if (vlanMode === 'calculated_vlan' && vlan.calculationMultiplier) {
          return calculateAdvancedStudentIP(
            studentId,
            {
              baseNetwork: vlan.baseNetwork || baseNetwork,
              calculationMultiplier: vlan.calculationMultiplier,
              subnetMask: vlan.subnetMask || subnetMask,
              subnetIndex: vlan.subnetIndex || ipVariable.vlanIndex
            },
            ipVariable.interfaceOffset || 1
          );
        } else {
          return calculateStudentIdBasedIP(
            vlan.baseNetwork || baseNetwork,
            studentId,
            ipVariable.interfaceOffset || 1
          );
        }
      }
    }

    // Handle Sub-VLAN interfaces (Large Subnet Mode)
    if (ipVariable.inputType?.startsWith('subVlan') && !ipVariable.inputType?.includes('6_')) {
      const vlanIndex = ipVariable.vlanIndex;
      if (vlanIndex === undefined) {
        throw new Error(`Invalid sub-VLAN configuration: vlanIndex missing for ${deviceId}.${interfaceName}`);
      }

      const vlanConfig = lab.network?.vlanConfiguration;
      if (vlanConfig?.mode !== 'large_subnet' || !vlanConfig.largeSubnetConfig) {
        throw new Error('Lab is not configured for large_subnet mode');
      }

      // For grading, we need the student's large subnet allocation
      if (!largeSubnetAllocation) {
        throw new Error('Large subnet allocation required for sub-VLAN IP grading - pass studentSession.largeSubnetAllocation');
      }

      const subVlan = vlanConfig.largeSubnetConfig.subVlans?.[vlanIndex];
      if (!subVlan) {
        throw new Error(`Sub-VLAN at index ${vlanIndex} not found`);
      }

      const interfaceOffset = ipVariable.interfaceOffset || 1;

      // Use LargeSubnetAllocator to calculate the IP within the student's sub-VLAN block
      const result = LargeSubnetAllocator.calculateSubVlanIP(
        largeSubnetAllocation,
        subVlan,
        interfaceOffset
      );

      console.log(`[Device Interface IP - Sub-VLAN] ${deviceId}.${interfaceName}:`, {
        subVlanIndex: vlanIndex,
        subVlanName: subVlan.name,
        interfaceOffset,
        result
      });

      return result;
    }

    // Regular (non-VLAN) interface - use basic calculation with hostOffset
    const hostOffset =
      typeof ipVariable.hostOffset === 'number'
        ? ipVariable.hostOffset
        : typeof ipVariable.interfaceOffset === 'number'
          ? ipVariable.interfaceOffset
          : 1;

    return calculateStudentIdBasedIP(baseNetwork, studentId, hostOffset);
  }

  // Handle device interface IPv6 calculation (for dual-stack interfaces from Step 3)
  if (calculationType === 'device_interface_ipv6') {
    if (!deviceId || !interfaceName) {
      throw new Error('deviceId and interfaceName required for device_interface_ipv6');
    }

    // Find the device and its IP variable configuration
    const device = lab.network?.devices?.find((d: any) => d.deviceId === deviceId);
    if (!device) {
      throw new Error(`Device ${deviceId} not found in lab`);
    }

    const ipVariable = device.ipVariables?.find((v: any) => v.name === interfaceName);
    if (!ipVariable) {
      throw new Error(`IP variable ${interfaceName} not found for device ${deviceId}`);
    }

    // Check if static fullIpv6 is configured
    if (ipVariable.ipv6InputType === 'fullIPv6' && ipVariable.fullIpv6) {
      // Strip prefix length if present and return just the address
      const result = ipVariable.fullIpv6.split('/')[0];
      console.log(`[Device Interface IPv6] Using static fullIPv6 for ${deviceId}.${interfaceName}:`, {
        fullIpv6: ipVariable.fullIpv6,
        result
      });
      return result;
    }

    // Check if link-local is configured
    if (ipVariable.ipv6InputType === 'linkLocal') {
      const interfaceId = ipVariable.ipv6InterfaceId || '1';
      const result = generateLinkLocalAddress(interfaceId);
      console.log(`[Device Interface IPv6] Using link-local for ${deviceId}.${interfaceName}:`, {
        interfaceId,
        result
      });
      return result;
    }

    // Check if VLAN-based IPv6 is configured (studentVlan6_X)
    if (ipVariable.ipv6InputType?.startsWith('studentVlan6_')) {
      const ipv6Config = lab.network?.ipv6Config;
      if (!ipv6Config?.enabled || !ipv6Config.template) {
        throw new Error('IPv6 configuration is not enabled for this lab');
      }

      const ipv6VlanIndex = ipVariable.ipv6VlanIndex ?? 0;
      const vlanConfig = lab.network?.vlanConfiguration;

      // Calculate VLAN ID based on mode
      let vlanIdForIpv6: number;

      if (vlanConfig?.mode === 'large_subnet' && largeSubnetAllocation) {
        // Large Subnet Mode: Get VLAN ID from allocation's randomized list
        vlanIdForIpv6 = largeSubnetAllocation.randomizedVlanIds[ipv6VlanIndex];
        if (vlanIdForIpv6 === undefined) {
          throw new Error(`Large Subnet Mode: VLAN ID not found for sub-VLAN index ${ipv6VlanIndex}`);
        }
        console.log(`[Device Interface IPv6 - Large Subnet] VLAN Index ${ipv6VlanIndex} -> VLAN ID ${vlanIdForIpv6}`);
      } else if (vlanConfig?.mode === 'calculated_vlan') {
        // Calculated VLAN Mode: Calculate from multiplier
        const vlans = vlanConfig.vlans || [];
        const vlan = vlans[ipv6VlanIndex];
        if (vlan?.calculationMultiplier) {
          const vlanIds = calculateStudentVLANs(studentId, [vlan.calculationMultiplier]);
          vlanIdForIpv6 = vlanIds[0];
        } else {
          vlanIdForIpv6 = vlan?.vlanId || ipv6VlanIndex;
        }
      } else {
        // Fixed VLAN Mode or fallback: Use configured vlanId
        const vlans = vlanConfig?.vlans || [];
        const vlan = vlans[ipv6VlanIndex];
        vlanIdForIpv6 = vlan?.vlanId || ipv6VlanIndex;
      }

      const interfaceOffset = parseInt(ipVariable.ipv6InterfaceId || '1', 10) || 1;
      const fullResult = generateIPv6FromTemplate(
        ipv6Config.template,
        studentId,
        vlanIdForIpv6.toString(),
        interfaceOffset
      );
      // Strip prefix length
      const result = fullResult.split('/')[0];
      console.log(`[Device Interface IPv6] Using template for ${deviceId}.${interfaceName}:`, {
        template: ipv6Config.template,
        vlanId: vlanIdForIpv6,
        interfaceOffset,
        fullResult,
        result
      });
      return result;
    }

    // Check if sub-VLAN based IPv6 is configured (subVlan6_X for Large Subnet Mode)
    if (ipVariable.ipv6InputType?.startsWith('subVlan6_')) {
      const ipv6Config = lab.network?.ipv6Config;
      if (!ipv6Config?.enabled || !ipv6Config.template) {
        throw new Error('IPv6 configuration is not enabled for this lab');
      }

      // Parse VLAN index from input type (e.g., 'subVlan6_3' -> 3)
      // Falls back to ipv6VlanIndex or vlanIndex if parsing fails
      const ipv6InputType = ipVariable.ipv6InputType;
      const parsedIndex = parseInt(ipv6InputType.replace('subVlan6_', ''), 10);
      const ipv6VlanIndex = !isNaN(parsedIndex) ? parsedIndex : (ipVariable.ipv6VlanIndex ?? ipVariable.vlanIndex ?? 0);
      const vlanConfig = lab.network?.vlanConfiguration;

      if (vlanConfig?.mode !== 'large_subnet' || !largeSubnetAllocation) {
        throw new Error(`subVlan6_* input type requires Large Subnet Mode with allocation for ${deviceId}.${interfaceName}`);
      }

      // Large Subnet Mode: Get VLAN ID from allocation's randomized list
      // Fallback: If index is out of bounds (session was created before more sub-VLANs were added),
      // try to get fixedVlanId from config or generate a deterministic VLAN ID
      let vlanIdForIpv6 = largeSubnetAllocation.randomizedVlanIds[ipv6VlanIndex];
      if (vlanIdForIpv6 === undefined) {
        const subVlanConfig = vlanConfig.largeSubnetConfig?.subVlans?.[ipv6VlanIndex];
        if (subVlanConfig?.fixedVlanId !== undefined) {
          vlanIdForIpv6 = subVlanConfig.fixedVlanId;
          console.log(`[Large Subnet Mode] Using fixed VLAN ID ${vlanIdForIpv6} for sub-VLAN index ${ipv6VlanIndex}`);
        } else {
          // Generate deterministic VLAN ID based on student hash and index
          const hash = parseInt(studentId.replace(/\D/g, '').slice(-4) || '1234', 10);
          vlanIdForIpv6 = 2 + ((hash + ipv6VlanIndex * 1000) % 4094);
          console.warn(`[Large Subnet Mode] VLAN ID not found for sub-VLAN index ${ipv6VlanIndex}, generated fallback: ${vlanIdForIpv6}`);
        }
      }

      const interfaceOffset = parseInt(ipVariable.ipv6InterfaceId || '1', 10) || 1;
      const fullResult = generateIPv6FromTemplate(
        ipv6Config.template,
        studentId,
        vlanIdForIpv6.toString(),
        interfaceOffset
      );
      // Strip prefix length
      const result = fullResult.split('/')[0];
      console.log(`[Device Interface IPv6 - Sub-VLAN] ${deviceId}.${interfaceName}:`, {
        template: ipv6Config.template,
        subVlanIndex: ipv6VlanIndex,
        vlanId: vlanIdForIpv6,
        interfaceOffset,
        fullResult,
        result
      });
      return result;
    }

    throw new Error(`Unsupported IPv6 input type for ${deviceId}.${interfaceName}: ${ipVariable.ipv6InputType}`);
  }

  // Handle VLAN-based calculations (for network addresses, broadcast, etc.)
  if (vlanIndex !== undefined && calculationType !== 'device_interface_ip') {
    // Get VLAN configuration from lab (VLANs are in vlanConfiguration.vlans)
    const vlanConfig = lab.network?.vlanConfiguration;
    const vlans = vlanConfig?.vlans || [];

    // ▶️ LARGE SUBNET MODE: Handle calculations using subVlans instead of vlans
    if (vlanConfig?.mode === 'large_subnet' && vlanConfig.largeSubnetConfig) {
      const subVlans = vlanConfig.largeSubnetConfig.subVlans || [];
      const subVlan = subVlans[vlanIndex];

      if (!subVlan) {
        throw new Error(`Sub-VLAN at index ${vlanIndex} not found in largeSubnetConfig`);
      }

      // For Large Subnet Mode, use the subVlan's subnetSize for mask calculations
      const subVlanSubnetMask = subVlan.subnetSize;

      switch (calculationType) {
        case 'vlan_subnet_mask':
        case 'dotted_subnet_mask': {
          const result = subnetMaskToDottedDecimal(subVlanSubnetMask);
          console.log(`[Large Subnet - Subnet Mask] Sub-VLAN ${vlanIndex}:`, {
            subVlanName: subVlan.name,
            cidr: subVlanSubnetMask,
            dottedDecimal: result
          });
          return result;
        }
        case 'subnet_prefix_length': {
          const result = `/${subVlanSubnetMask}`;
          console.log(`[Large Subnet - Prefix Length] Sub-VLAN ${vlanIndex}:`, {
            subVlanName: subVlan.name,
            result
          });
          return result;
        }
        case 'subnet_calculation_network': {
          // Return the network address for this sub-VLAN from the student's allocation
          if (!largeSubnetAllocation) {
            throw new Error('Large subnet allocation required for subnet_calculation_network');
          }
          const result = LargeSubnetAllocator.getSubVlanNetwork(largeSubnetAllocation, subVlan);
          console.log(`[Large Subnet - Network Address] Sub-VLAN ${vlanIndex}:`, {
            subVlanName: subVlan.name,
            result
          });
          return result;
        }
        case 'cidr_notation': {
          // Return network/prefix for this sub-VLAN
          if (!largeSubnetAllocation) {
            throw new Error('Large subnet allocation required for cidr_notation');
          }
          const networkAddr = LargeSubnetAllocator.getSubVlanNetwork(largeSubnetAllocation, subVlan);
          const result = `${networkAddr}/${subVlanSubnetMask}`;
          console.log(`[Large Subnet - CIDR Notation] Sub-VLAN ${vlanIndex}:`, {
            subVlanName: subVlan.name,
            result
          });
          return result;
        }
        case 'wildcard_mask': {
          // Calculate wildcard mask (inverse of subnet mask)
          const wildcardMask = ~((~0 << (32 - subVlanSubnetMask)) >>> 0) >>> 0;
          const result = [
            (wildcardMask >>> 24) & 0xFF,
            (wildcardMask >>> 16) & 0xFF,
            (wildcardMask >>> 8) & 0xFF,
            wildcardMask & 0xFF
          ].join('.');
          console.log(`[Large Subnet - Wildcard Mask] Sub-VLAN ${vlanIndex}:`, {
            subVlanName: subVlan.name,
            subnetMask: subVlanSubnetMask,
            result
          });
          return result;
        }
        case 'vlan_id': {
          // Get VLAN ID from allocation (randomized or fixed)
          if (!largeSubnetAllocation) {
            throw new Error('Large subnet allocation required for vlan_id');
          }
          let vlanId = largeSubnetAllocation.randomizedVlanIds[vlanIndex];
          if (vlanId === undefined) {
            // Fallback for sessions created before more sub-VLANs were added
            if (subVlan.fixedVlanId !== undefined) {
              vlanId = subVlan.fixedVlanId;
            } else {
              // Generate deterministic VLAN ID
              const hash = parseInt(studentId.replace(/\D/g, '').slice(-4) || '1234', 10);
              vlanId = 2 + ((hash + vlanIndex * 1000) % 4094);
              console.warn(`[Large Subnet - VLAN ID] Fallback for sub-VLAN index ${vlanIndex}: ${vlanId}`);
            }
          }
          console.log(`[Large Subnet - VLAN ID] Sub-VLAN ${vlanIndex}:`, {
            subVlanName: subVlan.name,
            vlanId
          });
          return vlanId.toString();
        }
        case 'vlan_lecturer_offset':
        case 'vlan_lecturer_range': {
          // Calculate IP within the sub-VLAN block using lecturer offset
          if (!largeSubnetAllocation) {
            throw new Error('Large subnet allocation required for vlan_lecturer_range/offset');
          }
          const offsetToUse = lecturerOffset || 1;
          const result = LargeSubnetAllocator.calculateSubVlanIP(
            largeSubnetAllocation,
            subVlan,
            offsetToUse
          );
          console.log(`[Large Subnet - Lecturer Range/Offset] Sub-VLAN ${vlanIndex}:`, {
            subVlanName: subVlan.name,
            lecturerOffset: offsetToUse,
            result
          });
          return result;
        }
        case 'ipv6_link_local': {
          // Generate link-local address
          const interfaceId = calculatedAnswer.ipv6InterfaceId || (lecturerOffset || 1).toString();
          const result = generateLinkLocalAddress(interfaceId);
          console.log(`[Large Subnet - IPv6 Link-Local] Sub-VLAN ${vlanIndex}:`, {
            subVlanName: subVlan.name,
            interfaceId,
            result
          });
          return result;
        }
        case 'ipv6_slaac': {
          // SLAAC cells use student-provided answer (like vlan_lecturer_range)
          // The student enters their SLAAC-assigned IPv6 address
          console.log(`[Large Subnet - IPv6 SLAAC] Sub-VLAN ${vlanIndex}: Student-updatable cell (uses override)`);
          // Return empty string as placeholder - actual value comes from lecturerRangeOverrides
          return '';
        }
        case 'ipv6_prefix_length': {
          // Return just the prefix length (e.g., /64)
          const prefixLength = 64; // Standard IPv6 prefix length for /64 subnets
          const result = `/${prefixLength}`;
          console.log(`[Large Subnet - IPv6 Prefix Length] Sub-VLAN ${vlanIndex}:`, {
            subVlanName: subVlan.name,
            result
          });
          return result;
        }
        default:
          throw new Error(`Calculation type ${calculationType} not supported for Large Subnet Mode`);
      }
    }

    // If lab doesn't have VLANs configured, use base network topology for simple IP calculations
    if (vlans.length === 0) {
      console.log(`⚠️ Lab has no VLANs configured, using base network topology for IP calculation`);

      // For simple labs without VLANs, treat vlanIndex as a subnet multiplier
      // and use the base network with student ID-based calculation
      const studentIP = calculateStudentIdBasedIP(
        baseNetwork,
        studentId,
        lecturerOffset || 1
      );

      // Calculate based on calculation type using base topology
      switch (calculationType) {
        case 'vlan_network_address': {
          return calculateNetworkAddress(studentIP, subnetMask);
        }
        case 'vlan_broadcast': {
          return calculateBroadcastAddress(studentIP, subnetMask);
        }
        case 'vlan_first_usable': {
          const networkAddr = calculateNetworkAddress(studentIP, subnetMask);
          return calculateFirstUsableIP(networkAddr);
        }
        case 'vlan_last_usable': {
          const broadcastAddr = calculateBroadcastAddress(studentIP, subnetMask);
          return calculateLastUsableIP(broadcastAddr);
        }
        case 'vlan_subnet_mask':
        case 'dotted_subnet_mask': {
          return subnetMaskToDottedDecimal(subnetMask);
        }
        case 'vlan_lecturer_offset': {
          return studentIP;
        }
        case 'vlan_lecturer_range': {
          return studentIP;
        }
        default:
          throw new Error(`Calculation type ${calculationType} requires VLAN configuration`);
      }
    }

    const vlan = vlans[vlanIndex];

    if (!vlan) {
      throw new Error(`VLAN at index ${vlanIndex} not found in lab VLANs array`);
    }

    // Get the VLAN mode from vlanConfiguration
    const vlanMode = lab.network?.vlanConfiguration?.mode;

    // Calculate student-specific IP for this VLAN
    let studentIP: string;

    if (vlanMode === 'calculated_vlan' && vlan.calculationMultiplier) {
      // Use advanced algorithm for calculated VLANs
      studentIP = calculateAdvancedStudentIP(
        studentId,
        {
          baseNetwork: vlan.baseNetwork || baseNetwork,
          calculationMultiplier: vlan.calculationMultiplier,
          subnetMask: vlan.subnetMask || subnetMask,
          subnetIndex: vlan.subnetIndex || vlanIndex
        },
        lecturerOffset || 1
      );
    } else {
      // Use basic algorithm for fixed_vlan or lecturer_group VLANs
      studentIP = calculateStudentIdBasedIP(
        vlan.baseNetwork || baseNetwork,
        studentId,
        lecturerOffset || 1
      );
    }

    const vlanSubnetMask = vlan.subnetMask || subnetMask;

    // Calculate based on calculation type
    switch (calculationType) {
      case 'vlan_network_address': {
        const result = calculateNetworkAddress(studentIP, vlanSubnetMask);
        console.log(`[VLAN Network Address] VLAN ${vlanIndex}:`, {
          studentIP,
          subnetMask: vlanSubnetMask,
          networkAddress: result
        });
        return result;
      }
      case 'vlan_broadcast': {
        const result = calculateBroadcastAddress(studentIP, vlanSubnetMask);
        console.log(`[VLAN Broadcast] VLAN ${vlanIndex}:`, {
          studentIP,
          subnetMask: vlanSubnetMask,
          broadcastAddress: result
        });
        return result;
      }
      case 'vlan_first_usable': {
        const networkAddr = calculateNetworkAddress(studentIP, vlanSubnetMask);
        const result = calculateFirstUsableIP(networkAddr);
        console.log(`[VLAN First Usable] VLAN ${vlanIndex}:`, {
          networkAddress: networkAddr,
          firstUsable: result
        });
        return result;
      }
      case 'vlan_last_usable': {
        const broadcastAddr = calculateBroadcastAddress(studentIP, vlanSubnetMask);
        const result = calculateLastUsableIP(broadcastAddr);
        console.log(`[VLAN Last Usable] VLAN ${vlanIndex}:`, {
          broadcastAddress: broadcastAddr,
          lastUsable: result
        });
        return result;
      }
      case 'vlan_subnet_mask':
      case 'dotted_subnet_mask': {
        const result = subnetMaskToDottedDecimal(vlanSubnetMask);
        console.log(`[VLAN Subnet Mask] VLAN ${vlanIndex}:`, {
          cidr: vlanSubnetMask,
          dottedDecimal: result
        });
        return result;
      }
      case 'vlan_id': {
        if (vlanMode === 'calculated_vlan' && vlan.calculationMultiplier) {
          const vlanIds = calculateStudentVLANs(studentId, [vlan.calculationMultiplier]);
          console.log(`[VLAN ID - Calculated] VLAN ${vlanIndex}:`, {
            studentId,
            multiplier: vlan.calculationMultiplier,
            calculatedVlanId: vlanIds[0]
          });
          return vlanIds[0].toString();
        } else if ((vlanMode === 'fixed_vlan' || vlanMode === 'lecturer_group') && vlan.vlanId) {
          console.log(`[VLAN ID - Fixed] VLAN ${vlanIndex}:`, {
            mode: vlanMode,
            vlanId: vlan.vlanId
          });
          return vlan.vlanId.toString();
        }
        throw new Error('VLAN ID calculation failed: invalid VLAN configuration');
      }
      case 'vlan_lecturer_offset': {
        console.log(`[VLAN Lecturer Offset] VLAN ${vlanIndex}:`, {
          lecturerOffset,
          calculatedIP: studentIP
        });
        return studentIP;
      }
      case 'vlan_lecturer_range': {
        console.log(`[VLAN Lecturer Range] VLAN ${vlanIndex}:`, {
          lecturerOffset,
          calculatedIP: studentIP
        });
        return studentIP;
      }

      // IPv6 Calculation Types
      case 'ipv6_network_prefix': {
        // Generate IPv6 prefix from template
        const ipv6Config = lab.network?.ipv6Config;
        if (!ipv6Config?.enabled || !ipv6Config.template) {
          throw new Error('IPv6 configuration is not enabled for this lab');
        }

        // Calculate VLAN ID for template
        let vlanIdForIpv6: number;
        if (lab.network?.vlanConfiguration?.mode === 'calculated_vlan' && vlan.calculationMultiplier) {
          const vlanIds = calculateStudentVLANs(studentId, [vlan.calculationMultiplier]);
          vlanIdForIpv6 = vlanIds[0];
        } else {
          vlanIdForIpv6 = vlan.vlanId || vlanIndex;
        }

        // Generate full address and extract just the prefix
        const fullAddress = generateIPv6FromTemplate(
          ipv6Config.template,
          studentId,
          vlanIdForIpv6.toString(),
          0 // No interface offset for prefix
        );
        // Convert to network prefix format (e.g., 2001:6507:41:141::/64)
        const result = fullAddress.replace(/::.*\//, '::/').replace('::0/', '::/');
        console.log(`[IPv6 Network Prefix] VLAN ${vlanIndex}:`, {
          studentId,
          vlanId: vlanIdForIpv6,
          template: ipv6Config.template,
          result
        });
        return result;
      }

      case 'ipv6_address': {
        // Generate full IPv6 address from template (without prefix length)
        const ipv6Config = lab.network?.ipv6Config;
        if (!ipv6Config?.enabled || !ipv6Config.template) {
          throw new Error('IPv6 configuration is not enabled for this lab');
        }

        // Calculate VLAN ID for template
        let vlanIdForIpv6: number;
        if (lab.network?.vlanConfiguration?.mode === 'calculated_vlan' && vlan.calculationMultiplier) {
          const vlanIds = calculateStudentVLANs(studentId, [vlan.calculationMultiplier]);
          vlanIdForIpv6 = vlanIds[0];
        } else {
          vlanIdForIpv6 = vlan.vlanId || vlanIndex;
        }

        const fullResult = generateIPv6FromTemplate(
          ipv6Config.template,
          studentId,
          vlanIdForIpv6.toString(),
          lecturerOffset || 1
        );
        // Strip the prefix length (e.g., /64) - return just the address
        const result = fullResult.split('/')[0];
        console.log(`[IPv6 Address] VLAN ${vlanIndex}:`, {
          studentId,
          vlanId: vlanIdForIpv6,
          lecturerOffset,
          template: ipv6Config.template,
          fullResult,
          result
        });
        return result;
      }

      case 'ipv6_link_local': {
        // Generate link-local address
        const interfaceId = calculatedAnswer.ipv6InterfaceId || (lecturerOffset || 1).toString();
        const result = generateLinkLocalAddress(interfaceId);
        console.log(`[IPv6 Link-Local]:`, {
          interfaceId,
          result
        });
        return result;
      }

      case 'ipv6_slaac': {
        // SLAAC cells use student-provided answer (like vlan_lecturer_range)
        // The student enters their SLAAC-assigned IPv6 address
        // For grading, we compare against what they submitted
        console.log(`[IPv6 SLAAC] VLAN ${vlanIndex}: Student-updatable cell (uses override)`);
        // Return empty string as placeholder - actual value comes from lecturerRangeOverrides
        return '';
      }

      case 'ipv6_prefix_length': {
        // Return just the prefix length (e.g., /64)
        // Get from lab's IPv6 config or default to /64
        const ipv6Config = lab.network?.ipv6Config;
        const prefixLength = 64; // Standard IPv6 prefix length for /64 subnets
        const result = `/${prefixLength}`;
        console.log(`[IPv6 Prefix Length] VLAN ${vlanIndex}:`, {
          result
        });
        return result;
      }

      default:
        throw new Error(`Unknown calculation type: ${calculationType}`);
    }
  }

  throw new Error(`Unsupported calculation type: ${calculationType}`);
}

export const partRoutes = new Elysia({ prefix: "/parts" })
  .use(authPlugin)

  // Get all parts with filtering
  .get(
    "/",
    async ({ query, set }) => {
      try {
        const { labId, createdBy, page, limit } = query;
        const filters = {
          labId,
          createdBy,
          page: page ? parseInt(page) : undefined,
          limit: limit ? parseInt(limit) : undefined
        };

        const result = await PartService.getAllParts(filters);
        set.status = 200;
        return result;
      } catch (error) {
        set.status = 500;
        return { error: (error as Error).message };
      }
    },
    {
      query: t.Object({
        labId: t.Optional(t.String({ description: "Filter by lab ID" })),
        createdBy: t.Optional(t.String({ description: "Filter by creator" })),
        page: t.Optional(t.String({ description: "Page number" })),
        limit: t.Optional(t.String({ description: "Items per page" }))
      }),
      response: {
        500: t.Object({ error: t.String() })
      },
      detail: {
        tags: ["Parts"],
        summary: "Get all parts",
        description: "Retrieve all lab parts with optional filtering and pagination"
      }
    }
  )

  // Create new part
  .post(
    "/",
    async ({ body, authPlugin, set }) => {
      try {
        const { u_id } = authPlugin ?? { u_id: "" };

        const newPart = await PartService.createPart(body, u_id);
        set.status = 201;
        return newPart;
      } catch (error) {
        set.status = 400;
        return { error: (error as Error).message };
      }
    },
    {
      body: PartCreateSchema,
      response: {
        400: t.Object({ error: t.String() }),
        401: t.Object({ error: t.String() })
      },
      detail: {
        tags: ["Parts"],
        summary: "Create new part",
        description: "Create a new lab part"
      }
    }
  )

  // Get part by ID
  .get(
    "/:id",
    async ({ params, set }) => {
      try {
        const part = await PartService.getPartById(params.id);

        if (!part) {
          set.status = 404;
          return { error: "Part not found" };
        }

        set.status = 200;
        return part;
      } catch (error) {
        set.status = 500;
        return { error: (error as Error).message };
      }
    },
    {
      params: t.Object({
        id: t.String({ description: "Part ID" })
      }),
      response: {
        404: t.Object({ error: t.String() }),
        500: t.Object({ error: t.String() })
      },
      detail: {
        tags: ["Parts"],
        summary: "Get part by ID",
        description: "Retrieve a specific part by its ID"
      }
    }
  )

  // Update part
  .put(
    "/:id",
    async ({ params, body, set }) => {
      try {
        const updatedPart = await PartService.updatePart(params.id, body);

        if (!updatedPart) {
          set.status = 404;
          return { error: "Part not found" };
        }

        set.status = 200;
        return updatedPart;
      } catch (error) {
        set.status = 400;
        return { error: (error as Error).message };
      }
    },
    {
      params: t.Object({
        id: t.String({ description: "Part ID" })
      }),
      body: PartUpdateSchema,
      response: {
        400: t.Object({ error: t.String() }),
        404: t.Object({ error: t.String() })
      },
      detail: {
        tags: ["Parts"],
        summary: "Update part",
        description: "Update a part by ID"
      }
    }
  )

  // Delete part
  .delete(
    "/:id",
    async ({ params, set }) => {
      try {
        const deletedPart = await PartService.deletePart(params.id);

        if (!deletedPart) {
          set.status = 404;
          return { error: "Part not found" };
        }

        set.status = 200;
        return { message: "Part deleted successfully", part: deletedPart };
      } catch (error) {
        set.status = 500;
        return { error: (error as Error).message };
      }
    },
    {
      params: t.Object({
        id: t.String({ description: "Part ID" })
      }),
      response: {
        404: t.Object({ error: t.String() }),
        500: t.Object({ error: t.String() })
      },
      detail: {
        tags: ["Parts"],
        summary: "Delete part",
        description: "Delete a part by ID"
      }
    }
  )

  // Get parts by lab ID
  .get(
    "/lab/:labId",
    async ({ params, query, set }) => {
      try {
        const { page, limit } = query;
        const result = await PartService.getPartsByLab(
          params.labId,
          page ? parseInt(page) : undefined,
          limit ? parseInt(limit) : undefined
        );

        set.status = 200;
        return result;
      } catch (error) {
        set.status = 500;
        return { error: (error as Error).message };
      }
    },
    {
      params: t.Object({
        labId: t.String({ description: "Lab ID" })
      }),
      query: t.Object({
        page: t.Optional(t.String({ description: "Page number" })),
        limit: t.Optional(t.String({ description: "Items per page" }))
      }),
      response: {
        500: t.Object({ error: t.String() })
      },
      detail: {
        tags: ["Parts"],
        summary: "Get parts by lab",
        description: "Get all parts for a specific lab"
      }
    }
  )

  // Get part statistics
  .get(
    "/statistics/:labId?",
    async ({ params, set }) => {
      try {
        const stats = await PartService.getPartStatistics(params.labId);
        set.status = 200;
        return stats;
      } catch (error) {
        set.status = 500;
        return { error: (error as Error).message };
      }
    },
    {
      params: t.Object({
        labId: t.Optional(t.String({ description: "Optional lab ID for lab-specific stats" }))
      }),
      response: {
        500: t.Object({ error: t.String() })
      },
      detail: {
        tags: ["Parts"],
        summary: "Get part statistics",
        description: "Get statistics about parts (optionally filtered by lab)"
      }
    }
  )

  // Auto-save functionality
  .post(
    "/:id/auto-save",
    async ({ params, body, set }) => {
      try {
        const { labId, content, field } = body;

        const result = await PartService.autoSavePart(
          params.id,
          labId,
          content,
          field
        );

        set.status = 200;
        return result;
      } catch (error) {
        set.status = 500;
        return { error: (error as Error).message };
      }
    },
    {
      params: t.Object({
        id: t.String({ description: "Part ID" })
      }),
      body: t.Object({
        labId: t.String(),
        content: RichContentSchema,
        field: t.String({ description: "Field name (instructions, description, etc.)" })
      }),
      response: {
        500: t.Object({ error: t.String() })
      },
      detail: {
        tags: ["Parts"],
        summary: "Auto-save rich content",
        description: "Auto-save functionality for rich content fields"
      }
    }
  )

  // Load auto-saved content
  .get(
    "/:id/auto-save/:field",
    async ({ params, query, set }) => {
      try {
        const { id, field } = params;
        const { labId } = query;

        const result = await PartService.loadAutoSave(
          id,
          labId as string,
          field
        );

        set.status = result.success ? 200 : 404;
        return result;
      } catch (error) {
        set.status = 500;
        return { error: (error as Error).message };
      }
    },
    {
      params: t.Object({
        id: t.String({ description: "Part ID" }),
        field: t.String({ description: "Field name (instructions, description, etc.)" })
      }),
      query: t.Object({
        labId: t.String()
      }),
      response: {
        404: t.Object({ success: t.Boolean(), message: t.String() }),
        500: t.Object({ error: t.String() })
      },
      detail: {
        tags: ["Parts"],
        summary: "Load auto-saved content",
        description: "Retrieve auto-saved content for a specific field"
      }
    }
  )

  // Get part with auto-save status
  .get(
    "/:id/with-autosave",
    async ({ params, query, set }) => {
      try {
        const { id } = params;
        const { labId } = query;

        const part = await PartService.getPartWithAutoSave(
          id,
          labId as string
        );

        if (!part) {
          set.status = 404;
          return { error: "Part not found" };
        }

        set.status = 200;
        return part;
      } catch (error) {
        set.status = 500;
        return { error: (error as Error).message };
      }
    },
    {
      params: t.Object({
        id: t.String({ description: "Part ID" })
      }),
      query: t.Object({
        labId: t.String()
      }),
      response: {
        404: t.Object({ error: t.String() }),
        500: t.Object({ error: t.String() })
      },
      detail: {
        tags: ["Parts"],
        summary: "Get part with auto-save status",
        description: "Retrieve part data along with auto-save status information"
      }
    }
  )

  // Asset cleanup
  .post(
    "/:id/cleanup-assets",
    async ({ params, body, set }) => {
      try {
        const { labId, currentAssets } = body;

        const result = await PartService.cleanupAssets(
          params.id,
          labId,
          currentAssets
        );

        set.status = 200;
        return result;
      } catch (error) {
        set.status = 500;
        return { error: (error as Error).message };
      }
    },
    {
      params: t.Object({
        id: t.String({ description: "Part ID" })
      }),
      body: t.Object({
        labId: t.String(),
        currentAssets: t.Array(t.String(), { description: "Array of currently used asset IDs" })
      }),
      response: {
        500: t.Object({ error: t.String() })
      },
      detail: {
        tags: ["Parts"],
        summary: "Clean up unused assets",
        description: "Remove unused assets from part"
      }
    }
  )

  // Duplicate a task to another part (or same part)
  .post(
    "/:id/tasks/:taskId/duplicate",
    async ({ params, body, authPlugin, set }) => {
      try {
        const { id: sourcePartId, taskId } = params;
        const { targetPartId, newTaskName } = body;

        const result = await PartService.duplicateTask(
          sourcePartId,
          taskId,
          targetPartId,
          newTaskName
        );

        set.status = 201;
        return result;
      } catch (error) {
        set.status = 400;
        return {
          success: false,
          error: (error as Error).message
        };
      }
    },
    {
      params: t.Object({
        id: t.String({ description: "Source part ID" }),
        taskId: t.String({ description: "Task ID to duplicate" })
      }),
      body: t.Object({
        targetPartId: t.String({ description: "Destination part ID (can be same as source)" }),
        newTaskName: t.Optional(t.String({ description: "Optional new name for duplicated task" }))
      }),
      response: {
        201: t.Object({
          success: t.Boolean(),
          duplicatedTask: t.Any(),
          targetPart: t.Any()
        }),
        400: t.Object({ success: t.Boolean(), error: t.String() })
      },
      detail: {
        tags: ["Parts"],
        summary: "Duplicate a task",
        description: "Duplicate a task to the same part or a different part within the same lab"
      }
    }
  )

  // Submit answers for fill-in-blank questions
  .post(
    "/submit-answers",
    async ({ body, authPlugin, set }) => {
      try {
        const { u_id } = authPlugin ?? { u_id: "" };
        const { labId, partId, answers, isUpdate, labSessionId } = body;

        // Get the part to access question definitions
        const parts = await PartService.getPartsByLab(labId);
        const part = parts.parts.find((p: any) => p.partId === partId);

        if (!part) {
          set.status = 404;
          return {
            success: false,
            message: 'Part not found'
          };
        }

        // Get lab for IP calculations (fetch once before processing)
        const LabModel = require('../labs/model').Lab;
        const lab = await LabModel.findById(labId);

        if (!lab) {
          set.status = 404;
          return {
            success: false,
            message: 'Lab not found'
          };
        }

        const labObjectId = new Types.ObjectId(labId);
        const activeSession = await StudentLabSessionService.getOrCreateSession(
          u_id,
          labObjectId,
          lab
        );

        if (labSessionId && activeSession.id?.toString() !== labSessionId) {
          console.warn(`[Fill-In-Blank] Session mismatch detected for student ${u_id} on lab ${labId}. Using active session ${activeSession.id} instead of provided ${labSessionId}.`);
        }

        // Calculate points based on actual question configuration
        const results = answers.map((answer: any) => {
          const question = part.questions?.find((q: any) => q.questionId === answer.questionId);

          if (!question) {
            return {
              questionId: answer.questionId,
              isCorrect: false,
              pointsEarned: 0
            };
          }

          if (answer.ipTableAnswers) {
            // IP Table questionnaire - validate each cell
            const studentAnswers = answer.ipTableAnswers; // 2D array of student answers
            let correctCells = 0;
            let totalCells = 0;
            let pointsEarned = 0;
            const cellDetails: Array<Array<{ isCorrect: boolean }>> = [];

            if (question.ipTableQuestionnaire?.cells) {
              question.ipTableQuestionnaire.cells.forEach((row: any[], rowIndex: number) => {
                if (!cellDetails[rowIndex]) {
                  cellDetails[rowIndex] = [];
                }
                row.forEach((cell: any, colIndex: number) => {
                  const cellType = cell.cellType || 'input';

                  if (cellType !== 'input') {
                    // Non-input cells are informational; auto-award their points if any
                    pointsEarned += cell.points || 0;
                    cellDetails[rowIndex][colIndex] = { isCorrect: true };
                    return;
                  }

                  totalCells++;

                  const studentAnswer = studentAnswers[rowIndex]?.[colIndex]?.trim() || '';
                  let expectedAnswer = '';

                  // Calculate expected answer based on cell configuration
                  if (cell.answerType === 'static' && cell.staticAnswer) {
                    expectedAnswer = cell.staticAnswer.trim();
                  } else if (cell.answerType === 'calculated' && cell.calculatedAnswer) {
                    try {
                      // Map session largeSubnetAllocation to AllocationResult interface
                      const alloc = activeSession.largeSubnetAllocation ? {
                        subnetIndex: activeSession.largeSubnetAllocation.allocatedSubnetIndex,
                        subnetCIDR: activeSession.largeSubnetAllocation.allocatedSubnetCIDR,
                        networkAddress: activeSession.largeSubnetAllocation.networkAddress,
                        randomizedVlanIds: activeSession.largeSubnetAllocation.randomizedVlanIds
                      } : undefined;
                      expectedAnswer = calculateCellAnswer(cell.calculatedAnswer, lab, u_id, alloc);
                      console.log(`[Cell Validation] Row ${rowIndex}, Col ${colIndex}:`, {
                        calculationType: cell.calculatedAnswer.calculationType,
                        expectedAnswer,
                        studentAnswer,
                        vlanIndex: cell.calculatedAnswer.vlanIndex,
                        deviceId: cell.calculatedAnswer.deviceId,
                        interfaceName: cell.calculatedAnswer.interfaceName
                      });
                    } catch (error) {
                      console.error(`[Cell Validation Error] Row ${rowIndex}, Col ${colIndex}:`, error);
                      expectedAnswer = '';
                    }
                  }

                  // Validate that both student answer and expected answer are non-empty
                  // Empty student answers should never be correct (no free points)
                  // Empty expected answers indicate a configuration error
                  let isCorrect = false;
                  if (studentAnswer.length === 0) {
                    // Empty student answer is always incorrect
                    isCorrect = false;
                    console.log(`[Cell Validation] Row ${rowIndex}, Col ${colIndex}: Empty student answer - marked incorrect`);
                  } else if (expectedAnswer.length === 0) {
                    // Empty expected answer indicates an error - don't award points
                    isCorrect = false;
                    console.log(`[Cell Validation] Row ${rowIndex}, Col ${colIndex}: Empty expected answer - marked incorrect`);
                  } else {
                    // Both have values, compare them
                    isCorrect = studentAnswer.toLowerCase() === expectedAnswer.toLowerCase();
                  }

                  if (cell.answerType === 'calculated' && cell.calculatedAnswer?.calculationType === 'vlan_lecturer_range') {
                    const calc = cell.calculatedAnswer;
                    const lecturerStart = calc.lecturerRangeStart ?? calc.lecturerOffset ?? null;
                    const lecturerEnd = calc.lecturerRangeEnd ?? calc.lecturerRangeStart ?? calc.lecturerOffset ?? null;

                    // Get subnet mask - handle Large Subnet Mode separately
                    let subnetMask: number;
                    const vlanConfig = lab.network?.vlanConfiguration;

                    if (vlanConfig?.mode === 'large_subnet' && vlanConfig.largeSubnetConfig) {
                      // Large Subnet Mode: get mask from subVlan's subnetSize
                      const subVlan = typeof calc.vlanIndex === 'number'
                        ? vlanConfig.largeSubnetConfig.subVlans?.[calc.vlanIndex]
                        : undefined;
                      subnetMask = subVlan?.subnetSize ?? lab.network?.topology?.subnetMask ?? 24;
                      console.log(`[Lecturer Range - Large Subnet] Using subVlan subnetSize:`, {
                        vlanIndex: calc.vlanIndex,
                        subVlanName: subVlan?.name,
                        subnetSize: subnetMask
                      });
                    } else {
                      // Regular VLAN mode
                      const vlan = typeof calc.vlanIndex === 'number'
                        ? vlanConfig?.vlans?.[calc.vlanIndex]
                        : undefined;
                      subnetMask = vlan?.subnetMask ?? lab.network?.topology?.subnetMask ?? 24;
                    }

                    // Reject empty student answers for range validation
                    if (studentAnswer.length === 0) {
                      isCorrect = false;
                    } else if (lecturerStart !== null && lecturerEnd !== null && expectedAnswer) {
                      const networkAddr = calculateNetworkAddress(expectedAnswer, subnetMask);
                      const networkNum = ipToNumber(networkAddr);
                      const studentNum = ipToNumber(studentAnswer);

                      if (!Number.isNaN(networkNum) && !Number.isNaN(studentNum)) {
                        const minNum = networkNum + lecturerStart;
                        const maxNum = networkNum + lecturerEnd;
                        isCorrect = studentNum >= minNum && studentNum <= maxNum;
                      } else {
                        isCorrect = false;
                      }
                    } else {
                      isCorrect = false;
                    }
                  }

                  // Special handling for IPv6 SLAAC cells - accept any valid IPv6 address
                  if (cell.answerType === 'calculated' && cell.calculatedAnswer?.calculationType === 'ipv6_slaac') {
                    // SLAAC assigns addresses dynamically, so we accept any valid IPv6 format
                    // Basic IPv6 validation: must have at least one colon and valid hex characters
                    const ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$|^([0-9a-fA-F]{0,4}:){1,7}:$|^:(:([0-9a-fA-F]{0,4})){1,7}$|^([0-9a-fA-F]{0,4}:){1,6}:[0-9a-fA-F]{0,4}$|^::([fF]{4}:)?(\d{1,3}\.){3}\d{1,3}$/;
                    const isValidIPv6 = studentAnswer.includes(':') && (
                      ipv6Regex.test(studentAnswer) ||
                      // Also accept common compressed formats like 2001:db8::1
                      /^[0-9a-fA-F:]+$/.test(studentAnswer)
                    );

                    isCorrect = isValidIPv6 && studentAnswer.length > 0;

                    console.log(`[IPv6 SLAAC Validation] Row ${rowIndex}, Col ${colIndex}:`, {
                      studentAnswer,
                      isValidIPv6,
                      isCorrect
                    });
                  }

                  cellDetails[rowIndex][colIndex] = { isCorrect };

                  if (isCorrect) {
                    correctCells++;
                    pointsEarned += cell.points || 0;
                  }
                });
              });
            }

            // DEBUG: Log all expected answers in a formatted table
            console.log('\n========================================');
            console.log('[DEBUG] IP Table Questionnaire - Correct Answers');
            console.log('========================================');
            console.log(`Question ID: ${answer.questionId}`);
            console.log(`Student ID: ${u_id}`);
            console.log('');

            // Build and log the expected answers table
            if (question.ipTableQuestionnaire?.cells) {
              const rows = question.ipTableQuestionnaire.rows || [];
              const columns = question.ipTableQuestionnaire.columns || [];

              // Print column headers
              const headerLabels = columns.map((col: any) => col.label || col.columnId);
              console.log('Row'.padEnd(25) + ' | ' + headerLabels.map((h: string) => h.padEnd(20)).join(' | '));
              console.log('-'.repeat(25 + (22 * columns.length)));

              question.ipTableQuestionnaire.cells.forEach((row: any[], rowIndex: number) => {
                const rowInfo = rows[rowIndex];
                const rowLabel = rowInfo?.displayName || `Row ${rowIndex + 1}`;

                const cellValues: string[] = [];
                row.forEach((cell: any, colIndex: number) => {
                  const cellType = cell.cellType || 'input';
                  let displayValue = '';

                  if (cellType === 'readonly') {
                    displayValue = `[RO] ${cell.readonlyContent || ''}`;
                  } else if (cellType === 'blank') {
                    displayValue = '[BLANK]';
                  } else if (cellType === 'input') {
                    if (cell.answerType === 'static') {
                      displayValue = cell.staticAnswer || '';
                    } else if (cell.answerType === 'calculated') {
                      try {
                        // Map session largeSubnetAllocation to AllocationResult interface
                        const allocDisplay = activeSession.largeSubnetAllocation ? {
                          subnetIndex: activeSession.largeSubnetAllocation.allocatedSubnetIndex,
                          subnetCIDR: activeSession.largeSubnetAllocation.allocatedSubnetCIDR,
                          networkAddress: activeSession.largeSubnetAllocation.networkAddress,
                          randomizedVlanIds: activeSession.largeSubnetAllocation.randomizedVlanIds
                        } : undefined;
                        displayValue = calculateCellAnswer(cell.calculatedAnswer, lab, u_id, allocDisplay);
                      } catch (err) {
                        displayValue = `[ERROR: ${(err as Error).message}]`;
                      }
                    }
                  }

                  cellValues.push(displayValue.padEnd(20));
                });

                console.log(rowLabel.padEnd(25) + ' | ' + cellValues.join(' | '));
              });
            }

            console.log('\n----------------------------------------');
            console.log(`Correct Cells: ${correctCells}/${totalCells}`);
            console.log(`Points Earned: ${pointsEarned}`);
            console.log('========================================\n');

            return {
              questionId: answer.questionId,
              isCorrect: correctCells === totalCells,
              pointsEarned,
              correctCells,
              totalCells,
              cellDetails
            };
          } else {
            // Regular question - use question points
            return {
              questionId: answer.questionId,
              isCorrect: true, // TODO: Implement actual validation
              pointsEarned: question.points || 0
            };
          }
        });

        const totalPointsEarned = results.reduce((sum: number, r: any) => sum + r.pointsEarned, 0);
        const totalPoints = part.totalPoints || totalPointsEarned;

        // Build fill-in-blank submission summary
        const questionSummaries = (part.questions || []).map((question: any) => {
          const answerPayload = answers.find((a: any) => a.questionId === question.questionId) || {};
          const questionResult = results.find((r: any) => r.questionId === question.questionId);

          const summary: IFillInBlankQuestionResult = {
            questionId: question.questionId,
            questionText: question.questionText,
            questionType: question.questionType,
            pointsEarned: questionResult?.pointsEarned || 0,
            pointsPossible: question.points || 0,
            isCorrect: questionResult?.isCorrect || false,
            studentAnswer: typeof answerPayload.answer === 'string' ? answerPayload.answer : null,
            ipTableAnswers: answerPayload.ipTableAnswers,
            cellResults: undefined
          };

          if (questionResult && typeof questionResult.correctCells === 'number') {
            summary.correctCells = questionResult.correctCells;
          }
          if (questionResult && typeof questionResult.totalCells === 'number') {
            summary.totalCells = questionResult.totalCells;
          }
          if (question.questionType === 'ip_table_questionnaire' && questionResult?.cellDetails) {
            const studentTableAnswers: string[][] = answerPayload.ipTableAnswers || [];
            const cellResults: Array<Array<{ isCorrect?: boolean; answer: string | null }>> = [];

            studentTableAnswers.forEach((row: string[], rowIndex: number) => {
              cellResults[rowIndex] = [];
              row.forEach((value, colIndex) => {
                const cellInfo = questionResult.cellDetails?.[rowIndex]?.[colIndex];
                cellResults[rowIndex][colIndex] = {
                  isCorrect: cellInfo?.isCorrect,
                  answer: value ?? null
                };
              });
            });

            summary.cellResults = cellResults;
          }

          return summary;
        });

        const answersMap = answers.reduce((acc: Record<string, any>, item: any) => {
          acc[item.questionId] = item.ipTableAnswers ?? item.answer ?? null;
          return acc;
        }, {});

        const submissionRecord = await SubmissionService.recordFillInBlankSubmission({
          studentId: u_id,
          labId,
          partId,
          summary: {
            totalPointsEarned,
            totalPoints,
            passed: totalPoints === 0 ? true : totalPointsEarned === totalPoints,
            questions: questionSummaries
          },
          answersMap,
          labSessionId: activeSession.id?.toString(),
          labAttemptNumber: activeSession.attemptNumber
        });

        set.status = 200;
        return {
          success: true,
          data: {
            results,
            passed: totalPointsEarned === totalPoints,
            totalPointsEarned,
            totalPoints,
            message: totalPointsEarned === totalPoints
              ? 'All answers correct!'
              : 'Some answers were incorrect'
          },
          submission: {
            id: submissionRecord._id?.toString(),
            attempt: submissionRecord.attempt,
            status: submissionRecord.status,
            submittedAt: submissionRecord.submittedAt,
            labSessionId: submissionRecord.labSessionId?.toString?.() ?? activeSession.id?.toString(),
            labAttemptNumber: submissionRecord.labAttemptNumber ?? activeSession.attemptNumber
          }
        };
      } catch (error) {
        console.error("Error submitting answers:", error);
        set.status = 500;
        return {
          success: false,
          message: `Failed to submit answers: ${(error as Error).message}`
        };
      }
    },
    {
      body: t.Object({
        labId: t.String(),
        partId: t.String(),
        answers: t.Array(t.Object({
          questionId: t.String(),
          answer: t.Union([t.String(), t.Null()]),
          ipTableAnswers: t.Optional(t.Array(t.Array(t.String())))
        })),
        isUpdate: t.Boolean(),
        labSessionId: t.Optional(t.String())
      }),
      detail: {
        tags: ["Parts"],
        summary: "Submit fill-in-blank answers",
        description: "Submit student answers for fill-in-blank questions"
      }
    }
  )

  // Test endpoint for all calculation types
  .get(
    "/test-calculations/:labId",
    async ({ params, query, set }) => {
      try {
        const { labId } = params;
        const studentId = query.studentId || "65070041"; // Default test student ID

        // Get lab
        const LabModel = require('../labs/model').Lab;
        const lab = await LabModel.findById(labId);

        if (!lab) {
          set.status = 404;
          return {
            success: false,
            message: 'Lab not found'
          };
        }

        console.log('\n========================================');
        console.log('🧪 TESTING ALL CALCULATION TYPES');
        console.log('========================================\n');
        console.log(`Student ID: ${studentId}`);
        console.log(`Lab: ${lab.name} (${labId})`);
        console.log(`VLANs configured: ${lab.network?.vlanConfiguration?.vlans?.length || 0}\n`);

        const results: any = {
          studentId,
          labId,
          labName: lab.name,
          vlanConfiguration: {
            mode: lab.network?.vlanConfiguration?.mode,
            vlanCount: lab.network?.vlanConfiguration?.vlanCount,
            vlans: lab.network?.vlanConfiguration?.vlans || []
          },
          devices: lab.network?.devices || [],
          calculationTests: []
        };

        // Test 1: Device Interface IPs
        console.log('📍 Test 1: Device Interface IPs');
        console.log('─'.repeat(50));
        for (const device of lab.network?.devices || []) {
          for (const ipVar of device.ipVariables || []) {
            try {
              const calcAnswer = {
                calculationType: 'device_interface_ip',
                deviceId: device.deviceId,
                interfaceName: ipVar.name
              };
              const result = calculateCellAnswer(calcAnswer, lab, studentId);
              results.calculationTests.push({
                type: 'device_interface_ip',
                device: device.deviceId,
                interface: ipVar.name,
                result,
                status: 'success'
              });
              console.log(`✅ ${device.deviceId}.${ipVar.name}: ${result}`);
            } catch (error: any) {
              results.calculationTests.push({
                type: 'device_interface_ip',
                device: device.deviceId,
                interface: ipVar.name,
                error: error.message,
                status: 'failed'
              });
              console.log(`❌ ${device.deviceId}.${ipVar.name}: ${error.message}`);
            }
          }
        }

        // Test 2-9: VLAN-based calculations (if VLANs exist)
        const vlans = lab.network?.vlanConfiguration?.vlans || [];
        if (vlans.length > 0) {
          const vlanCalcTypes = [
            { type: 'vlan_network_address', label: 'Network Address' },
            { type: 'vlan_broadcast', label: 'Broadcast Address' },
            { type: 'vlan_first_usable', label: 'First Usable IP' },
            { type: 'vlan_last_usable', label: 'Last Usable IP' },
            { type: 'vlan_subnet_mask', label: 'Subnet Mask' },
            { type: 'vlan_id', label: 'VLAN ID' },
            { type: 'vlan_lecturer_offset', label: 'Lecturer Offset IP' },
            { type: 'vlan_lecturer_range', label: 'Lecturer Range IP' }
          ];

          for (const vlanCalc of vlanCalcTypes) {
            console.log(`\n📍 Test: ${vlanCalc.label}`);
            console.log('─'.repeat(50));

            for (let vlanIndex = 0; vlanIndex < vlans.length; vlanIndex++) {
              try {
                const calcAnswer: any = {
                  calculationType: vlanCalc.type,
                  vlanIndex,
                  lecturerOffset: 5 // Test with offset 5
                };
                const result = calculateCellAnswer(calcAnswer, lab, studentId);
                results.calculationTests.push({
                  type: vlanCalc.type,
                  vlanIndex,
                  vlanId: vlans[vlanIndex].vlanId,
                  result,
                  status: 'success'
                });
                console.log(`✅ VLAN ${vlanIndex} (ID: ${vlans[vlanIndex].vlanId || 'calculated'}): ${result}`);
              } catch (error: any) {
                results.calculationTests.push({
                  type: vlanCalc.type,
                  vlanIndex,
                  error: error.message,
                  status: 'failed'
                });
                console.log(`❌ VLAN ${vlanIndex}: ${error.message}`);
              }
            }
          }
        }

        console.log('\n========================================');
        console.log('✅ CALCULATION TESTS COMPLETED');
        console.log('========================================\n');

        const successCount = results.calculationTests.filter((t: any) => t.status === 'success').length;
        const failedCount = results.calculationTests.filter((t: any) => t.status === 'failed').length;

        console.log(`Total Tests: ${results.calculationTests.length}`);
        console.log(`✅ Passed: ${successCount}`);
        console.log(`❌ Failed: ${failedCount}\n`);

        set.status = 200;
        return {
          success: true,
          summary: {
            totalTests: results.calculationTests.length,
            passed: successCount,
            failed: failedCount
          },
          data: results
        };
      } catch (error) {
        console.error("Error testing calculations:", error);
        set.status = 500;
        return {
          success: false,
          message: `Failed to test calculations: ${(error as Error).message}`
        };
      }
    },
    {
      params: t.Object({
        labId: t.String()
      }),
      query: t.Object({
        studentId: t.Optional(t.String())
      }),
      detail: {
        tags: ["Parts"],
        summary: "Test all IP calculation types",
        description: "Comprehensive test of all calculation types for a given lab and student ID"
      }
    }
  );

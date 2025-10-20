import { Elysia, t } from "elysia";
import { PartService } from "./service";
import { authPlugin, requireRole } from "../../plugins/plugins";
import {
  calculateStudentIdBasedIP,
  calculateAdvancedStudentIP,
  calculateStudentVLANs
} from "../submissions/ip-calculator";

// Rich content schema
const RichContentSchema = t.Object({
  html: t.String(),
  json: t.Any()
});

// IP Table Questionnaire Schema
const IpTableQuestionnaireSchema = t.Object({
  tableId: t.String(),
  rowCount: t.Number(),
  columnCount: t.Number(),
  columns: t.Array(t.Object({
    columnId: t.String(),
    label: t.String(),
    order: t.Number()
  })),
  rows: t.Array(t.Object({
    rowId: t.String(),
    deviceId: t.String(),
    interfaceName: t.String(),
    displayName: t.String(),
    order: t.Number()
  })),
  cells: t.Array(t.Array(t.Object({
    cellId: t.String(),
    rowId: t.String(),
    columnId: t.String(),
    answerType: t.Union([t.Literal('static'), t.Literal('calculated')]),
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
        t.Literal('vlan_id')
      ]),
      vlanIndex: t.Optional(t.Number()),
      lecturerOffset: t.Optional(t.Number()),
      lecturerRangeStart: t.Optional(t.Number()),
      lecturerRangeEnd: t.Optional(t.Number()),
      deviceId: t.Optional(t.String()),
      interfaceName: t.Optional(t.String())
    })),
    points: t.Number(),
    autoCalculated: t.Boolean()
  })))
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
      comparison_type: t.String({ description: "Type of comparison: equals, contains, regex, success, ssh_success, greater_than" }),
      expected_result: t.Any({ description: "Expected value/result for comparison" })
    })),
    order: t.Number(),
    points: t.Number()
  })),
  task_groups: t.Array(t.Object({
    group_id: t.String(),
    title: t.String(),
    description: t.String({ default: "" }),
    group_type: t.Union([t.Literal("all_or_nothing"), t.Literal("proportional")]),
    points: t.Number(),
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
      comparison_type: t.String({ description: "Type of comparison: equals, contains, regex, success, ssh_success, greater_than" }),
      expected_result: t.Any({ description: "Expected value/result for comparison" })
    })),
    order: t.Number(),
    points: t.Number()
  }))),
  task_groups: t.Array(t.Object({
    group_id: t.String(),
    title: t.String(),
    description: t.String({ default: "" }),
    group_type: t.Union([t.Literal("all_or_nothing"), t.Literal("proportional")]),
    points: t.Number(),
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
function calculateCellAnswer(calculatedAnswer: any, lab: any, studentId: string): string {
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

    // Regular (non-VLAN) interface - use basic calculation with hostOffset
    return calculateStudentIdBasedIP(baseNetwork, studentId, ipVariable.hostOffset);
  }

  // Handle VLAN-based calculations (for network addresses, broadcast, etc.)
  if (vlanIndex !== undefined && calculationType !== 'device_interface_ip') {
    // Get VLAN configuration from lab (VLANs are in vlanConfiguration.vlans)
    const vlans = lab.network?.vlanConfiguration?.vlans || [];

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
        case 'vlan_subnet_mask': {
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
      case 'vlan_subnet_mask': {
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

  // Submit answers for fill-in-blank questions
  .post(
    "/submit-answers",
    async ({ body, authPlugin, set }) => {
      try {
        const { u_id } = authPlugin ?? { u_id: "" };
        const { labId, partId, answers, isUpdate } = body;

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

            if (question.ipTableQuestionnaire?.cells) {
              question.ipTableQuestionnaire.cells.forEach((row: any[], rowIndex: number) => {
                row.forEach((cell: any, colIndex: number) => {
                  totalCells++;
                  const studentAnswer = studentAnswers[rowIndex]?.[colIndex]?.trim() || '';
                  let expectedAnswer = '';

                  // Calculate expected answer based on cell configuration
                  if (cell.answerType === 'static' && cell.staticAnswer) {
                    expectedAnswer = cell.staticAnswer.trim();
                  } else if (cell.answerType === 'calculated' && cell.calculatedAnswer) {
                    try {
                      expectedAnswer = calculateCellAnswer(cell.calculatedAnswer, lab, u_id);
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

                  // Compare answers (case-insensitive IP comparison)
                  const isCorrect = studentAnswer.toLowerCase() === expectedAnswer.toLowerCase();

                  if (isCorrect) {
                    correctCells++;
                    pointsEarned += cell.points || 0;
                  }
                });
              });
            }

            return {
              questionId: answer.questionId,
              isCorrect: correctCells === totalCells,
              pointsEarned,
              correctCells,
              totalCells
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
        isUpdate: t.Boolean()
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
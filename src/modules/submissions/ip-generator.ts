import { ILab } from '../labs/model';
import { ILabPart } from '../parts/model';
import { TaskTemplateService } from '../task-templates/service';
import { DeviceTemplateService } from '../device-templates/service';
import { StudentLabSessionService } from '../student-lab-sessions/service';
import { GNS3Node } from '../gns3-student-lab/service';
import { Types } from 'mongoose';
import { env } from 'process';
import {
  calculateStudentIdBasedIP,
  calculateAdvancedStudentIP,
  calculateStudentVLANs
} from './ip-calculator';
import {
  generateStudentIPv6Address,
  generateLinkLocalAddress,
  getVlanAlphabet
} from './ipv6-calculator';
import {
  generateIPv6FromTemplate,
  calculateStudentVariables
} from './ipv6-config';

interface GeneratedDevice {
  id: string;
  ip_address: string;
  port: number;
  connection_type: string;
  platform: string;
  device_os: string;
  credentials: Record<string, string>;
  role: string;
}

export interface LecturerRangeOverridePayload {
  key: string;
  ip: string;
  metadata: {
    sourcePartId: string;
    questionId: string;
    rowIndex: number;
    colIndex: number;
    lecturerRangeStart: number;
    lecturerRangeEnd: number;
    deviceId?: string;
    interfaceName?: string;
    vlanIndex?: number;
  };
}

const ipToNumber = (ip: string): number => {
  const octets = ip.split('.').map(Number);
  if (octets.length !== 4 || octets.some(octet => Number.isNaN(octet) || octet < 0 || octet > 255)) {
    return Number.NaN;
  }
  return ((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3];
};

const numberToIp = (num: number): string => {
  return [
    (num >>> 24) & 255,
    (num >>> 16) & 255,
    (num >>> 8) & 255,
    num & 255
  ].join('.');
};

const normalizeInterfaceName = (name: string): string => {
  if (!name) return name;

  let normalized = name
    .replace(/\s+/g, '')
    .replace(/GigabitEthernet/gi, 'gig')
    .replace(/FastEthernet/gi, 'fa')
    .replace(/Ethernet/gi, 'eth')
    .replace(/Loopback/gi, 'loopback')
    .replace(/Serial/gi, 'serial')
    .replace(/Port-channel/gi, 'po')
    .replace(/InterfaceVlan/gi, 'interfacevlan')
    .replace(/Vlan/gi, 'vlan')
    .replace(/-/g, '_')
    .replace(/\./g, '_')
    .replace(/\//g, '_')
    .toLowerCase();

  normalized = normalized.replace(/__+/g, '_');

  return normalized;
};

const normalizeOverrideKey = (key: string): string => {
  const [deviceId, interfaceName] = key.split('.');
  if (!deviceId || !interfaceName) {
    return key;
  }
  return `${deviceId}.${normalizeInterfaceName(interfaceName)}`;
};

export class IPGenerator {
  /**
   * Generate IP address based on inputType
   * NOTE: This now calculates ACTUAL IPs for VLAN interfaces (not placeholders)
   * Management IPs are resolved at submission time using StudentLabSession
   */
  static generateIP(
    ipVariable: {
      inputType: string;
      fullIp?: string;
      isManagementInterface?: boolean;
      isVlanInterface?: boolean;
      vlanIndex?: number;
      interfaceOffset?: number;
    },
    lab: ILab,
    studentId: string,
    managementIp?: string
  ): string {
    // For fullIP type, use it directly
    if (ipVariable.inputType === 'fullIP' && ipVariable.fullIp) {
      return ipVariable.fullIp;
    }

    // For Management IPs, use the resolved IP from StudentLabSession
    if (ipVariable.inputType === 'studentManagement' && ipVariable.isManagementInterface) {
      if (managementIp) {
        return managementIp;
      }
      // Fallback placeholder if not provided (shouldn't happen)
      throw new Error('Management IP not provided for studentManagement interface');
    }

    // For VLAN IPs, calculate actual IP based on VLAN configuration
    if (ipVariable.inputType.startsWith('studentVlan')) {
      if (!ipVariable.isVlanInterface || ipVariable.vlanIndex === undefined) {
        throw new Error(`Invalid VLAN interface configuration for ${ipVariable.inputType}`);
      }

      // Check if lab has VLAN configuration
      if (!lab.network.vlanConfiguration || !lab.network.vlanConfiguration.vlans) {
        throw new Error('Lab does not have VLAN configuration');
      }

      const vlan = lab.network.vlanConfiguration.vlans[ipVariable.vlanIndex];
      if (!vlan) {
        throw new Error(`VLAN at index ${ipVariable.vlanIndex} not found`);
      }

      const interfaceOffset = ipVariable.interfaceOffset || 1;

      // Choose algorithm based on VLAN mode and configuration
      if (vlan.calculationMultiplier !== undefined) {
        // Use advanced algorithm for calculated VLANs
        return calculateAdvancedStudentIP(
          studentId,
          {
            baseNetwork: vlan.baseNetwork,
            calculationMultiplier: vlan.calculationMultiplier,
            subnetMask: vlan.subnetMask,
            subnetIndex: vlan.subnetIndex
          },
          interfaceOffset
        );
      } else {
        // Use basic student ID-based algorithm
        return calculateStudentIdBasedIP(
          vlan.baseNetwork,
          studentId,
          interfaceOffset
        );
      }
    }

    throw new Error(`Unable to generate IP for inputType: ${ipVariable.inputType}`);
  }

  /**
   * Generate IPv6 address based on ipv6InputType
   * Uses the configurable template from lab.network.ipv6Config.template
   * Default template: 2001:{X}:{Y}:{VLAN}::{offset}/64
   */
  static generateIPv6(
    ipVariable: {
      ipv6InputType?: string;
      fullIpv6?: string;
      ipv6InterfaceId?: string;
      ipv6VlanIndex?: number;
      isIpv6Variable?: boolean;
    },
    lab: ILab,
    studentId: string,
    vlanMappings: Record<string, number>
  ): string | null {
    // Skip if not an IPv6 variable
    if (!ipVariable.isIpv6Variable && !ipVariable.ipv6InputType) {
      return null;
    }

    // For fullIPv6 type, use it directly
    if (ipVariable.ipv6InputType === 'fullIPv6' && ipVariable.fullIpv6) {
      return ipVariable.fullIpv6;
    }

    // For link-local address
    if (ipVariable.ipv6InputType === 'linkLocal') {
      const interfaceId = ipVariable.ipv6InterfaceId || '1';
      return generateLinkLocalAddress(interfaceId);
    }

    // For VLAN IPv6 addresses (studentVlan6_0 through studentVlan6_9)
    if (ipVariable.ipv6InputType?.startsWith('studentVlan6_')) {
      // Extract VLAN index from type (studentVlan6_0 -> 0)
      const vlanIndex = parseInt(ipVariable.ipv6InputType.replace('studentVlan6_', ''), 10);
      if (isNaN(vlanIndex)) {
        throw new Error(`Invalid IPv6 VLAN input type: ${ipVariable.ipv6InputType}`);
      }

      // Get VLAN ID from vlanMappings
      const vlanKey = `vlan${vlanIndex}`;
      const vlanId = vlanMappings[vlanKey];
      if (vlanId === undefined) {
        throw new Error(`VLAN ID not found for ${vlanKey}`);
      }

      // Get interface identifier (offset) from lecturer config or default to 1
      const interfaceOffset = parseInt(ipVariable.ipv6InterfaceId || '1', 10) || 1;

      // Check if lab has IPv6 template configuration
      const ipv6Config = lab.network.ipv6Config;
      if (ipv6Config?.enabled && ipv6Config.template) {
        // Use template-based generation
        return generateIPv6FromTemplate(
          ipv6Config.template,
          studentId,
          vlanId.toString(),
          interfaceOffset
        );
      } else {
        // Fallback: Use legacy format for backward compatibility
        // Format: 2001:<VLAN_Alphabet><VLAN_ID>:<Last3StudentID>::<offset>/64
        return generateStudentIPv6Address(studentId, vlanIndex, vlanId, interfaceOffset.toString());
      }
    }

    return null;
  }

  /**
   * Find management interface for a device
   */
  static findManagementInterface(device: ILab['network']['devices'][0]) {
    // Look for isManagementInterface flag first
    const managementByFlag = device.ipVariables.find(ip => ip.isManagementInterface === true);
    if (managementByFlag) return managementByFlag;

    // Fallback: Convention-based detection for management interfaces
    const managementByName = device.ipVariables.find(ip =>
      /^(mgmt|management|oob)/i.test(ip.name) ||
      (ip.interface && /management|mgmt/i.test(ip.interface))
    );
    if (managementByName) return managementByName;

    // Last resort: Use first interface as fallback
    return device.ipVariables[0] || null;
  }

  /**
   * Get device platform from device template
   */
  static async getPlatformFromTemplate(templateId: string): Promise<string> {
    try {
      const template = await DeviceTemplateService.getDeviceTemplateById(templateId);
      return template?.platform || 'cisco_ios'; // Default fallback
    } catch (error) {
      console.warn(`Failed to get platform from template ${templateId}, using default:`, error);
      return 'cisco_ios'; // Default fallback
    }
  }

  /**
   * Determine platform for netmiko based on connectionType and template platform
   * 
   * | connectionType | platform (if cisco_ios) | platform (if linux) |
   * |----------------|-------------------------|---------------------|
   * | `console`      | `generic_termserver_telnet` | `generic_termserver_telnet` |
   * | `ssh`          | `cisco_ios`             | `linux`             |
   * | `telnet`       | `cisco_ios_telnet`      | `generic_telnet`    |
   */
  static mapPlatform(connectionType: 'ssh' | 'telnet' | 'console' | undefined, templatePlatform: string): string {
    const connType = connectionType || 'console';
    const isCiscoIOS = templatePlatform.toLowerCase().includes('cisco_ios');

    switch (connType) {
      case 'console':
        return isCiscoIOS ? 'cisco_ios_telnet' : 'generic_telnet';
      case 'ssh':
        return isCiscoIOS ? 'cisco_ios' : templatePlatform;
      case 'telnet':
        return isCiscoIOS ? 'cisco_ios_telnet' : 'generic_telnet';
      default:
        return 'generic_termserver_telnet';
    }
  }

  /**
   * Generate devices array for grading job
   * Now accepts GNS3 nodes to map console/aux ports
   * @param gns3ServerIp - The user's assigned GNS3 server IP for console connections
   */
  static async generateDevices(
    lab: ILab,
    studentId: string,
    managementIp: string,
    gns3Nodes?: GNS3Node[],
    overrideMap?: Map<string, string>,
    gns3ServerIp?: string
  ): Promise<GeneratedDevice[]> {
    const devices: GeneratedDevice[] = [];

    // Build node lookup map by name for efficient matching
    const nodeMap = new Map<string, GNS3Node>();
    if (gns3Nodes) {
      for (const node of gns3Nodes) {
        nodeMap.set(node.name, node);
      }
    }

    for (const labDevice of lab.network.devices) {
      const managementInterface = this.findManagementInterface(labDevice);

      if (!managementInterface) {
        console.warn(`No management interface found for device ${labDevice.deviceId}`);
        continue;
      }

      let resolvedManagementIP = this.generateIP(
        managementInterface,
        lab,
        studentId,
        managementIp
      );

      if (managementInterface.name) {
        const overrideKey = `${labDevice.deviceId}.${managementInterface.name}`;
        const normalizedOverrideKey = normalizeOverrideKey(overrideKey);

        if (overrideMap?.has(overrideKey)) {
          resolvedManagementIP = overrideMap.get(overrideKey) as string;
        } else if (overrideMap?.has(normalizedOverrideKey)) {
          resolvedManagementIP = overrideMap.get(normalizedOverrideKey) as string;
        }
      }

      // Get template platform (device_os)
      const templatePlatform = await this.getPlatformFromTemplate(labDevice.templateId.toString());

      // Look up GNS3 node by deviceId to get console/aux port
      const gns3Node = nodeMap.get(labDevice.deviceId);

      let port = 0;
      if (gns3Node) {
        port = gns3Node.console ?? 0;
        console.log(`[Device Mapping] ${labDevice.deviceId} -> GNS3 node "${gns3Node.name}" (port: ${port}, aux: ${gns3Node.aux}, console: ${gns3Node.console})`);
      } else if (gns3Nodes && gns3Nodes.length > 0) {
        console.warn(`[Device Mapping] No GNS3 node found for device "${labDevice.deviceId}"`);
      }

      // Map platform based on connectionType and template platform
      const platform = this.mapPlatform(labDevice.connectionType, templatePlatform);

      // For console connections, use GNS3 server IP instead of device management IP
      const connectionType = labDevice.connectionType || 'console';
      const ipAddress = connectionType === 'console'
        ? (gns3ServerIp || env.GNS3_SERVER || 'localhost')
        : resolvedManagementIP;

      const device: GeneratedDevice = {
        id: labDevice.deviceId,
        ip_address: ipAddress,
        port,
        connection_type: connectionType,
        platform,
        device_os: templatePlatform,
        credentials: {
          username: labDevice.credentials.usernameTemplate,
          password: labDevice.credentials.passwordTemplate,
          ...(labDevice.credentials.enablePassword && {
            enable_pass: labDevice.credentials.enablePassword
          })
        },
        role: 'direct'
      };

      devices.push(device);
    }

    return devices;
  }

  /**
   * Generate IP mappings for task parameters
   * Returns mapping of device.variableName to IP address and VLAN ID
   * Format: { "router1.gig0_1": { ip: "172.40.210.65", vlan: 210 } }
   */
  static generateIPMappings(
    lab: ILab,
    studentId: string,
    managementIp: string,
    overrideMap?: Map<string, string>
  ): Record<string, { ip: string; vlan: number | null }> {
    const mappings: Record<string, { ip: string; vlan: number | null }> = {};

    // First, get VLAN mappings to map VLAN index to actual VLAN ID
    const vlanMappings = this.generateVLANMappings(lab, studentId);

    for (const device of lab.network.devices) {
      for (const ipVar of device.ipVariables) {
        let ip = this.generateIP(ipVar, lab, studentId, managementIp);

        // Determine VLAN ID if this is a VLAN interface
        let vlanId: number | null = null;
        if (ipVar.isVlanInterface && ipVar.vlanIndex !== undefined) {
          const vlanKey = `vlan${ipVar.vlanIndex}`;
          vlanId = vlanMappings[vlanKey] ?? null;
        }

        // Create mapping with device.variableName format (e.g., "router1.loopback0")
        const key = `${device.deviceId}.${ipVar.name}`;
        const normalizedKey = normalizeOverrideKey(key);

        if (overrideMap?.has(key)) {
          ip = overrideMap.get(key) as string;
        } else if (overrideMap?.has(normalizedKey)) {
          ip = overrideMap.get(normalizedKey) as string;
        }

        mappings[key] = { ip, vlan: vlanId };
      }
    }

    return mappings;
  }

  /**
   * Generate VLAN ID mappings for task parameters
   * Returns mapping of vlanX to actual VLAN ID using dec3-based calculation
   * (e.g., {"vlan0": 210, "vlan1": 117})
   */
  static generateVLANMappings(lab: ILab, studentId: string): Record<string, number> {
    const mappings: Record<string, number> = {};

    // Only generate VLAN mappings if lab has VLAN configuration
    if (!lab.network.vlanConfiguration || !lab.network.vlanConfiguration.vlans) {
      return mappings;
    }

    const vlanConfig = lab.network.vlanConfiguration;

    // Generate VLAN IDs based on mode
    if (vlanConfig.mode === 'calculated_vlan') {
      // For calculated_vlan mode, extract multipliers and calculate VLAN IDs using dec3
      const multipliers = vlanConfig.vlans
        .map(vlan => vlan.calculationMultiplier)
        .filter((m): m is number => m !== undefined);

      if (multipliers.length > 0) {
        const vlanIds = calculateStudentVLANs(studentId, multipliers);

        for (let i = 0; i < vlanIds.length; i++) {
          mappings[`vlan${i}`] = vlanIds[i];
        }
      }
    } else if (vlanConfig.mode === 'fixed_vlan') {
      // For fixed_vlan mode, use the vlanId from configuration
      for (let i = 0; i < vlanConfig.vlans.length; i++) {
        const vlan = vlanConfig.vlans[i];
        if (vlan.vlanId !== undefined) {
          mappings[`vlan${i}`] = vlan.vlanId;
        }
      }
    }
    // Note: lecturer_group mode is for future group-based implementation

    return mappings;
  }

  /**
   * Generate IPv6 address mappings for task parameters
   * Returns mapping of device.variableName to IPv6 address
   * Format: { "router1.gig0_1": "2001:db8:1::1/64" }
   */
  static generateIPv6Mappings(
    lab: ILab,
    studentId: string,
    vlanMappings: Record<string, number>
  ): Record<string, string> {
    const mappings: Record<string, string> = {};

    for (const device of lab.network.devices) {
      for (const ipVar of device.ipVariables) {
        // Generate IPv6 address if the interface has IPv6 configuration
        const ipv6Address = this.generateIPv6(
          {
            ipv6InputType: ipVar.ipv6InputType,
            fullIpv6: ipVar.fullIpv6,
            ipv6InterfaceId: ipVar.ipv6InterfaceId,
            ipv6VlanIndex: ipVar.ipv6VlanIndex,
            isIpv6Variable: ipVar.isIpv6Variable
          },
          lab,
          studentId,
          vlanMappings
        );

        if (ipv6Address) {
          // Create mapping with device.variableName format (e.g., "router1.eth0")
          const key = `${device.deviceId}.${ipVar.name}`;
          // Strip subnet prefix (e.g., /64) from the IPv6 address
          mappings[key] = ipv6Address.split('/')[0];
        }
      }
    }

    return mappings;
  }

  /**
   * Transform task parameters to replace IP variables with actual IPs
   * Variable format: {{device.interface}}, {{device.interface:ipv6}}, or {{variable}}
   */
  static transformTaskParameters(
    parameters: Record<string, any>,
    ipMappings: Record<string, { ip: string; vlan: number | null }>,
    vlanMappings?: Record<string, number>,
    ipv6Mappings?: Record<string, string>
  ): Record<string, any> {
    const transformed = { ...parameters };

    for (const [key, value] of Object.entries(transformed)) {
      if (typeof value === 'string') {
        // Replace IP variable references like {{device.interface}}, {{device.interface:ipv6}}, or {{variable}}
        let transformedValue = value.replace(/\{\{([^}]+)\}\}/g, (match, varName) => {
          // Check for IPv6 suffix (e.g., {{device.interface:ipv6}})
          if (varName.endsWith(':ipv6')) {
            const baseVarName = varName.slice(0, -5); // Remove ':ipv6' suffix
            if (ipv6Mappings && ipv6Mappings[baseVarName]) {
              return ipv6Mappings[baseVarName];
            }
            // If not found, return original match
            return match;
          }

          // Check IP mappings first - extract IP from the object
          if (ipMappings[varName]) {
            return ipMappings[varName].ip;
          }

          // Check VLAN mappings (e.g., {{vlan0}}, {{vlan1}})
          if (vlanMappings && vlanMappings[varName] !== undefined) {
            return vlanMappings[varName].toString();
          }

          // If not found, return original match
          return match;
        });

        transformed[key] = transformedValue;
      }
    }

    return transformed;
  }

  /**
   * Generate complete network configuration for student when they START a lab
   * Returns all IPs (Management + VLAN) with embedded VLAN IDs and separate VLAN mappings
   */
  static async generateStudentNetworkConfiguration(
    lab: ILab,
    studentId: string
  ): Promise<{
    managementIp: string;
    ipMappings: Record<string, { ip: string; vlan: number | null }>;
    vlanMappings: Record<string, number>;
    vlanSubnets: Record<number, { baseNetwork: string; subnetMask: number; subnetIndex?: number }>;
    sessionInfo: {
      sessionId: string;
      status: string;
      startedAt: Date;
      attemptNumber: number;
      instructionsAcknowledged: boolean;
      instructionsAcknowledgedAt?: Date;
    };
  }> {
    // Get or create student lab session to get permanent Management IP
    const labId = lab.id as Types.ObjectId;
    const session = await StudentLabSessionService.getOrCreateSession(studentId, labId, lab);
    const managementIp = session.managementIp;

    console.log(`[Lab Start] Student ${studentId} - Lab ${labId} - Management IP: ${managementIp}`);

    // Generate all IP mappings and VLAN mappings
    const ipMappings = IPGenerator.generateIPMappings(lab, studentId, managementIp);
    const vlanMappings = IPGenerator.generateVLANMappings(lab, studentId);

    console.log(`[Lab Start] Student ${studentId} - Generated ${Object.keys(ipMappings).length} IP mappings, ${Object.keys(vlanMappings).length} VLAN mappings`);

    const vlanSubnets: Record<number, { baseNetwork: string; subnetMask: number; subnetIndex?: number }> = {};
    const vlanConfig = lab.network?.vlanConfiguration;
    const topologyBase = lab.network?.topology?.baseNetwork;
    const topologyMask = lab.network?.topology?.subnetMask;

    if (vlanConfig?.vlans?.length) {
      const vlanInterfaceIps: Record<number, string[]> = {};

      lab.network?.devices?.forEach(device => {
        device.ipVariables?.forEach(ipVar => {
          if (!ipVar?.isVlanInterface || typeof ipVar.vlanIndex !== 'number') return;
          const key = `${device.deviceId}.${ipVar.name}`;
          const mapping = ipMappings[key];
          if (mapping?.ip) {
            if (!vlanInterfaceIps[ipVar.vlanIndex]) {
              vlanInterfaceIps[ipVar.vlanIndex] = [];
            }
            vlanInterfaceIps[ipVar.vlanIndex].push(mapping.ip);
          }
        });
      });

      vlanConfig.vlans.forEach((vlan, idx) => {
        const vlanIndex = idx;
        const subnetMask = typeof vlan.subnetMask === 'number' ? vlan.subnetMask : topologyMask;
        if (typeof subnetMask !== 'number') return;

        let baseNetwork = vlan.baseNetwork || topologyBase;

        if (baseNetwork) {
          const baseNum = ipToNumber(baseNetwork);
          if (!Number.isNaN(baseNum)) {
            const blockSize = Math.pow(2, 32 - subnetMask);
            if (typeof vlan.subnetIndex === 'number') {
              const subnetIndex = vlan.subnetIndex >= 1 ? vlan.subnetIndex : 1;
              baseNetwork = numberToIp(baseNum + (subnetIndex - 1) * blockSize);
            }
          }
        }

        if (!baseNetwork) {
          const sampleIp = vlanInterfaceIps[vlanIndex]?.[0];
          if (sampleIp) {
            const ipNum = ipToNumber(sampleIp);
            if (!Number.isNaN(ipNum)) {
              const mask = ~((1 << (32 - subnetMask)) - 1) >>> 0;
              baseNetwork = numberToIp((ipNum & mask) >>> 0);
            }
          }
        }

        if (baseNetwork) {
          vlanSubnets[vlanIndex] = {
            baseNetwork,
            subnetMask,
            subnetIndex: typeof vlan.subnetIndex === 'number' ? vlan.subnetIndex : undefined
          };
        }
      });
    }

    return {
      managementIp,
      ipMappings,
      vlanMappings,
      vlanSubnets,
      sessionInfo: {
        sessionId: session.id?.toString() || '',
        status: session.status,
        startedAt: session.startedAt,
        attemptNumber: session.attemptNumber,
        instructionsAcknowledged: session.instructionsAcknowledged ?? false,
        instructionsAcknowledgedAt: session.instructionsAcknowledgedAt
      }
    };
  }

  /**
   * Complete job generation from lab and part data
   * NOW RESOLVES MANAGEMENT IP AND CALCULATES ACTUAL VLAN IPs AT SUBMISSION TIME
   */
  static async generateJobFromLab(
    lab: ILab,
    part: ILabPart,
    studentId: string,
    jobId: string,
    options?: {
      lecturerRangeOverrides?: LecturerRangeOverridePayload[];
      gns3Nodes?: GNS3Node[];
      gns3ServerIp?: string;
    }
  ): Promise<any> {
    // Get or create student lab session to get permanent Management IP
    const labId = lab.id as Types.ObjectId;
    const session = await StudentLabSessionService.getOrCreateSession(studentId, labId, lab);
    const managementIp = session.managementIp;

    console.log(`[IP Resolution] Student ${studentId} - Lab ${labId} - Management IP: ${managementIp}`);

    const overrideMap = new Map<string, string>();

    const registerOverride = (key: string, ip: string) => {
      if (!key) return;
      overrideMap.set(key, ip);
      const normalizedKey = normalizeOverrideKey(key);
      if (normalizedKey !== key) {
        overrideMap.set(normalizedKey, ip);
      }
    };

    options?.lecturerRangeOverrides?.forEach(override => {
      registerOverride(override.key, override.ip);

      const { deviceId, interfaceName } = override.metadata;
      if (deviceId && interfaceName) {
        registerOverride(`${deviceId}.${normalizeInterfaceName(interfaceName)}`, override.ip);
      }
    });

    // Generate devices, IP mappings, and VLAN mappings
    const devices = await this.generateDevices(
      lab,
      studentId,
      managementIp,
      options?.gns3Nodes,
      overrideMap.size > 0 ? overrideMap : undefined,
      options?.gns3ServerIp
    );

    const ipMappings = this.generateIPMappings(
      lab,
      studentId,
      managementIp,
      overrideMap.size > 0 ? overrideMap : undefined
    );
    const vlanMappings = this.generateVLANMappings(lab, studentId);
    const ipv6Mappings = this.generateIPv6Mappings(lab, studentId, vlanMappings);

    console.log(`[VLAN Resolution] Student ${studentId} - VLAN IDs:`, vlanMappings);
    console.log(`[IPv6 Resolution] Student ${studentId} - IPv6 Mappings:`, ipv6Mappings);

    // Transform tasks to use generated IPs/VLANs/IPv6s and resolve template names
    const transformedTasks = await Promise.all(part.tasks.map(async (task) => {
      // Fetch the actual template to get its templateId
      const template = await TaskTemplateService.getTaskTemplateById(task.templateId.toString());
      const templateName = template?.templateId || task.templateId.toString(); // Fallback to ID if not found

      return {
        task_id: task.taskId,
        name: task.name,
        template_name: templateName,
        execution_device: task.executionDevice,
        target_devices: task.targetDevices || [],
        parameters: this.transformTaskParameters(task.parameters, ipMappings, vlanMappings, ipv6Mappings),
        test_cases: task.testCases.map(tc => ({
          comparison_type: tc.comparison_type,
          expected_result: tc.expected_result
        })),
        points: task.points,
      };
    }));

    // Convert ipMappings from {ip, vlan} format to simple IP strings for grading service
    const flatIpMappings: Record<string, string> = {};
    for (const [key, value] of Object.entries(ipMappings)) {
      flatIpMappings[key] = value.ip;
    }

    return {
      job_id: jobId,
      student_id: studentId,
      lab_id: lab.id?.toString(),
      lab_session_id: session.id?.toString() || '',
      lab_attempt_number: session.attemptNumber,
      part: {
        part_id: part.partId,
        title: part.title,
        network_tasks: transformedTasks,
        groups: part.task_groups || []
      },
      devices,
      ip_mappings: flatIpMappings,  // Send flat format to grading service
      lecturer_range_overrides: options?.lecturerRangeOverrides?.map(({ key, ip, metadata }) => ({
        mapping_key: key,
        ip,
        source_part_id: metadata.sourcePartId,
        question_id: metadata.questionId,
        row_index: metadata.rowIndex,
        col_index: metadata.colIndex,
        lecturer_range_start: metadata.lecturerRangeStart,
        lecturer_range_end: metadata.lecturerRangeEnd,
        device_id: metadata.deviceId,
        interface_name: metadata.interfaceName,
        vlan_index: metadata.vlanIndex
      })) ?? [],
      vlan_mappings: vlanMappings
    };
  }
}

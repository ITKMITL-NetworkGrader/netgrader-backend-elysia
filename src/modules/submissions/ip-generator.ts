import { ILab } from '../labs/model';
import { ILabPart } from '../parts/model';
import { TaskTemplateService } from '../task-templates/service';
import { DeviceTemplateService } from '../device-templates/service';
import { StudentLabSessionService } from '../student-lab-sessions/service';
import { Types } from 'mongoose';
import {
  calculateStudentIdBasedIP,
  calculateAdvancedStudentIP,
  calculateStudentVLANs
} from './ip-calculator';

interface GeneratedDevice {
  id: string;
  ip_address: string;
  connection_type: string;
  credentials: Record<string, string>;
  platform: string;
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
   * Generate devices array for grading job
   */
  static async generateDevices(
    lab: ILab,
    studentId: string,
    managementIp: string
  ): Promise<GeneratedDevice[]> {
    const devices: GeneratedDevice[] = [];

    for (const labDevice of lab.network.devices) {
      const managementInterface = this.findManagementInterface(labDevice);

      if (!managementInterface) {
        console.warn(`No management interface found for device ${labDevice.deviceId}`);
        continue;
      }

      const resolvedManagementIP = this.generateIP(
        managementInterface,
        lab,
        studentId,
        managementIp
      );

      const platform = await this.getPlatformFromTemplate(labDevice.templateId.toString());

      const device: GeneratedDevice = {
        id: labDevice.deviceId,
        ip_address: resolvedManagementIP,
        connection_type: 'ssh',
        credentials: {
          username: labDevice.credentials.usernameTemplate,
          password: labDevice.credentials.passwordTemplate,
          ...(labDevice.credentials.enablePassword && {
            enable_pass: labDevice.credentials.enablePassword
          })
        },
        platform,
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

        if (overrideMap?.has(key)) {
          ip = overrideMap.get(key) as string;
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
   * Transform task parameters to replace IP variables with actual IPs
   * Variable format: {{device.interface}} or {{variable}}
   */
  static transformTaskParameters(
    parameters: Record<string, any>,
    ipMappings: Record<string, { ip: string; vlan: number | null }>,
    vlanMappings?: Record<string, number>
  ): Record<string, any> {
    const transformed = { ...parameters };

    for (const [key, value] of Object.entries(transformed)) {
      if (typeof value === 'string') {
        // Replace IP variable references like {{device.interface}} or {{variable}}
        let transformedValue = value.replace(/\{\{([^}]+)\}\}/g, (match, varName) => {
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

    return {
      managementIp,
      ipMappings,
      vlanMappings,
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
    }
  ): Promise<any> {
    // Get or create student lab session to get permanent Management IP
    const labId = lab.id as Types.ObjectId;
    const session = await StudentLabSessionService.getOrCreateSession(studentId, labId, lab);
    const managementIp = session.managementIp;

    console.log(`[IP Resolution] Student ${studentId} - Lab ${labId} - Management IP: ${managementIp}`);

    // Generate devices, IP mappings, and VLAN mappings
    const devices = await this.generateDevices(lab, studentId, managementIp);
    const overrideMap = new Map<string, string>();

    options?.lecturerRangeOverrides?.forEach(override => {
      overrideMap.set(override.key, override.ip);
    });

    const ipMappings = this.generateIPMappings(
      lab,
      studentId,
      managementIp,
      overrideMap.size > 0 ? overrideMap : undefined
    );
    const vlanMappings = this.generateVLANMappings(lab, studentId);

    console.log(`[VLAN Resolution] Student ${studentId} - VLAN IDs:`, vlanMappings);

    // Transform tasks to use generated IPs/VLANs and resolve template names
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
        parameters: this.transformTaskParameters(task.parameters, ipMappings, vlanMappings),
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

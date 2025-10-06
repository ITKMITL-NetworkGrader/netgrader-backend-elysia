import { ILab } from '../labs/model';
import { ILabPart } from '../parts/model';
import { TaskTemplateService } from '../task-templates/service';
import { DeviceTemplateService } from '../device-templates/service';

interface GeneratedDevice {
  id: string;
  ip_address: string;
  connection_type: string;
  credentials: Record<string, string>;
  platform: string;
  role: string;
}

export class IPGenerator {
  /**
   * Generate IP address based on inputType
   * NOTE: This is for IP variable REFERENCES resolution in task parameters
   * Student-specific IPs (Management, VLAN) are calculated by FRONTEND
   */
  static generateIP(ipVariable: {
    inputType: string;
    fullIp?: string;
    isManagementInterface?: boolean;
    isVlanInterface?: boolean;
    vlanIndex?: number;
    interfaceOffset?: number;
  }): string {
    // For fullIP type, use it directly
    if (ipVariable.inputType === 'fullIP' && ipVariable.fullIp) {
      return ipVariable.fullIp;
    }

    // For student-generated IPs (Management, VLAN), return a placeholder
    // These will be calculated by the frontend or provided by backend during lab execution
    if (
      ipVariable.inputType === 'studentManagement' ||
      ipVariable.inputType.startsWith('studentVlan')
    ) {
      // Return placeholder - actual IP will be resolved during task execution
      // Format: ${inputType}:${vlanIndex}:${interfaceOffset}
      if (ipVariable.isVlanInterface && ipVariable.vlanIndex !== undefined) {
        return `\${${ipVariable.inputType}:${ipVariable.vlanIndex}:${ipVariable.interfaceOffset || 1}}`;
      } else if (ipVariable.isManagementInterface) {
        return `\${${ipVariable.inputType}}`;
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
  static async generateDevices(lab: ILab): Promise<GeneratedDevice[]> {
    const devices: GeneratedDevice[] = [];

    for (const labDevice of lab.network.devices) {
      const managementInterface = this.findManagementInterface(labDevice);
      
      if (!managementInterface) {
        console.warn(`No management interface found for device ${labDevice.deviceId}`);
        continue;
      }

      const managementIP = this.generateIP(managementInterface);

      const platform = await this.getPlatformFromTemplate(labDevice.templateId.toString());

      const device: GeneratedDevice = {
        id: labDevice.deviceId,
        ip_address: managementIP,
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
   * Returns mapping of device.variableName to IP address (or placeholder for student-generated)
   */
  static generateIPMappings(lab: ILab): Record<string, string> {
    const mappings: Record<string, string> = {};

    for (const device of lab.network.devices) {
      for (const ipVar of device.ipVariables) {
        const ip = this.generateIP(ipVar);

        // Create mapping with device.variableName format (e.g., "router1.loopback0")
        const key = `${device.deviceId}.${ipVar.name}`;
        mappings[key] = ip;
      }
    }

    return mappings;
  }

  /**
   * Transform task parameters to replace IP variables with actual IPs
   */
  static transformTaskParameters(
    parameters: Record<string, any>, 
    ipMappings: Record<string, string>
  ): Record<string, any> {
    const transformed = { ...parameters };

    for (const [key, value] of Object.entries(transformed)) {
      if (typeof value === 'string') {
        // Replace IP variable references like ${device.interface} or ${variable}
        transformed[key] = value.replace(/\$\{([^}]+)\}/g, (match, varName) => {
          return ipMappings[varName] || match;
        });
        
        // Direct variable replacement
        if (ipMappings[value]) {
          transformed[key] = ipMappings[value];
        }
      }
    }

    return transformed;
  }

  /**
   * Complete job generation from lab and part data
   */
  static async generateJobFromLab(
    lab: ILab,
    part: ILabPart,
    studentId: string,
    jobId: string,
    callbackUrl: string
  ): Promise<any> {
    const devices = await this.generateDevices(lab);
    const ipMappings = this.generateIPMappings(lab);

    // Transform tasks to use generated IPs and resolve template names
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
        parameters: this.transformTaskParameters(task.parameters, ipMappings),
        test_cases: task.testCases.map(tc => ({
          comparison_type: tc.comparison_type,
          expected_result: tc.expected_result
        })),
        points: task.points,
      };
    }));

    return {
      job_id: jobId,
      student_id: studentId,
      lab_id: lab.id?.toString(),
      part: {
        part_id: part.partId,
        title: part.title,
        network_tasks: transformedTasks,
        groups: part.task_groups || []
      },
      devices,
      ip_mappings: ipMappings,
      callback_url: callbackUrl
    };
  }
}
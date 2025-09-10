import { ILab } from '../labs/model';
import { ILabPart } from '../parts/model';
import { TaskTemplateService } from '../task-templates/service';

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
   * Generate IP address from base network and host offset, or use fullIp if provided
   */
  static generateIP(baseNetwork: string, hostOffset: number, fullIp?: string): string {
    // If fullIp is defined, use it directly
    if (fullIp) {
      return fullIp;
    }
    
    const [networkPart] = baseNetwork.split('/');
    const octets = networkPart.split('.').map(Number);
    
    // For student-based allocation, you might want to add student ID offset
    // For now, using simple host offset
    octets[3] = hostOffset;
    
    return octets.join('.');
  }

  /**
   * Find management interface for a device
   */
  static findManagementInterface(device: ILab['network']['devices'][0]) {
    // Option 1: Convention-based detection for management interfaces
    const managementByName = device.ipVariables.find(ip => 
      /^(mgmt|management|oob)/i.test(ip.name) ||
      (ip.interface && /management|mgmt/i.test(ip.interface))
    );
    if (managementByName) return managementByName;

    // Option 2: Use first interface as fallback
    return device.ipVariables[0] || null;
  }

  /**
   * Determine device platform from device info
   */
  static determinePlatform(device: ILab['network']['devices'][0]): string {
    const deviceName = device.displayName.toLowerCase();
    
    if (deviceName.includes('router') || deviceName.includes('switch')) {
      return 'cisco_ios';
    }
    if (deviceName.includes('ubuntu') || deviceName.includes('linux')) {
      return 'linux';
    }
    
    return 'cisco_ios'; // Default fallback
  }

  /**
   * Generate devices array for grading job
   */
  static generateDevices(lab: ILab): GeneratedDevice[] {
    const devices: GeneratedDevice[] = [];

    for (const labDevice of lab.network.devices) {
      const managementInterface = this.findManagementInterface(labDevice);
      
      if (!managementInterface) {
        console.warn(`No management interface found for device ${labDevice.deviceId}`);
        continue;
      }

      const managementIP = this.generateIP(
        lab.network.topology.baseNetwork,
        managementInterface.hostOffset,
        managementInterface.fullIp
      );

      const platform = this.determinePlatform(labDevice);

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
   */
  static generateIPMappings(lab: ILab): Record<string, string> {
    const mappings: Record<string, string> = {};

    for (const device of lab.network.devices) {
      for (const ipVar of device.ipVariables) {
        const ip = this.generateIP(
          lab.network.topology.baseNetwork,
          ipVar.hostOffset,
          ipVar.fullIp
        );
        
        // Create mapping with device.interface format
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
    const devices = this.generateDevices(lab);
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
          expected_result: tc.expected_result.toLowerCase() === "true" ? true :
              tc.expected_result.toLowerCase() === "false" ? false :
              tc.expected_result
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
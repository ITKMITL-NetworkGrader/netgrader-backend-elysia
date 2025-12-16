/**
 * Playground Service - Custom grading job generation for testing
 * Bypasses IPGenerator to use user-provided custom network data
 */

import { ILab } from '../labs/model';
import { ILabPart } from '../parts/model';
import { TaskTemplateService } from '../task-templates/service';
import { DeviceTemplateService } from '../device-templates/service';
import { Types } from 'mongoose';
import { channel, QUEUE_NAME } from '../../config/rabbitmq';

interface DeviceMapping {
    deviceId: string;       // Lab device ID (e.g., "router1")
    gns3NodeName: string;   // GNS3 node name
    ipAddress: string;      // Custom IP for this device
}

interface PlaygroundConfig {
    gns3Config: {
        serverIp: string;
        serverPort: number;
        projectId: string;
        auth?: {
            username: string;
            password: string;
        };
    };
    deviceMappings: DeviceMapping[];
    customIpMappings: Record<string, string>;   // "router1.gig0_1" -> "192.168.1.1"
    customVlanMappings: Record<string, number>; // "vlan0" -> 100
}

interface GeneratedDevice {
    id: string;
    ip_address: string;
    connection_type: string;
    credentials: Record<string, string>;
    platform: string;
    role: string;
}

export class PlaygroundService {
    /**
     * Get devices required for a specific lab part
     * This includes devices referenced in tasks
     */
    static getRequiredDevicesForPart(
        lab: ILab,
        part: ILabPart
    ): Array<{
        deviceId: string;
        displayName: string;
        templateId: string;
        ipVariables: any[];
    }> {
        // Get all unique device IDs referenced in task executionDevice and targetDevices
        const referencedDeviceIds = new Set<string>();

        for (const task of part.tasks || []) {
            if (task.executionDevice) {
                referencedDeviceIds.add(task.executionDevice);
            }
            for (const targetDevice of task.targetDevices || []) {
                referencedDeviceIds.add(targetDevice);
            }
        }

        // Filter lab devices to only those referenced in this part
        return lab.network.devices
            .filter(device => referencedDeviceIds.has(device.deviceId))
            .map(device => ({
                deviceId: device.deviceId,
                displayName: device.displayName,
                templateId: device.templateId.toString(),
                ipVariables: device.ipVariables,
            }));
    }

    /**
     * Get ALL devices for a lab with interface details
     * Used for lab-level device mapping (not per-part)
     */
    static getDevicesForLab(
        lab: ILab
    ): Array<{
        deviceId: string;
        displayName: string;
        templateId: string;
        interfaces: Array<{
            name: string;           // ipVariable name (e.g., "mgmt_interface")
            interfaceName: string;  // Interface name (e.g., "GigabitEthernet0/0")
            inputType: string;
        }>;
        credentials: {
            username: string;
            password: string;
            enablePassword?: string;
        };
    }> {
        return lab.network.devices.map(device => ({
            deviceId: device.deviceId,
            displayName: device.displayName,
            templateId: device.templateId.toString(),
            interfaces: device.ipVariables.map(ipVar => ({
                name: ipVar.name,
                interfaceName: ipVar.interface || ipVar.name,
                inputType: ipVar.inputType,
            })),
            credentials: {
                username: device.credentials.usernameTemplate,
                password: device.credentials.passwordTemplate,
                enablePassword: device.credentials.enablePassword,
            },
        }));
    }

    /**
     * Get platform from device template
     */
    static async getPlatformFromTemplate(templateId: string): Promise<string> {
        try {
            const template = await DeviceTemplateService.getDeviceTemplateById(templateId);
            return template?.platform || 'cisco_ios';
        } catch (error) {
            console.warn(`Failed to get platform from template ${templateId}, using default:`, error);
            return 'cisco_ios';
        }
    }

    /**
     * Generate devices array using custom mappings
     */
    static async generateDevicesFromMappings(
        lab: ILab,
        deviceMappings: DeviceMapping[]
    ): Promise<GeneratedDevice[]> {
        const devices: GeneratedDevice[] = [];

        for (const mapping of deviceMappings) {
            const labDevice = lab.network.devices.find(d => d.deviceId === mapping.deviceId);
            if (!labDevice) {
                console.warn(`Device ${mapping.deviceId} not found in lab config`);
                continue;
            }

            const platform = await this.getPlatformFromTemplate(labDevice.templateId.toString());

            const device: GeneratedDevice = {
                id: mapping.deviceId,
                ip_address: mapping.ipAddress,
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
     * Transform task parameters using custom IP and VLAN mappings
     */
    static transformTaskParameters(
        parameters: Record<string, any>,
        customIpMappings: Record<string, string>,
        customVlanMappings: Record<string, number>
    ): Record<string, any> {
        const transformed = { ...parameters };

        for (const [key, value] of Object.entries(transformed)) {
            if (typeof value === 'string') {
                // Replace IP variable references like {{device.interface}} or {{vlanX}}
                let transformedValue = value.replace(/\{\{([^}]+)\}\}/g, (match, varName) => {
                    // Check IP mappings first
                    if (customIpMappings[varName]) {
                        return customIpMappings[varName];
                    }

                    // Check VLAN mappings
                    if (customVlanMappings[varName] !== undefined) {
                        return customVlanMappings[varName].toString();
                    }

                    // Return original if not found
                    return match;
                });

                transformed[key] = transformedValue;
            }
        }

        return transformed;
    }

    /**
     * Generate a playground grading job using custom data
     * This bypasses IPGenerator and uses user-provided values
     */
    static async generatePlaygroundJob(
        lab: ILab,
        part: ILabPart,
        userId: string,
        config: PlaygroundConfig
    ): Promise<any> {
        const jobId = `playground-${userId}-${lab.id}-${part.partId}-${Date.now()}`;

        // Generate devices from custom mappings
        const devices = await this.generateDevicesFromMappings(lab, config.deviceMappings);

        // Transform tasks using custom IP and VLAN mappings
        const transformedTasks = await Promise.all(part.tasks.map(async (task) => {
            const template = await TaskTemplateService.getTaskTemplateById(task.templateId.toString());
            const templateName = template?.templateId || task.templateId.toString();

            return {
                task_id: task.taskId,
                name: task.name,
                template_name: templateName,
                execution_device: task.executionDevice,
                target_devices: task.targetDevices || [],
                parameters: this.transformTaskParameters(
                    task.parameters,
                    config.customIpMappings,
                    config.customVlanMappings
                ),
                test_cases: task.testCases.map(tc => ({
                    comparison_type: tc.comparison_type,
                    expected_result: tc.expected_result
                })),
                points: task.points,
            };
        }));

        return {
            job_id: jobId,
            student_id: userId,
            lab_id: lab.id?.toString(),
            is_playground: true,  // Mark as playground job
            // Callback URL for playground - points to playground endpoints instead of submissions
            callback_url: `${process.env.ELYSIA_CALLBACK_URL || 'http://localhost:4000'}/v0/playground`,
            part: {
                part_id: part.partId,
                title: part.title,
                network_tasks: transformedTasks,
                groups: part.task_groups || []
            },
            devices,
            ip_mappings: config.customIpMappings,
            vlan_mappings: config.customVlanMappings,
            gns3_config: {
                server_ip: config.gns3Config.serverIp,
                server_port: config.gns3Config.serverPort,
                project_id: config.gns3Config.projectId,
            }
        };
    }

    /**
     * Submit playground grading job to queue
     * Does NOT save to database (ephemeral)
     */
    static async submitPlaygroundJob(jobPayload: any): Promise<{
        success: boolean;
        jobId?: string;
        error?: string;
    }> {
        if (!channel) {
            return {
                success: false,
                error: 'RabbitMQ channel not initialized',
            };
        }

        try {
            channel.sendToQueue(QUEUE_NAME, Buffer.from(JSON.stringify(jobPayload)), {
                persistent: false, // Playground jobs don't need persistence
            });

            return {
                success: true,
                jobId: jobPayload.job_id,
            };
        } catch (error) {
            return {
                success: false,
                error: `Failed to submit job: ${(error as Error).message}`,
            };
        }
    }
}

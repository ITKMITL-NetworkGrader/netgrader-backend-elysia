/**
 * ClabStudentLabService – Student lab lifecycle management via ContainerLab.
 *
 * Replaces GNS3v3Service (833 → ~200 lines). Key simplifications:
 * - Admin-only auth: no student Linux users created on clab server
 * - No pools/ACEs/roles: lab isolation via unique lab names + MongoDB tracking
 * - Topology auto-generation from Lab model (Option C + Approach A links)
 *
 * Uses a single ContainerLab server configuration.
 */

import { env } from 'process';
import { ClabApiOrchestrator } from '../clab/service';
import type {
    ClabConfig,
    ClabContainerInfo,
    LabTopology,
    SSHProxyInfo,
} from '../clab/orchestrator';
import type { ILab } from '../labs/model';
import { DeviceTemplate } from '../device-templates/model';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ClabStudentSetupResult {
    success: boolean;
    error?: string;
    labName?: string;
    nodes?: ClabContainerInfo[];
    sshAccess?: SSHProxyInfo[];
}

interface ClabServerConfig extends ClabConfig {
    // ClabConfig already has serverIp, serverPort, adminUsername, adminPassword
}

// ─── Server configuration from env ──────────────────────────────────────────

function parseServerFromEnv(): ClabServerConfig {
    const serversEnv = env.CLAB_SERVERS || env.CLAB_SERVER || 'localhost';
    const portsEnv = env.CLAB_API_PORTS || env.CLAB_API_PORT || '8080';
    const adminUsernameEnv = env.CLAB_ADMIN_USERNAME || 'admin';
    const adminPasswordEnv = env.CLAB_ADMIN_PASSWORD || 'admin';

    const servers = serversEnv
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    const ports = portsEnv.split(',').map((p) => parseInt(p.trim()) || 8080);

    const serverIp = servers[0] || 'localhost';
    return {
        serverIp,
        serverPort: ports[0] || 8080,
        adminUsername: adminUsernameEnv,
        adminPassword: adminPasswordEnv,
    };
}

const CLAB_SERVER: ClabServerConfig = parseServerFromEnv();

// ─── Platform → ContainerLab kind mapping ───────────────────────────────────

/**
 * Maps Netgrader `platform` field to ContainerLab `kind`.
 * @see https://containerlab.dev/manual/kinds/
 */
function platformToClabKind(platform: string): string {
    const mapping: Record<string, string> = {
        // Cisco
        cisco_ios: 'cisco_iosxe',
        cisco_iosxe: 'cisco_iosxe',
        cisco_xr: 'cisco_xrd',
        cisco_nxos: 'cisco_n9kv',

        // Nokia
        nokia_srl: 'nokia_srlinux',
        nokia_sros: 'nokia_sros',

        // Arista
        arista_eos: 'arista_ceos',

        // Juniper
        juniper_junos: 'juniper_crpd',

        // Linux
        linux: 'linux',

        // Generic
        generic: 'linux',
    };

    return mapping[platform] || 'linux';
}

/**
 * Map interface names from Netgrader format to ContainerLab format.
 * e.g. "GigabitEthernet0/1" → "Gi0/1" (depends on kind)
 */
function mapInterfaceName(ifaceName: string): string {
    // ContainerLab uses short interface names for vrnetlab-based kinds.
    // For now, pass through – the exact mapping depends on the kind.
    // Can be extended with kind-specific logic later.
    return ifaceName;
}

// ─── Service ────────────────────────────────────────────────────────────────

export class ClabStudentLabService {
    static getServerConfig(): ClabServerConfig {
        return CLAB_SERVER;
    }

    /**
     * Create an orchestrator instance for the given server index.
     */
    static getOrchestrator(): ClabApiOrchestrator {
        const config = this.getServerConfig();
        return new ClabApiOrchestrator(config);
    }

    private static async collectSshAccess(
        orchestrator: ClabApiOrchestrator,
        labName: string,
        nodes: ClabContainerInfo[],
    ): Promise<SSHProxyInfo[]> {
        const sshAccess: SSHProxyInfo[] = [];

        for (const node of nodes) {
            const sshResult = await orchestrator.getSSHProxyInfo(
                labName,
                node.name,
            );
            if (sshResult.success && sshResult.data) {
                sshAccess.push(sshResult.data);
            }
        }

        return sshAccess;
    }

    // ─── Topology generation ────────────────────────────────────────────

    /**
     * Generate a ContainerLab topology from a Netgrader lab definition.
     *
     * - Validates all templateIds exist (throws LabConfigError if stale)
     * - Uses `DeviceTemplate.image` for the container image
     * - Uses `lab.network.links` for wiring
     */
    static async generateTopology(
        lab: ILab,
        studentId: string,
    ): Promise<LabTopology> {
        // Fetch all referenced device templates
        const templateIds = lab.network.devices.map((d) => d.templateId);
        const templates = await DeviceTemplate.find({
            _id: { $in: templateIds },
        });
        const templatesById = new Map(
            templates.map((t) => [String(t._id), t]),
        );

        // Validate — fail fast if any template is missing/deleted
        const missingTemplates: Array<{
            deviceId: string;
            templateId: string;
        }> = [];
        for (const device of lab.network.devices) {
            if (!templatesById.has(String(device.templateId))) {
                missingTemplates.push({
                    deviceId: device.deviceId,
                    templateId: device.templateId.toString(),
                });
            }
        }
        if (missingTemplates.length > 0) {
            const err = new Error(
                `Lab has ${missingTemplates.length} device(s) referencing deleted/missing templates`,
            ) as Error & {
                statusCode: number;
                code: string;
                details: unknown;
            };
            err.statusCode = 422;
            err.code = 'STALE_TEMPLATES';
            err.details = { missingTemplates };
            throw err;
        }

        // Build nodes
        const nodes: Record<string, { kind: string; image: string }> = {};
        for (const device of lab.network.devices) {
            const tmpl = templatesById.get(String(device.templateId));
            if (!tmpl || !tmpl.image) {
                throw new Error(
                    `Template for device ${device.deviceId} has no valid image`,
                );
            }

            nodes[device.deviceId] = {
                kind: platformToClabKind(tmpl.platform),
                image: tmpl.image,
            };
        }

        // Build links from explicit link definitions
        const links = ((lab.network as any).links || []).map(
            (link: {
                endpointA: { deviceId: string; interface: string };
                endpointB: { deviceId: string; interface: string };
            }) => ({
                endpoints: [
                    `${link.endpointA.deviceId}:${mapInterfaceName(link.endpointA.interface)}`,
                    `${link.endpointB.deviceId}:${mapInterfaceName(link.endpointB.interface)}`,
                ] as [string, string],
            }),
        );

        // Generate a deterministic, unique lab name
        const safeName = lab.network.name
            .replace(/[^a-zA-Z0-9-]/g, '-')
            .toLowerCase();
        const labName = `${studentId}-${safeName}`;

        return {
            name: labName,
            topology: { nodes, links },
        };
    }

    // ─── Student lab setup ───────────────────────────────────────────────

    /**
     * Complete setup workflow for a student's lab.
     *
    * 1. Use configured single clab server
    * 2. Deploy topology on the clab server using admin credentials
     * 3. Return container info + SSH proxy connection details
     *
     * No student users are created – the admin service account owns everything.
     */
    static async setupStudentLab(
        studentId: string,
        lab: ILab,
        onProgress?: (step: string) => void,
    ): Promise<ClabStudentSetupResult> {
        try {
            // Step 1: Resolve server
            onProgress?.('resolving_server');
            const orchestrator = this.getOrchestrator();
            const serverConfig = this.getServerConfig();

            console.log(
                `[CLAB] Student ${studentId} → server ${serverConfig.serverIp}`,
            );

            // Step 2: Generate topology
            onProgress?.('generating_topology');
            const topology = await this.generateTopology(lab, studentId);

            // Step 3: Deploy
            onProgress?.('deploying_lab');
            const deployResult = await orchestrator.deployLab(topology);
            if (!deployResult.success || !deployResult.data) {
                return {
                    success: false,
                    error:
                        deployResult.error ||
                        'Failed to deploy lab on clab-api-server',
                };
            }

            // Step 4: Gather SSH proxy info for each node
            onProgress?.('fetching_access_info');
            const sshAccess = await this.collectSshAccess(
                orchestrator,
                topology.name,
                deployResult.data.nodes,
            );

            onProgress?.('complete');
            return {
                success: true,
                labName: topology.name,
                nodes: deployResult.data.nodes,
                sshAccess,
            };
        } catch (error) {
            const err = error as Error & {
                statusCode?: number;
                code?: string;
            };
            console.error(`[CLAB] Setup failed for student ${studentId}:`, err);
            return {
                success: false,
                error: err.message || 'Unknown error during lab setup',
            };
        }
    }

    // ─── Inspect / access existing lab ───────────────────────────────────

    /**
     * Get current state and SSH access info for a student's deployed lab.
     */
    static async getStudentLabAccess(
        labName: string,
    ): Promise<{
        success: boolean;
        nodes?: ClabContainerInfo[];
        sshAccess?: SSHProxyInfo[];
        error?: string;
    }> {
        try {
            const orchestrator = this.getOrchestrator();
            const inspectResult = await orchestrator.inspectLab(labName);
            if (!inspectResult.success || !inspectResult.nodes) {
                return {
                    success: false,
                    error: inspectResult.error || 'Lab not found',
                };
            }

            const sshAccess = await this.collectSshAccess(
                orchestrator,
                labName,
                inspectResult.nodes,
            );

            return {
                success: true,
                nodes: inspectResult.nodes,
                sshAccess,
            };
        } catch (error) {
            const err = error as Error;
            return {
                success: false,
                error: `Failed to get lab access: ${err.message}`,
            };
        }
    }

    /**
     * Destroy a student's deployed lab.
     */
    static async destroyStudentLab(
        labName: string,
    ): Promise<{ success: boolean; error?: string }> {
        const orchestrator = this.getOrchestrator();
        return orchestrator.destroyLab(labName);
    }
}

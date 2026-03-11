/**
 * ILabOrchestrator – abstraction over lab orchestration backends.
 *
 * Implementations:
 * - ClabApiOrchestrator (this release) — wraps clab-api-server REST API
 * - ClabK8sOrchestrator (future)       — wraps Clabernetes on Kubernetes
 *
 * Types align with clab-api-server Swagger 2.0 spec (models.*).
 */

// ─── Configuration ──────────────────────────────────────────────────────────

export interface ClabConfig {
    serverIp: string;
    serverPort: number;
    adminUsername: string;
    adminPassword: string;
}

// ─── Container / Node info (matches models.ClabContainerInfo) ────────────────

export interface ClabContainerInfo {
    /** Container node name, e.g. "clab-mylab-srl1" */
    name: string;
    /** Docker container ID (short) */
    container_id: string;
    /** e.g. "running" */
    state: string;
    /** e.g. "Up 18 hours" */
    status: string;
    /** Container image used */
    image: string;
    /** e.g. "linux", "nokia_srlinux" */
    kind: string;
    /** Management IPv4 Address/Mask */
    ipv4_address?: string;
    /** Management IPv6 Address/Mask */
    ipv6_address?: string;
    /** Name of the lab this node belongs to */
    lab_name?: string;
    /** OS user from clab inspect output (ownership) */
    owner?: string;
    /** Path to the topology file used (relative) */
    labPath?: string;
    /** Absolute path to topology file */
    absLabPath?: string;
    /** Group assigned in topology */
    group?: string;
}

// Keep backward-compat alias
export type ClabNode = ClabContainerInfo;

// ─── Lab topology (deploy request body → topologyContent) ────────────────────

export interface LabTopology {
    name: string;
    topology: {
        kinds?: Record<string, { type?: string; image?: string }>;
        nodes: Record<string, { kind: string; image?: string;[k: string]: unknown }>;
        links?: Array<{ endpoints: [string, string] }>;
    };
}

// ─── Deploy response ─────────────────────────────────────────────────────────

/** models.ClabInspectOutput = Record<labName, ClabContainerInfo[]> */
export type ClabInspectOutput = Record<string, ClabContainerInfo[]>;

export interface LabDeployResult {
    labName: string;
    nodes: ClabContainerInfo[];
}

// ─── Lab listing ─────────────────────────────────────────────────────────────

export interface LabInfo {
    labName: string;
    owner?: string;
    nodeCount: number;
    nodes: ClabContainerInfo[];
}

// ─── SSH Access (matches models.SSHAccessRequest/Response) ───────────────────

export interface SSHAccessRequest {
    /** How long the access should be valid for (e.g., "1h", "30m") */
    duration?: string;
    /** Optional override for container's SSH user */
    sshUsername?: string;
}

export interface SSHAccessResponse {
    /** API server's hostname or IP */
    host: string;
    /** Allocated port on API server */
    port: number;
    /** Username to use for SSH */
    username: string;
    /** Example SSH command */
    command: string;
    /** When this access expires */
    expiration: string;
}

/** Our enriched SSH proxy info type */
export interface SSHProxyInfo {
    host: string;
    port: number;
    username: string;
    command: string;
    expiration: string;
    nodeName: string;
}

// ─── Exec command (models.ExecRequest/Response) ──────────────────────────────

export interface ExecRequest {
    command: string;
}

export interface ExecResult {
    cmd: string[];
    stdout: string;
    stderr: string;
    'return-code': number;
}

/** models.ExecResponse = Record<nodeName, ExecResult[]> */
export type ExecResponse = Record<string, ExecResult[]>;

// ─── SSH Session info (models.SSHSessionInfo) ────────────────────────────────

export interface SSHSessionInfo {
    port: number;
    username: string;
    labName: string;
    nodeName: string;
    created: string;
    expiration: string;
}

// ─── Error ───────────────────────────────────────────────────────────────────

export class LabConfigError extends Error {
    statusCode: number;
    code: string;
    details: unknown;

    constructor(message: string, code: string, statusCode: number, details?: unknown) {
        super(message);
        this.name = 'LabConfigError';
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
    }
}

// ─── Interface ───────────────────────────────────────────────────────────────

export interface ILabOrchestrator {
    /** Verify server is reachable and credentials work. */
    testConnectivity(): Promise<{
        success: boolean;
        version?: string;
        error?: string;
    }>;

    /** Deploy a topology. Response is ClabInspectOutput. */
    deployLab(topology: LabTopology): Promise<{
        success: boolean;
        data?: LabDeployResult;
        error?: string;
    }>;

    /** Destroy a lab by name. */
    destroyLab(labName: string): Promise<{
        success: boolean;
        error?: string;
    }>;

    /** Inspect a specific lab → ClabContainerInfo[]. */
    inspectLab(labName: string): Promise<{
        success: boolean;
        nodes?: ClabContainerInfo[];
        error?: string;
    }>;

    /** List all labs → ClabInspectOutput (map of labName → containers). */
    listLabs(): Promise<{
        success: boolean;
        labs?: LabInfo[];
        error?: string;
    }>;

    /**
     * Request SSH proxy access to a lab node.
     * Calls POST /api/v1/labs/{labName}/nodes/{nodeName}/ssh
     */
    getSSHProxyInfo(
        labName: string,
        nodeName: string,
        options?: SSHAccessRequest,
    ): Promise<{
        success: boolean;
        data?: SSHProxyInfo;
        error?: string;
    }>;

    /**
     * Execute a command on nodes in a lab.
     * Calls POST /api/v1/labs/{labName}/exec
     */
    execCommand(
        labName: string,
        command: string,
        nodeFilter?: string,
    ): Promise<{
        success: boolean;
        data?: ExecResponse;
        error?: string;
    }>;

    /** List active SSH sessions. */
    listSSHSessions(all?: boolean): Promise<{
        success: boolean;
        sessions?: SSHSessionInfo[];
        error?: string;
    }>;

    /** Terminate an SSH session by port. */
    terminateSSHSession(port: number): Promise<{
        success: boolean;
        error?: string;
    }>;
}

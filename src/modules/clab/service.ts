/**
 * ClabApiOrchestrator – ILabOrchestrator implementation backed by clab-api-server.
 *
 * All requests use a single admin service account (from ClabConfig).
 * Students never interact with clab-api-server directly.
 *
 * Aligned with clab-api-server Swagger 2.0 spec.
 * @see /docs/clab_api_doc.json
 */

import type {
    ILabOrchestrator,
    ClabConfig,
    ClabContainerInfo,
    ClabInspectOutput,
    LabDeployResult,
    LabInfo,
    LabTopology,
    SSHAccessRequest,
    SSHProxyInfo,
    ExecResponse,
    SSHSessionInfo,
} from './orchestrator';

// ─── Internal helpers ───────────────────────────────────────────────────────

const TIMEOUT_MS = 15_000;
const CONNECT_TIMEOUT_MS = 10_000;
const DEPLOY_TIMEOUT_MS = 120_000; // Lab deploy can take a while

function baseUrl(cfg: ClabConfig): string {
    return `http://${cfg.serverIp}:${cfg.serverPort}`;
}

/**
 * POST /login → { token }
 * Body: models.LoginRequest { username, password }
 */
async function authenticate(cfg: ClabConfig): Promise<string> {
    const res = await fetch(`${baseUrl(cfg)}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username: cfg.adminUsername,
            password: cfg.adminPassword,
        }),
        signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(
            `clab-api-server login failed (${res.status}): ${body}`,
        );
    }

    const data = (await res.json()) as { token: string };
    return data.token;
}

function authHeaders(token: string): HeadersInit {
    return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
    };
}

/**
 * Parse ClabInspectOutput (Record<labName, ClabContainerInfo[]>)
 * into a flat array of ClabContainerInfo.
 */
function flattenInspectOutput(data: unknown): ClabContainerInfo[] {
    if (!data || typeof data !== 'object') return [];

    // If it's already an array, it's from GET /labs/{labName}
    if (Array.isArray(data)) {
        return data as ClabContainerInfo[];
    }

    // Otherwise it's ClabInspectOutput: Record<labName, ClabContainerInfo[]>
    const result: ClabContainerInfo[] = [];
    for (const containers of Object.values(data as Record<string, unknown>)) {
        if (Array.isArray(containers)) {
            result.push(...(containers as ClabContainerInfo[]));
        }
    }
    return result;
}

// ─── Orchestrator implementation ────────────────────────────────────────────

export class ClabApiOrchestrator implements ILabOrchestrator {
    private config: ClabConfig;
    private cachedToken: string | null = null;
    private tokenExpiry: number = 0; // epoch ms

    constructor(config: ClabConfig) {
        this.config = config;
    }

    // ------------------------------------------------------------------
    //  Token management
    // ------------------------------------------------------------------

    private async getToken(): Promise<string> {
        const now = Date.now();
        // Re-auth if token is missing or expires within 2 minutes
        if (!this.cachedToken || now >= this.tokenExpiry - 120_000) {
            this.cachedToken = await authenticate(this.config);
            // Default JWT expiry is 60 min; we use 55 min to be safe
            this.tokenExpiry = now + 55 * 60 * 1000;
        }
        return this.cachedToken;
    }

    /**
     * Perform an authenticated request. Retries once on 401 (token expired).
     */
    private async authedFetch(
        path: string,
        init: RequestInit,
        retry = true,
    ): Promise<Response> {
        const token = await this.getToken();
        const headers = {
            ...authHeaders(token),
            ...(init.headers as Record<string, string> || {}),
        };
        const res = await fetch(`${baseUrl(this.config)}${path}`, {
            ...init,
            headers,
        });

        if (res.status === 401 && retry) {
            this.cachedToken = null;
            return this.authedFetch(path, init, false);
        }

        return res;
    }

    // ------------------------------------------------------------------
    //  ILabOrchestrator
    // ------------------------------------------------------------------

    async testConnectivity(): Promise<{
        success: boolean;
        version?: string;
        error?: string;
    }> {
        try {
            const token = await this.getToken();
            // If login succeeds, the server is reachable and credentials work
            return {
                success: true,
                version: 'clab-api-server',
            };
        } catch (error) {
            const err = error as Error;
            if (err.name === 'TimeoutError' || err.name === 'AbortError') {
                return {
                    success: false,
                    error: 'Connection timed out. Check if the clab-api-server is running and accessible.',
                };
            }
            return {
                success: false,
                error: `Connection failed: ${err.message}`,
            };
        }
    }

    /**
     * POST /api/v1/labs
     * Body: models.DeployRequest { topologyContent: LabTopology }
     * Response: models.ClabInspectOutput
     */
    async deployLab(topology: LabTopology): Promise<{
        success: boolean;
        data?: LabDeployResult;
        error?: string;
    }> {
        try {
            const res = await this.authedFetch('/api/v1/labs', {
                method: 'POST',
                body: JSON.stringify({ topologyContent: topology }),
                signal: AbortSignal.timeout(DEPLOY_TIMEOUT_MS),
            });

            if (!res.ok) {
                const body = await res.text();
                return {
                    success: false,
                    error: `Deploy failed (${res.status}): ${body}`,
                };
            }

            // Response is ClabInspectOutput: Record<labName, ClabContainerInfo[]>
            const data = await res.json();
            const nodes = flattenInspectOutput(data);

            return {
                success: true,
                data: {
                    labName: topology.name,
                    nodes,
                },
            };
        } catch (error) {
            const err = error as Error;
            return {
                success: false,
                error: `Deploy failed: ${err.message}`,
            };
        }
    }

    /**
     * DELETE /api/v1/labs/{labName}
     * Query: cleanup?, graceful?, keepMgmtNet?, nodeFilter?
     */
    async destroyLab(
        labName: string,
        options?: { cleanup?: boolean; graceful?: boolean },
    ): Promise<{
        success: boolean;
        error?: string;
    }> {
        try {
            const params = new URLSearchParams();
            if (options?.cleanup) params.set('cleanup', 'true');
            if (options?.graceful) params.set('graceful', 'true');

            const qs = params.toString() ? `?${params.toString()}` : '';
            const res = await this.authedFetch(
                `/api/v1/labs/${encodeURIComponent(labName)}${qs}`,
                {
                    method: 'DELETE',
                    signal: AbortSignal.timeout(TIMEOUT_MS),
                },
            );

            if (!res.ok) {
                const body = await res.text();
                return {
                    success: false,
                    error: `Destroy failed (${res.status}): ${body}`,
                };
            }

            return { success: true };
        } catch (error) {
            const err = error as Error;
            return {
                success: false,
                error: `Destroy failed: ${err.message}`,
            };
        }
    }

    /**
     * GET /api/v1/labs/{labName}
     * Response: ClabContainerInfo[]
     */
    async inspectLab(labName: string): Promise<{
        success: boolean;
        nodes?: ClabContainerInfo[];
        error?: string;
    }> {
        try {
            const res = await this.authedFetch(
                `/api/v1/labs/${encodeURIComponent(labName)}`,
                {
                    method: 'GET',
                    signal: AbortSignal.timeout(TIMEOUT_MS),
                },
            );

            if (!res.ok) {
                const body = await res.text();
                return {
                    success: false,
                    error: `Inspect failed (${res.status}): ${body}`,
                };
            }

            // Response is ClabContainerInfo[]
            const data = await res.json();
            const nodes: ClabContainerInfo[] = Array.isArray(data) ? data : flattenInspectOutput(data);

            return { success: true, nodes };
        } catch (error) {
            const err = error as Error;
            return {
                success: false,
                error: `Inspect failed: ${err.message}`,
            };
        }
    }

    /**
     * GET /api/v1/labs
     * Response: models.ClabInspectOutput = Record<labName, ClabContainerInfo[]>
     */
    async listLabs(): Promise<{
        success: boolean;
        labs?: LabInfo[];
        error?: string;
    }> {
        try {
            const res = await this.authedFetch('/api/v1/labs', {
                method: 'GET',
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });

            if (!res.ok) {
                const body = await res.text();
                return {
                    success: false,
                    error: `List labs failed (${res.status}): ${body}`,
                };
            }

            // ClabInspectOutput: Record<labName, ClabContainerInfo[]>
            const data = (await res.json()) as ClabInspectOutput;
            const labs: LabInfo[] = Object.entries(data).map(
                ([labName, containers]) => ({
                    labName,
                    owner: containers[0]?.owner,
                    nodeCount: containers.length,
                    nodes: containers,
                }),
            );

            return { success: true, labs };
        } catch (error) {
            const err = error as Error;
            return {
                success: false,
                error: `List labs failed: ${err.message}`,
            };
        }
    }

    /**
     * POST /api/v1/labs/{labName}/nodes/{nodeName}/ssh
     * Body: models.SSHAccessRequest { duration?, sshUsername? }
     * Response: models.SSHAccessResponse { host, port, username, command, expiration }
     */
    async getSSHProxyInfo(
        labName: string,
        nodeName: string,
        options?: SSHAccessRequest,
    ): Promise<{
        success: boolean;
        data?: SSHProxyInfo;
        error?: string;
    }> {
        try {
            const res = await this.authedFetch(
                `/api/v1/labs/${encodeURIComponent(labName)}/nodes/${encodeURIComponent(nodeName)}/ssh`,
                {
                    method: 'POST',
                    body: JSON.stringify(options ?? {}),
                    signal: AbortSignal.timeout(TIMEOUT_MS),
                },
            );

            if (!res.ok) {
                const body = await res.text();
                return {
                    success: false,
                    error: `SSH access request failed (${res.status}): ${body}`,
                };
            }

            const data = (await res.json()) as {
                host: string;
                port: number;
                username: string;
                command: string;
                expiration: string;
            };

            return {
                success: true,
                data: {
                    host: data.host,
                    port: data.port,
                    username: data.username,
                    command: data.command,
                    expiration: data.expiration,
                    nodeName,
                },
            };
        } catch (error) {
            const err = error as Error;
            return {
                success: false,
                error: `SSH proxy info failed: ${err.message}`,
            };
        }
    }

    /**
     * POST /api/v1/labs/{labName}/exec
     * Body: models.ExecRequest { command }
     * Query: nodeFilter? (comma-separated node names)
     * Response: models.ExecResponse = Record<nodeName, ExecResult[]>
     */
    async execCommand(
        labName: string,
        command: string,
        nodeFilter?: string,
    ): Promise<{
        success: boolean;
        data?: ExecResponse;
        error?: string;
    }> {
        try {
            const params = new URLSearchParams();
            if (nodeFilter) params.set('nodeFilter', nodeFilter);
            const qs = params.toString() ? `?${params.toString()}` : '';

            const res = await this.authedFetch(
                `/api/v1/labs/${encodeURIComponent(labName)}/exec${qs}`,
                {
                    method: 'POST',
                    body: JSON.stringify({ command }),
                    signal: AbortSignal.timeout(TIMEOUT_MS),
                },
            );

            if (!res.ok) {
                const body = await res.text();
                return {
                    success: false,
                    error: `Exec failed (${res.status}): ${body}`,
                };
            }

            const data = (await res.json()) as ExecResponse;
            return { success: true, data };
        } catch (error) {
            const err = error as Error;
            return {
                success: false,
                error: `Exec failed: ${err.message}`,
            };
        }
    }

    /**
     * GET /api/v1/ssh/sessions
     * Query: all? (superuser only)
     * Response: SSHSessionInfo[]
     */
    async listSSHSessions(all?: boolean): Promise<{
        success: boolean;
        sessions?: SSHSessionInfo[];
        error?: string;
    }> {
        try {
            const qs = all ? '?all=true' : '';
            const res = await this.authedFetch(`/api/v1/ssh/sessions${qs}`, {
                method: 'GET',
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });

            if (!res.ok) {
                const body = await res.text();
                return {
                    success: false,
                    error: `List SSH sessions failed (${res.status}): ${body}`,
                };
            }

            const sessions = (await res.json()) as SSHSessionInfo[];
            return { success: true, sessions };
        } catch (error) {
            const err = error as Error;
            return {
                success: false,
                error: `List SSH sessions failed: ${err.message}`,
            };
        }
    }

    /**
     * DELETE /api/v1/ssh/sessions/{port}
     */
    async terminateSSHSession(port: number): Promise<{
        success: boolean;
        error?: string;
    }> {
        try {
            const res = await this.authedFetch(
                `/api/v1/ssh/sessions/${port}`,
                {
                    method: 'DELETE',
                    signal: AbortSignal.timeout(TIMEOUT_MS),
                },
            );

            if (!res.ok) {
                const body = await res.text();
                return {
                    success: false,
                    error: `Terminate SSH session failed (${res.status}): ${body}`,
                };
            }

            return { success: true };
        } catch (error) {
            const err = error as Error;
            return {
                success: false,
                error: `Terminate SSH session failed: ${err.message}`,
            };
        }
    }
}

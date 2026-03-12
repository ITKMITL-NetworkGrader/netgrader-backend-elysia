/**
 * GNS3 Service - Handles communication with GNS3 API
 * Used for playground testing with custom GNS3 servers
 */

/**
 * DSEC-01: SSRF validation — blocks requests to internal/loopback addresses.
 * Must be called before every outbound HTTP request.
 */
function validateGNS3Target(ip: string, port: number): void {
    const normalised = ip.trim().toLowerCase();

    // R2-2: Only allow dotted-decimal IPv4 to prevent DNS rebinding/octal/hex bypasses
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalised)) {
        throw new Error('SSRF blocked: only dotted-decimal IPv4 addresses are allowed');
    }

    // R4-5: Validate each octet is 0-255
    const octets = normalised.split('.').map(Number);
    if (octets.some(o => o < 0 || o > 255)) {
        throw new Error('SSRF blocked: invalid IPv4 octet (must be 0-255)');
    }

    // R4-5: Block 0.0.0.0/8 (routes to localhost on many systems)
    if (octets[0] === 0) {
        throw new Error('SSRF blocked: 0.x.x.x range is not allowed');
    }

    // Block localhost variants
    if (
        normalised === 'localhost' ||
        normalised === '::1'
    ) {
        throw new Error('SSRF blocked: loopback/internal address is not allowed');
    }

    // Block 127.x.x.x (loopback range)
    if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalised)) {
        throw new Error('SSRF blocked: loopback/internal address is not allowed');
    }

    // Block 169.254.x.x (link-local)
    if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(normalised)) {
        throw new Error('SSRF blocked: link-local address is not allowed');
    }

    // D-4: Block RFC1918 private ranges
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalised)) {
        throw new Error('SSRF blocked: private network address (10.x) is not allowed');
    }
    if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(normalised)) {
        throw new Error('SSRF blocked: private network address (172.16-31.x) is not allowed');
    }
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(normalised)) {
        throw new Error('SSRF blocked: private network address (192.168.x) is not allowed');
    }
    // Block IPv4-mapped IPv6
    if (normalised.startsWith('::ffff:')) {
        throw new Error('SSRF blocked: IPv4-mapped IPv6 address is not allowed');
    }

    // Validate port range
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('SSRF blocked: invalid port number');
    }
}

interface GNS3Config {
    serverIp: string;
    serverPort: number;
    auth?: {
        username: string;
        password: string;
    };
}

interface GNS3Project {
    project_id: string;
    name: string;
    status?: string;
    path?: string;
}

interface GNS3Version {
    version: string;
    local: boolean;
}

export class GNS3Service {
    /**
     * Build base URL for GNS3 API
     */
    private static buildBaseUrl(config: GNS3Config): string {
        return `http://${config.serverIp}:${config.serverPort}`;
    }

    /**
     * Build headers for GNS3 API requests
     */
    private static buildHeaders(config: GNS3Config): HeadersInit {
        const headers: HeadersInit = {
            'Content-Type': 'application/json',
        };

        if (config.auth) {
            const credentials = Buffer.from(
                `${config.auth.username}:${config.auth.password}`
            ).toString('base64');
            headers['Authorization'] = `Basic ${credentials}`;
        }

        return headers;
    }

    /**
     * Test connectivity to GNS3 server
     * Returns version info if successful
     */
    static async testConnectivity(config: GNS3Config): Promise<{
        success: boolean;
        version?: string;
        error?: string;
    }> {
        try {
            validateGNS3Target(config.serverIp, config.serverPort);
            const url = `${this.buildBaseUrl(config)}/v2/version`;
            const response = await fetch(url, {
                method: 'GET',
                headers: this.buildHeaders(config),
                signal: AbortSignal.timeout(10000), // 10 second timeout
            });

            if (!response.ok) {
                if (response.status === 401) {
                    return {
                        success: false,
                        error: 'Authentication failed. Check your username and password.',
                    };
                }
                return {
                    success: false,
                    error: `Server returned status ${response.status}: ${response.statusText}`,
                };
            }

            const data = (await response.json()) as GNS3Version;
            return {
                success: true,
                version: data.version,
            };
        } catch (error) {
            const err = error as Error;
            if (err.name === 'TimeoutError' || err.name === 'AbortError') {
                return {
                    success: false,
                    error: 'Connection timed out. Check if the server is running and accessible.',
                };
            }
            return {
                success: false,
                error: `Connection failed: ${err.message}`,
            };
        }
    }

    /**
     * Create a new project on GNS3 server or return existing if name matches
     * If a project with the same name exists, it will return that project's ID
     */
    static async createProject(
        config: GNS3Config,
        projectName: string
    ): Promise<{
        success: boolean;
        projectId?: string;
        projectName?: string;
        isExisting?: boolean;
        error?: string;
    }> {
        try {
            validateGNS3Target(config.serverIp, config.serverPort);
            const url = `${this.buildBaseUrl(config)}/v2/projects`;
            const response = await fetch(url, {
                method: 'POST',
                headers: this.buildHeaders(config),
                body: JSON.stringify({
                    name: projectName,
                }),
                signal: AbortSignal.timeout(15000), // 15 second timeout
            });

            if (!response.ok) {
                if (response.status === 401) {
                    return {
                        success: false,
                        error: 'Authentication failed. Check your username and password.',
                    };
                }
                if (response.status === 409) {
                    // Project already exists - find it and return its ID
                    const existingProject = await this.findProjectByName(config, projectName);
                    if (existingProject.success && existingProject.projectId) {
                        return {
                            success: true,
                            projectId: existingProject.projectId,
                            projectName: existingProject.projectName,
                            isExisting: true,
                        };
                    }
                    return {
                        success: false,
                        error: `A project named "${projectName}" already exists but could not be found.`,
                    };
                }
                const errorText = await response.text();
                return {
                    success: false,
                    error: `Failed to create project: ${errorText}`,
                };
            }

            const data = (await response.json()) as GNS3Project;
            return {
                success: true,
                projectId: data.project_id,
                projectName: data.name,
                isExisting: false,
            };
        } catch (error) {
            const err = error as Error;
            return {
                success: false,
                error: `Failed to create project: ${err.message}`,
            };
        }
    }

    /**
     * List all projects on GNS3 server
     */
    static async listProjects(config: GNS3Config): Promise<{
        success: boolean;
        projects?: GNS3Project[];
        error?: string;
    }> {
        try {
            validateGNS3Target(config.serverIp, config.serverPort);
            const url = `${this.buildBaseUrl(config)}/v2/projects`;
            const response = await fetch(url, {
                method: 'GET',
                headers: this.buildHeaders(config),
                signal: AbortSignal.timeout(10000),
            });

            if (!response.ok) {
                if (response.status === 401) {
                    return {
                        success: false,
                        error: 'Authentication failed. Check your username and password.',
                    };
                }
                return {
                    success: false,
                    error: `Failed to list projects: ${response.statusText}`,
                };
            }

            const projects = (await response.json()) as GNS3Project[];
            return {
                success: true,
                projects,
            };
        } catch (error) {
            const err = error as Error;
            if (err.name === 'TimeoutError' || err.name === 'AbortError') {
                return {
                    success: false,
                    error: 'Connection timed out. Check if the server is running and accessible.',
                };
            }
            return {
                success: false,
                error: `Failed to list projects: ${err.message}`,
            };
        }
    }

    /**
     * Find a project by name
     */
    static async findProjectByName(
        config: GNS3Config,
        projectName: string
    ): Promise<{
        success: boolean;
        projectId?: string;
        projectName?: string;
        error?: string;
    }> {
        try {
            validateGNS3Target(config.serverIp, config.serverPort);
            const url = `${this.buildBaseUrl(config)}/v2/projects`;
            const response = await fetch(url, {
                method: 'GET',
                headers: this.buildHeaders(config),
                signal: AbortSignal.timeout(10000),
            });

            if (!response.ok) {
                return {
                    success: false,
                    error: `Failed to list projects: ${response.statusText}`,
                };
            }

            const projects = (await response.json()) as GNS3Project[];
            const project = projects.find(p => p.name === projectName);

            if (project) {
                return {
                    success: true,
                    projectId: project.project_id,
                    projectName: project.name,
                };
            }

            return {
                success: false,
                error: `Project "${projectName}" not found`,
            };
        } catch (error) {
            const err = error as Error;
            return {
                success: false,
                error: `Failed to find project: ${err.message}`,
            };
        }
    }


    /**
     * Open/activate a project on GNS3 server
     */
    static async openProject(
        config: GNS3Config,
        projectId: string
    ): Promise<{
        success: boolean;
        error?: string;
    }> {
        try {
            validateGNS3Target(config.serverIp, config.serverPort);
            const url = `${this.buildBaseUrl(config)}/v2/projects/${projectId}/open`;
            const response = await fetch(url, {
                method: 'POST',
                headers: this.buildHeaders(config),
                signal: AbortSignal.timeout(15000),
            });

            if (!response.ok) {
                const errorText = await response.text();
                return {
                    success: false,
                    error: `Failed to open project: ${errorText}`,
                };
            }

            return { success: true };
        } catch (error) {
            const err = error as Error;
            return {
                success: false,
                error: `Failed to open project: ${err.message}`,
            };
        }
    }

    /**
     * List all nodes in a project
     */
    static async listNodes(
        config: GNS3Config,
        projectId: string
    ): Promise<{
        success: boolean;
        nodes?: Array<{
            node_id: string;
            name: string;
            node_type: string;
            console?: number;
            console_host?: string;
            status?: string;
        }>;
        error?: string;
    }> {
        try {
            validateGNS3Target(config.serverIp, config.serverPort);
            const url = `${this.buildBaseUrl(config)}/v2/projects/${projectId}/nodes`;
            const response = await fetch(url, {
                method: 'GET',
                headers: this.buildHeaders(config),
                signal: AbortSignal.timeout(10000),
            });

            if (!response.ok) {
                const errorText = await response.text();
                return {
                    success: false,
                    error: `Failed to list nodes: ${errorText}`,
                };
            }

            const nodes = await response.json();
            return {
                success: true,
                nodes,
            };
        } catch (error) {
            const err = error as Error;
            return {
                success: false,
                error: `Failed to list nodes: ${err.message}`,
            };
        }
    }
}

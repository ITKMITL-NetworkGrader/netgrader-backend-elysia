/**
 * GNS3 Service - Handles communication with GNS3 API
 * Used for playground testing with custom GNS3 servers
 */

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

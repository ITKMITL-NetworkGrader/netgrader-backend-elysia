/**
 * GNS3 v3 Service - Handles communication with GNS3 API v3
 * Used for student lab environment setup with Resource Pool-based permissions
 * Supports multiple GNS3 servers with hash-based user sharding
 */
import { env } from "process";
import crypto from "crypto";

interface GNS3v3Config {
    serverIp: string;
    serverPort: number;
    serverVersion: string;
}

interface GNS3ServerConfig extends GNS3v3Config {
    adminUsername: string;
    adminPassword: string;
}

interface LoginResponse {
    access_token: string;
    token_type: string;
}

interface UserResponse {
    user_id: string;
    username: string;
    full_name: string;
    is_active: boolean;
}

interface ProjectResponse {
    project_id: string;
    name: string;
    status?: string;
}

interface PoolResponse {
    resource_pool_id: string;
    name: string;
}

interface RoleResponse {
    role_id: string;
    name: string;
    description?: string;
}

interface ACEResponse {
    ace_id: string;
    ace_type: string;
    path: string;
}

/** GNS3 Node response from /projects/{project_id}/nodes API */
export interface GNS3Node {
    name: string;
    node_id: string;
    console: number | null;
    console_type: string | null;
    aux: number | null;
    aux_type: string | null;
    status: string;
}

export interface SetupResult {
    success: boolean;
    error?: string;
    credentials?: {
        username: string;
        password: string;
    };
    loginUrl?: string;
    projectUrl?: string;
    projectId?: string;
    projectName?: string;
    userId?: string;
    poolId?: string;
    serverIndex?: number;
}

/**
 * Parse GNS3 servers from environment variables
 * Format: GNS3_SERVERS=host1,host2  GNS3_PORTS=3080,3080
 */
function parseServersFromEnv(): GNS3ServerConfig[] {
    const serversEnv = env.GNS3_SERVERS || env.GNS3_SERVER || 'localhost';
    const portsEnv = env.GNS3_PORTS || env.GNS3_PORT || '3080';
    const version = env.GNS3_VERSION || 'v3';
    const adminUsername = env.GNS3_USERNAME || 'admin';
    const adminPassword = env.GNS3_PASSWORD || 'admin';

    const servers = serversEnv.split(',').map(s => s.trim());
    const ports = portsEnv.split(',').map(p => parseInt(p.trim()) || 3080);

    return servers.map((serverIp, index) => ({
        serverIp,
        serverPort: ports[index] || ports[0] || 3080,
        serverVersion: version,
        adminUsername,
        adminPassword,
    }));
}

// Multi-server configuration
const GNS3_SERVERS: GNS3ServerConfig[] = parseServersFromEnv();

// Default config (first server) for backward compatibility
const DEFAULT_CONFIG: GNS3v3Config = {
    serverIp: GNS3_SERVERS[0]?.serverIp || 'localhost',
    serverPort: GNS3_SERVERS[0]?.serverPort || 3080,
    serverVersion: GNS3_SERVERS[0]?.serverVersion || 'v3',
};

const ADMIN_CREDENTIALS = {
    username: GNS3_SERVERS[0]?.adminUsername || 'admin',
    password: GNS3_SERVERS[0]?.adminPassword || 'admin',
};

export class GNS3v3Service {
    /**
     * Calculate initial server index for a NEW user using hash-based sharding
     * Only called once when user first needs GNS3 access, result is stored in MongoDB
     * Uses modulo 2 to ensure consistency even if server count changes later
     * XORs all bytes of hash for better distribution across servers
     */
    static calculateInitialServerIndex(userId: string): number {
        const hash = crypto.createHash("sha256").update(userId).digest();
        // XOR all bytes together for better distribution
        let xorResult = 0;
        for (let i = 0; i < hash.length; i++) {
            xorResult ^= hash[i];
        }
        return xorResult % 2; // Always mod 2 for consistency
    }

    /**
     * Get server configuration by index
     */
    static getServerConfig(serverIndex: number): GNS3ServerConfig {
        if (serverIndex >= GNS3_SERVERS.length) {
            console.warn(`Server index ${serverIndex} out of range, using server 0`);
            return GNS3_SERVERS[0];
        }
        return GNS3_SERVERS[serverIndex];
    }

    /**
     * Generate deterministic password for GNS3 user
     * Same password is generated for the same username every time
     */
    static generateDeterministicPassword(username: string): string {
        return crypto.createHash("sha256")
            .update(username + "netg")
            .digest("hex")
            .substring(0, 16);
    }

    /**
     * Get the number of available GNS3 servers
     */
    static getAvailableServersCount(): number {
        return GNS3_SERVERS.length;
    }

    /**
     * Build base URL for GNS3 API v3
     */
    private static buildBaseUrl(config: GNS3v3Config = DEFAULT_CONFIG): string {
        // return `http://${config.serverIp}:${config.serverPort}/${config.serverVersion}`;
        return `https://${config.serverIp}:/${config.serverVersion}`;
    }

    /**
     * Build headers with Bearer token
     */
    private static buildHeaders(token?: string): HeadersInit {
        const headers: HeadersInit = {
            'Content-Type': 'application/json',
        };

        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        return headers;
    }

    /**
     * Step 0: Admin Login - Get access token
     * GNS3 v3 API requires x-www-form-urlencoded format for login
     */
    static async login(
        config: GNS3v3Config = DEFAULT_CONFIG,
        username: string = ADMIN_CREDENTIALS.username,
        password: string = ADMIN_CREDENTIALS.password
    ): Promise<{ success: boolean; accessToken?: string; error?: string }> {
        try {
            const url = `${this.buildBaseUrl(config)}/access/users/login`;

            // GNS3 v3 login requires x-www-form-urlencoded format
            const formData = new URLSearchParams();
            formData.append('username', username);
            formData.append('password', password);

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: formData.toString(),
                signal: AbortSignal.timeout(15000),
            });

            if (!response.ok) {
                if (response.status === 401) {
                    return { success: false, error: 'Invalid admin credentials' };
                }
                const errorText = await response.text();
                return { success: false, error: `Login failed: ${response.statusText} - ${errorText}` };
            }

            const data = (await response.json()) as LoginResponse;
            return { success: true, accessToken: data.access_token };
        } catch (error) {
            const err = error as Error;
            return { success: false, error: `Login failed: ${err.message}` };
        }
    }

    /**
     * Step 1: Create User
     */
    static async createUser(
        token: string,
        userData: { username: string; password: string; fullName: string },
        config: GNS3v3Config = DEFAULT_CONFIG
    ): Promise<{ success: boolean; userId?: string; error?: string }> {
        try {
            const url = `${this.buildBaseUrl(config)}/access/users`;
            const response = await fetch(url, {
                method: 'POST',
                headers: this.buildHeaders(token),
                body: JSON.stringify({
                    username: userData.username,
                    password: userData.password,
                    full_name: userData.fullName,
                    is_active: true,
                }),
                signal: AbortSignal.timeout(15000),
            });

            if (!response.ok) {
                // Check if user already exists (409 Conflict)
                if (response.status === 409) {
                    // Try to find existing user
                    const existingUser = await this.findUserByUsername(token, userData.username, config);
                    if (existingUser.success && existingUser.userId) {
                        return { success: true, userId: existingUser.userId };
                    }
                }
                const errorText = await response.text();
                return { success: false, error: `Failed to create user: ${errorText}` };
            }

            const data = (await response.json()) as UserResponse;
            return { success: true, userId: data.user_id };
        } catch (error) {
            const err = error as Error;
            return { success: false, error: `Failed to create user: ${err.message}` };
        }
    }

    /**
     * Find user by username
     */
    static async findUserByUsername(
        token: string,
        username: string,
        config: GNS3v3Config = DEFAULT_CONFIG
    ): Promise<{ success: boolean; userId?: string; error?: string }> {
        try {
            const url = `${this.buildBaseUrl(config)}/access/users`;
            const response = await fetch(url, {
                method: 'GET',
                headers: this.buildHeaders(token),
                signal: AbortSignal.timeout(10000),
            });

            if (!response.ok) {
                return { success: false, error: 'Failed to list users' };
            }

            const users = (await response.json()) as UserResponse[];
            const user = users.find(u => u.username === username);

            if (user) {
                return { success: true, userId: user.user_id };
            }
            return { success: false, error: 'User not found' };
        } catch (error) {
            const err = error as Error;
            return { success: false, error: `Failed to find user: ${err.message}` };
        }
    }

    /**
     * Step 2: Create Project
     */
    static async createProject(
        token: string,
        projectName: string,
        config: GNS3v3Config = DEFAULT_CONFIG
    ): Promise<{ success: boolean; projectId?: string; projectName?: string; isExisting?: boolean; error?: string }> {
        try {
            const url = `${this.buildBaseUrl(config)}/projects`;
            const response = await fetch(url, {
                method: 'POST',
                headers: this.buildHeaders(token),
                body: JSON.stringify({
                    name: projectName,
                    auto_open: false,
                    auto_close: false
                }),
                signal: AbortSignal.timeout(15000),
            });

            if (!response.ok) {
                if (response.status === 409) {
                    // Project exists, find it
                    const existing = await this.findProjectByName(token, projectName, config);
                    if (existing.success && existing.projectId) {
                        return {
                            success: true,
                            projectId: existing.projectId,
                            projectName: existing.projectName,
                            isExisting: true
                        };
                    }
                }
                const errorText = await response.text();
                return { success: false, error: `Failed to create project: ${errorText}` };
            }

            const data = (await response.json()) as ProjectResponse;
            return {
                success: true,
                projectId: data.project_id,
                projectName: data.name,
                isExisting: false
            };
        } catch (error) {
            const err = error as Error;
            return { success: false, error: `Failed to create project: ${err.message}` };
        }
    }

    /**
     * Find project by name
     */
    static async findProjectByName(
        token: string,
        projectName: string,
        config: GNS3v3Config = DEFAULT_CONFIG
    ): Promise<{ success: boolean; projectId?: string; projectName?: string; error?: string }> {
        try {
            const url = `${this.buildBaseUrl(config)}/projects`;
            const response = await fetch(url, {
                method: 'GET',
                headers: this.buildHeaders(token),
                signal: AbortSignal.timeout(10000),
            });

            if (!response.ok) {
                return { success: false, error: 'Failed to list projects' };
            }

            const projects = (await response.json()) as ProjectResponse[];
            const project = projects.find(p => p.name === projectName);

            if (project) {
                return { success: true, projectId: project.project_id, projectName: project.name };
            }
            return { success: false, error: 'Project not found' };
        } catch (error) {
            const err = error as Error;
            return { success: false, error: `Failed to find project: ${err.message}` };
        }
    }

    /**
     * Get all nodes from a GNS3 project
     * Used to fetch console/aux ports for device mapping
     */
    static async getProjectNodes(
        token: string,
        projectId: string,
        config: GNS3v3Config = DEFAULT_CONFIG
    ): Promise<{ success: boolean; nodes?: GNS3Node[]; error?: string }> {
        try {
            const url = `${this.buildBaseUrl(config)}/projects/${projectId}/nodes`;
            const response = await fetch(url, {
                method: 'GET',
                headers: this.buildHeaders(token),
                signal: AbortSignal.timeout(15000),
            });

            if (!response.ok) {
                const errorText = await response.text();
                return { success: false, error: `Failed to get project nodes: ${errorText}` };
            }

            const nodes = (await response.json()) as GNS3Node[];
            return { success: true, nodes };
        } catch (error) {
            const err = error as Error;
            return { success: false, error: `Failed to get project nodes: ${err.message}` };
        }
    }

    /**
     * Step 3: Create Resource Pool
     */
    static async createPool(
        token: string,
        poolName: string,
        config: GNS3v3Config = DEFAULT_CONFIG
    ): Promise<{ success: boolean; poolId?: string; isExisting?: boolean; error?: string }> {
        try {
            const url = `${this.buildBaseUrl(config)}/pools`;
            const response = await fetch(url, {
                method: 'POST',
                headers: this.buildHeaders(token),
                body: JSON.stringify({ name: poolName }),
                signal: AbortSignal.timeout(15000),
            });

            if (!response.ok) {
                if (response.status === 409) {
                    // Pool exists, find it
                    const existing = await this.findPoolByName(token, poolName, config);
                    if (existing.success && existing.poolId) {
                        return { success: true, poolId: existing.poolId, isExisting: true };
                    }
                }
                const errorText = await response.text();
                return { success: false, error: `Failed to create pool: ${errorText}` };
            }

            const data = (await response.json()) as PoolResponse;
            return { success: true, poolId: data.resource_pool_id, isExisting: false };
        } catch (error) {
            const err = error as Error;
            return { success: false, error: `Failed to create pool: ${err.message}` };
        }
    }

    /**
     * Find pool by name
     */
    static async findPoolByName(
        token: string,
        poolName: string,
        config: GNS3v3Config = DEFAULT_CONFIG
    ): Promise<{ success: boolean; poolId?: string; error?: string }> {
        try {
            const url = `${this.buildBaseUrl(config)}/pools`;
            const response = await fetch(url, {
                method: 'GET',
                headers: this.buildHeaders(token),
                signal: AbortSignal.timeout(10000),
            });

            if (!response.ok) {
                return { success: false, error: 'Failed to list pools' };
            }

            const pools = (await response.json()) as PoolResponse[];
            const pool = pools.find(p => p.name === poolName);

            if (pool) {
                return { success: true, poolId: pool.resource_pool_id };
            }
            return { success: false, error: 'Pool not found' };
        } catch (error) {
            const err = error as Error;
            return { success: false, error: `Failed to find pool: ${err.message}` };
        }
    }

    /**
     * Step 4: Add Project to Resource Pool
     * Handles case where project is already in the pool
     */
    static async addProjectToPool(
        token: string,
        poolId: string,
        projectId: string,
        config: GNS3v3Config = DEFAULT_CONFIG
    ): Promise<{ success: boolean; isExisting?: boolean; error?: string }> {
        try {
            const url = `${this.buildBaseUrl(config)}/pools/${poolId}/resources/${projectId}`;
            const response = await fetch(url, {
                method: 'PUT',
                headers: this.buildHeaders(token),
                signal: AbortSignal.timeout(15000),
            });

            // 204 No Content means success
            if (response.status === 204 || response.ok) {
                return { success: true, isExisting: false };
            }

            // 409 Conflict means project is already in pool - that's fine
            if (response.status === 409) {
                return { success: true, isExisting: true };
            }

            // Check if error message indicates resource is already in pool
            const errorText = await response.text();
            if (errorText.includes('already in')) {
                return { success: true, isExisting: true };
            }

            return { success: false, error: `Failed to add project to pool: ${errorText}` };
        } catch (error) {
            const err = error as Error;
            return { success: false, error: `Failed to add project to pool: ${err.message}` };
        }
    }

    /**
     * Step 5: Get Roles (find Student role)
     */
    static async getStudentRoleId(
        token: string,
        config: GNS3v3Config = DEFAULT_CONFIG
    ): Promise<{ success: boolean; roleId?: string; error?: string }> {
        try {
            const url = `${this.buildBaseUrl(config)}/access/roles`;
            const response = await fetch(url, {
                method: 'GET',
                headers: this.buildHeaders(token),
                signal: AbortSignal.timeout(10000),
            });

            if (!response.ok) {
                return { success: false, error: 'Failed to get roles' };
            }

            const roles = (await response.json()) as RoleResponse[];
            const studentRole = roles.find(r => r.name.toLowerCase() === 'student');

            if (studentRole) {
                return { success: true, roleId: studentRole.role_id };
            }
            return { success: false, error: 'Student role not found' };
        } catch (error) {
            const err = error as Error;
            return { success: false, error: `Failed to get roles: ${err.message}` };
        }
    }

    /**
     * Step 6: Create ACE (Access Control Entry)
     * Path must be in URI format: /pools/{pool_id}
     */
    static async createACE(
        token: string,
        aceData: {
            userId: string;
            roleId: string;
            poolId: string;
        },
        config: GNS3v3Config = DEFAULT_CONFIG
    ): Promise<{ success: boolean; aceId?: string; error?: string }> {
        try {
            const url = `${this.buildBaseUrl(config)}/access/acl`;

            // Path must be in URI format: /pools/{pool_id}
            const aclPath = `/pools/${aceData.poolId}`;

            const response = await fetch(url, {
                method: 'POST',
                headers: this.buildHeaders(token),
                body: JSON.stringify({
                    ace_type: 'user',
                    user_id: aceData.userId,
                    role_id: aceData.roleId,
                    path: aclPath,
                    propagate: true,
                    allowed: true,
                }),
                signal: AbortSignal.timeout(15000),
            });

            if (!response.ok) {
                // ACE might already exist
                if (response.status === 409) {
                    return { success: true, aceId: 'existing' };
                }
                const errorText = await response.text();
                return { success: false, error: `Failed to create ACE: ${errorText}` };
            }

            const data = (await response.json()) as ACEResponse;
            return { success: true, aceId: data.ace_id };
        } catch (error) {
            const err = error as Error;
            return { success: false, error: `Failed to create ACE: ${err.message}` };
        }
    }

    /**
     * Generate project URL for student access
     * Direct link to project - works if already logged in
     */
    static buildProjectUrl(projectId: string, config: GNS3v3Config = DEFAULT_CONFIG): string {
        return `https://${config.serverIp}:${config.serverPort}/static/web-ui/controller/1/project/${projectId}`;
    }

    /**
     * Generate login URL for GNS3 web UI
     */
    static buildLoginUrl(config: GNS3v3Config = DEFAULT_CONFIG): string {
        return `https://${config.serverIp}`;
    }

    /**
     * Generate a student password
     */
    static generatePassword(): string {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
        let password = '';
        for (let i = 0; i < 12; i++) {
            password += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return password + '!';
    }

    /**
     * Complete Setup Workflow with Lazy Initialization and Server Sharding
     * 
     * @param studentId - Student ID (without "it" prefix)
     * @param courseName - Course name for project naming
     * @param labName - Lab name for project naming
     * @param fullName - Student's full name (for GNS3 user creation)
     * @param serverIndex - Stored server index from MongoDB (undefined if new assignment needed)
     * @param onProgress - Optional progress callback
     * @returns SetupResult with serverIndex for storing in MongoDB
     */
    static async setupStudentLab(
        studentId: string,
        courseName: string,
        labName: string,
        fullName: string = studentId,
        serverIndex?: number,
        onProgress?: (step: string) => void
    ): Promise<SetupResult> {
        try {
            const isNumericId = /^\d+$/.test(studentId);
            const username = isNumericId ? `it${studentId}` : studentId;
            const poolName = `${username}-pool`;
            const projectName = `${username}-${courseName}-${labName}`;

            // Step 0: Determine server assignment
            onProgress?.('determining_server');
            const isNewAssignment = serverIndex === undefined;
            const assignedServerIndex = serverIndex ?? this.calculateInitialServerIndex(studentId);
            const serverConfig = this.getServerConfig(assignedServerIndex);

            console.log(`[GNS3] User ${username} assigned to server ${assignedServerIndex} (${serverConfig.serverIp})`);

            // Step 1: Login to assigned server
            onProgress?.('connecting');
            const loginResult = await this.login(serverConfig, serverConfig.adminUsername, serverConfig.adminPassword);
            if (!loginResult.success || !loginResult.accessToken) {
                return { success: false, error: loginResult.error || 'Failed to authenticate with GNS3 server' };
            }
            const token = loginResult.accessToken;

            // Step 2: Ensure user exists (lazy create if not)
            onProgress?.('ensuring_user');
            let userResult = await this.findUserByUsername(token, username, serverConfig);
            if (!userResult.success || !userResult.userId) {
                // User doesn't exist - create with deterministic password
                const password = this.generateDeterministicPassword(username);
                console.log(`[GNS3] Creating user ${username} on server ${assignedServerIndex}`);
                userResult = await this.createUser(token, {
                    username,
                    password,
                    fullName: fullName || studentId,
                }, serverConfig);

                if (!userResult.success || !userResult.userId) {
                    return { success: false, error: userResult.error || 'Failed to create GNS3 user' };
                }
            }

            // Step 3: Ensure pool exists (lazy create if not)
            onProgress?.('ensuring_pool');
            let poolResult = await this.findPoolByName(token, poolName, serverConfig);
            if (!poolResult.success || !poolResult.poolId) {
                // Pool doesn't exist - create it
                console.log(`[GNS3] Creating pool ${poolName} on server ${assignedServerIndex}`);
                poolResult = await this.createPool(token, poolName, serverConfig);

                if (!poolResult.success || !poolResult.poolId) {
                    return { success: false, error: poolResult.error || 'Failed to create GNS3 resource pool' };
                }
            }

            // Step 4: Ensure ACE exists (idempotent - handles 409 conflict)
            onProgress?.('ensuring_access');
            const roleResult = await this.getStudentRoleId(token, serverConfig);
            if (roleResult.success && roleResult.roleId) {
                const aceResult = await this.createACE(token, {
                    userId: userResult.userId,
                    roleId: roleResult.roleId,
                    poolId: poolResult.poolId,
                }, serverConfig);
                if (!aceResult.success) {
                    console.warn(`[GNS3] Failed to create ACE (may already exist): ${aceResult.error}`);
                    // Continue anyway - ACE might already exist
                }
            } else {
                console.warn(`[GNS3] Could not get Student role for ACE: ${roleResult.error}`);
            }

            // Step 5: Create Project
            onProgress?.('creating_project');
            const projectResult = await this.createProject(token, projectName, serverConfig);
            if (!projectResult.success || !projectResult.projectId) {
                return { success: false, error: projectResult.error || 'Failed to create project' };
            }

            // Step 6: Add Project to Pool
            onProgress?.('adding_to_pool');
            const addResult = await this.addProjectToPool(token, poolResult.poolId, projectResult.projectId, serverConfig);
            if (!addResult.success) {
                return { success: false, error: addResult.error || 'Failed to add project to pool' };
            }

            // Build URLs
            const projectUrl = this.buildProjectUrl(projectResult.projectId, serverConfig);
            const loginUrl = this.buildLoginUrl(serverConfig);
            const password = this.generateDeterministicPassword(username);

            return {
                success: true,
                credentials: { username, password },
                loginUrl,
                projectUrl,
                projectId: projectResult.projectId,
                projectName: projectResult.projectName,
                userId: userResult.userId,
                poolId: poolResult.poolId,
                serverIndex: assignedServerIndex,
            };
        } catch (error) {
            const err = error as Error;
            return { success: false, error: `Setup failed: ${err.message}` };
        }
    }
}

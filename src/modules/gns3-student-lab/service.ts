/**
 * GNS3 v3 Service - Handles communication with GNS3 API v3
 * Used for student lab environment setup with Resource Pool-based permissions
 */
import { env } from "process";

interface GNS3v3Config {
    serverIp: string;
    serverPort: number;
    serverVersion: string;
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
}

// Default GNS3 Server Configuration
const DEFAULT_CONFIG: GNS3v3Config = {
    serverIp: env.GNS3_SERVER || 'localhost',
    serverPort: parseInt(env.GNS3_PORT || '3080'),
    serverVersion: env.GNS3_VERSION || 'v3',
};

const ADMIN_CREDENTIALS = {
    username: env.GNS3_USERNAME || 'admin',
    password: env.GNS3_PASSWORD || 'admin',
};

export class GNS3v3Service {
    /**
     * Build base URL for GNS3 API v3
     */
    private static buildBaseUrl(config: GNS3v3Config = DEFAULT_CONFIG): string {
        return `http://${config.serverIp}:${config.serverPort}/${config.serverVersion}`;
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
        return `http://${config.serverIp}:${config.serverPort}/static/web-ui/controller/1/project/${projectId}`;
    }

    /**
     * Generate login URL for GNS3 web UI
     */
    static buildLoginUrl(config: GNS3v3Config = DEFAULT_CONFIG): string {
        return `http://${config.serverIp}:${config.serverPort}/static/web-ui/controller/1/login`;
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
     * Complete Setup Workflow (Simplified)
     * 
     * Assumptions:
     * - User already exists: username = "it<student_id>"
     * - Pool already exists: poolName = "it<student_id>-pool"
     * 
     * This workflow:
     * 1. Login as admin
     * 2. Find existing user
     * 3. Create project (name: "it<student_id>-<course_name>-<lab_name>")
     * 4. Find existing pool
     * 5. Add project to pool
     * 6. Create ACE for user to access pool
     */
    static async setupStudentLab(
        studentId: string,
        courseName: string,
        labName: string,
        config: GNS3v3Config = DEFAULT_CONFIG,
        onProgress?: (step: string) => void
    ): Promise<SetupResult> {
        try {
            // Naming conventions
            const username = `it${studentId}`;
            const poolName = `it${studentId}-pool`;
            const projectName = `it${studentId}-${courseName}-${labName}`;

            // Step 0: Login
            onProgress?.('connecting');
            const loginResult = await this.login(config);
            if (!loginResult.success || !loginResult.accessToken) {
                return { success: false, error: loginResult.error || 'Failed to authenticate with GNS3 server' };
            }
            const token = loginResult.accessToken;

            // Step 1: Find existing user
            onProgress?.('finding_user');
            const userResult = await this.findUserByUsername(token, username, config);
            if (!userResult.success || !userResult.userId) {
                return { success: false, error: `User "${username}" not found. Please contact your instructor.` };
            }

            // Step 2: Create Project
            onProgress?.('creating_project');
            const projectResult = await this.createProject(token, projectName, config);
            if (!projectResult.success || !projectResult.projectId) {
                return { success: false, error: projectResult.error || 'Failed to create project' };
            }

            // Step 3: Find existing pool
            onProgress?.('finding_pool');
            const poolResult = await this.findPoolByName(token, poolName, config);
            if (!poolResult.success || !poolResult.poolId) {
                return { success: false, error: `Resource pool "${poolName}" not found. Please contact your instructor.` };
            }

            // Step 4: Add Project to Pool
            onProgress?.('adding_to_pool');
            const addResult = await this.addProjectToPool(token, poolResult.poolId, projectResult.projectId, config);
            if (!addResult.success) {
                return { success: false, error: addResult.error || 'Failed to add project to pool' };
            }

            // Step 5: Get Student Role
            // onProgress?.('creating_ace');
            // const roleResult = await this.getStudentRoleId(token, config);
            // if (!roleResult.success || !roleResult.roleId) {
            //     return { success: false, error: roleResult.error || 'Failed to get Student role' };
            // }

            // // Step 6: Create ACE
            // const aceResult = await this.createACE(token, {
            //     userId: userResult.userId,
            //     roleId: roleResult.roleId,
            //     poolId: poolResult.poolId,
            // }, config);
            // if (!aceResult.success) {
            //     return { success: false, error: aceResult.error || 'Failed to create access permissions' };
            // }

            // Build URLs
            const projectUrl = this.buildProjectUrl(projectResult.projectId, config);
            const loginUrl = this.buildLoginUrl(config);

            return {
                success: true,
                credentials: { username, password: '(Use your IT password)' },
                loginUrl,
                projectUrl,
                projectId: projectResult.projectId,
                projectName: projectResult.projectName,
                userId: userResult.userId,
                poolId: poolResult.poolId,
            };
        } catch (error) {
            const err = error as Error;
            return { success: false, error: `Setup failed: ${err.message}` };
        }
    }
}

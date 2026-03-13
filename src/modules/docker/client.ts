/**
 * Docker Service - Manage Docker images for ContainerLab topologies
 *
 * Uses dockerode to build/pull images that will be used in ContainerLab.
 * Requires Docker socket mount (/var/run/docker.sock) or TCP connection.
 */

import Docker from "dockerode";

// Docker configuration
const DOCKER_HOST = process.env.DOCKER_HOST || ""; // Empty = use default socket
const DOCKER_SOCKET_PATH = process.env.DOCKER_SOCKET_PATH || "/var/run/docker.sock";

// Initialize Docker client
export let docker: Docker;

function getDockerClient(): Docker {
    if (!docker) {
        if (DOCKER_HOST) {
            // TCP connection (remote Docker)
            const [host, port] = DOCKER_HOST.split(":");
            docker = new Docker({
                host,
                port: parseInt(port, 10) || 2375,
            });
        } else {
            // Socket connection (local Docker)
            docker = new Docker({ socketPath: DOCKER_SOCKET_PATH });
        }
    }
    return docker;
}

export interface DockerImageInfo {
    id: string;
    tags: string[];
    size: number;
    created: string;
}

export interface BuildImageOptions {
    dockerfile: string;
    tag: string;
    context?: string; // Path to build context (default: ".")
    buildArgs?: Record<string, string>;
}

export interface PullImageOptions {
    imageName: string;
    tag?: string;
}

/**
 * Build a Docker image from a Dockerfile
 */
export async function buildImage(options: BuildImageOptions): Promise<{
    success: boolean;
    imageId?: string;
    error?: string;
}> {
    try {
        const docker = getDockerClient();
        const { dockerfile, tag, context = ".", buildArgs = {} } = options;

        // Read Dockerfile content
        const fs = await import("fs/promises");
        const dockerfilePath = `${context}/${dockerfile}`;
        const dockerfileContent = await fs.readFile(dockerfilePath);

        // Build the image
        const image = await docker.buildImage({
            context: context as string,
            src: [dockerfile],
        }, {
            t: tag,
            buildargs: buildArgs,
        });

        // Wait for build to complete
        await new Promise<void>((resolve, reject) => {
            docker.modem.followProgress(image, (err: Error | null, output: unknown[]) => {
                if (err) reject(err);
                else resolve();
            });
        });

        // Get the built image ID
        const images = await docker.listImages({ filters: { reference: [tag] } });
        const builtImage = images[0];

        return {
            success: true,
            imageId: builtImage?.Id,
        };
    } catch (error) {
        const err = error as Error;
        return {
            success: false,
            error: `Build failed: ${err.message}`,
        };
    }
}

/**
 * Pull a Docker image from a registry
 */
export async function pullImage(options: PullImageOptions): Promise<{
    success: boolean;
    error?: string;
}> {
    try {
        const docker = getDockerClient();
        const imageName = options.tag
            ? `${options.imageName}:${options.tag}`
            : options.imageName;

        console.log(`Pulling image: ${imageName}`);

        const image = await docker.pull(imageName);

        await new Promise<void>((resolve, reject) => {
            docker.modem.followProgress(image, (err: Error | null, output: unknown[]) => {
                if (err) reject(err);
                else resolve();
            });
        });

        return { success: true };
    } catch (error) {
        const err = error as Error;
        return {
            success: false,
            error: `Pull failed: ${err.message}`,
        };
    }
}

/**
 * List all Docker images
 */
export async function listImages(): Promise<{
    success: boolean;
    images?: DockerImageInfo[];
    error?: string;
}> {
    try {
        const docker = getDockerClient();
        const images = await docker.listImages();

        return {
            success: true,
            images: images.map((img) => ({
                id: img.Id.replace("sha256:", "").substring(0, 12),
                tags: img.RepoTags || [],
                size: img.Size,
                created: new Date(img.Created * 1000).toISOString(),
            })),
        };
    } catch (error) {
        const err = error as Error;
        return {
            success: false,
            error: `List images failed: ${err.message}`,
        };
    }
}

/**
 * Remove a Docker image
 */
export async function removeImage(imageName: string): Promise<{
    success: boolean;
    error?: string;
}> {
    try {
        const docker = getDockerClient();
        const image = docker.getImage(imageName);
        await image.remove({ force: true });

        return { success: true };
    } catch (error) {
        const err = error as Error;
        return {
            success: false,
            error: `Remove image failed: ${err.message}`,
        };
    }
}

/**
 * Check if an image exists locally
 */
export async function imageExists(imageName: string): Promise<boolean> {
    try {
        const docker = getDockerClient();
        const images = await docker.listImages({
            filters: { reference: [imageName] },
        });
        return images.length > 0;
    } catch {
        return false;
    }
}

/**
 * Test Docker connection
 */
export async function testConnection(): Promise<{
    success: boolean;
    version?: string;
    error?: string;
}> {
    try {
        const docker = getDockerClient();
        const info = await docker.version();

        return {
            success: true,
            version: info.Version,
        };
    } catch (error) {
        const err = error as Error;
        return {
            success: false,
            error: `Docker connection failed: ${err.message}`,
        };
    }
}

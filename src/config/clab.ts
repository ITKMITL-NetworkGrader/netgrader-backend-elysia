/**
 * ContainerLab API Server configuration
 *
 * Read exclusively from environment variables — credentials never come from
 * request bodies or the frontend.
 *
 * Required env vars:
 *   CLAB_SERVER_IP   — hostname or IP of the clab-api-server (default: localhost)
 *   CLAB_SERVER_PORT — port of the clab-api-server         (default: 8080)
 *   CLAB_USERNAME    — admin username for the clab-api-server
 *   CLAB_PASSWORD    — admin password for the clab-api-server
 */

import { env } from 'process';
import type { ClabConfig } from '../modules/clab/orchestrator';

export function getClabConfig(): ClabConfig {
    const serverIp = env.CLAB_SERVER_IP || 'localhost';
    const serverPort = parseInt(env.CLAB_SERVER_PORT || '8080', 10);
    const adminUsername = env.CLAB_USERNAME || 'admin';
    const adminPassword = env.CLAB_PASSWORD || '';

    return { serverIp, serverPort, adminUsername, adminPassword };
}

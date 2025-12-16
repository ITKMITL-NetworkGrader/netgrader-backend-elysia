import { Elysia, t } from "elysia";
import { PlaygroundService } from "./service";
import { LabService } from "../labs/service";
import { PartService } from "../parts/service";
import { authPlugin } from "../../plugins/plugins";

export const playgroundRoutes = new Elysia({ prefix: "/playground" })
    .use(authPlugin)
    /**
     * Get ALL devices for a lab with interface details
     * Used for lab-level device mapping (not per-part)
     */
    .get(
        "/devices/:labId",
        async ({ params, set }) => {
            try {
                const lab = await LabService.getLabById(params.labId);
                if (!lab) {
                    set.status = 404;
                    return { success: false, error: "Lab not found" };
                }

                const devices = PlaygroundService.getDevicesForLab(lab as any);

                return {
                    success: true,
                    devices,
                    totalDevices: devices.length,
                };
            } catch (error) {
                set.status = 500;
                return {
                    success: false,
                    error: `Failed to get devices: ${(error as Error).message}`
                };
            }
        },
        {
            params: t.Object({
                labId: t.String(),
            }),
            detail: {
                tags: ["Playground"],
                summary: "Get All Lab Devices",
                description: "Get all devices from a lab with their interface configurations for device mapping",
            },
        }
    )

    /**
     * Get required devices for a lab part (legacy - kept for backward compatibility)
     * Used to determine which devices need mapping
     */
    .get(
        "/devices/:labId/:partId",
        async ({ params, set }) => {
            try {
                const lab = await LabService.getLabById(params.labId);
                if (!lab) {
                    set.status = 404;
                    return { success: false, error: "Lab not found" };
                }

                const partsResponse = await PartService.getPartsByLab(params.labId);
                const part = partsResponse.parts.find(p => p.partId === params.partId);
                if (!part) {
                    set.status = 404;
                    return { success: false, error: "Part not found" };
                }

                const devices = PlaygroundService.getRequiredDevicesForPart(lab as any, part as any);

                return {
                    success: true,
                    devices,
                    totalDevices: devices.length,
                };
            } catch (error) {
                set.status = 500;
                return {
                    success: false,
                    error: `Failed to get devices: ${(error as Error).message}`
                };
            }
        },
        {
            params: t.Object({
                labId: t.String(),
                partId: t.String(),
            }),
            detail: {
                tags: ["Playground"],
                summary: "Get Required Devices for Part",
                description: "Get list of devices required for a lab part to configure mappings",
            },
        }
    )

    /**
     * Start playground grading
     * Creates ephemeral job with custom network data
     */
    .post(
        "/grade",
        async ({ body, set, authPlugin: auth }) => {
            const userId = auth?.u_id || 'unknown';

            try {
                // Fetch lab and part
                const lab = await LabService.getLabById(body.labId);
                if (!lab) {
                    set.status = 404;
                    return { success: false, error: "Lab not found" };
                }

                const partsResponse = await PartService.getPartsByLab(body.labId);
                const part = partsResponse.parts.find(p => p.partId === body.partId);
                if (!part) {
                    set.status = 404;
                    return { success: false, error: "Part not found" };
                }

                // Generate playground job with custom data
                const jobPayload = await PlaygroundService.generatePlaygroundJob(
                    lab as any,
                    part as any,
                    userId,
                    {
                        gns3Config: body.gns3Config,
                        deviceMappings: body.deviceMappings,
                        customIpMappings: body.customIpMappings || {},
                        customVlanMappings: body.customVlanMappings || {},
                    }
                );

                // Submit to queue (ephemeral, not saved to DB)
                const result = await PlaygroundService.submitPlaygroundJob(jobPayload);

                if (!result.success) {
                    set.status = 503;
                    return { success: false, error: result.error };
                }

                return {
                    success: true,
                    jobId: result.jobId,
                    message: "Playground grading job submitted",
                    jobPayload, // Return for debugging/display
                };
            } catch (error) {
                set.status = 500;
                return {
                    success: false,
                    error: `Failed to start grading: ${(error as Error).message}`
                };
            }
        },
        {
            body: t.Object({
                labId: t.String(),
                partId: t.String(),
                gns3Config: t.Object({
                    serverIp: t.String(),
                    serverPort: t.Number(),
                    projectId: t.String(),
                    requiresAuth: t.Optional(t.Boolean()),
                    username: t.Optional(t.String()),
                    password: t.Optional(t.String()),
                }),
                deviceMappings: t.Array(t.Object({
                    deviceId: t.String(),
                    gns3NodeName: t.String(),
                    ipAddress: t.Optional(t.String()), // Optional since IPs are now in customIpMappings per-interface
                })),
                customIpMappings: t.Optional(t.Record(t.String(), t.String())),
                customVlanMappings: t.Optional(t.Record(t.String(), t.Number())),
            }),
            detail: {
                tags: ["Playground"],
                summary: "Start Playground Grading",
                description: "Submit a playground grading job with custom network configuration",
            },
        }
    )

    /**
   * Get SSE stream endpoint info for playground grading
   * Clients should use the main SSE endpoint with their jobId
   */
    .get(
        "/results/:jobId/info",
        async ({ params }) => {
            return {
                jobId: params.jobId,
                sseEndpoint: `/v0/submissions/events?jobId=${params.jobId}`,
                message: 'Connect to the SSE endpoint to receive grading updates',
            };
        },
        {
            params: t.Object({
                jobId: t.String(),
            }),
            detail: {
                tags: ["Playground"],
                summary: "Get Playground Results Info",
                description: "Get SSE endpoint info for streaming playground grading results",
            },
        }
    );

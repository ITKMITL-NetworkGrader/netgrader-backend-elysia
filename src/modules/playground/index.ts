import { Elysia, t } from "elysia";
import crypto from "crypto";
import { PlaygroundService } from "./service";
import { LabService } from "../labs/service";
import { PartService } from "../parts/service";
import { authPlugin } from "../../plugins/plugins";
import { sseService } from "../../services/sse-emitter";
import { env } from "process";

// Worker callback authentication for playground
const WORKER_SECRET = env.WORKER_CALLBACK_SECRET || "secret";
if (!WORKER_SECRET) {
    console.error("FATAL: WORKER_CALLBACK_SECRET not set (playground)");
    process.exit(1);
}

function verifyPlaygroundWorkerSecret(request: Request, set: any): boolean {
    const secret = request.headers.get("x-worker-secret");
    if (!secret || secret.length !== WORKER_SECRET.length) {
        set.status = 403;
        return false;
    }
    const isValid = crypto.timingSafeEqual(
        Buffer.from(secret),
        Buffer.from(WORKER_SECRET)
    );
    if (!isValid) {
        set.status = 403;
        return false;
    }
    return true;
}

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
                console.error("Failed to get devices:", error);
                set.status = 500;
                return {
                    success: false,
                    error: "Failed to get devices"
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
                console.error("Failed to get devices for part:", error);
                set.status = 500;
                return {
                    success: false,
                    error: "Failed to get devices"
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
                    console.error("Playground job submission failed:", result.error);
                    set.status = 503;
                    return { success: false, error: "Failed to submit grading job" };
                }

                // R4-6: Strip jobPayload from response to avoid leaking GNS3 credentials
                return {
                    success: true,
                    jobId: result.jobId,
                    message: "Playground grading job submitted",
                };
            } catch (error) {
                console.error("Failed to start playground grading:", error);
                set.status = 500;
                return {
                    success: false,
                    error: "Failed to start grading"
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
     * SSE Stream for Playground Grading
     * Does NOT require database record - purely in-memory
     */
    .get(
        "/:jobId/stream",
        async ({ params }) => {
            const { jobId } = params;

            console.log(`[Playground SSE] Setting up stream for job ${jobId}`);

            // Create a readable stream for SSE
            const stream = new ReadableStream({
                start(controller) {
                    // Register this client with the SSE service
                    sseService.addClient(jobId, controller);

                    console.log(`[Playground SSE] Client connected to job ${jobId}`);

                    // Send initial connection message
                    const initialMessage = `event: connected\ndata: ${JSON.stringify({
                        jobId,
                        status: 'pending',
                        message: 'Connected to playground grading updates'
                    })}\n\n`;
                    controller.enqueue(new TextEncoder().encode(initialMessage));

                    // Send keepalive every 30 seconds to prevent timeout
                    const keepaliveInterval = setInterval(() => {
                        try {
                            controller.enqueue(new TextEncoder().encode(': keepalive\n\n'));
                        } catch (error) {
                            clearInterval(keepaliveInterval);
                        }
                    }, 30000);
                },
                cancel() {
                    // Client disconnected
                    console.log(`[Playground SSE] Client disconnected from job ${jobId}`);
                }
            });

            // Return Response with proper headers
            return new Response(stream, {
                status: 200,
                headers: {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache, no-transform',
                    'Connection': 'keep-alive',
                    'X-Accel-Buffering': 'no',
                    'Transfer-Encoding': 'chunked'
                }
            });
        },
        {
            params: t.Object({
                jobId: t.String()
            }),
            detail: {
                tags: ["Playground"],
                summary: "Stream Playground Grading Progress (SSE)",
                description: "Real-time Server-Sent Events stream for playground grading progress. Does not require database record.",
            },
        }
    )

    /**
     * Playground Job Started Callback
     * Called by Python grader when a playground job starts
     * Does NOT touch database - directly emits SSE event
     */
    .post(
        "/started",
        async ({ body, request, set }) => {
            if (!verifyPlaygroundWorkerSecret(request, set)) {
                return { error: "Forbidden" };
            }
            const jobId = body.job_id;
            console.log(`[Playground] Job Started: ${jobId}`);

            // Emit SSE started event directly (no database)
            sseService.sendStarted(jobId);

            return { status: "received", message: "Playground job started notification received" };
        },
        {
            body: t.Object({
                job_id: t.String(),
                status: t.Optional(t.String()),
                message: t.Optional(t.String())
            }),
            detail: {
                tags: ["Playground"],
                summary: "Playground Job Started Callback",
                description: "Receive notification when a playground grading job starts. Does not store to database.",
            },
        }
    )

    /**
     * Playground Progress Callback
     * Called by Python grader during playground grading
     * Does NOT touch database - directly emits SSE event
     */
    .post(
        "/progress",
        async ({ body, request, set }) => {
            if (!verifyPlaygroundWorkerSecret(request, set)) {
                return { error: "Forbidden" };
            }
            const jobId = body.job_id;

            console.log(`[Playground] Progress for job ${jobId}: ${body.percentage || 0}% - ${body.message || ""}`);

            // Emit SSE progress event directly (no database)
            sseService.sendProgress(jobId, {
                message: body.message || "",
                current_test: body.current_test,
                tests_completed: body.tests_completed || 0,
                total_tests: body.total_tests || 0,
                percentage: body.percentage || 0
            });

            return {
                status: "success",
                message: `Progress updated for playground job ${jobId}`,
                progress: body.percentage || 0,
            };
        },
        {
            body: t.Object({
                job_id: t.String(),
                status: t.Optional(t.String()),
                message: t.Optional(t.String()),
                current_test: t.Optional(t.String()),
                tests_completed: t.Optional(t.Number()),
                total_tests: t.Optional(t.Number()),
                percentage: t.Optional(t.Number()),
            }),
            detail: {
                tags: ["Playground"],
                summary: "Playground Progress Callback",
                description: "Receive progress updates for a playground grading job. Does not store to database.",
            },
        }
    )

    /**
     * Playground Result Callback
     * Called by Python grader when playground grading completes
     * Does NOT touch database - directly emits SSE event
     */
    .post(
        "/result",
        async ({ body, request, set }) => {
            if (!verifyPlaygroundWorkerSecret(request, set)) {
                return { error: "Forbidden" };
            }
            const jobId = body.job_id;

            console.log(`[Playground] Final Result for job ${jobId}: Status - ${body.status}, Points Earned - ${body.total_points_earned}/${body.total_points_possible}`);

            if (Array.isArray(body.test_results)) {
                for (const test_result of body.test_results) {
                    const status_emoji = test_result.status === "passed" ? "✅" : "❌";
                    console.log(
                        `   ${status_emoji} ${test_result.test_name}: ${test_result.message} (${test_result.points_earned}/${test_result.points_possible} pts)`
                    );
                }
            }

            // Emit SSE completion event directly (no database)
            sseService.sendResult(jobId, {
                status: body.status,
                total_points_earned: body.total_points_earned,
                total_points_possible: body.total_points_possible,
                test_results: body.test_results
            });

            return {
                status: "received",
                message: "Playground grading result received",
            };
        },
        {
            body: t.Object({
                job_id: t.String(),
                status: t.Union([t.Literal("running"), t.Literal("completed"), t.Literal("failed"), t.Literal("cancelled")]),
                total_points_earned: t.Number(),
                total_points_possible: t.Number(),
                test_results: t.Array(
                    t.Object({
                        test_name: t.String(),
                        status: t.Union([t.Literal("passed"), t.Literal("failed"), t.Literal("error")]),
                        message: t.String(),
                        points_earned: t.Number(),
                        points_possible: t.Number(),
                        execution_time: t.Number(),
                        test_case_results: t.Array(t.Any()),
                        extracted_data: t.Optional(t.Record(t.String(), t.Any())),
                        raw_output: t.Optional(t.String()),
                        debug_info: t.Union([t.Any(), t.Null()]),
                        group_id: t.Union([t.String(), t.Null()])
                    })
                ),
                group_results: t.Array(t.Any()),
                total_execution_time: t.Number(),
                error_message: t.String(),
                created_at: t.String(),
                completed_at: t.Optional(t.String()),
                cancelled_reason: t.Union([t.String(), t.Null()])
            }),
            detail: {
                tags: ["Playground"],
                summary: "Playground Result Callback",
                description: "Receive the final result of a playground grading job. Does not store to database.",
            },
        }
    )

    /**
     * Get SSE stream endpoint info for playground grading (legacy)
     */
    .get(
        "/results/:jobId/info",
        async ({ params }) => {
            return {
                jobId: params.jobId,
                sseEndpoint: `/v0/playground/${params.jobId}/stream`,
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

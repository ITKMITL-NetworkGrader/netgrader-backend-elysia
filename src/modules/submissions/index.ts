import { Elysia, t } from "elysia";
import { channel, QUEUE_NAME } from "../../config/rabbitmq";
import { SubmissionService } from "./service";
import { IGradingResult } from "./model";
import { IPGenerator } from "./ip-generator";
import { LabService } from "../labs/service";
import { PartService } from "../parts/service";
import { env } from "process";
import { authPlugin } from "../../plugins/plugins";

export const submissionRoutes = new Elysia({ prefix: "/submissions" })
  .use(authPlugin)
  .post(
    "/",
    async ({ body, set, authPlugin }) => {
      const { u_id } = authPlugin ?? { u_id: "" };
      if (!channel) {
        set.status = 503;
        return {
          status: "error",
          message: "Service unavailable, RabbitMQ channel not initialized.",
        };
      }

      try {
        // Fetch lab data
        const lab = await LabService.getLabById(body.lab_id);
        if (!lab) {
          set.status = 404;
          return {
            status: "error",
            message: `Lab not found with ID: ${body.lab_id}`
          };
        }

        // Find the specific part
        const parts = await PartService.getPartsByLab(body.lab_id);
        const part = parts.parts.find(p => p.partId === body.part_id);
        if (!part) {
          set.status = 404;
          return {
            status: "error",
            message: `Part not found with ID: ${body.part_id} in lab ${body.lab_id}`
          };
        }
        const callback_url = env.CALLBACK_URL || "http://localhost:4000/v0/submissions";
        // Generate job ID if not provided
        const jobId = body.job_id || `${u_id}-${body.lab_id}-${body.part_id}-${Date.now()}`;

        // Generate complete job payload from lab and part data
        const jobPayload = await IPGenerator.generateJobFromLab(
          lab as any, // Cast to ILab type (services return transformed data)
          part as any, // Cast to ILabPart type
          u_id,
          jobId,
          callback_url
        );
        console.log("Generated Job Payload:", JSON.stringify(jobPayload, null, 2));
        // Create submission record
        const submission = await SubmissionService.createSubmission({
          jobId: jobPayload.job_id,
          studentId: u_id,
          labId: body.lab_id,
          partId: body.part_id,
          ipMappings: jobPayload.ip_mappings,
          callbackUrl: callback_url
        });

        // Send job to queue
        channel.sendToQueue(QUEUE_NAME, Buffer.from(JSON.stringify(jobPayload)), {
          persistent: true,
        });

        return { 
          status: "success", 
          message: "Job submitted to queue",
          submission_id: submission._id,
          job_id: jobPayload.job_id,
          generated_devices: jobPayload.devices.length,
          ip_mappings: Object.keys(jobPayload.ip_mappings).length,
          job_payload: jobPayload
        };
      } catch (error) {
        console.error("Error generating submission:", error);
        set.status = 500;
        return {
          status: "error",
          message: `Failed to generate submission: ${(error as Error).message}`
        };
      }
    },
    {
      body: t.Object({
        lab_id: t.String(),
        part_id: t.String(),
        job_id: t.Optional(t.String()),
      }),
      detail: {
        tags: ["Grading"],
        summary: "Generate and Submit Grading Job",
        description: "Generate a grading job from lab and part configuration, then submit to queue."
      }
    }
  )
  .post(
    "/started",
    async ({ body, set }) => {
      try {
        const jobId = body.job_id;
        if (!jobId) {
          set.status = 400;
          return { status: "error", message: "Missing job_id" };
        }

        const submission = await SubmissionService.markJobStarted(jobId);
        if (!submission) {
          set.status = 404;
          return { status: "error", message: "Submission not found" };
        }

        console.log(`Job Started: ${jobId}`);
        return { status: "received", message: "Job started successfully" };
      } catch (error) {
        console.error("Error updating job start status:", error);
        set.status = 500;
        return { status: "error", message: "Failed to update job status" };
      }
    },
    {
      body: t.Object({
        job_id: t.String(),
        status: t.Optional(t.String()),
        message: t.Optional(t.String())
      }),
      detail: {
        tags: ["Grading"],
        summary: "Job Started",
        description: "Receive notification when a grading job starts.",
      },
    }
  )
  .post(
    "/progress",
    async ({ body, set }) => {
      try {
        const jobId = body.job_id;
        if (!jobId) {
          set.status = 400;
          return { status: "error", message: "Missing job_id" };
        }

        const submission = await SubmissionService.updateProgress(jobId, {
          message: body.message || "",
          current_test: body.current_test,
          tests_completed: body.tests_completed || 0,
          total_tests: body.total_tests || 0,
          percentage: body.percentage || 0
        });

        if (!submission) {
          set.status = 404;
          return { status: "error", message: "Submission not found" };
        }

        console.log(`Progress for job ${jobId}: ${body.percentage || 0}% - ${body.message || ""}`);
        return {
          status: "success",
          message: `Progress updated for job ${jobId}`,
          progress: body.percentage || 0,
          current_test: body.current_test || "",
        };
      } catch (error) {
        console.error("Error updating progress:", error);
        set.status = 500;
        return { status: "error", message: "Failed to update progress" };
      }
    },
    {
      body: t.Object({
        job_id: t.Optional(t.String()),
        status: t.Optional(t.String()),
        message: t.Optional(t.String()),
        current_test: t.Optional(t.String()),
        tests_completed: t.Optional(t.Number()),
        total_tests: t.Optional(t.Number()),
        percentage: t.Optional(t.Number()),
      }),
      detail: {
        tags: ["Grading"],
        summary: "Job Progress",
        description: "Receive progress updates for a grading job.",
      },
    }
  )
  .post(
    "/result",
    async ({ body, set }) => {
      try {
        const jobId = body.job_id;
        if (!jobId) {
          set.status = 400;
          return { status: "error", message: "Missing job_id" };
        }

        const submission = await SubmissionService.storeGradingResult(jobId, body as IGradingResult);
        if (!submission) {
          set.status = 404;
          return { status: "error", message: "Submission not found" };
        }

        console.log(`Final Result for job ${jobId}: Status - ${body.status}, Points Earned - ${body.total_points_earned}/${body.total_points_possible}`);
        
        if (Array.isArray(body.test_results)) {
          for (const test_result of body.test_results) {
            const status_emoji = test_result.status === "passed" ? "✅" : "❌";
            console.log(
              `   ${status_emoji} ${test_result.test_name}: ${test_result.message} (${test_result.points_earned}/${test_result.points_possible} pts)`
            );
          }
        }

        return { 
          status: "received", 
          message: "Grading result stored successfully",
          submission_id: submission._id
        };
      } catch (error) {
        console.error("Error storing grading result:", error);
        set.status = 500;
        return { status: "error", message: "Failed to store grading result" };
      }
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
        tags: ["Grading"],
        summary: "Job Result",
        description: "Receive the final result of a grading job.",
      },
    }
  )
  .get(
    "/:jobId",
    async ({ params, set }) => {
      try {
        const submission = await SubmissionService.getSubmissionByJobId(params.jobId);
        if (!submission) {
          set.status = 404;
          return { status: "error", message: "Submission not found" };
        }
        return { status: "success", data: submission };
      } catch (error) {
        console.error("Error fetching submission:", error);
        set.status = 500;
        return { status: "error", message: "Failed to fetch submission" };
      }
    },
    {
      params: t.Object({
        jobId: t.String()
      }),
      detail: {
        tags: ["Submissions"],
        summary: "Get Submission",
        description: "Get submission details by job ID."
      }
    }
  )
  .get(
    "/student/:studentId",
    async ({ params, query, set }) => {
      try {
        const submissions = await SubmissionService.getSubmissionsByStudent(
          params.studentId,
          {
            labId: query.labId,
            status: query.status,
            limit: query.limit ? parseInt(query.limit) : undefined,
            offset: query.offset ? parseInt(query.offset) : undefined
          }
        );
        return { status: "success", data: submissions };
      } catch (error) {
        console.error("Error fetching student submissions:", error);
        set.status = 500;
        return { status: "error", message: "Failed to fetch submissions" };
      }
    },
    {
      params: t.Object({
        studentId: t.String()
      }),
      query: t.Object({
        labId: t.Optional(t.String()),
        status: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String())
      }),
      detail: {
        tags: ["Submissions"],
        summary: "Get Student Submissions",
        description: "Get submissions for a specific student."
      }
    }
  );

import { Elysia, t } from "elysia";
import { channel, QUEUE_NAME } from "../../config/rabbitmq";
import { SubmissionService } from "./service";
import { IGradingResult } from "./model";
import { IPGenerator, type LecturerRangeOverridePayload } from "./ip-generator";
import { LabService } from "../labs/service";
import { PartService } from "../parts/service";
import { GNS3v3Service, type GNS3Node } from "../gns3-student-lab/service";
import { User } from "../auth/model";
import { env } from "process";
import { authPlugin } from "../../plugins/plugins";
import { sseService } from "../../services/sse-emitter";

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

        // Check if lab is still accepting submissions
        const now = new Date();
        if (lab.availableUntil && now > new Date(lab.availableUntil)) {
          set.status = 403;
          return {
            status: "error",
            message: "Lab is no longer accepting submissions",
            availableUntil: lab.availableUntil
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

        // Prerequisite validation: Check if all prerequisite parts are completed
        if (part.prerequisites && part.prerequisites.length > 0) {
          for (const prereqPartId of part.prerequisites) {
            const prereqSubmission = await SubmissionService.getLatestSubmission(u_id, body.lab_id, prereqPartId);
            const isCompleted = prereqSubmission &&
              prereqSubmission.status === 'completed' &&
              prereqSubmission.gradingResult?.total_points_earned === prereqSubmission.gradingResult?.total_points_possible;

            if (!isCompleted) {
              const prereqPart = parts.parts.find(p => p.partId === prereqPartId);
              set.status = 403;
              return {
                status: "error",
                message: `You must complete "${prereqPart?.title || prereqPartId}" before attempting this part`,
                prerequisitePartId: prereqPartId
              };
            }
          }
        }

        // Rate limiting: Check if student submitted recently for this part
        const latestSubmission = await SubmissionService.getLatestSubmission(u_id, body.lab_id, body.part_id);
        if (latestSubmission && latestSubmission.submittedAt) {
          const cooldownMs = part.partType === 'fill_in_blank' ? 10000 : 30000; // 10s for IP Table, 30s for network config
          const timeSinceLastSubmission = Date.now() - new Date(latestSubmission.submittedAt).getTime();
          if (timeSinceLastSubmission < cooldownMs) {
            const waitSeconds = Math.ceil((cooldownMs - timeSinceLastSubmission) / 1000);
            set.status = 429;
            return {
              status: "error",
              message: `Please wait ${waitSeconds} seconds before submitting again`,
              retryAfterMs: cooldownMs - timeSinceLastSubmission
            };
          }
        }
        // Generate job ID if not provided
        const jobId = body.job_id || `${u_id}-${body.lab_id}-${body.part_id}-${Date.now()}`;

        const partsMap = new Map<string, any>();
        parts.parts.forEach(existingPart => {
          partsMap.set(existingPart.partId, existingPart);
        });

        const rawOverrides = Array.isArray(body.lecturer_range_answers)
          ? body.lecturer_range_answers
          : [];

        let lecturerRangeOverrides: LecturerRangeOverridePayload[] = [];

        if (rawOverrides.length > 0) {
          const overrideMap = new Map<string, LecturerRangeOverridePayload>();

          const isValidIpv4 = (ip: string): boolean => {
            const segments = ip.split('.');
            if (segments.length !== 4) return false;

            return segments.every(segment => {
              if (!/^\d+$/.test(segment)) return false;
              const value = Number(segment);
              return value >= 0 && value <= 255;
            });
          };

          const ipv4ToNumber = (ip: string): number | null => {
            const octets = ip.split('.').map(part => Number(part));
            if (octets.length !== 4) return null;
            if (octets.some(octet => Number.isNaN(octet) || octet < 0 || octet > 255)) {
              return null;
            }
            return ((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3];
          };

          const getVlanSubnetContext = (vlanIndex?: number | null) => {
            if (typeof vlanIndex !== 'number' || vlanIndex < 0) {
              return null;
            }

            const vlanConfig = lab.network?.vlanConfiguration;
            const vlan = vlanConfig?.vlans?.[vlanIndex];
            if (!vlan) return null;

            const baseNetwork = vlan.baseNetwork || lab.network?.topology?.baseNetwork;
            const subnetMask = typeof vlan.subnetMask === 'number'
              ? vlan.subnetMask
              : lab.network?.topology?.subnetMask;
            if (!baseNetwork || typeof subnetMask !== 'number') {
              return null;
            }

            const baseNumber = ipv4ToNumber(baseNetwork);
            if (baseNumber === null) return null;

            const blockSize = Math.pow(2, 32 - subnetMask);
            const rawSubnetIndex = typeof vlan.subnetIndex === 'number'
              ? vlan.subnetIndex
              : vlanIndex + 1; // Ensure 1-based index like advanced student IP calc

            const subnetIndex = rawSubnetIndex > 0 ? rawSubnetIndex : 1;
            const networkNumber = baseNumber + (subnetIndex - 1) * blockSize;

            return {
              networkNumber,
              blockSize
            };
          };

          const isWithinRange = (
            ip: string,
            start: number,
            end: number,
            vlanIndex?: number | null
          ): boolean => {
            const ipNumber = ipv4ToNumber(ip);
            if (ipNumber === null) return false;

            const context = getVlanSubnetContext(vlanIndex);
            if (context) {
              const offset = ipNumber - context.networkNumber;

              // Usable host addresses exclude network (offset 0) and broadcast (offset blockSize - 1)
              if (offset <= 0 || offset >= context.blockSize - 1) {
                return false;
              }

              return offset >= start && offset <= end;
            }

            // Fallback to last octet comparison if we cannot resolve subnet context
            const lastOctet = ipNumber & 255;
            return lastOctet >= start && lastOctet <= end;
          };

          rawOverrides.forEach((override) => {
            const {
              source_part_id,
              question_id,
              row_index,
              col_index,
              answer,
              device_id,
              interface_name,
              vlan_index
            } = override;

            if (!source_part_id || !question_id) {
              return;
            }

            const sourcePart = partsMap.get(source_part_id);
            if (!sourcePart || sourcePart.partType !== 'fill_in_blank') {
              return;
            }

            const question = sourcePart.questions?.find((q: any) => q.questionId === question_id);
            if (!question?.ipTableQuestionnaire?.cells) {
              return;
            }

            const row = question.ipTableQuestionnaire.cells[row_index];
            const cell = row?.[col_index];

            if (!cell || (cell.cellType ?? 'input') !== 'input') {
              return;
            }

            if (cell.answerType !== 'calculated' || !cell.calculatedAnswer) {
              return;
            }

            const calcType = cell.calculatedAnswer.calculationType;
            // Accept both DHCP (vlan_lecturer_range) and IPv6 SLAAC (ipv6_slaac) student-updatable cells
            if (calcType !== 'vlan_lecturer_range' && calcType !== 'ipv6_slaac') {
              return;
            }

            // For lecturer range, validate the range values exist
            // For SLAAC, we skip range validation (any valid IPv6 in the prefix is accepted)
            const isSlaac = calcType === 'ipv6_slaac';
            const { lecturerRangeStart, lecturerRangeEnd } = cell.calculatedAnswer;
            if (!isSlaac && (lecturerRangeStart === undefined || lecturerRangeEnd === undefined)) {
              return;
            }

            const trimmedAnswer = typeof answer === 'string' ? answer.trim() : '';
            const effectiveVlanIndex = cell.calculatedAnswer.vlanIndex ?? vlan_index ?? null;

            if (!trimmedAnswer || !isValidIpv4(trimmedAnswer)) {
              console.warn('[Submission] Skipping lecturer-defined override due to invalid IP value', {
                source_part_id,
                question_id,
                row_index,
                col_index,
                answer: trimmedAnswer
              });
              return;
            }

            // Range check left intact in case we want to surface diagnostics later,
            // but we no longer warn if the value lands outside the configured offset.
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const withinRange = isWithinRange(trimmedAnswer, lecturerRangeStart, lecturerRangeEnd, effectiveVlanIndex);

            const resolvedDeviceId = cell.calculatedAnswer.deviceId || device_id;
            const resolvedInterfaceName = cell.calculatedAnswer.interfaceName || interface_name;

            if (!resolvedDeviceId || !resolvedInterfaceName) {
              console.warn('[Submission] Missing device/interface mapping for lecturer-defined override', {
                source_part_id,
                question_id,
                row_index,
                col_index
              });
              return;
            }

            const key = `${resolvedDeviceId}.${resolvedInterfaceName}`;

            overrideMap.set(key, {
              key,
              ip: trimmedAnswer,
              metadata: {
                sourcePartId: source_part_id,
                questionId: question_id,
                rowIndex: row_index,
                colIndex: col_index,
                lecturerRangeStart,
                lecturerRangeEnd,
                deviceId: resolvedDeviceId,
                interfaceName: resolvedInterfaceName,
                vlanIndex: effectiveVlanIndex
              }
            });
          });

          lecturerRangeOverrides = Array.from(overrideMap.values());
        }

        // Process IPv6 SLAAC answers separately (from slaac_answers payload)
        const rawSlaacAnswers = Array.isArray(body.slaac_answers)
          ? body.slaac_answers
          : [];

        if (rawSlaacAnswers.length > 0) {
          const slaacOverrideMap = new Map<string, LecturerRangeOverridePayload>();

          // Simple IPv6 validation - checks for valid format
          const isValidIpv6 = (ip: string): boolean => {
            // Allow compressed IPv6 addresses (e.g., 2001:db8::1)
            const ipv6Pattern = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$|^([0-9a-fA-F]{0,4}:){1,7}:$|^:(:([0-9a-fA-F]{0,4})){1,7}$|^::$/;
            return ipv6Pattern.test(ip);
          };

          rawSlaacAnswers.forEach((override) => {
            const {
              source_part_id,
              question_id,
              row_index,
              col_index,
              answer,
              device_id,
              interface_name,
              vlan_index
            } = override;

            if (!source_part_id || !question_id) {
              return;
            }

            const sourcePart = partsMap.get(source_part_id);
            if (!sourcePart || sourcePart.partType !== 'fill_in_blank') {
              return;
            }

            const question = sourcePart.questions?.find((q: any) => q.questionId === question_id);
            if (!question?.ipTableQuestionnaire?.cells) {
              return;
            }

            const row = question.ipTableQuestionnaire.cells[row_index];
            const cell = row?.[col_index];

            if (!cell || (cell.cellType ?? 'input') !== 'input') {
              return;
            }

            if (cell.answerType !== 'calculated' || !cell.calculatedAnswer) {
              return;
            }

            // Only process ipv6_slaac cells
            if (cell.calculatedAnswer.calculationType !== 'ipv6_slaac') {
              return;
            }

            const trimmedAnswer = typeof answer === 'string' ? answer.trim() : '';
            const effectiveVlanIndex = cell.calculatedAnswer.vlanIndex ?? vlan_index ?? null;

            if (!trimmedAnswer || !isValidIpv6(trimmedAnswer)) {
              console.warn('[Submission] Skipping SLAAC override due to invalid IPv6 value', {
                source_part_id,
                question_id,
                row_index,
                col_index,
                answer: trimmedAnswer
              });
              return;
            }

            const resolvedDeviceId = cell.calculatedAnswer.deviceId || device_id;
            const resolvedInterfaceName = cell.calculatedAnswer.interfaceName || interface_name;

            if (!resolvedDeviceId || !resolvedInterfaceName) {
              console.warn('[Submission] Missing device/interface mapping for SLAAC override', {
                source_part_id,
                question_id,
                row_index,
                col_index
              });
              return;
            }

            const key = `${resolvedDeviceId}.${resolvedInterfaceName}`;

            slaacOverrideMap.set(key, {
              key,
              ip: trimmedAnswer,
              metadata: {
                sourcePartId: source_part_id,
                questionId: question_id,
                rowIndex: row_index,
                colIndex: col_index,
                lecturerRangeStart: 0,
                lecturerRangeEnd: 0,
                deviceId: resolvedDeviceId,
                interfaceName: resolvedInterfaceName,
                vlanIndex: effectiveVlanIndex
              }
            });
          });

          // Merge SLAAC overrides into lecturerRangeOverrides
          const slaacOverrides = Array.from(slaacOverrideMap.values());
          lecturerRangeOverrides = [...lecturerRangeOverrides, ...slaacOverrides];
        }

        // Fetch GNS3 nodes to map console/aux ports
        let gns3Nodes: GNS3Node[] | undefined;
        let gns3ServerIp: string | undefined;
        if (body.project_id) {
          // Get user's assigned GNS3 server
          const user = await User.findOne({ u_id: u_id.toLowerCase() });
          const serverIndex = user?.gns3ServerIndex ?? GNS3v3Service.calculateInitialServerIndex(u_id);
          const serverConfig = GNS3v3Service.getServerConfig(serverIndex);
          gns3ServerIp = serverConfig.serverIp;

          console.log(`[GNS3] User ${u_id} assigned to server ${serverIndex} (${gns3ServerIp})`);

          const loginResult = await GNS3v3Service.login(serverConfig, serverConfig.adminUsername, serverConfig.adminPassword);
          if (loginResult.success && loginResult.accessToken) {
            const nodesResult = await GNS3v3Service.getProjectNodes(loginResult.accessToken, body.project_id, serverConfig);
            if (nodesResult.success && nodesResult.nodes) {
              gns3Nodes = nodesResult.nodes;
              console.log(`[GNS3] Fetched ${gns3Nodes.length} nodes from project ${body.project_id} on server ${serverIndex}`);
            } else {
              console.warn(`[GNS3] Failed to fetch nodes: ${nodesResult.error}`);
            }
          } else {
            console.warn(`[GNS3] Failed to login to server ${serverIndex}: ${loginResult.error}`);
          }
        }

        // Generate complete job payload from lab and part data
        const jobPayload = await IPGenerator.generateJobFromLab(
          lab as any, // Cast to ILab type (services return transformed data)
          part as any, // Cast to ILabPart type
          u_id,
          jobId,
          {
            ...(lecturerRangeOverrides.length > 0 ? { lecturerRangeOverrides } : {}),
            ...(gns3Nodes ? { gns3Nodes } : {}),
            ...(gns3ServerIp ? { gns3ServerIp } : {})
          }
        );
        // Create submission record
        const submission = await SubmissionService.createSubmission({
          jobId: jobPayload.job_id,
          studentId: u_id,
          labId: body.lab_id,
          partId: body.part_id,
          ipMappings: jobPayload.ip_mappings,
          labSessionId: jobPayload.lab_session_id,
          labAttemptNumber: jobPayload.lab_attempt_number
        });

        // console.log('[Submission] Enqueuing job payload for RabbitMQ:', JSON.stringify(jobPayload, null, 2));

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
        project_id: t.String(),
        job_id: t.Optional(t.String()),
        lecturer_range_answers: t.Optional(t.Array(t.Object({
          source_part_id: t.String(),
          question_id: t.String(),
          row_index: t.Number(),
          col_index: t.Number(),
          answer: t.String(),
          device_id: t.Optional(t.String()),
          interface_name: t.Optional(t.String()),
          vlan_index: t.Optional(t.Number())
        }))),
        slaac_answers: t.Optional(t.Array(t.Object({
          source_part_id: t.String(),
          question_id: t.String(),
          row_index: t.Number(),
          col_index: t.Number(),
          answer: t.String(),
          device_id: t.Optional(t.String()),
          interface_name: t.Optional(t.String()),
          vlan_index: t.Optional(t.Number())
        })))
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

        // 🆕 Emit SSE started event to connected clients
        sseService.sendStarted(jobId);

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

        // 🆕 Emit SSE progress event to connected clients
        sseService.sendProgress(jobId, {
          message: body.message || "",
          current_test: body.current_test,
          tests_completed: body.tests_completed || 0,
          total_tests: body.total_tests || 0,
          percentage: body.percentage || 0
        });

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

        // 🆕 Emit SSE completion event to connected clients
        console.log(`[SSE] About to call sseService.sendResult() for job ${jobId}`);
        try {
          sseService.sendResult(jobId, {
            status: body.status,
            total_points_earned: body.total_points_earned,
            total_points_possible: body.total_points_possible,
            test_results: body.test_results
          });
          console.log(`[SSE] sseService.sendResult() completed for job ${jobId}`);
        } catch (sseError) {
          console.error(`[SSE] Error in sseService.sendResult() for job ${jobId}:`, sseError);
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
            offset: query.offset ? parseInt(query.offset) : undefined,
            labSessionId: query.labSessionId ?? undefined
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
        offset: t.Optional(t.String()),
        labSessionId: t.Optional(t.String())
      }),
      detail: {
        tags: ["Submissions"],
        summary: "Get Student Submissions",
        description: "Get submissions for a specific student."
      }
    }
  )
  .get(
    "/lab/:labId",
    async ({ params, query, set }) => {
      try {
        const overview = await SubmissionService.getLabSubmissionOverview(
          params.labId,
          {
            limit: query.limit ? parseInt(query.limit) : undefined,
            offset: query.offset ? parseInt(query.offset) : undefined
          }
        );
        return { status: "success", ...overview };
      } catch (error) {
        console.error("Error fetching lab submission overview:", error);
        set.status = 500;
        return { status: "error", message: "Failed to fetch submission overview" };
      }
    },
    {
      params: t.Object({
        labId: t.String()
      }),
      query: t.Object({
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String())
      }),
      detail: {
        tags: ["Submissions"],
        summary: "Get Lab Submission Overview",
        description: "Get student progression overview for a lab. Shows which part each student is on and their latest submission status. Lightweight for polling with pagination support."
      }
    }
  )
  .get(
    "/lab/:labId/part-summary",
    async ({ params, set }) => {
      try {
        const summary = await SubmissionService.getSubmissionSummaryByPart(params.labId);
        return { status: "success", data: summary };
      } catch (error) {
        console.error("Error fetching part submission summary:", error);
        set.status = 500;
        return { status: "error", message: "Failed to fetch part submission summary" };
      }
    },
    {
      params: t.Object({
        labId: t.String()
      }),
      detail: {
        tags: ["Submissions"],
        summary: "Get Part Submission Summary",
        description: "Aggregate submission counts per part for a lab. Used to warn when editing parts with existing submissions."
      }
    }
  )
  .get(
    "/history/lab/:labId/student/:studentId",
    async ({ params, query, set }) => {
      try {
        const history = await SubmissionService.getStudentSubmissionHistory(
          params.labId,
          params.studentId,
          {
            labSessionId: query.labSessionId ?? undefined,
            groupBy: query.groupBy === 'labSession' ? 'labSession' : 'part'
          }
        );
        return { status: "success", data: history };
      } catch (error) {
        console.error("Error fetching student submission history:", error);
        set.status = 500;
        return { status: "error", message: "Failed to fetch submission history" };
      }
    },
    {
      params: t.Object({
        labId: t.String(),
        studentId: t.String()
      }),
      query: t.Object({
        labSessionId: t.Optional(t.String()),
        groupBy: t.Optional(t.String())
      }),
      detail: {
        tags: ["Submissions"],
        summary: "Get Student Submission History",
        description: "Get submission history for a specific student in a lab, grouped by part or by lab attempt."
      }
    }
  )
  .get(
    "/detailed/:submissionId",
    async ({ params, set }) => {
      try {
        const submission = await SubmissionService.getSubmissionById(params.submissionId);
        if (!submission) {
          set.status = 404;
          return { status: "error", message: "Submission not found" };
        }
        return { status: "success", data: submission };
      } catch (error) {
        console.error("Error fetching submission details:", error);
        set.status = 500;
        return { status: "error", message: "Failed to fetch submission details" };
      }
    },
    {
      params: t.Object({
        submissionId: t.String()
      }),
      detail: {
        tags: ["Submissions"],
        summary: "Get Detailed Submission",
        description: "Get complete submission details including all grading results, test cases, and debug information by submission ID."
      }
    }
  )
  .get(
    "/:jobId/stream",
    async ({ params, request }) => {
      const { jobId } = params;

      // Verify submission exists
      const submission = await SubmissionService.getSubmissionByJobId(jobId);
      if (!submission) {
        return new Response(JSON.stringify({ status: "error", message: "Submission not found" }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Get origin for CORS
      const origin = request.headers.get('origin') || env.FRONTEND_ORIGIN || 'http://localhost:3000';

      console.log(`[SSE] Setting up stream for job ${jobId}`);

      // Create a readable stream
      const stream = new ReadableStream({
        start(controller) {
          // Register this client with the SSE service
          sseService.addClient(jobId, controller);

          console.log(`[SSE] Client connected to job ${jobId}`);

          // Send initial connection message
          const initialMessage = `event: connected\ndata: ${JSON.stringify({
            jobId,
            status: submission.status,
            message: 'Connected to grading updates'
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

          // If submission is already completed, send the result immediately
          if (submission.status === 'completed' && submission.gradingResult) {
            setTimeout(() => {
              clearInterval(keepaliveInterval);
              sseService.sendResult(jobId, {
                status: submission.gradingResult!.status,
                total_points_earned: submission.gradingResult!.total_points_earned,
                total_points_possible: submission.gradingResult!.total_points_possible,
                test_results: submission.gradingResult!.test_results
              });
            }, 100); // Small delay to ensure connection is established
          }
        },
        cancel() {
          // Client disconnected
          console.log(`[SSE] Client disconnected from job ${jobId}`);
        }
      });

      // Return Response with proper headers
      // NOTE: CORS headers are handled by Elysia's CORS middleware - do NOT add them manually here
      // as that would cause duplicate header values and fail CORS validation
      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          'X-Accel-Buffering': 'no'
        }
      });
    },
    {
      params: t.Object({
        jobId: t.String()
      }),
      detail: {
        tags: ["Submissions"],
        summary: "Stream Grading Progress (SSE)",
        description: "Real-time Server-Sent Events stream for grading progress updates. Connect to this endpoint to receive instant updates without polling."
      }
    }
  )
  .post(
    "/labs/:labId/ip-answers",
    async ({ params, body, set, authPlugin }) => {
      const { u_id } = authPlugin ?? { u_id: "" };
      try {
        const { labId } = params;
        const { partId, answers } = body;

        // Store or update IP answers for the student
        const result = await SubmissionService.storeIpAnswers(
          u_id,
          labId,
          partId,
          answers
        );

        return {
          status: "success",
          message: "IP answers saved successfully",
          data: result
        };
      } catch (error) {
        console.error("Error storing IP answers:", error);
        set.status = 500;
        return {
          status: "error",
          message: `Failed to store IP answers: ${(error as Error).message}`
        };
      }
    },
    {
      params: t.Object({
        labId: t.String()
      }),
      body: t.Object({
        partId: t.String(),
        answers: t.Record(t.String(), t.Array(t.Array(t.String())))
      }),
      detail: {
        tags: ["Submissions"],
        summary: "Store Student IP Answers",
        description: "Store student's IP table questionnaire answers for a specific lab part."
      }
    }
  )
  .get(
    "/labs/:labId/ip-answers",
    async ({ params, query, set, authPlugin }) => {
      const { u_id } = authPlugin ?? { u_id: "" };
      try {
        const { labId } = params;
        const { partId } = query;

        if (!partId) {
          set.status = 400;
          return {
            status: "error",
            message: "partId query parameter is required"
          };
        }

        // Retrieve IP answers for the student
        const answers = await SubmissionService.getIpAnswers(
          u_id,
          labId,
          partId
        );

        if (!answers) {
          set.status = 404;
          return {
            status: "error",
            message: "No IP answers found for this lab part"
          };
        }

        return {
          status: "success",
          data: answers
        };
      } catch (error) {
        console.error("Error retrieving IP answers:", error);
        set.status = 500;
        return {
          status: "error",
          message: `Failed to retrieve IP answers: ${(error as Error).message}`
        };
      }
    },
    {
      params: t.Object({
        labId: t.String()
      }),
      query: t.Object({
        partId: t.String()
      }),
      detail: {
        tags: ["Submissions"],
        summary: "Get Student IP Answers",
        description: "Retrieve student's IP table questionnaire answers for a specific lab part."
      }
    }
  )
  /**
   * Get all submission history for the authenticated user across all courses/labs
   * GET /submissions/history/user
   */
  .get(
    "/history/user",
    async ({ query, set, authPlugin }) => {
      try {
        if (!authPlugin) {
          set.status = 401;
          return { status: "error", message: "Unauthorized" };
        }

        const { u_id } = authPlugin;
        const result = await SubmissionService.getAllUserSubmissionHistory(
          u_id,
          {
            limit: query.limit ? parseInt(query.limit) : 20,
            offset: query.offset ? parseInt(query.offset) : 0
          }
        );

        return { status: "success", ...result };
      } catch (error) {
        console.error("Error fetching user submission history:", error);
        set.status = 500;
        return { status: "error", message: "Failed to fetch submission history" };
      }
    },
    {
      query: t.Object({
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String())
      }),
      detail: {
        tags: ["Submissions"],
        summary: "Get All User Submission History",
        description: "Get all submissions for the authenticated user across all courses and labs, sorted by date descending with pagination."
      }
    }
  );

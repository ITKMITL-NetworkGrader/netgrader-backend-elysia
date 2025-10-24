import { Elysia, t } from "elysia";
import { LabService } from "./service";
import { authPlugin, requireRole } from "../../plugins/plugins";
import { VlanValidator } from "../../utils/vlan-validator";
import { IPGenerator } from "../submissions/ip-generator";
import { StudentLabSession, StudentLabSessionService } from "../student-lab-sessions";
import { ILab } from "./model";
import { Types } from "mongoose";

// Updated schemas for the embedded network model with VLAN support
const LabBodySchema = t.Object({
  courseId: t.String(),
  title: t.String(),
  description: t.String({ default: "" }),
  type: t.Optional(t.Union([t.Literal("lab"), t.Literal("exam")])),
  instructions: t.Optional(t.Union([
    t.String(),
    t.Object({
      html: t.String(),
      json: t.Any()
    })
  ])),
  network: t.Object({
    name: t.String(),
    topology: t.Object({
      baseNetwork: t.String(),
      subnetMask: t.Number({ minimum: 8, maximum: 30 }),
      allocationStrategy: t.Union([t.Literal("student_id_based"), t.Literal("group_based")]),
      exemptIpRanges: t.Optional(t.Array(
        t.Object({
          start: t.String(),
          end: t.Optional(t.String())
        })
      ))
    }),
    vlanConfiguration: t.Optional(t.Object({
      mode: t.Union([t.Literal("fixed_vlan"), t.Literal("lecturer_group"), t.Literal("calculated_vlan")]),
      vlanCount: t.Number({ minimum: 1, maximum: 10 }),
      vlans: t.Array(t.Object({
        id: t.String(),
        vlanId: t.Optional(t.Number({ minimum: 1, maximum: 4094 })),
        calculationMultiplier: t.Optional(t.Number()),
        baseNetwork: t.String(),
        subnetMask: t.Number({ minimum: 8, maximum: 30 }),
        subnetIndex: t.Number({ minimum: 0, default: 1 }),
        groupModifier: t.Optional(t.Number()),
        isStudentGenerated: t.Boolean()
      }))
    })),
    devices: t.Array(t.Object({
      deviceId: t.String(),
      templateId: t.String(),
      displayName: t.String(),
      ipVariables: t.Array(t.Object({
        name: t.String(),
        interface: t.Optional(t.String()),
        inputType: t.Union([
          t.Literal("fullIP"),
          t.Literal("studentManagement"),
          t.Literal("studentVlan0"),
          t.Literal("studentVlan1"),
          t.Literal("studentVlan2"),
          t.Literal("studentVlan3"),
          t.Literal("studentVlan4"),
          t.Literal("studentVlan5"),
          t.Literal("studentVlan6"),
          t.Literal("studentVlan7"),
          t.Literal("studentVlan8"),
          t.Literal("studentVlan9")
        ]),
        fullIp: t.Optional(t.String()),
        isManagementInterface: t.Optional(t.Boolean()),
        isVlanInterface: t.Optional(t.Boolean()),
        vlanIndex: t.Optional(t.Number({ minimum: 0, maximum: 9 })),
        interfaceOffset: t.Optional(t.Number({ minimum: 1, maximum: 50 })),
        isStudentGenerated: t.Optional(t.Boolean()),
        description: t.Optional(t.String()),
        readonly: t.Optional(t.Boolean())
      })),
      credentials: t.Object({
        usernameTemplate: t.String(),
        passwordTemplate: t.String(),
        enablePassword: t.String({ default: "" })
      })
    }))
  }),
  publishedAt: t.Optional(t.Date()),
  availableFrom: t.Optional(t.Date()),
  availableUntil: t.Optional(t.Date()),
  dueDate: t.Optional(t.Date())
});

export const labRoutes = new Elysia({ prefix: "/labs" })
  .use(authPlugin)
  
  // Get all labs
  .get(
    "/",
    async ({ set, query }) => {
      try {
        const { courseId, createdBy, type, page = "1", limit = "10" } = query;
        const pageNum = parseInt(page as string);
        const limitNum = parseInt(limit as string);

        const result = await LabService.getLabs({
          courseId,
          createdBy,
          type,
          page: pageNum,
          limit: limitNum
        });

        set.status = 200;
        return {
          success: true,
          message: "Labs fetched successfully",
          data: result
        };
      } catch (error) {
        set.status = 500;
        return { 
          success: false, 
          message: "Error fetching labs",
          error: (error as Error).message 
        };
      }
    },
    {
      query: t.Object({
        courseId: t.Optional(t.String()),
        createdBy: t.Optional(t.String()),
        type: t.Optional(t.String()),
        page: t.Optional(t.String()),
        limit: t.Optional(t.String())
      }),
      detail: {
        tags: ["Labs"],
        summary: "Get All Labs"
      }
    }
  )

  // Create new lab
  .post(
    "/",
    async ({ body, set, authPlugin }) => {
      try {
        const { u_id } = authPlugin ?? { u_id: "" };

        // Validate exempt IP ranges if present
        if (body.network.topology.exemptIpRanges && body.network.topology.exemptIpRanges.length > 0) {
          const exemptValidation = VlanValidator.validateExemptRanges(
            body.network.topology.exemptIpRanges,
            body.network.topology.baseNetwork,
            body.network.topology.subnetMask
          );
          if (!exemptValidation.valid) {
            set.status = 400;
            return {
              success: false,
              message: "Exempt IP ranges validation failed",
              errors: exemptValidation.errors
            };
          }
        }

        // Validate VLAN configuration if present
        if (body.network.vlanConfiguration) {
          const vlanValidation = VlanValidator.validateVlanConfiguration(body.network.vlanConfiguration);
          if (!vlanValidation.valid) {
            set.status = 400;
            return {
              success: false,
              message: "VLAN configuration validation failed",
              errors: vlanValidation.errors
            };
          }

          // Validate IP variables
          for (const device of body.network.devices) {
            for (const ipVar of device.ipVariables) {
              const ipVarValidation = VlanValidator.validateIPVariable(
                ipVar,
                body.network.vlanConfiguration
              );
              if (!ipVarValidation.valid) {
                set.status = 400;
                return {
                  success: false,
                  message: `IP variable validation failed for device '${device.deviceId}', variable '${ipVar.name}'`,
                  errors: ipVarValidation.errors
                };
              }
            }
          }

          // Check for duplicate IP configurations
          const duplicateCheck = VlanValidator.checkDuplicateIPs(body.network.devices);
          if (!duplicateCheck.valid) {
            set.status = 400;
            return {
              success: false,
              message: "Duplicate IP configuration detected",
              errors: duplicateCheck.errors
            };
          }
        }

        // Create lab first (need lab object for capacity check)
        const savedLab = await LabService.createLab(body, u_id);

        // Check IP capacity if exempt ranges are defined
        if (body.network.topology.exemptIpRanges && body.network.topology.exemptIpRanges.length > 0) {
          const { StudentLabSessionService } = await import('../student-lab-sessions/service');
          const capacity = await StudentLabSessionService.calculateIpCapacity(savedLab as any);

          if (!capacity.sufficient) {
            // Delete the created lab since capacity is insufficient
            const labIdToDelete = (savedLab as any)._id?.toString() || (savedLab as any).id?.toString();
            if (labIdToDelete) {
              await LabService.deleteLab(labIdToDelete);
            }

            set.status = 400;
            return {
              success: false,
              message: "Insufficient IP capacity for enrolled students",
              details: {
                totalIps: capacity.totalIps,
                exemptIps: capacity.exemptCount,
                availableIps: capacity.available,
                enrolledStudents: capacity.enrolledStudents,
                shortage: capacity.enrolledStudents - capacity.available
              },
              suggestion: `Reduce exempt ranges by ${capacity.enrolledStudents - capacity.available} IPs or expand the management network`
            };
          }
        }

        set.status = 201;
        return {
          success: true,
          message: "Lab created successfully",
          data: savedLab
        };
      } catch (error) {
        set.status = 400;
        return {
          success: false,
          message: "Error creating lab",
          error: (error as Error).message
        };
      }
    },
    {
      body: LabBodySchema,
      beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
      detail: {
        tags: ["Labs"],
        summary: "Create Lab"
      }
    }
  )

  // Get lab by ID
  .get(
    "/:id",
    async ({ params, set, authPlugin }) => {
      try {
        const lab = await LabService.getLabById(params.id);

        if (!lab) {
          set.status = 404;
          return {
            success: false,
            message: "Lab not found"
          };
        }

        let instructionsAcknowledged = false;

        if (authPlugin?.u_id) {
          try {
            const labObjectId = new Types.ObjectId(params.id);
            instructionsAcknowledged = await StudentLabSessionService.hasAcknowledgedInstructions(
              authPlugin.u_id,
              labObjectId
            );
          } catch (ackError) {
            console.warn('[Labs] Unable to determine instruction acknowledgement state:', ackError);
          }
        }

        set.status = 200;
        return {
          success: true,
          message: "Lab fetched successfully",
          data: {
            ...lab,
            instructionsAcknowledged
          }
        };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          message: "Error fetching lab",
          error: (error as Error).message
        };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ["Labs"],
        summary: "Get Lab by ID"
      }
    }
  )

  // Start lab - Generate network configuration for student
  .post(
    "/:id/start",
    async ({ params, set, authPlugin }) => {
      try {
        const { u_id } = authPlugin ?? { u_id: "" };

        if (!u_id) {
          set.status = 401;
          return {
            success: false,
            message: "Authentication required"
          };
        }

        // Fetch lab
        const lab = await LabService.getLabById(params.id);

        if (!lab) {
          set.status = 404;
          return {
            success: false,
            message: "Lab not found"
          };
        }

        // Check if lab is published
        // if (!lab.publishedAt) {
        //   set.status = 403;
        //   return {
        //     success: false,
        //     message: "Lab is not published yet"
        //   };
        // }

        // // Check if lab is available (within availableFrom and availableUntil window)
        // const now = new Date();
        // if (lab.availableFrom && now < lab.availableFrom) {
        //   set.status = 403;
        //   return {
        //     success: false,
        //     message: "Lab is not available yet",
        //     availableFrom: lab.availableFrom
        //   };
        // }

        // if (lab.availableUntil && now > lab.availableUntil) {
        //   set.status = 403;
        //   return {
        //     success: false,
        //     message: "Lab is no longer available",
        //     availableUntil: lab.availableUntil
        //   };
        // }

        // Generate complete network configuration
        const networkConfig = await IPGenerator.generateStudentNetworkConfiguration(lab, u_id);

        set.status = 200;
        return {
          success: true,
          message: "Lab started successfully",
          data: {
            labId: lab.id?.toString(),
            labTitle: lab.title,
            session: networkConfig.sessionInfo,
            networkConfiguration: {
              managementIp: networkConfig.managementIp,
              ipMappings: networkConfig.ipMappings,
              vlanMappings: networkConfig.vlanMappings
            }
          }
        };
      } catch (error) {
        console.error('[Lab Start Error]', error);
        set.status = 500;
        return {
          success: false,
          message: "Error starting lab",
          error: (error as Error).message
        };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      beforeHandle: requireRole(["STUDENT", "INSTRUCTOR", "ADMIN"]),
      detail: {
        tags: ["Labs"],
        summary: "Start Lab - Generate Network Configuration",
        description: "Creates/retrieves student lab session and generates all IP addresses (Management + VLAN) and VLAN IDs for the student to configure their devices"
      }
    }
  )
  // Acknowledge lab instructions (Part 0)
  .post(
    "/:id/instructions/acknowledge",
    async ({ params, set, authPlugin }) => {
      try {
        const { u_id } = authPlugin ?? { u_id: "" };

        if (!u_id) {
          set.status = 401;
          return {
            success: false,
            message: "Unauthorized"
          };
        }

        const lab = await LabService.getLabById(params.id);
        if (!lab) {
          set.status = 404;
          return {
            success: false,
            message: "Lab not found"
          };
        }

        const labObjectId = new Types.ObjectId(params.id);
        const session = await StudentLabSessionService.acknowledgeInstructions(
          u_id,
          labObjectId,
          lab as ILab
        );

        set.status = 200;
        return {
          success: true,
          message: "Instructions acknowledged",
          data: {
            acknowledged: session.instructionsAcknowledged,
            acknowledgedAt: session.instructionsAcknowledgedAt
          }
        };
      } catch (error) {
        console.error('[Instructions Acknowledge Error]', error);
        set.status = 500;
        return {
          success: false,
          message: "Failed to acknowledge instructions",
          error: (error as Error).message
        };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      beforeHandle: requireRole(["STUDENT", "INSTRUCTOR", "ADMIN"]),
      detail: {
        tags: ["Labs"],
        summary: "Acknowledge Lab Instructions",
        description: "Marks the lab instructions (Part 0) as acknowledged for the current student"
      }
    }
  )

  // Update lab
  .put(
    "/:id",
    async ({ params, body, set, query }) => {
      try {
        // Get existing lab
        const existingLab = await LabService.getLabById(params.id);
        if (!existingLab) {
          set.status = 404;
          return {
            success: false,
            message: "Lab not found"
          };
        }

        // Validate exempt IP ranges if being updated
        if (body.network?.topology?.exemptIpRanges) {
          const exemptValidation = VlanValidator.validateExemptRanges(
            body.network.topology.exemptIpRanges,
            body.network?.topology?.baseNetwork || existingLab.network.topology.baseNetwork,
            body.network?.topology?.subnetMask || existingLab.network.topology.subnetMask
          );
          if (!exemptValidation.valid) {
            set.status = 400;
            return {
              success: false,
              message: "Exempt IP ranges validation failed",
              errors: exemptValidation.errors
            };
          }

          // Check for conflicts with active sessions
          const { StudentLabSessionService } = await import('../student-lab-sessions/service');
          const { Types } = await import('mongoose');
          const labObjectId = new Types.ObjectId(params.id);

          const conflicts = await StudentLabSessionService.findConflictingSessions(
            labObjectId,
            body.network.topology.exemptIpRanges
          );

          // If conflicts found and not confirmed, return warning
          if (conflicts.length > 0 && !query.confirmed) {
            set.status = 409;
            return {
              success: false,
              status: "warning",
              message: `${conflicts.length} active session(s) have Management IPs in the new exempt ranges`,
              conflicts: conflicts,
              requiresConfirmation: true,
              instructions: "Add ?confirmed=true to the request to proceed with reassignment"
            };
          }

          // If confirmed and conflicts exist, reassign IPs
          if (conflicts.length > 0 && query.confirmed === 'true') {
            const conflictedStudentIds = conflicts.map(c => c.studentId);

            // Update lab first so reassignment uses new exempt ranges
            const updatedLab = await LabService.updateLab(params.id, body);
            if (!updatedLab) {
              set.status = 500;
              return {
                success: false,
                message: "Failed to update lab during reassignment"
              };
            }

            // Reassign conflicted IPs
            const reassignedCount = await StudentLabSessionService.reassignConflictedIPs(
              labObjectId,
              updatedLab as any,
              conflictedStudentIds
            );

            set.status = 200;
            return {
              success: true,
              message: "Lab updated successfully with IP reassignment",
              data: updatedLab,
              reassigned: {
                count: reassignedCount,
                students: conflictedStudentIds
              }
            };
          }

          // Check capacity after validation
          const updatedLabForCapacity = {
            ...existingLab,
            network: {
              ...existingLab.network,
              topology: {
                ...existingLab.network.topology,
                ...body.network?.topology
              }
            }
          };

          const capacity = await StudentLabSessionService.calculateIpCapacity(updatedLabForCapacity as any);
          if (!capacity.sufficient) {
            set.status = 400;
            return {
              success: false,
              message: "Insufficient IP capacity for enrolled students",
              details: {
                totalIps: capacity.totalIps,
                exemptIps: capacity.exemptCount,
                availableIps: capacity.available,
                enrolledStudents: capacity.enrolledStudents,
                shortage: capacity.enrolledStudents - capacity.available
              },
              suggestion: `Reduce exempt ranges by ${capacity.enrolledStudents - capacity.available} IPs or expand the management network`
            };
          }
        }

        // Proceed with update
        const updatedLab = await LabService.updateLab(params.id, body);

        if (!updatedLab) {
          set.status = 404;
          return {
            success: false,
            message: "Lab not found"
          };
        }

        set.status = 200;
        return {
          success: true,
          message: "Lab updated successfully",
          data: updatedLab
        };
      } catch (error) {
        set.status = 400;
        return {
          success: false,
          message: "Error updating lab",
          error: (error as Error).message
        };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Partial(LabBodySchema),
      query: t.Object({
        confirmed: t.Optional(t.String())
      }),
      beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
      detail: {
        tags: ["Labs"],
        summary: "Update Lab",
        description: "Update lab. If exempt ranges conflict with active sessions, add ?confirmed=true to reassign IPs"
      }
    }
  )

  // Delete lab
  .delete(
    "/:id",
    async ({ params, set }) => {
      try {
        const deletedLab = await LabService.deleteLab(params.id);

        if (!deletedLab) {
          set.status = 404;
          return {
            success: false,
            message: "Lab not found"
          };
        }

        set.status = 200;
        return {
          success: true,
          message: "Lab deleted successfully",
          data: deletedLab
        };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          message: "Error deleting lab",
          error: (error as Error).message
        };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
      detail: {
        tags: ["Labs"],
        summary: "Delete Lab"
      }
    }
  )

  // Get labs by course
  .get(
    "/course/:courseId",
    async ({ params, set, query }) => {
      try {
        const { page = "1", limit = "10" } = query;
        const pageNum = parseInt(page as string);
        const limitNum = parseInt(limit as string);

        const result = await LabService.getLabsByCourse(params.courseId, pageNum, limitNum);

        set.status = 200;
        return {
          success: true,
          message: "Labs fetched successfully",
          data: result
        };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          message: "Error fetching labs for course",
          error: (error as Error).message
        };
      }
    },
    {
      params: t.Object({ courseId: t.String() }),
      query: t.Object({
        page: t.Optional(t.String()),
        limit: t.Optional(t.String())
      }),
      detail: {
        tags: ["Labs"],
        summary: "Get Labs by Course"
      }
    }
  )

  // Get lab with full details including network
  .get(
    "/:id/details",
    async ({ params, set }) => {
      try {
        const lab = await LabService.getLabWithDetails(params.id);
        const { StudentLabSessionService } = await import('../student-lab-sessions/service');
        const capacity = await StudentLabSessionService.calculateIpCapacity(lab as ILab);
        
        if (!lab) {
          set.status = 404;
          return {
            success: false,
            message: "Lab not found"
          };
        }

        set.status = 200;
        return {
          success: true,
          message: "Lab details fetched successfully",
          data: lab,
          ipCapacity: capacity
        };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          message: "Error fetching lab details",
          error: (error as Error).message
        };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ["Labs"],
        summary: "Get Lab with Full Details",
        description: "Get lab with populated network information"
      }
    }
  )

  // Get lab statistics
  .get(
    "/stats/overview",
    async ({ set, query }) => {
      try {
        const { courseId } = query;
        
        const stats = await LabService.getLabStatistics(courseId);

        set.status = 200;
        return {
          success: true,
          message: "Lab statistics fetched successfully",
          data: stats
        };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          message: "Error fetching lab statistics",
          error: (error as Error).message
        };
      }
    },
    {
      query: t.Object({
        courseId: t.Optional(t.String())
      }),
      detail: {
        tags: ["Labs"],
        summary: "Get Lab Statistics"
      }
    }
  )
  .get(
    "/stats/:id", async ({ params, set }) => {
      try {
        const lab = await LabService.getLabById(params.id);
        if (!lab) {
          set.status = 404;
          return {
            success: false,
            message: "Lab not found"
          };
        }
        const assignedIps = (await StudentLabSessionService.getAssignedIps(params.id)).map(s => ({
          studentId: s.studentId,
          studentName: s.username,
          managementIp: s.mgntIp
        }));
        const ipStats = await StudentLabSessionService.calculateIpCapacity(lab as ILab)
        return {
          success: true,
          message: "Lab IP assignment statistics fetched successfully",
          ipStats,
          assignedIps
        };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          message: "Error fetching lab IP assignment statistics",
          error: (error as Error).message
        };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ["Labs"],
        summary: "Get Lab IP Assignment Statistics"
      }
    }
  );

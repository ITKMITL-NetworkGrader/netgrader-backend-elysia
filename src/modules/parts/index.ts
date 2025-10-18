import { Elysia, t } from "elysia";
import { PartService } from "./service";
import { authPlugin, requireRole } from "../../plugins/plugins";

// Rich content schema
const RichContentSchema = t.Object({
  html: t.String(),
  json: t.Any()
});

// Schema mapping for IP calculations
const SchemaMappingSchema = t.Object({
  vlanIndex: t.Number({ minimum: 0, maximum: 9 }),
  field: t.Union([
    t.Literal("networkAddress"),
    t.Literal("subnetMask"),
    t.Literal("firstUsableIp"),
    t.Literal("lastUsableIp"),
    t.Literal("broadcastAddress")
  ]),
  deviceId: t.Optional(t.String()),
  variableName: t.Optional(t.String()),
  autoDetected: t.Optional(t.Boolean())
});

// Calculated answer schema for IP tables
const CalculatedAnswerSchema = t.Object({
  calculationType: t.Union([
    t.Literal("vlan_network_address"),
    t.Literal("vlan_first_usable"),
    t.Literal("vlan_last_usable"),
    t.Literal("vlan_broadcast"),
    t.Literal("vlan_subnet_mask"),
    t.Literal("vlan_lecturer_offset"),
    t.Literal("vlan_lecturer_range"),
    t.Literal("device_interface_ip"),
    t.Literal("vlan_id")
  ]),
  vlanIndex: t.Optional(t.Number({ minimum: 0, maximum: 9 })),
  lecturerOffset: t.Optional(t.Number({ minimum: 1, maximum: 254 })),
  lecturerRangeStart: t.Optional(t.Number({ minimum: 1, maximum: 254 })),
  lecturerRangeEnd: t.Optional(t.Number({ minimum: 1, maximum: 254 })),
  deviceId: t.Optional(t.String()),
  interfaceName: t.Optional(t.String())
});

// IP Table cell schema
const TableCellSchema = t.Object({
  cellId: t.String(),
  rowId: t.String(),
  columnId: t.String(),
  answerType: t.Union([t.Literal("static"), t.Literal("calculated")]),
  staticAnswer: t.Optional(t.String()),
  calculatedAnswer: t.Optional(CalculatedAnswerSchema),
  points: t.Number({ minimum: 0 }),
  autoCalculated: t.Boolean()
});

// IP Table questionnaire schema
const IpTableQuestionnaireSchema = t.Object({
  tableId: t.String(),
  rowCount: t.Number({ minimum: 1, maximum: 10 }),
  columnCount: t.Number({ minimum: 1, maximum: 10 }),
  autoCalculate: t.Boolean(),
  columns: t.Array(t.Object({
    columnId: t.String(),
    label: t.String(),
    order: t.Number()
  })),
  rows: t.Array(t.Object({
    rowId: t.String(),
    deviceId: t.String(),
    interfaceName: t.String(),
    displayName: t.String(),
    order: t.Number()
  })),
  cells: t.Array(t.Array(TableCellSchema))
});

// Question schema for fill-in-blank parts
const QuestionSchema = t.Object({
  questionId: t.String(),
  questionText: t.String(),
  questionType: t.Union([
    t.Literal("network_address"),
    t.Literal("first_usable_ip"),
    t.Literal("last_usable_ip"),
    t.Literal("broadcast_address"),
    t.Literal("subnet_mask"),
    t.Literal("ip_address"),
    t.Literal("number"),
    t.Literal("custom_text"),
    t.Literal("ip_table_questionnaire")
  ]),
  order: t.Number(),
  points: t.Number({ minimum: 0 }),
  schemaMapping: t.Optional(SchemaMappingSchema),
  answerFormula: t.Optional(t.String()),
  expectedAnswerType: t.Union([t.Literal("exact"), t.Literal("range")]),
  placeholder: t.Optional(t.String()),
  inputFormat: t.Optional(t.Union([
    t.Literal("ip"),
    t.Literal("cidr"),
    t.Literal("number"),
    t.Literal("text")
  ])),
  expectedAnswer: t.Optional(t.String()),
  caseSensitive: t.Optional(t.Boolean()),
  trimWhitespace: t.Optional(t.Boolean()),
  ipTableQuestionnaire: t.Optional(IpTableQuestionnaireSchema)
});

// DHCP configuration schema
const DhcpConfigurationSchema = t.Object({
  vlanIndex: t.Number({ minimum: 0, maximum: 9 }),
  startOffset: t.Number({ minimum: 1, maximum: 254 }),
  endOffset: t.Number({ minimum: 1, maximum: 254 }),
  dhcpServerDevice: t.String()
});

// Task schema (for network_config parts)
const TaskSchema = t.Object({
  taskId: t.String(),
  name: t.String(),
  description: t.String({ default: "" }),
  templateId: t.String(),
  group_id: t.Optional(t.String({ description: "Optional grouping for grading" })),
  executionDevice: t.String(),
  targetDevices: t.Array(t.String(), { default: [] }),
  parameters: t.Record(t.String(), t.Any()),
  testCases: t.Array(t.Object({
    comparison_type: t.String({ description: "Type of comparison: equals, contains, regex, success, ssh_success, greater_than" }),
    expected_result: t.Any({ description: "Expected value/result for comparison" })
  })),
  order: t.Number(),
  points: t.Number()
});

// Task group schema
const TaskGroupSchema = t.Object({
  group_id: t.String(),
  title: t.String(),
  description: t.String({ default: "" }),
  group_type: t.Union([t.Literal("all_or_nothing"), t.Literal("proportional")]),
  points: t.Number(),
  continue_on_failure: t.Boolean(),
  timeout_seconds: t.Number()
});

// Main Part Create Schema (supports all part types)
const PartCreateSchema = t.Object({
  labId: t.String({ description: "Lab ID this part belongs to" }),
  partId: t.String({ description: "Human-readable ID within lab" }),
  title: t.String({ description: "Part title" }),
  description: t.Optional(t.String({ default: "" })),
  instructions: t.Union([RichContentSchema, t.String()]),
  order: t.Number({ description: "Part order within lab" }),

  // Part type determines which fields are required
  partType: t.Union([
    t.Literal("fill_in_blank"),
    t.Literal("network_config"),
    t.Literal("dhcp_config")
  ], { default: "network_config" }),

  // For fill_in_blank parts
  questions: t.Optional(t.Array(QuestionSchema)),

  // For network_config parts
  tasks: t.Optional(t.Array(TaskSchema)),
  task_groups: t.Optional(t.Array(TaskGroupSchema, { default: [] })),

  // For dhcp_config parts
  dhcpConfiguration: t.Optional(DhcpConfigurationSchema),

  // Common fields
  prerequisites: t.Optional(t.Array(t.String(), { default: [] })),
  totalPoints: t.Number({ description: "Total points for this part" })
});

// Part Update Schema (all fields optional for partial updates)
const PartUpdateSchema = t.Object({
  partId: t.Optional(t.String()),
  title: t.Optional(t.String()),
  description: t.Optional(t.String()),
  instructions: t.Optional(t.Union([RichContentSchema, t.String()])),
  order: t.Optional(t.Number()),

  // Part type
  partType: t.Optional(t.Union([
    t.Literal("fill_in_blank"),
    t.Literal("network_config"),
    t.Literal("dhcp_config")
  ])),

  // For fill_in_blank parts
  questions: t.Optional(t.Array(QuestionSchema)),

  // For network_config parts
  tasks: t.Optional(t.Array(TaskSchema)),
  task_groups: t.Optional(t.Array(TaskGroupSchema)),

  // For dhcp_config parts
  dhcpConfiguration: t.Optional(DhcpConfigurationSchema),

  // Common fields
  prerequisites: t.Optional(t.Array(t.String())),
  totalPoints: t.Optional(t.Number())
});

export const partRoutes = new Elysia({ prefix: "/parts" })
  .use(authPlugin)
  
  // Get all parts with filtering
  .get(
    "/",
    async ({ query, set }) => {
      try {
        const { labId, createdBy, page, limit } = query;
        const filters = {
          labId,
          createdBy,
          page: page ? parseInt(page) : undefined,
          limit: limit ? parseInt(limit) : undefined
        };

        const result = await PartService.getAllParts(filters);
        set.status = 200;
        return result;
      } catch (error) {
        set.status = 500;
        return { error: (error as Error).message };
      }
    },
    {
      query: t.Object({
        labId: t.Optional(t.String({ description: "Filter by lab ID" })),
        createdBy: t.Optional(t.String({ description: "Filter by creator" })),
        page: t.Optional(t.String({ description: "Page number" })),
        limit: t.Optional(t.String({ description: "Items per page" }))
      }),
      response: {
        500: t.Object({ error: t.String() })
      },
      detail: {
        tags: ["Parts"],
        summary: "Get all parts",
        description: "Retrieve all lab parts with optional filtering and pagination"
      }
    }
  )

  // Create new part
  .post(
    "/",
    async ({ body, authPlugin, set }) => {
      try {
        const { u_id } = authPlugin ?? { u_id: "" };

        const newPart = await PartService.createPart(body, u_id);
        set.status = 201;
        return newPart;
      } catch (error) {
        set.status = 400;
        return { error: (error as Error).message };
      }
    },
    {
      body: PartCreateSchema,
      response: {
        400: t.Object({ error: t.String() }),
        401: t.Object({ error: t.String() })
      },
      detail: {
        tags: ["Parts"],
        summary: "Create new part",
        description: "Create a new lab part"
      }
    }
  )

  // Get part by ID
  .get(
    "/:id",
    async ({ params, set }) => {
      try {
        const part = await PartService.getPartById(params.id);
        
        if (!part) {
          set.status = 404;
          return { error: "Part not found" };
        }

        set.status = 200;
        return part;
      } catch (error) {
        set.status = 500;
        return { error: (error as Error).message };
      }
    },
    {
      params: t.Object({
        id: t.String({ description: "Part ID" })
      }),
      response: {
        404: t.Object({ error: t.String() }),
        500: t.Object({ error: t.String() })
      },
      detail: {
        tags: ["Parts"],
        summary: "Get part by ID",
        description: "Retrieve a specific part by its ID"
      }
    }
  )

  // Update part
  .put(
    "/:id",
    async ({ params, body, set }) => {
      try {
        const updatedPart = await PartService.updatePart(params.id, body);
        
        if (!updatedPart) {
          set.status = 404;
          return { error: "Part not found" };
        }

        set.status = 200;
        return updatedPart;
      } catch (error) {
        set.status = 400;
        return { error: (error as Error).message };
      }
    },
    {
      params: t.Object({
        id: t.String({ description: "Part ID" })
      }),
      body: PartUpdateSchema,
      response: {
        400: t.Object({ error: t.String() }),
        404: t.Object({ error: t.String() })
      },
      detail: {
        tags: ["Parts"],
        summary: "Update part",
        description: "Update a part by ID"
      }
    }
  )

  // Delete part
  .delete(
    "/:id",
    async ({ params, set }) => {
      try {
        const deletedPart = await PartService.deletePart(params.id);
        
        if (!deletedPart) {
          set.status = 404;
          return { error: "Part not found" };
        }

        set.status = 200;
        return { message: "Part deleted successfully", part: deletedPart };
      } catch (error) {
        set.status = 500;
        return { error: (error as Error).message };
      }
    },
    {
      params: t.Object({
        id: t.String({ description: "Part ID" })
      }),
      response: {
        404: t.Object({ error: t.String() }),
        500: t.Object({ error: t.String() })
      },
      detail: {
        tags: ["Parts"],
        summary: "Delete part",
        description: "Delete a part by ID"
      }
    }
  )

  // Get parts by lab ID
  .get(
    "/lab/:labId",
    async ({ params, query, set }) => {
      try {
        const { page, limit } = query;
        const result = await PartService.getPartsByLab(
          params.labId,
          page ? parseInt(page) : undefined,
          limit ? parseInt(limit) : undefined
        );
        
        set.status = 200;
        return result;
      } catch (error) {
        set.status = 500;
        return { error: (error as Error).message };
      }
    },
    {
      params: t.Object({
        labId: t.String({ description: "Lab ID" })
      }),
      query: t.Object({
        page: t.Optional(t.String({ description: "Page number" })),
        limit: t.Optional(t.String({ description: "Items per page" }))
      }),
      response: {
        500: t.Object({ error: t.String() })
      },
      detail: {
        tags: ["Parts"],
        summary: "Get parts by lab",
        description: "Get all parts for a specific lab"
      }
    }
  )

  // Get part statistics
  .get(
    "/statistics/:labId?",
    async ({ params, set }) => {
      try {
        const stats = await PartService.getPartStatistics(params.labId);
        set.status = 200;
        return stats;
      } catch (error) {
        set.status = 500;
        return { error: (error as Error).message };
      }
    },
    {
      params: t.Object({
        labId: t.Optional(t.String({ description: "Optional lab ID for lab-specific stats" }))
      }),
      response: {
        500: t.Object({ error: t.String() })
      },
      detail: {
        tags: ["Parts"],
        summary: "Get part statistics",
        description: "Get statistics about parts (optionally filtered by lab)"
      }
    }
  )

  // Auto-save functionality
  .post(
    "/:id/auto-save",
    async ({ params, body, set }) => {
      try {
        const { labId, content, field } = body;

        const result = await PartService.autoSavePart(
          params.id,
          labId,
          content,
          field
        );

        set.status = 200;
        return result;
      } catch (error) {
        set.status = 500;
        return { error: (error as Error).message };
      }
    },
    {
      params: t.Object({
        id: t.String({ description: "Part ID" })
      }),
      body: t.Object({
        labId: t.String(),
        content: RichContentSchema,
        field: t.String({ description: "Field name (instructions, description, etc.)" })
      }),
      response: {
        500: t.Object({ error: t.String() })
      },
      detail: {
        tags: ["Parts"],
        summary: "Auto-save rich content",
        description: "Auto-save functionality for rich content fields"
      }
    }
  )

  // Load auto-saved content
  .get(
    "/:id/auto-save/:field",
    async ({ params, query, set }) => {
      try {
        const { id, field } = params;
        const { labId } = query;

        const result = await PartService.loadAutoSave(
          id,
          labId as string,
          field
        );

        set.status = result.success ? 200 : 404;
        return result;
      } catch (error) {
        set.status = 500;
        return { error: (error as Error).message };
      }
    },
    {
      params: t.Object({
        id: t.String({ description: "Part ID" }),
        field: t.String({ description: "Field name (instructions, description, etc.)" })
      }),
      query: t.Object({
        labId: t.String()
      }),
      response: {
        404: t.Object({ success: t.Boolean(), message: t.String() }),
        500: t.Object({ error: t.String() })
      },
      detail: {
        tags: ["Parts"],
        summary: "Load auto-saved content",
        description: "Retrieve auto-saved content for a specific field"
      }
    }
  )

  // Get part with auto-save status
  .get(
    "/:id/with-autosave",
    async ({ params, query, set }) => {
      try {
        const { id } = params;
        const { labId } = query;

        const part = await PartService.getPartWithAutoSave(
          id,
          labId as string
        );
        
        if (!part) {
          set.status = 404;
          return { error: "Part not found" };
        }

        set.status = 200;
        return part;
      } catch (error) {
        set.status = 500;
        return { error: (error as Error).message };
      }
    },
    {
      params: t.Object({
        id: t.String({ description: "Part ID" })
      }),
      query: t.Object({
        labId: t.String()
      }),
      response: {
        404: t.Object({ error: t.String() }),
        500: t.Object({ error: t.String() })
      },
      detail: {
        tags: ["Parts"],
        summary: "Get part with auto-save status",
        description: "Retrieve part data along with auto-save status information"
      }
    }
  )

  // Asset cleanup
  .post(
    "/:id/cleanup-assets",
    async ({ params, body, set }) => {
      try {
        const { labId, currentAssets } = body;

        const result = await PartService.cleanupAssets(
          params.id,
          labId,
          currentAssets
        );

        set.status = 200;
        return result;
      } catch (error) {
        set.status = 500;
        return { error: (error as Error).message };
      }
    },
    {
      params: t.Object({
        id: t.String({ description: "Part ID" })
      }),
      body: t.Object({
        labId: t.String(),
        currentAssets: t.Array(t.String(), { description: "Array of currently used asset IDs" })
      }),
      response: {
        500: t.Object({ error: t.String() })
      },
      detail: {
        tags: ["Parts"],
        summary: "Clean up unused assets",
        description: "Remove unused assets from part"
      }
    }
  );
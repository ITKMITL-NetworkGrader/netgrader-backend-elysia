/**
 * Student IP Schema Routes
 *
 * API endpoints for submitting and retrieving student IP schemas
 */

import { Elysia, t } from 'elysia';
import { StudentIpSchemaService } from './service';
import { Types } from 'mongoose';
import { authPlugin } from '../../plugins/plugins';

export const studentIpSchemaRoutes = new Elysia({ prefix: '/v0' })
  .use(authPlugin)
  /**
   * POST /v0/labs/:labId/parts/:partId/submit-answers
   *
   * Submit or update IP calculation answers
   */
  .post(
    '/labs/:labId/parts/:partId/submit-answers',
    async ({ params, body, authPlugin }) => {
      const { u_id } = authPlugin ?? { u_id: '' };
      if (!u_id) {
        return {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required'
          }
        };
      }

      try {
        const studentId = new Types.ObjectId(u_id);
        const labId = new Types.ObjectId(params.labId);
        const partId = new Types.ObjectId(params.partId);

        const result = await StudentIpSchemaService.submitAnswers(
          studentId,
          labId,
          partId,
          body
        );

        return {
          success: true,
          data: result
        };
      } catch (error: any) {
        return {
          success: false,
          error: {
            code: 'SUBMISSION_FAILED',
            message: error.message || 'Failed to submit answers'
          }
        };
      }
    },
    {
      body: t.Object({
        answers: t.Array(
          t.Object({
            questionId: t.String(),
            answer: t.Optional(t.String()),
            tableAnswers: t.Optional(
              t.Array(t.Array(t.String()))
            )
          })
        ),
        isUpdate: t.Boolean()
      }),
      params: t.Object({
        labId: t.String(),
        partId: t.String()
      })
    }
  )

  /**
   * GET /v0/labs/:labId/ip-schema
   *
   * Get latest IP schema for the current student
   */
  .get(
    '/labs/:labId/ip-schema',
    async ({ params, authPlugin }) => {
      const { u_id } = authPlugin ?? { u_id: '' };
      if (!u_id) {
        return {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required'
          }
        };
      }

      try {
        const studentId = new Types.ObjectId(u_id);
        const labId = new Types.ObjectId(params.labId);

        const schema = await StudentIpSchemaService.getLatestSchema(studentId, labId);

        if (!schema) {
          return {
            success: false,
            error: {
              code: 'SCHEMA_NOT_FOUND',
              message: 'No IP schema found for this lab'
            }
          };
        }

        return {
          success: true,
          data: {
            schemaId: String(schema._id),
            version: schema.version,
            schema: schema.schema,
            createdAt: schema.createdAt,
            updatedAt: schema.updatedAt
          }
        };
      } catch (error: any) {
        return {
          success: false,
          error: {
            code: 'FETCH_FAILED',
            message: error.message || 'Failed to fetch IP schema'
          }
        };
      }
    },
    {
      params: t.Object({
        labId: t.String()
      })
    }
  )

  /**
   * GET /v0/labs/:labId/ip-schema/versions
   *
   * Get all IP schema versions for the current student
   */
  .get(
    '/labs/:labId/ip-schema/versions',
    async ({ params, authPlugin }) => {
      const { u_id } = authPlugin ?? { u_id: '' };
      if (!u_id) {
        return {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required'
          }
        };
      }

      try {
        const studentId = new Types.ObjectId(u_id);
        const labId = new Types.ObjectId(params.labId);

        const versions = await StudentIpSchemaService.getAllSchemaVersions(studentId, labId);

        return {
          success: true,
          data: {
            versions: versions.map(v => ({
              schemaId: String(v._id),
              version: v.version,
              schema: v.schema,
              createdAt: v.createdAt,
              updatedAt: v.updatedAt
            }))
          }
        };
      } catch (error: any) {
        return {
          success: false,
          error: {
            code: 'FETCH_FAILED',
            message: error.message || 'Failed to fetch IP schema versions'
          }
        };
      }
    },
    {
      params: t.Object({
        labId: t.String()
      })
    }
  )

  /**
   * POST /v0/labs/:labId/parts/:partId/submit-completion
   *
   * Submit DHCP configuration completion
   */
  .post(
    '/labs/:labId/parts/:partId/submit-completion',
    async ({ params, body, authPlugin }) => {
      const { u_id } = authPlugin ?? { u_id: '' };
      if (!u_id) {
        return {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required'
          }
        };
      }

      try {
        const studentId = new Types.ObjectId(u_id);
        const labId = new Types.ObjectId(params.labId);
        const partId = new Types.ObjectId(params.partId);

        const result = await StudentIpSchemaService.submitCompletion(
          studentId,
          labId,
          partId,
          body.vlanIndex
        );

        return {
          success: true,
          data: result
        };
      } catch (error: any) {
        return {
          success: false,
          error: {
            code: 'SUBMISSION_FAILED',
            message: error.message || 'Failed to submit completion'
          }
        };
      }
    },
    {
      body: t.Object({
        vlanIndex: t.Number()
      }),
      params: t.Object({
        labId: t.String(),
        partId: t.String()
      })
    }
  );

import { Elysia, t } from 'elysia'
import { ThemeService } from './service.js'
import { authPlugin, requireRole } from '../../plugins/plugins.js'

const CssVarsBody = t.Object({
  theme: t.Optional(t.Record(t.String(), t.String())),
  light: t.Optional(t.Record(t.String(), t.String())),
  dark: t.Optional(t.Record(t.String(), t.String())),
})

export const themeRoutes = new Elysia({ prefix: '/themes' })
  .use(authPlugin)

  /**
   * List all custom themes
   * GET /themes
   * Any authenticated user can view
   */
  .get(
    '/',
    async ({ authPlugin, set }) => {
      if (!authPlugin) {
        set.status = 401
        return { error: 'Unauthorized' }
      }

      try {
        const themes = await ThemeService.listCustomThemes()

        // Convert Mongoose Maps to plain objects for JSON serialization
        const serialized = themes.map(t => ({
          id: t.themeId,
          name: t.name,
          description: t.description,
          createdBy: t.createdBy,
          cssVars: {
            theme: Object.fromEntries(t.cssVars.theme as any || []),
            light: Object.fromEntries(t.cssVars.light as any || []),
            dark: Object.fromEntries(t.cssVars.dark as any || []),
          },
          createdAt: t.createdAt,
        }))

        return { success: true, data: serialized }
      } catch (error) {
        console.error('Error listing themes:', error)
        set.status = 500
        return { error: 'Failed to list themes' }
      }
    },
    {
      detail: {
        summary: 'List custom themes',
        description: 'Returns all custom (non-system) themes',
        tags: ['Themes'],
      },
    }
  )

  /**
   * Create a new custom theme
   * POST /themes
   * ADMIN only
   */
  .post(
    '/',
    async ({ body, authPlugin, set }) => {
      try {
        const { u_id } = authPlugin!
        const result = await ThemeService.createTheme({
          themeId: body.themeId,
          name: body.name,
          description: body.description,
          cssVars: body.cssVars,
          createdBy: u_id,
        })

        if (!result.success) {
          set.status = 400
          return { error: result.message }
        }

        set.status = 201
        return { success: true, message: 'Theme created', data: { themeId: body.themeId } }
      } catch (error) {
        console.error('Error creating theme:', error)
        set.status = 500
        return { error: 'Failed to create theme' }
      }
    },
    {
      beforeHandle: requireRole(['ADMIN']),
      body: t.Object({
        themeId: t.String({ minLength: 1, maxLength: 100, pattern: '^[a-z0-9-]+$' }),
        name: t.String({ minLength: 1, maxLength: 100 }),
        description: t.Optional(t.String({ maxLength: 500 })),
        cssVars: CssVarsBody,
      }),
      detail: {
        summary: 'Create custom theme',
        description: 'Create a new custom theme (ADMIN only). CSS values are sanitized server-side.',
        tags: ['Themes'],
      },
    }
  )

  /**
   * Delete a custom theme
   * DELETE /themes/:themeId
   * ADMIN only
   */
  .delete(
    '/:themeId',
    async ({ params, set }) => {
      try {
        const result = await ThemeService.deleteTheme(params.themeId)

        if (!result.success) {
          set.status = 400
          return { error: result.message }
        }

        return { success: true, message: result.message }
      } catch (error) {
        console.error('Error deleting theme:', error)
        set.status = 500
        return { error: 'Failed to delete theme' }
      }
    },
    {
      beforeHandle: requireRole(['ADMIN']),
      params: t.Object({
        themeId: t.String(),
      }),
      detail: {
        summary: 'Delete custom theme',
        description: 'Delete a custom theme by ID (ADMIN only). System themes cannot be deleted.',
        tags: ['Themes'],
      },
    }
  )

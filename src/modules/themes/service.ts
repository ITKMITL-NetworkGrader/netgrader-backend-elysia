import { Theme } from './model.js'

// Whitelist of CSS custom property names we allow
const ALLOWED_COLOR_VARS = new Set([
  '--background', '--foreground', '--card', '--card-foreground',
  '--popover', '--popover-foreground', '--primary', '--primary-foreground',
  '--secondary', '--secondary-foreground', '--muted', '--muted-foreground',
  '--accent', '--accent-foreground', '--destructive', '--destructive-foreground',
  '--border', '--input', '--ring',
  '--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5',
  '--sidebar', '--sidebar-foreground', '--sidebar-primary', '--sidebar-primary-foreground',
  '--sidebar-accent', '--sidebar-accent-foreground', '--sidebar-border', '--sidebar-ring',
])

const ALLOWED_THEME_VARS = new Set([
  '--font-sans', '--font-serif', '--font-mono', '--radius',
])

// Patterns that could be dangerous in CSS values
const DANGEROUS_VALUE_PATTERN = /url\s*\(|expression\s*\(|javascript\s*:|@import|@charset|-moz-binding|behavior\s*:/i

export class ThemeService {
  /**
   * Sanitize a single CSS value — reject if it contains dangerous patterns
   */
  static sanitizeValue(value: string): string | null {
    const trimmed = value.trim()
    if (DANGEROUS_VALUE_PATTERN.test(trimmed)) {
      return null
    }
    // Max length guard
    if (trimmed.length > 500) {
      return null
    }
    return trimmed
  }

  /**
   * Sanitize a vars object — only keep whitelisted keys with safe values
   */
  static sanitizeVars(
    vars: Record<string, string>,
    allowedKeys: Set<string>,
  ): Record<string, string> {
    const sanitized: Record<string, string> = {}
    for (const [key, value] of Object.entries(vars)) {
      if (!allowedKeys.has(key)) continue
      const safe = ThemeService.sanitizeValue(value)
      if (safe !== null) {
        sanitized[key] = safe
      }
    }
    return sanitized
  }

  /**
   * Validate and sanitize the full cssVars payload
   */
  static sanitizeCssVars(cssVars: {
    theme?: Record<string, string>
    light?: Record<string, string>
    dark?: Record<string, string>
  }) {
    return {
      theme: ThemeService.sanitizeVars(cssVars.theme || {}, ALLOWED_THEME_VARS),
      light: ThemeService.sanitizeVars(cssVars.light || {}, ALLOWED_COLOR_VARS),
      dark: ThemeService.sanitizeVars(cssVars.dark || {}, ALLOWED_COLOR_VARS),
    }
  }

  /**
   * List all custom (non-system) themes
   */
  static async listCustomThemes() {
    return Theme.find({ isSystem: false })
      .sort({ createdAt: -1 })
      .lean()
  }

  /**
   * Create a new custom theme
   */
  static async createTheme(data: {
    themeId: string
    name: string
    description?: string
    cssVars: {
      theme?: Record<string, string>
      light?: Record<string, string>
      dark?: Record<string, string>
    }
    createdBy: string
  }) {
    // Check for duplicate themeId
    const existing = await Theme.findOne({ themeId: data.themeId })
    if (existing) {
      return { success: false, message: 'A theme with this ID already exists' }
    }

    const sanitizedVars = ThemeService.sanitizeCssVars(data.cssVars)

    // Ensure at least some vars were accepted
    if (Object.keys(sanitizedVars.light).length === 0 && Object.keys(sanitizedVars.dark).length === 0) {
      return { success: false, message: 'No valid CSS variables found after sanitization' }
    }

    const theme = await Theme.create({
      themeId: data.themeId,
      name: data.name,
      description: data.description,
      isSystem: false,
      createdBy: data.createdBy,
      cssVars: sanitizedVars,
    })

    return { success: true, theme }
  }

  /**
   * Delete a custom theme (cannot delete system themes)
   */
  static async deleteTheme(themeId: string) {
    const theme = await Theme.findOne({ themeId })
    if (!theme) {
      return { success: false, message: 'Theme not found' }
    }
    if (theme.isSystem) {
      return { success: false, message: 'Cannot delete a system theme' }
    }
    await Theme.deleteOne({ themeId })
    return { success: true, message: 'Theme deleted' }
  }
}

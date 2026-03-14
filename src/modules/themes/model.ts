import mongoose, { Schema, Document } from 'mongoose'

export interface ITheme extends Document {
  themeId: string       // URL-safe slug (e.g., "violet-rose")
  name: string          // Display name (e.g., "Violet Rose")
  description?: string
  isSystem: boolean     // true = bundled theme, cannot be deleted via API
  createdBy?: string    // u_id of the ADMIN who created it
  cssVars: {
    theme: Record<string, string>   // fonts, radius, spacing
    light: Record<string, string>   // light mode color vars
    dark: Record<string, string>    // dark mode color vars
  }
  createdAt: Date
  updatedAt: Date
}

const CssVarsSchema = new Schema({
  theme: { type: Map, of: String, default: {} },
  light: { type: Map, of: String, default: {} },
  dark: { type: Map, of: String, default: {} },
}, { _id: false })

const ThemeSchema = new Schema<ITheme>({
  themeId: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100,
  },
  description: {
    type: String,
    required: false,
    maxlength: 500,
  },
  isSystem: {
    type: Boolean,
    default: false,
  },
  createdBy: {
    type: String,
    required: false,
  },
  cssVars: {
    type: CssVarsSchema,
    required: true,
  },
}, {
  timestamps: true,
})

export const Theme = mongoose.model<ITheme>('Theme', ThemeSchema, 'themes')

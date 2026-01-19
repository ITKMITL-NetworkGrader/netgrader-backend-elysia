import mongoose, { Schema, Document } from "mongoose";
import { getDateWithTimezone } from "../../utils/helpers.js";

export interface IUser extends Document {
  u_id: string;
  password?: string;
  fullName: string;
  role: "ADMIN" | "STUDENT" | "INSTRUCTOR";
  ldapAuthenticated: boolean;
  profilePicture?: string; // MinIO object URL for profile picture
  bio?: string; // User bio (max 500 chars)
  gns3ServerIndex?: number; // Assigned GNS3 server index (0 or 1), set once on first lab start
  gns3AceId?: string; // ACE ID for student pool access, set once on first lab start
  createdAt: Date;
  updatedAt: Date;
  lastLogin: Date;
}

const UserSchema = new Schema<IUser>({
  u_id: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: false,
    select: true
  },
  fullName: {
    type: String,
    required: true,
    trim: true
  },
  role: {
    type: String,
    enum: ["ADMIN", "STUDENT", "VIEWER", "INSTRUCTOR"],
    default: "STUDENT"
  },
  ldapAuthenticated: {
    type: Boolean,
    default: true
  },
  profilePicture: {
    type: String,
    required: false
  },
  bio: {
    type: String,
    required: false,
    maxlength: 500,
    default: ''
  },
  gns3ServerIndex: {
    type: Number,
    required: false,
    min: 0
  },
  gns3AceId: {
    type: String,
    required: false
  },
  lastLogin: {
    type: Date,
    default: getDateWithTimezone(7) // Default to current time with timezone offset
  }
}, {
  timestamps: true
});

// Indexes are automatically created by unique: true, so we don't need to define them separately

export const User = mongoose.model<IUser>("User", UserSchema, "users");

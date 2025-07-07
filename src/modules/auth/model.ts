import mongoose, { Schema, Document } from "mongoose";

export interface IUser extends Document {
  u_id: string;
  password?: string;
  fullName: string;
  role: "ADMIN" | "STUDENT" | "VIEWER";
  ldapAuthenticated: boolean;
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
    select: false
  },
  fullName: {
    type: String,
    required: true,
    trim: true
  },
  role: {
    type: String,
    enum: ["ADMIN", "STUDENT", "VIEWER"],
    default: "STUDENT"
  },
  ldapAuthenticated: {
    type: Boolean,
    default: true
  },
  lastLogin: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes are automatically created by unique: true, so we don't need to define them separately

export const User = mongoose.model<IUser>("User", UserSchema);

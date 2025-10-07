import { Schema, model, Document, Types } from 'mongoose';

/**
 * StudentLabSession Model
 * Tracks permanent Management IP assignments for each student's lab session
 *
 * Rules:
 * - IP is assigned when student starts a lab
 * - IP remains the same while lab is incomplete (status: 'active')
 * - IP is released when lab is completed (status: 'completed')
 * - If student restarts or starts new lab after completion, new IP is assigned
 */
export interface IStudentLabSession extends Document {
  studentId: string;           // Student's u_id (e.g., "65070041")
  labId: Types.ObjectId;       // Reference to Lab
  courseId: Types.ObjectId;    // Reference to Course (for enrollment lookup)

  // IP Assignment
  managementIp: string;        // Assigned Management IP (e.g., "10.0.1.5")
  studentIndex: number;        // Student's enrollment order (1-based)

  // Session Status
  status: 'active' | 'completed';

  // Timestamps
  startedAt: Date;             // When student first started this lab
  completedAt?: Date;          // When student completed this lab
  lastAccessedAt: Date;        // Last submission or access time

  createdAt: Date;
  updatedAt: Date;
}

const studentLabSessionSchema = new Schema<IStudentLabSession>({
  studentId: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  labId: {
    type: Schema.Types.ObjectId,
    required: true,
    ref: 'Lab'
  },
  courseId: {
    type: Schema.Types.ObjectId,
    required: true,
    ref: 'Course'
  },

  // IP Assignment
  managementIp: {
    type: String,
    required: true
  },
  studentIndex: {
    type: Number,
    required: true,
    min: 1
  },

  // Session Status
  status: {
    type: String,
    enum: ['active', 'completed'],
    default: 'active',
    required: true
  },

  // Timestamps
  startedAt: {
    type: Date,
    required: true,
    default: Date.now
  },
  completedAt: {
    type: Date,
    required: false
  },
  lastAccessedAt: {
    type: Date,
    required: true,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes for efficient querying
studentLabSessionSchema.index({ labId: 1, status: 1 }); // Find all active sessions for a lab
studentLabSessionSchema.index({ courseId: 1 }); // Course-level queries
studentLabSessionSchema.index({ managementIp: 1, labId: 1 }); // IP uniqueness check per lab

// Compound unique index: One active session per student per lab
// This also covers queries for { studentId: 1, labId: 1, status: 1 }
studentLabSessionSchema.index(
  { studentId: 1, labId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'active' }
  }
);

export const StudentLabSession = model<IStudentLabSession>('StudentLabSession', studentLabSessionSchema);

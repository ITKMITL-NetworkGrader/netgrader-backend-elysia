import { Schema, model, Document, Types } from 'mongoose';

/**
 * StudentLabSession Model
 * Tracks Management IP assignments for each student's lab session
 *
 * IP Assignment Rules:
 * - IP is assigned dynamically when student starts a lab (first available IP)
 * - IP remains the same while lab is incomplete (status: 'active')
 * - IP is released when lab is completed (status: 'completed') or times out
 * - If student restarts after completion, a new available IP is assigned
 *
 * Race Condition Prevention:
 * - Unique index on (labId, managementIp, status='active') prevents duplicate IP assignments
 * - Service layer implements retry logic on duplicate key errors
 */
export interface IStudentLabSession extends Document {
  studentId: string;           // Student's u_id (e.g., "65070041")
  labId: Types.ObjectId;       // Reference to Lab
  courseId: Types.ObjectId;    // Reference to Course (for enrollment lookup)

  // IP Assignment
  managementIp: string;        // Assigned Management IP (e.g., "10.0.1.5")
  studentIndex?: number;       // DEPRECATED: Student's enrollment order (kept for backward compatibility)

  // Session Status
  status: 'active' | 'completed';
  attemptNumber: number;       // Monotonic attempt counter per student/lab
  previousSessionId?: Types.ObjectId | null;
  releaseReason?: 'completion' | 'restart' | 'timeout' | 'admin';
  releasedAt?: Date;

  // Instructions acknowledgement
  instructionsAcknowledged: boolean;
  instructionsAcknowledgedAt?: Date;

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
    required: false,
    min: 1
  },

  // Session Status
  status: {
    type: String,
    enum: ['active', 'completed'],
    default: 'active',
    required: true
  },
  attemptNumber: {
    type: Number,
    required: true,
    default: 1,
    min: 1
  },
  previousSessionId: {
    type: Schema.Types.ObjectId,
    ref: 'StudentLabSession',
    default: null
  },
  releaseReason: {
    type: String,
    enum: ['completion', 'restart', 'timeout', 'admin']
  },
  releasedAt: {
    type: Date
  },
  instructionsAcknowledged: {
    type: Boolean,
    default: false
  },
  instructionsAcknowledgedAt: {
    type: Date,
    required: false
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
studentLabSessionSchema.index({ studentId: 1, labId: 1, attemptNumber: 1 });

// Compound unique index: One active session per student per lab
// This also covers queries for { studentId: 1, labId: 1, status: 1 }
studentLabSessionSchema.index(
  { studentId: 1, labId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'active' }
  }
);

// Unique index for race condition prevention: No two active sessions can have the same IP
// Ensures atomic IP assignment at database level
studentLabSessionSchema.index(
  { labId: 1, managementIp: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'active' }
  }
);

export const StudentLabSession = model<IStudentLabSession>('StudentLabSession', studentLabSessionSchema);

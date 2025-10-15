import { Schema, model, Document, Types } from 'mongoose';

export interface ITestCaseResult {
  description: string;
  expected_value: any;
  actual_value: any;
  comparison_type: string;
  status: 'passed' | 'failed' | 'error';
  points_earned: number;
  points_possible: number;
  message: string;
}

export interface IDebugInfo {
  enabled: boolean;
  parameters_received?: Record<string, any>;
  registered_variables?: Record<string, any>;
  command_results?: Array<Record<string, any>>;
  validation_details?: Array<Record<string, any>>;
  custom_debug_points?: Record<string, any>;
}

export interface ITestResult {
  test_name: string;
  status: 'passed' | 'failed' | 'error';
  message: string;
  points_earned: number;
  points_possible: number;
  execution_time: number;
  test_case_results: ITestCaseResult[];
  extracted_data?: Record<string, any>;
  raw_output?: string;
  debug_info?: IDebugInfo;
  group_id?: string;
}

export interface IGroupResult {
  group_id: string;
  title: string;
  status: 'passed' | 'failed' | 'cancelled';
  group_type: string;
  points_earned: number;
  points_possible: number;
  execution_time: number;
  task_results: ITestResult[];
  message: string;
  rescue_executed: boolean;
  cleanup_executed: boolean;
}

export interface IGradingResult {
  job_id: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  total_points_earned: number;
  total_points_possible: number;
  test_results: ITestResult[];
  group_results: IGroupResult[];
  total_execution_time: number;
  error_message?: string;
  created_at: string;
  completed_at?: string;
  cancelled_reason?: string;
}

export interface IProgressUpdate {
  message: string;
  current_test?: string;
  tests_completed: number;
  total_tests: number;
  percentage: number;
  timestamp: Date;
}

export interface ISubmission extends Document {
  jobId: string;
  studentId: string;
  labId: Types.ObjectId;
  partId: string;
  
  // Submission Status
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  submittedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  
  // Grading Results
  gradingResult?: IGradingResult;
  
  // Progress Tracking
  progressHistory: IProgressUpdate[];
  
  // Additional metadata
  attempt: number;
  ipMappings: Record<string, string>;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

// Schema Definitions
const testCaseResultSchema = new Schema<ITestCaseResult>({
  description: { type: String, required: true },
  expected_value: { type: Schema.Types.Mixed, required: true },
  actual_value: { type: Schema.Types.Mixed, required: true },
  comparison_type: { type: String, required: true },
  status: { type: String, enum: ['passed', 'failed', 'error'], required: true },
  points_earned: { type: Number, required: true },
  points_possible: { type: Number, required: true },
  message: { type: String, required: true }
}, { _id: false });

const debugInfoSchema = new Schema<IDebugInfo>({
  enabled: { type: Boolean, default: false },
  parameters_received: { type: Schema.Types.Mixed },
  registered_variables: { type: Schema.Types.Mixed },
  command_results: [{ type: Schema.Types.Mixed }],
  validation_details: [{ type: Schema.Types.Mixed }],
  custom_debug_points: { type: Schema.Types.Mixed }
}, { _id: false });

const testResultSchema = new Schema<ITestResult>({
  test_name: { type: String, required: true },
  status: { type: String, enum: ['passed', 'failed', 'error'], required: true },
  message: { type: String, required: true },
  points_earned: { type: Number, required: true },
  points_possible: { type: Number, required: true },
  execution_time: { type: Number, required: true },
  test_case_results: [testCaseResultSchema],
  extracted_data: { type: Schema.Types.Mixed },
  raw_output: { type: String, default: '' },
  debug_info: debugInfoSchema,
  group_id: { type: String }
}, { _id: false });

const groupResultSchema = new Schema<IGroupResult>({
  group_id: { type: String, required: true },
  title: { type: String, required: true },
  status: { type: String, enum: ['passed', 'failed', 'cancelled'], required: true },
  group_type: { type: String, required: true },
  points_earned: { type: Number, required: true },
  points_possible: { type: Number, required: true },
  execution_time: { type: Number, required: true },
  task_results: [testResultSchema],
  message: { type: String, required: true },
  rescue_executed: { type: Boolean, default: false },
  cleanup_executed: { type: Boolean, default: false }
}, { _id: false });

const gradingResultSchema = new Schema<IGradingResult>({
  job_id: { type: String, required: true },
  status: { type: String, enum: ['running', 'completed', 'failed', 'cancelled'], required: true },
  total_points_earned: { type: Number, required: true },
  total_points_possible: { type: Number, required: true },
  test_results: [testResultSchema],
  group_results: [groupResultSchema],
  total_execution_time: { type: Number, required: true },
  error_message: { type: String, default: '' },
  created_at: { type: String, required: true },
  completed_at: { type: String },
  cancelled_reason: { type: String }
}, { _id: false });

const progressUpdateSchema = new Schema<IProgressUpdate>({
  message: { type: String, required: true },
  current_test: { type: String, default: '' },
  tests_completed: { type: Number, required: true },
  total_tests: { type: Number, required: true },
  percentage: { type: Number, required: true },
  timestamp: { type: Date, required: true, default: Date.now }
}, { _id: false });

const submissionSchema = new Schema<ISubmission>({
  jobId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  studentId: {
    type: String,
    required: true,
  },
  labId: {
    type: Schema.Types.ObjectId,
    required: true,
    ref: 'Lab'
  },
  partId: {
    type: String,
    required: true
  },
  
  // Submission Status
  status: {
    type: String,
    enum: ['pending', 'running', 'completed', 'failed', 'cancelled'],
    default: 'pending',
    index: true
  },
  submittedAt: {
    type: Date,
    required: true,
    default: Date.now
  },
  startedAt: {
    type: Date
  },
  completedAt: {
    type: Date
  },
  
  // Grading Results
  gradingResult: gradingResultSchema,
  
  // Progress Tracking
  progressHistory: [progressUpdateSchema],
  
  // Additional metadata
  attempt: {
    type: Number,
    required: true,
    default: 1
  },
  ipMappings: {
    type: Schema.Types.Mixed,
    required: true
  }
}, {
  timestamps: true
});

// Indexes for efficient querying
submissionSchema.index({ studentId: 1, labId: 1, partId: 1 });
submissionSchema.index({ studentId: 1, status: 1 });
submissionSchema.index({ labId: 1, status: 1 });
submissionSchema.index({ submittedAt: -1 });
submissionSchema.index({ 'gradingResult.status': 1 });

export const Submission = model<ISubmission>('Submission', submissionSchema);
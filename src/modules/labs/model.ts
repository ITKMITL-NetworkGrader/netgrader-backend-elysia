// models/Lab.ts
import { Schema, model, Document, Types } from "mongoose";

/**
 * IP Variable Mapping
 */
export interface IIpVariableMapping {
  [deviceName: string]: string; // device name to IP variable name
}

/**
 * IP Schema definition
 */
export interface IIpSchema {
  [variableName: string]: string; // variable name to IP address
}

/**
 * Device IP Mapping
 */
export interface IDeviceIpMapping {
  [deviceName: string]: string; // device name to IP address
}

/**
 * Test case definition for scoring
 */
export interface ITestCase {
  description: string;
  comparison_type: string; // equals, contains, regex, success, etc.
  expected_result: any;
}

/**
 * Ansible task definition
 */
export interface IAnsibleTask {
  task_id?: string; // Make optional for auto-generation
  name: string;
  template_name: string; // Reference to MinIO template
  parameters: Record<string, any>;
  test_cases: ITestCase[];
  points: number;
}

/**
 * Play definition (embedded in LabPart)
 */
export interface IPlay {
  play_id?: string; // Make optional for auto-generation
  name: string;
  description: string;
  source_device: string;
  target_device: string;
  total_points: number;
  ansible_tasks: IAnsibleTask[];
}

/**
 * LabPart definition
 */
export interface LabPart {
  part_id?: string; // Make optional for auto-generation
  title: string;
  textMd: string;
  order: number;
  total_points: number;
  plays: IPlay[];
}

/**
 * Lab document interface
 */
export interface Lab extends Document {
  id: string;
  title: string;
  description: string;
  type?: 'lab' | 'exam';
  ipSchema?: IIpSchema;
  deviceIpMapping?: IDeviceIpMapping;
  parts: LabPart[];
  courseId: string;
  groupsRequired: boolean;
  createdBy: string; // userId
  createdAt: Date;
  updatedAt: Date;
}

// TestCase Schema
const TestCaseSchema = new Schema<ITestCase>(
  {
    description: { type: String },
    comparison_type: { type: String, required: true },
    expected_result: { type: Schema.Types.Mixed, required: true },
  },
  { _id: false }
);

// AnsibleTask Schema
const AnsibleTaskSchema = new Schema<IAnsibleTask>(
  {
    task_id: { type: String }, // Make optional, will be auto-generated
    name: { type: String, required: true },
    template_name: { type: String, required: true },
    parameters: { type: Schema.Types.Mixed, default: {} },
    test_cases: { type: [TestCaseSchema], default: [] },
    points: { type: Number, required: true },
  },
  { _id: false }
);

// Play Schema
const PlaySchema = new Schema<IPlay>(
  {
    play_id: { type: String }, // Make optional, will be auto-generated
    name: { type: String, required: true },
    description: { type: String },
    source_device: { type: String, required: true },
    target_device: { type: String, required: true },
    total_points: { type: Number, required: true },
    ansible_tasks: { type: [AnsibleTaskSchema], default: [] },
  },
  { _id: false }
);

// LabPart Schema
const LabPartSchema = new Schema<LabPart>(
  {
    part_id: { type: String }, // Make optional, will be auto-generated
    title: { type: String, required: true },
    textMd: { type: String },
    order: { type: Number, required: true },
    total_points: { type: Number, required: true },
    plays: { type: [PlaySchema], default: [] },
  },
  { _id: false }
);

// Lab Schema
const LabSchema = new Schema<Lab>(
  {
    title: { type: String, required: true },
    description: { type: String },
    type: { type: String, enum: ['lab', 'exam'] },
    ipSchema: { type: Schema.Types.Mixed },
    deviceIpMapping: { type: Schema.Types.Mixed },
    parts: { type: [LabPartSchema], default: [] },
    courseId: { type: String, required: true },
    groupsRequired: { type: Boolean, default: false },
    createdBy: { type: String, required: true },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" } }
);

// Indexes for search
LabSchema.index({ title: 1 });
LabSchema.index({ courseId: 1 });
LabSchema.index({ createdBy: 1 });

export const LabModel = model<Lab>("Lab", LabSchema);
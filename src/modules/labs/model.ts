// models/Lab.ts
import { Schema, model, Document, Types } from "mongoose";

/**
 * IP Variable Mapping for defining IP allocation variables
 */
export interface IIpVariableMapping {
  name: string;
  hostOffset: number;
  example?: string;
}

/**
 * IP Schema definition for network configuration
 */
export interface IIpSchema {
  scope: 'lab' | 'part';
  baseNetwork: string;
  subnetMask: number;
  allocationStrategy: 'group_based' | 'student_id_based';
  reservedSubnets?: string[];
  variablesMapping: IIpVariableMapping[];
}

/**
 * Device IP Mapping
 */
export interface IDeviceIpMapping {
  deviceId: string;
  ipVariable: string;
}

/**
 * Device credentials definition
 */
export interface IDeviceCredentials {
  ansible_user: string;
  ansible_password: string;
}

/**
 * Device configuration definition
 */
export interface IDevice {
  id: string;
  ip_address: string;
  ansible_connection: string;
  credentials: IDeviceCredentials;
  platform?: string | null;
  jump_host?: string | null;
  ssh_args?: string | null;
  use_persistent_connection: boolean;
}

/**
 * Test case definition for scoring
 */
export interface ITestCase {
  description?: string;
  comparison_type: 'equals' | 'contains' | 'regex' | 'success' | 'ssh_success' | 'greater_than';
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
  source_device: string;
  target_device: string;
  ansible_tasks: IAnsibleTask[];
}

/**
 * LabPart definition
 */
export interface ILabPart {
  part_id?: string; // Make optional for auto-generation
  title: string;
  textMd: string;
  order: number;
  total_points: number;
  ipSchema?: IIpSchema;
  play: IPlay;
}

/**
 * Lab document interface
 */
export interface ILab extends Document {
  id: string;
  title: string;
  description: string;
  type?: 'lab' | 'exam';
  ipSchema?: IIpSchema;
  deviceIpMapping?: IDeviceIpMapping[];
  devices?: IDevice[];
  parts: ILabPart[];
  courseId: string;
  groupsRequired: boolean;
  createdBy: string; // userId
  createdAt: Date;
  updatedAt: Date;
}

// Device Credentials Schema
const DeviceCredentialsSchema = new Schema<IDeviceCredentials>(
  {
    ansible_user: { type: String, required: true },
    ansible_password: { type: String, required: true },
  },
  { _id: false }
);

// Device Schema
const DeviceSchema = new Schema<IDevice>(
  {
    id: { type: String, required: true },
    ip_address: { type: String, required: true },
    ansible_connection: { type: String, required: true },
    credentials: { type: DeviceCredentialsSchema, required: true },
    platform: { type: String, default: null },
    jump_host: { type: String, default: null },
    ssh_args: { type: String, default: null },
    use_persistent_connection: { type: Boolean, default: false },
  },
  { _id: false }
);

// IP Variable Mapping Schema
const IpVariableMappingSchema = new Schema<IIpVariableMapping>(
  {
    name: { type: String, required: true },
    hostOffset: { type: Number, required: true },
    example: { type: String },
  },
  { _id: false }
);

// IP Schema
const IpConfigSchema = new Schema<IIpSchema>(
  {
    scope: { type: String, enum: ['lab', 'part'], required: true },
    baseNetwork: { type: String, required: true },
    subnetMask: { type: Number, required: true },
    allocationStrategy: { type: String, enum: ['group_based', 'student_id_based'], required: true },
    reservedSubnets: { type: [String] },
    variablesMapping: { type: [IpVariableMappingSchema], required: true },
  },
  { _id: false }
);

// Device IP Mapping Schema
const DeviceIpMappingSchema = new Schema<IDeviceIpMapping>(
  {
    deviceId: { type: String, required: true },
    ipVariable: { type: String, required: true },
  },
  { _id: false }
);

// TestCase Schema
const TestCaseSchema = new Schema<ITestCase>(
  {
    description: { type: String },
    comparison_type: { type: String, enum: ['equals', 'contains', 'regex', 'success', 'ssh_success', 'greater_than'], required: true },
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
    source_device: { type: String, required: true },
    target_device: { type: String, required: true },
    ansible_tasks: { type: [AnsibleTaskSchema], default: [] },
  },
  { _id: false }
);

// LabPart Schema
const LabPartSchema = new Schema<ILabPart>(
  {
    part_id: { type: String }, // Make optional, will be auto-generated
    title: { type: String, required: true },
    textMd: { type: String },
    order: { type: Number, required: true },
    total_points: { type: Number, required: true },
    ipSchema: { type: IpConfigSchema },
    play: { type: PlaySchema, required: true },
  },
  { _id: false }
);

// Lab Schema
const LabSchema = new Schema<ILab>(
  {
    title: { type: String, required: true },
    description: { type: String },
    type: { type: String, enum: ['lab', 'exam'] },
    ipSchema: { type: IpConfigSchema },
    deviceIpMapping: { type: [DeviceIpMappingSchema] },
    devices: { type: [DeviceSchema] },
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

export const LabModel = model<ILab>("Lab", LabSchema);
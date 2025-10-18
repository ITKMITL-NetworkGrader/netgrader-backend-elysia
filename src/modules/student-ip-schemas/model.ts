import { Schema, model, Document, Types } from 'mongoose';

// @ts-expect-error - Mongoose Document interface conflict with nested schema objects
export interface IStudentIpSchema extends Document {
  studentId: Types.ObjectId;      // Ref: users._id
  labId: Types.ObjectId;          // Ref: labs._id

  // The actual IP schema (student-managed)
  schema: {
    // VLAN-level schema
    vlans: Array<{
      vlanIndex: number;           // Which VLAN (0-9)
      networkAddress: string;      // e.g., "172.16.40.128"
      subnetMask: number;          // CIDR prefix (e.g., 27)
      subnetIndex: number;         // Which subnet block (0, 1, 2...)
      firstUsableIp: string;       // e.g., "172.16.40.129"
      lastUsableIp: string;        // e.g., "172.16.40.158"
      broadcastAddress: string;    // e.g., "172.16.40.159"

      // Metadata
      source: 'calculated' | 'student_updated';
      updatedAt: Date;
    }>;

    // Device-level IP assignments
    devices: Array<{
      deviceId: string;            // e.g., "router1"
      interfaces: Array<{
        variableName: string;      // e.g., "gig0_0_vlan_1", "e0_0"
        ipAddress: string;         // e.g., "172.16.40.129"
        subnetMask?: string;       // e.g., "255.255.255.224" (optional)

        // Track how this IP was determined
        source: 'calculated' | 'dhcp' | 'manual_update';
        updatedAt: Date;
        updatedBy: 'initial_calculation' | 'student_update';
      }>;
    }>;
  };

  // Versioning for audit trail
  version: number;                 // Increments on each update (no max)
  previousVersionId?: Types.ObjectId; // Link to previous version

  // Metadata
  calculationPartId?: Types.ObjectId;  // Which part created this
  isLocked: boolean;               // Always false (no locking per requirements)

  createdAt: Date;
  updatedAt: Date;
}

const studentIpSchemaSchema = new Schema<IStudentIpSchema>({
  studentId: {
    type: Schema.Types.ObjectId,
    required: true,
    ref: 'User',
    index: true
  },
  labId: {
    type: Schema.Types.ObjectId,
    required: true,
    ref: 'Lab',
    index: true
  },
  schema: {
    type: {
      vlans: [{
        _id: false,
        vlanIndex: { type: Number, required: true, min: 0, max: 9 },
        networkAddress: { type: String, required: true },
        subnetMask: { type: Number, required: true, min: 1, max: 32 },
        subnetIndex: { type: Number, required: true, min: 0 },
        firstUsableIp: { type: String, required: true },
        lastUsableIp: { type: String, required: true },
        broadcastAddress: { type: String, required: true },
        source: {
          type: String,
          enum: ['calculated', 'student_updated'],
          required: true
        },
        updatedAt: { type: Date, required: true }
      }],
      devices: [{
        _id: false,
        deviceId: { type: String, required: true },
        interfaces: [{
          _id: false,
          variableName: { type: String, required: true },
          ipAddress: { type: String, required: true },
          subnetMask: { type: String, required: false },
          source: {
            type: String,
            enum: ['calculated', 'dhcp', 'manual_update'],
            required: true
          },
          updatedAt: { type: Date, required: true },
          updatedBy: {
            type: String,
            enum: ['initial_calculation', 'student_update'],
            required: true
          }
        }]
      }]
    },
    required: true
  },
  version: {
    type: Number,
    required: true,
    default: 1,
    min: 1
  },
  previousVersionId: {
    type: Schema.Types.ObjectId,
    required: false,
    ref: 'StudentIpSchema'
  },
  calculationPartId: {
    type: Schema.Types.ObjectId,
    required: false,
    ref: 'LabPart'
  },
  isLocked: {
    type: Boolean,
    required: true,
    default: false  // Always false per requirements
  }
}, {
  timestamps: true,
  collection: 'student_ip_schemas'
});

// Indexes for performance
studentIpSchemaSchema.index({ studentId: 1, labId: 1 });
studentIpSchemaSchema.index({ labId: 1, version: -1 });
studentIpSchemaSchema.index({ studentId: 1, labId: 1, version: -1 });

export const StudentIpSchema = model<IStudentIpSchema>('StudentIpSchema', studentIpSchemaSchema);

import { Schema, model, Document, Types } from 'mongoose';

export interface ILab extends Document {
  courseId: Types.ObjectId;      // Ref: courses._id
  title: string;
  description?: string;
  type: 'lab' | 'exam';
  
  // Embedded Network Configuration (frequently co-accessed)
  network: {
    name: string;
    topology: {
      baseNetwork: string;     // "10.30.6.0"
      subnetMask: number;      // 24
      allocationStrategy: 'student_id_based' | 'group_based';
    };
    devices: Array<{
      deviceId: string;        // "router1", "pc1"
      templateId: Types.ObjectId;    // Ref: templates._id
      displayName: string;     // "Router 1"
      ipVariables: Array<{
        name: string;          // "mgmt_ip", "lan_ip"
        hostOffset: number;    // 1, 10, 254
        interface?: string;    // "eth0", "g0/1"
        fullIp?: string;       // Full IP address if defined, bypasses hostOffset calculation
      }>;
      credentials: {
        usernameTemplate: string;
        passwordTemplate: string;
        enablePassword?: string;
      };
    }>;
  };
  
  // Metadata
  createdBy: Types.ObjectId;         // Ref: users._id
  publishedAt?: Date;
  dueDate?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const labSchema = new Schema<ILab>({
  courseId: {
    type: Schema.Types.ObjectId,
    required: true,
    ref: 'Course'
  },
  title: {
    type: String,
    required: true,
    maxlength: 200,
    trim: true
  },
  description: {
    type: String,
    required: false,
    maxlength: 2000,
    trim: true
  },
  type: {
    type: String,
    required: true,
    enum: ['lab', 'exam'],
    default: 'lab'
  },
  
  // Embedded Network Configuration
  network: {
    name: {
      type: String,
      required: true
    },
    topology: {
      baseNetwork: {
        type: String,
        required: true
      },
      subnetMask: {
        type: Number,
        required: true
      },
      allocationStrategy: {
        type: String,
        enum: ['student_id_based', 'group_based'],
        required: true
      }
    },
    devices: [{
      _id: false,
      deviceId: {
        type: String,
        required: true
      },
      templateId: {
        type: Schema.Types.ObjectId,
        required: true,
        ref: 'Template'
      },
      displayName: {
        type: String,
        required: true
      },
      ipVariables: [{
        _id: false,
        name: {
          type: String,
          required: true
        },
        hostOffset: {
          type: Number,
          required: true
        },
        interface: {
          type: String,
          required: false
        },
        fullIp: {
          type: String,
          required: false
        }
      }],
      credentials: {
        usernameTemplate: {
          type: String,
          required: true
        },
        passwordTemplate: {
          type: String,
          required: true
        },
        enablePassword: {
          type: String,
          required: false
        }
      }
    }]
  },
  
  // Metadata
  createdBy: {
    type: Schema.Types.ObjectId,
    required: true,
    ref: 'User'
  },
  publishedAt: {
    type: Date,
    required: false
  },
  dueDate: {
    type: Date,
    required: false
  }
}, {
  timestamps: true
});

// Indexes as specified in implementation guide
labSchema.index({ courseId: 1, publishedAt: -1 }); // course lab listing
labSchema.index({ createdBy: 1, type: 1 });        // instructor management
labSchema.index({ 'network.devices.templateId': 1 }); // template usage tracking

export const Lab = model<ILab>('Lab', labSchema);
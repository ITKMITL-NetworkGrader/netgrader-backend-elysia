import { Schema, model, Document, Types } from 'mongoose';

export interface ILabPart extends Document {
  labId: Types.ObjectId;         // Ref: labs._id
  partId: string;          // Human-readable ID within lab
  title: string;
  description?: string;    // Markdown content
  instructions: string;    // Student instructions (Markdown)
  order: number;           // Display sequence
  
  // Embedded Tasks (1-10 per part typically)
  tasks: Array<{
    taskId: string;        // Unique within part
    name: string;
    description?: string;
    templateId: Types.ObjectId;  // Ref: templates._id
    
    // Execution Configuration
    executionDevice: string;     // Device ID from lab.network.devices
    targetDevices: string[];     // Device IDs for multi-device tasks
    
    // Task Parameters (passed to Ansible template)
    parameters: Record<string, any>;
    
    // Grading Configuration
    testCases: Array<{
      name: string;
      condition: string;         // Ansible condition
      points: number;
      weight: number;
      timeoutSeconds: number;
    }>;
    
    order: number;
    points: number;              // Total points for task
  }>;
  task_groups: Array<{
    group_id: string;
    title: string;
    description?: string;
    group_type: "all_or_nothing" | "proportional";
    points: number;
    continue_on_failure: boolean;
    timeout_seconds: number;
  }>;
  
  // Part Configuration
  prerequisites: string[];       // Part IDs that must be completed first
  totalPoints: number;          // Sum of task points  
  createdAt: Date;
  updatedAt: Date;
}

const labPartSchema = new Schema<ILabPart>({
  labId: {
    type: Schema.Types.ObjectId,
    required: true,
    ref: 'Lab'
  },
  partId: {
    type: String,
    required: true
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
  instructions: {
    type: String,
    required: true,
    maxlength: 10000
  },
  order: {
    type: Number,
    required: true,
    min: 1
  },
  
  // Embedded Tasks
  tasks: [{
    taskId: {
      type: String,
      required: true
    },
    name: {
      type: String,
      required: true
    },
    description: {
      type: String,
      required: false
    },
    templateId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: 'Template'
    },
    
    // Execution Configuration
    executionDevice: {
      type: String,
      required: true
    },
    targetDevices: [{
      type: String
    }],
    
    // Task Parameters
    parameters: {
      type: Schema.Types.Mixed,
      required: true,
      default: {}
    },
    
    // Grading Configuration
    testCases: [{
      name: {
        type: String,
        required: true
      },
      condition: {
        type: String,
        required: true
      },
      points: {
        type: Number,
        required: true
      },
      weight: {
        type: Number,
        required: true
      },
      timeoutSeconds: {
        type: Number,
        required: true
      }
    }],
    
    order: {
      type: Number,
      required: true
    },
    points: {
      type: Number,
      required: true
    }
  }],
  
  task_groups: [{
    group_id: {
      type: String,
      required: true
    },
    title: {
      type: String,
      required: true
    },
    description: {
      type: String,
      required: false
    },
    group_type: {
      type: String,
      enum: ["all_or_nothing", "proportional"],
      required: true
    },
    points: {
      type: Number,
      required: true
    },
    continue_on_failure: {
      type: Boolean,
      required: true
    },
    timeout_seconds: {
      type: Number,
      required: true
    }
  }],
  
  // Part Configuration
  prerequisites: {
    type: [String],
    required: false,
    default: []
  },
  totalPoints: {
    type: Number,
    required: true,
    min: 0
  }
}, {
  timestamps: true
});

// Indexes as specified in implementation guide
labPartSchema.index({ labId: 1, order: 1 });              // lab part sequence
labPartSchema.index({ labId: 1, partId: 1 });             // unique part identification
labPartSchema.index({ 'tasks.templateId': 1 });           // template usage

export const LabPart = model<ILabPart>('LabPart', labPartSchema, 'lab_parts');
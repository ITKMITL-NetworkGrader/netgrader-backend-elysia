import { Schema, model, Document, Types } from 'mongoose';
import { RichContent } from '../../utils/rich-content';

export interface ILabPart extends Document {
  labId: Types.ObjectId;         // Ref: labs._id
  partId: string;          // Human-readable ID within lab
  title: string;
  description?: string;    // Markdown content
  instructions: RichContent;    // Student instructions with TipTap JSON
  order: number;           // Display sequence
  
  // Embedded Tasks (1-10 per part typically)
  tasks: Array<{
    taskId: string;        // Unique within part
    name: string;
    description?: string;
    templateId: Types.ObjectId;  // Ref: templates._id
    group_id?: string; // Optional grouping for grading
    // Execution Configuration
    executionDevice: string;     // Device ID from lab.network.devices
    targetDevices: string[];     // Device IDs for multi-device tasks
    
    // Task Parameters (passed to Ansible template)
    parameters: Record<string, any>;
    
    // Grading Configuration
    testCases: Array<{
      comparison_type: string;  // Type of comparison: equals, contains, regex, success, ssh_success, greater_than
      expected_result: any;     // Expected value/result for comparison 
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
  metadata: {
    wordCount: number;
    estimatedReadingTime: number;
    lastModified: Date;
    version: number;
    autoSave?: {
      timestamp: Date;
      [field: string]: RichContent | Date;
    };
  };
  assets?: Array<{
    id: string;
    url: string;
    type: string;
    size: number;
    uploadedAt: Date;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

const RichContentSchema = new Schema({
  html: { type: String, required: true },
  json: { type: Schema.Types.Mixed, required: true },
  plainText: { type: String, required: true },
  metadata: {
    wordCount: { type: Number, required: true },
    characterCount: { type: Number, required: true },
    estimatedReadingTime: { type: Number, required: true },
    lastModified: { type: Date, required: true },
    hasImages: { type: Boolean, required: true },
    hasCodeBlocks: { type: Boolean, required: true },
    headingStructure: [{
      _id: false,
      level: { type: Number, required: true },
      text: { type: String, required: true },
      id: { type: String, required: true }
    }]
  }
}, { _id: false });

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
    type: RichContentSchema,
    required: true
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
      required: false,
      default: ""
    },
    templateId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: 'Template'
    },
    group_id: {
      type: String,
      required: false
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
      comparison_type: {
        type: String,
        required: true
      },
      expected_result: {
        type: Schema.Types.Mixed,
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
      required: false,
      default: ""
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
  },
  metadata: {
    wordCount: { type: Number, required: true },
    estimatedReadingTime: { type: Number, required: true },
    lastModified: { type: Date, required: true },
    version: { type: Number, required: true, default: 1 },
    autoSave: {
      type: Schema.Types.Mixed,
      required: false
    }
  },
  assets: [{
    _id: false,
    id: { type: String, required: true },
    url: { type: String, required: true },
    type: { type: String, required: true },
    size: { type: Number, required: true },
    uploadedAt: { type: Date, required: true }
  }]
}, {
  timestamps: true
});

// Indexes as specified in implementation guide
labPartSchema.index({ labId: 1, order: 1 });              // lab part sequence
labPartSchema.index({ labId: 1, partId: 1 }, { unique: true }); // unique part identification
labPartSchema.index({ 'tasks.templateId': 1 });           // template usage
labPartSchema.index({ 'tasks.group_id': 1 });             // task group queries
labPartSchema.index({ 'metadata.lastModified': -1 });     // recent updates

export const LabPart = model<ILabPart>('LabPart', labPartSchema, 'lab_parts');
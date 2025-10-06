import { Schema, model, Document, Types } from 'mongoose';

export interface ITaskTemplate extends Document {
  templateId?: string;      // Unique identifier (e.g., "cisco_ospf_basic")
  name: string;            // Display name
  
  // Template Content
  description: string;     // What this template does
  
  // Parameter Validation
  parameterSchema: Array<{
    name: string;
    type: 'string' | 'number' | 'boolean' | 'ip_address' | string;  // Added ip_address type for IP parameter feature
    description?: string;
    required: boolean;
  }>;
  
  // Default Test Cases
  defaultTestCases: Array<{
    comparison_type: string;          // "Type of comparison: equals, contains, regex, success, ssh_success, greater_than"
    expected_result: any;     // Expected value/result for comparison
  }>;
  createdAt: Date;
  updatedAt: Date;
}

const taskTemplateSchema = new Schema<ITaskTemplate>({
  templateId: {
    type: String,
    required: true,
    trim: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  parameterSchema: [{
    name: {
      type: String,
      required: true
    },
    type: {
      type: String,
      required: true
    },
    description: {
      type: String,
      required: false
    },
    required: {
      type: Boolean,
      required: true
    }
  }],
  defaultTestCases: [{
    comparison_type: {
      type: String,
      required: true
    },
    expected_result: {
      type: Schema.Types.Mixed,
      required: true
    }
  }]
}, {
  timestamps: true
});

// Indexes as specified in implementation guide
taskTemplateSchema.path('parameterSchema').schema.set('_id', false);
taskTemplateSchema.path('defaultTestCases').schema.set('_id', false);
taskTemplateSchema.index({ templateId: 1 }, { unique: true }); // unique

export const TaskTemplate = model<ITaskTemplate>('TaskTemplate', taskTemplateSchema, 'task_templates');
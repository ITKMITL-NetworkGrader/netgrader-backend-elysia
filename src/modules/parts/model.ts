import { Schema, model, Document, Types } from 'mongoose';
import { RichContent } from '../../utils/rich-content';

export interface ILabPart extends Document {
  labId: Types.ObjectId;         // Ref: labs._id
  partId: string;          // Human-readable ID within lab
  title: string;
  description?: string;    // Markdown content
  instructions: RichContent;    // Student instructions with TipTap JSON
  order: number;           // Display sequence

  // Part type determines which fields are required
  partType: 'fill_in_blank' | 'network_config' | 'dhcp_config';

  // For fill-in-the-blank parts (IP calculation tables)
  questions?: Array<{
    questionId: string;
    questionText: string;
    questionType: 'network_address' | 'first_usable_ip' | 'last_usable_ip' |
                  'broadcast_address' | 'subnet_mask' | 'ip_address' | 'number' |
                  'custom_text' | 'ip_table_questionnaire';
    order: number;
    points: number;

    // IP Table Questionnaire (ONLY for 'ip_table_questionnaire' type)
    ipTableQuestionnaire?: {
      tableId: string;
      rowCount: number;            // 1-10 rows
      columnCount: number;         // 1-10 columns
      autoCalculate: boolean;

      columns: Array<{
        columnId: string;
        label: string;             // Column label (e.g., "IPv4 Address", "Subnet Mask")
        order: number;
      }>;

      rows: Array<{
        rowId: string;
        deviceId: string;
        interfaceName: string;
        displayName: string;
        order: number;
      }>;

      cells: Array<Array<{
        cellId: string;
        rowId: string;
        columnId: string;

        // Answer type: static or calculated (range vs exact determined by calculationType)
        answerType: 'static' | 'calculated';

        // For static answers (e.g., DNS "8.8.8.8")
        staticAnswer?: string;

        // For calculated answers (exact or range)
        calculatedAnswer?: {
          calculationType: 'vlan_network_address' | 'vlan_first_usable' |
                          'vlan_last_usable' | 'vlan_broadcast' | 'vlan_subnet_mask' |
                          'vlan_lecturer_offset' | 'vlan_lecturer_range' |
                          'device_interface_ip' | 'vlan_id';
          vlanIndex?: number;              // Which VLAN (0-9)
          lecturerOffset?: number;         // For exact offset
          lecturerRangeStart?: number;     // For range start
          lecturerRangeEnd?: number;       // For range end
          deviceId?: string;               // For device interface IPs
          interfaceName?: string;          // For device interface IPs
        };

        points: number;
        autoCalculated: boolean;
      }>>;  // 2D array: cells[rowIndex][columnIndex]
    };
  }>;

  // Embedded Tasks (1-10 per part typically) - ONLY for network_config parts
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

  // For DHCP configuration parts
  dhcpConfiguration?: {
    vlanIndex: number;
    startOffset: number;
    endOffset: number;
    dhcpServerDevice: string;
  };

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

  // Part type
  partType: {
    type: String,
    enum: ['fill_in_blank', 'network_config', 'dhcp_config'],
    required: true,
    default: 'network_config'
  },

  // Questions for fill_in_blank parts
  questions: [{
    questionId: { type: String, required: true },
    questionText: { type: String, required: true },
    questionType: {
      type: String,
      enum: ['network_address', 'first_usable_ip', 'last_usable_ip',
             'broadcast_address', 'subnet_mask', 'ip_address', 'number',
             'custom_text', 'ip_table_questionnaire'],
      required: true
    },
    order: { type: Number, required: true },
    points: { type: Number, required: true, min: 0 },

    // IP Table Questionnaire
    ipTableQuestionnaire: {
      type: {
        tableId: { type: String, required: true },
        rowCount: { type: Number, required: true, min: 1, max: 10 },
        columnCount: { type: Number, required: true, min: 1, max: 10 },
        autoCalculate: { type: Boolean, required: true },

        columns: [{
          _id: false,
          columnId: { type: String, required: true },
          label: { type: String, required: true },
          order: { type: Number, required: true }
        }],

        rows: [{
          _id: false,
          rowId: { type: String, required: true },
          deviceId: { type: String, required: true },
          interfaceName: { type: String, required: true },
          displayName: { type: String, required: true },
          order: { type: Number, required: true }
        }],

        cells: {
          type: [[{
            _id: false,
            cellId: { type: String, required: true },
            rowId: { type: String, required: true },
            columnId: { type: String, required: true },

            answerType: {
              type: String,
              enum: ['static', 'calculated'],
              required: true
            },

            staticAnswer: { type: String },

            calculatedAnswer: {
              type: {
                _id: false,
                calculationType: {
                  type: String,
                  enum: ['vlan_network_address', 'vlan_first_usable', 'vlan_last_usable',
                         'vlan_broadcast', 'vlan_subnet_mask', 'vlan_lecturer_offset',
                         'vlan_lecturer_range', 'device_interface_ip', 'vlan_id']
                },
                vlanIndex: { type: Number, min: 0, max: 9 },
                lecturerOffset: { type: Number, min: 1, max: 254 },
                lecturerRangeStart: { type: Number, min: 1, max: 254 },
                lecturerRangeEnd: { type: Number, min: 1, max: 254 },
                deviceId: { type: String },
                interfaceName: { type: String }
              },
              _id: false
            },

            points: { type: Number, required: true, min: 0 },
            autoCalculated: { type: Boolean, required: true }
          }]],
          required: true
        }
      },
      _id: false,
      required: false
    }
  }],

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

  // DHCP Configuration (for dhcp_config parts)
  dhcpConfiguration: {
    type: {
      _id: false,
      vlanIndex: { type: Number, required: true, min: 0, max: 9 },
      startOffset: { type: Number, required: true, min: 1, max: 254 },
      endOffset: { type: Number, required: true, min: 1, max: 254 },
      dhcpServerDevice: { type: String, required: true }
    },
    required: false
  },

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
import { Schema, model, Document, Types } from 'mongoose';
import { RichContent } from '../../utils/rich-content';

export interface ILab extends Document {
  courseId: Types.ObjectId;      // Ref: courses._id
  title: string;
  description?: string;
  type: 'lab' | 'exam';
  instructions?: RichContent;

  // Embedded Network Configuration (frequently co-accessed)
  network: {
    name: string;
    topology: {
      baseNetwork: string;     // "10.0.0.0" - Management network
      subnetMask: number;      // 24
      allocationStrategy: 'student_id_based' | 'group_based';
      exemptIpRanges?: Array<{
        start: string;         // IPv4 address (e.g., "10.0.0.1")
        end?: string;          // Optional: IPv4 address for range end
      }>;
    };
    // VLAN Configuration for multi-phase VLAN system
    vlanConfiguration?: {
      mode: 'fixed_vlan' | 'lecturer_group' | 'calculated_vlan' | 'large_subnet';
      vlanCount: number;       // 1-10
      vlans: Array<{
        id: string;            // UUID from frontend
        vlanId?: number;       // For fixed_vlan & lecturer_group (1-4094)
        calculationMultiplier?: number;  // For calculated_vlan mode
        baseNetwork: string;   // e.g., "172.16.0.0"
        subnetMask: number;    // 8-30
        subnetIndex: number;   // Which subnet block to use (0-based, e.g., 0=first, 1=second)
        groupModifier?: number; // For lecturer_group mode
        isStudentGenerated: boolean;
        // IPv6 Configuration per VLAN
        ipv6Enabled?: boolean;         // Whether IPv6 is enabled for this VLAN
        ipv6VlanAlphabet?: string;     // A, B, C, etc. (auto-assigned based on VLAN index)
        ipv6SubnetId?: string;         // Custom subnet ID for template (e.g., "141")
      }>;
      // Large Subnet Mode Configuration (for subnet calculation exercises)
      largeSubnetConfig?: {
        privateNetworkPool: '10.0.0.0/8' | '172.16.0.0/12' | '192.168.0.0/16';
        studentSubnetSize: number;   // e.g., 23 for /23
        subVlans: Array<{
          id: string;                  // UUID
          name: string;                // e.g., "Sales VLAN"
          subnetSize: number;          // e.g., 26 for /26
          subnetIndex: number;         // Which subnet block within the large subnet (1-based)
          vlanIdRandomized: boolean;   // true = random 2-4096, false = fixed
          fixedVlanId?: number;        // Only if vlanIdRandomized = false
        }>;
      };
    };
    // IPv6 Template Configuration
    ipv6Config?: {
      enabled: boolean;                // Master toggle for IPv6
      template: string;                // e.g., "2001:{X}:{Y}:{VLAN}::{offset}/64"
      managementTemplate?: string;     // e.g., "2001:{X}:{Y}:306::{offset}/64"
      presetName?: 'standard_exam' | 'university_network' | 'simple_lab' | 'custom';
      // Enhanced configurable prefix support
      globalPrefix?: string;           // e.g., "2001:3c8:1106:4" - base prefix for all addresses
      prefixMode?: 'template' | 'structured'; // 'template' = use template string, 'structured' = use globalPrefix + X/Y
      // Management Network Override (for firewall traversal / Internet access)
      managementOverride?: {
        enabled: boolean;              // Whether management uses a special fixed format
        fixedPrefix: string;           // e.g., "2001:3c8:1106:4306"
        useStudentIdSuffix: boolean;   // Whether to use last 3 digits as interface ID suffix
      };
    };
    devices: Array<{
      deviceId: string;        // "router1", "pc1"
      templateId: Types.ObjectId;    // Ref: templates._id
      displayName: string;     // "Router 1"
      ipVariables: Array<{
        name: string;          // "mgmt_interface", "gig0_0_vlan_1"
        interface?: string;    // "GigabitEthernet0/0", "eth0"

        // Input type system - defines how IPv4 is determined
        inputType: 'none' | 'fullIP' | 'studentManagement' | 'studentVlan0' | 'studentVlan1' | 'studentVlan2' | 'studentVlan3' | 'studentVlan4' | 'studentVlan5' | 'studentVlan6' | 'studentVlan7' | 'studentVlan8' | 'studentVlan9';

        // For fullIP type - manually specified IPv4
        fullIp?: string;       // Full IPv4 address for static assignments

        // Management interface flag
        isManagementInterface?: boolean;

        // VLAN interface configuration
        isVlanInterface?: boolean;
        vlanIndex?: number;    // Which VLAN (0-based index, maps to vlans array)
        interfaceOffset?: number; // 1-50 (max enrolled students per VLAN)

        // Additional metadata
        isStudentGenerated?: boolean;
        description?: string;
        readonly?: boolean;

        // IPv6 Configuration (separate variable for dual-stack)
        ipv6InputType?: 'none' | 'fullIPv6' | 'studentVlan6_0' | 'studentVlan6_1' | 'studentVlan6_2' | 'studentVlan6_3' | 'studentVlan6_4' | 'studentVlan6_5' | 'studentVlan6_6' | 'studentVlan6_7' | 'studentVlan6_8' | 'studentVlan6_9' | 'linkLocal';
        fullIpv6?: string;           // Full IPv6 address for static assignments
        ipv6InterfaceId?: string;    // Lecturer-defined interface identifier (last part after ::)
        isIpv6Variable?: boolean;    // Whether this is an IPv6 variable
        ipv6VlanIndex?: number;      // Which VLAN for IPv6 (0-based)
      }>;
      connectionType?: 'ssh' | 'telnet' | 'console';
      sshPort?: number;
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
  availableFrom?: Date;    // When lab becomes accessible
  availableUntil?: Date;   // When lab becomes inaccessible
  dueDate?: Date;
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
        required: true,
        min: 8,
        max: 30
      },
      allocationStrategy: {
        type: String,
        enum: ['student_id_based', 'group_based'],
        required: true
      },
      exemptIpRanges: {
        type: [{
          _id: false,
          start: {
            type: String,
            required: true,
            validate: {
              validator: (v: string) => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(v),
              message: 'Invalid IPv4 address format'
            }
          },
          end: {
            type: String,
            required: false,
            validate: {
              validator: (v: string) => !v || /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(v),
              message: 'Invalid IPv4 address format'
            }
          }
        }],
        required: false,
        default: []
      }
    },
    vlanConfiguration: {
      type: {
        mode: {
          type: String,
          enum: ['fixed_vlan', 'lecturer_group', 'calculated_vlan', 'large_subnet'],
          required: true
        },
        vlanCount: {
          type: Number,
          required: true,
          min: 0, // 0 for large_subnet mode, 1-10 for other modes
          max: 10
        },
        vlans: [{
          _id: false,
          id: {
            type: String,
            required: true
          },
          vlanId: {
            type: Number,
            required: false,
            min: 1,
            max: 4094
          },
          calculationMultiplier: {
            type: Number,
            required: false
          },
          baseNetwork: {
            type: String,
            required: true
          },
          subnetMask: {
            type: Number,
            required: true,
            min: 8,
            max: 30
          },
          subnetIndex: {
            type: Number,
            required: true,
            min: 0,
            default: 1  // Default to second subnet block (historically .64 for /26)
          },
          groupModifier: {
            type: Number,
            required: false
          },
          isStudentGenerated: {
            type: Boolean,
            required: true,
            default: true
          },
          // IPv6 Configuration
          ipv6Enabled: {
            type: Boolean,
            required: false,
            default: false
          },
          ipv6VlanAlphabet: {
            type: String,
            required: false
          },
          ipv6SubnetId: {
            type: String,
            required: false
          }
        }],
        // Large Subnet Mode Configuration
        largeSubnetConfig: {
          _id: false,
          privateNetworkPool: {
            type: String,
            enum: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'],
            required: false
          },
          studentSubnetSize: {
            type: Number,
            required: false,
            min: 9,
            max: 30
          },
          subVlans: [{
            _id: false,
            id: {
              type: String,
              required: true
            },
            name: {
              type: String,
              required: true
            },
            subnetSize: {
              type: Number,
              required: true,
              min: 8,
              max: 30
            },
            subnetIndex: {
              type: Number,
              required: true,
              min: 1
            },
            vlanIdRandomized: {
              type: Boolean,
              required: true,
              default: true
            },
            fixedVlanId: {
              type: Number,
              required: false,
              min: 2,
              max: 4094
            }
          }]
        }
      },
      required: false
    },
    // IPv6 Template Configuration
    ipv6Config: {
      type: {
        enabled: {
          type: Boolean,
          required: true,
          default: false
        },
        template: {
          type: String,
          required: false,
          default: '2001:{X}:{Y}:{VLAN}::{offset}/64'
        },
        managementTemplate: {
          type: String,
          required: false
        },
        presetName: {
          type: String,
          enum: ['standard_exam', 'university_network', 'simple_lab', 'custom'],
          required: false,
          default: 'standard_exam'
        },
        // Enhanced configurable prefix support
        globalPrefix: {
          type: String,
          required: false
        },
        prefixMode: {
          type: String,
          enum: ['template', 'structured'],
          required: false,
          default: 'template'
        },
        // Management Network Override
        managementOverride: {
          _id: false,
          enabled: {
            type: Boolean,
            required: false,
            default: false
          },
          fixedPrefix: {
            type: String,
            required: false,
            default: '2001:3c8:1106:4306'
          },
          useStudentIdSuffix: {
            type: Boolean,
            required: false,
            default: true
          }
        }
      },
      required: false
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
        interface: {
          type: String,
          required: false
        },
        inputType: {
          type: String,
          enum: ['none', 'fullIP', 'studentManagement', 'studentVlan0', 'studentVlan1', 'studentVlan2', 'studentVlan3', 'studentVlan4', 'studentVlan5', 'studentVlan6', 'studentVlan7', 'studentVlan8', 'studentVlan9', 'subVlan0', 'subVlan1', 'subVlan2', 'subVlan3', 'subVlan4', 'subVlan5', 'subVlan6', 'subVlan7', 'subVlan8', 'subVlan9'],
          required: true
        },
        fullIp: {
          type: String,
          required: false
        },
        isManagementInterface: {
          type: Boolean,
          required: false,
          default: false
        },
        isVlanInterface: {
          type: Boolean,
          required: false,
          default: false
        },
        vlanIndex: {
          type: Number,
          required: false,
          min: 0,
          max: 9
        },
        interfaceOffset: {
          type: Number,
          required: false,
          min: 1,
          max: 254
        },
        isStudentGenerated: {
          type: Boolean,
          required: false,
          default: false
        },
        description: {
          type: String,
          required: false
        },
        readonly: {
          type: Boolean,
          required: false,
          default: false
        },
        // IPv6 Configuration
        ipv6InputType: {
          type: String,
          enum: ['none', 'fullIPv6', 'studentVlan6_0', 'studentVlan6_1', 'studentVlan6_2', 'studentVlan6_3', 'studentVlan6_4', 'studentVlan6_5', 'studentVlan6_6', 'studentVlan6_7', 'studentVlan6_8', 'studentVlan6_9', 'linkLocal', 'subVlan6_0', 'subVlan6_1', 'subVlan6_2', 'subVlan6_3', 'subVlan6_4', 'subVlan6_5', 'subVlan6_6', 'subVlan6_7', 'subVlan6_8', 'subVlan6_9'],
          required: false
        },
        fullIpv6: {
          type: String,
          required: false
        },
        ipv6InterfaceId: {
          type: String,
          required: false
        },
        isIpv6Variable: {
          type: Boolean,
          required: false,
          default: false
        },
        ipv6VlanIndex: {
          type: Number,
          required: false,
          min: 0,
          max: 9
        }
      }],
      connectionType: {
        type: String,
        enum: ['ssh', 'telnet', 'console'],
        required: false,
        default: 'console'
      },
      sshPort: {
        type: Number,
        required: false,
        min: 1,
        max: 65535
      },
      credentials: {
        usernameTemplate: {
          type: String,
          required: false
        },
        passwordTemplate: {
          type: String,
          required: false
        },
        enablePassword: {
          type: String,
          required: false
        }
      }
    }]
  },
  instructions: {
    type: RichContentSchema,
    required: false
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
  availableFrom: {
    type: Date,
    required: false
  },
  availableUntil: {
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

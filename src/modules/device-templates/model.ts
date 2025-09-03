import { Schema, model, Document, Types } from 'mongoose';

export interface IDeviceTemplate extends Document {
  name: string;            // Display name
  
  // Device Classification
  deviceType: 'router' | 'switch' | 'server';
  platform: string;       // "cisco_ios", "linux"  
  
  // Network Interfaces
  defaultInterfaces: Array<{
    name: string;          // "GigabitEthernet0/1", "eth0"
    type: 'ethernet' | 'serial' | 'loopback' | 'tunnel' | 'vlan';
    description?: string;
    isManagement?: boolean; // True for management interfaces
  }>;
  
  // Connection Configuration
  connectionParams: {
    defaultSSHPort: number;
    alternativePorts?: number[];
    
    // Authentication Templates
    authentication: {
      usernameTemplate: string;    // "admin", "student{index}", "user{lab_id}"
      passwordTemplate: string;    // "cisco", "pass{index}", "{student_id}"
      enablePasswordTemplate?: string; // For Cisco devices
    };
  };
  
  // Documentation
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

const deviceTemplateSchema = new Schema<IDeviceTemplate>({
  name: {
    type: String,
    required: true,
    trim: true
  },
  deviceType: {
    type: String,
    enum: ['router', 'switch', 'server'],
    required: true
  },
  platform: {
    type: String,
    required: true,
    trim: true
  },
  defaultInterfaces: [{
    name: {
      type: String,
      required: true
    },
    type: {
      type: String,
      enum: ['ethernet', 'serial', 'loopback', 'tunnel', 'vlan'],
      required: true
    },
    description: {
      type: String,
      required: false
    },
    isManagement: {
      type: Boolean,
      required: false,
      default: false
    }
  }],
  connectionParams: {
    defaultSSHPort: {
      type: Number,
      required: true,
      default: 22
    },
    alternativePorts: {
      type: [Number],
      required: false
    },
    authentication: {
      usernameTemplate: {
        type: String,
        required: true
      },
      passwordTemplate: {
        type: String,
        required: true
      },
      enablePasswordTemplate: {
        type: String,
        required: false
      }
    }
  },
  description: {
    type: String,
    required: true,
    trim: true
  }
}, {
  timestamps: true
});

// Indexes as specified in implementation guide
deviceTemplateSchema.index({ platform: 1, deviceType: 1 }); // platform filtering

export const DeviceTemplate = model<IDeviceTemplate>('DeviceTemplate', deviceTemplateSchema, 'device_templates');
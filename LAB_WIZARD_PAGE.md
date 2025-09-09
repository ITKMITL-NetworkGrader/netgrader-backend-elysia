# Lab Creation Wizard - Frontend Implementation Guide

## 🎯 Overview

This document provides comprehensive guidance for implementing a Lab Creation Wizard frontend interface for the NetGrader system. The wizard is accessed from a Course page via "Add Lab" button and guides users through creating network labs with complex topology configurations, device management, task creation, and IP allocation settings.

## 📋 Table of Contents

- [Lab Creation Wizard - Frontend Implementation Guide](#lab-creation-wizard---frontend-implementation-guide)
  - [🎯 Overview](#-overview)
  - [📋 Table of Contents](#-table-of-contents)
  - [🔄 User Flow Context](#-user-flow-context)
  - [🏗️ Lab Data Structure](#️-lab-data-structure)
  - [🔗 API Integration](#-api-integration)
  - [🧙‍♂️ Wizard Flow \& Steps](#️-wizard-flow--steps)
  - [📝 Form Fields \& Validation](#-form-fields--validation)
  - [🎨 UI/UX Guidelines](#-uiux-guidelines)
  - [⚠️ Error Handling](#️-error-handling)
  - [🧪 Testing Scenarios](#-testing-scenarios)
  - [📦 Dependencies \& Prerequisites](#-dependencies--prerequisites)
  - [🚀 Implementation Checklist](#-implementation-checklist)

---

## 🔄 User Flow Context

### Entry Point
- **Trigger**: User clicks "Add Lab" button on Course page
- **Context**: Course information is already available (courseId, course name, etc.)
- **Destination**: Lab Creation Wizard modal/page overlay
- **Return**: Back to the same Course page after successful creation

### Course Context Props
```typescript
interface CourseContext {
  courseId: string;        // Course shortcode (e.g., "aLg0B5jPrFW47ICP")
  courseName: string;      // Display name
  courseCode: string;      // Course code
  instructorId: string;    // Current user's ID
}
```

### Navigation Flow
```
Course Page → [Add Lab] → Lab Creation Wizard → [Success] → Course Page (refreshed with new lab)
                ↓
            [Cancel] → Course Page (no changes)
                ↓
            [Error] → Stay in wizard with error state
```

---

## 🏗️ Lab Data Structure

### Complete Lab + Parts + Tasks Schema
```typescript
interface Lab {
  courseId: string;           // Already provided from course context
  name: string;               // Lab name (max 100 chars)
  description?: string;       // Optional description (max 2000 chars)
  instructions: string;       // Student-facing instructions (Markdown)
  
  network: {
    topology: {
      baseNetwork: string;    // CIDR base (e.g., "192.168.1.0")
      subnetMask: number;     // Subnet mask (e.g., 24)
    };
    devices: Device[];        // Array of network devices
  };
  
  parts: LabPart[];          // Lab parts (created after lab creation)
  
  dueDate?: Date;            // Optional due date
  availableFrom?: Date;      // Optional availability start
  availableUntil?: Date;     // Optional availability end
}

interface Device {
  deviceId: string;          // Unique device identifier
  templateId: string;        // Device template ID (ObjectId)
  ipVariables: IpVariable[]; // IP variable configurations
}

interface IpVariable {
  name: string;              // Variable name (e.g., "loopback0", "gig0_1")
  hostOffset: number;        // Host offset for IP calculation
}

interface LabPart {
  labId: string;             // Reference to lab (ObjectId from lab creation)
  partId: string;            // Human-readable ID (e.g., "part1", "routing")
  title: string;             // Part title
  description?: string;      // Optional description (Markdown)
  instructions: string;      // Student instructions (Markdown, max 10000 chars)
  order: number;             // Display sequence
  
  tasks: Task[];             // Array of tasks (min 1 required)
  task_groups: TaskGroup[];  // Optional task grouping
  
  prerequisites: string[];   // Part IDs that must be completed first
  totalPoints: number;       // Sum of task points
}

interface Task {
  taskId: string;            // Unique within part
  name: string;              // Task name
  description?: string;      // Optional description
  templateId: string;        // Task template ID (ObjectId)
  
  // Execution Configuration
  executionDevice: string;   // Device ID from lab.network.devices
  targetDevices: string[];   // Device IDs for multi-device tasks
  
  // Task Parameters (passed to template)
  parameters: Record<string, any>;
  
  // Grading Configuration
  testCases: TestCase[];     // Array of test cases
  
  order: number;             // Order within part
  points: number;            // Total points for task
}

interface TestCase {
  comparison_type: string;   // Type of comparison: equals, contains, regex, success, ssh_success, greater_than
  expected_result: any;      // Expected value/result for comparison
}

interface TaskGroup {
  group_id: string;          // Unique group identifier
  title: string;             // Group title
  description?: string;      // Optional description
  group_type: "all_or_nothing" | "proportional";
  points: number;            // Group points
  continue_on_failure: boolean;
  timeout_seconds: number;
}

interface TaskTemplate {
  _id: string;               // Template MongoDB ObjectId
  templateId: string;        // Human-readable template ID
  name: string;              // Display name
  description: string;       // What this template does
  parameterSchema: Array<{   // Required parameters
    name: string;
    type: string;
    description?: string;
    required: boolean;
  }>;
  defaultTestCases: Array<{  // Default test cases
    comparison_type: string;
    expected_result: any;
  }>;
}
```

### Sample Data Structure
```json
{
  "lab": {
    "courseId": "aLg0B5jPrFW47ICP",
    "name": "OSPF Routing Configuration",
    "description": "Students will configure OSPF routing protocol",
    "instructions": "## Lab Objectives\n- Configure OSPF areas\n- Verify neighbor relationships",
    "network": {
      "topology": {
        "baseNetwork": "192.168.1.0",
        "subnetMask": 24
      },
      "devices": [
        {
          "deviceId": "router1",
          "templateId": "507f1f77bcf86cd799439012",
          "ipVariables": [
            {
              "name": "loopback0",
              "hostOffset": 1
            },
            {
              "name": "gig0_1",
              "hostOffset": 2
            }
          ]
        }
      ]
    }
  },
  "parts": [
    {
      "partId": "basic-config",
      "title": "Basic Router Configuration",
      "instructions": "Configure basic settings on all routers",
      "order": 1,
      "tasks": [
        {
          "taskId": "hostname-config",
          "name": "Configure Hostname",
          "templateId": "507f1f77bcf86cd799439014",
          "executionDevice": "router1",
          "targetDevices": ["router1"],
          "parameters": {
            "hostname": "R1"
          },
          "testCases": [
            {
              "comparison_type": "contains",
              "expected_result": "hostname R1"
            }
          ],
          "order": 1,
          "points": 10
        }
      ],
      "task_groups": [],
      "totalPoints": 10
    }
  ]
}
```

---

## 🔗 API Integration

### Authentication Method
**Uses HTTP-only cookies for authentication** - no Bearer tokens needed.

**All API requests must include:**
```javascript
fetch(url, {
  method: 'POST',
  credentials: 'include',  // 🔑 CRITICAL: Include cookies
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(data)
})
```

### Core API Endpoints

#### 1. Create Lab (Step 1)
```http
POST [backendUrl]/v0/labs
Content-Type: application/json
Cookie: [HTTP-only auth cookies sent automatically]

{
  "courseId": "aLg0B5jPrFW47ICP",
  "name": "OSPF Routing Lab",
  "description": "Students will configure OSPF routing protocol",
  "instructions": "## Lab Objectives\n- Configure OSPF areas\n- Verify neighbor relationships",
  "dueDate": "2024-12-15T23:59:59.000Z",
  "availableFrom": "2024-12-01T00:00:00.000Z",
  "availableUntil": "2024-12-16T23:59:59.000Z",
  "network": {
    "topology": {
      "baseNetwork": "192.168.1.0",
      "subnetMask": 24
    },
    "devices": [
      {
        "deviceId": "router1",
        "templateId": "507f1f77bcf86cd799439012",
        "ipVariables": [
          {
            "name": "loopback0",
            "hostOffset": 1
          },
          {
            "name": "gig0_1",
            "hostOffset": 2
          }
        ]
      },
      {
        "deviceId": "router2", 
        "templateId": "507f1f77bcf86cd799439012",
        "ipVariables": [
          {
            "name": "loopback0",
            "hostOffset": 10
          }
        ]
      }
    ]
  }
}
```

#### 2. Create Lab Parts (Step 2) 
```http
POST [backendUrl]/v0/parts
Content-Type: application/json
Cookie: [HTTP-only auth cookies sent automatically]

{
  "labId": "507f1f77bcf86cd799439013",
  "partId": "basic-config",
  "title": "Basic Configuration",
  "description": "Configure basic router settings",
  "instructions": "# Part 1: Basic Setup\n\n1. Configure hostname\n2. Set IP addresses",
  "order": 1,
  "tasks": [
    {
      "taskId": "hostname-config",
      "name": "Configure Hostname",
      "description": "Set device hostname",
      "templateId": "507f1f77bcf86cd799439014",
      "executionDevice": "router1",
      "targetDevices": ["router1"],
      "parameters": { 
        "hostname": "R1" 
      },
      "testCases": [
        {
          "comparison_type": "contains",
          "expected_result": "hostname R1"
        },
        {
          "comparison_type": "contains", 
          "expected_result": "R1"
        }
      ],
      "order": 1,
      "points": 15
    }
  ],
  "task_groups": [
    {
      "group_id": "basic_setup",
      "title": "Basic Setup Tasks",
      "description": "Core device configuration tasks",
      "group_type": "all_or_nothing",
      "points": 15,
      "continue_on_failure": false,
      "timeout_seconds": 300
    }
  ],
  "prerequisites": [],
  "totalPoints": 15
}
```

#### 3. Get Task Templates
```http
GET [backendUrl]/v0/task-templates
Cookie: [HTTP-only auth cookies sent automatically]
```

**Response:**
```json
{
  "success": true,
  "data": {
    "templates": [
      {
        "_id": "507f1f77bcf86cd799439014",
        "templateId": "cisco_hostname_config",
        "name": "Cisco Hostname Configuration",
        "description": "Configure device hostname on Cisco devices",
        "parameterSchema": [
          {
            "name": "hostname",
            "type": "string",
            "description": "Device hostname (alphanumeric, no spaces)",
            "required": true
          }
        ],
        "defaultTestCases": [
          {
            "comparison_type": "contains",
            "expected_result": "hostname {{hostname}}"
          }
        ]
      }
    ]
  }
}
```

#### 4. Get Device Templates (for device list)
```http
GET [backendUrl]/v0/device-templates
Cookie: [HTTP-only auth cookies sent automatically]
```

**Response:**
```json
{
  "success": true,
  "data": {
    "templates": [
      {
        "_id": "507f1f77bcf86cd799439012",
        "name": "Cisco Router",
        "deviceType": "router",
        "platform": "cisco_ios",
        "defaultInterfaces": [
          {
            "name": "GigabitEthernet0/0",
            "type": "ethernet",
            "description": "Primary interface"
          },
          {
            "name": "Loopback0", 
            "type": "loopback",
            "description": "Loopback interface"
          }
        ],
        "connectionParams": {
          "defaultSSHPort": 22,
          "authentication": {
            "usernameTemplate": "admin",
            "passwordTemplate": "cisco"
          }
        }
      }
    ]
  }
}
```

---

## 🧙‍♂️ Wizard Flow & Steps

### Updated 6-Step Flow with Parts & Tasks

---

### Step 1: Basic Lab Information
**Purpose:** Collect fundamental lab details

**Course Context Display:**
- Show current course name/code at top of wizard
- Display as read-only information, not editable

**Fields:**
- **Lab Name** (Text Input)
  - Required: Yes
  - Max length: 100 characters
  - Unique within course
- **Description** (Textarea)
  - Optional
  - Max length: 2000 characters
  - Markdown supported
- **Student Instructions** (Rich Text Editor)
  - Required: Yes
  - Markdown supported
  - Student-facing instructions
  - Preview mode available

---

### Step 2: Network Configuration
**Purpose:** Configure the base network settings

**Network Topology:**
- **Base Network** (Text Input)
  - IP address (e.g., "192.168.1.0")
  - Required: Yes
  - Validation: Valid IP format
- **Subnet Mask** (Number Input)
  - CIDR notation (8-30)
  - Required: Yes
  - Auto-calculate IP capacity

---

### Step 3: Device Configuration  
**Purpose:** Add and configure network devices

**Device Management:**
- **Add Device** button
- **Minimum 1 device required**
- Device reordering with drag-and-drop

**Per Device Configuration:**
- **Device ID** (Text Input)
  - Unique within lab
  - Alphanumeric + underscores
  - Required: Yes
- **Device Template** (Dropdown)
  - Fetch from `/api/device-templates`
  - Required: Yes
- **IP Variables** (Dynamic Array)
  - **Variable Name** (Text Input)
  - **Host Offset** (Number Input)
  - At least 1 IP variable required

---

### Step 4: Parts & Tasks Management ⭐ **NEW**
**Purpose:** Create lab parts and define tasks for each part

This is the most complex step requiring advanced UI patterns.

#### Part Management Section

**Add Part Button**
- Creates new part with default values
- Minimum: 1 part required
- Parts can be reordered via drag-and-drop

**Per Part Configuration:**

##### Part Basic Information
- **Part ID** (Text Input)
  - Unique identifier (e.g., "basic-config", "routing")
  - Auto-generated: Based on title
  - Pattern: lowercase, alphanumeric, hyphens
  - Required: Yes

- **Part Title** (Text Input)
  - Display title (e.g., "Basic Configuration")
  - Required: Yes

- **Description** (Textarea)
  - Optional Markdown description
  - Max 2000 characters

- **Instructions** (Rich Text Editor)
  - Student instructions in Markdown
  - Required: Yes
  - Max 10000 characters
  - Preview mode available

- **Prerequisites** (Multi-select)
  - Select from other parts in this lab
  - Optional: Can be empty

##### Task Management (Nested within Part)

**Task Overview:**
- Visual task list with drag-and-drop reordering
- **Add Task** button
- **Minimum 1 task per part required**
- Task grouping interface (see Task Groups section)

**Per Task Configuration:**

###### Task Basic Info
- **Task ID** (Text Input)
  - Unique within part
  - Auto-generated from name
  - Required: Yes

- **Task Name** (Text Input)
  - Display name
  - Required: Yes

- **Description** (Textarea)
  - Optional task description

###### Task Template Selection
- **Task Template** (Searchable Dropdown)
  - Fetch from `/api/task-templates` API
  - Group by category/type
  - Search by name/description
  - Show template description on hover
  - Required: Yes

- **Template Parameters** (Dynamic Form)
  - Generated based on selected template's `parameterSchema`
  - Each parameter renders appropriate input type
  - Required parameters validated
  - Parameter help text from schema

###### Execution Configuration
- **Execution Device** (Dropdown)
  - Select from lab's network devices
  - Device where task will run
  - Required: Yes

- **Target Devices** (Multi-select)
  - Devices affected by this task
  - Can include execution device
  - Default: Include execution device

###### Test Cases Configuration
- **Auto-generate from Template** (Button)
  - Populate from template's `defaultTestCases`
  - User can modify after generation

- **Manual Test Cases** (Array Form)
  - **Add Test Case** button
  - Per test case fields:
    - **Comparison Type** (Dropdown) - Required
      - Options: equals, contains, regex, success, ssh_success, greater_than
    - **Expected Result** (Text Input) - Expected value/result for comparison - Required

###### Task Scoring
- **Task Points** (Number Input)
  - Total points for this task
  - Auto-calculated from test cases
  - Can be manually overridden
  - Required: Yes

##### Task Groups Section ⭐ **ADVANCED UI**

**Purpose:** Group related tasks for execution control

**Visual Interface:**
- **Drag-and-Drop Task Grouping**
  - Horizontal swimlanes for groups
  - Drag tasks between groups
  - "Ungrouped Tasks" default swimlane
  - Visual group boundaries

**Group Creation:**
- **Create Task Group** button
- Group configuration modal/sidebar

**Per Task Group:**
- **Group ID** (Text Input) - Auto-generated
- **Group Title** (Text Input) - Required
- **Group Description** (Textarea) - Optional
- **Group Type** (Radio Buttons):
  - **all_or_nothing**: All tasks must pass or group fails (Students get full points or zero for entire group)
  - **proportional**: Partial credit based on passed tasks (Students get partial credit based on completed tasks)
- **Group Points** (Number Input) - Total points for group
- **Continue on Failure** (Checkbox) - Whether to continue if group fails
- **Group Timeout** (Number Input) - Seconds for entire group

##### Part Summary
- **Total Points Calculation** (Display Only)
  - Auto-calculated from all task points
  - Updates in real-time

---

### Step 5: Schedule & Publishing
**Purpose:** Set lab availability and deadlines

**Schedule Configuration:**
- **Available From** (Date/Time Picker)
  - Optional
  - When students can start the lab
- **Available Until** (Date/Time Picker)
  - Optional
  - When lab becomes unavailable
- **Due Date** (Date/Time Picker)
  - Optional
  - When submissions are due
  - Must be after Available From if both set

---

### Step 6: Review & Create
**Purpose:** Final review and confirmation

**Enhanced Display:**
- Lab summary
- Network configuration summary
- **Parts & Tasks Summary** (NEW)
  - Expandable part cards
  - Task list with points
  - Task group visualization
  - Total lab points calculation

**Create Process:**
1. Create lab via `/api/labs` API
2. For each part, create via `/api/parts` API
3. Show progress indicator
4. Handle partial failures gracefully

---

## 📝 Form Fields & Validation

### Lab Level Validation
```javascript
const labValidation = {
  name: {
    required: true,
    maxLength: 100,
    unique: true, // within course
    message: "Lab name is required (max 100 chars) and must be unique"
  },
  instructions: {
    required: true,
    message: "Student instructions are required"
  },
  courseId: {
    required: true,
    message: "Course context is required"
  },
  "network.topology.baseNetwork": {
    required: true,
    pattern: /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/,
    message: "Valid IP address required"
  },
  "network.topology.subnetMask": {
    required: true,
    min: 8,
    max: 30,
    message: "Subnet mask must be between 8 and 30"
  },
  "network.devices": {
    minLength: 1,
    message: "At least one device is required"
  }
};
```

### Parts & Tasks Validation

#### Part Validation
```javascript
const partValidation = {
  partId: {
    required: true,
    pattern: /^[a-z0-9-]+$/,
    unique: true, // within lab
    message: "Part ID must be lowercase alphanumeric with hyphens"
  },
  title: {
    required: true,
    maxLength: 200,
    message: "Part title is required (max 200 chars)"
  },
  instructions: {
    required: true,
    maxLength: 10000,
    message: "Instructions are required (max 10000 chars)"
  },
  tasks: {
    minLength: 1,
    message: "At least one task is required per part"
  }
};
```

#### Task Validation
```javascript
const taskValidation = {
  taskId: {
    required: true,
    pattern: /^[a-zA-Z0-9_-]+$/,
    unique: true, // within part
    message: "Task ID must be alphanumeric with underscores/hyphens"
  },
  name: {
    required: true,
    message: "Task name is required"
  },
  templateId: {
    required: true,
    message: "Task template must be selected"
  },
  executionDevice: {
    required: true,
    message: "Execution device must be selected"
  },
  points: {
    required: true,
    min: 0,
    message: "Task points must be 0 or greater"
  },
  testCases: {
    minLength: 1,
    message: "At least one test case is required"
  },
  "testCases[].comparison_type": {
    required: true,
    enum: ["equals", "contains", "regex", "success", "ssh_success", "greater_than"],
    message: "Valid comparison type is required"
  },
  "testCases[].expected_result": {
    required: true,
    message: "Expected result is required"
  }
};
```

#### Dynamic Parameter Validation
```javascript
function validateTaskParameters(parameters, parameterSchema) {
  const errors = {};
  
  parameterSchema.forEach(param => {
    if (param.required && !parameters[param.name]) {
      errors[param.name] = `${param.name} is required`;
    }
    
    if (parameters[param.name] && param.type) {
      const value = parameters[param.name];
      switch (param.type) {
        case 'number':
          if (isNaN(Number(value))) {
            errors[param.name] = `${param.name} must be a number`;
          }
          break;
        case 'ip':
          if (!isValidIP(value)) {
            errors[param.name] = `${param.name} must be a valid IP address`;
          }
          break;
        // Add more type validations
      }
    }
  });
  
  return errors;
}
```

---

## 🎨 UI/UX Guidelines

### Parts & Tasks UI Components

The UI should focus on functionality and user workflow without specifying particular libraries or implementation details. Use drag-and-drop patterns, accordion interfaces, and modal/sidebar configurations as needed for optimal user experience.

### Visual Design Guidelines

#### Color Coding
- **Parts**: Blue theme for part-related elements
- **Tasks**: Green theme for task-related elements
- **Task Groups**: Purple theme for grouped tasks
- **Individual Tasks**: Gray theme for ungrouped tasks

#### Visual Hierarchy
1. **Parts** - Largest cards with clear boundaries
2. **Task Groups** - Swimlanes with colored borders
3. **Tasks** - Smaller cards within groups
4. **Test Cases** - Compact list items

#### Drag-and-Drop Visual Feedback
- **Dragging**: Semi-transparent task card
- **Valid Drop Zone**: Highlighted border (green)
- **Invalid Drop Zone**: Red border
- **Drop Preview**: Ghost placeholder

---

## ⚠️ Error Handling

### Parts & Tasks Specific Errors

#### Validation Errors
```json
{
  "success": false,
  "message": "Part creation failed",
  "errors": {
    "parts[0].partId": "Part ID already exists",
    "parts[0].tasks[0].templateId": "Invalid template ID",
    "parts[1].tasks[0].parameters.hostname": "Hostname is required"
  }
}
```

#### Template Parameter Errors
```javascript
function handleTemplateParameterError(error, taskId, paramName) {
  showFieldError(`task-${taskId}-param-${paramName}`, error.message);
  highlightTaskInList(taskId);
  scrollToTaskConfiguration(taskId);
}
```

#### Task Group Errors
- **Empty Groups**: Warn user about groups with no tasks
- **Circular Dependencies**: Detect and prevent circular part prerequisites
- **Point Mismatches**: Warn if group points don't match sum of task points

---

## 🧪 Testing Scenarios

### Parts & Tasks Testing

Test task creation flow, template parameter handling, drag-and-drop task grouping, and form validation thoroughly. Focus on user workflows and edge cases.

---

## 📦 Dependencies & Prerequisites

The frontend should use appropriate modern frameworks and libraries for:
- Form handling and validation
- Drag-and-drop functionality  
- Rich text editing (Markdown support)
- Date/time pickers
- API communication
- State management

Specific library choices are left to the frontend implementation team.

---

## 🚀 Implementation Checklist

### Phase 1: Basic Parts Management ✅
- [ ] Part creation interface with basic fields
- [ ] Part reordering via drag-and-drop
- [ ] Part validation and error handling
- [ ] Prerequisites selection
- [ ] Instructions editor (Markdown support)

### Phase 2: Task Creation Core ✅
- [ ] Task creation modal/form
- [ ] Task template selection interface
- [ ] Dynamic parameter form generation
- [ ] Execution device selection
- [ ] Test cases management
- [ ] Task validation

### Phase 3: Advanced Task Features ✅
- [ ] Task reordering within parts
- [ ] Task duplication functionality
- [ ] Auto-generate test cases from templates
- [ ] Task point calculation
- [ ] Task preview/testing interface

### Phase 4: Task Grouping System ✅
- [ ] Task group creation interface
- [ ] Drag-and-drop task grouping
- [ ] Visual group boundaries and indicators
- [ ] Group configuration (type, points, timeout)
- [ ] Group validation and error handling

### Phase 5: Advanced UI Features ✅
- [ ] Rich text editor for instructions
- [ ] Template parameter help/documentation
- [ ] Task search and filtering
- [ ] Bulk task operations
- [ ] Task import/export functionality

### Phase 6: Integration & Testing ✅
- [ ] Multi-step wizard integration
- [ ] Parts API integration with error handling
- [ ] Comprehensive form validation
- [ ] E2E testing for complete flow
- [ ] Performance optimization for large labs

### Phase 7: Polish & UX ✅
- [ ] Loading states for all async operations
- [ ] Optimistic updates for drag-and-drop
- [ ] Keyboard navigation support
- [ ] Mobile responsiveness
- [ ] Accessibility compliance

---

**The Complete Lab Creation Wizard with Parts & Tasks Management! 🚀**

*This comprehensive guide provides all the necessary information for implementing a full-featured Lab Creation Wizard. The focus is on functionality, user workflows, and data requirements while allowing the frontend team to make appropriate technology choices for the implementation.*
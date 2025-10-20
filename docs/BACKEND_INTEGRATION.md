# Backend Integration Guide for Enhanced Multi-Phase VLAN System with Management and VLAN-Specific IPs

## 🎯 Overview

This document outlines the required backend changes to support the enhanced flexible multi-phase VLAN system with lecturer-defined base networks, management IP generation, and VLAN-specific IP generation with interface offset support. The frontend has been updated to support all three course phases with customizable VLAN configurations and enhanced IP variable options.

---

## 📋 Complete Lab/Exam Creation Workflow

### 🔄 User Journey Overview

The lab/exam creation process follows a **6-step wizard workflow**:

```
Step 1: Basic Information (Required)
   ↓
Step 2: Network Configuration (Required - Management + VLANs)
   ↓
Step 3: Device Configuration (Required - Min 1 device)
   ↓
Step 4: Parts & Tasks Management (Required - Min 1 part with 1 task)
   ↓
Step 5: Schedule & Publishing (Optional - Dates/deadlines)
   ↓
Step 6: Review & Create (Summary + Submission)
```

### 🎯 Entry Points

**Lab Creation**: `/courses/{courseId}/labs/create`
**Exam Creation**: `/courses/{courseId}/labs/create?type=exam`

**Key Difference**: The `type` query parameter determines whether to create a "lab" or "exam". Both use the same wizard workflow and submit to the same APIs, with the `type` field differentiating them in the backend.

---

## 📝 Step-by-Step Data Collection

### Step 1: Basic Lab Information

**Purpose**: Collect fundamental lab metadata

**Fields Collected**:
```typescript
{
  name: string,              // Required, max 100 chars
  description: string,       // Optional, max 2000 chars
  instructions: string       // Required, Markdown format
}
```

**Validation Rules**:
- `name`: Required, 1-100 characters
- `description`: Optional, max 2000 characters
- `instructions`: Required, supports Markdown formatting
- All fields support real-time validation with visual feedback

**User Experience**:
- Markdown editor with live preview for instructions
- Character counters for all fields
- Auto-save to localStorage (draft functionality)

---

### Step 2: Network Configuration

**Purpose**: Configure management network and VLAN topology

**Fields Collected**:
```typescript
{
  managementNetwork: string,           // e.g., "10.0.0.0"
  managementSubnetMask: number,        // e.g., 24 (range: 8-30)
  mode: 'fixed_vlan' | 'lecturer_group' | 'calculated_vlan',
  allocationStrategy: 'student_id_based' | 'group_based',
  vlanCount: number,                   // 1-10
  vlans: Array<{
    id: string,                        // Generated UUID
    vlanId?: number,                   // For fixed_vlan & lecturer_group (1-4094)
    calculationMultiplier?: number,    // For calculated_vlan
    baseNetwork: string,               // e.g., "172.16.0.0"
    subnetMask: number,                // 8-30
    groupModifier?: number,            // For lecturer_group mode
    isStudentGenerated: boolean        // Always true
  }>
}
```

**VLAN Mode Details**:

1. **Fixed VLAN Mode (Beginning Course)**:
   - Uses fixed VLAN IDs (typically VLAN 1)
   - Each VLAN has a custom subnet mask
   - Simple configuration for introductory courses
   - Example: VLAN 1 = 172.16.0.0/24

2. **Lecturer Group Mode (Advanced Course)**:
   - VLANs calculated based on group assignments
   - Formula: `finalVlanId = baseVlanId + (groupNumber * groupModifier)`
   - Example: Base VLAN 10, Group A (+0), Group B (+10) = VLANs 10, 20

3. **Calculated VLAN Mode (Examination)**:
   - Algorithm-generated VLAN IDs per student
   - Formula: `vlanId = (studentId / 1000000 - 61) * multiplier + (studentId % 1000)`
   - Ensures unique, non-overlapping VLAN ranges per cohort
   - Example: Student 65070232, multiplier 400 = VLAN calculated dynamically

**Important Notes**:
- Base network duplication across VLANs is **ALLOWED** (algorithm replaces 2nd/3rd octets)
- Management network is separate from VLAN networks
- Student IP generation algorithm:
  ```javascript
  const dec2_1 = (studentId / 1000000 - 61) * 10
  const dec2_2 = (studentId % 1000) / 250
  const dec2 = Math.floor(dec2_1 + dec2_2)
  const dec3 = Math.floor((studentId % 1000) % 250)
  // Final IP: {baseOct1}.{dec2}.{dec3}.{hostOffset}
  ```

**Validation Rules**:
- Management network must be valid IPv4
- Subnet masks must be 8-30
- VLAN IDs must be 1-4094 (for fixed/lecturer modes)
- At least 1 VLAN required
- Network preview shown for sample student ID (65070232)

---

### Step 3: Device Configuration

**Purpose**: Configure network devices and their IP assignments

**Fields Collected** (per device):
```typescript
{
  deviceId: string,                    // Unique identifier, alphanumeric + hyphens
  templateId: string,                  // ObjectId from device templates API
  displayName: string,                 // Optional, defaults to deviceId
  ipVariables: Array<{
    name: string,                      // Variable name (alphanumeric + underscores)
    interface: string,                 // Full interface name from template
    inputType: 'hostOffset' | 'fullIP' | 'studentManagement' | 'studentVlan0' | 'studentVlan1' | ...,
    
    // For hostOffset type:
    hostOffset?: number,               // 1 to available hosts
    
    // For fullIP type:
    fullIP?: string,                   // Complete IPv4 address
    
    // For studentManagement type:
    isManagementInterface: boolean,    // Always true for this type
    
    // For studentVlanX types:
    isVlanInterface: boolean,          // Always true for VLAN types
    vlanIndex: number,                 // Which VLAN (0-based)
    interfaceOffset: number,           // 1-50, for multiple IPs per VLAN
    
    // Common fields:
    isStudentGenerated: boolean,
    readonly: boolean
  }>,
  connectionParams: {
    sshPort: number,                   // Default: 22
    username: string,
    password: string
  }
}
```

**IP Variable Input Types**:

1. **`hostOffset`**: Calculate IP from management network + offset
   - Example: baseNetwork=10.0.0.0, offset=5 → 10.0.0.5

2. **`fullIP`**: Manually specify complete IP address
   - Example: "203.0.113.10"

3. **`studentManagement`**: Auto-generate management IP per student
   - Uses management network from Step 2
   - One management IP per student
   - **Frontend-calculated** using student u_id (Student ID) algorithm when student accesses lab

4. **`studentVlan0`, `studentVlan1`, etc.**: Auto-generate VLAN-specific IPs
   - Uses VLAN base network from Step 2
   - `vlanIndex` maps to VLAN array index
   - `interfaceOffset` ensures unique IPs when multiple interfaces use same VLAN
   - **Frontend-calculated** using student u_id + VLAN network + offset when student accesses lab

**Device Template Integration**:
- Frontend fetches templates from `GET /v0/device-templates`
- Templates provide:
  - `defaultInterfaces`: Pre-configured interface list
  - `connectionParams`: Default SSH credentials
  - `platform`: Device platform (Cisco, Linux, etc.)
- Auto-populates IP variables from template interfaces

**Validation Rules**:
- Minimum 1 device required
- Device IDs must be unique across lab
- Each device must have minimum 1 IP variable
- IP variable names must be alphanumeric + underscores/hyphens
- No duplicate IP configurations (same type + VLAN + offset)
- Interface offset must be 1-50 for VLAN IPs

**IP Duplication Detection**:
The frontend validates that no two IP variables will generate the same IP:
```javascript
// Duplication key format:
// Management: "mgmt:single"
// VLAN: "vlan:{vlanIndex}:{interfaceOffset}"
// Example: "vlan:0:1" vs "vlan:0:2" = different IPs
```

---

### Step 4: Parts & Tasks Management

**Purpose**: Structure lab into graded parts with executable tasks

**Fields Collected** (per part):
```typescript
{
  partId: string,                      // Auto-generated from title (lowercase-hyphenated)
  title: string,                       // Required, max 200 chars
  description: string,                 // Optional, max 2000 chars
  instructions: string,                // Required, Markdown with rich text editor
  order: number,                       // Sequential order (1, 2, 3...)
  prerequisites: string[],             // Array of partId dependencies
  tasks: Array<{
    taskId: string,                    // Auto-generated from task name
    name: string,                      // Required
    description: string,               // Optional
    templateId: string,                // ObjectId from task templates API
    executionDevice: string,           // Device ID from Step 3
    targetDevices: string[],           // Array of device IDs (optional)
    parameters: Record<string, any>,   // Template-specific parameters
    testCases: Array<{
      comparison_type: 'equals' | 'contains' | 'regex' | 'success' | 'ssh_success' | 'greater_than',
      expected_result: any             // Can be string, number, or boolean
    }>,
    order: number,                     // Sequential order within part
    points: number,                    // Task points
    groupId?: string                   // Optional task group assignment
  }>,
  task_groups: Array<{
    group_id: string,                  // Unique group identifier
    title: string,                     // Group title
    description: string,               // Optional
    group_type: 'all_or_nothing' | 'proportional',
    points: number,                    // Total group points
    continue_on_failure: boolean,      // Whether to continue on task failure
    timeout_seconds: number            // Group execution timeout
  }>,
  totalPoints: number                  // Auto-calculated sum
}
```

**Task Template Integration**:
- Frontend fetches templates from `GET /v0/task-templates`
- Templates provide:
  - `parameterSchema`: Required/optional parameters with types
  - `defaultTestCases`: Pre-configured test cases
  - Special handling for `type: "ip_address"` parameters (see IP Parameter Feature)

**IP Parameter Feature** (Issue #8):
When a task template parameter has `type: "ip_address"`, the frontend provides a specialized selector supporting:

1. **IP Variable References**: `{deviceId}.{variableName}` format
   - Example: `router1.loopback0`
   - Frontend displays dropdown of all IP variables from Step 3
   - Backend must resolve to actual IP during execution

2. **Custom IP Addresses**: Direct IPv4 input
   - Example: `8.8.8.8` or `192.168.1.100`
   - Backend validates format and uses directly

**Task Grouping**:
- Optional feature for organizing related tasks
- Two types:
  - **all_or_nothing**: Student must pass all tasks to get points
  - **proportional**: Points distributed based on passed tasks
- Tasks can be ungrouped (individual points) or grouped
- Frontend prevents orphaned groups (groups with no tasks)

**Validation Rules**:
- Minimum 1 part required
- Each part must have minimum 1 task
- Part IDs must be unique
- Part titles auto-generate partIds (lowercase, hyphenated)
- Task names auto-generate taskIds
- Execution device must exist in devices from Step 3
- Target devices must exist in devices from Step 3
- All required task parameters must be filled
- Minimum 1 test case per task
- Total points auto-calculated from tasks/groups

**Rich Text Editor**:
- Full-screen Markdown editor with toolbar
- Image upload support (via `/v0/upload` API)
- Link insertion dialog
- Auto-save functionality
- Live preview mode

---

### Step 5: Schedule & Publishing

**Purpose**: Configure lab availability and deadlines

**Fields Collected**:
```typescript
{
  availableFrom: Date | undefined,     // Optional: When lab becomes accessible
  dueDate: Date | undefined,           // Optional: Submission deadline
  availableUntil: Date | undefined     // Optional: When lab becomes inaccessible
}
```

**Date/Time Handling**:
- All dates are optional
- Dates stored as ISO 8601 strings
- Date pickers with time inputs
- Validation: availableFrom < dueDate < availableUntil
- Duration calculation displayed
- Warnings for:
  - Very short lab windows (<24 hours)
  - Very long lab windows (>90 days)

**Default Behavior**:
- `availableFrom`: undefined = immediately available
- `dueDate`: undefined = no deadline
- `availableUntil`: undefined = always available

---

### Step 6: Review & Create

**Purpose**: Final review and submission

**Display Summary**:
1. Basic Information (name, description, instructions preview)
2. Network Configuration (management network, VLAN summary)
3. Devices (count, IP variable summary)
4. Parts & Tasks (count, total points, expandable details)
5. Schedule (formatted date/time display)

**Actions**:
- **Create Lab/Exam**: Submit to backend (2-phase process)
- **Go Back**: Return to previous steps to edit
- **Cancel**: Discard and return to course page

**Validation**:
- All steps must be valid before submission
- Progress indicator shows completion status
- Disabled "Create" button until all requirements met

---

## 🚀 Backend API Submission Workflow

### Phase 1: Lab Creation (`POST /v0/labs`)

The frontend first creates the lab with network topology and device configuration.

**Request Payload** (see detailed example in next section)

**Expected Response**:
```json
{
  "success": true,
  "data": {
    "id": "507f1f77bcf86cd799439013",  // Lab ID for parts creation
    "message": "Lab created successfully"
  }
}
```

**Error Response**:
```json
{
  "success": false,
  "message": "Error message describing what went wrong",
  "errors": {
    "field1": ["Error 1", "Error 2"],
    "field2": ["Error 3"]
  }
}
```

### Phase 2: Parts Creation (Multiple `POST /v0/parts`)

After lab creation succeeds, the frontend creates each part sequentially.

**For Each Part** (see detailed example in next section)

**Expected Response**:
```json
{
  "success": true,
  "data": {
    "partId": "basic-configuration",
    "labId": "507f1f77bcf86cd799439013",
    "message": "Part created successfully"
  }
}
```

### Submission Flow Diagram

```
User clicks "Create Lab"
        ↓
Frontend validates all steps
        ↓
POST /v0/labs (with type: "lab" or "exam")
        ↓
    Success? ──No──> Show error, stay on Step 6
        ↓ Yes
    Get labId from response
        ↓
FOR EACH part in wizardData.parts:
    POST /v0/parts (with labId)
        ↓
    Success? ──No──> Show error, stop creation
        ↓ Yes
    Continue to next part
        ↓
All parts created successfully
        ↓
Clear localStorage draft
        ↓
Show success message
        ↓
Redirect to /courses/{courseId}
```

### Error Handling

**Lab Creation Fails**:
- Show error message
- Stay on Step 6
- Allow user to go back and fix issues
- Draft remains in localStorage

**Part Creation Fails**:
- Lab already created (potential orphaned lab)
- Show which part failed
- Backend should handle cleanup or allow retry
- Frontend logs detailed error for debugging

---

## 🎯 Common Usage Scenarios

### Scenario 1: Basic Lab (Beginning Course)

**Configuration**:
- 1 VLAN (fixed mode, VLAN 1)
- 2 devices (router, switch)
- Management IPs for all devices
- 1 VLAN IP per device
- 1 part, 3 tasks
- No deadline

**Workflow**:
1. Step 1: Enter basic info
2. Step 2: Set management network, 1 fixed VLAN
3. Step 3: Add router + switch, assign management + VLAN IPs
4. Step 4: Create 1 part with 3 configuration tasks
5. Step 5: Skip (no deadline)
6. Step 6: Review and create

### Scenario 2: Advanced Lab (Multi-VLAN, Groups)

**Configuration**:
- 3 VLANs (lecturer group mode)
- 3 devices with multiple interfaces
- Management + multiple VLAN IPs with offsets
- 3 parts with prerequisites
- Task groups for complex grading
- Scheduled availability

**Workflow**:
1. Step 1: Detailed instructions with images
2. Step 2: Management network + 3 lecturer group VLANs
3. Step 3: 3 devices, each with 5-6 IP variables
4. Step 4: 3 parts, Part 2 requires Part 1, Part 3 requires Part 2
5. Step 5: Set availableFrom, dueDate, availableUntil
6. Step 6: Review complex configuration and create

### Scenario 3: Examination (Calculated VLANs)

**Configuration**:
- 2 VLANs (calculated mode with multipliers)
- Minimal devices for exam environment
- No prerequisites (all parts independent)
- Strict time window
- High point values

**Workflow**:
1. Step 1: Exam title and instructions
2. Step 2: Calculated VLAN mode with multipliers (400, 500)
3. Step 3: Limited devices, auto-generated IPs only
4. Step 4: 2 parts, no prerequisites, task groups for binary grading
5. Step 5: Short 2-hour availability window
6. Step 6: Review and create exam

### Scenario 4: Lab with IP Parameter Tasks

**Configuration**:
- Uses ping/connectivity test tasks
- IP parameter references other devices
- Mix of variable references and custom IPs

**Workflow**:
1. Steps 1-3: Standard configuration
2. Step 4: Add task using template with `type: "ip_address"` parameters
   - Parameter 1: Select `router1.loopback0` from dropdown
   - Parameter 2: Enter custom IP `8.8.8.8`
   - Backend receives: `{"target_ip": "router1.loopback0", "external_ip": "8.8.8.8"}`
3. Backend must resolve `router1.loopback0` to actual IP during execution

---

## 📊 Data Flow Summary

```
User Input (6 Steps)
        ↓
Frontend Validation & Processing
        ↓
wizardData Object (Complete State)
        ↓
Transform to API Format
        ↓
Lab Creation API Call
        ↓
Lab ID Retrieved
        ↓
Parts Creation API Calls (Sequential)
        ↓
All Data Persisted in Backend
        ↓
Frontend Redirect to Course Page
```

---

## 🔍 Key Frontend Processing Notes

1. **Auto-generation**:
   - Part IDs from titles (lowercase-hyphenated)
   - Task IDs from names
   - Device names from templates
   - Interface names from templates

2. **Validation Timing**:
   - Real-time validation on field blur
   - Step validation before allowing next step
   - Complete validation before submission
   - Visual feedback (green borders = valid, red = invalid)

3. **Draft Management**:
   - Auto-save to localStorage on every change
   - Draft key: `lab-draft-{courseId}`
   - Cleared on successful submission
   - Restored on page reload

4. **Boolean Conversion**:
   - Test case `expected_result` strings converted to booleans where appropriate
   - "true"/"false" strings → true/false booleans
   - Numbers and other types preserved

5. **Device Template Resolution**:
   - `templateId` in devices is the MongoDB ObjectId from `GET /v0/device-templates`
   - `displayName` can differ from `deviceId`
   - Connection params auto-populated from template defaults

---

## 🎓 Student Lab Execution & IP Calculation Workflow

### ⚠️ CRITICAL: Who Calculates Student IPs?

**Backend Role**: 
- **STORES** the network configuration variables (base networks, VLAN configurations, multipliers, subnet masks) in the lab document after lab creation
- **ASSIGNS** Management IP addresses when student starts/executes a lab (⚠️ **NOT YET IMPLEMENTED** - currently returns dummy/placeholder data)

**Frontend Role**: 
- **CALCULATES** all other student-specific IP addresses (VLAN IPs, hostOffset IPs) when a student starts/accesses the lab
- **RECEIVES** Management IP from backend and displays it in the IP schema table

### 📊 Complete Student Lab Execution Flow

```
Student clicks "Start Lab" or accesses lab
        ↓
Frontend fetches lab configuration from backend
    GET /v0/labs/{labId}
        ↓
Backend returns lab document with:
    - managementNetwork & subnetMask
    - vlanConfiguration (mode, vlans array with baseNetwork, multipliers, etc.)
    - devices array with ipVariables
        ↓
Frontend retrieves student's u_id (Student ID)
    From authenticated session
        ↓
Frontend runs IP calculation algorithm
    Using: studentId + lab configuration
        ↓
For each device's ipVariables:
    - studentManagement → Backend assigns Management IP (⚠️ NOT YET IMPLEMENTED)
    - studentVlan0, studentVlan1, etc. → Frontend calculates from VLAN baseNetwork
    - hostOffset → Frontend calculates from managementNetwork + offset
    - fullIP → Use as-is (no calculation)
        ↓
Frontend generates IP Schema Table
    Shows all calculated IPs for this student
        ↓
Student sees personalized IP addresses
    Each student gets unique IPs based on their u_id
```

### 🧮 Frontend Calculation Algorithm

**Location**: Frontend code (e.g., `utils/studentIpGenerator.ts`)

**Input Variables** (from backend):
```javascript
{
  studentId: "65070232",           // From authenticated user
  managementNetwork: "10.0.0.0",   // From lab.network.topology.baseNetwork
  managementSubnetMask: 24,        // From lab.network.topology.subnetMask
  vlans: [                         // From lab.network.vlanConfiguration.vlans
    {
      vlanId: 1,
      baseNetwork: "172.16.0.0",
      subnetMask: 24,
      calculationMultiplier: 400,  // For calculated_vlan mode
      groupModifier: 0             // For lecturer_group mode
    }
  ]
}
```

**Calculation Formula** (executed by frontend):
```javascript
// Extract components from student ID (e.g., 65070232)
const studentIdNum = Number(studentId)
const yearComponent = Math.floor(studentIdNum / 1000000) // 65
const facultyIndex = Math.floor((studentIdNum % 1000000) / 10000) // 07
const studentIndex = studentIdNum % 10000 // 0232

// Calculate IP octets
const dec2_1 = (studentIdNum / 1000000 - 61) * 10  // (65 - 61) * 10 = 40
const dec2_2 = (studentIdNum % 1000) / 250         // 232 / 250 = 0.928
const dec2 = Math.floor(dec2_1 + dec2_2)           // 40

const dec3 = Math.floor((studentIdNum % 1000) % 250) // 232

// For calculated VLANs, incorporate VLAN calculation
if (vlan.calculationMultiplier) {
  const calculatedVlanId = Math.floor(
    (studentIdNum / 1000000 - 61) * vlan.calculationMultiplier + (studentIdNum % 1000)
  )
  // Modify dec3 for uniqueness
  dec3 = Math.floor((dec3 + calculatedVlanId) % 250)
}

// Generate final IP
const baseOct1 = vlan.baseNetwork.split('.')[0]  // First octet from base network
const finalIP = `${baseOct1}.${dec2}.${dec3}.${hostOffset}`
```

**Example Output** (for Student ID 65070232):
```javascript
{
  managementIPs: {
    "router1.mgmt_interface": "10.40.232.65"
  },
  vlanIPs: {
    "router1.gig0_0_vlan_1": "172.40.232.65",  // VLAN 1, offset 1
    "router1.gig0_1_vlan_1": "172.40.232.66",  // VLAN 1, offset 2
    "router1.gig1_0_vlan_2": "172.40.232.97"   // VLAN 2, offset 1
  },
  staticIPs: {
    "router1.loopback0": "10.0.0.5"            // hostOffset type
  }
}
```

### 🔄 Backend's Responsibility

**During Lab Creation** (`POST /v0/labs`):
1. ✅ Store network configuration (base networks, subnet masks)
2. ✅ Store VLAN configuration (mode, multipliers, modifiers)
3. ✅ Store device configurations with IP variable definitions
4. ✅ Validate data structure and constraints
5. ❌ **DO NOT** calculate any student-specific IPs
6. ❌ **DO NOT** generate IP schemas per student

**During Lab Access** (`GET /v0/labs/{labId}`):
1. ✅ Return stored lab configuration
2. ✅ Include all network and VLAN configuration
3. ❌ **DO NOT** calculate IPs (frontend will do this)

**After Calculation** (Student submission):
- Backend receives student's configuration commands
- Backend validates against expected results
- Backend does NOT need to recalculate IPs (student already has them from frontend)

### 📋 What Backend Stores vs What Frontend Calculates

| Data | Backend Stores | Frontend Calculates |
|------|---------------|---------------------|
| Base Networks | ✅ `10.0.0.0` | ❌ |
| Subnet Masks | ✅ `/24` | ❌ |
| VLAN IDs | ✅ `vlanId: 1` | ❌ |
| Multipliers | ✅ `400` | ❌ |
| Group Modifiers | ✅ `10` | ❌ |
| Interface Offsets | ✅ `1, 2, 3...` | ❌ |
| Management IPs | ✅ Assigned by backend (NOT YET IMPLEMENTED) | ❌ Receives from backend |
| VLAN IPs | ❌ | ✅ `172.40.232.65` |
| Student IP Schema | ❌ | ✅ Complete table |

### 🎯 Key Takeaways for Backend Team

1. **Store, Don't Calculate (Mostly)**: Backend stores the configuration parameters and assigns Management IPs only
2. **Management IP Assignment** ⚠️ **TODO**: Backend should assign Management IPs when student starts lab (not implemented yet - currently returns dummy data)
3. **Frontend Owns Algorithm**: The VLAN and other IP calculation logic lives in the frontend
4. **Per-Student Uniqueness**: Each student gets unique IPs calculated on-the-fly when they access the lab
5. **No IP Pre-generation**: Backend does not need to pre-generate or store per-student IP schemas (except Management IPs)
6. **Configuration as Variables**: Treat stored data as "variables for the formula" not as final IPs

### 🔍 Example: What Backend Stores

```json
{
  "_id": "507f1f77bcf86cd799439013",
  "courseId": "aLg0B5jPrFW47ICP",
  "title": "OSPF Configuration Lab",
  "network": {
    "topology": {
      "baseNetwork": "10.0.0.0",        // ← Variable for calculation
      "subnetMask": 24                   // ← Variable for calculation
    },
    "vlanConfiguration": {
      "mode": "calculated_vlan",
      "vlans": [
        {
          "vlanId": 1,
          "baseNetwork": "172.16.0.0",   // ← Variable for calculation
          "subnetMask": 24,
          "calculationMultiplier": 400   // ← Variable for calculation
        }
      ]
    },
    "devices": [
      {
        "deviceId": "router1",
        "ipVariables": [
          {
            "name": "mgmt_interface",
            "inputType": "studentManagement",
            "interfaceOffset": 1         // ← Variable for calculation
            // NO actual IP address stored here!
          }
        ]
      }
    ]
  }
}
```

### 🔜 Future Backend Implementation: Management IP Assignment

**When**: Student starts/executes a lab (clicks "Start Lab" button)

**Backend Should**:
1. Receive student u_id and lab ID
2. Calculate Management IP for this student using the stored `managementNetwork` and `subnetMask`
3. Store the assigned Management IP in a student-lab mapping collection
4. Return the Management IP along with lab configuration

**API Endpoint (to be implemented)**:
```javascript
POST /v0/labs/{labId}/start
Body: {
  studentId: string  // u_id from session
}

Response: {
  lab: { /* lab configuration */ },
  studentManagementIP: string,  // e.g., "10.40.232.65"
  assignedAt: Date
}
```

**For Now (Temporary)**:
- Backend returns dummy/placeholder Management IP
- Frontend displays it as-is without calculation
- **DO NOT** break the flow - just return a placeholder like `"10.0.0.1"` or similar

---

### 🎓 Example: What Student Sees (Calculated by Frontend)

```
IP Schema for Student 65070232:

Device: router1
├─ mgmt_interface (GigabitEthernet0/0)
│  └─ IP: 10.40.232.65/24            ← Calculated
├─ gig0_0_vlan_1 (GigabitEthernet0/1)
│  └─ IP: 172.40.232.65/24           ← Calculated
└─ gig0_1_vlan_1 (GigabitEthernet0/2)
   └─ IP: 172.40.232.66/24           ← Calculated
```

---

## 🔄 Required Backend API Updates

### 🆕 Key Changes in Frontend Data Submission

The frontend has been updated to submit enhanced data structures for lab creation:

#### 1. **Management Network as Base Network**
- **Before**: Used `baseNetwork` from Step 2
- **After**: Uses `managementNetwork` from Step 2 as the `baseNetwork` in the payload
- **Impact**: Backend receives management network configuration as the primary network topology

#### 2. **VLAN Configuration Data**
- **Added**: Complete VLAN configuration from Step 2 is now included in the lab creation payload
- **Structure**: `vlanConfiguration` object with mode, vlanCount, and vlans array
- **Purpose**: Backend can process VLAN-specific IP generation and assignment

#### 3. **Interface Type Marking**
- **Added**: `isManagementInterface` flag for management interfaces
- **Added**: `isVlanInterface` flag for VLAN-specific interfaces  
- **Added**: `vlanIndex` and `interfaceOffset` for VLAN interface configuration
- **Purpose**: Backend can identify which interfaces require management IP vs VLAN IP generation

#### 4. **Enhanced IP Variable Structure**
```json
{
  "name": "mgmt_interface",
  "interface": "GigabitEthernet0/0",
  "inputType": "studentManagement",
  "isManagementInterface": true,     // 🆕 NEW: Marks management interface
  "isVlanInterface": false,          // 🆕 NEW: Marks VLAN interface
  "vlanIndex": null,
  "interfaceOffset": null
}
```

## 🔄 Required Backend API Updates

### 1. Enhanced Lab Creation Endpoint

**Endpoint**: `POST /v0/labs`

**New Request Structure**:
```json
{
  "courseId": "aLg0B5jPrFW47ICP",
  "title": "Enhanced OSPF Lab",
  "description": "Students will configure OSPF with management and VLAN IPs",
  "type": "lab",
  "dueDate": "2024-12-15T23:59:59.000Z",
  "availableFrom": "2024-12-01T00:00:00.000Z",
  "availableUntil": "2024-12-16T23:59:59.000Z",

  // 🆕 UPDATED: Enhanced Network Structure with VLAN Configuration
  "network": {
    "name": "Enhanced OSPF Lab",
    "topology": {
      // 🆕 CHANGED: Use managementNetwork as baseNetwork
      "baseNetwork": "10.0.0.0",           // Now uses managementNetwork from Step 2
      "subnetMask": 24,                    // Now uses managementSubnetMask from Step 2
      "allocationStrategy": "group_based"
    },
    // 🆕 ADDED: VLAN Configuration Data
    "vlanConfiguration": {
      "mode": "fixed_vlan",                // From Step 2 networkConfig.mode
      "vlanCount": 3,                      // From Step 2 networkConfig.vlanCount
      "vlans": [
        {
          "id": "vlan_1731840123456_abc123def",
          "vlanId": 1,                     // For fixed_vlan and lecturer_group modes
          "calculationMultiplier": 400,    // For calculated_vlan mode
          "baseNetwork": "192.168.0.0",
          "subnetMask": 26,
          "groupModifier": 0,              // For lecturer_group mode
          "isStudentGenerated": true
        },
        {
          "id": "vlan_1731840123456_def456ghi",
          "vlanId": 2,
          "baseNetwork": "172.16.0.0",
          "subnetMask": 24,
          "groupModifier": 10,
          "isStudentGenerated": true
        }
      ]
    },
    "devices": [
      {
        "deviceId": "router1",
        "templateId": "507f1f77bcf86cd799439012",
        "displayName": "router1",
        "ipVariables": [
          {
            "name": "mgmt_interface",
            "interface": "GigabitEthernet0/0",
            "inputType": "studentManagement",
            "isManagementInterface": true,     // 🆕 NEW: Marks management interface
            "isVlanInterface": false,          // 🆕 NEW: Marks VLAN interface
            "vlanIndex": null,
            "interfaceOffset": null
          },
          {
            "name": "gig0_0_vlan_1",
            "interface": "GigabitEthernet0/1",
            "inputType": "studentVlan0",       // VLAN-specific type
            "isManagementInterface": false,    // 🆕 NEW: Not management interface
            "isVlanInterface": true,           // 🆕 NEW: Marks as VLAN interface
            "vlanIndex": 0,                    // Which VLAN this variable belongs to
            "interfaceOffset": 1,              // Interface offset for same VLAN
            "description": "VLAN 1 interface IP"
          },
          {
            "name": "gig0_1_vlan_1",
            "interface": "GigabitEthernet0/2",
            "inputType": "studentVlan0",       // Same VLAN as above
            "isManagementInterface": false,    // 🆕 NEW: Not management interface
            "isVlanInterface": true,           // 🆕 NEW: Marks as VLAN interface
            "vlanIndex": 0,
            "interfaceOffset": 2,              // Different offset for unique IP
            "description": "VLAN 1 secondary interface IP"
          },
          {
            "name": "gig1_0_vlan_2",
            "interface": "GigabitEthernet1/0",
            "inputType": "studentVlan1",       // Different VLAN
            "isManagementInterface": false,    // 🆕 NEW: Not management interface
            "isVlanInterface": true,           // 🆕 NEW: Marks as VLAN interface
            "vlanIndex": 1,
            "interfaceOffset": 1,
            "description": "VLAN 2 interface IP"
          },
          {
            "name": "static_ip",
            "interface": "Loopback0",
            "inputType": "hostOffset",
            "isManagementInterface": false,    // 🆕 NEW: Not management interface
            "isVlanInterface": false,          // 🆕 NEW: Not VLAN interface
            "hostOffset": 5,
            "description": "Static IP using host offset"
          },
          {
            "name": "custom_ip",
            "interface": "Loopback1",
            "inputType": "fullIP",
            "isManagementInterface": false,    // 🆕 NEW: Not management interface
            "isVlanInterface": false,          // 🆕 NEW: Not VLAN interface
            "fullIp": "203.0.113.10",
            "description": "Custom fixed IP"
          }
        ],
        "credentials": {
          "usernameTemplate": "admin",
          "passwordTemplate": "cisco",
          "enablePassword": ""
        }
      }
    ]
  }
}
```

### 2. Enhanced Part Creation Endpoint

**Endpoint**: `POST /v0/parts`

**New Request Structure**:
```json
{
  "labId": "507f1f77bcf86cd799439013",
  "partId": "enhanced-config",
  "title": "Enhanced Network Configuration",
  "description": "Configure management and VLAN interfaces",
  "instructions": "# Part 1: Enhanced Setup\n\n1. Configure management IP\n2. Set VLAN interface IPs\n3. Test connectivity",
  "order": 1,
  "tasks": [
    {
      "taskId": "management-config",
      "name": "Configure Management Interface",
      "description": "Set management interface IP",
      "templateId": "507f1f77bcf86cd799439014",
      "executionDevice": "router1",
      "targetDevices": ["router1"],
      "parameters": {
        "interface": "mgmt0",
        "ip_variable": "mgmt_interface"    // References the management IP variable
      },
      "testCases": [
        {
          "comparison_type": "contains",
          "expected_result": "interface mgmt0"
        }
      ],
      "order": 1,
      "points": 15
    },
    {
      "taskId": "vlan-interface-config",
      "name": "Configure VLAN Interfaces",
      "description": "Set VLAN interface IPs",
      "templateId": "507f1f77bcf86cd799439015",
      "executionDevice": "router1",
      "targetDevices": ["router1"],
      "parameters": {
        "vlan1_interface": "gig0_0_vlan_1",
        "vlan1_secondary": "gig0_1_vlan_1",
        "vlan2_interface": "gig1_0_vlan_2"
      },
      "testCases": [
        {
          "comparison_type": "contains",
          "expected_result": "interface GigabitEthernet0/0"
        }
      ],
      "order": 2,
      "points": 25
    },
    {
      "taskId": "ping-connectivity-test",
      "name": "Ping Connectivity Test",
      "description": "Test connectivity to specified IP addresses",
      "templateId": "507f1f77bcf86cd799439016",
      "executionDevice": "router1",
      "targetDevices": ["router1"],
      "parameters": {
        "target_ip": "router2.loopback0",        // 🆕 IP variable reference
        "external_ip": "8.8.8.8",               // 🆕 Custom IP address
        "internal_target": "192.168.1.10"       // 🆕 Custom internal IP
      },
      "testCases": [
        {
          "comparison_type": "contains",
          "expected_result": "Success rate is 100 percent"
        }
      ],
      "order": 3,
      "points": 20
    }
  ],
  "task_groups": [],
  "prerequisites": [],
  "totalPoints": 60
}
```

## 🆕 Frontend IP Parameter Feature (Issue #8)

### New Task Template Parameter Support

**Frontend Enhancement**: The frontend now supports specialized IP address parameters in task templates. When a task template parameter has `type: "ip_address"`, the frontend provides a user-friendly interface for selecting IP variables or entering custom IP addresses.

#### Parameter Types Supported:
```json
{
  "parameterSchema": [
    {
      "name": "target_ip",
      "type": "ip_address",           // 🆕 Triggers IP parameter selector
      "description": "IP address to ping for connectivity test",
      "required": true
    }
  ]
}
```

#### Frontend Parameter Value Formats:

**1. IP Variable References** (DeviceID.VariableName):
```json
{
  "parameters": {
    "target_ip": "router1.loopback0",     // References device router1, variable loopback0
    "gateway_ip": "switch1.vlan1",        // References device switch1, variable vlan1
    "peer_ip": "router2.gig0_0"           // References device router2, variable gig0_0
  }
}
```

**2. Custom IP Addresses** (Direct IPv4):
```json
{
  "parameters": {
    "external_dns": "8.8.8.8",           // External Internet IP
    "internal_server": "192.168.1.100",  // Internal custom IP
    "test_target": "203.0.113.50"        // Custom test IP
  }
}
```

#### Backend Processing Requirements:

**Variable Reference Resolution**: When receiving a parameter value like `"router1.loopback0"`:
1. Parse the format: `deviceId.variableName`
2. Look up the actual IP value from the device's IP variables
3. Replace the reference with the resolved IP address during task execution

**Custom IP Validation**: When receiving direct IP addresses:
1. Validate IPv4 format
2. Ensure IP is accessible from the lab network (optional security check)
3. Use the IP address directly in task execution

**Example Backend Resolution**:
```javascript
// Frontend sends:
{
  "parameters": {
    "target_ip": "router2.loopback0",
    "external_ip": "8.8.8.8"
  }
}

// Backend resolves to:
{
  "parameters": {
    "target_ip": "10.1.1.2",    // Resolved from router2.loopback0
    "external_ip": "8.8.8.8"    // Used directly
  }
}
```

## 🔧 Backend Storage & Validation Requirements

**⚠️ Note**: This section describes what backend must STORE and VALIDATE, not calculate. IP calculations happen in the frontend when students access the lab.

### 1. Complex Network Mode Storage

The backend must store configuration for three distinct network modes:

#### Fixed VLAN Mode
- **Description**: Traditional VLAN assignment with fixed VLAN IDs
- **Backend Stores**: Direct VLAN ID values from frontend configuration
- **Frontend Calculates**: Student IPs using `studentManagement` and `studentVlanX` types

#### Lecturer Group Mode
- **Description**: VLAN IDs calculated based on group assignments with modifiers
- **Backend Stores**: Base VLAN IDs, group modifiers, and group assignments
- **Frontend Calculates**: Final VLAN IDs using `finalVlanId = baseVlanId + (groupNumber * groupModifier)`, then generates IPs

#### Calculated VLAN Mode
- **Description**: Mathematical VLAN ID calculation using student ID components
- **Backend Stores**: Calculation multipliers for each VLAN
- **Frontend Calculates**: VLAN IDs using `vlanId = (studentIdNumeric * calculationMultiplier) % 4000 + 1`, then generates IPs

### 2. Enhanced Student Generation Algorithm

**⚠️ IMPORTANT**: This algorithm runs in the **FRONTEND** when students access the lab, not during lab creation.

**Algorithm**: `enhanced_base_network_replacement`

**Process Flow** (Frontend execution):
1. Extract student ID components (year, faculty, index) from authenticated user's u_id
2. Generate management IP: `managementNetwork + calculated octets based on student ID`
3. For each VLAN: Generate IP using VLAN base network + student ID calculation
4. Apply interface offsets for multiple interfaces on same VLAN

**Configuration Parameters** (stored in backend, used by frontend):
```javascript
{
  "yearOffset": 61,        // Year component offset (hardcoded in frontend algorithm)
  "facultyCode": "07",     // Faculty identifier (derived from student ID)
  "indexDigits": 4         // Student index digit count (derived from student ID)
}
```

**Backend's Role**: Store the base networks, subnet masks, and multipliers. The backend does **NOT** execute this algorithm.

### 3. IP Variable Processing Types

The backend must **store** these IP variable types (actual IP calculation happens in frontend):

- **`studentManagement`**: Marks interface for management network (frontend calculates IP from managementNetwork + student u_id)
- **`studentVlan0`**, **`studentVlan1`**, **`studentVlan2`**: Marks interface for VLAN-specific IP (frontend calculates IP from VLAN baseNetwork + student u_id)
- **`hostOffset`**: Traditional host offset (frontend calculates IP from managementNetwork + offset)
- **`fullIP`**: Static IP assignment (used as-is, no calculation needed)

**VLAN-Specific Processing**:
```javascript
// Example for studentVlan0 with interfaceOffset
{
  "name": "gig0_0_vlan_1",
  "inputType": "studentVlan0",
  "vlanIndex": 0,
  "interfaceOffset": 1,
  "isStudentGenerated": true
}
```

### 4. Required API Endpoints

**Device Templates**: `GET /v0/device-templates`
**Task Templates**: `GET /v0/task-templates`
**Course Groups**: `GET /v0/courses/{courseId}/groups` (for lecturer_group mode)
**Student Assignments**: `GET /v0/courses/{courseId}/student-groups` (for group allocation)

## 🎯 Advanced Backend Features Required

### 1. Dynamic VLAN Assignment
- Support for 3 distinct VLAN assignment modes
- Real-time VLAN ID calculation based on student/group data
- Validation of VLAN ID ranges (1-4094)

### 1.1. Base Network Duplication Support
- **Frontend Change**: Base network duplication is now allowed across multiple VLANs
- **Rationale**: The IP generation algorithm replaces the second and third octets of the base network, making duplication functionally irrelevant
- **Backend Impact**: Backend should not validate for base network uniqueness across VLANs
- **Use Case**: Multiple VLANs can use the same base network (e.g., `172.16.0.0`) since the student-specific algorithm will generate unique IPs anyway

### 2. Multi-Phase IP Generation
- **Phase 1**: Management IP generation using base network + offsets
- **Phase 2**: VLAN-specific IP generation with lecturer-defined base networks
- **Phase 3**: Interface offset support for multiple IPs per VLAN

### 3. Group Management Integration
- Group assignment validation for lecturer_group mode
- Group modifier application to VLAN calculations
- Student-to-group mapping persistence

### 4. Enhanced Validation Rules
- VLAN ID uniqueness within course/lab scope
- Network overlap detection across VLANs (⚠️ **Note**: Base network duplication is now allowed)
- IP range capacity validation based on subnet masks
- Interface offset boundary checking

### 5. 🆕 IP Parameter Resolution Engine (Issue #8)
- **Variable Reference Parser**: Resolve "deviceId.variableName" format to actual IP addresses
- **IP Address Validator**: Validate custom IPv4 addresses from frontend
- **Dynamic Parameter Substitution**: Replace IP variables during task execution
- **Frontend Integration**: Support for `type: "ip_address"` in task template parameter schemas

#### IP Parameter Resolution Flow:
```javascript
// 1. Frontend sends task with IP parameter
{
  "taskId": "ping-test",
  "parameters": {
    "target_ip": "router1.loopback0"  // Variable reference
  }
}

// 2. Backend resolves during task execution
const deviceId = "router1";
const variableName = "loopback0";
const resolvedIP = lab.devices
  .find(d => d.deviceId === deviceId)
  ?.ipVariables.find(v => v.name === variableName)
  ?.resolvedIP || "10.1.1.1";

// 3. Execute task with resolved IP
executeTask({
  "target_ip": "10.1.1.1"  // Resolved value
});
```

## 🔄 Processing Flow Examples

### Fixed VLAN Mode Processing
```javascript
// Frontend sends:
{
  "mode": "fixed_vlan",
  "vlans": [
    {"vlanId": 100, "baseNetwork": "192.168.1.0", "subnetMask": 24}
  ]
}

// Backend processes:
studentIP = generateIP("192.168.1.0", 24, studentOffset)
vlanAssignment = { vlanId: 100, studentIP: studentIP }
```

### Calculated VLAN Mode Processing
```javascript
// Frontend sends:
{
  "mode": "calculated_vlan",
  "vlans": [
    {"calculationMultiplier": 400, "baseNetwork": "10.0.0.0", "subnetMask": 26}
  ]
}

// Backend processes:
vlanId = (studentId * 400) % 4000 + 1
studentNetwork = calculateNetworkForStudent("10.0.0.0", 26, studentId)
```

## 📋 Database Schema Extensions

### Enhanced Lab Schema
```javascript
{
  network: {
    name: String,
    topology: {
      baseNetwork: String,        // 🆕 CHANGED: Now uses managementNetwork
      subnetMask: Number,         // 🆕 CHANGED: Now uses managementSubnetMask
      allocationStrategy: String  // 'student_id_based' | 'group_based'
    },
    vlanConfiguration: {          // 🆕 NEW: VLAN configuration data
      mode: String,               // 'fixed_vlan' | 'lecturer_group' | 'calculated_vlan'
      vlanCount: Number,
      vlans: [{
        id: String,
        vlanId: Number,           // For fixed_vlan and lecturer_group
        calculationMultiplier: Number, // For calculated_vlan
        baseNetwork: String,
        subnetMask: Number,
        groupModifier: Number,    // For lecturer_group
        isStudentGenerated: Boolean
      }]
    },
    devices: [{
      deviceId: String,
      templateId: String,
      displayName: String,
      ipVariables: [{
        name: String,
        interface: String,
        inputType: String,        // 'studentManagement' | 'studentVlan0' | 'hostOffset' | 'fullIP'
        isManagementInterface: Boolean,  // 🆕 NEW: Management interface flag
        isVlanInterface: Boolean,        // 🆕 NEW: VLAN interface flag
        vlanIndex: Number,               // 🆕 NEW: VLAN index for VLAN interfaces
        interfaceOffset: Number,         // 🆕 NEW: Interface offset for VLAN interfaces
        hostOffset: Number,              // For hostOffset type
        fullIp: String,                  // For fullIP type
        description: String
      }],
      credentials: {
        usernameTemplate: String,
        passwordTemplate: String,
        enablePassword: String
      }
    }]
  }
}
```

### Enhanced IP Variable Schema
```javascript
{
  ipVariables: [{
    name: String,
    interface: String,                    // Full interface name from device template
    inputType: String,                     // 'studentManagement' | 'studentVlan0' | 'hostOffset' | 'fullIP'
    isManagementInterface: Boolean,         // 🆕 NEW: Marks management interface
    isVlanInterface: Boolean,              // 🆕 NEW: Marks VLAN interface
    vlanIndex: Number,                     // Which VLAN this variable belongs to
    interfaceOffset: Number,                // Interface offset within VLAN
    isStudentGenerated: Boolean,
    hostOffset: Number,                    // For hostOffset type
    fullIp: String,                        // For fullIP type (note: lowercase 'p')
    description: String                    // Optional description
  }]
}
```

## 🔧 Implementation Priority

### Phase 1: Core VLAN Processing ⭐ HIGH PRIORITY
- Implement three VLAN mode processors
- Basic student IP generation for each mode
- VLAN assignment validation

### Phase 2: Advanced IP Generation ⭐ MEDIUM PRIORITY
- Interface offset support
- Multi-VLAN IP allocation
- Enhanced student generation algorithm

### Phase 3: Group Integration ⭐ LOWER PRIORITY
- Group assignment management
- Lecturer group modifier processing
- Group-based allocation strategies

### Phase 4: 🆕 IP Parameter Feature Support (Issue #8) ⭐ HIGH PRIORITY
- **Task Template API Enhancement**: Support `type: "ip_address"` in parameter schemas
- **IP Parameter Resolution Engine**: Parse and resolve "deviceId.variableName" references
- **Custom IP Validation**: Validate and process direct IPv4 addresses
- **Frontend Integration**: Ensure lab creation API handles new parameter formats

#### Required API Changes:

**Task Templates Response Enhancement**:
```json
{
  "success": true,
  "data": {
    "templates": [
      {
        "_id": "507f1f77bcf86cd799439016",
        "templateId": "ping_connectivity_test",
        "name": "Ping Connectivity Test",
        "description": "Test network connectivity using ping command",
        "parameterSchema": [
          {
            "name": "target_ip",
            "type": "ip_address",        // 🆕 NEW: Triggers frontend IP selector
            "description": "IP address to ping for connectivity test",
            "required": true
          },
          {
            "name": "count",
            "type": "number",
            "description": "Number of ping packets to send",
            "required": false
          }
        ],
        "defaultTestCases": [
          {
            "comparison_type": "contains",
            "expected_result": "Success rate is 100 percent"
          }
        ]
      }
    ]
  }
}
```

## 🚀 Testing Requirements

### Unit Tests Required
- VLAN ID calculation accuracy for all modes
- IP generation algorithm validation
- Network overlap detection
- Interface offset boundary testing
- 🆕 **IP parameter resolution logic** (deviceId.variableName parsing)
- 🆕 **Custom IP address validation** (IPv4 format checking)

### Integration Tests Required
- Full lab creation with all VLAN modes
- Student assignment processing
- Group-based allocation flows
- API endpoint integration testing
- 🆕 **Task creation with ip_address parameters** (variable references and custom IPs)
- 🆕 **Task execution with IP parameter resolution** (runtime IP substitution)

# TestCases Schema Migration Guide

## 🎯 Overview

This document provides a comprehensive migration guide for updating the `testCases` structure in the NetGrader frontend. The backend has been updated to use a simplified, more flexible test case schema that aligns with the Task Templates structure.

## 📋 Migration Summary

### 🔴 OLD Schema (Remove from frontend)
```typescript
interface OldTestCase {
  name: string;              // Test case name
  condition: string;         // Test condition/command
  points: number;            // Points for this test case
  weight: number;            // Weight in overall task score (0-1)
  timeoutSeconds: number;    // Timeout for execution
}
```

### 🟢 NEW Schema (Update frontend to use)
```typescript
interface NewTestCase {
  comparison_type: string;   // Type of comparison: equals, contains, regex, success, ssh_success, greater_than
  expected_result: any;      // Expected value/result for comparison 
}
```

## 🚀 Breaking Changes Summary

| **Aspect** | **Old Structure** | **New Structure** | **Action Required** |
|------------|-------------------|-------------------|---------------------|
| **Field Names** | `name`, `condition`, `points`, `weight`, `timeoutSeconds` | `comparison_type`, `expected_result` | **Replace all fields** |
| **Test Logic** | Condition-based with Ansible commands | Comparison-based with expected results | **Update test creation UI** |
| **Scoring** | Individual test case points and weights | Simplified comparison validation | **Remove scoring fields from test cases** |
| **Timeout** | Per-test case timeouts | Handled at task/group level | **Remove timeout from test cases** |

---

## 📊 Detailed Field Mapping

### Field Changes

#### ❌ **REMOVED Fields**
```typescript
// These fields no longer exist - remove from all frontend code:
name: string;              // ❌ REMOVED
condition: string;         // ❌ REMOVED  
points: number;            // ❌ REMOVED
weight: number;            // ❌ REMOVED
timeoutSeconds: number;    // ❌ REMOVED
```

#### ✅ **NEW Fields**
```typescript
// Add these new fields to frontend:
comparison_type: string;   // ✅ NEW - Type of comparison to perform
expected_result: any;      // ✅ NEW - What the result should equal/contain
```

### Comparison Types

The `comparison_type` field supports these values:

| **Type** | **Description** | **Example Use Case** |
|----------|----------------|----------------------|
| `equals` | Exact match comparison | Checking if command output equals specific text |
| `contains` | Substring match | Verifying output contains expected text |
| `regex` | Regular expression match | Pattern matching in command output |
| `success` | Command execution success | Verifying command runs without errors |
| `ssh_success` | SSH connection success | Testing network connectivity |
| `greater_than` | Numeric comparison | Checking values exceed threshold |

---

## 🔧 Frontend Migration Steps

### Step 1: Update TypeScript Interfaces

#### Before (Old Interface):
```typescript
interface Task {
  // ... other fields
  testCases: Array<{
    name: string;
    condition: string;
    points: number;
    weight: number;
    timeoutSeconds: number;
  }>;
}
```

#### After (New Interface):
```typescript
interface Task {
  // ... other fields  
  testCases: Array<{
    comparison_type: string;  // equals, contains, regex, success, ssh_success, greater_than
    expected_result: any;     // Expected value/result for comparison
  }>;
}
```

### Step 2: Update Form Components

#### Old Test Case Form:
```typescript
// ❌ Remove this form structure:
<TestCaseForm>
  <Input name="name" label="Test Name" required />
  <Input name="condition" label="Test Condition" required />
  <NumberInput name="points" label="Points" required />
  <NumberInput name="weight" label="Weight (0-1)" required />
  <NumberInput name="timeoutSeconds" label="Timeout (seconds)" required />
</TestCaseForm>
```

#### New Test Case Form:
```typescript  
// ✅ Replace with this form structure:
<TestCaseForm>
  <Select name="comparison_type" label="Comparison Type" required>
    <Option value="equals">Equals</Option>
    <Option value="contains">Contains</Option>
    <Option value="regex">Regex Match</Option>
    <Option value="success">Success</Option>
    <Option value="ssh_success">SSH Success</Option>
    <Option value="greater_than">Greater Than</Option>
  </Select>
  <Input name="expected_result" label="Expected Result" required />
</TestCaseForm>
```

### Step 3: Update API Calls

#### Old API Request:
```typescript
// ❌ Remove this structure from API calls:
const oldTaskData = {
  // ... other fields
  testCases: [
    {
      name: "Hostname Check",
      condition: "show running-config | grep hostname R1", 
      points: 5,
      weight: 1.0,
      timeoutSeconds: 30
    }
  ]
};
```

#### New API Request:
```typescript
// ✅ Replace with this structure:
const newTaskData = {
  // ... other fields
  testCases: [
    {
      comparison_type: "contains",
      expected_result: "hostname R1"
    }
  ]
};
```

### Step 4: Update Default Test Case Generation

#### Old Template Test Case Handling:
```typescript
// ❌ Remove this logic:
function generateTestCasesFromTemplate(template) {
  return template.defaultTestCases?.map(testCase => ({
    name: testCase.name || "Generated Test",
    condition: testCase.condition,
    points: 10, // Default points
    weight: 1.0, // Default weight  
    timeoutSeconds: 30 // Default timeout
  })) || [];
}
```

#### New Template Test Case Handling:
```typescript
// ✅ Replace with this logic:
function generateTestCasesFromTemplate(template) {
  return template.defaultTestCases?.map(testCase => ({
    comparison_type: testCase.comparison_type,
    expected_result: testCase.expected_result
  })) || [];
}
```

---

## 🎨 UI/UX Updates Required

### Form Field Updates

#### 1. **Test Case Creation Interface**
- **Remove**: Name, Condition, Points, Weight, Timeout fields
- **Add**: Comparison Type dropdown, Expected Result input field
- **Update**: Field labels, help text, validation rules

#### 2. **Test Case List Display**
```typescript
// Old display component:
function TestCaseDisplay({ testCase }) {
  return (
    <div>
      <h4>{testCase.name}</h4>
      <p>Condition: {testCase.condition}</p>
      <p>Points: {testCase.points} (Weight: {testCase.weight})</p>
      <p>Timeout: {testCase.timeoutSeconds}s</p>
    </div>
  );
}

// New display component:
function TestCaseDisplay({ testCase }) {
  return (
    <div>
      <h4>{testCase.comparison_type} Comparison</h4>
      <p>Expected: {testCase.expected_result}</p>
    </div>
  );
}
```

#### 3. **Validation Updates**
```typescript
// Old validation:
const oldValidation = {
  name: { required: true, maxLength: 100 },
  condition: { required: true },
  points: { required: true, min: 0 },
  weight: { required: true, min: 0, max: 1 },
  timeoutSeconds: { required: true, min: 1 }
};

// New validation:
const newValidation = {
  comparison_type: { 
    required: true, 
    enum: ['equals', 'contains', 'regex', 'success', 'ssh_success', 'greater_than']
  },
  expected_result: { required: true }
};
```

---

## 🧪 Testing Updates Required

### Test Data Migration

#### Old Test Data:
```typescript
const oldMockTestCase = {
  name: "Hostname Verification",
  condition: "show running-config | grep hostname R1",
  points: 10,
  weight: 1.0,  
  timeoutSeconds: 30
};
```

#### New Test Data:
```typescript  
const newMockTestCase = {
  comparison_type: "contains",
  expected_result: "hostname R1"
};
```

### Component Testing

#### Tests to Update:
1. **Test Case Form Components**
   - Remove tests for old fields (name, condition, points, weight, timeoutSeconds)
   - Add tests for new fields (comparison_type, expected_result)

2. **API Integration Tests**
   - Update mock API responses to use new schema
   - Update request validation tests

3. **Data Flow Tests**
   - Update end-to-end tests for task creation workflow
   - Test template-to-test-case generation

---

## 📖 Reference Examples

### Complete Before/After Examples

#### Task Creation - BEFORE:
```typescript
const taskWithOldTestCases = {
  taskId: "hostname-config",
  name: "Configure Hostname", 
  templateId: "507f1f77bcf86cd799439014",
  executionDevice: "router1",
  targetDevices: ["router1"],
  parameters: { hostname: "R1" },
  testCases: [
    {
      name: "Hostname Check",
      condition: "show running-config | grep hostname R1",
      points: 5,
      weight: 0.5,
      timeoutSeconds: 30
    },
    {
      name: "Version Check", 
      condition: "show version | grep R1",
      points: 10,
      weight: 1.0,
      timeoutSeconds: 45
    }
  ],
  order: 1,
  points: 15
};
```

#### Task Creation - AFTER:
```typescript
const taskWithNewTestCases = {
  taskId: "hostname-config",
  name: "Configure Hostname",
  templateId: "507f1f77bcf86cd799439014", 
  executionDevice: "router1",
  targetDevices: ["router1"],
  parameters: { hostname: "R1" },
  testCases: [
    {
      comparison_type: "contains",
      expected_result: "hostname R1"
    },
    {
      comparison_type: "contains",
      expected_result: "R1"
    }
  ],
  order: 1,
  points: 15  // Note: points moved to task level, not test case level
};
```

---

## ⚠️ Critical Migration Notes

### 1. **Points and Scoring**
- **Old**: Points were defined per test case with weights
- **New**: Points are handled at the **task level** only
- **Action**: Remove all points/weight logic from test case components
- **Action**: Ensure task-level points input is prominently displayed

### 2. **Test Case Naming**
- **Old**: Each test case had a user-defined name
- **New**: Test cases are identified by their comparison type + expected result
- **Action**: Update UI to show comparison type as the identifier
- **Action**: Remove name input fields from test case forms

### 3. **Timeout Handling** 
- **Old**: Each test case had individual timeouts
- **New**: Timeouts are managed at task group level  
- **Action**: Remove timeout fields from test case forms
- **Action**: Ensure task group timeout configuration is available

### 4. **Template Integration**
- **Templates already use the new structure** - no template changes needed
- **Action**: Update test case generation from templates to use new fields
- **Action**: Verify template selection populates comparison_type and expected_result

---

## 🔍 Verification Checklist

After completing the migration, verify these items:

### ✅ **Schema Compliance**
- [ ] All TypeScript interfaces updated to new schema
- [ ] No references to old field names (name, condition, points, weight, timeoutSeconds)  
- [ ] All API calls use comparison_type and expected_result

### ✅ **UI Components**
- [ ] Test case forms use comparison type dropdown
- [ ] Expected result input field present and functional
- [ ] No old field inputs remain (name, condition, points, weight, timeout)
- [ ] Test case display components show new structure

### ✅ **Functionality** 
- [ ] Template test case generation works with new schema
- [ ] Task creation with test cases saves successfully
- [ ] Test case editing updates correct fields
- [ ] Form validation enforces new schema requirements

### ✅ **Testing**
- [ ] All component tests pass with new schema
- [ ] API integration tests use correct request/response format
- [ ] End-to-end task creation workflow works
- [ ] No console errors related to undefined old fields

---

## 🚨 Migration Timeline

### **Phase 1: Preparation**
1. Review this document thoroughly
2. Identify all components that handle testCases  
3. Create migration branch
4. Update TypeScript interfaces

### **Phase 2: Core Updates**  
1. Update test case form components
2. Update test case display components
3. Update API integration layer
4. Update template integration

### **Phase 3: Testing & Validation**
1. Update component tests
2. Update API tests  
3. Run end-to-end testing
4. Verify with backend API

### **Phase 4: Cleanup**
1. Remove all references to old fields
2. Clean up unused validation rules
3. Update documentation
4. Deploy and monitor

---

## 💡 Need Help?

If you encounter issues during migration:

1. **Check the backend API documentation** for the latest schema
2. **Test API endpoints directly** to verify request/response format
3. **Review Task Templates** to see how they structure test cases  
4. **Use browser dev tools** to debug API calls and data flow

The new schema is simpler and more flexible - most migration challenges will be in updating the UI components and removing the old complexity around points, weights, and timeouts.

---

**🎉 Happy Migrating! The new test case structure will make the system much more maintainable and flexible.**
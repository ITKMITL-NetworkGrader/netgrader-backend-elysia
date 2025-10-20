# Submission Endpoints - Frontend Quick Reference

## Overview
Three endpoints for displaying student submission data with different levels of detail:
1. **Lab Overview** - Lightweight dashboard showing all students' current progress
2. **Student History** - All attempts for one student, grouped by part
3. **Submission Details** - Complete grading results for a single submission

---

## 1. Lab Submission Overview

### `GET /v0/submissions/lab/:labId`

**Purpose**: Poll-friendly endpoint for instructor dashboards showing which part each student is working on.

**Query Parameters**:
- `limit` (optional): Max students to return
- `offset` (optional): Skip N students (for pagination)

**Response**:
```typescript
{
  status: "success",
  data: [
    {
      studentId: string,
      studentName: string,
      currentPart: number,           // 1-indexed, shows which part they're on
      totalParts: number,
      progression: string,           // e.g., "3/5" (3 completed, 2 remaining)
      latestSubmissionStatus: "pending" | "running" | "passed" | "failed" | "cancelled",
      latestSubmissionAt: Date
    }
  ],
  total: number,
  limit: number,
  offset: number
}
```

**Key Points**:
- `currentPart` = completed parts + 1 (capped at totalParts if all done)
- Part is "completed" ONLY if at least one submission has 100% score
- Status shows grading result: `"passed"` = 100%, `"failed"` = <100%
- Lightweight - suitable for 5-10 second polling intervals

**Use Case**:
```typescript
// Dashboard table showing all students
const { data } = await fetch(`/v0/submissions/lab/${labId}?limit=50`);
// Display: Student Name | Progress (3/5) | Current Part | Status | Last Submitted
```

---

## 2. Student Submission History

### `GET /v0/submissions/history/lab/:labId/student/:studentId`

**Purpose**: Get all submission attempts for a specific student, grouped by part.

**Response**:
```typescript
{
  status: "success",
  data: [
    {
      partId: string,
      submissionHistory: [
        {
          _id: string,
          attempt: number,              // 1, 2, 3, etc.
          status: "pending" | "running" | "completed" | "failed" | "cancelled",
          score: number,
          totalPoints: number,
          submittedAt: Date,
          startedAt: Date | null,
          completedAt: Date | null
        }
      ]
    }
  ]
}
```

**Key Points**:
- Groups submissions by part
- Shows all attempts (sorted by attempt DESC - latest first)
- Includes scores and timing information
- Use to show student's progression through parts

**Use Case**:
```typescript
// When clicking on a student row, show their detailed history
const { data } = await fetch(`/v0/submissions/history/lab/${labId}/student/${studentId}`);
// Display:
// Part 1: Attempt 1 (Failed, 60/100) | Attempt 2 (Passed, 100/100)
// Part 2: Attempt 1 (Running...)
```

---

## 3. Detailed Submission

### `GET /v0/submissions/detailed/:submissionId`

**Purpose**: Get complete grading results including test cases, debug info, and execution times.

**Response**:
```typescript
{
  status: "success",
  data: {
    _id: string,
    jobId: string,
    studentId: string,
    labId: ObjectId,
    partId: string,
    status: "pending" | "running" | "completed" | "failed" | "cancelled",
    attempt: number,
    ipMappings: Record<string, string>,

    // Timestamps
    submittedAt: Date,
    startedAt: Date | null,
    completedAt: Date | null,

    // Progress tracking
    progressHistory: [
      {
        message: string,
        current_test: string,
        tests_completed: number,
        total_tests: number,
        percentage: number,
        timestamp: Date
      }
    ],

    // Complete grading results
    gradingResult: {
      job_id: string,
      status: "running" | "completed" | "failed" | "cancelled",
      total_points_earned: number,
      total_points_possible: number,
      total_execution_time: number,
      error_message?: string,

      // Individual test results
      test_results: [
        {
          test_name: string,
          status: "passed" | "failed" | "error",
          message: string,
          points_earned: number,
          points_possible: number,
          execution_time: number,
          test_case_results: [
            {
              description: string,
              expected_value: any,
              actual_value: any,
              comparison_type: string,
              status: "passed" | "failed" | "error",
              points_earned: number,
              points_possible: number,
              message: string
            }
          ],
          raw_output?: string,
          debug_info?: {
            enabled: boolean,
            parameters_received?: Record<string, any>,
            registered_variables?: Record<string, any>,
            command_results?: any[],
            validation_details?: any[]
          },
          group_id?: string
        }
      ],

      // Group results (if using task groups)
      group_results: [
        {
          group_id: string,
          title: string,
          status: "passed" | "failed" | "cancelled",
          group_type: "all_or_nothing" | "proportional",
          points_earned: number,
          points_possible: number,
          execution_time: number,
          task_results: [/* same as test_results */],
          message: string,
          rescue_executed: boolean,
          cleanup_executed: boolean
        }
      ],

      created_at: string,
      completed_at?: string,
      cancelled_reason?: string
    }
  }
}
```

**Key Points**:
- Most detailed endpoint - includes everything about a submission
- Shows individual test case results with expected vs actual values
- Includes debug information (if enabled)
- Has progress history showing real-time updates during grading
- Contains IP mappings used for this submission

**Use Case**:
```typescript
// When clicking on a specific submission attempt to see why it failed
const { data } = await fetch(`/v0/submissions/detailed/${submissionId}`);
// Display:
// - Overall score: 85/100
// - Test 1: ✓ Passed (10/10) - VLAN configuration correct
// - Test 2: ✗ Failed (5/10) - Expected IP: 192.168.1.1, Got: 192.168.1.2
// - Execution time: 45.2s
```

---

## Common Workflow

### Instructor Dashboard Flow
```
1. Poll GET /v0/submissions/lab/:labId
   └─> Show table of all students with current progress

2. Click on student row
   └─> GET /v0/submissions/history/lab/:labId/student/:studentId
       └─> Show all attempts for each part

3. Click on specific submission
   └─> GET /v0/submissions/detailed/:submissionId
       └─> Show complete test results and debug info
```

### Example: React Component Structure
```typescript
// Level 1: Dashboard
<LabOverview labId={labId}>
  {students.map(student => (
    <StudentRow
      onClick={() => setSelectedStudent(student.studentId)}
      progression={student.progression}
      status={student.latestSubmissionStatus}
    />
  ))}
</LabOverview>

// Level 2: Student Details Modal
<StudentHistoryModal studentId={selectedStudent} labId={labId}>
  {history.map(part => (
    <PartHistory partId={part.partId}>
      {part.submissionHistory.map(submission => (
        <SubmissionRow
          onClick={() => setSelectedSubmission(submission._id)}
          attempt={submission.attempt}
          score={`${submission.score}/${submission.totalPoints}`}
        />
      ))}
    </PartHistory>
  ))}
</StudentHistoryModal>

// Level 3: Submission Details Modal
<SubmissionDetailsModal submissionId={selectedSubmission}>
  <ScoreSummary
    earned={gradingResult.total_points_earned}
    possible={gradingResult.total_points_possible}
  />
  <TestResults tests={gradingResult.test_results} />
  <DebugInfo debug={gradingResult.test_results[0].debug_info} />
</SubmissionDetailsModal>
```

---

## Performance Tips

| Endpoint | Polling Interval | Data Size | Use Case |
|----------|------------------|-----------|----------|
| Lab Overview | 5-10s | Lightweight | Real-time dashboard |
| Student History | On-demand | Medium | When user clicks student |
| Submission Details | On-demand | Heavy | When user clicks submission |

**Best Practices**:
- Only poll the overview endpoint continuously
- Fetch history/details on user interaction (click events)
- Cache submission details (they don't change after completion)
- Use pagination for classes >50 students

---

## Error Handling

All endpoints return:
```typescript
// Error response
{
  status: "error",
  message: string
}
```

**HTTP Status Codes**:
- `200`: Success
- `500`: Server error (check logs)

**Common Issues**:
- Empty `data` array = No submissions yet for this lab
- `latestSubmissionStatus: "running"` for >10 min = Possible grading service issue
- Missing student names = User not found in database (shows "Unknown Student")

---

## 4. Lab IP Assignment Statistics

### `GET /v0/labs/stats/:id`

**Purpose**: Monitor IP pool capacity and currently assigned management IPs for a lab.

**Response**:
```typescript
{
  success: true,
  message: "Lab IP assignment statistics fetched successfully",
  ipStats: {
    totalIps: number,           // Total usable IPs (2^(32-mask) - 2)
    exemptCount: number,        // Configured exempt IP count
    assignedCount: number,      // Active student sessions
    totalBlocked: number,       // Merged exempt + assigned
    available: number,          // totalIps - totalBlocked
    enrolledStudents: number,   // Students enrolled in course
    sufficient: boolean         // available >= enrolledStudents
  },
  assignedIps: [
    {
      studentId: string,
      studentName: string,
      managementIp: string
    }
  ]
}
```

**Key Points**:
- `sufficient: false` means not all students can access lab simultaneously
- IPs are released when student completes ALL parts with 100% score
- Dynamic assignment: first-come-first-served basis

**Use Case**:
```typescript
// Check capacity before lab starts
const { ipStats } = await fetch(`/v0/labs/stats/${labId}`).then(r => r.json());
if (!ipStats.sufficient) {
  alert(`Only ${ipStats.available} IPs for ${ipStats.enrolledStudents} students`);
}

// Monitor active sessions
const { assignedIps } = await fetch(`/v0/labs/stats/${labId}`).then(r => r.json());
// Display: "12 students active: John (192.168.1.10), Jane (192.168.1.11)..."
```

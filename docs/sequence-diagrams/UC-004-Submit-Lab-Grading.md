# UC-004: Submit Lab for Grading

## Overview
This sequence diagram shows how students submit their lab work for grading, and how the grading job is processed asynchronously by the FastAPI grader backend.

## Mermaid Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Student
    participant Client
    participant Submission API<br/>(Elysia)
    participant SubmissionService
    participant IPGenerator
    participant SessionService
    participant MongoDB
    participant RabbitMQ
    participant Queue Consumer<br/>(FastAPI)
    participant Grading Service<br/>(FastAPI)

    Student->>Client: Submit lab answers
    Client->>Submission API<br/>(Elysia): POST /v0/submissions

    Submission API<br/>(Elysia)->>Submission API<br/>(Elysia): Verify authentication (JWT)

    Submission API<br/>(Elysia)->>SubmissionService: createSubmission(submissionData)

    SubmissionService->>MongoDB: Fetch lab and part details
    MongoDB-->>SubmissionService: Lab and part data

    SubmissionService->>SessionService: Get student's lab session
    SessionService->>MongoDB: Fetch active session
    MongoDB-->>SessionService: Session with Management IP
    SessionService-->>SubmissionService: Session details

    SubmissionService->>IPGenerator: generateJobFromLab()

    IPGenerator->>IPGenerator: Generate Management IPs for all devices
    IPGenerator->>IPGenerator: Calculate VLAN IPs
    IPGenerator->>IPGenerator: Build complete job payload

    IPGenerator-->>SubmissionService: Job payload with all device configs

    SubmissionService->>MongoDB: Create submission record (status: pending)
    MongoDB-->>SubmissionService: Submission created

    SubmissionService->>RabbitMQ: Publish grading job
    RabbitMQ-->>SubmissionService: Job queued

    SubmissionService-->>Submission API<br/>(Elysia): Submission created + jobId
    Submission API<br/>(Elysia)-->>Client: 201 Created + jobId
    Client-->>Student: Submission received, grading in progress

    Note over RabbitMQ,Grading Service<br/>(FastAPI): Grading Execution (Async)

    RabbitMQ->>Queue Consumer<br/>(FastAPI): Consume grading job
    Queue Consumer<br/>(FastAPI)->>Grading Service<br/>(FastAPI): process_grading_job()

    Grading Service<br/>(FastAPI)->>Grading Service<br/>(FastAPI): Detect device types (SNMP)
    Grading Service<br/>(FastAPI)->>Grading Service<br/>(FastAPI): Initialize Nornir connections
    Grading Service<br/>(FastAPI)->>Grading Service<br/>(FastAPI): Execute tasks (ping, command, NAPALM)
    Grading Service<br/>(FastAPI)->>Grading Service<br/>(FastAPI): Evaluate test cases
    Grading Service<br/>(FastAPI)->>Grading Service<br/>(FastAPI): Calculate scores

    Note right of Grading Service<br/>(FastAPI): Progress updates sent<br/>via callbacks (UC-005)

    Grading Service<br/>(FastAPI)->>Submission API<br/>(Elysia): POST /v0/submissions/result
    Submission API<br/>(Elysia)->>SubmissionService: storeGradingResult()
    SubmissionService->>MongoDB: Update submission (status: completed)
    MongoDB-->>SubmissionService: Updated
    SubmissionService-->>Submission API<br/>(Elysia): Result stored
    Submission API<br/>(Elysia)-->>Grading Service<br/>(FastAPI): 200 OK
```

## Key Components

### Elysia Backend Services
- **Submission API**: `src/modules/submissions/index.ts`
- **SubmissionService**: `src/modules/submissions/service.ts`
- **IPGenerator**: `src/modules/submissions/ip-generator.ts`
- **SessionService**: `src/modules/student-lab-sessions/service.ts`

### FastAPI Grader Services
- **Queue Consumer**: `app/services/pipeline/queue_consumer.py`
- **Grading Service**: `app/services/grading/simple_grading_service.py`
- **Nornir Grading Service**: `app/services/grading/nornir_grading_service.py`

### Infrastructure
- **MongoDB**: Submissions collection
- **RabbitMQ**: Asynchronous job queue

## Main Flow
1. Student submits lab work through client
2. Elysia backend creates submission record
3. System generates complete job payload with IP configurations
4. Job is published to RabbitMQ queue
5. FastAPI worker consumes job asynchronously
6. Grader executes network tests (ping, SSH commands, NAPALM operations)
7. Results are calculated and sent back to Elysia backend
8. Submission status updated to "completed"

## Grading Task Types
- **Ping**: Network connectivity tests
- **Command**: SSH CLI commands with output validation
- **NAPALM**: Network device operations (get_interfaces, get_facts, etc.)
- **SSH Test**: SSH connectivity verification
- **Custom**: Instructor-defined tasks

## Error Scenarios
- **Lab not found** (404): Invalid lab ID
- **No active session** (400): Student hasn't started the lab
- **Queue unavailable** (500): RabbitMQ connection error
- **Grading timeout** (500): Tasks exceed execution timeout
- **Device unreachable** (failed): Network device not accessible

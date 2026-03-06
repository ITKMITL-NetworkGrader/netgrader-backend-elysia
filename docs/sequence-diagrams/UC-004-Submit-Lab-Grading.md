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
    participant GNS3Service
    participant IPGenerator
    participant SubmissionService
    participant MongoDB
    participant RabbitMQ
    participant Grading Service<br/>(FastAPI)
    participant Devices<br/>(GNS3)

    Student->>Client: Submit lab answers
    Client->>Submission API<br/>(Elysia): POST /v0/submissions<br/>(with project_id)

    Submission API<br/>(Elysia)->>Submission API<br/>(Elysia): Verify authentication (JWT)
    Submission API<br/>(Elysia)->>MongoDB: Validate Lab & Part (Check Deadlines/Prereqs)

    opt If project_id is provided
        Submission API<br/>(Elysia)->>GNS3Service: getProjectNodes(projectId)
        GNS3Service->>GNS3Service: Fetch assigned GNS3 Server config
        GNS3Service->>Elysia Backend: Return Node List (Name, Console Port, Status)
    end

    Submission API<br/>(Elysia)->>IPGenerator: generateJobFromLab(..., gns3Nodes)
    
    IPGenerator->>IPGenerator: Generate IPs (Management + VLANs)
    IPGenerator->>IPGenerator: Map Device Names to GNS3 Console Ports

    IPGenerator->>IPGenerator: Build Job Payload (Task ID, Template Name, Params)

    Submission API<br/>(Elysia)->>SubmissionService: createSubmission(status: pending)
    SubmissionService->>MongoDB: Insert Submission Record

    Submission API<br/>(Elysia)->>RabbitMQ: Publish Grading Job
    RabbitMQ-->>Submission API<br/>(Elysia): Job Queued

    Submission API<br/>(Elysia)-->>Client: 200 OK + jobId
    Client-->>Student: Grading in progress...

    Note over RabbitMQ,Grading Service<br/>(FastAPI): Async Grading Execution

    RabbitMQ->>Grading Service<br/>(FastAPI): Consume Job

    loop For each Task in Job
        Grading Service<br/>(FastAPI)->>MinIO: Fetch Custom Task Template (YAML)
        MinIO-->>Grading Service<br/>(FastAPI): Return YAML Content
        Grading Service<br/>(FastAPI)->>Grading Service<br/>(FastAPI): Parse Template & Prepare Nornir Task
    end

    loop For each device in job
        Grading Service<br/>(FastAPI)->>Devices<br/>(GNS3): Connect via Console Port / SSH
        Devices<br/>(GNS3)-->>Grading Service<br/>(FastAPI): Connection Established
        Grading Service<br/>(FastAPI)->>Devices<br/>(GNS3): Execute Commands (from Task Template)
        Devices<br/>(GNS3)-->>Grading Service<br/>(FastAPI): Command Output
    end

    Grading Service<br/>(FastAPI)->>Grading Service<br/>(FastAPI): Validate Outputs against Expected Regex/Values
    Grading Service<br/>(FastAPI)->>Grading Service<br/>(FastAPI): Calculate Final Score

    Grading Service<br/>(FastAPI)->>Submission API<br/>(Elysia): POST /v0/submissions/result
    Submission API<br/>(Elysia)->>SubmissionService: storeGradingResult()
    SubmissionService->>MongoDB: Update Submission (status: completed/failed)
    
    SubmissionService-->>Submission API<br/>(Elysia): Result Stored
    Submission API<br/>(Elysia)-->>Grading Service<br/>(FastAPI): 200 OK
```

## Key Components

### Elysia Backend Services
- **Submission API**: `src/modules/submissions/index.ts`
- **GNS3Service**: `src/modules/gns3-student-lab/service.ts`
- **IPGenerator**: `src/modules/submissions/ip-generator.ts` (Handles GNS3 node mapping)
- **SubmissionService**: `src/modules/submissions/service.ts`

### FastAPI Grader Services
- **Location**: `/home/nitruzx/netgrader2025/netgrader-backend-fastapi`
- **Queue Consumer**: `app/services/pipeline/queue_consumer.py`
- **Grading Service**: `app/services/grading/nornir_grading_service.py`
- **Template Service**: Responsible for fetching `custom_templates` from MinIO.

### Infrastructure
- **MongoDB**: Submissions collection
- **MinIO**: Object storage for Custom Task Templates (YAML)
- **RabbitMQ**: Asynchronous job queue
- **GNS3 Server**: Hosts the virtual network devices

## Main Flow
1. Student submits lab work (including GNS3 project ID).
2. Backend retrieves GNS3 node details (specifically **Console Ports**) to allow out-of-band management access.
3. `IPGenerator` creates a job payload containing target device parameters (IPs, VLANs) and GNS3 connection info.
4. Job is queued in RabbitMQ.
5. FastAPI Worker consumes the job.
6. **Worker fetches the required Custom Template (YAML) from MinIO** using the `template_name` provided in the job.
7. Worker connects to devices using the logic defined in the fetched template.
8. Commands were executed and outputs validated.
9. Results sent back to Elysia backend for storage.

## Notes
- **Napalm & SNMP Detection** have been removed in favor of explicit Custom Templates and direct command execution.
- **Console Access**: Critical for initial configuration verification where SSH might not be configured yet.
- **MinIO Fetching**: The **Grading Service** fetches the YAML template at runtime. This ensures the grader always uses the latest version of the template if it was updated in MinIO.

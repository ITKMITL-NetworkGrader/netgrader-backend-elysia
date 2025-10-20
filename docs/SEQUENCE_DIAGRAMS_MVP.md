# NetGrader Backend - MVP Sequence Diagrams

This document contains Mermaid sequence diagrams for the most critical MVP flows in the NetGrader system.

## Core MVP Flows

1. [User Authentication](#1-user-authentication)
2. [Create and Start Lab](#2-create-and-start-lab)
3. [Submit Lab for Grading (End-to-End)](#3-submit-lab-for-grading-end-to-end)
4. [Real-time Progress Monitoring](#4-real-time-progress-monitoring)

---

## 1. User Authentication

### User Login Flow (POST /v0/auth/login)

```mermaid
sequenceDiagram
    participant Client
    participant ElysiaJS
    participant AuthService
    participant MongoDB
    participant LDAP
    participant JWT

    Client->>ElysiaJS: POST /v0/auth/login<br/>{username, password}
    ElysiaJS->>AuthService: authenticateUser(username, password)

    AuthService->>MongoDB: findOne({u_id: username})

    alt User exists in MongoDB
        MongoDB-->>AuthService: User document
        AuthService->>AuthService: Compare password hash

        alt Password correct
            AuthService->>MongoDB: Update lastLogin
            AuthService-->>ElysiaJS: {success: true, user}
        else Password incorrect
            AuthService-->>ElysiaJS: {success: false}
        end
    else User not in MongoDB (First-time login)
        MongoDB-->>AuthService: null
        AuthService->>LDAP: Authenticate(username, password)

        alt LDAP success
            LDAP-->>AuthService: Authenticated
            AuthService->>MongoDB: Create new user
            AuthService-->>ElysiaJS: {success: true, user, isFirstTimeLogin: true}
        else LDAP failed
            LDAP-->>AuthService: Failed
            AuthService-->>ElysiaJS: {success: false}
        end
    end

    alt Authentication successful
        ElysiaJS->>JWT: sign({u_id, fullName, role})
        JWT-->>ElysiaJS: JWT token
        ElysiaJS->>ElysiaJS: Set auth_token cookie
        ElysiaJS-->>Client: {success: true, token, user}
    else Authentication failed
        ElysiaJS-->>Client: {success: false, message} [401]
    end
```

---

## 2. Create and Start Lab

### Create Lab (POST /v0/labs/)

```mermaid
sequenceDiagram
    participant Instructor
    participant ElysiaJS
    participant LabService
    participant MongoDB

    Instructor->>ElysiaJS: POST /v0/labs/<br/>{courseId, title, network config, parts}
    ElysiaJS->>ElysiaJS: Verify role (INSTRUCTOR/ADMIN)
    ElysiaJS->>LabService: createLab(labData, u_id)
    LabService->>MongoDB: Create lab document
    MongoDB-->>LabService: Saved lab
    LabService-->>ElysiaJS: Lab
    ElysiaJS-->>Instructor: {success: true, data: lab} [201]
```

### Start Lab - Student Gets Network Configuration (POST /v0/labs/:id/start)

```mermaid
sequenceDiagram
    participant Student
    participant ElysiaJS
    participant LabService
    participant IPGenerator
    participant StudentLabSessionService
    participant MongoDB

    Student->>ElysiaJS: POST /v0/labs/:id/start
    ElysiaJS->>LabService: getLabById(id)
    LabService->>MongoDB: findById(id)
    MongoDB-->>LabService: Lab document
    LabService-->>ElysiaJS: Lab

    ElysiaJS->>IPGenerator: generateStudentNetworkConfiguration(lab, u_id)
    IPGenerator->>StudentLabSessionService: findOrCreateSession(labId, u_id)
    StudentLabSessionService->>MongoDB: Find or create session
    MongoDB-->>StudentLabSessionService: Session with assigned management IP
    StudentLabSessionService-->>IPGenerator: Session

    IPGenerator->>IPGenerator: Generate IP mappings for all devices
    IPGenerator->>IPGenerator: Generate VLAN mappings
    IPGenerator-->>ElysiaJS: {sessionInfo, managementIp, ipMappings, vlanMappings}

    ElysiaJS-->>Student: {<br/>  success: true,<br/>  labTitle: "Lab 1",<br/>  managementIp: "10.1.1.5",<br/>  ipMappings: {device1: "192.168.1.1"},<br/>  vlanMappings: {vlan1: 100}<br/>}
```

---

## 3. Submit Lab for Grading (End-to-End)

### Complete Grading Flow - From Submission to Result

```mermaid
sequenceDiagram
    participant Student
    participant ElysiaJS
    participant LabService
    participant IPGenerator
    participant SubmissionService
    participant MongoDB
    participant RabbitMQ
    participant FastAPIWorker
    participant NornirGrader
    participant NetworkDevices
    participant SSEService

    Note over Student,NetworkDevices: Phase 1: Submit Grading Job
    Student->>ElysiaJS: POST /v0/submissions/<br/>{lab_id, part_id}
    ElysiaJS->>LabService: getLabById(lab_id)
    LabService-->>ElysiaJS: Lab

    ElysiaJS->>IPGenerator: generateJobFromLab(lab, part, u_id, jobId)
    IPGenerator->>IPGenerator: Build device list with student IPs
    IPGenerator->>IPGenerator: Build task list with test cases
    IPGenerator-->>ElysiaJS: jobPayload {job_id, devices, tasks, ip_mappings}

    ElysiaJS->>SubmissionService: createSubmission({jobId, studentId, labId, partId})
    SubmissionService->>MongoDB: Create submission
    MongoDB-->>SubmissionService: Submission

    ElysiaJS->>RabbitMQ: sendToQueue(jobPayload)
    RabbitMQ-->>ElysiaJS: Queued
    ElysiaJS-->>Student: {status: "success", job_id, submission_id}

    Note over RabbitMQ,NetworkDevices: Phase 2: FastAPI Worker Processes Job
    RabbitMQ->>FastAPIWorker: Job message delivered
    FastAPIWorker->>FastAPIWorker: Parse GradingJob

    FastAPIWorker->>ElysiaJS: POST /v0/submissions/started {job_id}
    ElysiaJS->>MongoDB: Update status = "running"
    ElysiaJS->>SSEService: sendStarted(job_id)
    SSEService-->>Student: SSE: Job started

    FastAPIWorker->>NornirGrader: Initialize inventory with job.devices
    FastAPIWorker->>NornirGrader: Execute tasks

    loop For each task in job.part.network_tasks
        NornirGrader->>NetworkDevices: SSH/SNMP command
        NetworkDevices-->>NornirGrader: Output
        NornirGrader->>NornirGrader: Compare with test cases
        NornirGrader-->>FastAPIWorker: Task result {status, points}

        FastAPIWorker->>ElysiaJS: POST /v0/submissions/progress<br/>{job_id, percentage, current_test}
        ElysiaJS->>MongoDB: Update progress
        ElysiaJS->>SSEService: sendProgress(job_id)
        SSEService-->>Student: SSE: 40% complete
    end

    Note over FastAPIWorker,Student: Phase 3: Final Results
    FastAPIWorker->>FastAPIWorker: Calculate final score
    FastAPIWorker->>ElysiaJS: POST /v0/submissions/result<br/>{job_id, status, test_results, total_points}
    ElysiaJS->>MongoDB: Store grading result
    ElysiaJS->>SSEService: sendResult(job_id)
    SSEService-->>Student: SSE: Final result {status: "completed", points: 85/100}

    ElysiaJS-->>FastAPIWorker: {status: "received"}
    FastAPIWorker->>RabbitMQ: ACK message
```

---

## 4. Real-time Progress Monitoring

### Student Connects to SSE Stream for Live Updates

```mermaid
sequenceDiagram
    participant Student
    participant ElysiaJS
    participant SSEService
    participant FastAPIWorker
    participant MongoDB

    Note over Student,MongoDB: Student opens SSE connection immediately after submitting
    Student->>ElysiaJS: GET /v0/submissions/:jobId/stream
    ElysiaJS->>MongoDB: Verify submission exists
    MongoDB-->>ElysiaJS: Submission found

    ElysiaJS->>ElysiaJS: Create ReadableStream
    ElysiaJS->>SSEService: addClient(jobId, controller)
    SSEService->>SSEService: Register client in Map<jobId, controller[]>

    ElysiaJS-->>Student: SSE: event: connected<br/>{jobId, status, message}

    loop Every 30 seconds
        ElysiaJS-->>Student: SSE: keepalive
    end

    Note over FastAPIWorker,Student: FastAPI posts updates during grading
    FastAPIWorker->>ElysiaJS: POST /v0/submissions/progress<br/>{job_id, percentage: 20, current_test: "Ping test"}
    ElysiaJS->>SSEService: sendProgress(jobId, data)
    SSEService->>SSEService: Get all controllers for jobId
    SSEService-->>Student: SSE: event: progress<br/>{percentage: 20, current_test: "Ping test"}

    FastAPIWorker->>ElysiaJS: POST /v0/submissions/progress<br/>{job_id, percentage: 60, current_test: "OSPF config"}
    ElysiaJS->>SSEService: sendProgress(jobId, data)
    SSEService-->>Student: SSE: event: progress<br/>{percentage: 60, current_test: "OSPF config"}

    FastAPIWorker->>ElysiaJS: POST /v0/submissions/result<br/>{job_id, status: "completed", total_points_earned: 85}
    ElysiaJS->>SSEService: sendResult(jobId, result)
    SSEService-->>Student: SSE: event: result<br/>{status: "completed", points: 85/100, test_results: [...]}

    Student->>ElysiaJS: Close SSE connection
    ElysiaJS->>SSEService: removeClient(jobId, controller)
```

---

## MVP Architecture Overview

```mermaid
graph TB
    subgraph "Client Layer"
        Student[Student Browser]
        Instructor[Instructor Browser]
    end

    subgraph "ElysiaJS Backend - Main API"
        API[REST API Endpoints]
        Auth[Authentication]
        SSE[SSE Service]
        RMQ_Pub[RabbitMQ Publisher]
    end

    subgraph "Data Layer"
        MongoDB[(MongoDB)]
        RabbitMQ[RabbitMQ Queue]
    end

    subgraph "FastAPI Worker"
        Consumer[Queue Consumer]
        Grader[Nornir Grading Service]
        Callback[API Callback Client]
    end

    subgraph "Network Infrastructure"
        Devices[Student Network Devices<br/>Routers, Switches]
    end

    Student -->|HTTP/SSE| API
    Instructor -->|HTTP| API
    API -->|JWT Auth| Auth
    API -->|CRUD| MongoDB
    API -->|Publish Jobs| RMQ_Pub
    RMQ_Pub -->|Job Messages| RabbitMQ

    RabbitMQ -->|Consume Jobs| Consumer
    Consumer -->|Process| Grader
    Grader -->|SSH/SNMP| Devices
    Grader -->|Results| Callback
    Callback -->|POST Progress/Results| API
    API -->|Broadcast Updates| SSE
    SSE -->|Real-time Events| Student

    style Student fill:#e1f5ff
    style Instructor fill:#e1f5ff
    style MongoDB fill:#00ed64
    style RabbitMQ fill:#ff6600
    style Devices fill:#ffd700
```

---

## Key MVP Features Demonstrated

1. **Authentication Flow**: MongoDB + LDAP fallback for first-time users
2. **Lab Creation**: Instructors create labs with network topology
3. **Lab Start**: Students get personalized IP addresses and network configuration
4. **Job Submission**: Student triggers grading, job queued to RabbitMQ
5. **Background Processing**: FastAPI worker consumes jobs and grades in background
6. **Real-time Updates**: SSE streams progress from worker to student
7. **Grading Results**: Complete test results stored and delivered in real-time

These 4 core flows represent the MVP functionality of the NetGrader system.

# UC-005: Monitor Grading Progress in Real-time

## Overview
This sequence diagram shows how students receive real-time updates about their grading progress using Server-Sent Events (SSE).

## Mermaid Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Student
    participant Client
    participant Submission API<br/>(Elysia)
    participant SSE Service
    participant Grading Service<br/>(FastAPI)
    participant MongoDB

    Student->>Client: View submission progress
    Client->>Submission API<br/>(Elysia): GET /v0/submissions/:jobId/stream
    Submission API<br/>(Elysia)->>SSE Service: addClient(jobId, stream)
    SSE Service-->>Submission API<br/>(Elysia): Client registered
    Submission API<br/>(Elysia)-->>Client: SSE connection established
    Client-->>Student: Show progress UI (0%)

    Note over Grading Service<br/>(FastAPI),Client: Grading Started

    Grading Service<br/>(FastAPI)->>Submission API<br/>(Elysia): POST /v0/submissions/started
    Submission API<br/>(Elysia)->>MongoDB: Update submission (status: running)
    MongoDB-->>Submission API<br/>(Elysia): Updated
    Submission API<br/>(Elysia)->>SSE Service: sendStarted(jobId, "Grading started")
    SSE Service-->>Client: event: started<br/>data: {status: "running"}
    Client-->>Student: Update progress (5%) "Initializing..."

    Note over Grading Service<br/>(FastAPI),Client: Task Progress Updates

    loop For each task
        Grading Service<br/>(FastAPI)->>Grading Service<br/>(FastAPI): Execute task (ping/command/NAPALM)
        Grading Service<br/>(FastAPI)->>Submission API<br/>(Elysia): POST /v0/submissions/progress
        Submission API<br/>(Elysia)->>MongoDB: Append progress to history
        MongoDB-->>Submission API<br/>(Elysia): Updated
        Submission API<br/>(Elysia)->>SSE Service: sendProgress(jobId, progress)
        SSE Service-->>Client: event: progress<br/>data: {percentage: 35%, message: "Task 3/10"}
        Client-->>Student: Update progress bar and message
    end

    Note over Grading Service<br/>(FastAPI),Client: Grading Completed

    Grading Service<br/>(FastAPI)->>Submission API<br/>(Elysia): POST /v0/submissions/result
    Submission API<br/>(Elysia)->>MongoDB: Update submission (status: completed, results)
    MongoDB-->>Submission API<br/>(Elysia): Updated
    Submission API<br/>(Elysia)->>SSE Service: sendResult(jobId, gradingResult)
    SSE Service-->>Client: event: completed<br/>data: {points: 85/100, test_results: [...]}
    Client-->>Student: Show final results (100%)

    SSE Service->>SSE Service: Close connection after 500ms
    SSE Service-->>Client: Connection closed
    Client->>Client: Redirect to results page
```

## Key Components

### Elysia Backend Services
- **Submission API**: `src/modules/submissions/index.ts`
- **SSE Service**: `src/services/sse-emitter.ts`

### FastAPI Grader Services
- **Grading Service**: `app/services/grading/simple_grading_service.py`
- **API Client**: `app/services/connectivity/api_client.py`

### Infrastructure
- **MongoDB**: Submissions collection (stores progress history)
- **SSE**: Server-Sent Events for real-time push

## Main Flow
1. Client opens SSE stream to monitor specific job
2. SSE Service registers client for that job ID
3. When grading starts, FastAPI sends callback to Elysia
4. Elysia broadcasts "started" event to all connected clients
5. For each completed task, progress update is sent
6. Client receives real-time percentage and status messages
7. When grading completes, final results are sent
8. SSE connection closes after 500ms delay

## SSE Event Types
- **started**: Grading has begun (status: "running")
- **progress**: Task progress update (percentage, message, current test)
- **completed**: Grading finished (final results with points)
- **error**: Grading failed (error message)

## Progress Stages
1. **0%**: Initial connection
2. **5%**: Device detection and initialization
3. **5-99%**: Individual task execution
4. **100%**: All tasks completed, results ready

## Key Features
- **Real-time updates**: No polling required
- **Multiple clients**: Multiple browser tabs can watch same job
- **Channel-based**: Each jobId has its own channel
- **Automatic cleanup**: Connections closed after completion
- **Progress history**: Stored in MongoDB for review

## Error Scenarios
- **Connection lost**: Client can reconnect and continue receiving updates
- **Grading timeout**: Error event sent via SSE
- **Invalid jobId** (404): SSE stream not established

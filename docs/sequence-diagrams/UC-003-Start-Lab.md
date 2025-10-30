# UC-003: Start Lab (Get Network Configuration)

## Overview
This sequence diagram shows how students start a lab and receive their personalized network configuration with unique IP assignments.

## Mermaid Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Student
    participant Client
    participant Lab API
    participant SessionService
    participant MongoDB
    participant IPGenerator

    Student->>Client: Click "Start Lab"
    Client->>Lab API: POST /v0/labs/:id/start

    Lab API->>Lab API: Verify student authentication (JWT)

    Lab API->>MongoDB: Fetch lab document
    MongoDB-->>Lab API: Lab details

    Lab API->>Lab API: Verify lab is published
    Lab API->>Lab API: Check availability window

    alt Lab not available
        Lab API-->>Client: 403 Forbidden
        Client-->>Student: Lab not available yet
    else Lab available
        Lab API->>SessionService: getOrCreateSession(studentId, labId)

        SessionService->>MongoDB: Find active session

        alt Active session exists
            MongoDB-->>SessionService: Existing session with IP
            SessionService-->>Lab API: Return existing session
        else No active session
            MongoDB-->>SessionService: No session found

            SessionService->>SessionService: Calculate available Management IP

            SessionService->>MongoDB: Create new session with unique IP

            alt IP already assigned (race condition)
                MongoDB-->>SessionService: Duplicate IP error
                SessionService->>SessionService: Retry with exponential backoff
                SessionService->>MongoDB: Create session with new IP
                MongoDB-->>SessionService: Session created
            else IP available
                MongoDB-->>SessionService: Session created
            end

            SessionService-->>Lab API: New session with Management IP
        end

        Lab API->>IPGenerator: generateStudentNetworkConfiguration()

        IPGenerator->>IPGenerator: Generate Management IPs for devices
        IPGenerator->>IPGenerator: Calculate VLAN IPs based on topology
        IPGenerator->>IPGenerator: Build complete network config

        IPGenerator-->>Lab API: Complete network configuration

        Lab API-->>Client: 200 OK + network config
        Client-->>Student: Show network topology with IPs
    end
```

## Key Components

### Services
- **Lab API**: `src/modules/labs/index.ts`
- **SessionService**: `src/modules/student-lab-sessions/service.ts`
- **IPGenerator**: `src/modules/submissions/ip-generator.ts`
- **MongoDB**: Labs and student_lab_sessions collections

### Main Flow
1. Student requests to start a lab
2. System verifies lab is published and within availability window
3. System checks for existing active session
4. If no session exists, calculates and assigns unique Management IP
5. System generates complete network configuration (Management + VLAN IPs)
6. Returns personalized network topology to student

### IP Assignment
- Each student gets a unique Management IP from the base network
- VLAN IPs are calculated based on VLAN configuration mode:
  - **Fixed VLAN**: Predefined VLAN IDs
  - **Lecturer Group**: VLAN based on student group
  - **Calculated VLAN**: VLAN calculated using multipliers

### Error Scenarios
- **Lab not available** (403): Outside availability window or not published
- **Unauthorized** (401): Student not authenticated
- **IP exhaustion** (500): No available IPs in pool
- **Race condition**: Handled by retry with exponential backoff

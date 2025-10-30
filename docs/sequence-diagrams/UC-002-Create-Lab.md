# UC-002: Create Lab

## Overview
This sequence diagram shows how instructors create a new lab with network topology, VLAN configuration, and device setup.

## Mermaid Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Instructor
    participant Client
    participant Lab API
    participant LabService
    participant VlanValidator
    participant MongoDB
    participant EnrollmentService

    Instructor->>Client: Design lab (network topology, devices, tasks)
    Client->>Lab API: POST /v0/labs

    Lab API->>Lab API: Verify instructor role (JWT)

    Lab API->>LabService: createLab(labData)

    LabService->>VlanValidator: Validate VLAN configuration

    alt Invalid VLAN config
        VlanValidator-->>LabService: Validation error
        LabService-->>Lab API: Error details
        Lab API-->>Client: 400 Bad Request
        Client-->>Instructor: Configuration error
    else Valid configuration
        VlanValidator-->>LabService: Validation passed

        LabService->>VlanValidator: Validate exempt IP ranges

        alt Invalid IP ranges
            VlanValidator-->>LabService: Validation error
            LabService-->>Lab API: Error details
            Lab API-->>Client: 400 Bad Request
            Client-->>Instructor: IP range error
        else Valid IP ranges
            VlanValidator-->>LabService: Validation passed

            LabService->>MongoDB: Create lab document
            MongoDB-->>LabService: Lab created

            LabService->>EnrollmentService: Get enrolled student count
            EnrollmentService->>MongoDB: Count enrollments for course
            MongoDB-->>EnrollmentService: Student count
            EnrollmentService-->>LabService: Student count

            LabService->>LabService: Calculate IP capacity

            alt Insufficient IP capacity
                LabService->>MongoDB: Delete lab (rollback)
                LabService-->>Lab API: Error: Not enough IPs
                Lab API-->>Client: 400 Bad Request
                Client-->>Instructor: Capacity error
            else Sufficient capacity
                LabService-->>Lab API: Lab created successfully
                Lab API-->>Client: 201 Created + lab details
                Client-->>Instructor: Lab created successfully
            end
        end
    end
```

## Key Components

### Services
- **Lab API**: `src/modules/labs/index.ts`
- **LabService**: `src/modules/labs/service.ts`
- **VlanValidator**: `src/utils/vlan-validator.ts`
- **EnrollmentService**: `src/modules/enrollments/service.ts`
- **MongoDB**: Labs and enrollments collections

### Main Flow
1. Instructor designs lab with network topology and devices
2. System validates VLAN configuration
3. System validates exempt IP ranges
4. Lab document is created in MongoDB
5. System checks if IP capacity is sufficient for enrolled students
6. If capacity is insufficient, lab creation is rolled back

### Error Scenarios
- **Invalid VLAN configuration** (400): VLAN settings don't meet requirements
- **Invalid IP ranges** (400): Exempt ranges overlap or invalid format
- **Insufficient IP capacity** (400): Not enough IPs for enrolled students
- **Unauthorized** (401): Non-instructor attempting to create lab

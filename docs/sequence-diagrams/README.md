# NetGrader Sequence Diagrams

This directory contains sequence diagrams for the core use cases of the NetGrader system.

## Overview

NetGrader is a network lab grading system with two main components:
- **Elysia Backend** (Bun + ElysiaJS): Main API server handling authentication, lab management, and submissions
- **FastAPI Grader** (Python): Worker service that executes grading tasks on network devices

## Use Cases

### UC-001: User Authentication
**File**: [UC-001-User-Authentication.md](./UC-001-User-Authentication.md) | [UC-001-User-Authentication.puml](./UC-001-User-Authentication.puml)

Shows how users authenticate using MongoDB credentials or LDAP, with automatic user creation on first LDAP login.

**Key Features**:
- Dual authentication (MongoDB + LDAP)
- JWT token generation
- httpOnly cookie security

---

### UC-002: Create Lab
**File**: [UC-002-Create-Lab.md](./UC-002-Create-Lab.md) | [UC-002-Create-Lab.puml](./UC-002-Create-Lab.puml)

Shows how instructors create labs with network topology, VLAN configuration, and device setup.

**Key Features**:
- VLAN configuration validation
- IP range validation
- IP capacity calculation
- Automatic rollback on errors

---

### UC-003: Start Lab (Get Network Configuration)
**File**: [UC-003-Start-Lab.md](./UC-003-Start-Lab.md) | [UC-003-Start-Lab.puml](./UC-003-Start-Lab.puml)

Shows how students start a lab and receive their personalized network configuration with unique IP assignments.

**Key Features**:
- Session management with unique IP assignment
- Race condition handling with retry logic
- Dynamic IP generation (Management + VLAN IPs)
- Lab availability window verification

---

### UC-004: Submit Lab for Grading
**File**: [UC-004-Submit-Lab-Grading.md](./UC-004-Submit-Lab-Grading.md) | [UC-004-Submit-Lab-Grading.puml](./UC-004-Submit-Lab-Grading.puml)

Shows how students submit their lab work and how the grading job is processed asynchronously by the FastAPI grader backend.

**Key Features**:
- Asynchronous grading via RabbitMQ
- Complete job payload generation
- Device type detection (SNMP)
- Multiple task types (ping, command, NAPALM, SSH, custom)

---

### UC-005: Monitor Grading Progress in Real-time
**File**: [UC-005-Monitor-Progress-Realtime.md](./UC-005-Monitor-Progress-Realtime.md) | [UC-005-Monitor-Progress-Realtime.puml](./UC-005-Monitor-Progress-Realtime.puml)

Shows how students receive real-time updates about their grading progress using Server-Sent Events (SSE).

**Key Features**:
- Real-time SSE updates
- Multiple concurrent clients supported
- Progress percentage tracking
- Automatic connection cleanup

---

### UC-006: View Submission Results
**File**: [UC-006-View-Submission-Results.md](./UC-006-View-Submission-Results.md) | [UC-006-View-Submission-Results.puml](./UC-006-View-Submission-Results.puml)

Shows how students and instructors view grading results through three different endpoints.

**Key Features**:
- Single submission detail view
- Student submission history
- Instructor lab overview
- Test and group result display

---

## Architecture Components

### Elysia Backend Services
- **Auth API**: User authentication and authorization
- **Lab API**: Lab creation and management
- **Submission API**: Submission handling and results
- **SessionService**: Student lab session management
- **SSE Service**: Real-time event streaming

### FastAPI Grader Services
- **Queue Consumer**: RabbitMQ job consumer
- **Grading Service**: Main grading orchestrator
- **Nornir Grading Service**: Network task executor
- **API Client**: Callback to Elysia backend

### Infrastructure
- **MongoDB**: Primary database
- **RabbitMQ**: Asynchronous job queue
- **LDAP**: External authentication server
- **SSE**: Real-time event streaming

## Diagram Formats

All sequence diagrams are available in two formats:

1. **Mermaid** (.md files) - Can be viewed directly in GitHub, VS Code, and many documentation tools
2. **PlantUML** (.puml files) - Can be rendered using PlantUML tools and integrations

## How to View

### Mermaid Diagrams
- View directly on GitHub (built-in rendering)
- VS Code with Mermaid Preview extension
- Online at [Mermaid Live Editor](https://mermaid.live/)

### PlantUML Diagrams
- VS Code with PlantUML extension
- IntelliJ IDEA with PlantUML integration
- Online at [PlantUML Web Server](http://www.plantuml.com/plantuml/)

## System Flow

```
1. UC-001: User logs in
         ↓
2. UC-002: Instructor creates lab
         ↓
3. UC-003: Student starts lab → receives network config
         ↓
4. UC-004: Student submits work → grading job queued
         ↓
5. UC-005: Student monitors real-time progress
         ↓
6. UC-006: Student/Instructor views results
```

## Key Technologies

- **Backend Framework**: ElysiaJS (Bun runtime)
- **Grader Framework**: FastAPI (Python)
- **Database**: MongoDB with Mongoose ODM
- **Message Queue**: RabbitMQ
- **Real-time**: Server-Sent Events (SSE)
- **Authentication**: JWT + LDAP
- **Network Automation**: Nornir, Netmiko, NAPALM

## Related Documentation

- Main codebase: `/home/chinfair/Documents/netgrader-backend-elysia`
- Grader backend: `/home/chinfair/Documents/netgrader-backend-fastapi`
- Project guidelines: `CLAUDE.md`

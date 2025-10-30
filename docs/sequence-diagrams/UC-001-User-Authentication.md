# UC-001: User Authentication

## Overview
This sequence diagram shows the authentication flow where users can log in using either MongoDB credentials or LDAP authentication.

## Mermaid Diagram

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Client
    participant Auth API
    participant AuthService
    participant MongoDB
    participant LDAP

    User->>Client: Enter credentials
    Client->>Auth API: POST /v0/auth/login
    Auth API->>AuthService: authenticateUser()

    AuthService->>MongoDB: Find user by u_id

    alt User exists in MongoDB
        MongoDB-->>AuthService: User found
        AuthService->>AuthService: Validate password
        AuthService->>AuthService: Generate JWT token
        AuthService-->>Auth API: Return user + token
        Auth API-->>Client: 200 OK + auth cookie
        Client-->>User: Login successful

    else User not found - Try LDAP
        MongoDB-->>AuthService: Not found
        AuthService->>LDAP: Authenticate with LDAP

        alt LDAP Success
            LDAP-->>AuthService: Authentication successful
            AuthService->>MongoDB: Create new user
            MongoDB-->>AuthService: User created
            AuthService->>AuthService: Generate JWT token
            AuthService-->>Auth API: Return user + token
            Auth API-->>Client: 200 OK + auth cookie
            Client-->>User: Login successful
        else LDAP Failed
            LDAP-->>AuthService: Authentication failed
            AuthService-->>Auth API: Error
            Auth API-->>Client: 401 Unauthorized
            Client-->>User: Invalid credentials
        end
    end
```

## Key Components

### Services
- **Auth API**: `src/modules/auth/index.ts`
- **AuthService**: `src/modules/auth/service.ts`
- **MongoDB**: Users collection
- **LDAP**: External LDAP server

### Main Flow
1. User attempts login through client
2. System checks MongoDB for existing user
3. If found: Validates password and generates JWT
4. If not found: Attempts LDAP authentication
5. If LDAP succeeds: Creates new user in MongoDB
6. Returns JWT token in httpOnly cookie

### Error Scenarios
- **Invalid credentials** (401): Wrong password or LDAP failure
- **User not found** (404): No user in MongoDB or LDAP

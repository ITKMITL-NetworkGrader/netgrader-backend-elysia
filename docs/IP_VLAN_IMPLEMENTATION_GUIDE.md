# IP and VLAN Generation - Complete Implementation Guide

**Date:** 2025-10-07
**Status:** ✅ **PRODUCTION READY**
**Version:** 1.0

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [What Was Implemented](#what-was-implemented)
3. [Architecture](#architecture)
4. [API Endpoints](#api-endpoints)
5. [IP Calculation Algorithms](#ip-calculation-algorithms)
6. [Testing Guide](#testing-guide)
7. [Frontend Integration](#frontend-integration)
8. [Troubleshooting](#troubleshooting)

---

## Overview

### Problem Solved

**Before:**
- Students started labs without knowing their Management IP
- VLAN IPs were placeholders (`${studentVlan0:0:1}`)
- Students couldn't configure devices properly
- Management IP only assigned at submission time

**After:**
- Students get complete network configuration when starting lab
- All IPs (Management + VLAN) calculated immediately
- VLAN IDs provided for student configuration
- IPs persist across multiple submissions
- IPs released automatically when lab is 100% complete

---

## What Was Implemented

### 1. IP Calculator Module
**File:** `src/modules/submissions/ip-calculator.ts`

**Functions:**
- ✅ `calculateStudentIdBasedIP()` - Basic student ID algorithm
- ✅ `calculateAdvancedStudentIP()` - Advanced with dec3 modification
- ✅ `calculateStudentVLANs()` - VLAN ID generation
- ✅ `calculateStudentNetworkValues()` - Helper calculations

**Test Coverage:** 17/17 tests passing

### 2. Network Configuration Generator
**File:** `src/modules/submissions/ip-generator.ts`

**New Methods:**
- ✅ `generateStudentNetworkConfiguration()` - Main method for lab start
- ✅ `generateVLANMappings()` - Generate VLAN ID mappings

**Updated Methods:**
- ✅ `generateIP()` - Now calculates actual VLAN IPs (not placeholders)
- ✅ `generateIPMappings()` - Accepts studentId parameter
- ✅ `transformTaskParameters()` - Uses `{{variable}}` format
- ✅ `generateJobFromLab()` - Includes vlan_mappings in payload

### 3. Lab Start Endpoint
**File:** `src/modules/labs/index.ts`

**Endpoint:** `POST /api/labs/:labId/start`

**Features:**
- ✅ Creates/retrieves StudentLabSession
- ✅ Validates lab availability (published, availableFrom, availableUntil)
- ✅ Generates all IPs and VLAN IDs
- ✅ Idempotent (same IPs on repeated calls)
- ✅ Returns complete network configuration

### 4. Session Monitoring Endpoint
**File:** `src/modules/admin/session-cleanup-routes.ts`

**Endpoint:** `GET /admin/sessions/student/:studentId/lab/:labId`

**Features:**
- ✅ Shows session status and IP assignment
- ✅ Tracks part completion progress
- ✅ Predicts if IP will be released
- ✅ Useful for debugging

---

## Architecture

### IP Generation Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Student Clicks "Start Lab"                               │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. POST /api/labs/:labId/start                              │
│    - Check auth, lab published, availability                │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. StudentLabSessionService.getOrCreateSession()            │
│    - Creates session OR returns existing                    │
│    - Assigns Management IP from pool                        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. IPGenerator.generateStudentNetworkConfiguration()        │
│    - Calculates ALL VLAN IPs                                │
│    - Calculates ALL VLAN IDs                                │
│    - Creates ip_mappings and vlan_mappings                  │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Return to Frontend                                        │
│    {                                                         │
│      managementIp: "10.0.1.5",                              │
│      ipMappings: {...},                                      │
│      vlanMappings: {...}                                     │
│    }                                                         │
└──────────────────────────────────────────────────────────────┘
```

### IP Release Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Student Submits Part                                     │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Grading Service Processes                                │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Callback: POST /api/submissions/callback                 │
│    Body: { job_id, status, points_earned, points_possible } │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. SubmissionService.storeGradingResult()                   │
│    - Check: Is score 100%?                                  │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼ (if 100%)
┌─────────────────────────────────────────────────────────────┐
│ 5. areAllPartsCompleted(studentId, labId)                   │
│    - Get all parts for lab                                  │
│    - Check if ALL parts have 100% submission                │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼ (if all complete)
┌─────────────────────────────────────────────────────────────┐
│ 6. StudentLabSessionService.deleteSession()                 │
│    - Delete session → Release IP                            │
│    - Log: "[Session Released] ..."                          │
└──────────────────────────────────────────────────────────────┘
```

---

## API Endpoints

### 1. Start Lab (Student/Instructor/Admin)

**Endpoint:** `POST /api/labs/:labId/start`
**Auth:** Required (STUDENT, INSTRUCTOR, ADMIN)

**Request:**
```bash
curl -X POST "http://localhost:3000/api/labs/507f1f77bcf86cd799439011/start" \
  -H "Authorization: Bearer {JWT_TOKEN}" \
  -H "Content-Type: application/json"
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Lab started successfully",
  "data": {
    "labId": "507f1f77bcf86cd799439011",
    "labTitle": "Advanced Routing Lab",
    "session": {
      "sessionId": "507f1f77bcf86cd799439012",
      "status": "active",
      "startedAt": "2025-10-07T10:30:00.000Z"
    },
    "networkConfiguration": {
      "managementIp": "10.0.1.5",
      "ipMappings": {
        "router1.gig0_0": "10.0.1.5",
        "router1.gig0_1": "172.40.210.66",
        "router1.gig0_2": "172.40.117.67"
      },
      "vlanMappings": {
        "vlan0": 141,
        "vlan1": 241
      }
    }
  }
}
```

**Error Responses:**
- **401:** Authentication required
- **403:** Lab not published / not available yet / expired
- **404:** Lab not found
- **500:** Internal server error

---

### 2. Check Session Status (Admin/Instructor)

**Endpoint:** `GET /admin/sessions/student/:studentId/lab/:labId`
**Auth:** Required (ADMIN, INSTRUCTOR)

**Request:**
```bash
curl "http://localhost:3000/api/admin/sessions/student/65071041/lab/507f1f77bcf86cd799439011" \
  -H "Authorization: Bearer {JWT_TOKEN}"
```

**Response (200 OK - Active Session):**
```json
{
  "status": "success",
  "data": {
    "hasActiveSession": true,
    "session": {
      "sessionId": "507f1f77bcf86cd799439012",
      "managementIp": "10.0.1.5",
      "studentIndex": 5,
      "status": "active",
      "startedAt": "2025-10-07T10:30:00.000Z",
      "lastAccessedAt": "2025-10-07T11:45:00.000Z"
    },
    "progress": {
      "totalParts": 2,
      "completedParts": 1,
      "percentComplete": 50,
      "willReleaseIp": false,
      "parts": [
        {
          "partId": "part1",
          "completed": true,
          "bestScore": "10/10",
          "attempts": 1
        },
        {
          "partId": "part2",
          "completed": false,
          "bestScore": "No submissions",
          "attempts": 0
        }
      ]
    }
  }
}
```

**Response (200 OK - No Session):**
```json
{
  "status": "success",
  "data": {
    "hasActiveSession": false,
    "message": "No active session found for this student-lab combination"
  }
}
```

---

## IP Calculation Algorithms

### 1. Basic Student ID-Based Algorithm

**Used for:** Simple VLAN IPs without multipliers

**Formula:**
```
subnetOffset = studentIdNum % 100
thirdOctet = (baseOctet3 + floor(subnetOffset / 10)) % 256
fourthOctet = min(254, (subnetOffset % 10) * 10 + interfaceOffset)
```

**Example:**
```
Input:
  baseNetwork: "192.168.1.0"
  studentId: "61071234"
  interfaceOffset: 5

Calculation:
  subnetOffset = 61071234 % 100 = 34
  thirdOctet = (1 + floor(34 / 10)) % 256 = (1 + 3) = 4
  fourthOctet = min(254, (34 % 10) * 10 + 5) = min(254, 45) = 45

Output: "192.168.4.45"
```

### 2. Advanced Student-Specific Algorithm

**Used for:** Calculated VLANs with multipliers

**Formula:**
```
dec2 = floor((studentId/1000000 - 61) * 10 + (studentId % 1000) / 250)
dec3 = floor((studentId % 1000) % 250)

// For calculated VLANs with multiplier:
calculatedVlanId = floor((studentId/1000000 - 61) * multiplier + (studentId % 1000))
dec3_modified = floor((dec3 + calculatedVlanId) % 250)

IP = vlanOct1.dec2.dec3_modified.(64 + interfaceOffset)
```

**Example:**
```
Input:
  studentId: "65071041"
  baseNetwork: "172.16.0.0"
  calculationMultiplier: 400
  interfaceOffset: 2

Calculation:
  dec2 = floor((65071041/1000000 - 61) * 10 + (1041) / 250) = 40
  dec3 = floor(1041 % 250) = 41
  calculatedVlanId = floor((4.071041) * 400 + 1041) = 1669
  dec3_modified = floor((41 + 1669) % 250) = 210
  hostAddress = 64 + 2 = 66

Output: "172.40.210.66"
```

### 3. VLAN ID Calculation

**Formula:**
```
baseVLAN = (studentIdNum % 100) + 100
vlans = [baseVLAN, baseVLAN + 100, baseVLAN + 200, ...]
```

**Example:**
```
Input:
  studentId: "65071041"
  vlanCount: 2

Calculation:
  baseVLAN = (1041 % 100) + 100 = 41 + 100 = 141
  vlans = [141, 141 + 100] = [141, 241]

Output: [141, 241]
```

---

## Testing Guide

### Quick Test: Single-Part Lab

```bash
# Variables
export STUDENT_ID="65071041"
export LAB_ID="your_lab_id"
export TOKEN="your_jwt_token"
export BASE_URL="http://localhost:3000/api"

# 1. Start lab
curl -X POST "${BASE_URL}/labs/${LAB_ID}/start" \
  -H "Authorization: Bearer ${TOKEN}"

# Expected: IP assigned (e.g., 10.0.1.5)

# 2. Check session status
curl "${BASE_URL}/admin/sessions/student/${STUDENT_ID}/lab/${LAB_ID}" \
  -H "Authorization: Bearer ${TOKEN}"

# Expected: totalParts: 1, completedParts: 0, willReleaseIp: false

# 3. Submit the part with 100% (via your normal submission flow)
# Wait for grading callback

# 4. Check session status again
curl "${BASE_URL}/admin/sessions/student/${STUDENT_ID}/lab/${LAB_ID}" \
  -H "Authorization: Bearer ${TOKEN}"

# Expected: hasActiveSession: false (IP released!)
```

**Expected Console Logs:**
```
[Lab Start] Student 65071041 - Lab {labId} - Management IP: 10.0.1.5
[Parts Check] Student 65071041 - Lab {labId}: 1/1 parts completed
[Session Released] Student 65071041 completed ALL parts of lab {labId} - IP released
```

### Test Scenarios

#### Scenario 1: Single-Part Lab (100%)
```
1. Start lab → IP: 10.0.1.5
2. Submit part with 100% → Check parts: 1/1 complete
3. Check session → IP RELEASED ✅
```

#### Scenario 2: Multi-Part Lab (Sequential 100%)
```
1. Start lab → IP: 10.0.1.5
2. Submit part1 with 100% → Check: 1/2 complete → IP KEPT
3. Submit part2 with 100% → Check: 2/2 complete → IP RELEASED ✅
```

#### Scenario 3: Partial Score (Should Keep IP)
```
1. Start lab → IP: 10.0.1.5
2. Submit part1 with 80% → IP KEPT (not 100%)
3. Submit part2 with 100% → IP KEPT (part1 still 80%)
4. Retry part1 with 100% → IP RELEASED ✅
```

#### Scenario 4: Re-start After Completion
```
1. Complete all parts → IP released
2. Start lab again → New IP assigned (10.0.1.8)
3. Verify: Different IP than before ✅
```

### Debugging Checklist

- [ ] Check console logs for "Session Released" or "Session Active"
- [ ] Use admin endpoint to see `willReleaseIp` prediction
- [ ] Verify all parts show `completed: true`
- [ ] Verify all scores are perfect (X/X)
- [ ] Check database: session should be deleted
- [ ] Test re-start: should get different IP

---

## Frontend Integration

### Step 1: Call Start Endpoint on Button Click

```typescript
async function handleStartLab(labId: string) {
  try {
    const response = await fetch(`/api/labs/${labId}/start`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getAuthToken()}`,
        'Content-Type': 'application/json'
      }
    });

    const result = await response.json();

    if (!result.success) {
      // Handle errors (not published, not available, etc.)
      showError(result.message);
      return;
    }

    // Store network configuration
    const { managementIp, ipMappings, vlanMappings } =
      result.data.networkConfiguration;

    setNetworkConfig({
      managementIp,
      ipMappings,
      vlanMappings
    });

    // Show success and display network panel
    showNetworkConfigPanel();

  } catch (error) {
    console.error('Failed to start lab:', error);
    showError('Failed to start lab. Please try again.');
  }
}
```

### Step 2: Display Network Configuration

```tsx
function NetworkConfigPanel({ config }: { config: NetworkConfig }) {
  return (
    <div className="network-config-panel">
      <h3>📊 Your Network Configuration</h3>

      <section className="management-ip">
        <h4>Management IP</h4>
        <div className="ip-value">{config.managementIp}</div>
        <p className="help-text">
          Use this IP to access your devices via SSH
        </p>
      </section>

      <section className="vlan-ids">
        <h4>VLAN IDs</h4>
        <div className="vlan-list">
          {Object.entries(config.vlanMappings).map(([key, vlanId]) => (
            <div key={key} className="vlan-item">
              <span className="vlan-key">{key}:</span>
              <span className="vlan-id">VLAN {vlanId}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="device-ips">
        <h4>Device IP Addresses</h4>
        <table className="ip-table">
          <thead>
            <tr>
              <th>Device.Interface</th>
              <th>IP Address</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(config.ipMappings).map(([device, ip]) => (
              <tr key={device}>
                <td><code>{device}</code></td>
                <td>{ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="action-buttons">
        <button onClick={() => copyToClipboard(config)}>
          📋 Copy Configuration
        </button>
        <button onClick={() => downloadConfig(config)}>
          💾 Download Config
        </button>
      </div>
    </div>
  );
}
```

### Step 3: Remove Local IP Calculation

**Before (❌ Delete this):**
```typescript
// OLD: Frontend calculated IPs locally
const vlanIps = calculateVlanIPs(studentId, vlanConfig);
const managementIp = '???'; // Unknown until submission
```

**After (✅ Use backend values):**
```typescript
// NEW: Backend calculates ALL IPs
const { managementIp, ipMappings, vlanMappings } = await startLab(labId);
// Trust these values completely!
```

---

## Troubleshooting

### Issue 1: IP Not Released After 100%

**Symptoms:**
- Student completes all parts with 100%
- Session still shows as active

**Debug Steps:**
```bash
# Check session status
curl "${BASE_URL}/admin/sessions/student/${STUDENT_ID}/lab/${LAB_ID}" \
  -H "Authorization: Bearer ${TOKEN}"
```

**Look for:**
- `willReleaseIp: false` → One part is not truly 100%
- Check `parts` array: Any show `completed: false`?
- Check `bestScore`: Should be "X/X" (perfect)

**Common Causes:**
- Grading callback sent wrong points
- One part has score < 100%
- Database not updated correctly

**Solution:**
- Verify grading callback: `total_points_earned === total_points_possible`
- Check console logs for "[Parts Check]" messages
- Manually check submissions in database

---

### Issue 2: "No Active Session" on Start Lab

**Symptoms:**
- Call `/labs/:labId/start`
- Response shows no session or error

**Debug Steps:**
1. Check if lab is published: `lab.publishedAt` must be set
2. Check availability window: `availableFrom` and `availableUntil`
3. Check authentication: Valid JWT token?

**Solution:**
- Publish the lab first
- Set correct availability dates
- Use valid student token

---

### Issue 3: Same IP After Completion

**Symptoms:**
- Student completes lab (IP released)
- Starts lab again
- Gets SAME IP as before

**This is a BUG!** Should get new IP.

**Debug:**
```bash
# Check if session was actually deleted
db.studentlabsessions.find({
  studentId: "65071041",
  labId: ObjectId("..."),
  status: "active"
})
```

**Solution:**
- Verify session deletion occurred
- Check IP allocation logic in `StudentLabSessionService`

---

### Issue 4: VLAN IDs Not Appearing

**Symptoms:**
- `vlanMappings: {}`
- Empty VLAN IDs in response

**Debug:**
- Check lab has `vlanConfiguration` defined
- Check `vlanConfiguration.mode === 'calculated_vlan'`
- Check console logs for errors

**Solution:**
- Lab must have VLAN configuration
- Mode must be `calculated_vlan` for student ID-based VLANs

---

## File Structure

### Core Implementation Files
```
src/modules/submissions/
├── ip-calculator.ts              ← IP calculation algorithms
├── ip-calculator.test.ts         ← 17 tests (all passing)
└── ip-generator.ts               ← Network config generator

src/modules/labs/
└── index.ts                      ← Lab start endpoint

src/modules/admin/
└── session-cleanup-routes.ts    ← Session monitoring endpoint

src/modules/student-lab-sessions/
├── model.ts                      ← Session model
└── service.ts                    ← Session management
```

### Documentation Files
```
IP_VLAN_GENERATION_ALGORITHMS.md  ← Algorithm specification (KEEP)
IP_VLAN_IMPLEMENTATION_GUIDE.md   ← This file (KEEP)
CLAUDE.md                          ← Project instructions (KEEP)
```

---

## Summary

### ✅ What Works

1. **IP Generation:**
   - ✅ Management IPs assigned on lab start
   - ✅ VLAN IPs calculated using student ID algorithms
   - ✅ VLAN IDs generated correctly
   - ✅ All calculations match frontend spec exactly

2. **Session Management:**
   - ✅ Sessions persist across multiple submissions
   - ✅ IPs released when ALL parts are 100%
   - ✅ Works for single-part and multi-part labs
   - ✅ New IPs assigned on lab restart

3. **API Endpoints:**
   - ✅ Lab start endpoint (`POST /labs/:labId/start`)
   - ✅ Session monitoring endpoint (`GET /admin/sessions/...`)
   - ✅ Proper authentication and authorization
   - ✅ Comprehensive error handling

4. **Testing:**
   - ✅ 17/17 unit tests passing
   - ✅ No TypeScript errors
   - ✅ Manual testing guide provided
   - ✅ Debug endpoints available

### 🚀 Ready for Production

The implementation is complete, tested, and ready for frontend integration!

---

**For questions or issues, refer to:**
- Algorithm details: `IP_VLAN_GENERATION_ALGORITHMS.md`
- This guide: `IP_VLAN_IMPLEMENTATION_GUIDE.md`
- Console logs for debugging

**Last Updated:** 2025-10-07

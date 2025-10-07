# Backend Guide: Exempt IP Ranges Feature

## What's New

The frontend now sends an **`exemptIpRanges`** array in the Lab Creation payload. Your backend must:
1. Store this field in the database
2. Skip these IPs when assigning Management IPs to students

---

## 1. Updated Payload Structure

### What You'll Receive

```json
POST /v0/labs

{
  "courseId": "aLg0B5jPrFW47ICP",
  "type": "lab",
  "title": "OSPF Routing Lab",
  "network": {
    "topology": {
      "baseNetwork": "10.0.0.0",
      "subnetMask": 24,
      "allocationStrategy": "group_based",

      // 🆕 NEW: Exempt IP Ranges Array
      "exemptIpRanges": [
        {
          "start": "10.0.0.1"
          // Single IP - no "end" field
        },
        {
          "start": "10.0.0.5",
          "end": "10.0.0.10"
          // IP range with start and end
        }
      ]
    }
  }
}
```

### Field Schema

```typescript
interface ExemptIpRange {
  start: string;   // Required: IPv4 address (e.g., "10.0.0.1")
  end?: string;    // Optional: IPv4 address for range end
}

// In topology object
topology: {
  baseNetwork: string;
  subnetMask: number;
  allocationStrategy: string;
  exemptIpRanges: ExemptIpRange[];  // 🆕 NEW - Can be empty array []
}
```

**Important:**
- `exemptIpRanges` can be an **empty array** `[]` (no exemptions)
- Frontend validates everything, but you should re-validate
- Frontend auto-merges overlapping ranges
- Maximum 20 ranges enforced by frontend

---

## 2. Database Schema Update

### MongoDB Example

```javascript
const LabSchema = new mongoose.Schema({
  network: {
    topology: {
      baseNetwork: String,
      subnetMask: Number,
      allocationStrategy: String,

      // 🆕 ADD THIS
      exemptIpRanges: [{
        start: {
          type: String,
          required: true,
          validate: {
            validator: (v) => /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(v),
            message: 'Invalid IPv4 address'
          }
        },
        end: {
          type: String,
          required: false,
          validate: {
            validator: (v) => !v || /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(v),
            message: 'Invalid IPv4 address'
          }
        }
      }],
      default: []  // Default to empty array
    }
  }
});
```

### Migration for Existing Labs

```javascript
// Run this once to add field to existing labs
db.labs.updateMany(
  { 'network.topology.exemptIpRanges': { $exists: false } },
  { $set: { 'network.topology.exemptIpRanges': [] } }
);
```

---

## 3. Validation Requirements

### Required Validations

```javascript
function validateExemptRanges(exemptRanges, baseNetwork, subnetMask) {
  const errors = [];

  // 1. Max 20 ranges
  if (exemptRanges.length > 20) {
    errors.push('Maximum 20 exempt ranges allowed');
  }

  // 2. Valid IP format
  const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
  for (const range of exemptRanges) {
    if (!ipRegex.test(range.start)) {
      errors.push(`Invalid start IP: ${range.start}`);
    }
    if (range.end && !ipRegex.test(range.end)) {
      errors.push(`Invalid end IP: ${range.end}`);
    }
  }

  // 3. Range logic (start <= end)
  for (const range of exemptRanges) {
    if (range.end) {
      const startNum = ipToNumber(range.start);
      const endNum = ipToNumber(range.end);
      if (startNum > endNum) {
        errors.push(`Invalid range: ${range.start} - ${range.end} (start > end)`);
      }
    }
  }

  // 4. Within management network
  for (const range of exemptRanges) {
    if (!isIpInNetwork(range.start, baseNetwork, subnetMask)) {
      errors.push(`IP ${range.start} not in network ${baseNetwork}/${subnetMask}`);
    }
    if (range.end && !isIpInNetwork(range.end, baseNetwork, subnetMask)) {
      errors.push(`IP ${range.end} not in network ${baseNetwork}/${subnetMask}`);
    }
  }

  return errors;
}

// Helper: Convert IP to number for comparison
function ipToNumber(ip) {
  const parts = ip.split('.').map(Number);
  return (parts[0] * 16777216) + (parts[1] * 65536) + (parts[2] * 256) + parts[3];
}

// Helper: Check if IP is in network
function isIpInNetwork(ip, baseNetwork, subnetMask) {
  const ipNum = ipToNumber(ip);
  const networkNum = ipToNumber(baseNetwork);
  const maskBits = 0xFFFFFFFF << (32 - subnetMask);
  return (ipNum & maskBits) === (networkNum & maskBits);
}
```

### Error Response Format

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": {
    "network.topology.exemptIpRanges": [
      "IP 192.168.1.1 not in network 10.0.0.0/24",
      "Maximum 20 exempt ranges allowed"
    ]
  }
}
```

---

## 4. Update Management IP Assignment Logic

### Current Logic (Before)

```javascript
function assignManagementIp(studentId, lab) {
  const { baseNetwork, subnetMask } = lab.network.topology;
  const offset = calculateStudentOffset(studentId);
  const ip = generateIpFromOffset(baseNetwork, offset);
  return ip;
}
```

### Updated Logic (After)

```javascript
function assignManagementIp(studentId, lab) {
  const { baseNetwork, subnetMask, exemptRanges } = lab.network.topology;

  let offset = calculateStudentOffset(studentId);
  let ip = generateIpFromOffset(baseNetwork, offset);

  // 🆕 SKIP EXEMPT IPs
  let attempts = 0;
  const maxAttempts = 1000;

  while (isIpInExemptRanges(ip, exemptRanges || []) && attempts < maxAttempts) {
    offset++;
    ip = generateIpFromOffset(baseNetwork, offset);
    attempts++;
  }

  if (attempts >= maxAttempts) {
    throw new Error('Unable to assign Management IP: too many exempt ranges');
  }

  return ip;
}

// 🆕 NEW FUNCTION: Check if IP is in any exempt range
function isIpInExemptRanges(ip, exemptRanges) {
  if (!exemptRanges || exemptRanges.length === 0) {
    return false; // No exemptions
  }

  const ipNum = ipToNumber(ip);

  for (const range of exemptRanges) {
    const startNum = ipToNumber(range.start);
    const endNum = range.end ? ipToNumber(range.end) : startNum;

    if (ipNum >= startNum && ipNum <= endNum) {
      return true; // IP is exempt
    }
  }

  return false; // IP is not exempt
}
```

---

## 5. Testing Requirements

### Unit Tests

```javascript
describe('Exempt IP Ranges', () => {
  it('should skip single exempt IP', async () => {
    const lab = {
      network: {
        topology: {
          baseNetwork: '10.0.0.0',
          subnetMask: 24,
          exemptRanges: [{ start: '10.0.0.1' }]
        }
      }
    };

    const student = { id: 'test', offset: 1 };
    const ip = await assignManagementIp(student.id, lab);

    expect(ip).not.toBe('10.0.0.1');
    expect(ip).toBe('10.0.0.2'); // Should skip to next IP
  });

  it('should skip IP range', async () => {
    const lab = {
      network: {
        topology: {
          baseNetwork: '10.0.0.0',
          subnetMask: 24,
          exemptRanges: [{ start: '10.0.0.1', end: '10.0.0.10' }]
        }
      }
    };

    const student = { id: 'test', offset: 5 };
    const ip = await assignManagementIp(student.id, lab);

    expect(ip).not.toMatch(/^10\.0\.0\.(1|2|3|4|5|6|7|8|9|10)$/);
    expect(ip).toBe('10.0.0.11');
  });

  it('should work with empty exemptRanges', async () => {
    const lab = {
      network: {
        topology: {
          baseNetwork: '10.0.0.0',
          subnetMask: 24,
          exemptRanges: []
        }
      }
    };

    const student = { id: 'test', offset: 1 };
    const ip = await assignManagementIp(student.id, lab);

    expect(ip).toBe('10.0.0.1'); // No exemptions
  });
});
```

### Integration Tests

```javascript
describe('Lab Creation with Exempt Ranges', () => {
  it('should accept and store exempt ranges', async () => {
    const response = await request(app)
      .post('/v0/labs')
      .send({
        courseId: 'test',
        type: 'lab',
        title: 'Test Lab',
        network: {
          topology: {
            baseNetwork: '10.0.0.0',
            subnetMask: 24,
            exemptIpRanges: [
              { start: '10.0.0.1' },
              { start: '10.0.0.10', end: '10.0.0.20' }
            ]
          }
        }
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const lab = await Lab.findById(response.body.data.id);
    expect(lab.network.topology.exemptIpRanges).toHaveLength(2);
  });

  it('should reject out-of-network ranges', async () => {
    const response = await request(app)
      .post('/v0/labs')
      .send({
        courseId: 'test',
        type: 'lab',
        title: 'Test Lab',
        network: {
          topology: {
            baseNetwork: '10.0.0.0',
            subnetMask: 24,
            exemptIpRanges: [
              { start: '192.168.1.1' } // Wrong network!
            ]
          }
        }
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });
});
```

---

## 6. Example Scenarios

### Scenario 1: Gateway IP Exemption

**Payload:**
```json
{
  "exemptIpRanges": [{ "start": "10.0.0.1" }]
}
```

**Behavior:**
- Student with offset 1: Skip 10.0.0.1 → Assign 10.0.0.2 ✅
- Student with offset 50: Assign 10.0.0.50 ✅

---

### Scenario 2: Infrastructure Range

**Payload:**
```json
{
  "exemptIpRanges": [
    { "start": "10.0.0.1", "end": "10.0.0.10" }
  ]
}
```

**Behavior:**
- IPs 10.0.0.1 through 10.0.0.10 are SKIPPED
- Student with offset 5: Skip 10.0.0.5 → Assign 10.0.0.11 ✅

---

### Scenario 3: Multiple Ranges

**Payload:**
```json
{
  "exemptIpRanges": [
    { "start": "10.0.0.1" },
    { "start": "10.0.0.5", "end": "10.0.0.15" },
    { "start": "10.0.0.100", "end": "10.0.0.150" }
  ]
}
```

**Behavior:**
- Total exempt: 1 + 11 + 51 = 63 IPs
- Available: 254 - 63 = 191 IPs for students

---

### Scenario 4: No Exemptions

**Payload:**
```json
{
  "exemptIpRanges": []
}
```

**Behavior:**
- All IPs available (normal behavior)
- Skip the exempt check entirely for performance

---

## 7. Implementation Checklist

### Database
- [ ] Add `exemptIpRanges` field to Lab schema
- [ ] Set default value to `[]`
- [ ] Run migration script for existing labs

### API
- [ ] Accept `exemptIpRanges` in `POST /v0/labs`
- [ ] Validate IP format (regex)
- [ ] Validate range logic (start <= end)
- [ ] Validate within network boundaries
- [ ] Validate max 20 ranges
- [ ] Store in database
- [ ] Return in `GET /v0/labs/{labId}`

### IP Assignment
- [ ] Implement `ipToNumber()` helper
- [ ] Implement `isIpInExemptRanges()` function
- [ ] Update `assignManagementIp()` to skip exempt IPs
- [ ] Add max attempts protection (1000)
- [ ] Handle edge case: all IPs exempt

### Testing
- [ ] Unit test: Single IP exemption
- [ ] Unit test: Range exemption
- [ ] Unit test: Multiple ranges
- [ ] Unit test: Empty exemptRanges
- [ ] Integration test: Lab creation with ranges
- [ ] Integration test: Validation failures
- [ ] E2E test: Student receives non-exempt IP

---

## 8. Quick Reference

### Key Points
✅ Field is **optional** - can be empty array `[]`
✅ Frontend validates first - backend should re-validate
✅ Maximum **20 ranges** per lab
✅ Single IP = `{ start: "10.0.0.1" }` (no `end`)
✅ Range = `{ start: "10.0.0.1", end: "10.0.0.10" }`

### Error Prevention
⚠️ Always check if `exemptRanges` exists (could be undefined in old labs)
⚠️ Use `|| []` when accessing: `exemptRanges || []`
⚠️ Add max attempts to prevent infinite loops
⚠️ Validate ranges are within network boundaries

### Performance
- Empty array check is fast: `if (!exemptRanges || exemptRanges.length === 0) return false;`
- IP number conversion is cached during loop
- Worst case: 20 ranges × 1000 attempts = 20,000 comparisons (acceptable)

---

## Support

**Frontend Contract:**
- All IPs are valid IPv4 format
- All ranges have start <= end
- All ranges are within management network
- Maximum 20 ranges
- Overlapping ranges are merged

**Questions?** Contact the frontend team.

---

**Estimated Implementation Time:** 2-4 hours

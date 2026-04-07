# FIC Calendar - Quick Fix Guide

## Problem
When clicking dates in the FIC calendar, you get:
```
Failed to toggle availability: Not Found
```

## Root Cause
The frontend is making requests to relative URLs (`/api/...`) but there's no proxy configured to forward requests to the NestJS backend running on port 4000.

## Solution Applied
✅ Added `NEXT_PUBLIC_API_URL` environment variable
✅ Updated all API calls to use full backend URL
✅ Created central API config for consistency

---

## Quick Fix (2 minutes)

### Step 1: Add Environment Variable

**File:** `tarasense/.env`

Add this line (if not already present):
```env
NEXT_PUBLIC_API_URL="http://localhost:4000/api"
```

### Step 2: Create API Config File

**File:** `tarasense/src/lib/api-config.ts`

```typescript
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
```

### Step 3: Update FIC Service

**File:** `tarasense/src/lib/services/fic-availability-service.ts`

Add import:
```typescript
import { API_BASE_URL } from "@/lib/api-config";
```

Update all fetch calls:
```typescript
// Before:
fetch(`/api/fic-availability/...`)

// After:
fetch(`${API_BASE_URL}/fic-availability/...`)
```

### Step 4: Update Results Dashboard

**File:** `tarasense/src/components/dashboard/results-dashboard.tsx`

Add import:
```typescript
import { API_BASE_URL } from "@/lib/api-config";
```

Update fetch call:
```typescript
// Before:
fetch(`/api/studies/${studyId}/analysis`)

// After:
fetch(`${API_BASE_URL}/studies/${studyId}/analysis`)
```

---

## Restart & Test

### 1. Restart Frontend
```bash
cd tarasense
npm run dev
```

### 2. Verify API Running
In separate terminal:
```bash
cd tarasense/api
npm run dev
```

### 3. Test in Browser
- Login as FIC user
- Go to Dashboard → Calendar tab
- Click a gray/white date
- Should turn green ✓

---

## Test API Directly

Run this test script:

```bash
cd tarasense/api
npm run dev &
sleep 5  # Wait for API to start
node ../test-api-endpoints.js
```

Expected output:
```
✅ SUCCESS: Calendar endpoint working
✅ SUCCESS: PATCH endpoint working
✅ SUCCESS: POST bulk endpoint working
🎉 All tests passed!
```

If any fail with 404, the API module isn't registered. Check:
- `api/src/app.module.ts` imports `FicAvailabilityModule`
- Run `npx prisma generate` in api folder

---

## Troubleshooting

### Error: "Cannot find module @/lib/api-config"

Run:
```bash
cd tarasense
npm install
```

### Error: "NEXT_PUBLIC_API_URL is undefined"

1. Stop frontend: Ctrl+C
2. Verify `.env` has the variable
3. Restart: `npm run dev`
4. Next.js must restart to pick up new env vars

### Error: "ECONNREFUSED localhost:4000"

API not running. Start it:
```bash
cd tarasense/api
npm run dev
```

### Error: "404 Not Found" for API endpoints

Check API logs for:
```
LOG [RouterExplorer] Mapped {/api/fic-availability/calendar/:ficUserId, GET} route
LOG [RouterExplorer] Mapped {/api/fic-availability/bulk, POST} route
LOG [RouterExplorer] Mapped {/api/fic-availability/:ficUserId/:date, PATCH} route
```

If not present:
1. Check `api/src/app.module.ts` has `FicAvailabilityModule` in imports
2. Run `npx prisma generate` in api folder
3. Restart API

---

## Verification Checklist

After restart:

- [ ] Frontend running on port 3000
- [ ] API running on port 4000
- [ ] `.env` contains `NEXT_PUBLIC_API_URL`
- [ ] Calendar loads with dates
- [ ] Can click dates to toggle
- [ ] No console errors
- [ ] API shows 200 OK in Network tab
- [ ] Changes persist after refresh

---

## Expected API Calls

When clicking a date, you should see in Network tab:

**URL:** `http://localhost:4000/api/fic-availability/:userId/:date`

**Method:** `PATCH`

**Status:** `200 OK` or `201 Created`

**Response:**
```json
{
  "id": "avail_123",
  "ficUserId": "fic_456",
  "date": "2025-03-15",
  "isAvailable": true,
  "isLocked": false
}
```

If you see `/api/fic-availability/...` (without localhost:4000), the fix wasn't applied correctly.

---

**That's it! Just add the environment variable, update the API calls, and restart.**

The calendar should work perfectly after that! 🎉

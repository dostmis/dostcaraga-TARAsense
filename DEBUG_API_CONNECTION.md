# 🔧 FIC Calendar - API Connection Debug Guide

## Problem
**Error:** `Failed to connect to API server at http://localhost:4000/api`

**Meaning:** Frontend cannot reach the NestJS backend.

---

## 🔍 Step-by-Step Debug

### Step 1: Verify API Server Status

**Action:** Check if API is actually running

```bash
cd tarasense/api

# Check if process is running
lsof -i :4000

# On Windows:
netstat -ano | findstr :4000
```

**Expected:** Should see node process listening on port 4000

**If NOT running:** Start it:
```bash
cd tarasense/api
npm run dev
```

**Then you should see:**
```
============================================================
🚀 TARAsense API is running!
============================================================
📍 URL: http://localhost:4000/api
🔓 CORS Origins: http://localhost:3000
📊 Database: postgresql://...
============================================================
LOG [RouterExplorer] Mapped {/api/fic-availability/calendar/:ficUserId, GET} route
LOG [RouterExplorer] Mapped {/api/fic-availability/bulk, POST} route
LOG [RouterExplorer] Mapped {/api/fic-availability/:ficUserId/:date, PATCH} route
```

---

### Step 2: Test API Directly in Browser

**Action:** Open this URL in your browser:
```
http://localhost:4000/api/fic-availability/calendar/cm7pbf24p0000l9s1v3x7a3zx?startDate=2025-03-01&endDate=2025-03-31
```

**Expected Results:**

✅ **Success (Auth Error - OK!):**
```json
{
  "statusCode": 401,
  "message": "Unauthorized"
}
```
This means the API is running! The 401 is expected because you're not logged in.

❌ **Not Found (404):**
```
Cannot GET /api/fic-availability/calendar/...
```
**Problem:** Routes not registered. **Solution:** Run:
```bash
cd tarasense/api
npx prisma generate
npm run dev
```

❌ **Connection Refused:**
```
This site can't be reached
localhost refused to connect
```
**Problem:** API not running. **Solution:** Start it (see Step 1).

---

### Step 3: Check Frontend Environment Variable

**Action:** Verify `.env` file

**File:** `tarasense/.env`

**Should contain:**
```bash
NEXT_PUBLIC_API_URL="http://localhost:4000/api"
```

**Test in Browser Console:**
1. Open FIC Dashboard → Calendar page
2. Press F12 → Console tab
3. Type:
```javascript
console.log('API_BASE_URL:', process.env.NEXT_PUBLIC_API_URL)
```

**Expected Output:**
```
API_BASE_URL: http://localhost:4000/api
```

**If NOT correct:**
- Verify `.env` file exists and has correct value
- **CRITICAL:** Must restart frontend after changing `.env`
```bash
cd tarasense
npm run dev
```

---

### Step 4: Verify API_BASE_URL in Service

**File:** `src/lib/services/fic-availability-service.ts`

**Should show debug logs on page load:**
```
🔧 FIC Availability Service - API_BASE_URL: http://localhost:4000/api
🌎 Window location: http://localhost:3000
```

**If you DON'T see these logs:**
- Clear browser cache
- Hard refresh: Ctrl+Shift+R (or Cmd+Shift+R on Mac)
- Restart frontend

---

### Step 5: Check for CORS Errors

**In Browser Console, look for:**
```
Access to fetch blocked by CORS policy
No 'Access-Control-Allow-Origin' header
```

**Fix:** Ensure `api/src/main.ts` has:
```typescript
app.enableCors({
  origin: ['http://localhost:3000'],
  credentials: true,
});
```

**Then restart API:**
```bash
cd tarasense/api
npm run dev
```

---

### Step 6: Check for Port Conflicts

**Action:** Make sure port 4000 isn't used by another app

```bash
# Linux/Mac
lsof -i :4000

# Windows
netstat -ano | findstr :4000
tasklist /FI "PID eq <PID>"
```

**If port is in use:**
- Kill the other process, OR
- Change API port in `api/.env`:
```bash
PORT=4001
```
- Then update frontend `.env`:
```bash
NEXT_PUBLIC_API_URL="http://localhost:4001/api"
```

---

### Step 7: Test with Curl (Direct API Test)

**Action:** Run these commands in terminal:

```bash
# Test 1: Basic API health
curl -v http://localhost:4000/api/health

# Expected: {"status":"ok","message":"TARAsense API is running!",...}

# Test 2: Calendar endpoint
curl -v "http://localhost:4000/api/fic-availability/calendar/test-user?startDate=2025-03-01&endDate=2025-03-31"

# Expected: 401 Unauthorized (means route works!)
# NOT Expected: Connection refused or 404
```

**If curl fails:** API is definitely not running or not on port 4000.

---

### Step 8: Check Frontend Network Tab

**Action:** Open browser DevTools → Network tab

**Filter by:** `fic-availability`

**You should see:**
```
Name: calendar/:ficUserId?startDate=...
Status: 200 OK (or 401)
Type: fetch
Time: ~50-200ms
```

**If you see:**
- ❌ Red entries → Check error message
- ❌ "Failed to connect" → API not running
- ❌ CORS errors → Fix CORS in main.ts

---

## 🛠️ Common Fixes

### Fix 1: API Server Not Running
```bash
cd tarasense/api
npm run dev
```

### Fix 2: Prisma Schema Not Generated
```bash
cd tarasense/api
npx prisma generate
npm run dev
```

### Fix 3: Environment Variable Not Loaded
```bash
# Stop frontend completely
# Edit tarasense/.env to add NEXT_PUBLIC_API_URL
# Restart frontend
cd tarasense
npm run dev
```

### Fix 4: CORS Blocked
```bash
cd tarasense/api
# Edit src/main.ts to ensure CORS is enabled
npm run dev
```

### Fix 5: Firewall Blocking Port 4000
```bash
# Windows: Allow port 4000 in Windows Firewall
# Mac/Linux: Check firewall status
sudo ufw status
sudo ufw allow 4000
```

### Fix 6: Wrong API Port
```bash
# In api/.env, ensure:
PORT=4000

# In tarasense/.env, ensure:
NEXT_PUBLIC_API_URL="http://localhost:4000/api"
```

---

## 🔥 Quick Fix Script

Save this as `fix-api.sh` and run:

```bash
#!/bin/bash

echo "🚀 Starting API Server..."
cd tarasense/api

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies..."
  npm install
fi

# Generate Prisma
echo "🔄 Generating Prisma types..."
npx prisma generate

# Start API
echo "▶️  Starting API server..."
npm run dev
```

---

## 📊 Success Checklist

After completing all steps:

- [ ] API server shows "TARAsense API is running!" in console
- [ ] Browser shows API endpoint (with 401 error = OK!)
- [ ] Frontend console shows `API_BASE_URL: http://localhost:4000/api`
- [ ] Network tab shows successful API calls
- [ ] Calendar loads with colored dates
- [ ] Clicking dates toggles availability
- [ ] No "Failed to fetch" errors

---

## 🎯 Final Test

Once everything is working, test the full flow:

1. **Login as FIC** → Dashboard → Calendar
2. **Connection Test** shows ✅ Connected
3. **Calendar loads** with dates colored
4. **Click any date** → changes from gray to green or green to gray
5. **Click "Mark All Weekdays"** → multiple dates turn green
6. **Refresh page** → changes persist

**If ANY step fails, review the corresponding section above.**

---

## 🆘 Still Not Working?

If you've tried everything and it's still not working:

1. **Capture logs:**
   - API server console output
   - Frontend browser console
   - Frontend Network tab errors

2. **Check versions:**
```bash
cd tarasense/api && node --version  # Should be 18+
cd tarasense && node --version         # Should be 18+
```

3. **Verify installation:**
```bash
cd tarasense/api
npm ls @nestjs/core  # Should show version
cd ..
npm ls next          # Should show version
```

4. **Check database:**
```bash
cd tarasense/api
npx prisma db push  # Should succeed
```

5. **Create minimal reproduction:**
```bash
# In new terminal
cd tarasense/api
curl http://localhost:4000/api/fic-availability/health
```

---

**The calendar WILL work once the frontend can connect to the backend API on port 4000.**

This is a **networking/configuration issue**, not a code issue. Follow the steps above systematically to identify the problem.

# FIC Calendar Fix - Restart Required

**Issue**: API endpoints returning "Not Found"

**Root Cause**: Frontend using relative URLs (`/api/...`) instead of absolute URLs to backend

**Fix Applied**:
- Added `NEXT_PUBLIC_API_URL="http://localhost:4000/api"` to `.env`
- Updated all API calls to use `API_BASE_URL` constant
- Fixed `fic-availability-service.ts` to use full URLs
- Fixed `results-dashboard.tsx` to use full URLs

---

## 🔄 Restart Steps

### 1. Stop Frontend
In your terminal running the Next.js app:
```bash
# Press Ctrl+C to stop
```

### 2. Verify Environment Variable
Check that `.env` contains:
```
NEXT_PUBLIC_API_URL="http://localhost:4000/api"
```

### 3. Restart Frontend
```bash
cd tarasense
npm run dev
# Or: npm run dev:turbo for faster builds
```

### 4. Verify API is Running
In a separate terminal:
```bash
cd tarasense/api
# Should see: TARAsense API running on http://localhost:4000
```

If API not running:
```bash
cd tarasense/api
npm install  # If needed
npm run dev
```

### 5. Test the Calendar
1. Login as FIC user
2. Go to Dashboard → Calendar tab
3. Click any gray/white date
4. Should turn green ✓
5. Check browser console - no errors!

---

## 🔍 Troubleshooting

### If still getting "Not Found":

**Check API is running:**
```bash
curl http://localhost:4000/api/fic-availability/calendar/fic-user-id?startDate=2025-03-01&endDate=2025-03-31
# Should return JSON data or auth error, not "Not Found"
```

**Check API logs:**
Look for output like:
```
LOG [RouterExplorer] Mapped {/api/fic-availability/calendar/:ficUserId, GET} route
LOG [RouterExplorer] Mapped {/api/fic-availability/bulk, POST} route
LOG [RouterExplorer] Mapped {/api/fic-availability/:ficUserId/:date, PATCH} route
```

**Check browser network tab:**
- Open DevTools → Network tab
- Click a date in calendar
- Look for request to `http://localhost:4000/api/fic-availability/...`
- Should show 200 OK, not 404

### Environment Variable Issues:

**Check it's loaded:**
In browser console:
```javascript
console.log(process.env.NEXT_PUBLIC_API_URL)
// Should show: "http://localhost:4000/api"
```

**If not loaded:**
- Restart Next.js dev server (must restart to pick up .env changes)
- Ensure `.env` is in project root (next to package.json)

---

## ✅ Expected Behavior After Restart

1. **Calendar Loads**: Shows current month with dates
2. **Click Date**: Changes color (green ↔ gray)
3. **No Console Errors**: Clean console output
4. **API Requests**: Show 200 OK in Network tab
5. **Data Persists**: Refresh page → changes still there

---

## 🧪 Test All Endpoints

Once restarted, test these URLs in browser:

```
# Should return JSON (may need auth)
http://localhost:4000/api/fic-availability/calendar/fic_user_id?startDate=2025-03-01&endDate=2025-03-31

# Should return JSON
curl -X PATCH http://localhost:4000/api/fic-availability/fic_user_id/2025-03-15 \
  -H "Content-Type: application/json" \
  -d '{"isAvailable": true}'
```

If these work, the frontend should work too!

---

## 📞 If Still Not Working

Try these commands:

```bash
# Stop everything
pkill -f "npm run dev"

# Clean install
cd tarasense/api
rm -rf node_modules package-lock.json
npm install
cd ..
rm -rf node_modules package-lock.json
npm install

# Restart both
cd tarasense/api && npm run dev &
cd tarasense && npm run dev
```

Then test again.

---

**The fix is applied. Just restart and it should work!** 🚀

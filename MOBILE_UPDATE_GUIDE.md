# TARAsense — Mobile Update Guide

Reference for bringing the outdated Flutter app back in sync with the current
backend. Generated from the code at commit `42301e2` (2026-07-29).

**Bottom line:** the Flutter client in [flutter/](flutter/) was last touched
**2026-06-01**, and its network layer dates from **2026-04-30**. Nearly the entire
mobile API was built *after* that date. The client currently implements **5 of 25
endpoints**, and 3 of those 5 call paths that now return **404**.

---

## 1. What the system is

TARAsense is a sensory-evaluation / consumer-testing platform for DOST Caraga.
MSMEs create studies, consumers score product samples on sensory attributes, and
a statistics engine picks the right hypothesis test and produces analytics.

**Four app roles** (`src/lib/auth/roles.ts`):

| Role | Purpose |
| --- | --- |
| `MSME` | Creates studies, sees own dashboards and results |
| `FIC` | Food Innovation Center staff — manages availability calendar, sees studies for their facility/region |
| `CONSUMER` | Panelist — joins studies, fills the sensory form |
| `ADMIN` | Everything |

The DB `UserRole` enum also holds legacy values `RESEARCHER` and `FIC_MANAGER`.
The server maps `FIC_MANAGER → FIC` and `RESEARCHER → CONSUMER` before returning
a role to the client, so the mobile app **only ever sees the four values above**.

**Architecture:** a single Next.js 16 app serves both the web UI and the mobile
API in-process. There is no separate mobile backend to deploy.

---

## 2. Connection basics

### Base URL

```
https://tarasense.dostcaraga.ph/api/mobile/v1
```

Already correct in [flutter/app_config.dart](flutter/app_config.dart). Override
with `--dart-define=API_BASE_URL=...` for local/staging.

### Authentication

Mobile auth is **completely separate** from the web session cookie. It uses a
bearer token signed with `MOBILE_TOKEN_SECRET` (falls back to `SESSION_SECRET`
if unset; both must be ≥32 chars).

**The token is not a standard JWT.** It has only two segments, not three:

```
base64url(JSON payload) . base64url(HMAC-SHA256 signature)
```

Payload: `{ uid, typ: "access"|"refresh", iat, exp }` (seconds since epoch).

> If the Flutter app uses a JWT decoding package, it will fail on these tokens.
> Split on `.`, base64url-decode segment 0, read `exp` yourself.

| Token | TTL |
| --- | --- |
| Access | 24 hours |
| Refresh | 30 days |

Send as `Authorization: Bearer <accessToken>` on every authenticated call.

**Logout does not revoke anything server-side.** `POST /auth/logout` just returns
`{ok: true}`; issued tokens stay valid until they expire. The client must delete
them from secure storage itself.

**Refresh rotates both tokens** — store the new `refreshToken` too, don't reuse
the old one.

### Error envelope

Every error response is:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Human readable text." } }
```

Codes in use: `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_ERROR`,
`RATE_LIMITED`, `INVALID_CREDENTIALS`, `EMAIL_EXISTS`, `INVALID_REFRESH_TOKEN`,
`AUTH_CONFIG_ERROR`, `ROLE_CONFIG_ERROR`, `MOBILE_API_ERROR`,
`STUDY_CREATE_FAILED`, `FORM_FETCH_FAILED`, `JOIN_STUDY_FAILED`,
`RESPONSE_SUBMIT_FAILED`, `PROFILE_UPDATE_FAILED`, `INVALID_LOCATION`,
`MISSING_PARENT`, `INVALID_LEVEL`, `AVAILABILITY_UPDATE_FAILED`,
`ANALYSIS_FETCH_FAILED`.

All mobile responses carry `Cache-Control: no-store`.

**Unknown paths under `/api/mobile/v1/*` return HTTP 404 with code `NOT_FOUND`**
via a catch-all route — they do not fall through to the web app. This is how the
client's stale uppercase paths fail today (see §4).

### Rate limits

In-memory, per IP or per user (`src/lib/rate-limit.ts`). Exceeding one returns
**429 / `RATE_LIMITED`**.

| Scope | Limit |
| --- | --- |
| Login, register | 10 per 15 min (per IP) |
| Token refresh | 30 per 15 min |
| Mutations (join, profile, device token, create study, FIC availability) | 60 per min |
| Response submission | 20 per min |

---

## 3. Full endpoint reference

25 endpoints. Everything except `/auth/login`, `/auth/register`, `/auth/refresh`
requires a bearer token.

### Auth — `/auth/*`

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/auth/register` | `{name, email, password, organization?}` |
| POST | `/auth/login` | `{email, password}` |
| POST | `/auth/refresh` | `{refreshToken}` |
| GET | `/auth/me` | Returns the public user object |
| POST | `/auth/logout` | `{refreshToken?}` — no server-side revocation |
| POST | `/auth/device-token` | `{token, platform}` — register for FCM push |
| POST | `/auth/device-token/remove` | `{token}` |

**Register validation:** name ≥2 chars, valid email, password ≥8 chars.
Duplicate email → **409 `EMAIL_EXISTS`**.

⚠️ **The `role` field in a register request is ignored.** The server hardcodes
`role: "CONSUMER"`. MSME and FIC accounts are provisioned through the web app.
The current Flutter `AuthApi.register()` sends `role` — harmless, but it means
the app cannot create anything other than a consumer account.

**Auth success response** (login, register, refresh all return this):

```json
{
  "user": {
    "id": "...", "email": "...", "name": "...",
    "role": "CONSUMER",
    "organization": null,
    "assignedRegion": null,
    "assignedFacility": null,
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T00:00:00.000Z"
  },
  "accessToken": "...",
  "refreshToken": "...",
  "tokenType": "Bearer"
}
```

`assignedRegion` / `assignedFacility` are FIC fields — needed to render the FIC
dashboard and to know whether a FIC user still needs facility assignment.

**Device token:** `platform` must be exactly `android`, `ios`, or `web`. Token
max 4096 chars. Upsert by token, so re-registering the same FCM token is safe.
Push is delivered through `src/lib/push/fcm.ts` for `Notification` records —
e.g. an MSME gets a push when a consumer registers for their study.

### Profile — `/profile*`

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/profile` | Full profile bundle |
| PATCH | `/profile` | Update user + panelist record |
| PUT | `/profile/location` | Set PSGC address |

`GET /profile` returns:

```jsonc
{
  "user": { /* same shape as auth user */ },
  "panelist": {                  // null until PATCH /profile is called
    "id", "age", "gender", "location", "occupation",
    "lifestyle": [], "dietaryPrefs": [],
    "consumptionHabits": { "coffeeDrinker", "snackConsumer", "energyDrinkConsumer", "snacks" },
    "joinedAt", "lastActive"
  },
  "participationHistory": [ { "id", "status", "completedAt", "study": {"id","title","productName","stage"} } ],
  "options": { "lifestyles": [], "dietaryPrefs": [], "genders": [] },
  "profileLocation": {           // null until PUT /profile/location is called
    "completedAt", "regionId", "provinceId", "cityId", "barangayId",
    "addressDetails", "region", "province", "city", "barangay"
  }
}
```

`PATCH /profile` body — this is what creates the `Panelist` record, and **a
consumer cannot see or join any study until it exists**:

```json
{
  "name": "Juan Dela Cruz",
  "organization": "",
  "age": 28,
  "gender": "MALE",
  "location": "Butuan City",
  "occupation": "Teacher",
  "lifestyle": ["student"],
  "dietaryPrefs": ["VEGETARIAN"],
  "coffeeDrinker": true,
  "snackConsumer": true,
  "energyDrinkConsumer": false
}
```

Validation: name ≥2, age 10–100, gender in enum, location ≥2, occupation ≥2.

⚠️ The mobile endpoint accepts a **narrower** option set than the database:
`lifestyle` only `student | athlete | office_worker`; `dietaryPrefs` only
`VEGETARIAN | VEGAN | GLUTEN_FREE`. Anything else is silently dropped. Always
build the pickers from the `options` object returned by `GET /profile` rather
than hardcoding them.

`PUT /profile/location` body: `{regionId, provinceId, cityId, barangayId,
addressDetails?}` (address ≤280 chars). The four IDs are validated for
parent/child consistency; a mismatch returns `INVALID_LOCATION`. Returns
`{profileId, completedAt}`.

### Locations — `/locations`

`GET /locations?level=region|province|city|barangay&parentId=<id>&q=<search>`

Single cascading endpoint for the Philippine Standard Geographic Code hierarchy.
`parentId` is required for every level except `region`. Returns `{items: [...]}`.
Requires a bearer token.

### Consumer — `/consumer/*` (role: CONSUMER only)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/consumer/studies?q=&limit=` | Available studies. limit default 20, max 50 |
| GET | `/consumer/studies/completed?q=&limit=` | Past participations |
| GET | `/consumer/studies/{studyId}/form` | Questionnaire definition |
| POST | `/consumer/studies/{studyId}/join` | `{requestedSessionAt?}` → 201 |
| POST | `/consumer/studies/{studyId}/participants/{participantId}/responses` | Submit the evaluation |

**`GET /consumer/studies`** returns `{profileRequired, studies[], meta}`.
`profileRequired: true` with an empty list means the user has no panelist
record — route them to the profile screen. Studies are filtered server-side by:
status `RECRUITING`/`ACTIVE`, having sensory attributes, target-consumer
demographic match, PSGC location visibility, and an open testing schedule.

Each study includes `myParticipation` (null if not joined) and `sessionSchedule`
with per-slot capacity:

```jsonc
"sessionSchedule": {
  "timezone": "Asia/Manila",
  "startDate": "2026-08-20",
  "durationDays": 3,
  "slots": [
    { "id", "label", "startsAt", "endsAt",
      "capacity": 20, "reservedCount": 8, "remainingCount": 12 }
  ]
}
```

**`POST .../join`** creates a participant with `status: "SELECTED"` and
`consentStatus: "PENDING"`, and returns the assigned `panelistNumber` and
`randomizeCode`. Pass the chosen slot's `startsAt` as `requestedSessionAt`.
Rejections (all 400 / `JOIN_STUDY_FAILED`): no profile, inactive profile, study
not recruiting, schedule ended, demographic mismatch, location restricted,
already joined.

**`GET .../form`** returns attributes and questions ordered by `order`:

```jsonc
{
  "success": true,
  "form": {
    "studyId", "title",
    "attributes": [ { "id", "name", "type", "order", "attributeType", "jarOptions" } ],
    "questions":  [ { "id", "text", "type", "order" } ]
  }
}
```

`type` is `OVERALL_LIKING | ATTRIBUTE_LIKING | JAR | OPEN_ENDED`.

**Response submission body** — the full current contract:

```jsonc
{
  "overallLiking": 7,                     // required, 1–9
  "attributes": { "Sweetness": 6 },       // required, ≤40 keys
  "sampleResponses": [                    // multi-sample studies, ≤20
    { "sampleNumber": 1, "overallLiking": 7, "attributes": { "Sweetness": 6 } }
  ],
  "sampleRanking":  [ { "sampleNumber": 1, "rank": 1 } ],
  "comments": { "likedMost": "...", "improvements": "..." },   // ≤2000 chars each
  "customAnswers": { "<questionId>": "text" },                 // or ["opt1","opt2"]
  "cataSelections": [ { "sampleNumber": 1, "terms": ["crispy","salty"] } ],
  "submittedAt": "2026-08-15T02:00:00.000Z"                    // ISO 8601, optional
}
```

JAR attributes accept the bucket values `too_low`, `just_right`, `too_high`.
Returns **201** on first submission, **200** with `alreadySubmitted: true` if the
participant is already `COMPLETED` (safe to retry — treat as success).

⚠️ **Preconditions that will reject a submission (400):** participant status must
be `CONFIRMED` (not `SELECTED`) and `consentStatus` must be `AGREED`. See §5 —
there is no mobile endpoint that sets either.

Submitting triggers the analysis engine in the background and notifies the MSME.

### MSME — `/msme/*` (roles: MSME, ADMIN)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/msme/dashboard?q=` | Stats + up to 50 studies |
| GET | `/msme/study-builder-options` | All dropdown data for the study builder |
| POST | `/msme/studies` | Create a study → 201 |

Dashboard returns `{stats: {ficBookings, totalStudies, totalResponses,
activeStudies}, studies: [...]}`, each study carrying `responseCount`,
`participantCount`, `targetReached`, and its participant list.

`/msme/study-builder-options` is the source of truth for the create-study form:
study modes, coordination modes, market/sensory study types, discriminative and
descriptive methods, consumer objectives (with min/max targets), category
profiles with their default attributes, regions, facilities by region, attribute
dimensions, and target-consumer option lists. **Do not hardcode any of these in
the app** — they change (see §4).

`POST /msme/studies` takes the study-builder payload (validated by
`BuilderPayloadSchema` in [src/app/actions/study-builder-actions.ts](src/app/actions/study-builder-actions.ts)).
Key fields: `studyMode` (`MARKET`/`SENSORY`), `coordinationMode`
(`FIC_ASSISTED`/`SELF_MANAGED_PUBLIC`), `visibility`, `testMode`
(`OVERALL_ONLY`/`ATTRIBUTE`/`CATA`), `cataTerms[]`, `studyTitle`, `purpose`,
`targetConsumer{}`, `numberOfSamples`, `targetResponses`, `attributes[]`,
`samples[]`, `testingStartDate`, `testingDurationDays`, `sessionSlots[]`,
`questions[]`, `customQuestions[]`, optional `projectId`.

### FIC — `/fic/*` (roles: FIC, ADMIN)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/fic/dashboard?q=` | Stats + studies for the assigned facility/region |
| GET | `/fic/studies?q=&limit=` | limit default 50, max 100 |
| GET | `/fic/calendar?q=&limit=` | Booked sessions. limit default 100, max 300 |
| GET | `/fic/availability?startDate=&endDate=` | Defaults to the current month |
| POST | `/fic/availability` | `{dates: [{date, isAvailable}]}` — bulk, ≤120 dates |
| PATCH | `/fic/availability/{date}` | `{isAvailable}` — single day |

Dates are `YYYY-MM-DD` **date keys in `Asia/Manila`**, never UTC timestamps. Max
range 120 days. `meta.assignedFacilityRequired: true` on the dashboard means the
FIC user has no facility assigned yet and the screen should say so.

Calendar sessions carry `sessionState: "CONFIRMED" | "PENDING_CONFIRMATION"` —
confirmed means an actual `sessionAt` exists; pending means only the consumer's
`requestedSessionAt` is set.

### Analysis — `/studies/{studyId}/analysis` (roles: MSME, FIC, ADMIN)

`GET /studies/{studyId}/analysis?refresh=1`

Returns `overallLiking`, `attributeStats`, `penaltyAnalysis` (JAR),
`perSampleResults`, `comparativeAnalysis`, `meanDropAnalysis`,
`automaticInterpretation`, `aiInterpretation`, `aiRecommendation`,
`decisionFlag`, plus a `study` summary and `responseCount`.

Access is checked with `canAccessStudyByRole` — 403 `FORBIDDEN` otherwise. A
study with zero responses returns a valid, fully-zeroed skeleton (not an error),
so the client should render an empty state rather than treat it as a failure.

⚠️ **The AI narrative fields arrive late.** As of 2026-07, the statistics are
computed synchronously but AI text generation is pushed to a background job so
the request never blocks on the AI provider. `aiInterpretation` and
`aiRecommendation` will be `null` on the first read after new responses land.
The app should render statistics immediately and re-fetch to pick up AI text.

---

## 3b. Verified reachability (probed 2026-08-15)

All 25 endpoints were probed live against
`https://tarasense.dostcaraga.ph/api/mobile/v1` and against the local PM2
instance (`tarasense-web` on `127.0.0.1:3032`, fronted by Cloudflare). Results
were identical on both.

**Every endpoint is reachable.** Unauthenticated GETs return `401 UNAUTHORIZED`
("Missing bearer token"), and POST/PATCH/PUT-only routes return `405` on GET —
both confirm the route exists and is serving.

| Group | Result |
| --- | --- |
| `/auth/*` (7) | `/auth/me` → 401; the 6 POST-only routes → 405 |
| `/profile`, `/profile/location`, `/locations` | 401 / 405 / 401 |
| `/consumer/*` (5) | GETs → 401; join + responses → 405 |
| `/msme/*` (3) | GETs → 401; `/msme/studies` → 405 |
| `/fic/*` (6) | GETs → 401; `/fic/availability/{date}` → 405 |
| `/studies/{id}/analysis` | 401 |

**Mobile auth is correctly configured in production.** `POST /auth/login` with an
empty body returns `400 VALIDATION_ERROR`, not `500 AUTH_CONFIG_ERROR` — so
`MOBILE_TOKEN_SECRET` (or the `SESSION_SECRET` fallback) is set and ≥32 chars.
Login and register will work.

**The uppercase-path bug is confirmed live, not theoretical:**

```
GET /api/mobile/v1/msme/dashboard  → 401 {"code":"UNAUTHORIZED"}   ← route exists
GET /api/mobile/v1/MSME/dashboard  → 404 {"code":"NOT_FOUND"}      ← client calls this
```

⚠️ **No CORS headers are served.** There is no `Access-Control-Allow-Origin` on
mobile API responses. Native Android/iOS builds are unaffected — Dio does not
enforce CORS — but a **Flutter web build would be blocked by the browser**. If
web is a target, CORS headers must be added server-side.

Security headers present: HSTS (2 years, preload), `X-Frame-Options: DENY`, CSP
with `frame-ancestors 'none'`. None of these affect a native mobile client.

Not verified: an authenticated round-trip. That needs real credentials, and
registering a throwaway account would create a live user record in the
production database.

---

## 4. What changed since the Flutter client was last updated

The client's network layer is from **2026-04-30**; its API files from
**2026-06-01**. Here is what shipped after those dates.

### 4a. Blocking — stale paths that now 404

[flutter/msme_api.dart](flutter/msme_api.dart) calls **uppercase** paths:

| Client calls | Actual route |
| --- | --- |
| `/MSME/dashboard` | `/msme/dashboard` |
| `/MSME/study-builder-options` | `/msme/study-builder-options` |
| `/MSME/studies` | `/msme/studies` |

Next.js route matching is case-sensitive and the mobile catch-all returns 404
`NOT_FOUND` for anything unmatched. The web app has a middleware redirect for
the *page* path `/MSME/dashboard`, but **that redirect does not cover the API**.
All three MSME calls are broken today — **confirmed live against production**,
see §3b. Fix: lowercase them.

### 4b. Endpoints added since 2026-04-30 (all missing from the client)

The entire consumer flow, the entire FIC surface, and several cross-cutting
endpoints were built after the client's network layer was written:

- All 5 `/consumer/*` endpoints
- All 6 `/fic/*` endpoints
- `/locations`
- `/profile/location`
- `/auth/device-token` and `/auth/device-token/remove` (push notifications)
- `/studies/{studyId}/analysis`
- The `[...path]` catch-all 404 handler

The client currently covers only `/auth/login`, `/auth/register`,
`/auth/refresh`, `/auth/me`, `/auth/logout`, `/msme/dashboard`,
`/msme/study-builder-options`, `/msme/studies`, and `/profile`.

### 4c. Contract changes since 2026-06-01

**Response submission gained two optional fields** — a form built before
2026-07-14 will silently drop this data:

- `customAnswers` — answers to MSME-authored custom questions
  (`MULTIPLE_CHOICE`, `CHECKBOXES`, `PARAGRAPH`). Max 10 questions, 10 options
  each, 2000-char paragraph answers.
- `cataSelections` — Check-All-That-Apply term selections per sample, for studies
  created with `testMode: "CATA"`.

**Study schedule end is now enforced.** Both `GET .../form` and `POST .../join`
reject with *"This study's testing schedule has ended."* once `scheduleEndsAt`
passes, and the available-studies list filters those studies out. The app needs
to handle a study disappearing or becoming unjoinable between list and detail.

**Consumer objectives were rewritten** in `/msme/study-builder-options`:

| Before (≤2026-06-01) | Now |
| --- | --- |
| `MARKET_READINESS` "Consumer Acceptability", target 100 | `MARKET_READINESS` "Acceptability", 75–100, default 75 |
| `REFINEMENT` "Refinement", 50 | `REFINEMENT`, 50–100, default 50 |
| `PROTOTYPING` "Prototyping", 25 + 10 buffer = 35 | `PROTOTYPING`, 20–30, default 20 |
| — | **`EXPLORATORY` "Exploratory Consumer Evaluation (FGD)", 4–12, default 4** — new |

Each objective now has `minTarget` / `maxTarget` for validating the target
response count. Any hardcoded objective list in the app is wrong.

**Analysis reads no longer block on AI** (see §3) — expect `null` AI fields on
first read.

### 4d. Platform features added, in commit order

| Date | Change | Mobile impact |
| --- | --- | --- |
| 2026-05-11 | Security hardening: IDOR fixes, rate limiting, analysis engine fixes | 429 handling required |
| 2026-05-13 | FIC availability timezone fix | Always use `Asia/Manila` date keys |
| 2026-06-01 | Innovator workspace groundwork | — |
| 2026-06-09 | End of Phase 1 | — |
| 2026-06-18 | Admin MFA, session revocation, security headers, secret handling | `MOBILE_TOKEN_SECRET` now preferred over `SESSION_SECRET` |
| 2026-07-14 | Innovator Workspace: Projects, custom questions, study-on-behalf, imports | `customQuestions` / `customAnswers`; `projectId` on study create |
| 2026-07-15 | UI improvements; FIC can view results for studies they created | FIC gains access to `/studies/{id}/analysis` |
| 2026-07-29 | AWS deployment + DB changes | Confirm production base URL |

---

## 5. Known gaps in the mobile API

These are backend limitations, not client bugs. Plan around them.

1. **No consent endpoint.** A consumer joins with `consentStatus: "PENDING"`, but
   submission requires `AGREED`. Nothing under `/api/mobile/v1/*` sets it. The
   consumer flow cannot be completed on mobile alone today.
2. **No participant-confirmation endpoint.** Submission requires status
   `CONFIRMED`; joining sets `SELECTED`. Confirmation happens in the web app.
3. **The form endpoint does not return custom questions or CATA terms.**
   `GET /consumer/studies/{id}/form` returns only sensory attributes and
   questions, yet the submission endpoint accepts `customAnswers` and
   `cataSelections`. The app has no way to render those inputs from the mobile
   API as it stands.
4. **No consumer results endpoint.** `getConsumerStudyResults()` exists in
   [src/lib/mobile/consumer.ts](src/lib/mobile/consumer.ts) but no route exposes
   it — consumers cannot see their own study results on mobile.
5. **No password reset, email verification, or Google OAuth on mobile.** Those
   flows are web-only.
6. **Logout does not revoke tokens.** A stolen access token is valid for up to
   24 hours, a refresh token for 30 days.
7. **Rate limiting is in-memory and per-instance** — behaviour differs if the
   deployment is ever scaled horizontally.

Items 1–3 are the ones that block a working end-to-end consumer experience. They
need backend endpoints before the mobile consumer flow can ship.

---

## 6. Suggested update order for the Flutter app

1. **Fix the uppercase `/MSME/*` paths** — three one-line changes, unblocks the
   existing MSME screens immediately.
2. **Fix token parsing** if a JWT library is used — these are 2-segment HMAC
   tokens, not JWTs.
3. **Store and rotate the refresh token** on every `/auth/refresh` response;
   clear both tokens locally on logout.
4. **Add a 429 interceptor** with backoff, and surface `error.code` /
   `error.message` from the envelope in the UI.
5. **Add `/profile/location` and `/locations`** — a consumer with no PSGC
   location is invisible to location-targeted studies.
6. **Build the consumer flow**: available studies → session slot picking →
   join → form → submit, including `customAnswers` and `cataSelections` in the
   submission payload.
7. **Build the FIC surface**: dashboard, studies, calendar, availability
   (single-day + bulk), all on `Asia/Manila` date keys.
8. **Add device-token registration** on login and removal on logout to enable
   push notifications.
9. **Add the analysis screen** for MSME/FIC, rendering statistics immediately and
   re-fetching for AI narrative fields.
10. **Drive every dropdown from `/msme/study-builder-options`** and
    `GET /profile`'s `options` — stop hardcoding objectives, categories,
    lifestyles, and dietary preferences.

---

## 7. Enum reference

Values the mobile app will encounter. Source: `prisma/schema.prisma`.

```
AppRole (as returned by the API)  MSME | FIC | CONSUMER | ADMIN

StudyStatus         DRAFT | RECRUITING | ACTIVE | ANALYZING | COMPLETED | ARCHIVED
ParticipantStatus   SELECTED | WAITLIST | CONFIRMED | COMPLETED | CANCELLED | DECLINED
ConsentStatus       PENDING | AGREED | DECLINED
ParticipationSource REGISTERED_CONSUMER | WALK_IN_GUEST

AttrType            OVERALL_LIKING | ATTRIBUTE_LIKING | JAR | OPEN_ENDED
SensoryQuestionType HEDONIC | JAR | OPEN_ENDED
StudyDesign         MONADIC | WITHIN_SUBJECT
StudyStage          EXPLORATORY | PROTOTYPE_CHECK | REFINEMENT | MARKET_READINESS
ProductCategory     BEVERAGE | SNACK | DESSERT | FUNCTIONAL_FOOD | DAIRY | BAKERY
StudyTargetScope    ALL | REGION | PROVINCE | CITY | BARANGAY

Gender              MALE | FEMALE | NON_BINARY | PREFER_NOT_SAY
DietaryPref         VEGETARIAN | VEGAN | GLUTEN_FREE | DAIRY_FREE | NUT_FREE |
                    HALAL | KOSHER | NO_SPECIFIC_DIET | PLANT_BASED |
                    FLEXITARIAN | KETO | LOW_SUGAR | HALAL_CONSCIOUS
                    (mobile PATCH /profile accepts only the first three)

NotificationCategory AUTH | STUDY | ROLE | SURVEY | SYSTEM
```

Custom question types (not a DB enum): `MULTIPLE_CHOICE | CHECKBOXES | PARAGRAPH`.

JAR bucket values accepted on submission: `too_low | just_right | too_high`.

Hedonic scale is **1–9** for both `overallLiking` and attribute liking.

---

## 8. Server configuration the mobile app depends on

| Variable | Why it matters |
| --- | --- |
| `MOBILE_TOKEN_SECRET` | Signs mobile tokens. ≥32 chars. Falls back to `SESSION_SECRET`. **If neither is set, login and register return 500 `AUTH_CONFIG_ERROR`.** |
| `DATABASE_URL` | Postgres |
| `CRON_SECRET` | Guards `/api/jobs/*`, including `close-expired-studies` — which is what makes studies disappear from the consumer list at schedule end. Must be registered with an external scheduler; the jobs do not self-schedule. |
| `REMINDER_TIMEZONE` | `Asia/Manila` |
| `OPENAI_API_KEY` / `OPENROUTER_API_KEY` | Optional. Without these, AI fields in analysis stay `null` permanently. |

Note: `NEXT_PUBLIC_API_URL` is a **web** setting for routing the frontend at an
external gateway. It has nothing to do with the mobile base URL — mobile always
targets `{host}/api/mobile/v1` directly.

---

## 9. Source map

| Area | Path |
| --- | --- |
| Mobile routes | [src/app/api/mobile/v1/](src/app/api/mobile/v1/) |
| Mobile business logic | [src/lib/mobile/](src/lib/mobile/) |
| Token signing / verification | [src/lib/mobile/token.ts](src/lib/mobile/token.ts) |
| Auth helpers, error envelope, rate-limit wrapper | [src/lib/mobile/api.ts](src/lib/mobile/api.ts) |
| Study creation schema | [src/app/actions/study-builder-actions.ts](src/app/actions/study-builder-actions.ts) |
| Custom questions | [src/lib/custom-questions.ts](src/lib/custom-questions.ts) |
| CATA | [src/lib/cata.ts](src/lib/cata.ts) |
| Statistics engine | [src/lib/services/statistics.ts](src/lib/services/statistics.ts) |
| Study access rules | [src/lib/study-access.ts](src/lib/study-access.ts) |
| Location visibility | [src/lib/locations/study-visibility.ts](src/lib/locations/study-visibility.ts) |
| Rate limits | [src/lib/rate-limit.ts](src/lib/rate-limit.ts) |
| Flutter client stubs | [flutter/](flutter/) |
| Schema | [prisma/schema.prisma](prisma/schema.prisma) |

# Eitan Backend 🛡️

AI-powered REST API for the Eitan recovery companion app for injured IDF soldiers.

## Stack
- **Runtime**: Node.js + Express
- **Database**: Supabase (PostgreSQL + Auth + RLS)
- **AI**: NVIDIA NIM API — `meta/llama-4-maverick-17b-128e-instruct` (40 RPM free tier)
- **Hosting**: Render or Netlify Functions (free tier)

---

## Quick Start

### 1. Clone & install
```bash
cd backend
npm install
```

### 2. Set up environment
```bash
cp .env.example .env
# Fill in your Supabase and NVIDIA API keys
```

### 3. Set up the database
1. Go to your [Supabase project](https://supabase.com) → **SQL Editor**
2. Paste and run the contents of `supabase/schema.sql`

### 4. Run locally
```bash
npm run dev
```

Server starts at `http://localhost:3000`
Health check: `http://localhost:3000/health`

---

## API Overview

All routes (except `/health`) require a valid Supabase JWT in the `Authorization: Bearer <token>` header.

| Module  | Base Path    | Description                        |
|---------|--------------|------------------------------------|
| Auth    | `/api/auth`  | Profile creation & retrieval       |
| MIND    | `/api/mind`  | Mood check-ins & coping toolkit    |
| BODY    | `/api/body`  | Workouts, pain logs, PT reports    |
| LINK    | `/api/link`  | Peer matching, buddy, activities   |
| GUIDE   | `/api/guide` | IDF benefits chatbot               |

### Key Endpoints

```
GET    /health
GET    /api/auth/me
POST   /api/auth/profile

POST   /api/mind/checkin              { text, language }
GET    /api/mind/checkin/history
GET    /api/mind/coping/toolkit
POST   /api/mind/coping/complete      { type }

POST   /api/body/pain-log             { painLevel, location, notes }
POST   /api/body/wearable             { source, resting_hr, sleep_hours, ... }
GET    /api/body/workout/today
POST   /api/body/workout/generate
POST   /api/body/workout/complete     { planId, painAfter, energyAfter }
GET    /api/body/pt/report

POST   /api/link/peer/match
GET    /api/link/peer/my-group
POST   /api/link/buddy/match
GET    /api/link/buddy/mine
GET    /api/link/activities
GET    /api/link/community

POST   /api/guide/chat                { message }
GET    /api/guide/chat/history
DELETE /api/guide/chat/history

GET    /api/reminders/push/vapid-key
POST   /api/reminders/push/subscribe  { subscription: <PushSubscription> }
GET    /api/reminders
POST   /api/reminders                 { title, type, recurrence, recurrence_time, ... }
PATCH  /api/reminders/:id
DELETE /api/reminders/:id
```

---

## Push Notifications Setup

### 1. Generate VAPID keys
```bash
npx web-push generate-vapid-keys
```
Paste the output into your `.env` as `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`.

### 2. Frontend subscribes
The frontend fetches the VAPID public key from `GET /api/reminders/push/vapid-key`,
subscribes via the browser's `PushManager`, then POSTs the subscription object
to `POST /api/reminders/push/subscribe`.

### 3. Reminder types
| Type | Description |
|---|---|
| `prescription` | Take medication |
| `appointment` | Medical/therapy appointment |
| `break` | Scheduled rest break |
| `exercise` | Rehabilitation workout |
| `hydration` | Drink water reminder |
| `therapy` | Therapy session |
| `custom` | Any user-defined reminder |

### 4. Recurrence options
| Recurrence | Required Fields | Example |
|---|---|---|
| `once` | `scheduled_at` (ISO datetime) | One-time appointment |
| `daily` | `recurrence_time` (HH:MM UTC) | Daily medication at 08:00 |
| `weekdays` | `recurrence_time` | Break reminder Mon–Fri |
| `weekly` | `recurrence_time` + `recurrence_days` ([0-6]) | Weekly PT on Tuesday |

---

## Deploy to Render

1. Push this `backend/` folder to GitHub
2. Create a new **Web Service** on [Render](https://render.com)
3. Set **Build Command**: `npm install`
4. Set **Start Command**: `node src/app.js`
5. Add all environment variables from `.env.example`

## Deploy to Netlify Functions

1. Install Netlify CLI: `npm i -g netlify-cli`
2. Wrap `app.js` with `serverless-http` and add a `netlify.toml`
3. `netlify deploy --prod`

---

## AI Rate Limit Strategy

All AI calls go through a priority queue (40 RPM limit):

| Priority | Use Case                        | Target Latency |
|----------|---------------------------------|----------------|
| P0       | Crisis detection                | Immediate      |
| P1       | Mood check-in, benefits chat    | < 5 sec        |
| P2       | Workout plans, PT reports       | < 30 sec       |
| P3       | Matching, activity recs         | Background     |

Stable responses (activity lists, coping toolkits) are cached in-memory with TTL to minimize API hits.

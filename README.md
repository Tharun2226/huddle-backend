# Huddle Backend

NestJS + Prisma + PostgreSQL API for the Huddle mobile app.

## Setup

1. Copy env and paste your Postgres URL when ready:

```bash
cp .env.example .env
# edit DATABASE_URL
```

2. Install, migrate, seed, run:

```bash
npm install
npx prisma migrate dev --name init
npx prisma db seed
npm run start:dev
```

API base: `http://localhost:3000/api`

## Seeded pilot logins

Password for all users: **`Huddle@123`**

| Email | Role |
|-------|------|
| ajyotheeswarreddy@gmail.com | manager |
| aisha@huddle.team | member |
| rahul@huddle.team | member |
| priya@huddle.team | member |

## Auth

```http
POST /api/auth/login
{ "email": "...", "password": "Huddle@123" }

POST /api/auth/refresh
{ "refreshToken": "..." }

GET /api/auth/me
Authorization: Bearer <accessToken>
```

JWT claims include `role` (`MANAGER` | `MEMBER`) and `organizationId`.  
Manager-only routes: expense approve/reject/reimburse, activity feed, team users, create meeting.

## Main routes

| Method | Path | Notes |
|--------|------|-------|
| GET | `/today` | Agenda aggregate |
| GET/POST/PATCH | `/tasks` | Role-scoped |
| GET/POST | `/meetings` | Create = manager |
| GET/POST | `/expenses` | + submit / approve / reject / reimburse |
| GET | `/expenses/approvals/pending` | Manager |
| GET | `/activity` | Manager |
| GET | `/users` | Org roster |

## Roles

Matches Flutter `UserRole`:

- **MANAGER** — all org tasks/expenses/activity; approvals
- **MEMBER** — own / assigned tasks; own expenses; no approve

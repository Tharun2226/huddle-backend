# Huddle Backend

NestJS + Prisma + PostgreSQL API for the Huddle mobile app.

## Setup (local)

1. Copy env and set Postgres URL:

```bash
cp .env.example .env
# edit DATABASE_URL
```

If the DB password contains `@`, URL-encode it as `%40` inside `DATABASE_URL`.

2. Install, migrate, seed, run:

```bash
npm install
npx prisma migrate deploy
npx prisma db seed
npm run start:dev
```

API base: `http://localhost:3000/api`  
Health: `GET /api/health`  
Swagger: `http://localhost:3000/api/docs`

## Seeder

Simple production seeder (`prisma/seed.ts`):

- Permissions + roles (Admin / Manager / Member)
- Default task statuses, priorities, tags
- Platform super-admin
- One org admin

| Account | Default |
|---------|---------|
| Org admin | `admin@gmail.com` / `test@123` |
| Super admin | `superadmin@gmail.com` / `test@123` |

Override with env: `SEED_PASSWORD`, `SEED_ORG_NAME`, `SEED_ORG_SLUG`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_NAME`, `SEED_SUPERADMIN_EMAIL`.  
Set `SEED_RESET=true` to wipe org data before seeding (destructive).

## Deploy on Vercel

Nest runs as a single serverless function (`api/index.ts`).

### 1. Push this repo, then import in Vercel

- Framework Preset: **Other**
- Root directory: repo root (`huddle-backend`)
- Build Command: `npm run vercel-build` (or leave vercel.json `buildCommand`)
- Output: handled by `api/index.ts` rewrite

### 2. Environment variables (Vercel → Settings → Environment Variables)

**Never commit these.** Add for Production (and Preview if needed):

| Name | Notes |
|------|--------|
| `DATABASE_URL` | Postgres URL. Encode special chars in password (`@` → `%40`) |
| `JWT_ACCESS_SECRET` | Long random string |
| `JWT_REFRESH_SECRET` | Long random string |
| `JWT_ACCESS_EXPIRES` | e.g. `15m` |
| `JWT_REFRESH_EXPIRES` | e.g. `7d` |
| `CORS_ORIGIN` | `*` or your app origins |
| `CRON_SECRET` | Random string; Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` |
| `FIREBASE_PROJECT_ID` | From Firebase service account JSON |
| `FIREBASE_CLIENT_EMAIL` | From service account JSON |
| `FIREBASE_PRIVATE_KEY` | Full private key; in Vercel keep `\n` as literal `\n` in the value |

### 3. Database

Against the production DB (from your machine, with `DATABASE_URL` set):

```bash
npx prisma migrate deploy
npx prisma db seed
```

### 4. Flutter app

Point the app at the Vercel URL:

```text
https://YOUR-PROJECT.vercel.app/api
```

Example:

```powershell
flutter run --dart-define=API_BASE_URL=https://YOUR-PROJECT.vercel.app/api
```

### Notes

- Meeting/task reminder cron: `GET /api/internal/cron/reminders` every 5 minutes (Pro plan for frequent crons; Hobby is limited).
- Receipt uploads use `/tmp` on Vercel (ephemeral). Switch to S3/Blob for durable storage later.
- Cold starts can be a few seconds on the first request after idle.

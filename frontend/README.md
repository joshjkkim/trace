# Cernova — Dashboard

Next.js app that subscribes to Supabase Realtime and displays new `CALLS` rows as they arrive.

## Setup

```bash
npm install
cp .env.local.example .env.local
```

Edit `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...   # Supabase → Settings → API → anon key
```

The anon key is safe to expose — it's public by design.

## Start

```bash
# From repo root:
npm run frontend

# Or directly:
cd frontend && npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Supabase requirements

The `CALLS` table must be added to the `supabase_realtime` publication and RLS must allow anon reads. Run once in the Supabase SQL editor:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE "CALLS";
ALTER TABLE "CALLS" DISABLE ROW LEVEL SECURITY;
```
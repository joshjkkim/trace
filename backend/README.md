# Cernova — Backend

FastAPI service that receives trace payloads from the SDK and writes them to Supabase.

## Setup

```bash
python3 -m venv .venv
.venv/bin/pip install -r ../requirements.txt
cp .env.example .env
```

Edit `.env`:

```env
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_KEY=eyJ...   # Supabase → Settings → API → service_role
```

## Start

```bash
# From repo root:
npm run backend

# Or directly:
cd backend && .venv/bin/uvicorn main:app --reload --port 8000
```

## Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/ingest` | Receive a trace payload from the SDK |
| `GET` | `/traces` | List recent traces (default limit 100) |
| `GET` | `/traces/{id}` | Get a single trace by ID |
| `GET` | `/health` | DB connectivity check |
| `GET` | `/docs` | Interactive Swagger UI |
# Personal Expense Tracker

A radically simple, all-in-one personal and shared expense tracker powered by **Cloudflare Workers**, **Cloudflare D1 (SQLite)**, and **Hono**.

## Features
- **SMS Capture Webhook (`POST /capture`)**: Ingests bank and credit card SMS notifications from iOS Shortcuts in real-time.
- **Deterministic Parser Engine**: Instant regex parsing with named capture groups for Kotak, HDFC, ICICI, SBI, BOB/Scapia, Axis, HSBC, and more.
- **Server-Rendered HTML Dashboard (`GET /`)**: Lightweight, instant (<20ms latency) monthly breakdown with category progress bars, merchant summaries, and searchable transaction feed.
- **Interactive Swagger UI (`GET /docs`)**: OpenAPI 3.0 documentation for all REST endpoints.
- **Aggregated Summaries (`GET /transactions/summary`)**: Group spending by category or merchant with date range filters.

## Local Development
```bash
# Install dependencies
pnpm install

# Apply local database migrations
pnpm run migrate:local

# Start local development server
pnpm run dev
```

## Production Deployment
```bash
# Apply migrations to remote Cloudflare D1
pnpm run migrate:remote

# Deploy Worker
pnpm run deploy
```


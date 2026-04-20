# 4EVR Live Dashboard

A private, password-gated, static dashboard that shows a close-to-live view of
what's happening on [4evr.ink](https://4evr.ink). Hosted on GitHub Pages, built
with vanilla HTML/CSS/JS + [Chart.js](https://www.chartjs.org/) via CDN. No
build step, no frameworks.

## Access

**URL:** https://underhypeai.github.io/4evr-live-dashboard/

**Password:** the dashboard is gated by the 4EVR **admin secret** — the same
value the backend expects in the `x-admin-secret` header. Paste it into the
gate on first visit; it's stored in `sessionStorage` for the life of the tab
and sent with every request. Close the tab (or hit **logout**) to clear it.

The secret is never committed to this repo. If you get it, you already have
full admin API access, so there's no point in a separate dashboard password.

## Data flow

```
┌────────────┐      ┌──────────────────────────────────┐       ┌──────────────┐
│  GA4 Data  │ ───▶ │  4evr-app  /api/admin/           │ ─────▶│  Dashboard   │
│    API     │      │  dashboard-metrics?range=...     │       │  (this repo) │
└────────────┘      │  (aggregates GA4 + Postgres)     │       └──────────────┘
                    │  auth: x-admin-secret            │
┌────────────┐      │                                  │
│  Postgres  │ ───▶ │                                  │
│ (funnel,   │      └──────────────────────────────────┘
│  events)   │
└────────────┘
```

The dashboard makes **one** request per refresh to:

```
GET https://4evr.ink/api/admin/dashboard-metrics?range={day|week|month|year}
Header: x-admin-secret: <admin secret>
```

The backend is responsible for joining GA4 (traffic, top pages, sources) with
Postgres (funnel, revenue, affiliate attribution, recent events) and returning
a single payload. The dashboard re-renders from that payload.

### Expected payload shape

The dashboard is tolerant of missing fields, but the fuller shape it knows how
to render is:

```jsonc
{
  "kpi": {
    "live_visitors": 12,
    "today_visitors": 842,
    "today_visitors_delta_vs_yesterday": 24,
    "today_declarations": 3,
    "today_started_unpaid": 2,
    "today_revenue_usd": 240.00,
    "today_revenue_sats": 410_000,
    "today_revenue_delta_usd": 80.00
  },
  "histogram": {
    "buckets": [{ "label": "09:00", "visitors": 34, "sessions": 31, "pageviews": 61 }],
    "compare": [{ "label": "09:00", "visitors": 22 }]
  },
  "top_pages": [{ "path": "/", "views": 411, "uniques": 307, "avg_engagement_sec": 42.1 }],
  "traffic_sources": [{ "source_medium": "google / organic", "visitors": 120, "paid_declarations": 1, "revenue_usd": 80 }],
  "funnel": { "visited": 842, "declaration_view": 91, "started": 14, "paid": 5, "confirmed": 3 },
  "affiliates": [{ "code": "SATOSHI", "visitors": 45, "paid_declarations": 1, "revenue_usd": 80, "commission_usd": 12 }],
  "recent_events": [{ "type": "paid", "label": "anon@...", "ts": "2025-04-20T20:32:11Z" }]
}
```

## Refresh behavior

- Polls every **45 seconds**.
- A thin progress bar under the top bar shows time-to-next-refresh.
- **Pauses on window blur / tab hidden**; resumes + immediate fetch on focus.
- Tab switch (Day/Week/Month/Year) triggers an immediate fetch.
- On fetch error, keeps showing last good data with a stale indicator.

## Backend dependency

The `/api/admin/dashboard-metrics` endpoint is being added to
[UnderHypeAI/4evr-app](https://github.com/UnderHypeAI/4evr-app) in a parallel
PR. Until it merges and deploys, the dashboard will render the full layout with
"Backend not yet deployed" placeholders (the gate still works — any non-401
response, including 404/5xx/network error, lets you through so you can preview
the layout).

### CORS (follow-up on the backend side)

The Express app on Railway must allow CORS from this Pages origin for the
dashboard endpoint. Required origins:

- `https://underhypeai.github.io`
- `http://localhost:*` (local dev)

The relevant header is `Access-Control-Allow-Origin`; the admin endpoint also
needs to allow the `x-admin-secret` request header and respond to `OPTIONS`
preflights. **Aaron: this needs to land on the backend PR before the dashboard
can actually fetch data in production.**

## Deploy / update

- Edit files on `main`. A push triggers `.github/workflows/pages.yml`, which
  deploys the repo root to GitHub Pages.
- The only configurable is `config.js → API_BASE`. Change it if the backend
  moves.
- **Pages must be enabled once** for the workflow to succeed:
  Settings → Pages → Source: **GitHub Actions**. If an agent couldn't enable
  it via API, Aaron needs to flip this toggle once manually; subsequent pushes
  auto-deploy.

## Files

```
4evr-live-dashboard/
├── index.html          # single page
├── app.js              # fetch loop + rendering
├── styles.css          # dark / Bitcoin-orange theme
├── config.js           # API_BASE, poll interval, session key
├── README.md           # this file
└── .github/
    └── workflows/
        └── pages.yml   # deploy-on-push-to-main
```

Only external dependency: Chart.js (loaded from jsDelivr).

## Known limits

- **GA4 ingestion delay** — GA4's Data API typically lags real traffic by
  2–4 hours. Treat the "Today" / traffic-source numbers as directional, not
  up-to-the-second.
- **Postgres side is real-time** — live visitors, declarations, revenue,
  funnel, affiliate attribution, and the event feed all update immediately
  (bounded by the 45 s poll).
- **45 s refresh** — not streaming; don't expect sub-second updates.
- **Desktop first** — mobile is usable but not polished.
- **Single shared secret** — no per-user auth, no audit log. Whoever has the
  admin secret sees the dashboard.
- **Session-scoped auth** — closing the tab clears the secret; open it again
  and you'll be re-prompted.

## v2 ideas (explicitly out of scope)

- CSV export
- User-level drilldown
- Custom date range picker
- Collections / zaps stats
- Explorer search insights

---
name: solidtime
description: >-
  Track time in Solidtime (open-source time tracker, self-hosted or solidtime.io) via its REST API v1: discover your organization and member id, list projects/clients/tags, list and create time entries with correct UTC timestamps, dupe-check a day, update or delete entries. Use when the user wants to log time, track hours, record work, reconstruct a day/week, or mentions Solidtime / timetracker / time entries.
---

# Solidtime time tracking (REST API v1)

[Solidtime](https://github.com/solidtime-io/solidtime) is an open-source time tracker (Laravel + Passport). This skill drives its **REST API v1** over HTTPS with `curl` — no local binary required. Works against a self-hosted instance or the hosted `app.solidtime.io`.

## Setup

Create one token and export a few values. Store secrets in a file outside any repo (e.g. `~/.config/solidtime/credentials.env`, `chmod 600`), and source it:

```bash
export $(grep -v '^#' ~/.config/solidtime/credentials.env | xargs)
```

| Variable | How to get it |
|----------|---------------|
| `SOLIDTIME_API_TOKEN` | Web UI → Profile Settings → **Create API Token**. Shown **once** — copy immediately. |
| `SOLIDTIME_HOST` | Your instance origin, e.g. `https://app.solidtime.io` or `https://timetracker.example.com`. |
| `SOLIDTIME_ORG_ID` | Discover via `GET /users/me/memberships` (see below). |
| `SOLIDTIME_MEMBER_ID` | Same call — your **membership** id within the org. **Required to create entries** (≠ user id). |
| `SOLIDTIME_TZ_OFFSET` | Your local offset from UTC in whole hours (e.g. `6` for UTC+6). Used to convert local `HH:mm` → UTC. |

Base URL for every call: `${SOLIDTIME_HOST}/api/v1`.

## Authentication

Every request:
- `Authorization: Bearer $SOLIDTIME_API_TOKEN`
- `Accept: application/json`
- `Content-Type: application/json` (for POST/PUT/PATCH bodies)

Access is governed by your **member role** in the org (`owner`/`admin`/`manager`/`employee`/`placeholder`), not by token scopes. An `employee` token can log its own time but typically gets `403` on org-wide endpoints like `GET .../members` and `.../importers`.

## Discovery (run once, then cache the ids)

```bash
H=(-H "Authorization: Bearer $SOLIDTIME_API_TOKEN" -H "Accept: application/json")

# Who am I (name, email, timezone, week_start)
curl -s "${H[@]}" "$SOLIDTIME_HOST/api/v1/users/me"

# Organizations I belong to -> grab organization.id and membership id
curl -s "${H[@]}" "$SOLIDTIME_HOST/api/v1/users/me/memberships"
# => {"data":[{"id":"<MEMBER_ID>","organization":{"id":"<ORG_ID>","name":...,"currency":...},"role":...}]}
```

Set `SOLIDTIME_ORG_ID` = `organization.id`, `SOLIDTIME_MEMBER_ID` = the membership `id`.

> **member_id ≠ user_id.** Time-entry writes take `member_id` (membership within the org). The `user_id` only appears in *responses*.

## Resolve project / tag / client ids

All resource collections are **org-scoped**: `/organizations/{org}/...`.

```bash
ORG=$SOLIDTIME_ORG_ID
curl -s "${H[@]}" "$SOLIDTIME_HOST/api/v1/organizations/$ORG/projects"   # id, name, color, client_id, is_billable, is_archived
curl -s "${H[@]}" "$SOLIDTIME_HOST/api/v1/organizations/$ORG/tags"       # id, name
curl -s "${H[@]}" "$SOLIDTIME_HOST/api/v1/organizations/$ORG/clients"    # id, name
curl -s "${H[@]}" "$SOLIDTIME_HOST/api/v1/organizations/$ORG/tasks"      # id, name, project_id, is_done
```

Pagination: responses are `{data:[...], meta:{total:N}}`, default page 100. Walk with **`?limit=&offset=`** (`limit` max **500**, `offset` ≥ 0) — *not* `page`/`per_page`.

## List time entries (always dupe-check before writing)

```
GET /organizations/{org}/time-entries?member_id={member}&start={ISO_UTC}&end={ISO_UTC}
```

Useful query filters (all optional): `member_id`, `member_ids[]`, `project_ids[]`, `client_ids[]`, `tag_ids[]`, `task_ids[]`, `start`, `end` (ISO-UTC window on entry start), `active` (`true`/`false` — running timers), `billable`, `limit`, `offset`.

Each entry: `id, start, end, duration` (seconds, server-computed), `description, project_id, task_id, tags[], billable, user_id`.

## Create a time entry

```
POST /organizations/{org}/time-entries
```

| Field | Required | Notes |
|-------|----------|-------|
| `member_id` | **Yes** | `$SOLIDTIME_MEMBER_ID`. |
| `start` | **Yes** | Strict UTC `YYYY-MM-DDTHH:MM:SSZ`. See datetime warning. |
| `billable` | **Yes** | Boolean. |
| `end` | No | Same strict format, `end ≥ start`. **Omit or `null` = running timer.** Server computes `duration`. |
| `description` | No | `max 5000`. |
| `project_id` | No | Required if `task_id` is set. |
| `task_id` | No | Must belong to that `project_id`. |
| `tags` | No | Array of **tag ids** (UUIDs, not names). |

> **⚠ Datetime format is strict** — `date_format:Y-m-d\TH:i:s\Z`. UTC only, literal trailing `Z`, **no milliseconds, no `+00:00` offset**.
> `2026-06-30T03:00:00Z` ✅ — `2026-06-30T03:00:00.000Z` ❌ — `2026-06-30T03:00:00+00:00` ❌.
> (Migrating from Clockify? Clockify used `.000Z` — drop the milliseconds.)

```bash
curl -s "${H[@]}" -H "Content-Type: application/json" \
  -X POST "$SOLIDTIME_HOST/api/v1/organizations/$ORG/time-entries" \
  -d "{\"member_id\":\"$SOLIDTIME_MEMBER_ID\",\"start\":\"2026-06-30T03:00:00Z\",\"end\":\"2026-06-30T05:00:00Z\",\"billable\":false,\"description\":\"...\",\"project_id\":\"<PROJECT_ID>\"}"
```

Returns the created entry incl. computed `duration`.

## Update / delete

- Update one: `PUT /organizations/{org}/time-entries/{id}` — same body shape, all fields optional (partial update).
- Delete one: `DELETE /organizations/{org}/time-entries/{id}` → `204`.
- Bulk update: `PATCH /organizations/{org}/time-entries` with `{"ids":[...],"changes":{...}}` (changes may set member_id/project_id/task_id/billable/description/tags — **not** start/end).
- Bulk delete: `DELETE /organizations/{org}/time-entries` with `{"ids":[...]}`.
- My running timer: `GET /users/me/time-entries/active` (`404` = nothing running). Stop it by `PUT`-ing an `end`.

## Convert local `HH:mm` → UTC

`utc_hour = local_hour − SOLIDTIME_TZ_OFFSET`, normalize across day boundaries, serialize `YYYY-MM-DDTHH:MM:SSZ`.

- TZ_OFFSET `6` (UTC+6), local `09:00` 2026-06-30 → UTC `03:00` → `2026-06-30T03:00:00Z`.
- For a multi-day range or list, do **one POST per day** with the same local times and that day's date.
- If the user already gives a full ISO `...Z` string, pass it through (strip any milliseconds/offset).

## Other endpoints

- Create supporting records: `POST .../projects` (`name`, `color` hex, `is_billable`; optional `client_id`, `billable_rate` in **minor units/cents**, `estimated_time` in **seconds**, `is_public`), `POST .../tasks` (`name`, `project_id`), `POST .../clients` (`name`), `POST .../tags` (`name`).
- Aggregates / export: `GET .../time-entries/aggregate`, `GET .../time-entries/export`.
- Importers (Clockify/Toggl/Harvest): `GET .../importers`, `POST .../import` with `{"type":"clockify_time_entries","data":"<base64 of export file>"}` (keys also include `clockify_projects`, `toggl_time_entries`, `harvest_time_entries`, …). **Admin/manager-gated.**

## Errors

`401` bad/expired token. `403` role-gated (employee can't touch org-wide or others' data). `422` validation — body lists the offending fields (e.g. wrong datetime format, missing `billable`). On non-2xx, read the body and adjust.

## Operational flow

1. Source credentials; `GET /users/me` to confirm auth.
2. If org/member unknown: `GET /users/me/memberships` → set `ORG` + `MEMBER`.
3. Resolve `project_id` from `GET .../projects` (or a cached map).
4. **List the target day** to avoid double-logging.
5. Build JSON, `POST .../time-entries`. Show the response or the error (status + body).

Official docs: <https://docs.solidtime.io>. Source of truth for field names: the repo's `routes/api.php` + `app/Http/Requests/V1/**`.

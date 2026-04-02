# Finance Backend

A REST API for a finance dashboard system with role-based access control, built with Node.js, Express, and SQLite.

## Stack

- **Runtime**: Node.js
- **Framework**: Express
- **Database**: SQLite via `better-sqlite3` (file-based, zero config)
- **Auth**: JWT (Bearer tokens)
- **Validation**: `express-validator`
- **Password hashing**: `bcryptjs`
- **Rate limiting**: `express-rate-limit`

## Setup

```bash
cd finance-backend
npm install

# Copy and configure environment
cp .env.example .env

# Seed the database with sample users and records
npm run seed

# Start the server
npm start
# or for development with auto-reload:
npm run dev
```

The API will be available at `http://localhost:3000`.

## Environment Variables

| Variable        | Default         | Description                    |
|-----------------|-----------------|--------------------------------|
| `PORT`          | `3000`          | Server port                    |
| `JWT_SECRET`    | *(required)*    | Secret key for signing JWTs    |
| `JWT_EXPIRES_IN`| `24h`           | Token expiry duration          |
| `DB_PATH`       | `./finance.db`  | Path to SQLite database file   |

## Seed Accounts

After running `npm run seed`:

| Email                  | Password     | Role     |
|------------------------|--------------|----------|
| admin@example.com      | admin123     | admin    |
| analyst@example.com    | analyst123   | analyst  |
| viewer@example.com     | viewer123    | viewer   |

---

## Role Model

| Permission                        | Viewer | Analyst | Admin |
|-----------------------------------|--------|---------|-------|
| View financial records            | ✓      | ✓       | ✓     |
| View dashboard summaries/trends   | ✗      | ✓       | ✓     |
| Create / update records           | ✗      | ✓       | ✓     |
| Delete records (soft delete)      | ✗      | ✗       | ✓     |
| Manage users                      | ✗      | ✗       | ✓     |

Roles are hierarchical: admin > analyst > viewer.

---

## API Reference

### Auth

| Method | Endpoint       | Description              | Auth required |
|--------|----------------|--------------------------|---------------|
| POST   | /auth/register | Register a new user      | No            |
| POST   | /auth/login    | Login and receive a JWT  | No            |
| GET    | /auth/me       | Get current user info    | Yes           |

**POST /auth/login** — example request:
```json
{ "email": "admin@example.com", "password": "admin123" }
```
Response includes a `token` field. Pass it as `Authorization: Bearer <token>` on subsequent requests.

---

### Users (admin only)

| Method | Endpoint    | Description                    |
|--------|-------------|--------------------------------|
| GET    | /users      | List users (filter by role/status, paginated) |
| GET    | /users/:id  | Get a single user              |
| PATCH  | /users/:id  | Update name, role, or status   |
| DELETE | /users/:id  | Hard delete a user             |

**Query params for GET /users**: `role`, `status`, `page`, `limit`

---

### Financial Records

| Method | Endpoint       | Auth role     | Description                        |
|--------|----------------|---------------|------------------------------------|
| GET    | /records       | viewer+       | List records (filterable, paginated)|
| GET    | /records/:id   | viewer+       | Get a single record                |
| POST   | /records       | analyst+      | Create a record                    |
| PATCH  | /records/:id   | analyst+      | Update a record                    |
| DELETE | /records/:id   | admin         | Soft-delete a record               |

**Query params for GET /records**: `type` (income/expense), `category`, `from` (YYYY-MM-DD), `to` (YYYY-MM-DD), `page`, `limit`

**POST /records** — example body:
```json
{
  "amount": 1500.00,
  "type": "income",
  "category": "Salary",
  "date": "2024-06-01",
  "notes": "June salary"
}
```

---

### Dashboard (analyst+ only)

| Method | Endpoint                | Description                              |
|--------|-------------------------|------------------------------------------|
| GET    | /dashboard/summary      | Total income, expenses, net balance      |
| GET    | /dashboard/by-category  | Totals grouped by category and type      |
| GET    | /dashboard/trends       | Monthly or weekly trends for a given year|
| GET    | /dashboard/recent       | Most recent records with creator name    |

**GET /dashboard/trends** query params: `period` (monthly/weekly, default: monthly), `year` (default: current year)

**GET /dashboard/recent** query params: `limit` (default: 10, max: 50)

---

## Data Model

### users
| Column     | Type    | Notes                              |
|------------|---------|------------------------------------|
| id         | INTEGER | Primary key                        |
| name       | TEXT    |                                    |
| email      | TEXT    | Unique                             |
| password   | TEXT    | bcrypt hash                        |
| role       | TEXT    | viewer / analyst / admin           |
| status     | TEXT    | active / inactive                  |
| created_at | TEXT    | ISO datetime                       |
| updated_at | TEXT    | ISO datetime                       |

### financial_records
| Column     | Type    | Notes                              |
|------------|---------|------------------------------------|
| id         | INTEGER | Primary key                        |
| amount     | REAL    | Must be > 0                        |
| type       | TEXT    | income / expense                   |
| category   | TEXT    |                                    |
| date       | TEXT    | YYYY-MM-DD                         |
| notes      | TEXT    | Optional                           |
| created_by | INTEGER | FK → users.id                      |
| deleted_at | TEXT    | NULL = active, set = soft-deleted  |
| created_at | TEXT    |                                    |
| updated_at | TEXT    |                                    |

---

## Assumptions & Tradeoffs

- **SQLite** was chosen for zero-config simplicity. Swapping to PostgreSQL would only require changing the DB adapter in `src/db/index.js`.
- **Soft deletes** are used for financial records to preserve audit history. Hard deletes are used for users since records reference them by FK.
- **Role assignment on register** is open for simplicity (any role can be self-assigned). In production, you'd restrict this so only admins can assign elevated roles.
- **Analysts can create and update records** but cannot delete them — this reflects a common finance workflow where analysts enter data but only admins can remove it.
- **Viewers cannot access dashboard analytics** — the assumption is that raw record viewing is a lower-trust operation, while aggregated insights are reserved for analyst-level access.
- **No refresh tokens** — JWTs expire after 24h. A production system would add refresh token rotation.
- **Pagination** defaults to 20 items per page with a max of 100 for records.

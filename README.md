# Finance Data Processing and Access Control Backend

A full-stack finance dashboard system with role-based access control, built as a backend engineering assessment. The system manages financial records, enforces role-based permissions, and exposes aggregated analytics through a clean REST API — with a lightweight frontend to demonstrate all features visually.

**Live URL:** https://finance-app-production-abb0.up.railway.app

**Repository:** https://github.com/nishy02/finance-app

---

## Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Runtime | Node.js + Express | Minimal setup, clear routing |
| Database | SQLite (better-sqlite3) | Zero config, file-based, synchronous API keeps code simple |
| Auth | JWT (Bearer tokens) | Stateless, easy to test manually |
| Validation | express-validator | Declarative, per-route |
| Tests | Jest + Supertest | In-memory DB per test, fully isolated |
| Frontend | Vanilla HTML/CSS/JS | No build step, served as static files from the same Express server |

---

## Project Structure

```
finance-app/
├── finance-backend/
│   ├── src/
│   │   ├── db/
│   │   │   ├── index.js        # DB connection + schema init
│   │   │   ├── seed.js         # Local dev seed
│   │   │   └── init.js         # Production seed (runs on first boot)
│   │   ├── middleware/
│   │   │   ├── auth.js         # JWT verification, inactive user check
│   │   │   └── rbac.js         # Role hierarchy enforcement
│   │   ├── routes/
│   │   │   ├── auth.js         # Login, register, /me
│   │   │   ├── users.js        # User management (admin only)
│   │   │   ├── records.js      # Financial records CRUD
│   │   │   └── dashboard.js    # Aggregated analytics
│   │   └── app.js              # Express app entry point
│   └── src/tests/
│       ├── helpers/testApp.js  # In-memory test app factory
│       ├── users.test.js
│       ├── records.test.js
│       ├── dashboard.test.js
│       ├── rbac.test.js
│       └── access-control.test.js
├── finance-frontend/
│   ├── index.html              # Login
│   ├── register.html           # Sign up with role selection
│   ├── dashboard.html          # Analytics (analyst/admin)
│   ├── records.html            # Records CRUD (all roles)
│   ├── users.html              # User management (admin only)
│   ├── app.js                  # Shared auth, API client, nav
│   └── style.css
├── Dockerfile
└── railway.json
```

---

## Role Model

| Permission | Viewer | Analyst | Admin |
|------------|--------|---------|-------|
| View financial records | ✓ | ✓ | ✓ |
| View dashboard analytics | ✗ | ✓ | ✓ |
| Create / update records | ✗ | ✗ | ✓ |
| Delete records (soft) | ✗ | ✗ | ✓ |
| Manage users | ✗ | ✗ | ✓ |

Roles are hierarchical and enforced at the middleware level on every request. The role stored in the database is always authoritative — token claims are ignored for authorization decisions.

---

## Demo Accounts

| Email | Password | Role |
|-------|----------|------|
| admin@example.com | admin123 | admin |
| analyst@example.com | analyst123 | analyst |
| viewer@example.com | viewer123 | viewer |

---

## Testing the API — Live URL

All examples below use PowerShell. Replace the base URL if running locally (`http://localhost:3000`).

### 1. Authentication

**Login and store token**
```powershell
$res = Invoke-RestMethod -Uri "https://finance-app-production-abb0.up.railway.app/auth/login" `
  -Method POST -ContentType "application/json" `
  -Body '{"email":"admin@example.com","password":"admin123"}'
$token = $res.token
```

**Register a new user**
```powershell
Invoke-RestMethod -Uri "https://finance-app-production-abb0.up.railway.app/auth/register" `
  -Method POST -ContentType "application/json" `
  -Body '{"name":"Test User","email":"test@example.com","password":"pass123","role":"analyst"}'
```

**Get current user info**
```powershell
Invoke-RestMethod -Uri "https://finance-app-production-abb0.up.railway.app/auth/me" `
  -Headers @{Authorization="Bearer $token"}
```

---

### 2. Financial Records

**List all records (paginated)**
```powershell
Invoke-RestMethod -Uri "https://finance-app-production-abb0.up.railway.app/records" `
  -Headers @{Authorization="Bearer $token"}
```

**Filter by type**
```powershell
Invoke-RestMethod -Uri "https://finance-app-production-abb0.up.railway.app/records?type=income" `
  -Headers @{Authorization="Bearer $token"}
```

**Filter by category**
```powershell
Invoke-RestMethod -Uri "https://finance-app-production-abb0.up.railway.app/records?category=Salary" `
  -Headers @{Authorization="Bearer $token"}
```

**Filter by date range**
```powershell
Invoke-RestMethod -Uri "https://finance-app-production-abb0.up.railway.app/records?from=2024-10-01&to=2024-10-31" `
  -Headers @{Authorization="Bearer $token"}
```

**Get a single record**
```powershell
Invoke-RestMethod -Uri "https://finance-app-production-abb0.up.railway.app/records/1" `
  -Headers @{Authorization="Bearer $token"}
```

**Create a record (admin only)**
```powershell
Invoke-RestMethod -Uri "https://finance-app-production-abb0.up.railway.app/records" `
  -Method POST -ContentType "application/json" `
  -Headers @{Authorization="Bearer $token"} `
  -Body '{"amount":2500,"type":"income","category":"Freelance","date":"2024-11-01","notes":"Project payment"}'
```

**Update a record (admin only)**
```powershell
Invoke-RestMethod -Uri "https://finance-app-production-abb0.up.railway.app/records/1" `
  -Method PATCH -ContentType "application/json" `
  -Headers @{Authorization="Bearer $token"} `
  -Body '{"amount":5000,"notes":"Updated amount"}'
```

**Delete a record — soft delete (admin only)**
```powershell
Invoke-RestMethod -Uri "https://finance-app-production-abb0.up.railway.app/records/1" `
  -Method DELETE `
  -Headers @{Authorization="Bearer $token"}
```

---

### 3. Dashboard Analytics

First login as analyst or admin (both have dashboard access):
```powershell
$res = Invoke-RestMethod -Uri "https://finance-app-production-abb0.up.railway.app/auth/login" `
  -Method POST -ContentType "application/json" `
  -Body '{"email":"analyst@example.com","password":"analyst123"}'
$token = $res.token
```

**Summary — total income, expenses, net balance**
```powershell
Invoke-RestMethod -Uri "https://finance-app-production-abb0.up.railway.app/dashboard/summary" `
  -Headers @{Authorization="Bearer $token"}
```

**Category wise totals**
```powershell
Invoke-RestMethod -Uri "https://finance-app-production-abb0.up.railway.app/dashboard/by-category" `
  -Headers @{Authorization="Bearer $token"}
```

**Monthly trends**
```powershell
Invoke-RestMethod -Uri "https://finance-app-production-abb0.up.railway.app/dashboard/trends?period=monthly&year=2024" `
  -Headers @{Authorization="Bearer $token"}
```

**Weekly trends**
```powershell
Invoke-RestMethod -Uri "https://finance-app-production-abb0.up.railway.app/dashboard/trends?period=weekly&year=2024" `
  -Headers @{Authorization="Bearer $token"}
```

**Recent activity**
```powershell
Invoke-RestMethod -Uri "https://finance-app-production-abb0.up.railway.app/dashboard/recent?limit=10" `
  -Headers @{Authorization="Bearer $token"}
```

---

### 4. Access Control Verification

**Viewer cannot access dashboard — expect 403**
```powershell
$viewer = Invoke-RestMethod -Uri "https://finance-app-production-abb0.up.railway.app/auth/login" `
  -Method POST -ContentType "application/json" `
  -Body '{"email":"viewer@example.com","password":"viewer123"}'

Invoke-RestMethod -Uri "https://finance-app-production-abb0.up.railway.app/dashboard/summary" `
  -Headers @{Authorization="Bearer $($viewer.token)"}
```

**Analyst cannot create a record — expect 403**
```powershell
$analyst = Invoke-RestMethod -Uri "https://finance-app-production-abb0.up.railway.app/auth/login" `
  -Method POST -ContentType "application/json" `
  -Body '{"email":"analyst@example.com","password":"analyst123"}'

Invoke-RestMethod -Uri "https://finance-app-production-abb0.up.railway.app/records" `
  -Method POST -ContentType "application/json" `
  -Headers @{Authorization="Bearer $($analyst.token)"} `
  -Body '{"amount":100,"type":"income","category":"Test","date":"2024-01-01"}'
```

**No token — expect 401**
```powershell
Invoke-RestMethod -Uri "https://finance-app-production-abb0.up.railway.app/records"
```

---

### 5. User Management (admin only)

**List all users**
```powershell
Invoke-RestMethod -Uri "https://finance-app-production-abb0.up.railway.app/users" `
  -Headers @{Authorization="Bearer $token"}
```

**Filter by role**
```powershell
Invoke-RestMethod -Uri "https://finance-app-production-abb0.up.railway.app/users?role=analyst" `
  -Headers @{Authorization="Bearer $token"}
```

**Update a user's role**
```powershell
Invoke-RestMethod -Uri "https://finance-app-production-abb0.up.railway.app/users/2" `
  -Method PATCH -ContentType "application/json" `
  -Headers @{Authorization="Bearer $token"} `
  -Body '{"role":"admin"}'
```

**Deactivate a user**
```powershell
Invoke-RestMethod -Uri "https://finance-app-production-abb0.up.railway.app/users/3" `
  -Method PATCH -ContentType "application/json" `
  -Headers @{Authorization="Bearer $token"} `
  -Body '{"status":"inactive"}'
```

---

## Running Tests

```bash
cd finance-backend
npm install
npm test
```

Tests use an in-memory SQLite database — no setup required, no side effects on the real DB. 180 tests across 5 suites covering user management, records CRUD, dashboard analytics, RBAC matrix, and access control edge cases.

---

## Running Locally

```bash
git clone https://github.com/nishy02/finance-app
cd finance-app/finance-backend
npm install
cp .env.example .env        # set JWT_SECRET to any string
npm run seed                # creates demo accounts + sample records
npm start
```

Open `http://localhost:3000`.

---

## API Reference

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | /auth/register | None | Create account |
| POST | /auth/login | None | Login, returns JWT |
| GET | /auth/me | Any | Current user info |
| GET | /records | Any | List records (filterable, paginated) |
| GET | /records/:id | Any | Single record |
| POST | /records | Admin | Create record |
| PATCH | /records/:id | Admin | Update record |
| DELETE | /records/:id | Admin | Soft delete record |
| GET | /dashboard/summary | Analyst+ | Income, expenses, net balance |
| GET | /dashboard/by-category | Analyst+ | Totals grouped by category |
| GET | /dashboard/trends | Analyst+ | Monthly or weekly trends |
| GET | /dashboard/recent | Analyst+ | Recent activity with creator name |
| GET | /users | Admin | List users |
| GET | /users/:id | Admin | Single user |
| PATCH | /users/:id | Admin | Update role or status |
| DELETE | /users/:id | Admin | Delete user |

---

## Assumptions and Tradeoffs

- **SQLite** was chosen for zero-config simplicity. The DB adapter is isolated in `src/db/index.js` — swapping to PostgreSQL would only require changing that file.
- **Soft deletes** on financial records preserve audit history. Hard deletes are used for users since no financial data is attached to the user row itself.
- **Analyst role is read-only** for records. Only admins can create, update, or delete records. Analysts can view records and access all dashboard analytics.
- **Role is re-fetched from the DB on every request** — the role claim in the JWT is ignored for authorization. This means role changes and deactivations take effect immediately without requiring a new token.
- **No refresh tokens** — JWTs expire after 24h. Acceptable for an assessment context.
- **Rate limiting** is applied globally at 100 requests per 15 minutes per IP.
- **Frontend is served as static files** from the same Express server — no separate deployment needed.

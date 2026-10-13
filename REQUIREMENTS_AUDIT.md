# ProjectEval — Requirements Audit (Phase 1)

**Audit date:** 2026-10-13
**Scope:** `client/` and `server/` as they exist in the working tree (repository initialised, no commits yet). No application code, models, dependencies or configuration were changed for this audit.

## How statuses are assigned

| Status | Meaning |
|---|---|
| **Implemented and verified** | Server behaviour is covered by a passing automated test (or was exercised end-to-end through the dev proxy), **and** the frontend page/control that uses it exists and is wired to the API (confirmed by code inspection and a successful production build). |
| **Partially implemented** | Some of the requirement exists, but a named piece is missing, or the behaviour differs from the finalized requirement. |
| **Missing** | No implementation found in either client or server. |
| **Not verified** | Code exists but no test or run has confirmed it works. |

**Global limitation:** no browser was available in this environment, so no page has been visually inspected or clicked through. Layout, responsiveness, focus behaviour and visual states (loading/empty/error/success) are confirmed only by reading the code, not by looking at the rendered UI. There are **no frontend automated tests**.

---

## 1. The 13 required pages

| # | Required page | Status | Where it lives | Specific missing work |
|---|---|---|---|---|
| 1 | **Login Page** | Implemented and verified | `client/src/pages/Login.jsx` → `POST /api/auth/login` (`server/src/routes/auth.js`) | Works with email + password; role-based landing after login. **Decision needed:** a public **student self-registration** page (`/register`, `Register.jsx`) also exists. If the finalized rule is "admin registers all students", it must be removed or put behind a setting. |
| 2 | **Home / Project Showcase** | Partially implemented | `Landing.jsx` (guests, marketing only); `MemberDashboard.jsx` / `AdminDashboard.jsx` (signed-in home) | There is **no project showcase** on the home page: the guest landing page shows no projects, and the signed-in dashboard shows only "waiting for your rating" items. Needs a showcase section (featured/approved projects, top-rated, event info), and a decision on whether it is public or sign-in only. |
| 3 | **Admin Dashboard** | Implemented and verified | `pages/admin/AdminDashboard.jsx` → `GET /api/admin/stats` | Shows students, faculty, attendance, ratings, project status counts, participation meters and recent activity. Overall (combined) rating figures are not shown (see §6). |
| 4 | **Student Management** | Partially implemented | `pages/admin/Accounts.jsx` (Students tab) → `/api/admin/users` (`routes/users.js`) | **Not a dedicated page**: it is a tab inside a combined "Accounts" page. Has create/edit/deactivate/delete/reset-password, search, active/inactive filter and pagination. **Missing:** academic-year filter (no `year` query param in `userListQuery`, `utils/schemas.js:93`), roll-number sorting (list sorts by `role, name`, `routes/users.js:36`), bulk registration (CSV/Excel import) and a student detail view (`GET /api/admin/users/:id` exists but **no frontend uses it**). |
| 5 | **Attendance Management** | Partially implemented | `pages/admin/Attendance.jsx` → `/api/admin/attendance` (`routes/attendance.js`) | Mark present/absent per row and in bulk, session-date picker, search, status filter, summary counts, export current session or all sessions. Roll-number ordering is **fixed server-side** (`attendance.js:46`), with no user-selectable sort. **Missing:** academic-year filter. `GET /api/admin/attendance/sessions` (session history) exists but **no frontend uses it**. |
| 6 | **Faculty Management** | Partially implemented | `pages/admin/Accounts.jsx` (Faculty tab) | **Not a dedicated page.** Create/edit/deactivate/reset works through the shared Accounts modal. **Missing:** faculty-specific columns (guided projects, ratings given), department filter, and a separate route/nav item if the 13-page structure is required. |
| 7 | **Analytics** (separate Student Analytics and Faculty Analytics) | Partially implemented | `pages/admin/Reports.jsx` ("Project results" and "Participation" tabs); participation meters on `AdminDashboard.jsx` | **No separate Student Analytics / Faculty Analytics pages.** Participation is one table with a role dropdown. **Missing:** per-group dashboards with participation % over time or by department/year, voted vs. not-voted counts per group, rating distributions per group, and attendance-vs-voting breakdown for students. |
| 8 | **Leaderboard Management** | Partially implemented | `pages/admin/EventSettings.jsx` (toggle "Publish leaderboards") → `PATCH /api/admin/settings` | Admin can only show or hide results. **Missing:** a dedicated management page: preview of student/faculty/overall boards, tie handling or minimum-vote threshold, publish/unpublish per board, and leaderboard export. |
| 9 | **Presenter Dashboard** | Partially implemented | `pages/MyProjects.jsx` ("My submissions"), presenter section of `MemberDashboard.jsx`, anonymous feedback on `ProjectDetail.jsx` | Presenters see status, review notes, and edit/delete. **Missing:** a consolidated presenter view showing per-project rating summary (student/faculty/overall averages, vote counts) and recent feedback, plus deadline/countdown information. "Presenter" is not a role; any student can present. Confirm this is the intended model. |
| 10 | **Project Registration / Edit Project** | Partially implemented | `pages/ProjectForm.jsx` → `POST/PATCH /api/projects`, `POST/DELETE /api/projects/:id/files` | All required fields, team-member rows, faculty-guide picker and file uploads work; approved projects are locked. **Missing:** real **deadline rules**: there is only a manual `submissionsOpen` switch (`models/Settings.js`), which blocks new submissions but **not edits**. No submission/edit deadline date-time exists. |
| 11 | **Browse Projects** | Implemented and verified | `pages/Projects.jsx` → `GET /api/projects`, `/api/projects/technologies` | Search, technology filter, pagination, "rated / your project" badges. Admin sees all statuses. (Possible additions: filter by department/guide, "not yet rated" filter.) |
| 12 | **Project Details and Rating** | Implemented and verified | `pages/ProjectDetail.jsx` → `GET /api/projects/:id`, `PUT /api/projects/:id/rating` | Star rating 1–5, required feedback (20–2000 chars), update existing rating, eligibility message, file downloads, group stats, admin approve/reject. Overall average not shown (see §6). |
| 13 | **Voter Leaderboard** | Partially implemented (needs clarification) | `pages/Leaderboard.jsx` → `GET /api/leaderboard?group=student\|faculty` | Student and Faculty boards exist. **Missing:** an **overall** board. **Clarify the meaning:** if "Voter Leaderboard" means a ranking *of voters* (e.g. most projects evaluated), it does not exist at all. |

---

## 2. Account management

| Requirement | Status | Relevant file / API | Missing work |
|---|---|---|---|
| Admin registers students | Implemented and verified | `POST /api/admin/users`, `Accounts.jsx` "Add student" | No bulk import. Self-registration also exists (decision needed, see page 1). |
| Admin registers faculty | Implemented and verified | same; test *"admin creates faculty but cannot create admins"* | — |
| Admin edits / deactivates / deletes / resets passwords | Implemented (partly verified) | `PATCH/DELETE /api/admin/users/:id`, `POST …/reset-password` | Deactivation is covered by a test; edit, delete and reset-password have **no automated test** (Not verified). |
| Admin accounts protected from API modification | Implemented and verified | `routes/users.js` `loadManagedUser` | Admins are created only via `npm run seed:admin`. |
| Search | Implemented | `userListQuery.search`, Accounts and Attendance search boxes | No automated test for search. |
| Academic-year filtering | **Missing** | `year` field exists on `User` (`models/Users.js`) | No filter in user list, attendance or reports, either API or UI. Also confirm whether "academic year" means year of study (1–4) or a batch/session such as 2025-26. |
| Roll-number sorting | Partially implemented | `routes/attendance.js:46,112` | Attendance list and export are always sorted by roll number. Student list is sorted by name with no sort control. |
| Attendance Excel export | Implemented and verified | `GET /api/admin/attendance/export?session=…\|all`; test *"attendance exports to Excel"*; workbook contents checked in an earlier session | Export ignores the on-screen search/status filters. No year filter. |

## 3. Voting eligibility

| Requirement | Status | Relevant file / API | Missing work |
|---|---|---|---|
| Students vote only when marked Present | Implemented and verified | `services/eligibility.js`; test *"students must be marked present before voting"* | Eligibility is tied to one **active session date** set by the admin. Confirm this matches the finalized rule. |
| Faculty vote without attendance | Implemented and verified | same; test *"faculty vote without attendance"* | — |
| Voting open/closed control | Implemented and verified | `Settings.votingOpen`; test *"nobody can vote while voting is closed"* | No scheduled open/close time. |
| Admins cannot vote | Implemented and verified | `authorize("student","faculty")`; test *"admins cannot vote"* | — |
| Presenters cannot rate own project | Implemented and verified | `isOwnProject`; test | Matches by submitter or by roll number on the team list. |

## 4. Presenter projects

| Requirement | Status | Relevant file / API | Missing work |
|---|---|---|---|
| Register project with unique number, title, abstract, description, technologies, team, guide | Implemented and verified | `POST /api/projects`; tests for uniqueness and guide validation | — |
| Edit project | Implemented (partly verified) | `PATCH /api/projects/:id` | Locking after approval is tested. Successful edit and rejected→pending resubmission are **not tested**. |
| Supporting file uploads | Implemented and verified | `middleware/upload.js`, GridFS; test checks signature/type and download | Limits: 5 files × 5 MB. File delete has no test. |
| Admin approval workflow | Implemented and verified | `PATCH /api/admin/projects/:id/status`; `AdminProjects.jsx` | "Request changes" note path has no test. |
| Deadline rules | **Missing** (only a manual switch) | `Settings.submissionsOpen` | Need submission and edit deadline date-times enforced on the server (create, edit, upload) and shown in the UI. |

## 5. Ratings

| Requirement | Status | Relevant file / API | Missing work |
|---|---|---|---|
| Score out of 5 (whole numbers) | Implemented and verified | `ratingSchema`, `Rating` model; test rejects 6 and 3.5 | — |
| Required written feedback | Implemented and verified | min 20 / max 2000 chars; test rejects short feedback | — |
| One rating per voter per project, updates allowed | Implemented and verified | unique index `(project, voter)`; test | No "delete my rating" (not required). |

## 6. Rating calculations and leaderboards

| Requirement | Status | Relevant file / API | Missing work |
|---|---|---|---|
| Student average and vote count | Implemented and verified | `services/reports.js`; test *"leaderboards are computed per voter group"* | — |
| Faculty average and vote count | Implemented and verified | same | — |
| **Overall rating** (combined) | **Missing** | — | No overall average or overall leaderboard in any API, page or export. The weighting rule needs to be defined (simple mean of all votes, or weighted student/faculty). |
| Student leaderboard / Faculty leaderboard | Implemented and verified | `GET /api/leaderboard`, `Leaderboard.jsx` | Shows average, votes, distribution and tie-aware ranks. |
| Hide/publish results | Implemented and verified | `leaderboardVisible`; test | — |

## 7. Analytics

| Requirement | Status | Relevant file / API | Missing work |
|---|---|---|---|
| Student participation % | Implemented | `GET /api/admin/stats` (`studentRate`, `presentRate`); test checks counts | No dedicated Student Analytics page (see page 7). |
| Faculty participation % | Implemented | `facultyRate` | No dedicated Faculty Analytics page. |
| Participation lists (voted / not voted) | Implemented (Not verified in UI) | `GET /api/admin/reports/participation`; `Reports.jsx` | Test covers the "not-voted" API filter only. |
| Breakdown by department / academic year | **Missing** | — | — |

## 8. Privacy and reports

| Requirement | Status | Relevant file / API | Missing work |
|---|---|---|---|
| Voter identities visible to admins only | Implemented and verified | `GET /api/admin/projects/:id/ratings`; test *"voter identities are protected from ordinary users"* | — |
| Presenters/guides see anonymous feedback | Implemented and verified | `GET /api/projects/:id/feedback` | — |
| Voting report export (Excel) | Implemented and verified | `GET /api/admin/reports/voting/export`; test | No overall average column. |
| Audit log | Implemented (Not verified) | `GET /api/admin/audit-logs`, `ActivityLog.jsx` | No test. |

## 9. Role-based access control and account security

| Requirement | Status | Relevant file / API | Missing work |
|---|---|---|---|
| No self-assigned privileged roles | Implemented and verified | strict zod schemas; test *"registration cannot assign a privileged role"* | — |
| Server-side role checks | Implemented and verified | `middleware/auth.js` `authorize`; tests for 401/403 | — |
| Client route guards | Implemented (Not verified) | `components/RouteGuards.jsx` | No frontend tests. |
| Password hashing | Implemented | bcrypt, 12 rounds (`models/Users.js`) | — |
| Session security | Implemented and verified | httpOnly cookie JWT, token-version revocation; revocation tests | — |
| Rate limiting | Implemented (Not verified) | `middleware/rateLimits.js` | Limiters are **disabled under tests**, so behaviour is untested. |
| Upload security | Implemented and verified | signature check, allow-list, GridFS, attachment + CSP | — |
| Forced password change on first login (admin-issued passwords) | **Missing** | — | Recommended, because admin-created accounts get temporary passwords. |
| Self-service password reset | **Missing** | Admin reset only | Optional; needs email service setup. |

## 10. Navigation, forms, validation and error handling

| Requirement | Status | Notes |
|---|---|---|
| Navigation | Implemented (Not verified visually) | `AppShell.jsx` role-based sidebar and mobile drawer. Nav labels do not match the 13-page naming (e.g. "Accounts" instead of Student/Faculty Management). |
| Form validation | Implemented | Server-side zod with field errors mapped into forms; client-side checks on rating, register and password forms. |
| Loading / empty / error / success states | Implemented (Not verified visually) | Shared `PageLoader`, `Skeleton`, `EmptyState`, `ErrorState`, toasts. |
| Responsive layout | Not verified | Tailwind responsive classes present, never viewed at phone width. |

---

## 11. Checks run during this audit

| Command | Result |
|---|---|
| `cd server && npm test` | **30 passed, 0 failed** (6 suites, ~15 s). Uses `mongodb-memory-server`; never connects to Atlas. |
| `cd client && npm run lint` | **Passed** (0 problems). |
| `cd client && npm run build` | **Passed** (Vite 8.3.4, 2002 modules, main bundle 361 kB / 116 kB gzip). |

**Not available / not run**
- No frontend test suite exists (no Vitest/Playwright).
- No browser available; UI not visually or interactively verified in this audit. In the previous session the API flow (login → mark attendance → rate → leaderboard → upload → Excel exports) was exercised through the Vite proxy against a throwaway database, but that was not repeated today.
- The live Atlas database and deployment (Render/Vercel) were not tested, and the deployment config has never been deployed.
- Unused endpoints with no UI: `GET /api/admin/users/:id`, `GET /api/admin/attendance/sessions`.

---

## 12. Recommended fix order

1. **Confirm the open decisions:** self-registration vs. admin-only registration; meaning of "academic year"; overall-rating formula; meaning of "Voter Leaderboard"; deadline semantics (submission vs. edit vs. upload).
2. **Overall rating calculation** across API, leaderboard, project detail, reports and export. Core scoring feature; affects several pages.
3. **Deadline rules** (server-enforced date-times for submission and editing, shown in the UI).
4. **Student Management and Faculty Management as separate pages,** with academic-year filter, roll-number sort, and student detail (reusing the existing `GET /api/admin/users/:id`). Then add the year filter to Attendance and its export.
5. **Student Analytics and Faculty Analytics pages** (participation %, voted/not voted, department/year breakdowns, rating distributions).
6. **Leaderboard Management page** (preview, publish per board, export) and **Voter Leaderboard** per the clarified meaning.
7. **Presenter Dashboard** consolidation and **Home / Project Showcase**.
8. **Security hardening:** forced password change for admin-issued passwords; tests for rate limits, edit/reset/delete paths.
9. **Frontend tests and a browser pass** (component tests + one end-to-end smoke test per role; phone-width check).

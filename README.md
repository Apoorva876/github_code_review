# CodeRubric

An AI-powered GitHub repository analysis and engineering rubric code review platform built with React, TypeScript, Express, Gemini (`@google/genai`), GitHub OAuth, and Firebase (Google Authentication & Cloud Firestore).

---

## Key Features

### Multi-Agent AI Analysis Engine
- **Six Specialized AI Agents**:
  - **Security Sentinel** — Vulnerability, auth, injection, and secrets auditing
  - **Architecture Rubric** — Modularity, coupling, boundaries, and design patterns
  - **Performance Profiler** — Algorithmic complexity, N+1 queries, memory, and I/O hot spots
  - **Reliability Guard** — Error handling, concurrency, retries, and failure modes
  - **Testing & Coverage Auditor** — Unit/integration gaps, edge cases, and test quality
  - **API & Documentation Reviewer** — Contracts, validation, schemas, and inline docs
- **Configurable Agent Personas**: Toggle individual agents on/off, tune enforcement strictness (`strict`, `balanced`, `advisory`), choose Gemini thinking depth (`LOW`, `MEDIUM`, `HIGH`), and customize system rubric instructions.
- **Full-Repository Background Jobs**: Recursively collects eligible repository source files via the GitHub API, executes all enabled agents in the background with persistent job tracking, and synthesizes a unified repository-level review with rubric pillar scores (`Security`, `Reliability`, `Maintainability`, `Performance`).

### GitHub Integration & Code Browsing
- **GitHub OAuth Authentication**: Sign in via popup-based GitHub OAuth (stored in HMAC-signed `HttpOnly` server session cookies; tokens are never exposed to the browser) or optionally configure a server fallback Personal Access Token.
- **Live Repository Inspector**: Browse public and private repositories, switch branches, inspect directory trees and UTF-8 source files, review commit history, inspect pull requests, trigger single-file Gemini audits, or launch PR & full-repository reviews.

### Interactive Developer SaaS Dashboard
- **Dashboard & Analytics**: Date-range filtering (`7 Days`, `14 Days`, `30 Days`, `All Time`), animated clickable KPI cards, hover-interactive Issue Severity Distribution and Repository Activity charts, live AI Agent telemetry, and repository analysis activity tracking.
- **Code Reviews & Audit History**: Search and filter by decision status, source (`Live Gemini` / `Demo`), finding severity, AI agent, repository, and date range; sort columns; expand rows inline for rubric score breakdowns, `filePath:lineStart-lineEnd` source locations, evidence snippets, suggested fixes, and finding resolution toggles; inspect full details in the slide-over drawer; or export filtered reviews to CSV.
- **Global Command Palette (`Ctrl+K` / `Cmd+K`)**: Instant keyboard-driven search across repositories, reviews, findings, AI agents, and quick workspace actions.
- **Google Auth & Cloud Firestore Sync**: Authenticates users via Firebase Google sign-in (with verified-email gating) and syncs repositories, reviews, agent settings, analysis jobs, and preferences per user account alongside a local JSON fallback store.

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, Lucide Icons
- **Backend**: Node.js, Express (`server.ts` serving both API routes and Vite middleware in development / `dist` in production)
- **AI Engine**: `@google/genai` (server-side Gemini calls)
- **Auth & Persistence**: Firebase Authentication (Google Sign-In), Cloud Firestore, GitHub OAuth 2.0, local JSON persistence (`data/`)

---

## Project Structure

```text
├── server.ts                          # Express entrypoint + Vite dev middleware / static prod serving
├── server/
│   ├── routes/
│   │   ├── api.ts                     # Dashboard, repos, analysis jobs, reviews, agents, settings APIs
│   │   └── auth.ts                    # GitHub OAuth URL, callback, status, and logout routes
│   ├── services/
│   │   ├── geminiReviewService.ts     # Single-PR / diff Gemini review execution
│   │   ├── githubAuthService.ts       # GitHub OAuth token exchange & signed HttpOnly session cookies
│   │   ├── githubService.ts           # GitHub REST API client & recursive source collector
│   │   ├── repositoryAnalysisService.ts     # Multi-agent orchestration & synthesis
│   │   └── repositoryAnalysisJobService.ts  # Background repository analysis job runner
│   ├── demoSeed.ts                    # Baseline demo workspace dataset & 6 agent definitions
│   ├── store.ts                       # JSON persistence & interrupted job recovery
│   └── types.ts                       # Shared backend domain types
├── src/
│   ├── App.tsx                        # Main workspace shell, auth gating, routing & Ctrl+K palette
│   ├── firebase.ts                    # Firebase App, Auth, and Firestore initialization
│   ├── context/
│   │   ├── FirebaseContext.tsx        # Google sign-in state & bidirectional Cloud Firestore sync
│   │   └── ToastContext.tsx           # Toast notifications
│   ├── services/
│   │   ├── api.ts                     # Typed frontend REST client
│   │   └── firestoreSync.ts           # Cloud Firestore workspace serialization & mutations
│   ├── components/                    # Layout, charts, modals, analysis widgets, UI primitives
│   ├── hooks/                         # Polling hook for background repository analysis jobs
│   ├── utils/                         # Formatters, CSV export, workspace metrics & search helpers
│   └── views/                         # Login, Dashboard, Repositories, Code Reviews, Agents, History, Analytics, Settings
├── firebase-applet-config.json        # Firebase web client configuration
├── firebase-blueprint.json            # Firestore schema & collection blueprint
├── firestore.rules                    # Hardened Firestore security rules
├── firestore.rules.test.ts            # Security rules regression & validation suite
└── .env.example                       # Environment variable template
```

---

## Environment Configuration

Copy `.env.example` or configure the following variables in your server environment / secrets manager (never commit actual secrets):

| Variable | Required | Description |
| --- | --- | --- |
| `GEMINI_API_KEY` | Yes (for AI reviews) | Gemini API key used exclusively server-side by `@google/genai`. |
| `APP_URL` | Recommended | Hosted application URL used to build OAuth callback URLs. |
| `GITHUB_CLIENT_ID` | For GitHub OAuth | OAuth App Client ID from GitHub Developer Settings. |
| `GITHUB_CLIENT_SECRET` | For GitHub OAuth | OAuth App Client Secret (kept server-side only). |
| `SESSION_SECRET` | Recommended | HMAC signing key for `HttpOnly` GitHub OAuth session cookies. |
| `PORT` | Optional | Server port (defaults to `3000`). |

> Configure your GitHub OAuth App callback URL to `<APP_URL>/auth/github/callback`.

---

## Getting Started

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Start the development server** (runs Express + Vite middleware on port `3000`)
   ```bash
   npm run dev
   ```

3. **Type-check & build for production**
   ```bash
   npm run lint
   npm run build
   ```

4. **Run in production mode**
   ```bash
   NODE_ENV=production npm start
   ```

5. **Verify Firestore security rules**
   ```bash
   npx eslint firestore.rules
   npx tsx firestore.rules.test.ts
   ```

---

## API Overview

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Server health check |
| `GET` | `/api/dashboard` | Workspace KPI overview, severity totals, and daily trends |
| `GET` | `/api/auth/github/status` | Current GitHub OAuth session & server config status |
| `GET` | `/api/auth/github/url` | Generates GitHub OAuth authorization URL |
| `GET` | `/auth/github/callback` | GitHub OAuth callback handler |
| `POST` | `/api/auth/github/logout` | Clears GitHub OAuth session cookie |
| `GET` | `/api/github/user/repos` | Lists authenticated user's GitHub repositories |
| `GET` / `POST` | `/api/repositories` | Lists or connects repositories |
| `PATCH` / `DELETE` | `/api/repositories/:id` | Toggles auto-review or disconnects a repository |
| `GET` | `/api/repositories/:id/details\|branches\|commits\|contents\|pulls` | Live GitHub metadata, tree, source file, and PR browsing |
| `POST` | `/api/repositories/:id/collect` | Collects eligible repository source files |
| `POST` | `/api/repositories/:id/analyze` | Queues a background multi-agent repository analysis job |
| `GET` | `/api/repositories/:id/analysis-jobs` | Lists analysis jobs for a repository |
| `GET` | `/api/analysis-jobs/:jobId` | Retrieves job progress, agent breakdown, and result review ID |
| `GET` | `/api/reviews` | Lists all PR, diff, and repository reviews |
| `GET` | `/api/reviews/:id` | Fetches a specific review |
| `POST` | `/api/reviews/run` | Runs a Gemini review on a GitHub PR or pasted diff |
| `PATCH` | `/api/reviews/:id/status` | Updates review approval decision |
| `PATCH` | `/api/reviews/:id/findings/:findingId` | Marks an individual finding resolved/open |
| `GET` / `PATCH` | `/api/agents` & `/api/agents/:id` | Lists and updates the six AI reviewer agents |
| `GET` / `PATCH` | `/api/settings` | Reads and updates workspace preferences & optional fallback PAT |
| `POST` | `/api/demo/reset` | Restores baseline demo repositories and reviews |
| `POST` | `/api/workspace/hydrate` | Hydrates server workspace snapshot from Firestore on sign-in |

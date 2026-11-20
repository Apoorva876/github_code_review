# CodeRubric Firestore Security Specification

## 1. Data Invariants
1. **Strict Owner Isolation**: Every user workspace collection (`/users/{userId}/...`) is readable and writable ONLY by the verified Firebase user whose `request.auth.uid == userId` and `request.auth.token.email_verified == true`.
2. **PII Split Isolation**: User email is isolated in `/users/{userId}/private/account` with zero `list` permission and strict owner-only `get`, `create`, `update`. `/users` root collection has NO `allow list`.
3. **Zero Secret Persistence**: GitHub tokens (`githubToken`, `accessToken`), Gemini API keys (`apiKey`), and session secrets are NEVER permitted in any Firestore document (`hasOnly(...)` blocks any ghost/secret keys).
4. **Master Gate**: Every subcollection under `/users/{userId}/...` verifies parent profile existence via `exists(/databases/$(database)/documents/users/$(userId))`.
5. **Immutable Ownership & Creation Timestamps**: `ownerUid`, `id`, and `firestoreCreatedAt` are immutable once created (`incoming().ownerUid == existing().ownerUid`, `incoming().firestoreCreatedAt == existing().firestoreCreatedAt`).
6. **Temporal Integrity**: `firestoreCreatedAt == request.time` on create; `firestoreUpdatedAt == request.time` on create and update.
7. **Terminal State Locking on Analysis Jobs**: Once an `AnalysisJobRecord` reaches `status` in `['completed', 'partial', 'failed']`, client updates cannot reopen or mutate terminal job fields.
8. **Size & Array Bounds**: Every string field enforces `.size() <= MAX` and every array (`activitySeries`, `findings`, `strengths`, `agentBreakdown`, `dailyActivity`) enforces strict upper bounds and first-element type checks when non-empty.

## 2. "Dirty Dozen" Adversarial Payloads (Expected: PERMISSION_DENIED)
1. **Cross-User Read/List (`uidA` queries `/users/uidB/reviews`)**: Denied because `request.auth.uid != userId`.
2. **Unverified Email Spoof (`email_verified: false` attempts write)**: Denied by `isVerifiedUser()`.
3. **UID Spoofing on Create (`ownerUid: 'victim-uid'` inside `/users/attacker-uid/repositories/repo1`)**: Denied because `incoming().ownerUid == userId` & `isOwner(userId)`.
4. **Shadow/Secret Field Injection (`githubToken: 'ghp_123'` or `isAdmin: true` in `settings/workspace`)**: Denied by strict `data.keys().hasOnly(...)`.
5. **ID Path Poisoning (`repositoryId` containing spaces, slashes, or 500-char string)**: Denied by `isValidId(repositoryId)`.
6. **Oversized `diffPreview` Exhaustion (`diffPreview` = 500KB string in `reviews/{id}`)**: Denied by `data.diffPreview.size() <= 8000`.
7. **Client Timestamp Forgery (`firestoreCreatedAt: '2020-01-01T00:00:00Z'` instead of `request.time`)**: Denied by `incoming().firestoreCreatedAt == request.time`.
8. **Immutable Ownership Mutation (`ownerUid` changed on update of `reviews/{id}`)**: Denied by `incoming().ownerUid == existing().ownerUid`.
9. **Terminal Job Tampering (updating `status: 'queued'` on a `'completed'` `analysisJobs/{id}`)**: Denied by terminal state lock (`!(existing().status in ['completed', 'partial', 'failed'])`).
10. **Unbounded Array Bomb (`findings` with 500 items or `activitySeries` with 100 items)**: Denied by `data.findings.size() <= 100` and `data.activitySeries.size() <= 30`.
11. **Root PII Enumeration (`list` on `/users`)**: Denied because `/users/{userId}` forbids `list`.
12. **Orphan Subcollection Write (writing `/users/{userId}/reviews/r1` without parent `/users/{userId}` existing)**: Denied by Master Gate `exists(/databases/$(database)/documents/users/$(userId))`.

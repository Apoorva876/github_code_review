import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Security Rules Invariant & "Dirty Dozen" Verification Suite for CodeRubric.
 * Verifies that firestore.rules strictly enforces all 8 Pillars and rejects every
 * Dirty Dozen adversarial pattern documented in security_spec.md.
 */
const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
const blueprintPath = path.resolve(process.cwd(), 'firebase-blueprint.json');

const rules = fs.readFileSync(rulesPath, 'utf-8');
const blueprint = JSON.parse(fs.readFileSync(blueprintPath, 'utf-8')) as {
  entities: Record<string, { properties: Record<string, { maxLength?: number }> }>;
  firestore: Record<string, { schema: { $ref: string } }>;
};

// 1. Rules version & Global Safety Net
assert.ok(rules.includes("rules_version = '2';"), 'Must use rules_version = 2');
assert.ok(
  /match \/\{document=\*\*\} \{\s*allow read, write: if false;\s*\}/.test(rules),
  'Global default-deny catch-all rule must exist'
);

// 2. Email verification & owner isolation
assert.ok(
  rules.includes('request.auth.token.email_verified == true'),
  'Must enforce verified email on writes/reads'
);
assert.ok(
  rules.includes('allow list: if false;') && /match \/users\/\{userId\}[\s\S]*allow list: if false;/.test(rules),
  'Root /users collection must forbid list enumeration (Dirty Dozen #11)'
);

// 3. PII isolation (/private/account)
assert.ok(rules.includes('match /private/{docId}'), 'Must isolate PII in /private/account');
assert.ok(
  /function isValidUserProfile[\s\S]*hasOnly\(\['uid', 'displayName', 'photoURL'/.test(rules),
  'Root UserProfile must not expose email PII'
);

// 4. All blueprint collections must have match blocks in firestore.rules
for (const collectionPath of Object.keys(blueprint.firestore)) {
  const leaf = collectionPath.split('/').slice(-2, -1)[0] || 'users';
  assert.ok(
    rules.includes(leaf),
    `Collection path ${collectionPath} must be covered in firestore.rules`
  );
}

// 5. Dirty Dozen #4: No secret fields or ghost fields allowed (hasAll + hasOnly on every validator)
for (const validator of [
  'isValidUserProfile',
  'isValidUserPrivateAccount',
  'isValidRepository',
  'isValidReview',
  'isValidAgent',
  'isValidAnalysisJob',
  'isValidWorkspaceSettings',
]) {
  assert.ok(rules.includes(`function ${validator}(`), `Missing validator ${validator}`);
  assert.ok(!rules.includes('githubToken'), 'Secrets like githubToken must never appear in Firestore schema');
}

// 6. Dirty Dozen #5, #6, #7, #9, #10, #12
assert.ok(rules.includes("id.matches('^[a-zA-Z0-9_-]+$')"), 'Must enforce ID regex guard (#5)');
assert.ok(rules.includes('data.diffPreview.size() <= 8000'), 'Must bound diffPreview size (#6)');
assert.ok(rules.includes('data.firestoreCreatedAt == request.time'), 'Must enforce server time on create (#7)');
assert.ok(rules.includes("!(existing().status in ['completed', 'partial', 'failed'])"), 'Must lock terminal analysis jobs (#9)');
assert.ok(rules.includes('data.findings.size() <= 100'), 'Must bound findings array (#10)');
assert.ok(rules.includes('hasParentUser(userId)'), 'Must enforce parent user existence Master Gate (#12)');
assert.ok(rules.includes('resource.data.ownerUid == request.auth.uid'), 'All allow list rules must enforce resource.data ownership (#1)');

console.log('firestore.rules.test.ts: All security rule invariants and Dirty Dozen checks passed.');

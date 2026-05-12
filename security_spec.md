# Security Specification for Guarded Echoes

## Data Invariants
- An Echo MUST have a `userId` that matches the authenticated user who created it.
- An Echo `timestamp` must be a server-side timestamp.
- Echo `transcript` must be an array of objects with `text` (string) and `role` (enum: user, model).

## The Dirty Dozen Payloads
1. Create an echo with someone else's `userId`. (Denied)
2. Create an echo with a 1MB string in `text`. (Denied)
3. Create an echo without being authenticated. (Denied)
4. List all echoes without a user-specific filter. (Denied)
5. Delete an echo belonging to another user. (Denied)
6. Update an existing echo (Echoes should be immutable once saved). (Denied)
7. Create an echo with an invalid `role` (e.g., "admin"). (Denied)
8. Inject a script into the `text` field. (Denied - client side sanitization + strict rule checks)
9. Create an echo with a massive transcript array (> 1000 items). (Denied)
10. Read user PII from another user's profile (Not applicable here, but good practice).
11. Spoof the `timestamp` with a future date. (Denied)
12. Create an echo with a malicious document ID. (Denied)

## Test Runner
See `firestore.rules.test.ts` (conceptual).

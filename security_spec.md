# Security Specification & Payload-First TDD

## 1. Data Invariants
1. **Multi-Tenant Isolation**: Every business record (`agents`, `tasks`, `approvals`, `content`, `mediaAssets`, `contacts`, `products`, `orders`, `campaigns`, `automations`, `automationRuns`, `businessMemory`, `activityLogs`, `integrations`, `analyticsReports`, `aiChats`) must belong to a `/businesses/{businessId}` whose `ownerId == request.auth.uid`.
2. **PII Isolation**: `/users/{userId}` contains `email` and preferences and is strictly readable/writable only when `request.auth.uid == userId`. Collection listing on `/users` is strictly denied (`allow list: if false`).
3. **Human-in-the-Loop Approval Integrity**: An `Approval` document cannot be modified once it reaches a terminal state (`approved`, `rejected`, `expired`).
4. **Immutable Ownership & Audit Trails**: `ownerId`, `businessId`, and `createdAt` are immutable across all updates. `activityLogs` are append-only (`allow update, delete: if false`).
5. **Server Timestamp Integrity**: `createdAt` on create and `updatedAt` on update must equal `request.time`.

## 2. Dirty Dozen Adversarial Payloads (Expected: PERMISSION_DENIED)
1. **Shadow Field Injection on User Create**: `{ id: uid, email: "a@b.com", displayName: "Ali", preferredLocale: "fa", status: "active", isAdmin: true, createdAt: serverTimestamp, updatedAt: serverTimestamp }` -> Denied by `hasOnly(...)`.
2. **Cross-Tenant Business Read**: User B attempts `get(/businesses/bizA)` owned by User A -> Denied by `existing().ownerId == request.auth.uid`.
3. **Cross-Tenant Subcollection List Without Filter**: User B runs `list(/businesses/bizA/contacts)` -> Denied by `resource.data.ownerId == request.auth.uid`.
4. **Owner Spoofing on Business Create**: User A attempts `create(/businesses/bizX)` with `ownerId: "userB"` -> Denied by `incoming().ownerId == request.auth.uid`.
5. **ID Poisoning (2KB Document ID)**: `create(/businesses/bizA/content/<2000-char-id>)` -> Denied by `isValidId()`.
6. **Approval Terminal State Tampering**: User attempts to update an `approved` approval back to `pending` -> Denied by terminal state gate.
7. **Activity Log Mutation/Deletion**: User attempts `update` or `delete` on `/businesses/bizA/activityLogs/log1` -> Denied by `allow update, delete: if false`.
8. **Client Timestamp Forgery**: `create(/businesses/bizA/tasks/t1)` with `createdAt: "2020-01-01T00:00:00Z"` instead of `request.time` -> Denied by `incoming().createdAt == request.time`.
9. **Unverified Email Write**: Auth token with `email_verified: false` attempts write -> Denied by `request.auth.token.email_verified == true`.
10. **Owner Reassignment on Update**: User A attempts `update(/businesses/bizA/products/p1)` changing `ownerId` -> Denied by `incoming().ownerId == existing().ownerId`.
11. **Value Poisoning on Content Caption**: Sending a 500KB string in `title` (`maxLength: 200`) -> Denied by `data.title.size() <= 200`.
12. **Blanket Users Collection Enumeration**: Signed-in user runs `list(/users)` -> Denied by `allow list: if false`.

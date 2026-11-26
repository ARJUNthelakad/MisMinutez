# MisMinutez Security Specification (Phase 0)

## 1. Data Invariants
1. A `UserProfile` at `/users/{userId}` can only be read, created, or updated by `request.auth.uid == userId` with a verified email. No other user can read PII (`email`).
2. A `Meeting` at `/meetings/{meetingId}` always belongs to a single owner (`userId == request.auth.uid`). `userId` and `createdAt` are immutable after creation.
3. Every `TranscriptSegment`, `Decision`, and `ChatMessage` under `/meetings/{meetingId}/...` cannot exist without an existing parent meeting owned by `request.auth.uid`.
4. Every `ActionItem` at `/actionItems/{itemId}` cannot be created without an existing `/meetings/{meetingId}` owned by `request.auth.uid`.
5. All `list` queries explicitly enforce `resource.data.userId == request.auth.uid` without delegating filtering to client code.
6. All string fields enforce explicit `.size()` bounds, all lists enforce explicit `.size()` bounds and element type checks, and all document IDs enforce `isValidId()`.
7. All `createdAt` and `updatedAt` timestamps must match `request.time`.

## 2. The "Dirty Dozen" Attack Payloads (All Must Return PERMISSION_DENIED)
1. **Cross-User PII Read**: User B attempts `get` on `/users/{userA}`.
2. **Identity Spoofing on Meeting Create**: User A creates `/meetings/m1` with `userId: "userB"`.
3. **Ghost Shadow Field on User Profile**: User A updates `/users/{userA}` adding `isAdmin: true`.
4. **Ghost Shadow Field on Meeting Update**: User A updates `/meetings/m1` adding `secretFlag: true`.
5. **Immutable Owner Tampering**: User A updates `/meetings/m1` attempting to change `userId`.
6. **Client Timestamp Forgery**: User A creates `/meetings/m1` with a backdated `createdAt` instead of `request.time`.
7. **ID Poisoning**: User A attempts to create `/meetings/../../bad$id` or a 200-character ID.
8. **Resource Exhaustion String**: User A submits a 25,000-character `title` on a meeting.
9. **Orphaned Action Item**: User A creates `/actionItems/a1` referencing a non-existent `meetingId`.
10. **Cross-User Subcollection Injection**: User B attempts to create `/meetings/{userAMeeting}/segments/s1`.
11. **Value Poisoning on Allowed Update Key**: User A updates `status` on `/actionItems/a1` to `"hacked_status"`.
12. **Unverified Email Write**: An authenticated token with `email_verified == false` attempts to create a meeting.

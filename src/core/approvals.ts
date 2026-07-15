// The approval seam — a separate pure module from the policy-enforcement
// engine. The two are distinct: this answers who may APPROVE a gated call;
// core/authz.ts answers whether a caller may perform an action at all. Role
// membership resolution stays host-side; these functions take the decider's
// resolved role names.

// Pure separation-of-duties rule (no I/O). No role and no users defers to the
// caller (returns true — the host's own owner/admin rule applies upstream).
// Otherwise the decider must hold the required role or be one of the named
// users, and must not be the requester — UNLESS the special value "self" is
// in the user list, which explicitly lets the requester approve their own
// gated call (a confirm-your-own-action gate). "self" is a sentinel, never a
// real identity, so it only ever matches the decider === requester branch.
export function canApprove(
  requiredRole: string | null,
  requiredUsers: string[] | null,
  decider: string | null,
  requester: string | null,
  deciderRoles: string[],
): boolean {
  const users = requiredUsers ?? [];
  if (requiredRole === null && users.length === 0) return true;
  if (decider === null) return false;
  if (decider === requester) return users.includes("self");
  return (requiredRole !== null && deciderRoles.includes(requiredRole)) || users.includes(decider);
}

// Pure inbox-visibility rule: a gated pending request belongs in an
// approver's inbox when they hold the required role OR are a named user, and
// are not the requester. A row with neither gate never routes cross-thread,
// and an anonymous caller sees nothing. Mirrors canApprove.
export function inboxVisible(
  row: {
    required_role: string | null;
    required_users: string[] | null;
    requester_email: string | null;
  },
  callerEmail: string | null,
  callerRoles: string[],
): boolean {
  if (callerEmail === null) return false;
  const users = row.required_users ?? [];
  if (row.required_role === null && users.length === 0) return false;
  if (row.requester_email === callerEmail) return false;
  return (row.required_role !== null && callerRoles.includes(row.required_role))
    || users.includes(callerEmail);
}

// Resolve who must approve a gated call for `tool`, across three tiers: the
// tool's own approver (role and/or users) wins whole; else the "*" default;
// else the built-in fallback — "self", i.e. the requester confirms their own
// call. A host that wants real two-person separation sets a role (per tool or
// as the "*" default).
export function resolveApprover(
  roles: Record<string, string> | undefined,
  users: Record<string, string[]> | undefined,
  tool: string,
): { role: string | null; users: string[] | null; } {
  const pick = (key: string) => {
    const role = roles?.[key] ?? null;
    const us = users?.[key] ?? null;
    return role !== null || (us !== null && us.length > 0) ? { role, users: us } : null;
  };
  return pick(tool) ?? pick("*") ?? { role: null, users: ["self"] };
}

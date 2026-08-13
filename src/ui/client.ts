import type { AdminAuditRecord, SubjectSummary } from "../admin/types.js";
import type { PolicyCondition } from "../model/condition.js";
import type { AuthzDescriptor } from "../model/descriptor.js";
import type { GrantRecord, PolicyRecord } from "../model/grant.js";
import type { Scope } from "../model/scope.js";
import type { Subject } from "../model/subject.js";

// The host owns session and auth: it injects a fetch that already carries
// whatever credential it uses. This client performs no authentication.
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface AuthzAdminClient {
  descriptor(): Promise<AuthzDescriptor>;
  grants(filter?: Record<string, string>): Promise<GrantRecord[]>;
  policies(): Promise<PolicyRecord[]>;
  subjects(query?: Record<string, string>): Promise<SubjectSummary[]>;
  audit(query?: Record<string, string>): Promise<AdminAuditRecord[]>;
  createGrant(input: {
    policyId: string;
    subject: Subject;
    scope: Scope;
    bounds?: PolicyCondition[];
  }): Promise<void>;
  revokeGrant(id: string): Promise<void>;
}

export class AuthzAdminError extends Error {}

async function unwrap<T>(res: Response): Promise<T> {
  if (res.ok) return await res.json() as T;
  // The server's message is the engine's own validation text; surfacing
  // anything else would hide which condition was refused.
  const body = await res.json().catch(() => null) as { error?: string; } | null;
  throw new AuthzAdminError(body?.error ?? `request failed with ${res.status}`);
}

export function createClient(baseUrl: string, doFetch: FetchLike): AuthzAdminClient {
  const base = baseUrl.replace(/\/$/, "");
  const qs = (q?: Record<string, string>) => {
    const params = new URLSearchParams(
      Object.entries(q ?? {}).filter(([, v]) => v !== undefined && v !== ""),
    );
    const s = params.toString();
    return s ? `?${s}` : "";
  };
  const get = <T>(path: string, q?: Record<string, string>) =>
    doFetch(`${base}${path}${qs(q)}`).then((r) => unwrap<T>(r));

  return {
    descriptor: () => get("/descriptor"),
    grants: (filter) => get("/grants", filter),
    policies: () => get("/policies"),
    subjects: (query) => get("/subjects", query),
    audit: (query) => get("/audit", query),
    createGrant: async (input) => {
      await unwrap(
        await doFetch(`${base}/grants`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        }),
      );
    },
    revokeGrant: async (id) => {
      await unwrap(
        await doFetch(`${base}/grants/${encodeURIComponent(id)}`, {
          method: "DELETE",
        }),
      );
    },
  };
}

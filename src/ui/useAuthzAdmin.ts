import { useCallback, useEffect, useMemo, useState } from "react";
import type { AdminAuditRecord, SubjectSummary } from "../admin/types.js";
import type { PolicyCondition } from "../model/condition.js";
import { type AuthzDescriptor, DESCRIPTOR_VERSION } from "../model/descriptor.js";
import type { GrantRecord, PolicyRecord } from "../model/grant.js";
import type { Scope } from "../model/scope.js";
import type { Subject } from "../model/subject.js";
import { type AuthzAdminClient, createClient, type FetchLike } from "./client.js";
import { assertSupported, coverageOf } from "./derive.js";

export interface UseAuthzAdminOptions {
  baseUrl: string;
  fetch?: FetchLike;
}

export interface AuthzAdminState {
  loading: boolean;
  error: string | null;
  descriptor: AuthzDescriptor | null;
  grants: GrantRecord[];
  policies: PolicyRecord[];
  audit: AdminAuditRecord[];
  client: AuthzAdminClient;
  reload(): Promise<void>;
  loadAudit(query?: Record<string, string>): Promise<void>;
  searchSubjects(q: string): Promise<SubjectSummary[]>;
  createGrant(input: {
    policyId: string;
    subject: Subject;
    scope: Scope;
    bounds?: PolicyCondition[];
  }): Promise<void>;
  revokeGrant(id: string): Promise<void>;
  coverageFor(policyId: string): { granted: string[]; excluded: string[]; };
}

const message = (e: unknown) => e instanceof Error ? e.message : String(e);

// Everything the admin screens do, with no markup: a host with its own design
// system renders its own and still writes none of this logic twice.
export function useAuthzAdmin(options: UseAuthzAdminOptions): AuthzAdminState {
  const doFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const client = useMemo(
    () => createClient(options.baseUrl, doFetch),
    [options.baseUrl, doFetch],
  );

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [descriptor, setDescriptor] = useState<AuthzDescriptor | null>(null);
  const [grants, setGrants] = useState<GrantRecord[]>([]);
  const [policies, setPolicies] = useState<PolicyRecord[]>([]);
  const [audit, setAudit] = useState<AdminAuditRecord[]>([]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const doc = await client.descriptor();
      assertSupported(doc, DESCRIPTOR_VERSION);
      const [g, p] = await Promise.all([client.grants(), client.policies()]);
      setDescriptor(doc);
      setGrants(g);
      setPolicies(p);
    } catch (e) {
      setDescriptor(null);
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const guard = useCallback(async (run: () => Promise<void>) => {
    setError(null);
    try {
      await run();
    } catch (e) {
      setError(message(e));
      throw e;
    }
  }, []);

  const loadAudit = useCallback(
    (query?: Record<string, string>) =>
      guard(async () => {
        setAudit(await client.audit(query));
      }),
    [client, guard],
  );

  const createGrant = useCallback(
    (input: Parameters<AuthzAdminClient["createGrant"]>[0]) =>
      guard(async () => {
        await client.createGrant(input);
        setGrants(await client.grants());
      }),
    [client, guard],
  );

  const revokeGrant = useCallback(
    (id: string) =>
      guard(async () => {
        await client.revokeGrant(id);
        setGrants(await client.grants());
      }),
    [client, guard],
  );

  const searchSubjects = useCallback(
    (q: string) => client.subjects(q ? { q } : undefined).catch(() => []),
    [client],
  );

  const coverageFor = useCallback((policyId: string) => {
    const policy = policies.find((p) => p.id === policyId);
    if (!descriptor || !policy) return { granted: [], excluded: [] };
    return coverageOf(descriptor, policy.statements);
  }, [descriptor, policies]);

  return {
    loading,
    error,
    descriptor,
    grants,
    policies,
    audit,
    client,
    reload,
    loadAudit,
    searchSubjects,
    createGrant,
    revokeGrant,
    coverageFor,
  };
}

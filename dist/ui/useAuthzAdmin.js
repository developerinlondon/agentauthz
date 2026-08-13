import { useCallback, useEffect, useMemo, useState } from "react";
import { DESCRIPTOR_VERSION } from "../model/descriptor.js";
import { createClient } from "./client.js";
import { assertSupported, coverageOf } from "./derive.js";
const message = (e) => e instanceof Error ? e.message : String(e);
// Everything the admin screens do, with no markup: a host with its own design
// system renders its own and still writes none of this logic twice.
export function useAuthzAdmin(options) {
    const doFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    const client = useMemo(() => createClient(options.baseUrl, doFetch), [options.baseUrl, doFetch]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [descriptor, setDescriptor] = useState(null);
    const [grants, setGrants] = useState([]);
    const [policies, setPolicies] = useState([]);
    const [audit, setAudit] = useState([]);
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
        }
        catch (e) {
            setDescriptor(null);
            setError(message(e));
        }
        finally {
            setLoading(false);
        }
    }, [client]);
    useEffect(() => {
        void reload();
    }, [reload]);
    const guard = useCallback(async (run) => {
        setError(null);
        try {
            await run();
        }
        catch (e) {
            setError(message(e));
            throw e;
        }
    }, []);
    const loadAudit = useCallback((query) => guard(async () => {
        setAudit(await client.audit(query));
    }), [client, guard]);
    const createGrant = useCallback((input) => guard(async () => {
        await client.createGrant(input);
        setGrants(await client.grants());
    }), [client, guard]);
    const revokeGrant = useCallback((id) => guard(async () => {
        await client.revokeGrant(id);
        setGrants(await client.grants());
    }), [client, guard]);
    const searchSubjects = useCallback((q) => client.subjects(q ? { q } : undefined).catch(() => []), [client]);
    const coverageFor = useCallback((policyId) => {
        const policy = policies.find((p) => p.id === policyId);
        if (!descriptor || !policy)
            return { granted: [], excluded: [] };
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
//# sourceMappingURL=useAuthzAdmin.js.map
export class AuthzAdminError extends Error {
}
async function unwrap(res) {
    if (res.ok)
        return await res.json();
    // The server's message is the engine's own validation text; surfacing
    // anything else would hide which condition was refused.
    const body = await res.json().catch(() => null);
    throw new AuthzAdminError(body?.error ?? `request failed with ${res.status}`);
}
export function createClient(baseUrl, doFetch) {
    const base = baseUrl.replace(/\/$/, "");
    const qs = (q) => {
        const params = new URLSearchParams(Object.entries(q ?? {}).filter(([, v]) => v !== undefined && v !== ""));
        const s = params.toString();
        return s ? `?${s}` : "";
    };
    const get = (path, q) => doFetch(`${base}${path}${qs(q)}`).then((r) => unwrap(r));
    return {
        descriptor: () => get("/descriptor"),
        grants: (filter) => get("/grants", filter),
        policies: () => get("/policies"),
        subjects: (query) => get("/subjects", query),
        audit: (query) => get("/audit", query),
        createGrant: async (input) => {
            await unwrap(await doFetch(`${base}/grants`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(input),
            }));
        },
        revokeGrant: async (id) => {
            await unwrap(await doFetch(`${base}/grants/${encodeURIComponent(id)}`, {
                method: "DELETE",
            }));
        },
    };
}
//# sourceMappingURL=client.js.map
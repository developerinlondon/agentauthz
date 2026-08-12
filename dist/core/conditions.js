// The pure ABAC condition engine. A statement's conditions are an ADDITIONAL
// narrowing on top of the action/resource match: all of them must pass for
// the statement to match.
//
// FAIL-CLOSED is the design center, and it is ASYMMETRIC by effect:
//   - evalConditions is a pure tri-state: "match" (every condition
//     definitively true), "no-match" (well-formed, but at least one condition
//     definitively false), "unmatchable" (ANY condition is malformed, names an
//     unknown operator/key, mismatches the key's type, or tests a key the
//     request context doesn't populate — we cannot know what the author
//     meant, so we refuse to guess).
//   - an ALLOW statement contributes only on "match" — an unevaluable
//     condition can never widen access.
//   - a DENY statement fires on "match" OR "unmatchable" — an unevaluable
//     condition on a deny keeps the deny standing rather than silently
//     disabling it (which would widen access relative to the author's intent
//     of writing a deny at all). Only a definitive "no-match" lifts a
//     conditioned deny — that is the author deliberately scoping the deny.
// Both directions therefore fail toward LESS access. core/evaluate.ts applies
// this; validateConditions (write time) and the pg backend's at-rest shape
// check are defense in depth in front of it.
//
// The key namespace is host-declared (ConditionKeys) plus the built-in
// request:* keys below — the values the engine itself can populate from a
// real check call. A key with no honest value must be left UNPOPULATED,
// never faked: a condition on an unpopulated key is unmatchable, so an allow
// never matches and a deny fires.
import { CONDITION_OPERATORS, OPERATOR_KEY_TYPE, } from "../model/condition.js";
// Built-in keys the engine populates itself on every check:
//   - request:Time — evaluation instant as an ISO-8601 UTC timestamp (date
//     operators): an absolute validity window.
//   - request:HourUTC — evaluation hour-of-day in UTC, 0–23 (numeric
//     operators): coarse office-hours.
//   - request:SourceIp — the caller's IP, populated ONLY when the check
//     carried one; a headless/internal check leaves it unpopulated so a
//     condition on it fails closed.
export const BUILTIN_CONDITION_KEYS = {
    "request:Time": { type: "date" },
    "request:HourUTC": { type: "number" },
    "request:SourceIp": { type: "ip" },
};
// Host keys merged with the built-ins; the built-ins always win so a host
// declaration can never redefine what request:* means.
export function resolveConditionKeys(hostKeys = {}) {
    return { ...hostKeys, ...BUILTIN_CONDITION_KEYS };
}
// A null-prototype context so a crafted key ("__proto__", "toString", …) can
// never resolve through the prototype chain; the declared-keys whitelist gate
// in front of the lookup makes that belt-and-suspenders.
export function makeConditionContext(entries = {}) {
    return Object.assign(Object.create(null), entries);
}
// The built-in request:* entries for one evaluation instant. sourceIp is
// populated only when truthy — an empty/absent value leaves the key
// unpopulated (never set to ""), so a SourceIp condition fails closed.
export function builtinContextEntries(opts = {}) {
    const now = opts.now ?? new Date();
    return {
        "request:Time": now.toISOString(),
        "request:HourUTC": now.getUTCHours(),
        ...(opts.sourceIp ? { "request:SourceIp": opts.sourceIp } : {}),
    };
}
// StringLike shares the resource-pattern discipline (model/statement.ts):
// exact match, or a single trailing `*` as a prefix wildcard. Anything else
// is an invalid pattern — rejected at write time and unmatchable at eval time.
function isValidLikePattern(pattern) {
    if (pattern.length === 0)
        return false;
    const star = pattern.indexOf("*");
    return star === -1 || star === pattern.length - 1;
}
// A DateLessThan/DateGreaterThan value must name its own timezone (Z or an
// explicit ±HH:MM/±HHMM offset). A bare "2026-08-01T00:00:00" parses in the
// SERVER's local timezone (Date.parse), so the exact same policy would mean a
// different instant — and a different allow/deny outcome — on a host in a
// different TZ. request:Time is always an absolute UTC instant, so requiring
// the value to be explicit too keeps the comparison meaningful regardless of
// where the process runs.
function hasExplicitTimezone(value) {
    return /(?:Z|[+-]\d{2}:?\d{2})$/.test(value.trim());
}
// Parse a dotted-decimal IPv4 address into 4 bytes, or null if malformed.
// Rejects a leading zero on any octet ("010") — some parsers read that as
// octal, so accepting it would let a policy author's CIDR and the actual
// client IP disagree on what address a given string names (a classic
// IP-parsing ambiguity, not just a formatting nit).
function parseIPv4(s) {
    const parts = s.split(".");
    if (parts.length !== 4)
        return null;
    const bytes = [];
    for (const p of parts) {
        if (!/^\d{1,3}$/.test(p) || (p.length > 1 && p[0] === "0"))
            return null;
        const n = Number(p);
        if (n > 255)
            return null;
        bytes.push(n);
    }
    return bytes;
}
// Parse an IPv6 address (":"-groups, at most one "::" compression) into 16
// bytes, or null if malformed. Deliberately no IPv4-mapped ("::ffff:1.2.3.4")
// support.
function parseIPv6(s) {
    if (s.length === 0 || s.includes("."))
        return null;
    const doubleColons = s.split("::").length - 1;
    if (doubleColons > 1)
        return null;
    let groups;
    if (doubleColons === 1) {
        const [h, t] = s.split("::");
        const head = h ? h.split(":") : [];
        const tail = t ? t.split(":") : [];
        const missing = 8 - head.length - tail.length;
        if (missing <= 0)
            return null; // "::" must stand in for at least one group
        groups = [...head, ...Array(missing).fill("0"), ...tail];
    }
    else {
        groups = s.split(":");
        if (groups.length !== 8)
            return null;
    }
    const bytes = [];
    for (const g of groups) {
        if (!/^[0-9a-fA-F]{1,4}$/.test(g))
            return null;
        const n = parseInt(g, 16);
        bytes.push((n >> 8) & 0xff, n & 0xff);
    }
    return bytes;
}
// Do the first `prefixBits` bits of `a` and `b` agree? Both are same-length
// byte arrays (caller only compares same-family addresses).
function bytesMatchPrefix(a, b, prefixBits) {
    const fullBytes = Math.floor(prefixBits / 8);
    for (let i = 0; i < fullBytes; i++)
        if (a[i] !== b[i])
            return false;
    const rem = prefixBits % 8;
    if (rem === 0)
        return true;
    const mask = (0xff << (8 - rem)) & 0xff;
    return ((a[fullBytes] ?? 0) & mask) === ((b[fullBytes] ?? 0) & mask);
}
// Parse a "<addr>/<prefixLen>" string (either family), or null if malformed —
// bad separator, unparseable address, or a prefix length out of range for
// that family. Shared by ipInCidr (eval time) and validateConditions (write
// time) so both agree on what a valid CIDR is.
function parseCidr(cidr) {
    const slash = cidr.lastIndexOf("/");
    if (slash === -1)
        return null;
    const prefixPart = cidr.slice(slash + 1);
    if (!/^\d{1,3}$/.test(prefixPart))
        return null;
    const prefixLen = Number(prefixPart);
    const addrPart = cidr.slice(0, slash);
    const v4 = parseIPv4(addrPart);
    if (v4)
        return prefixLen > 32 ? null : { family: 4, bytes: v4, prefixLen };
    const v6 = parseIPv6(addrPart);
    if (v6)
        return prefixLen > 128 ? null : { family: 6, bytes: v6, prefixLen };
    return null;
}
// Pure CIDR membership test: is `ip` inside `cidr`? null means unmatchable —
// a malformed address/CIDR, an out-of-range prefix length, or an address
// family mismatch (an IPv4 ip can never be "in" an IPv6 cidr and vice versa)
// — never coerced into a guess.
function ipInCidr(ip, cidr) {
    const net = parseCidr(cidr);
    if (!net)
        return null;
    const ipBytes = net.family === 4 ? parseIPv4(ip) : parseIPv6(ip);
    if (!ipBytes)
        return null;
    return bytesMatchPrefix(ipBytes, net.bytes, net.prefixLen);
}
// One condition, already known well-formed: definitively true, definitively
// false, or null when it cannot be evaluated (unparseable value for the
// operator, invalid like-pattern, malformed CIDR). null propagates to
// "unmatchable".
function evalOne(operator, value, ctxValue) {
    switch (operator) {
        // An array-valued key (a principal can hold several roles) makes the
        // String* operators set-wise: StringEquals/StringLike true if ANY element
        // matches, StringNotEquals true only if NONE do. A scalar ctxValue
        // reduces these to the plain comparisons.
        case "StringEquals":
        case "StringNotEquals": {
            const eq = Array.isArray(ctxValue) ? ctxValue.includes(value) : ctxValue === value;
            return operator === "StringEquals" ? eq : !eq;
        }
        case "StringLike": {
            if (!isValidLikePattern(value))
                return null;
            const matches = (s) => value.endsWith("*") ? s.startsWith(value.slice(0, -1)) : s === value;
            return Array.isArray(ctxValue) ? ctxValue.some(matches) : matches(String(ctxValue));
        }
        case "NumericLessThan":
        case "NumericGreaterThan": {
            const bound = Number(value);
            if (value.trim() === "" || Number.isNaN(bound))
                return null;
            if (typeof ctxValue !== "number")
                return null;
            return operator === "NumericLessThan" ? ctxValue < bound : ctxValue > bound;
        }
        case "DateLessThan":
        case "DateGreaterThan": {
            const bound = Date.parse(value);
            if (typeof ctxValue !== "string")
                return null;
            const at = Date.parse(ctxValue);
            if (Number.isNaN(bound) || Number.isNaN(at))
                return null;
            return operator === "DateLessThan" ? at < bound : at > bound;
        }
        case "IpAddress":
        case "NotIpAddress": {
            if (typeof ctxValue !== "string")
                return null;
            const inCidr = ipInCidr(ctxValue, value);
            if (inCidr === null)
                return null;
            return operator === "IpAddress" ? inCidr : !inCidr;
        }
    }
}
// The pure tri-state evaluator. `conditions` is taken as unknown on purpose:
// this is the LAST line of defense, so it re-validates shape even though
// validateConditions already gated the write path — a row written by an older
// code path, a migration, or a future bug must still fail closed here.
// Verdict priority is unmatchable > no-match > match and order-independent:
// every condition is shape/whitelist-checked BEFORE any is evaluated, so a
// malformed condition can never be masked by an earlier false one.
export function evalConditions(conditions, ctx, keys) {
    if (conditions === undefined || conditions === null)
        return "match";
    if (!Array.isArray(conditions))
        return "unmatchable";
    const checked = [];
    for (const c of conditions) {
        const cond = c;
        if (!cond || typeof cond !== "object" || Array.isArray(cond))
            return "unmatchable";
        const { operator, key, value } = cond;
        if (typeof operator !== "string" || typeof key !== "string" || typeof value !== "string") {
            return "unmatchable";
        }
        if (!CONDITION_OPERATORS.includes(operator))
            return "unmatchable";
        if (!Object.hasOwn(keys, key))
            return "unmatchable";
        if (OPERATOR_KEY_TYPE[operator] !== keys[key].type) {
            return "unmatchable";
        }
        checked.push({ operator: operator, key, value });
    }
    let all = true;
    for (const { operator, key, value } of checked) {
        // Declared key the context doesn't populate (e.g. a caller-email key for
        // a service principal): not knowable — unmatchable, never a silent skip.
        if (!Object.hasOwn(ctx, key))
            return "unmatchable";
        // A lowercase-declared key compares case-insensitively on BOTH sides.
        // validateConditions normalizes the STORED value at write time, but this
        // compare-time lowercase is the real guarantee: a pre-existing or
        // raw-inserted row (predating that normalization, or written by a future
        // bug) must not compare case-sensitively — a mixed-case value would let
        // StringNotEquals fail OPEN (excluding no one) and a mixed-case
        // StringEquals deny fail to fire, both of which WIDEN access relative to
        // the author's intent. The CONTEXT side is normalized here too: the host
        // builds the context, so a host that forgets to lowercase (unlike the
        // original in-seam builder this generalizes) must not reopen the same
        // hole from the other direction.
        const lower = keys[key].lowercase === true;
        const compareValue = lower ? value.toLowerCase() : value;
        const raw = ctx[key];
        const ctxValue = !lower
            ? raw
            : typeof raw === "string"
                ? raw.toLowerCase()
                : Array.isArray(raw)
                    ? raw.map((v) => typeof v === "string" ? v.toLowerCase() : v)
                    : raw;
        const one = evalOne(operator, compareValue, ctxValue);
        if (one === null)
            return "unmatchable";
        if (!one)
            all = false;
    }
    return all ? "match" : "no-match";
}
// Write-time validation (validateStatements): same whitelist as the
// evaluator, but with named errors so a UI can surface them verbatim. Also
// rejects values evalOne could never evaluate (unparseable numeric/date,
// invalid like-pattern), so a policy that would be dead-on-arrival
// "unmatchable" can't be saved through this path at all.
export function validateConditions(input, keys) {
    if (!Array.isArray(input))
        return { ok: false, error: "conditions must be an array" };
    const out = [];
    for (let i = 0; i < input.length; i++) {
        const c = input[i];
        if (!c || typeof c !== "object" || Array.isArray(c)) {
            return { ok: false, error: `condition ${i} is not an object` };
        }
        const operator = c.operator;
        if (typeof operator !== "string"
            || !CONDITION_OPERATORS.includes(operator)) {
            return { ok: false, error: `condition ${i}: unknown operator "${String(operator)}"` };
        }
        if (typeof c.key !== "string" || !Object.hasOwn(keys, c.key)) {
            return { ok: false, error: `condition ${i}: unknown key "${String(c.key)}"` };
        }
        if (typeof c.value !== "string" || c.value.length === 0) {
            return { ok: false, error: `condition ${i}: value must be a non-empty string` };
        }
        const op = operator;
        const spec = keys[c.key];
        if (OPERATOR_KEY_TYPE[op] !== spec.type) {
            return {
                ok: false,
                error: `condition ${i}: ${op} cannot test ${c.key} (a ${spec.type} key)`,
            };
        }
        if ((op === "NumericLessThan" || op === "NumericGreaterThan")
            && (c.value.trim() === "" || Number.isNaN(Number(c.value)))) {
            return { ok: false, error: `condition ${i}: "${c.value}" is not a number` };
        }
        if ((op === "DateLessThan" || op === "DateGreaterThan")) {
            if (Number.isNaN(Date.parse(c.value))) {
                return { ok: false, error: `condition ${i}: "${c.value}" is not a parseable date` };
            }
            if (!hasExplicitTimezone(c.value)) {
                return {
                    ok: false,
                    error: `condition ${i}: "${c.value}" has no timezone — use Z or an explicit ±HH:MM `
                        + "offset (a bare timestamp parses in the SERVER's local time)",
                };
            }
        }
        if (op === "StringLike" && !isValidLikePattern(c.value)) {
            return {
                ok: false,
                error: `condition ${i}: like-pattern "${c.value}" — only a single trailing * is allowed`,
            };
        }
        if ((op === "IpAddress" || op === "NotIpAddress") && !parseCidr(c.value)) {
            return {
                ok: false,
                error: `condition ${i}: "${c.value}" is not a valid IPv4 or IPv6 CIDR (e.g. 10.0.0.0/8, `
                    + "2001:db8::/32)",
            };
        }
        // A lowercase-declared key's context value is always lowercased —
        // normalize the STORED value the same way so a mixed-case author input
        // can't drift from what will actually be compared (evalConditions also
        // lowercase-compares such keys directly, so pre-existing/raw rows stay
        // safe even without this normalization — belt-and-suspenders, not the
        // only guarantee).
        const storedValue = spec.lowercase ? c.value.toLowerCase() : c.value;
        out.push({ operator: c.operator, key: c.key, value: storedValue });
    }
    return { ok: true, conditions: out };
}
//# sourceMappingURL=conditions.js.map
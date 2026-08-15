// The base for errors whose message is written FOR the caller: a named
// rejection a consumer can act on, safe to hand to an untrusted one. Anything
// deriving from this may be surfaced verbatim across a boundary; a plain Error
// may not, because a storage driver's message can carry a connection string,
// a table name, or a row's contents.
export class AuthzError extends Error {}

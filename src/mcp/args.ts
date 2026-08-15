// Argument reading for tool calls. Every failure throws, and the dispatcher
// turns a thrown message into the tool's error text unchanged — so an engine
// or store rejection reaches the model in the engine's own words, which is
// what makes a rejected bound self-correcting rather than a dead end.

import { isValidScope, type Scope, type ScopeChain } from "../model/scope.js";
import { isValidSubject, type Subject } from "../model/subject.js";

export function toolArgs(args: unknown): Record<string, unknown> {
  if (args === undefined || args === null) return {};
  if (typeof args !== "object" || Array.isArray(args)) {
    throw new Error("arguments must be an object");
  }
  return args as Record<string, unknown>;
}

export function requiredString(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export function optionalString(args: Record<string, unknown>, name: string): string | undefined {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  return value;
}

export function optionalNumber(args: Record<string, unknown>, name: string): number | undefined {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a number`);
  }
  return value;
}

export function requiredSubject(args: Record<string, unknown>, name: string): Subject {
  const value = args[name];
  if (!isValidSubject(value)) throw new Error(`${name} must be {kind, id}`);
  return value;
}

export function requiredScope(args: Record<string, unknown>, name: string): Scope {
  const value = args[name];
  if (!isValidScope(value)) throw new Error(`${name} must be {kind, id}`);
  return value;
}

export function requiredSubjects(args: Record<string, unknown>, name: string): Subject[] {
  const value = args[name];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${name} must be a non-empty array of {kind, id}`);
  }
  for (const s of value) {
    if (!isValidSubject(s)) throw new Error(`${name} entries must be {kind, id}`);
  }
  return value as Subject[];
}

export function optionalScopeChain(
  args: Record<string, unknown>,
  name: string,
): ScopeChain | undefined {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new Error(`${name} must be an array of {kind, id}`);
  for (const s of value) {
    if (!isValidScope(s)) throw new Error(`${name} entries must be {kind, id}`);
  }
  return value as ScopeChain;
}

// The check context, taken as declared values only. It is handed to the engine,
// which rebuilds it on a null prototype and gates every lookup on the declared
// keys — a key this host never declared reaches nothing.
export function optionalContext(
  args: Record<string, unknown>,
  name: string,
): Record<string, string | number | string[]> | undefined {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object of condition-key values`);
  }
  for (const [key, v] of Object.entries(value)) {
    const legal = typeof v === "string" || typeof v === "number"
      || (Array.isArray(v) && v.every((e) => typeof e === "string"));
    if (!legal) {
      throw new Error(`${name}["${key}"] must be a string, a number, or an array of strings`);
    }
  }
  return value as Record<string, string | number | string[]>;
}

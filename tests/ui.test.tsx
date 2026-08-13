import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createAdminHandler } from "../src/admin/index.js";
import type { AdminStore } from "../src/admin/types.js";
import { describeAuthz } from "../src/core/describe.js";
import { DESCRIPTOR_VERSION } from "../src/model/descriptor.js";
import type { GrantRecord, PolicyRecord } from "../src/model/grant.js";
import { actionRegistryFromCatalogue } from "../src/ports/index.js";
import { BoundsEditor } from "../src/ui/BoundsEditor.js";
import { createClient } from "../src/ui/client.js";
import {
  assertSupported,
  boundFields,
  controlFor,
  coverageOf,
  type DraftBound,
  toCondition,
  UnsupportedDescriptorError,
} from "../src/ui/derive.js";
import { GrantEditor } from "../src/ui/GrantEditor.js";

// Two hosts with NOTHING in common: different actions, different condition
// keys, different types, different scope hierarchies.
const widgets = describeAuthz({
  actionRegistry: actionRegistryFromCatalogue([
    { action: "widgets.read" },
    { action: "widgets.write", derivesFrom: "widgets.read" },
    { action: "widgets.publish", derivesFrom: "widgets.write" },
  ]),
  conditionKeys: { "app:Region": { type: "string" } },
  scopeKinds: ["root", "space"],
});

const fleet = describeAuthz({
  actionRegistry: actionRegistryFromCatalogue([
    { action: "vehicle.locate" },
    { action: "vehicle.dispatch" },
  ]),
  conditionKeys: {
    "fleet:MaxSpeed": { type: "number" },
    "fleet:Depot": { type: "ip" },
  },
  scopeKinds: ["global", "region", "depot"],
});

const noop = () => {};

describe("one component, two vocabularies", () => {
  const render = (descriptor: typeof widgets, bounds: DraftBound[]) =>
    renderToStaticMarkup(
      <BoundsEditor descriptor={descriptor} bounds={bounds} onChange={noop} />,
    );

  test("each host's declared keys become that host's options, and only those", () => {
    const a = render(widgets, [{
      key: "app:Region",
      operator: "StringEquals",
      value: "",
      values: [],
    }]);
    const b = render(fleet, [{
      key: "fleet:MaxSpeed",
      operator: "NumericLessThan",
      value: "",
      values: [],
    }]);

    expect(a).toContain("app:Region");
    expect(a).not.toContain("fleet:MaxSpeed");
    expect(b).toContain("fleet:MaxSpeed");
    expect(b).toContain("fleet:Depot");
    expect(b).not.toContain("app:Region");
    expect(a).not.toBe(b);
  });

  test("the control follows the declared TYPE, with no per-host branching", () => {
    const number = render(fleet, [{
      key: "fleet:MaxSpeed",
      operator: "NumericLessThan",
      value: "",
      values: [],
    }]);
    expect(number).toContain('data-control="number"');
    expect(number).toContain('type="number"');

    const cidr = render(fleet, [{
      key: "fleet:Depot",
      operator: "IpAddress",
      value: "",
      values: [],
    }]);
    expect(cidr).toContain('data-control="cidr"');
    expect(cidr).toContain("10.0.0.0/8");
  });

  test("choosing a set operator switches the control to multi-value", () => {
    const scalar = render(widgets, [{
      key: "app:Region",
      operator: "StringEquals",
      value: "",
      values: [],
    }]);
    const set = render(widgets, [{
      key: "app:Region",
      operator: "StringIn",
      value: "",
      values: [],
    }]);
    expect(scalar).toContain('data-control="text"');
    expect(set).toContain('data-control="multi"');
  });

  test("only host-declared keys are offerable; request:* is engine-populated", () => {
    const offered = boundFields(widgets).filter((f) => f.selectable).map((f) => f.key);
    expect(offered).toEqual(["app:Region"]);
    expect(boundFields(widgets).some((f) => f.key === "request:SourceIp" && f.selectable))
      .toBe(false);
  });

  test("the source names no host anywhere", async () => {
    const sources = await Promise.all(
      ["BoundsEditor.tsx", "GrantEditor.tsx", "AuthzAdmin.tsx", "derive.ts"].map((f) =>
        Bun.file(new URL(`../src/ui/${f}`, import.meta.url)).text()
      ),
    );
    for (const src of sources) {
      for (const hostWord of ["widgets", "fleet", "neutron", "app:Region", "vehicle"]) {
        expect(src.toLowerCase()).not.toContain(hostWord.toLowerCase());
      }
    }
  });
});

describe("a scalar operator emits value, a set operator emits values", () => {
  const draft = (operator: string): DraftBound => ({
    key: "app:Region",
    operator,
    value: "eu-west",
    values: ["eu-west", "us-east"],
  });

  test("scalar", () => {
    expect(toCondition(draft("StringEquals"), widgets.setOperators)).toEqual({
      operator: "StringEquals",
      key: "app:Region",
      value: "eu-west",
    });
  });

  test("set", () => {
    expect(toCondition(draft("StringIn"), widgets.setOperators)).toEqual({
      operator: "StringIn",
      key: "app:Region",
      values: ["eu-west", "us-east"],
    });
  });

  test("every operator a key advertises maps to exactly one control", () => {
    for (const [, spec] of Object.entries(fleet.conditionKeys)) {
      for (const op of spec.operators) {
        expect(controlFor(spec, op, fleet.setOperators)).toBeTruthy();
      }
    }
  });
});

describe("the coverage panel matches actionClosures exactly", () => {
  test("a coarse allow names every action it really confers", () => {
    expect(coverageOf(widgets, [
      { effect: "allow", actions: ["widgets.read"] },
    ])).toEqual({
      granted: ["widgets.publish", "widgets.read", "widgets.write"],
      excluded: [],
    });
  });

  test("a deny is named and removed from what the grant confers", () => {
    expect(coverageOf(widgets, [
      { effect: "allow", actions: ["widgets.read"] },
      { effect: "deny", actions: ["widgets.publish"] },
    ])).toEqual({
      granted: ["widgets.read", "widgets.write"],
      excluded: ["widgets.publish"],
    });
  });

  test("a host without derivation confers exactly what it names", () => {
    expect(coverageOf(fleet, [{ effect: "allow", actions: ["vehicle.locate"] }]))
      .toEqual({ granted: ["vehicle.locate"], excluded: [] });
  });

  test("the editor renders the coverage rather than the bare policy name", () => {
    const markup = renderToStaticMarkup(
      <GrantEditor
        descriptor={widgets}
        policies={[{
          id: "p1",
          name: "content-author",
          description: null,
          system: false,
          updatedAt: "",
          statements: [{ effect: "allow", actions: ["widgets.read"], resources: ["*"] }],
        }] as PolicyRecord[]}
        searchSubjects={async () => []}
        onCreate={async () => {}}
      />,
    );
    expect(markup).toContain("widgets.publish");
    expect(markup).toContain("widgets.write");
  });
});

describe("descriptor version gate", () => {
  test("the understood version passes", () => {
    expect(() => assertSupported(widgets, DESCRIPTOR_VERSION)).not.toThrow();
  });

  test("an unknown version is refused, not half-rendered", () => {
    const future = { ...widgets, version: 99 as unknown as typeof widgets.version };
    expect(() => assertSupported(future, DESCRIPTOR_VERSION))
      .toThrow(UnsupportedDescriptorError);
  });
});

// The UI client against the REAL handler, no server and no DOM: proves the two
// halves of the contract agree about paths, shapes and error text.
describe("client and handler agree", () => {
  let created: unknown[] = [];
  const store: AdminStore = {
    listGrants: async () => [] as GrantRecord[],
    createGrant: async (input) => {
      created.push(input);
    },
    deleteGrant: async (id) => id === "g1",
    listPolicies: async () => [] as PolicyRecord[],
    listAudit: async () => [],
  };
  const handler = createAdminHandler({ descriptor: widgets, store, basePath: "/authz" });
  const client = createClient(
    "/authz",
    (input, init) => handler(new Request(new URL(input, "https://host").toString(), init)),
  );

  test("descriptor round-trips", async () => {
    expect(await client.descriptor()).toEqual(widgets);
  });

  test("a grant with bounds round-trips", async () => {
    created = [];
    await client.createGrant({
      policyId: "p1",
      subject: { kind: "user", id: "alice" },
      scope: { kind: "space", id: "acme" },
      bounds: [{ operator: "StringEquals", key: "app:Region", value: "eu-west" }],
    });
    expect(created).toHaveLength(1);
  });

  test("a refused bound surfaces the engine's own message", async () => {
    expect(client.createGrant({
      policyId: "p1",
      subject: { kind: "user", id: "alice" },
      scope: { kind: "space", id: "acme" },
      bounds: [{ operator: "StringEquals", key: "nope", value: "x" }],
    })).rejects.toThrow('condition 0: unknown key "nope"');
  });

  test("revoking a missing grant reports it", async () => {
    expect(client.revokeGrant("missing")).rejects.toThrow("not found");
  });
});

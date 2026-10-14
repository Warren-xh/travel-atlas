import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { policyCategory, preferredRoute, routeState, displayCategory, policyDate } from "../visa.mjs";
const policies = JSON.parse(await readFile(new URL("../data/visa-policies.json", import.meta.url)));
const countries = JSON.parse(await readFile(new URL("../data/countries.json", import.meta.url)));

test("every map destination has a policy slot, without inventing evidence", () => {
  assert.equal(countries.length, 255);
  assert.deepEqual(Object.keys(policies.countries).sort(), countries.map(c => c.id).sort());
  for (const c of Object.values(policies.countries)) for (const r of c.routes) {
    assert.ok(["verified", "channel", "unknown", "context"].includes(r.level));
    if (r.level === "verified") assert.ok(r.sources.length, c.name);
    for (const url of r.sources) assert.equal(new URL(url).protocol, "https:");
    for (const key of ["validFrom", "validUntil"]) if (r[key]) assert.match(r[key], /^\d{4}-\d{2}-\d{2}$/);
  }
  assert.equal(policies.countries.DMA.name, "多米尼克");
  assert.notEqual(policies.countries.DOM.name, policies.countries.DMA.name);
});
test("Cambodia switches to a verified eVisa after the last exempt day", () => {
  assert.equal(policyCategory(policies.countries.KHM, "2026-10-15"), "free");
  assert.equal(policyCategory(policies.countries.KHM, "2026-10-16"), "evisa");
  assert.equal(preferredRoute(policies.countries.KHM, "2026-10-16").kind, "evisa");
});
test("expired exemptions do not remain blue without an active fallback", () => {
  for (const [id, last, next] of [["BRA", "2026-12-31", "2027-01-01"], ["PHL", "2027-01-15", "2027-01-16"], ["RUS", "2027-12-31", "2028-01-01"]]) {
    assert.equal(policyCategory(policies.countries[id], last), "free", id);
    assert.equal(policyCategory(policies.countries[id], next), "none", id);
  }
});
test("unverified channels stay transparent and conditions retain their category", () => {
  for (const id of ["SYR", "MWI", "GAB", "TKM"]) assert.equal(policyCategory(policies.countries[id], "2026-10-14"), "none", id);
  assert.equal(policyCategory(policies.countries.MNE, "2026-10-14"), "purple");
  assert.equal(policyCategory(policies.countries.GUY, "2026-10-14"), "orange");
  assert.equal(policyCategory(policies.countries.NAM, "2026-10-14"), "evisa");
  assert.equal(policyCategory(policies.countries.FRA, "2026-10-14"), "none");
});
test("travel overlays never alter records and visited persists in either layer", () => {
  const before = JSON.stringify(policies);
  const classification = policyCategory(policies.countries.KHM, "2026-10-16");
  assert.equal(displayCategory(classification, "visited"), "visited");
  assert.equal(displayCategory(classification, "purple", false), "purple");
  assert.equal(displayCategory(classification, "purple", true), "evisa");
  assert.equal(JSON.stringify(policies), before);
});
test("future periods and final-day labels use inclusive ISO dates", () => {
  const entry = {routes:[{kind:"visa_free",level:"verified",validFrom:"2026-10-15",validUntil:"2026-10-20"}]};
  assert.equal(policyCategory(entry, "2026-10-14"), "none");
  assert.equal(policyCategory(entry, "2026-10-15"), "free");
  assert.equal(routeState(entry.routes[0], "2026-10-20"), "当日为政策最后一天");
  assert.equal(routeState(entry.routes[0], "2026-10-21"), "政策已到期");
  assert.match(policyDate(), /^\d{4}-\d{2}-\d{2}$/);
});

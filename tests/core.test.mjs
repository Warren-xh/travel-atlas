import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  clone,
  validateAtlas,
  validDate,
  sameAtlas,
  mergeAtlas,
  resolveConflict,
  searchCountries,
  diffAtlas,
} from "../core.mjs";
const metadata = JSON.parse(
  await readFile(new URL("../data/countries.json", import.meta.url), "utf8"),
);
const ids = new Set(metadata.map((c) => c.id));
const atlas = validateAtlas(
  JSON.parse(
    await readFile(new URL("../data/atlas.json", import.meta.url), "utf8"),
  ),
  ids,
);
test("original atlas validates and preserves official source records", () => {
  assert.equal(atlas.countries.IRL.status, "visited");
  assert.ok(atlas.countries.ALB.source.startsWith("https://"));
  assert.equal(atlas.profile.home, "IRL");
});
test("calendar validation rejects impossible dates and accepts leap day", () => {
  assert.equal(validDate("2026-02-30"), false);
  assert.equal(validDate("2026-02-29"), false);
  assert.equal(validDate("2024-02-29"), true);
  assert.equal(validDate(undefined), false);
});
test("backup validation rejects unknown IDs and malformed records", () => {
  const a = clone(atlas);
  a.countries.BAD = { status: "visited", date: "", note: "" };
  assert.throws(() => validateAtlas(a, ids));
  const b = clone(atlas);
  b.countries.IRL.note = "a".repeat(5001);
  assert.throws(() => validateAtlas(b, ids));
});
test("backup validation rejects duplicate palette and unsafe source URLs", () => {
  const a = clone(atlas);
  a.palette[1].id = a.palette[0].id;
  assert.throws(() => validateAtlas(a, ids));
  const b = clone(atlas);
  b.countries.IRL.source = "javascript:alert(1)";
  assert.throws(() => validateAtlas(b, ids));
  b.countries.IRL.source = "https://user:password@example.com";
  assert.throws(() => validateAtlas(b, ids));
});
test("prototype and arbitrary fields never enter normalized documents", () => {
  const a = clone(atlas);
  a.token = "secret";
  a.profile.token = "secret";
  a.countries.IRL.token = "secret";
  const normalized = validateAtlas(a, ids);
  assert.equal(JSON.stringify(normalized).includes("secret"), false);
});
test("meaningful equality ignores timestamps and object key order", () => {
  const b = clone(atlas);
  b.updatedAt = "2099-01-01";
  b.countries = Object.fromEntries(Object.entries(b.countries).reverse());
  assert.ok(sameAtlas(atlas, b));
  assert.equal(diffAtlas(atlas, b).total, 0);
});
test("three-way merge preserves independent countries and individual fields", () => {
  const local = clone(atlas),
    remote = clone(atlas);
  local.countries.IRL.note = "我的都柏林笔记";
  remote.countries.IRL.date = "2026-10-10";
  remote.countries.JPN.status = "purple";
  const plan = mergeAtlas(atlas, local, remote);
  assert.equal(plan.conflicts.length, 0);
  assert.equal(plan.data.countries.IRL.note, "我的都柏林笔记");
  assert.equal(plan.data.countries.IRL.date, "2026-10-10");
  assert.equal(plan.data.countries.JPN.status, "purple");
});
test("same-field conflicts require a choice, including cleared fields", () => {
  const local = clone(atlas),
    remote = clone(atlas);
  local.countries.IRL.note = "本机";
  remote.countries.IRL.note = "云端";
  const plan = mergeAtlas(atlas, local, remote);
  assert.equal(plan.conflicts.length, 1);
  resolveConflict(plan.data, plan.conflicts[0], "local");
  assert.equal(plan.data.countries.IRL.note, "本机");
  assert.equal(local.countries.IRL.note, "本机");
});
test("identical concurrent edits are not conflicts", () => {
  const a = clone(atlas);
  a.countries.IRL.note = "相同修改";
  const plan = mergeAtlas(atlas, a, clone(a));
  assert.equal(plan.conflicts.length, 0);
  assert.equal(plan.data.countries.IRL.note, "相同修改");
});
test("palette and profile merge at field level and resolve by ID", () => {
  const local = clone(atlas),
    remote = clone(atlas);
  local.palette[0].label = "免签目的地";
  remote.palette[0].color = "#ffffff";
  local.profile.title = "旅行";
  remote.profile.subtitle = "出发";
  let plan = mergeAtlas(atlas, local, remote);
  assert.equal(plan.conflicts.length, 0);
  assert.equal(plan.data.palette[0].label, "免签目的地");
  assert.equal(plan.data.palette[0].color, "#ffffff");
  remote.profile.title = "另一个标题";
  plan = mergeAtlas(atlas, local, remote);
  assert.equal(plan.conflicts.length, 1);
  resolveConflict(plan.data, plan.conflicts[0], "remote");
  assert.equal(plan.data.profile.title, "另一个标题");
});
test("Chinese, ISO and accent-insensitive English search find countries", () => {
  assert.equal(searchCountries(metadata, "IRL")[0].id, "IRL");
  assert.equal(searchCountries(metadata, "爱尔兰")[0].id, "IRL");
  assert.ok(searchCountries(metadata, "turkiye").some((c) => c.id === "TUR"));
  assert.equal(searchCountries(metadata, "不存在的国家abc").length, 0);
});

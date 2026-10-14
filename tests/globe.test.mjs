import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (name) =>
  readFileSync(new URL("../" + name, import.meta.url), "utf8");
const globe = JSON.parse(read("assets/globe.geojson"));
const original = JSON.parse(read("data/world.geojson"));
const context = vm.createContext({});
vm.runInContext(read("assets/d3.min.js"), context);
const { d3 } = context;

test("light globe retains all original country identifiers and shared land", () => {
  assert.deepEqual(
    globe.features.map((f) => f.properties.id).sort(),
    original.features.map((f) => f.properties.id).sort(),
  );
  assert.equal(globe.land.type, "MultiPolygon");
  assert.ok(Buffer.byteLength(read("assets/globe.geojson")) < 450000);
  for (const feature of [...globe.features, globe.land]) {
    const area = d3.geoArea(feature);
    assert.ok(
      Number.isFinite(area) && area > 0 && area < 2 * Math.PI,
      `${feature.properties?.id || "merged land"} must retain outward winding`,
    );
  }
});

test("simplified boundaries project safely around the globe and across the date line", () => {
  for (const center of [
    [18, 23],
    [138, 36],
    [-170, 0],
    [0, -85],
  ]) {
    const projection = d3
      .geoOrthographic()
      .rotate(center.map((n) => -n))
      .scale(200)
      .translate([250, 250]);
    const path = d3.geoPath(projection);
    for (const feature of [...globe.features, globe.land]) {
      const drawing = path(feature);
      assert.ok(drawing === null || !/NaN|Infinity/.test(drawing));
    }
    assert.ok(
      path(globe.land),
      "land must remain visible from each hemisphere",
    );
  }
});

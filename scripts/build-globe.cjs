// Build only; the website has no TopoJSON runtime dependency.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const requireTool = process.argv[2]
  ? createRequire(path.resolve(process.argv[2], "package.json"))
  : require;
const { topology } = requireTool("topojson-server");
const { feature, merge } = requireTool("topojson-client");
const { presimplify, simplify, quantile, sphericalTriangleArea } =
  requireTool("topojson-simplify");
const root = path.resolve(__dirname, "..");
const source = JSON.parse(
  fs.readFileSync(path.join(root, "data/world.geojson"), "utf8"),
);
const weighted = presimplify(
  topology({ countries: source }, 1e6),
  sphericalTriangleArea,
);
// quantile() ranks in descending weight order: .04 retains the top 4%.
const threshold = quantile(weighted, 0.04);
// Preserve small islands and narrow boundaries instead of collapsing them to
// zero-area lines when the global detail threshold removes every inner point.
for (const arc of weighted.arcs) {
  const first = arc[0],
    last = arc[arc.length - 1];
  const closed = first[0] === last[0] && first[1] === last[1];
  const retained = arc.slice(1, -1).sort((a, b) => b[2] - a[2]);
  retained.slice(0, closed ? 3 : 1).forEach((point) => {
    point[2] = Infinity;
  });
}
const geo = vm.createContext({});
vm.runInContext(
  fs.readFileSync(path.join(root, "assets/d3.min.js"), "utf8"),
  geo,
);
let simplified, result;
for (let attempt = 0; attempt < 3; attempt++) {
  simplified = simplify(weighted, threshold);
  result = feature(simplified, simplified.objects.countries);
  let repairs = 0;
  result.features.forEach((country, index) => {
    const topologyCountry = weighted.objects.countries.geometries[index];
    const polygons =
      country.geometry.type === "Polygon"
        ? [country.geometry.coordinates]
        : country.geometry.coordinates;
    polygons.forEach((coordinates, polygonIndex) => {
      if (geo.d3.geoArea({ type: "Polygon", coordinates }) <= 2 * Math.PI)
        return;
      // A very narrow island can reverse winding after simplification. Retain
      // its original arcs; reversing the ring would silently change topology.
      const rings =
        topologyCountry.type === "Polygon"
          ? topologyCountry.arcs
          : topologyCountry.arcs[polygonIndex];
      for (const ring of rings)
        for (const arcIndex of ring) {
          const arc = weighted.arcs[arcIndex < 0 ? ~arcIndex : arcIndex];
          for (const point of arc) point[2] = Infinity;
        }
      repairs++;
    });
  });
  if (!repairs) break;
  if (attempt === 2)
    throw Error("Globe simplification could not preserve polygon winding");
}
result.land = merge(simplified, simplified.objects.countries.geometries);
const content = JSON.stringify(result, (key, value) =>
  typeof value === "number" ? Math.round(value * 10000) / 10000 : value,
);
fs.writeFileSync(path.join(root, "assets/globe.geojson"), content + "\n");
console.log(
  JSON.stringify({
    features: result.features.length,
    bytes: Buffer.byteLength(content),
  }),
);

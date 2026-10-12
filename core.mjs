export const REPO = "Warren-xh/travel-atlas";
export const BRANCH = "main";
export const PALETTE_IDS = ["free", "visited", "evisa", "orange", "purple"];
export const EMPTY_RECORD = Object.freeze({
  status: "none",
  date: "",
  note: "",
});
export const DEFAULT_PROFILE = Object.freeze({
  title: "把世界，走成故事。",
  subtitle: "用颜色收藏足迹，用文字记住每一次出发。",
  brand: "行迹",
  home: "IRL",
});
export const clone = (value) => structuredClone(value);

export function validDate(value) {
  if (value === "") return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(value + "T00:00:00Z");
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function validateAtlas(value, countryIds) {
  const invalid = (message) => {
    throw new Error(message);
  };
  if (
    !value ||
    value.version !== 1 ||
    !Array.isArray(value.palette) ||
    value.palette.length !== 5 ||
    !value.countries ||
    typeof value.countries !== "object" ||
    Array.isArray(value.countries)
  )
    invalid("这不是有效的行迹地图备份。");
  if (new Set(value.palette.map((p) => p?.id)).size !== 5)
    invalid("图例不能包含重复颜色。");
  const palette = value.palette.map((p) => {
    if (
      !p ||
      !PALETTE_IDS.includes(p.id) ||
      !/^#[\da-f]{6}$/i.test(p.color) ||
      typeof p.label !== "string" ||
      !p.label.trim() ||
      p.label.length > 30
    )
      invalid("图例颜色或名称格式不正确。");
    return { id: p.id, label: p.label.trim(), color: p.color.toLowerCase() };
  });
  const countries = {};
  for (const [id, r] of Object.entries(value.countries)) {
    if (
      !countryIds.has(id) ||
      !r ||
      typeof r !== "object" ||
      Array.isArray(r) ||
      !["none", ...PALETTE_IDS].includes(r.status) ||
      typeof r.note !== "string" ||
      r.note.length > 5000 ||
      !validDate(r.date)
    )
      invalid("国家记录格式不正确：" + id);
    const next = { status: r.status, date: r.date, note: r.note };
    if (r.source) {
      let url;
      try {
        url = new URL(r.source);
      } catch {
        invalid("来源链接格式不正确：" + id);
      }
      if (
        typeof r.source !== "string" ||
        r.source.length > 2000 ||
        url.protocol !== "https:" ||
        url.username ||
        url.password
      )
        invalid("来源链接必须是有效的 HTTPS 地址。");
      next.source = r.source;
    }
    if (r.checkedAt) {
      if (!validDate(r.checkedAt)) invalid("来源核实日期不正确：" + id);
      next.checkedAt = r.checkedAt;
    }
    countries[id] = next;
  }
  const profile = { ...DEFAULT_PROFILE, ...value.profile };
  for (const [key, limit] of [
    ["title", 80],
    ["subtitle", 180],
    ["brand", 20],
  ]) {
    if (
      typeof profile[key] !== "string" ||
      !profile[key].trim() ||
      profile[key].length > limit
    )
      invalid("主页文字格式不正确。");
    profile[key] = profile[key].trim();
  }
  if (!countryIds.has(profile.home)) invalid("默认国家不存在。");
  return {
    version: 1,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
    profile: {
      title: profile.title,
      subtitle: profile.subtitle,
      brand: profile.brand,
      home: profile.home,
    },
    palette,
    countries,
  };
}

export function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .filter((k) => value[k] !== undefined)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(value[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}

export function equivalent(a, b) {
  return canonical(a) === canonical(b);
}
export function sameAtlas(a, b) {
  return equivalent(
    { profile: a.profile, palette: a.palette, countries: a.countries },
    { profile: b.profile, palette: b.palette, countries: b.countries },
  );
}

export function diffAtlas(base, next) {
  const countries = [
    ...new Set([
      ...Object.keys(base.countries),
      ...Object.keys(next.countries),
    ]),
  ].filter(
    (id) =>
      !equivalent(
        base.countries[id] || EMPTY_RECORD,
        next.countries[id] || EMPTY_RECORD,
      ),
  );
  const palette = PALETTE_IDS.filter(
    (id) =>
      !equivalent(
        base.palette.find((p) => p.id === id),
        next.palette.find((p) => p.id === id),
      ),
  );
  return {
    countries,
    palette,
    profile: !equivalent(base.profile, next.profile),
    total:
      countries.length +
      palette.length +
      Number(!equivalent(base.profile, next.profile)),
  };
}

// Merge individual fields: a note edited on one device and a color on another
// survive together. A conflicting field always needs an explicit choice.
export function mergeAtlas(base, local, remote) {
  const result = clone(remote);
  const conflicts = [];
  function mergeObject(b = {}, l = {}, r = {}, target, path) {
    for (const key of new Set([
      ...Object.keys(b),
      ...Object.keys(l),
      ...Object.keys(r),
    ])) {
      if (equivalent(l[key], b[key])) continue;
      if (equivalent(r[key], b[key]) || equivalent(l[key], r[key])) {
        if (l[key] === undefined) delete target[key];
        else target[key] = clone(l[key]);
      } else
        conflicts.push({
          path: [...path, key],
          base: b[key],
          local: l[key],
          remote: r[key],
        });
    }
  }
  mergeObject(base.profile, local.profile, remote.profile, result.profile, [
    "profile",
  ]);
  for (const id of PALETTE_IDS)
    mergeObject(
      base.palette.find((p) => p.id === id),
      local.palette.find((p) => p.id === id),
      remote.palette.find((p) => p.id === id),
      result.palette.find((p) => p.id === id),
      ["palette", id],
    );
  for (const id of new Set([
    ...Object.keys(base.countries),
    ...Object.keys(local.countries),
    ...Object.keys(remote.countries),
  ])) {
    result.countries[id] ||= clone(EMPTY_RECORD);
    mergeObject(
      base.countries[id] || EMPTY_RECORD,
      local.countries[id] || EMPTY_RECORD,
      remote.countries[id] || EMPTY_RECORD,
      result.countries[id],
      ["countries", id],
    );
  }
  return { data: result, conflicts };
}

export function resolveConflict(data, conflict, choice) {
  const [section, id, field] = conflict.path;
  const target =
    section === "profile"
      ? data.profile
      : section === "palette"
        ? data.palette.find((p) => p.id === id)
        : data.countries[id];
  const key = section === "profile" ? id : field;
  const value = choice === "local" ? conflict.local : conflict.remote;
  if (value === undefined) delete target[key];
  else target[key] = clone(value);
}

export function searchCountries(countries, query) {
  const normalized = (s) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  const q = normalized(query.trim());
  return countries
    .filter((c) =>
      normalized(c.name + " " + c.english + " " + c.id).includes(q),
    )
    .sort(
      (a, b) =>
        Number(normalized(b.name) === q || normalized(b.id) === q) -
        Number(normalized(a.name) === q || normalized(a.id) === q),
    );
}

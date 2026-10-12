import {
  clone,
  REPO,
  EMPTY_RECORD,
  validateAtlas,
  equivalent,
  sameAtlas,
  diffAtlas,
  mergeAtlas,
  resolveConflict,
  searchCountries,
} from "./core.mjs";
import {
  decryptToken,
  generatePassword,
  strongPassword,
  validateVault,
} from "./auth.mjs";
import {
  GitHubClient,
  DATA_PATH,
  VAULT_PATH,
  loadPublicVault,
} from "./github.mjs";

const $ = (id) => document.getElementById(id);
const LOCAL_KEY = "travel-atlas-draft-v2";
const LEGACY_KEY = "travel-atlas-draft-v1";
const RECOVERY_KEY = "travel-atlas-recovery-v2";
const tabId = crypto.randomUUID();
const api = new GitHubClient();
const CONTINENTS = [
  ["world", "世界", "WORLD"],
  ["Europe", "欧洲", "EUROPE"],
  ["Asia", "亚洲", "ASIA"],
  ["Africa", "非洲", "AFRICA"],
  ["North America", "北美洲", "NORTH AMERICA"],
  ["South America", "南美洲", "SOUTH AMERICA"],
  ["Oceania", "大洋洲", "OCEANIA"],
  ["Antarctica", "南极洲", "ANTARCTICA"],
];
const VIEWS = {
  Europe: [17, 52, 0.82],
  Asia: [100, 35, 0.57],
  Africa: [20, 1, 0.67],
  "North America": [-100, 42, 0.54],
  "South America": [-63, -23, 0.67],
  Oceania: [153, -22, 0.57],
};
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
let countries = [],
  countryById = new Map(),
  features = new Map(),
  countryIds = new Set(),
  geometry,
  data,
  baseline,
  published,
  pendingDraft;
let selected = "IRL",
  continent = "Europe",
  colorFilter = "",
  panel = "details",
  projection,
  geoPath,
  root,
  zoom,
  centers = [],
  transform,
  width = 0,
  height = 0;
let toastTimer,
  editorTimer,
  resizeTimer,
  lastActivity = Date.now(),
  busy = false,
  authBusy = false,
  vault,
  vaultSha,
  loadingVault = false,
  editorDirty = false,
  storageFailed = false,
  conflictPlan;
let undoStack = [],
  redoStack = [],
  searchIndex = -1,
  publishPoll;
const info = (id) => countryById.get(id);
const record = (id) => data?.countries[id] || EMPTY_RECORD;
const palette = (id) => data.palette.find((p) => p.id === id);
const status = (id) => palette(record(id).status);
const fill = (id) => status(id)?.color || "transparent";
const belongs = (country) =>
  continent === "world" || country?.continents.includes(continent);
const matchesFilter = (id) => !colorFilter || record(id).status === colorFilter;
const continentName = (id) => CONTINENTS.find((c) => c[0] === id)?.[1] || id;
const valid = (value) => validateAtlas(value, countryIds);
const text = (tag, content, className) => {
  const node = document.createElement(tag);
  node.textContent = content;
  if (className) node.className = className;
  return node;
};
function icon(name) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  node.classList.add("icon");
  node.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(node.namespaceURI, "use");
  use.setAttribute("href", "#i-" + name);
  node.append(use);
  return node;
}
function swatch(color, empty = false) {
  const dot = document.createElement("i");
  dot.className = "swatch" + (empty ? " transparent" : "");
  if (color) dot.style.backgroundColor = color;
  return dot;
}
function flag(country) {
  const letters = [...(country.flag || "")].map(
    (c) => c.codePointAt(0) - 0x1f1e6,
  );
  if (letters.length !== 2 || letters.some((n) => n < 0 || n > 25))
    return icon("pin");
  const image = document.createElement("img");
  image.src =
    "./assets/flags/" +
    letters.map((n) => String.fromCharCode(97 + n)).join("") +
    ".svg";
  image.alt = "";
  image.className = "flag-image";
  image.width = 32;
  image.height = 24;
  image.loading = "lazy";
  return image;
}
function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $("toast").hidden = true;
  }, 4400);
}
function notice(message) {
  $("notice-text").textContent = message;
  $("notice-banner").hidden = false;
}
function showDialog(id) {
  if (!$(id).open) $(id).showModal();
}
function showTab(next) {
  panel = next;
  $("country-panel").hidden = next !== "details";
  $("country-list-panel").hidden = next !== "list";
  for (const [id, key] of [
    ["details-tab", "details"],
    ["list-tab", "list"],
  ]) {
    $(id).setAttribute("aria-selected", String(next === key));
    $(id).tabIndex = next === key ? 0 : -1;
  }
  if (next === "list") renderList();
}
function formattedDate(value) {
  return value
    ? new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      }).format(new Date(value + "T00:00:00Z"))
    : "还没有日期记录";
}
function dirty() {
  return !!data && !sameAtlas(data, baseline);
}
function recoverySnapshots() {
  try {
    return JSON.parse(localStorage.getItem(RECOVERY_KEY) || "[]")
      .slice(0, 8)
      .flatMap((item) => {
        try {
          return [
            {
              data: valid(item.data),
              savedAt: item.savedAt,
              label: item.label,
            },
          ];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}
function snapshot(value, label = "编辑前的记录") {
  try {
    const recent = recoverySnapshots();
    if (recent[0] && sameAtlas(recent[0].data, value)) return;
    recent.unshift({
      data: valid(value),
      savedAt: new Date().toISOString(),
      label,
    });
    localStorage.setItem(RECOVERY_KEY, JSON.stringify(recent.slice(0, 8)));
  } catch {
    /* The primary draft save reports storage failures. */
  }
}

function persist() {
  if (!api.unlocked) return;
  try {
    const prior = JSON.parse(localStorage.getItem(LOCAL_KEY) || "null");
    if (prior?.writer && prior.writer !== tabId && prior.data)
      snapshot(valid(prior.data), "另一标签页的草稿");
    if (dirty())
      localStorage.setItem(
        LOCAL_KEY,
        JSON.stringify({
          data,
          baseline,
          savedAt: new Date().toISOString(),
          writer: tabId,
        }),
      );
    else localStorage.removeItem(LOCAL_KEY);
    localStorage.removeItem(LEGACY_KEY);
    storageFailed = false;
    $("editor-save-state").textContent = dirty()
      ? "已自动保存到本机草稿"
      : "所有记录已同步";
  } catch {
    storageFailed = true;
    $("editor-save-state").textContent = "本机存储不可用，请导出备份";
    notice("浏览器无法保存草稿。请先导出备份，再关闭网页。");
  }
  renderDraftStatus();
}
function renderDraftStatus() {
  const diff = diffAtlas(baseline, data);
  $("change-badge").textContent = diff.total;
  $("draft-status").textContent = diff.total
    ? diff.total + " 项修改待发布"
    : "所有记录已同步";
  $("undo-button").disabled = !undoStack.length || busy;
  $("redo-button").disabled = !redoStack.length || busy;
  $("recovery-button").hidden = !api.unlocked || !recoverySnapshots().length;
  if (api.unlocked)
    $("save-status").textContent = diff.total
      ? "本机草稿 · 尚未发布"
      : "已与 GitHub 记录同步";
}
function change(next) {
  if (!api.unlocked || busy) return;
  next = valid(next);
  if (sameAtlas(next, data)) return;
  snapshot(data);
  undoStack.push(clone(data));
  if (undoStack.length > 30) undoStack.shift();
  redoStack = [];
  data = next;
  persist();
  renderAll();
}
function flushEditor() {
  clearTimeout(editorTimer);
  if (!editorDirty || !api.unlocked || busy) return;
  editorDirty = false;
  const next = clone(data);
  const r = record(selected);
  next.countries[selected] = {
    ...r,
    status: new FormData($("editor")).get("status") || r.status,
    date: $("travel-date").value,
    note: $("country-note").value,
  };
  try {
    change(next);
  } catch (error) {
    toast(error.message);
  }
}
function queueEditor() {
  if (!api.unlocked || busy) return;
  editorDirty = true;
  $("note-count").textContent = $("country-note").value.length + " / 5000";
  $("editor-save-state").textContent = "正在保存…";
  clearTimeout(editorTimer);
  editorTimer = setTimeout(flushEditor, 500);
}
function writeLocation() {
  const query = new URLSearchParams({ country: selected, region: continent });
  history.replaceState(null, "", "#" + query);
}
function selectCountry(id, scroll = false) {
  if (!info(id)) return;
  flushEditor();
  selected = id;
  $("country-search").value = "";
  hideSearch();
  showTab("details");
  if (!belongs(info(id))) setContinent(info(id).continents[0] || "world");
  else {
    renderCountry();
    updateLabels();
    writeLocation();
  }
  if (scroll && innerWidth <= 860)
    $("country-panel").scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    });
}
function setContinent(id) {
  if (!CONTINENTS.some((c) => c[0] === id)) id = "world";
  flushEditor();
  continent = id;
  $("continents")
    .querySelectorAll("button")
    .forEach((button) => {
      const active = button.dataset.continent === id;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  const region = CONTINENTS.find((c) => c[0] === id);
  $("region-title").textContent = region[1];
  $("region-english").textContent = region[2];
  $("region-count").textContent =
    countries.filter(belongs).length + " 个国家 / 地区";
  if (!belongs(info(selected)))
    selected =
      countries.find((c) => belongs(c) && record(c.id).status === "visited")
        ?.id ||
      countries.find(belongs)?.id ||
      "ATA";
  drawMap();
  renderAll();
  writeLocation();
}
function renderProfile() {
  $("brand-name").textContent = data.profile.brand;
  $("hero-title").textContent = data.profile.title;
  $("hero-subtitle").textContent = data.profile.subtitle;
  document.title = data.profile.brand + " Atlas · 我的旅行地图";
  const updated = new Date(data.updatedAt);
  $("last-updated").textContent = Number.isFinite(updated.getTime())
    ? "记录更新于 " +
      new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(updated)
    : "每一次出发，都值得记住";
}
function renderStats() {
  const all = Object.values(data.countries);
  const visited = all.filter((r) => r.status === "visited").length;
  $("visited-count").textContent = visited;
  $("free-count").textContent = all.filter((r) => r.status === "free").length;
  $("notes-count").textContent = all.filter((r) => r.note.trim()).length;
  const progress = (100 * visited) / countries.length;
  $("progress-count").replaceChildren(
    document.createTextNode(progress.toFixed(1)),
    text("small", "%"),
  );
  $("progress-fill").style.width = progress + "%";
  $("progress-detail").textContent =
    visited + " / " + countries.length + " 个国家与地区";
}
function renderLegend() {
  $("legend").replaceChildren(
    ...[...data.palette, { id: "none", label: "未分类", color: "" }].map(
      (p) => {
        const button = text(
          "button",
          "",
          "legend-item" + (colorFilter === p.id ? " active" : ""),
        );
        button.type = "button";
        button.setAttribute("aria-pressed", String(colorFilter === p.id));
        button.append(
          swatch(p.color, p.id === "none"),
          document.createTextNode(p.label),
          text(
            "small",
            countries.filter((c) => belongs(c) && record(c.id).status === p.id)
              .length,
          ),
        );
        button.onclick = () => {
          colorFilter = colorFilter === p.id ? "" : p.id;
          renderLegend();
          recolor();
          renderList();
        };
        return button;
      },
    ),
  );
  $("filter-caption").hidden = !colorFilter;
  $("filter-caption").textContent =
    "正在筛选：" +
    (palette(colorFilter)?.label || "未分类") +
    " · 再点图例恢复全部";
}
function renderCountry() {
  const country = info(selected);
  if (!country) return;
  const r = record(selected),
    p = status(selected);
  $("country-name").textContent = country.name;
  $("country-flag").replaceChildren(flag(country));
  $("country-continent").textContent = country.continents
    .map(continentName)
    .join(" / ");
  $("country-english").replaceChildren(
    document.createTextNode(country.english),
    text("span", country.id),
  );
  $("country-status").replaceChildren(
    swatch(p?.color, !p),
    document.createTextNode(p?.label || "尚未分类"),
  );
  $("view-date").textContent = formattedDate(r.date);
  $("view-note").textContent =
    r.note || "还没有旅行笔记。\n那些值得记住的小事，留在这里。";
  $("view-note").classList.toggle("empty-note", !r.note);
  $("travel-date").value = r.date;
  $("country-note").value = r.note;
  $("note-count").textContent = r.note.length + " / 5000";
  $("color-options").replaceChildren(
    ...[...data.palette, { id: "none", label: "透明 / 未分类", color: "" }].map(
      (p) => {
        const label = text("label", "", "color-option");
        const input = document.createElement("input");
        input.type = "radio";
        input.name = "status";
        input.value = p.id;
        input.checked = r.status === p.id;
        label.append(
          input,
          swatch(p.color, p.id === "none"),
          text("span", p.label),
        );
        return label;
      },
    ),
  );
  $("view-fields").hidden = api.unlocked;
  $("editor").hidden = !api.unlocked;
  $("visa-source").hidden = !r.source;
  if (r.source) {
    $("source-link").href = r.source;
    $("source-date").textContent =
      "核实日期：" +
      (r.checkedAt || "未记录") +
      " · 对应原始分类，旅行前需重新核对";
  }
  recolor();
}
function renderList() {
  const filter = $("list-filter").value;
  let matches = countries.filter(
    (c) =>
      belongs(c) &&
      matchesFilter(c.id) &&
      (filter === "all" ||
        (filter === "notes" && record(c.id).note.trim()) ||
        (filter === "dated" && record(c.id).date) ||
        record(c.id).status === filter),
  );
  const query = $("country-search").value.trim();
  if (query) matches = searchCountries(matches, query);
  matches.sort((a, b) =>
    $("list-sort").value === "date"
      ? record(b.id).date.localeCompare(record(a.id).date) ||
        a.name.localeCompare(b.name, "zh-CN")
      : a.name.localeCompare(b.name, "zh-CN"),
  );
  $("list-count").textContent = matches.length;
  $("country-list-summary").textContent =
    continentName(continent) + " · " + matches.length + " 个结果";
  $("country-list").replaceChildren(
    ...matches.map((c) => {
      const button = text("button", "", "country-row");
      button.type = "button";
      button.append(flag(c));
      const details = text("span", "", "row-details");
      details.append(
        text("strong", c.name),
        text("small", record(c.id).date || status(c.id)?.label || c.english),
      );
      button.append(
        details,
        swatch(fill(c.id), record(c.id).status === "none"),
      );
      button.onclick = () => selectCountry(c.id, true);
      return button;
    }),
  );
  if (!matches.length)
    $("country-list").append(
      text(
        "p",
        "还没有匹配的记录。试试切换大洲、筛选条件或图例颜色。",
        "empty-state",
      ),
    );
}
function renderJourney() {
  const stories = countries
    .filter((c) => record(c.id).note.trim() || record(c.id).date)
    .sort((a, b) => record(b.id).date.localeCompare(record(a.id).date))
    .slice(0, 3);
  $("journey-cards").replaceChildren(
    ...stories.map((c) => {
      const r = record(c.id),
        button = text("button", "", "journey-card"),
        header = document.createElement("header");
      button.type = "button";
      header.append(flag(c), text("small", r.date || "旅行笔记"));
      button.append(
        header,
        text("h3", c.name),
        text("p", r.note || "在这里，留下了自己的足迹。"),
      );
      button.onclick = () => selectCountry(c.id, true);
      return button;
    }),
  );
  if (!stories.length) {
    const empty = text("div", "", "journey-empty"),
      copy = document.createElement("div");
    copy.append(
      text("h3", "下一段故事，从这里开始"),
      text("p", "在国家记录里写下日期或笔记，旅程就会出现在这里。"),
    );
    empty.append(icon("pin"), copy);
    $("journey-cards").append(empty);
  }
}
function renderAll() {
  renderProfile();
  renderStats();
  renderLegend();
  renderCountry();
  renderList();
  renderJourney();
  renderDraftStatus();
}

function recolor() {
  if (!root) return;
  root
    .selectAll(".country")
    .attr("fill", (f) =>
      belongs(info(f.properties.id)) ? fill(f.properties.id) : "transparent",
    )
    .classed("selected", (f) => f.properties.id === selected)
    .classed(
      "filtered-out",
      (f) => belongs(info(f.properties.id)) && !matchesFilter(f.properties.id),
    )
    .attr(
      "aria-label",
      (f) =>
        info(f.properties.id).name +
        "，" +
        (status(f.properties.id)?.label || "尚未分类"),
    );
  root
    .selectAll(".micro-country")
    .attr("fill", (c) => fill(c.id))
    .classed("selected", (c) => c.id === selected)
    .classed("filtered-out", (c) => !matchesFilter(c.id));
  root
    .selectAll(".country-label")
    .classed("selected", (c) => c.id === selected)
    .classed("filtered-out", (c) => !matchesFilter(c.id));
}
function tooltip(event, country) {
  const t = $("tooltip");
  t.replaceChildren(
    document.createTextNode(country.name),
    text("small", status(country.id)?.label || "尚未分类"),
  );
  t.hidden = false;
  const bounds = $("map-stage").getBoundingClientRect();
  t.style.left =
    Math.max(
      8,
      Math.min(
        event.clientX - bounds.left + 12,
        bounds.width - t.offsetWidth - 8,
      ),
    ) + "px";
  t.style.top =
    Math.max(8, event.clientY - bounds.top - t.offsetHeight - 12) + "px";
}
function updateLabels() {
  if (!root) return;
  const k = transform?.k || 1,
    tx = transform?.x || 0,
    ty = transform?.y || 0,
    placed = [];
  const candidates = [...centers].sort(
    (a, b) =>
      Number(b.id === selected) - Number(a.id === selected) || b.area - a.area,
  );
  const labels = candidates.filter((c) => {
    const x = c.xy[0] * k + tx,
      y = c.xy[1] * k + ty + (c.small ? 13 : 0);
    if (x < 12 || x > width - 12 || y < 15 || y > height - 54) return false;
    if (continent === "world" && c.area * k * k < 650 && c.id !== selected)
      return false;
    const w = c.name.length * 10 + 8,
      box = [x - w / 2, y - 7, x + w / 2, y + 7];
    if (
      c.id !== selected &&
      placed.some(
        (b) =>
          !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]),
      )
    )
      return false;
    placed.push(box);
    return true;
  });
  root
    .selectAll(".country-label")
    .data(labels, (c) => c.id)
    .join("text")
    .attr("class", "country-label")
    .attr("x", (c) => c.xy[0])
    .attr("y", (c) => c.xy[1] + (c.small ? 13 / k : 0))
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "middle")
    .style("font-size", 10 / k + "px")
    .style("stroke-width", 3 / k + "px")
    .text((c) => c.name)
    .attr("display", $("show-labels").checked ? null : "none");
  recolor();
}
function drawMap() {
  if (!geometry || !data) return;
  const stage = $("map-stage");
  width = stage.clientWidth;
  height = stage.clientHeight;
  if (width < 1 || height < 1) return;
  const svg = d3.select("#map");
  svg.selectAll("*").remove();
  svg.attr("viewBox", `0 0 ${width} ${height}`);
  if (continent === "world")
    projection = d3.geoNaturalEarth1().fitExtent(
      [
        [16, 30],
        [width - 16, height - 60],
      ],
      { type: "Sphere" },
    );
  else if (continent === "Antarctica")
    projection = d3
      .geoOrthographic()
      .rotate([0, 90])
      .clipAngle(40)
      .scale(Math.min(width, height) * 0.88)
      .translate([width / 2, height / 2 - 15]);
  else {
    const v = VIEWS[continent];
    projection = d3
      .geoMercator()
      .rotate([-v[0], 0])
      .center([0, v[1]])
      .scale(Math.min(width, height) * v[2])
      .translate([width / 2, height / 2 - 10]);
  }
  geoPath = d3.geoPath(projection).digits(1);
  root = svg.append("g");
  root
    .append("path")
    .datum(d3.geoGraticule10())
    .attr("class", "graticule")
    .attr("d", geoPath);
  const available = geometry.features.filter((f) => info(f.properties.id));
  root
    .selectAll(".country")
    .data(available)
    .join("path")
    .attr(
      "class",
      (f) => "country" + (!belongs(info(f.properties.id)) ? " context" : ""),
    )
    .attr("data-country", (f) => f.properties.id)
    .attr("d", geoPath)
    .attr("tabindex", (f) =>
      belongs(info(f.properties.id)) && geoPath.area(f) >= 26 ? 0 : null,
    )
    .attr("aria-hidden", (f) =>
      !belongs(info(f.properties.id)) || geoPath.area(f) < 26 ? "true" : null,
    )
    .attr("role", (f) => (belongs(info(f.properties.id)) ? "button" : null))
    .on("click", (event, f) => {
      if (belongs(info(f.properties.id))) selectCountry(f.properties.id);
    })
    .on("keydown", (event, f) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectCountry(f.properties.id);
      }
    })
    .on("pointermove", (event, f) => {
      if (belongs(info(f.properties.id))) tooltip(event, info(f.properties.id));
    })
    .on("pointerleave", () => {
      $("tooltip").hidden = true;
    });
  centers = countries
    .filter(belongs)
    .map((c) => {
      const f = features.get(c.id);
      let xy = f ? geoPath.centroid(f) : projection([c.lng, c.lat]);
      if (!xy || !xy.every(Number.isFinite)) return null;
      const area = f ? geoPath.area(f) : 0;
      return { ...c, xy, area, small: !f || area < 26 };
    })
    .filter(
      (c) =>
        c && c.xy[0] > 0 && c.xy[0] < width && c.xy[1] > 0 && c.xy[1] < height,
    );
  root
    .selectAll(".micro-country")
    .data(centers.filter((c) => c.small))
    .join("circle")
    .attr("class", "micro-country")
    .attr("data-country", (c) => c.id)
    .attr("cx", (c) => c.xy[0])
    .attr("cy", (c) => c.xy[1])
    .attr("r", 4)
    .attr("tabindex", 0)
    .attr("role", "button")
    .attr("aria-label", (c) => c.name)
    .on("click", (event, c) => selectCountry(c.id))
    .on("keydown", (event, c) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectCountry(c.id);
      }
    })
    .on("pointermove", (event, c) => tooltip(event, c))
    .on("pointerleave", () => {
      $("tooltip").hidden = true;
    });
  transform = d3.zoomIdentity;
  zoom = d3
    .zoom()
    .scaleExtent([1, 12])
    .translateExtent([
      [-width * 0.5, -height * 0.5],
      [width * 1.5, height * 1.5],
    ])
    .on("zoom", (event) => {
      transform = event.transform;
      root.attr("transform", transform);
      root.selectAll(".micro-country").attr("r", 4 / transform.k);
      $("tooltip").hidden = true;
      updateLabels();
    });
  svg
    .call(zoom)
    .on("dblclick.zoom", null)
    .call(zoom.transform, d3.zoomIdentity);
  updateLabels();
}
function focusCountry() {
  const c = centers.find((c) => c.id === selected);
  if (!c) {
    toast("此国家的主要位置不在当前视角，请切换世界地图。");
    return;
  }
  const k = Math.min(
    6,
    Math.max(2.2, Math.sqrt((width * height) / Math.max(c.area, 150)) / 4),
  );
  const next = d3.zoomIdentity
    .translate(width / 2 - c.xy[0] * k, height / 2 - c.xy[1] * k)
    .scale(k);
  d3.select("#map")
    .transition()
    .duration(reduceMotion ? 0 : 450)
    .call(zoom.transform, next);
}
function hideSearch() {
  $("search-results").hidden = true;
  $("country-search").setAttribute("aria-expanded", "false");
  searchIndex = -1;
}
function search() {
  const query = $("country-search").value.trim();
  if (panel === "list") renderList();
  if (!query) {
    hideSearch();
    return;
  }
  searchIndex = -1;
  const matches = searchCountries(countries, query).slice(0, 20);
  $("search-results").hidden = false;
  $("country-search").setAttribute("aria-expanded", "true");
  $("search-results").replaceChildren(
    ...matches.map((c) => {
      const button = text("button", "");
      button.type = "button";
      button.append(
        flag(c),
        document.createTextNode(c.name),
        text("small", c.id),
      );
      button.onclick = () => selectCountry(c.id, true);
      return button;
    }),
  );
  if (!matches.length)
    $("search-results").append(
      text("p", "没有找到这个国家，试试中文、英文或 ISO 代码。"),
    );
}
function setTheme(next) {
  document.documentElement.dataset.theme = next;
  const dark = next === "dark";
  $("theme-toggle").setAttribute("aria-pressed", String(dark));
  $("theme-toggle").setAttribute(
    "aria-label",
    dark ? "切换浅色模式" : "切换深色模式",
  );
  $("theme-toggle").replaceChildren(icon(dark ? "sun" : "moon"));
  try {
    localStorage.setItem("travel-atlas-theme", next);
  } catch {}
}

async function confirmAction(title, description, label = "确认") {
  $("confirm-heading").textContent = title;
  $("confirm-description").textContent = description;
  $("confirm-ok").textContent = label;
  showDialog("confirm-dialog");
  return new Promise((resolve) => {
    let accepted = false;
    $("confirm-ok").onclick = () => {
      accepted = true;
      $("confirm-dialog").close();
    };
    $("confirm-cancel").onclick = () => $("confirm-dialog").close();
    $("confirm-dialog").addEventListener("close", () => resolve(accepted), {
      once: true,
    });
  });
}
async function loadVault() {
  if (loadingVault) return;
  loadingVault = true;
  try {
    const current = await loadPublicVault(api);
    vault = current.data ? validateVault(current.data) : null;
    vaultSha = current.sha;
    if (current.fallback)
      notice(
        "暂时无法检查 GitHub 的最新授权，已使用网页中的授权状态。保存授权时会再次检查仓库。 ",
      );
  } finally {
    loadingVault = false;
  }
}
function setupMode(reconfigure = false) {
  $("unlock-form").hidden = true;
  $("setup-form").hidden = false;
  $("auth-heading").textContent = reconfigure
    ? "更新管理密码与授权"
    : "设置你的地图钥匙";
  $("auth-description").textContent = reconfigure
    ? "设置新的长密码；替换 Token 可更新即将过期的 GitHub 授权。"
    : "第一次配置 GitHub 授权与管理密码，以后只需输入密码。";
  $("setup-token").required = !api.unlocked;
  $("setup-token").placeholder = api.unlocked
    ? "留空沿用当前授权，或粘贴新 Token"
    : "github_pat_…";
  $("setup-form").reset();
  $("setup-token").required = !api.unlocked;
  $("auth-message").textContent = "";
}
async function openAuth(reconfigure = false) {
  flushEditor();
  if (api.unlocked && !reconfigure) {
    toast("管理已解锁，可以直接编辑或发布。");
    return;
  }
  if (!crypto?.subtle) {
    toast("管理功能需要 HTTPS 或 localhost 环境及支持 Web Crypto 的浏览器。");
    return;
  }
  $("auth-message").textContent = "正在检查管理授权…";
  $("unlock-form").hidden = true;
  $("setup-form").hidden = true;
  showDialog("auth-dialog");
  try {
    await loadVault();
    if (!vault || reconfigure) setupMode(reconfigure);
    else {
      $("unlock-form").hidden = false;
      $("setup-form").hidden = true;
      $("auth-heading").textContent = "解锁你的地图";
      $("auth-description").textContent =
        "输入管理密码，即可编辑记录并发布到 GitHub。";
      $("auth-message").textContent = "";
      $("admin-password").focus();
    }
  } catch (error) {
    $("auth-message").textContent = error.message;
    $("auth-description").textContent =
      "无法读取管理授权，请检查网络后重新打开管理入口。";
  }
}
function setAuthBusy(value) {
  authBusy = value;
  for (const id of [
    "unlock-submit",
    "setup-submit",
    "generate-password",
    "reset-auth",
  ])
    $(id).disabled = value;
  $("auth-dialog").querySelector("[data-close]").disabled = value;
}
function activateAdmin() {
  lastActivity = Date.now();
  if (pendingDraft) {
    data = clone(pendingDraft.data);
    baseline = clone(pendingDraft.baseline);
    pendingDraft = null;
    notice("已恢复这台设备的草稿。发布时会检查并合并其他设备的更新。");
  }
  $("admin-bar").hidden = false;
  $("admin-mode").classList.add("active");
  $("admin-mode").replaceChildren(icon("unlock"), text("span", "管理已解锁"));
  $("auth-dialog").close();
  renderAll();
  $("editor-save-state").textContent = dirty()
    ? "已恢复本机草稿"
    : "草稿自动保存在本机";
}
function lock(message = "管理已锁定，草稿保留在本机") {
  if (busy || authBusy) return;
  flushEditor();
  if (api.unlocked && dirty())
    pendingDraft = { data: clone(data), baseline: clone(baseline) };
  api.lock();
  undoStack = [];
  redoStack = [];
  data = clone(published);
  baseline = clone(published);
  $("admin-bar").hidden = true;
  $("admin-mode").classList.remove("active");
  $("admin-mode").replaceChildren(icon("lock"), text("span", "管理地图"));
  document.querySelectorAll("dialog[open]").forEach((d) => d.close());
  renderAll();
  $("save-status").textContent = "正在查看已发布地图";
  toast(message);
}
async function unlock(event) {
  event.preventDefault();
  if (authBusy) return;
  setAuthBusy(true);
  $("auth-message").textContent = "正在解锁…";
  try {
    const token = await decryptToken(vault, $("admin-password").value);
    if (!$("auth-dialog").open) return;
    api.unlock(token);
    activateAdmin();
    toast("已解锁。编辑会自动保存为草稿，发布后同步到所有设备。");
  } catch (error) {
    $("auth-message").textContent = error.message;
    $("admin-password").value = "";
  } finally {
    setAuthBusy(false);
    $("admin-password").value = "";
  }
}
async function configureAuth(event) {
  event.preventDefault();
  if (authBusy) return;
  const password = $("new-password").value;
  if (password !== $("confirm-password").value) {
    $("auth-message").textContent = "两次输入的密码不一致。";
    return;
  }
  if (!strongPassword(password)) {
    $("auth-message").textContent =
      "请使用至少 16 位的长密码，或点击生成随机密码。";
    return;
  }
  if (
    vault &&
    !api.unlocked &&
    !(await confirmAction(
      "重新配置管理授权",
      "此操作会替换原管理密码。请确认你已保存好新密码，且新的 Token 只授权本地图仓库。",
      "重新配置",
    ))
  )
    return;
  setAuthBusy(true);
  $("auth-message").textContent = "正在加密授权并检查仓库权限…";
  const token = $("setup-token").value.trim();
  const candidate = token ? new GitHubClient() : api;
  if (token) candidate.unlock(token);
  try {
    const encrypted = await candidate.seal(password);
    await candidate.read(DATA_PATH);
    const current = await candidate.read(VAULT_PATH, false);
    if (
      current &&
      !vault &&
      !api.unlocked &&
      !(await confirmAction(
        "仓库已有管理授权",
        "网页可能还未显示最新授权。继续会替换已有管理密码；请确认这是你要做的操作。",
        "替换现有授权",
      ))
    )
      return;
    if (
      current &&
      ((vaultSha && current.sha !== vaultSha) ||
        (vault && !equivalent(current.data, vault)))
    )
      throw Error(
        "管理授权刚被其他设备更新。请关闭后重新打开管理设置，再试一次。",
      );
    const result = await candidate.write(
      VAULT_PATH,
      encrypted,
      current?.sha,
      "Configure encrypted travel atlas admin access",
    );
    vault = encrypted;
    vaultSha = result.content.sha;
    if (token) api.unlock(token);
    activateAdmin();
    toast("授权配置成功！以后只需用管理密码解锁。");
  } catch (error) {
    $("auth-message").textContent = error.message;
  } finally {
    if (candidate !== api) candidate.lock();
    $("setup-token").value = "";
    $("new-password").value = "";
    $("confirm-password").value = "";
    $("password-saved").checked = false;
    setAuthBusy(false);
  }
}
function clearAuthFields() {
  for (const id of [
    "admin-password",
    "setup-token",
    "new-password",
    "confirm-password",
  ]) {
    $(id).value = "";
    $(id).type = "password";
  }
  $("show-password").checked = false;
  $("show-new-password").checked = false;
  $("password-saved").checked = false;
}

function openPalette() {
  if (!api.unlocked) return openAuth();
  flushEditor();
  $("palette-fields").replaceChildren(
    ...data.palette.map((p) => {
      const row = text("div", "", "palette-row"),
        color = document.createElement("input"),
        label = document.createElement("input");
      color.type = "color";
      color.name = p.id + "-color";
      color.value = p.color;
      color.setAttribute("aria-label", p.label + "颜色");
      label.type = "text";
      label.name = p.id + "-label";
      label.maxLength = 30;
      label.required = true;
      label.value = p.label;
      label.setAttribute("aria-label", p.label + "名称");
      row.append(color, label);
      return row;
    }),
  );
  showDialog("palette-dialog");
}
function openSettings() {
  if (!api.unlocked) return openAuth();
  flushEditor();
  for (const key of ["brand", "title", "subtitle", "home"])
    $("setting-" + key).value = data.profile[key];
  showDialog("settings-dialog");
}
function openRecovery() {
  if (!api.unlocked || busy) return;
  flushEditor();
  $("recovery-list").replaceChildren(
    ...recoverySnapshots().map((item) => {
      const button = text("button", "", "recovery-item");
      const date = new Date(item.savedAt);
      button.type = "button";
      button.append(
        text(
          "strong",
          Number.isFinite(date.getTime())
            ? date.toLocaleString("zh-CN", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })
            : "近期快照",
        ),
        text("span", item.label || "地图记录快照"),
        text(
          "small",
          Object.values(item.data.countries).filter((r) => r.note.trim())
            .length +
            " 篇笔记 · " +
            Object.values(item.data.countries).filter(
              (r) => r.status === "visited",
            ).length +
            " 个足迹",
        ),
      );
      button.onclick = async () => {
        if (
          !(await confirmAction(
            "恢复这份记录",
            "这份快照将替换当前草稿。当前记录也会保留为快照，并可通过撤销恢复。",
            "恢复为草稿",
          ))
        )
          return;
        $("recovery-dialog").close();
        change(item.data);
        toast("记录快照已恢复为草稿，请检查后再发布。");
      };
      return button;
    }),
  );
  showDialog("recovery-dialog");
}
function undo(redo = false) {
  if (busy || !api.unlocked) return;
  flushEditor();
  const source = redo ? redoStack : undoStack,
    target = redo ? undoStack : redoStack;
  if (!source.length) return;
  target.push(clone(data));
  data = source.pop();
  persist();
  renderAll();
  toast(redo ? "已重做修改" : "已撤销修改");
}
function download(blob, name) {
  const link = document.createElement("a"),
    url = URL.createObjectURL(blob);
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportBackup() {
  flushEditor();
  download(
    new Blob([JSON.stringify(data, null, 2) + "\n"], {
      type: "application/json",
    }),
    "travel-atlas-" + new Date().toISOString().slice(0, 10) + ".json",
  );
  toast("已导出地图记录；备份不包含管理密码或授权。");
}
async function importBackup(event) {
  if (!api.unlocked) return;
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 2000000) throw Error("备份超过 2 MB，请确认文件格式。");
    const incoming = valid(JSON.parse(await file.text()));
    flushEditor();
    if (
      !(await confirmAction(
        "导入地图备份",
        "导入会替换当前草稿的记录、图例与主页文字。原草稿仍可通过“撤销”恢复。",
        "导入备份",
      ))
    )
      return;
    change(incoming);
    toast("备份已导入为草稿，发布后会同步到所有设备。");
  } catch (error) {
    toast(error.message);
  }
}
function exportMap() {
  if (!root) return;
  const svg = $("map").cloneNode(true);
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("width", width);
  svg.setAttribute("height", height + 80);
  const computed = getComputedStyle(document.documentElement),
    background = document.createElementNS(svg.namespaceURI, "rect");
  background.setAttribute("width", width);
  background.setAttribute("height", height + 80);
  background.setAttribute("fill", computed.getPropertyValue("--map").trim());
  svg.prepend(background);
  const originals = $("map").querySelectorAll("path,circle,text"),
    clones = svg.querySelectorAll("path,circle,text");
  originals.forEach((node, i) => {
    const css = getComputedStyle(node);
    for (const property of [
      "fill",
      "stroke",
      "stroke-width",
      "stroke-linejoin",
      "opacity",
      "font-size",
      "font-weight",
      "font-family",
      "paint-order",
      "display",
    ])
      clones[i].style.setProperty(property, css.getPropertyValue(property));
  });
  const addText = (content, x, y, size) => {
    const node = document.createElementNS(svg.namespaceURI, "text");
    node.setAttribute("x", x);
    node.setAttribute("y", y);
    node.setAttribute("font-family", "sans-serif");
    node.setAttribute("font-size", size);
    node.setAttribute("fill", computed.getPropertyValue("--ink").trim());
    node.textContent = content;
    svg.append(node);
  };
  const defs = document.createElementNS(svg.namespaceURI, "defs"),
    clip = document.createElementNS(svg.namespaceURI, "clipPath"),
    clipRect = document.createElementNS(svg.namespaceURI, "rect"),
    wrapper = document.createElementNS(svg.namespaceURI, "g");
  clip.id = "export-map-clip";
  clipRect.setAttribute("width", width);
  clipRect.setAttribute("height", height);
  clip.append(clipRect);
  defs.append(clip);
  svg.append(defs);
  wrapper.setAttribute("clip-path", "url(#export-map-clip)");
  wrapper.append(svg.querySelector("g"));
  svg.append(wrapper);
  addText(
    data.profile.brand + " ATLAS · " + continentName(continent),
    20,
    height + 23,
    13,
  );
  let x = 20,
    y = height + 42;
  data.palette.forEach((p) => {
    const itemWidth =
      22 +
      [...p.label].reduce(
        (sum, c) => sum + (/[^\x00-\xff]/.test(c) ? 9 : 5.5),
        0,
      );
    if (x + itemWidth > width - 20) {
      x = 20;
      y += 21;
    }
    const dot = document.createElementNS(svg.namespaceURI, "rect");
    dot.setAttribute("x", x);
    dot.setAttribute("y", y);
    dot.setAttribute("width", 8);
    dot.setAttribute("height", 8);
    dot.setAttribute("rx", 2);
    dot.setAttribute("fill", p.color);
    svg.append(dot);
    addText(p.label, x + 14, y + 8, 9);
    x += itemWidth + 17;
  });
  const exportHeight = y + 28;
  svg.setAttribute("height", exportHeight);
  svg.setAttribute("viewBox", `0 0 ${width} ${exportHeight}`);
  background.setAttribute("height", exportHeight);
  download(
    new Blob([new XMLSerializer().serializeToString(svg)], {
      type: "image/svg+xml",
    }),
    "travel-atlas-" + continent.replace(/\s/g, "-") + ".svg",
  );
  toast("已导出当前地图视角与图例。");
}

function setBusy(value) {
  busy = value;
  for (const id of [
    "confirm-publish",
    "pull-remote",
    "publish",
    "lock-button",
    "settings-button",
    "security-button",
    "import-button",
    "palette-button",
  ])
    $(id).disabled = value;
  $("editor")
    .querySelectorAll("input,textarea,button")
    .forEach((n) => (n.disabled = value));
  renderDraftStatus();
}
function renderPublishSummary() {
  const diff = diffAtlas(baseline, data),
    box = $("publish-summary");
  box.replaceChildren(
    text(
      "strong",
      diff.total ? diff.total + " 项修改即将发布" : "没有未发布的修改",
    ),
  );
  const list = document.createElement("ul");
  diff.countries.forEach((id) => {
    const before = baseline.countries[id] || EMPTY_RECORD,
      after = record(id);
    const fields = [
      ["status", "颜色"],
      ["date", "日期"],
      ["note", "笔记"],
    ]
      .filter(([key]) => before[key] !== after[key])
      .map(([, label]) => label);
    list.append(
      text("li", info(id).name + " · " + (fields.join("、") || "来源信息")),
    );
  });
  if (diff.palette.length)
    list.append(text("li", diff.palette.length + " 项图例颜色 / 名称"));
  if (diff.profile) list.append(text("li", "主页名称、标题或默认国家"));
  box.append(
    list,
    text("small", "发布前还会检查 GitHub 的最新版本，避免覆盖其他设备的记录。"),
  );
}
function openPublish() {
  if (!api.unlocked) return openAuth();
  flushEditor();
  renderPublishSummary();
  $("publish-message").textContent = "";
  $("commit-link").hidden = true;
  showDialog("publish-dialog");
}
function presentConflicts(plan, remote, continuePublish) {
  conflictPlan = { ...plan, remote, continuePublish };
  const fieldNames = {
    status: "颜色分类",
    date: "旅行日期",
    note: "旅行笔记",
    source: "官方来源",
    checkedAt: "核实日期",
    label: "图例名称",
    color: "图例颜色",
    title: "首页标题",
    subtitle: "首页介绍",
    brand: "地图名称",
    home: "默认国家",
  };
  $("conflict-fields").replaceChildren(
    ...plan.conflicts.map((conflict, index) => {
      const [section, id, field] = conflict.path,
        title =
          (section === "countries"
            ? info(id).name
            : section === "palette"
              ? palette(id).label
              : "主页") +
          " · " +
          fieldNames[field || id],
        block = text("fieldset", "", "conflict-block");
      block.append(text("legend", title));
      for (const choice of ["local", "remote"]) {
        const label = text("label", "", "conflict-choice"),
          input = document.createElement("input"),
          content = text("span", "");
        input.type = "radio";
        input.name = "conflict-" + index;
        input.value = choice;
        input.required = true;
        content.append(
          text(
            "strong",
            choice === "local" ? "保留本机草稿" : "保留 GitHub 版本",
          ),
          document.createTextNode(
            conflict[choice] === undefined
              ? "（未设置）"
              : String(conflict[choice]) || "（空白）",
          ),
        );
        label.append(input, content);
        block.append(label);
      }
      return block;
    }),
  );
  showDialog("conflict-dialog");
}
async function reconcile(continuePublish = false) {
  const file = await api.read(DATA_PATH),
    remote = valid(file.data),
    plan = mergeAtlas(baseline, data, remote);
  if (plan.conflicts.length) {
    presentConflicts(plan, remote, continuePublish);
    return null;
  }
  const hadRemoteChanges = !sameAtlas(baseline, remote);
  if (!sameAtlas(data, plan.data)) {
    snapshot(data, "云端合并前的草稿");
    undoStack.push(clone(data));
    if (undoStack.length > 30) undoStack.shift();
    redoStack = [];
  }
  data = valid(plan.data);
  baseline = clone(remote);
  published = clone(remote);
  persist();
  renderAll();
  renderPublishSummary();
  if (hadRemoteChanges)
    $("publish-message").textContent = "其他设备的修改已安全合并。";
  return file;
}
async function publish() {
  if (busy || !api.unlocked) return;
  flushEditor();
  setBusy(true);
  $("publish-message").textContent = "正在检查并合并 GitHub 最新记录…";
  try {
    const file = await reconcile(true);
    if (!file) return;
    if (!dirty()) {
      $("publish-message").textContent =
        "所有修改已经在 GitHub，无需重复发布。";
      return;
    }
    const next = clone(data);
    next.updatedAt = new Date().toISOString();
    const result = await api.write(
      DATA_PATH,
      valid(next),
      file.sha,
      "Update travel atlas: " + diffAtlas(baseline, next).total + " changes",
    );
    data = next;
    baseline = clone(next);
    published = clone(next);
    pendingDraft = null;
    undoStack = [];
    redoStack = [];
    persist();
    renderAll();
    $("publish-message").textContent = "已提交到 GitHub！正在等待网页更新…";
    $("commit-link").href =
      "https://github.com/" + REPO + "/commit/" + result.commit.sha;
    $("commit-link").hidden = false;
    toast("发布成功，正在等待 GitHub Pages 更新。");
    pollPublished(next);
  } catch (error) {
    $("publish-message").textContent = error.message;
  } finally {
    setBusy(false);
  }
}
async function pullRemote() {
  if (busy || !api.unlocked) return;
  flushEditor();
  setBusy(true);
  $("publish-message").textContent = "正在检查云端更新…";
  try {
    const file = await reconcile(false);
    if (file) {
      $("publish-message").textContent = dirty()
        ? "云端更新已合并。本机仍有待发布草稿。"
        : "已与 GitHub 最新记录同步。";
      toast("云端检查完成，草稿已保留。");
    }
  } catch (error) {
    $("publish-message").textContent = error.message;
  } finally {
    setBusy(false);
  }
}
function pollPublished(expected) {
  clearTimeout(publishPoll);
  let attempts = 0;
  const check = async () => {
    attempts++;
    try {
      const response = await fetch(
        "./data/atlas.json?published=" + Date.now(),
        { cache: "no-store" },
      );
      if (response.ok && sameAtlas(valid(await response.json()), expected)) {
        $("publish-message").textContent =
          "发布完成！GitHub Pages 已显示这次更新。";
        $("save-status").textContent = "已发布 · 网页已更新";
        toast("网页已更新，其他设备可以看到最新地图。");
        return;
      }
    } catch {}
    if (attempts < 24) publishPoll = setTimeout(check, 5000);
    else {
      $("publish-message").textContent =
        "数据已提交到 GitHub。网页构建仍在进行，请稍后刷新查看。";
      $("save-status").textContent = "已提交 · 等待网页构建";
    }
  };
  publishPoll = setTimeout(check, 5000);
}

function wireEvents() {
  $("continents").replaceChildren(
    ...CONTINENTS.map(([id, name]) => {
      const button = text("button", name);
      button.type = "button";
      button.dataset.continent = id;
      button.onclick = () => setContinent(id);
      return button;
    }),
  );
  $("admin-mode").onclick = () => openAuth();
  $("edit-country").onclick = () => openAuth();
  $("security-button").onclick = () => openAuth(true);
  $("lock-button").onclick = () => lock();
  $("unlock-form").onsubmit = unlock;
  $("setup-form").onsubmit = configureAuth;
  $("reset-auth").onclick = () => setupMode(true);
  $("show-password").onchange = () =>
    ($("admin-password").type = $("show-password").checked
      ? "text"
      : "password");
  $("show-new-password").onchange = () => {
    for (const id of ["new-password", "confirm-password"])
      $(id).type = $("show-new-password").checked ? "text" : "password";
  };
  $("generate-password").onclick = () => {
    const password = generatePassword();
    $("new-password").value = password;
    $("confirm-password").value = password;
    $("show-new-password").checked = true;
    for (const id of ["new-password", "confirm-password"]) $(id).type = "text";
    $("password-saved").checked = false;
    $("auth-message").textContent =
      "已生成 24 位随机密码。请先保存到密码管理器，再完成配置。";
  };
  $("auth-dialog").addEventListener("close", clearAuthFields);
  $("auth-dialog").addEventListener("cancel", (event) => {
    if (authBusy) event.preventDefault();
  });
  $("theme-toggle").onclick = () =>
    setTheme(
      document.documentElement.dataset.theme === "dark" ? "light" : "dark",
    );
  $("details-tab").onclick = () => showTab("details");
  $("list-tab").onclick = () => {
    flushEditor();
    showTab("list");
  };
  document.querySelector(".panel-tabs").onkeydown = (event) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      showTab(panel === "details" ? "list" : "details");
      $(panel === "details" ? "details-tab" : "list-tab").focus();
    }
  };
  $("country-search").oninput = search;
  $("country-search").onkeydown = (event) => {
    const buttons = [...$("search-results").querySelectorAll("button")];
    if (event.key === "Escape") {
      hideSearch();
      return;
    }
    if (["ArrowDown", "ArrowUp"].includes(event.key) && buttons.length) {
      event.preventDefault();
      searchIndex =
        (searchIndex + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
        buttons.length;
      buttons.forEach((b, i) =>
        b.setAttribute("aria-current", String(i === searchIndex)),
      );
      buttons[searchIndex].scrollIntoView({ block: "nearest" });
    }
    if (event.key === "Enter" && buttons.length) {
      event.preventDefault();
      buttons[Math.max(0, searchIndex)].click();
    }
  };
  $("list-filter").onchange = renderList;
  $("list-sort").onchange = renderList;
  $("show-labels").onchange = updateLabels;
  $("focus-country").onclick = focusCountry;
  $("zoom-in").onclick = () =>
    d3
      .select("#map")
      .transition()
      .duration(reduceMotion ? 0 : 200)
      .call(zoom.scaleBy, 1.5);
  $("zoom-out").onclick = () =>
    d3
      .select("#map")
      .transition()
      .duration(reduceMotion ? 0 : 200)
      .call(zoom.scaleBy, 1 / 1.5);
  $("zoom-reset").onclick = () =>
    d3
      .select("#map")
      .transition()
      .duration(reduceMotion ? 0 : 200)
      .call(zoom.transform, d3.zoomIdentity);
  $("fullscreen-button").onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if ($("map-card").requestFullscreen)
        await $("map-card").requestFullscreen();
      else toast("此浏览器不支持全屏地图。");
    } catch {
      toast("浏览器未允许进入全屏。");
    }
  };
  $("map-export").onclick = exportMap;
  $("editor").oninput = queueEditor;
  $("editor").onsubmit = (event) => {
    event.preventDefault();
    editorDirty = true;
    flushEditor();
    toast("草稿已保存到本机。");
  };
  $("palette-button").onclick = openPalette;
  $("settings-button").onclick = openSettings;
  $("palette-form").onsubmit = (event) => {
    event.preventDefault();
    const form = new FormData(event.target),
      next = clone(data);
    next.palette = next.palette.map((p) => ({
      ...p,
      color: form.get(p.id + "-color"),
      label: form.get(p.id + "-label").trim(),
    }));
    try {
      change(next);
      $("palette-dialog").close();
      toast("图例已保存为草稿。");
    } catch (error) {
      toast(error.message);
    }
  };
  $("settings-form").onsubmit = (event) => {
    event.preventDefault();
    const next = clone(data);
    next.profile = Object.fromEntries(new FormData(event.target));
    try {
      change(next);
      $("settings-dialog").close();
      toast("主页设置已保存为草稿。");
    } catch (error) {
      toast(error.message);
    }
  };
  $("undo-button").onclick = () => undo();
  $("redo-button").onclick = () => undo(true);
  $("export-button").onclick = exportBackup;
  $("import-button").onclick = () => {
    if (!api.unlocked) return openAuth();
    $("import-file").value = "";
    $("import-file").click();
  };
  $("import-file").onchange = importBackup;
  $("recovery-button").onclick = openRecovery;
  $("publish").onclick = openPublish;
  $("confirm-publish").onclick = publish;
  $("pull-remote").onclick = pullRemote;
  $("conflict-form").onsubmit = (event) => {
    event.preventDefault();
    if (!api.unlocked || !conflictPlan) return;
    const form = new FormData(event.target),
      plan = conflictPlan;
    undoStack.push(clone(data));
    redoStack = [];
    for (const [i, conflict] of plan.conflicts.entries())
      resolveConflict(plan.data, conflict, form.get("conflict-" + i));
    data = valid(plan.data);
    baseline = clone(plan.remote);
    published = clone(plan.remote);
    persist();
    renderAll();
    renderPublishSummary();
    $("conflict-dialog").close();
    conflictPlan = null;
    if (plan.continuePublish) publish();
    else
      $("publish-message").textContent =
        "冲突已解决，选择的记录已保存为本机草稿。";
  };
  $("share-country").onclick = async () => {
    writeLocation();
    try {
      await navigator.clipboard.writeText(location.href);
      toast("已复制国家链接。");
    } catch {
      toast("浏览器未允许复制，请复制地址栏中的链接。");
    }
  };
  $("visited-stat").onclick = () => {
    setContinent("world");
    colorFilter = "visited";
    $("list-filter").value = "all";
    showTab("list");
    renderLegend();
    recolor();
    renderList();
  };
  $("free-stat").onclick = () => {
    setContinent("world");
    colorFilter = "free";
    $("list-filter").value = "all";
    showTab("list");
    renderLegend();
    recolor();
    renderList();
  };
  $("notes-stat").onclick = $("show-journal").onclick = () => {
    flushEditor();
    colorFilter = "";
    setContinent("world");
    $("list-filter").value = "notes";
    $("list-sort").value = "date";
    showTab("list");
  };
  $("credits-button").onclick = () => showDialog("credits-dialog");
  $("notice-dismiss").onclick = () => ($("notice-banner").hidden = true);
  $("retry-button").onclick = () => location.reload();
  document.querySelectorAll("[data-close]").forEach(
    (button) =>
      (button.onclick = () => {
        if (button.dataset.close === "auth-dialog" && authBusy) return;
        $(button.dataset.close).close();
      }),
  );
  document.addEventListener("click", (event) => {
    if (
      !event.target.closest(".search-box") &&
      !event.target.closest("#search-results")
    )
      hideSearch();
  });
  const activity = () => {
    if (api.unlocked && Date.now() - lastActivity >= 15 * 60 * 1000)
      lock("管理已自动锁定，请重新输入密码。");
    lastActivity = Date.now();
  };
  document.addEventListener("keydown", (event) => {
    activity();
    if (
      event.key === "/" &&
      !event.ctrlKey &&
      !event.metaKey &&
      !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) &&
      !document.querySelector("dialog[open]")
    ) {
      event.preventDefault();
      $("country-search").focus();
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "s" && api.unlocked) {
      event.preventDefault();
      flushEditor();
      toast("草稿已保存在本机；点击发布同步到 GitHub。");
    }
  });
  document.addEventListener("pointerdown", activity, { passive: true });
  setInterval(() => {
    if (api.unlocked && Date.now() - lastActivity >= 15 * 60 * 1000)
      lock("闲置 15 分钟，管理已自动锁定；草稿仍在本机。");
  }, 30000);
  document.addEventListener("visibilitychange", () => {
    if (
      document.visibilityState === "visible" &&
      api.unlocked &&
      Date.now() - lastActivity > 15 * 60 * 1000
    )
      lock("管理已自动锁定，请重新输入密码。");
  });
  addEventListener("storage", (event) => {
    if (event.key === LOCAL_KEY && event.newValue)
      notice(
        "另一个标签页更新了本机草稿。建议先备份本页，再刷新以载入另一页的记录。",
      );
  });
  addEventListener("beforeunload", (event) => {
    flushEditor();
    if (storageFailed && dirty()) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(drawMap, 120);
  }).observe($("map-stage"));
  addEventListener("hashchange", () => {
    if (location.hash === "#admin") openAuth();
    else {
      const p = new URLSearchParams(location.hash.slice(1));
      if (info(p.get("country"))) selectCountry(p.get("country"));
    }
  });
}

async function init() {
  try {
    setTheme(
      localStorage.getItem("travel-atlas-theme") ||
        (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
    );
  } catch {
    setTheme("light");
  }
  try {
    const responses = await Promise.all([
      fetch("./data/countries.json"),
      fetch("./data/world.geojson"),
      fetch("./data/atlas.json", { cache: "no-store" }),
    ]);
    if (responses.some((r) => !r.ok))
      throw Error("地图数据加载失败，请检查网络后重试。");
    countries = await responses[0].json();
    geometry = await responses[1].json();
    countryById = new Map(countries.map((c) => [c.id, c]));
    countryIds = new Set(countryById.keys());
    features = new Map(geometry.features.map((f) => [f.properties.id, f]));
    data = valid(await responses[2].json());
    baseline = clone(data);
    published = clone(data);
    try {
      const saved = JSON.parse(
        localStorage.getItem(LOCAL_KEY) ||
          localStorage.getItem(LEGACY_KEY) ||
          "null",
      );
      if (saved) {
        pendingDraft = {
          data: valid(saved.data),
          baseline: valid(saved.baseline),
        };
        if (!sameAtlas(pendingDraft.data, pendingDraft.baseline))
          notice("这台设备有未发布的草稿，输入管理密码后可继续编辑。");
        else pendingDraft = null;
      }
    } catch {
      notice("本机旧草稿无法读取；已保留存储，并载入公开地图。");
    }
    $("setting-home").replaceChildren(
      ...countries.map((c) => {
        const option = text("option", c.name);
        option.value = c.id;
        return option;
      }),
    );
    wireEvents();
    selected = data.profile.home;
    const query = new URLSearchParams(location.hash.slice(1)),
      initialAdmin = location.hash === "#admin";
    if (info(query.get("country"))) selected = query.get("country");
    setContinent(
      query.get("region") || info(selected).continents[0] || "world",
    );
    $("map-loading").hidden = true;
    $("save-status").textContent = "已加载公开地图";
    if (initialAdmin) openAuth();
  } catch (error) {
    $("map-loading").hidden = true;
    $("map-error").hidden = false;
    $("map-error-text").textContent = error.message;
    $("save-status").textContent = "加载失败";
    $("retry-button").onclick = () => location.reload();
  }
}
init();

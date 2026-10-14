// Presentation only: never changes travel records or publishing credentials.
export function createExperience({ getState, navigate, onMotionChange }) {
  const $ = (id) => document.getElementById(id);
  const preference = matchMedia("(prefers-reduced-motion: reduce)");
  let quiet = preference.matches,
    timer,
    playing = false,
    itinerary = [],
    step = 0;
  let lastCountry = "",
    lastGlobe = "",
    lastFootprints = "";
  const animations = new Set();
  const icon = (id, name) =>
    $(id)
      .querySelector("use")
      .setAttribute("href", "#i-" + name);
  const animate = (element, frames, options) => {
    if (quiet || !element?.animate) return;
    const animation = element.animate(frames, options);
    animations.add(animation);
    animation.finished
      .catch(() => {})
      .finally(() => animations.delete(animation));
  };
  const flag = (country) => {
    const letters = [...(country.flag || "")].map(
      (c) => c.codePointAt(0) - 0x1f1e6,
    );
    const image = document.createElement("img");
    image.alt = "";
    image.width = 24;
    image.height = 18;
    if (letters.length !== 2 || letters.some((n) => n < 0 || n > 25))
      return document.createTextNode("↗");
    image.src =
      "./assets/flags/" +
      letters.map((n) => String.fromCharCode(97 + n)).join("") +
      ".svg";
    return image;
  };
  const visited = () => {
    const { countries, data } = getState();
    return countries
      .filter((c) => data?.countries[c.id]?.status === "visited")
      .sort(
        (a, b) =>
          (data.countries[b.id].date || "").localeCompare(
            data.countries[a.id].date || "",
          ) || a.name.localeCompare(b.name, "zh-CN"),
      );
  };
  const showMap = () => {
    $("explore").scrollIntoView({
      behavior: quiet ? "auto" : "smooth",
      block: "start",
    });
  };
  function setMotion(value, save = false) {
    quiet = value;
    document.documentElement.dataset.motion = value ? "quiet" : "full";
    $("motion-toggle").setAttribute("aria-pressed", String(value));
    const label = value ? "开启动效" : "暂停装饰动效";
    $("motion-toggle").setAttribute("aria-label", label);
    $("motion-toggle").title = label;
    icon("motion-toggle", value ? "play" : "pause");
    onMotionChange(value);
    if (value) {
      animations.forEach((animation) => animation.cancel());
      pause();
    }
    if (save)
      try {
        localStorage.setItem("travel-atlas-motion", value ? "quiet" : "full");
      } catch {}
  }
  function pause() {
    clearTimeout(timer);
    playing = false;
    $("tour-bar").classList.remove("playing");
    $("tour-pause").setAttribute("aria-label", "继续漫游");
    icon("tour-pause", "play");
  }
  function schedule() {
    clearTimeout(timer);
    if (!playing || document.hidden) return;
    $("tour-bar").classList.add("playing");
    $("tour-pause").setAttribute("aria-label", "暂停漫游");
    icon("tour-pause", "pause");
    timer = setTimeout(() => {
      if (step >= itinerary.length - 1) {
        pause();
        $("tour-note").textContent = "足迹已看完，下一站等你出发。";
      } else visit(step + 1);
    }, 6000);
  }
  function visit(index) {
    if (!itinerary.length) return;
    step = (index + itinerary.length) % itinerary.length;
    const country = itinerary[step];
    navigate(country.id);
    $("tour-index").textContent =
      String(step + 1).padStart(2, "0") +
      " / " +
      String(itinerary.length).padStart(2, "0");
    $("tour-country").textContent = country.name;
    const r = getState().data.countries[country.id];
    $("tour-note").textContent = r.date || country.english;
    $("tour-progress").style.width =
      ((step + 1) / itinerary.length) * 100 + "%";
    schedule();
  }
  function stop() {
    pause();
    $("tour-bar").hidden = true;
  }
  function start() {
    itinerary = visited();
    if (!itinerary.length) return;
    $("tour-bar").hidden = false;
    playing = !quiet;
    visit(0);
    showMap();
  }
  function renderGlobe() {
    const { geometry, data } = getState();
    if (!geometry || !data) return;
    const key = visited()
      .map((c) => c.id)
      .join(",");
    if (key === lastGlobe && $("hero-globe-land").childElementCount) return;
    lastGlobe = key;
    const projection = d3
      .geoOrthographic()
      .rotate([-18, -22, -12])
      .translate([233, 164])
      .scale(126)
      .precision(1);
    const path = d3.geoPath(projection).digits(1);
    const group = d3.select("#hero-globe-land");
    group
      .selectAll(".globe-land")
      .data(geometry.features)
      .join("path")
      .attr("class", "globe-land")
      .attr("d", path)
      .classed(
        "globe-visited",
        (f) => data.countries[f.properties.id]?.status === "visited",
      );
    group
      .selectAll(".globe-grid")
      .data([d3.geoGraticule().step([30, 30])()])
      .join("path")
      .attr("class", "globe-grid")
      .attr("d", path);
  }
  function render() {
    const places = visited();
    $("start-tour").disabled = !places.length;
    $("discover-country").disabled = !getState().countries.length;
    $("passport-count").textContent = places.length + " 处足迹";
    $("footprint-total").textContent = places.length + " 个国家 / 地区";
    const key = places.map((c) => c.id).join(",");
    if (key !== lastFootprints || !$("footprint-strip").childElementCount) {
      lastFootprints = key;
      const children = places.map((country, index) => {
        const button = document.createElement("button");
        button.className = "footprint-chip";
        button.type = "button";
        button.dataset.place = country.id;
        const number = document.createElement("small");
        number.textContent = String(index + 1).padStart(2, "0");
        const name = document.createElement("span");
        name.textContent = country.name;
        button.append(number, flag(country), name);
        button.onclick = () => {
          stop();
          navigate(country.id);
          showMap();
        };
        return button;
      });
      if (!children.length) {
        const empty = document.createElement("p");
        empty.className = "footprint-empty";
        empty.textContent = "第一处足迹，会是哪里？在地图里标记你的旅程。";
        children.push(empty);
      }
      $("footprint-strip").replaceChildren(...children);
      if (!$("tour-bar").hidden && key !== itinerary.map((c) => c.id).join(","))
        stop();
    }
    renderGlobe();
    selection();
  }
  function selection() {
    const { selected, countries, data, selectedLabel } = getState();
    const country = countries.find((c) => c.id === selected);
    if (!country || !data) return;
    $("peek-flag").replaceChildren(flag(country));
    $("peek-name").textContent = country.name;
    const r = data.countries[selected];
    $("peek-status").textContent =
      selectedLabel ||
      data.palette.find((p) => p.id === r?.status)?.label ||
      "尚未分类";
    document
      .querySelectorAll(".footprint-chip")
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.place === selected),
        ),
      );
    if (lastCountry === selected) return;
    lastCountry = selected;
    animate(
      $("country-panel"),
      [
        { opacity: 0.3, transform: "translateY(8px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 320, easing: "cubic-bezier(.2,.7,.2,1)" },
    );
    animate(
      $("map-country-peek"),
      [
        { opacity: 0.4, transform: "translateY(6px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 350 },
    );
  }
  $("start-tour").onclick = start;
  $("tour-prev").onclick = () => visit(step - 1);
  $("tour-next").onclick = () => visit(step + 1);
  $("tour-pause").onclick = () => {
    if (playing) pause();
    else {
      playing = true;
      schedule();
    }
  };
  $("tour-close").onclick = stop;
  $("discover-country").onclick = () => {
    stop();
    const { countries, selected } = getState();
    const candidates = countries.filter(
      (c) => c.id !== selected && !c.continents.includes("Antarctica"),
    );
    const country = candidates[Math.floor(Math.random() * candidates.length)];
    if (country) {
      navigate(country.id);
      showMap();
    }
  };
  $("map-country-peek").onclick = () => {
    pause();
    $("details-tab").click();
    $("country-panel").scrollIntoView({
      behavior: quiet ? "auto" : "smooth",
      block: "center",
    });
    $("focus-country").focus({ preventScroll: true });
  };
  $("motion-toggle").onclick = () => setMotion(!quiet, true);
  // A manual map action, editing, or opening a dialog always ends automatic advance.
  [
    "continents",
    "map",
    "legend",
    "side-panel",
    "admin-mode",
    "country-search",
    "zoom-in",
    "zoom-out",
    "zoom-reset",
    "visited-stat",
    "free-stat",
    "notes-stat",
    "policy-view",
    "travel-view",
    "policy-date",
  ].forEach((id) => {
    $(id)?.addEventListener("pointerdown", pause, { passive: true });
    $(id)?.addEventListener("keydown", pause);
  });
  document.addEventListener("visibilitychange", () => {
    document.documentElement.classList.toggle("page-hidden", document.hidden);
    if (document.hidden) pause();
  });
  preference.addEventListener("change", (event) => setMotion(event.matches));
  try {
    setMotion(
      preference.matches ||
        localStorage.getItem("travel-atlas-motion") === "quiet",
    );
  } catch {
    setMotion(preference.matches);
  }
  return {
    render,
    selection,
    pause,
    mapTransition() {
      animate($("map"), [{ opacity: 0.25 }, { opacity: 1 }], {
        duration: 500,
        easing: "ease-out",
      });
    },
  };
}

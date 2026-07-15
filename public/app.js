// Supervisório LifeSense — front-end.
// Busca a leitura via função serverless (/api/metam) e renderiza os cards.
// É deliberadamente tolerante ao formato: o shape exato do /last-report do Metam
// é normalizado em { label, value, unit, secondary } antes de exibir.

const REFRESH_MS = 60_000;
const API = "/api/metam";
const params = new URLSearchParams(location.search);
const DEBUG = params.has("debug");

// Medidores exibidos. Os ids batem com a allowlist da função serverless.
// - source "reading": lê /last-report/{id} (custom_fields) — ex.: energia
// - source "supervisory": lê os widgets do dashboard 1940 — ex.: água
const DEVICES = [
  { id: "71987", label: "Energia", icon: "energia", source: "reading" },
  { id: "71961", label: "Água", icon: "agua", source: "supervisory" },
];

const el = (id) => document.getElementById(id);
let chart = null;
let timer = null;
let activeDevice = DEVICES[0];

/* ---------------- utilidades ---------------- */

async function fetchJSON(action, extra = "") {
  const loc = activeDevice ? `&locationId=${encodeURIComponent(activeDevice.id)}` : "";
  const r = await fetch(`${API}?action=${action}${loc}${extra}`, { cache: "no-store" });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Resposta inválida (${r.status}): ${text.slice(0, 120)}`);
  }
  if (!r.ok || data?.error) {
    throw new Error(data?.error || `HTTP ${r.status}`);
  }
  return data;
}

function setStatus(state, text) {
  const s = el("status");
  s.classList.remove("ok", "bad");
  if (state) s.classList.add(state);
  el("statusText").textContent = text;
}

function fmtNumber(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  // até 2 casas, sem zeros à toa
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function nowLabel() {
  return new Date().toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/* ---------------- normalização ---------------- */

// Tenta achar um array de campos dentro de qualquer estrutura devolvida.
function findFieldArray(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return null;
  for (const key of ["fields", "data", "custom_fields", "customFields", "items", "values", "measurements"]) {
    if (Array.isArray(data[key])) return data[key];
  }
  return null;
}

const LABEL_KEYS = ["name", "label", "title", "field", "field_name", "description", "key"];
const VALUE_KEYS = ["value", "val", "last_value", "lastValue", "current", "reading", "measure"];
const UNIT_KEYS = ["unit", "measure", "unit_measure", "unitMeasure", "symbol", "uom"];

function pick(obj, keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  }
  return undefined;
}

// "477.90 W" -> { value: "477.90", unit: "W" } · "0.89  " -> { value: "0.89", unit: "" }
function splitValueUnit(raw) {
  if (raw == null) return { value: "", unit: "" };
  const s = String(raw).trim();
  const m = s.match(/^(-?\d[\d.,]*)\s*(.*)$/);
  if (m) return { value: m[1], unit: (m[2] || "").trim() };
  return { value: s, unit: "" };
}

function normalize(reading) {
  // Formato real do Metam: custom_fields[].reports[0].correct_signal_level ("477.90 W").
  const cf = reading?.custom_fields;
  if (Array.isArray(cf) && cf.length) {
    return cf.map((f) => {
      const label = (f.description || "—").toString().trim();
      const latest =
        Array.isArray(f.reports) && f.reports.length
          ? f.reports[0].correct_signal_level
          : "";
      const { value, unit } = splitValueUnit(latest);
      return { label, value, unit };
    });
  }

  const out = [];
  const arr = findFieldArray(reading);

  if (arr) {
    for (const item of arr) {
      if (item == null) continue;
      if (typeof item !== "object") {
        out.push({ label: String(item), value: "", unit: "" });
        continue;
      }
      const label = pick(item, LABEL_KEYS);
      let value = pick(item, VALUE_KEYS);
      const unit = pick(item, UNIT_KEYS);
      if (value === undefined) {
        // objeto sem chave "value" óbvia: pega o primeiro número
        const numKey = Object.keys(item).find((k) => typeof item[k] === "number");
        if (numKey) value = item[numKey];
      }
      if (label === undefined && value === undefined) continue;
      out.push({
        label: label != null ? String(label) : "—",
        value: value != null ? value : "",
        unit: unit != null ? String(unit) : "",
      });
    }
    return out;
  }

  // Objeto plano: chave → valor primitivo
  if (reading && typeof reading === "object") {
    for (const [k, v] of Object.entries(reading)) {
      if (v == null || typeof v === "object") continue;
      out.push({ label: k, value: v, unit: "" });
    }
  }
  return out;
}

/* ---------------- ícones ---------------- */

const ICONS = {
  consumo: `<path d="M12 2a7 7 0 0 0-7 7c0 3 2 5 3.5 7 .8 1 1.5 2 1.5 3h4c0-1 .7-2 1.5-3C17 14 19 12 19 9a7 7 0 0 0-7-7z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M9 21h6" stroke="currentColor" stroke-width="1.7"/>`,
  vazao: `<path d="M4 8c3-2 5 2 8 0s5-2 8 0M4 14c3-2 5 2 8 0s5-2 8 0M4 20c3-2 5 2 8 0s5-2 8 0" fill="none" stroke="currentColor" stroke-width="1.7"/>`,
  agua: `<path d="M12 3c4 5 6 8 6 11a6 6 0 1 1-12 0c0-3 2-6 6-11z" fill="none" stroke="currentColor" stroke-width="1.7"/>`,
  energia: `<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" fill="none" stroke="currentColor" stroke-width="1.7"/>`,
  tensao: `<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" fill="none" stroke="currentColor" stroke-width="1.7"/>`,
  temperatura: `<path d="M14 14V5a2 2 0 1 0-4 0v9a4 4 0 1 0 4 0z" fill="none" stroke="currentColor" stroke-width="1.7"/>`,
  sinal: `<path d="M4 20v-4M9 20v-8M14 20v-12M19 20V4" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linecap="round"/>`,
  padrao: `<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 8v5l3 2" stroke="currentColor" stroke-width="1.7" fill="none"/>`,
};

function iconFor(label) {
  const l = (label || "").toLowerCase();
  if (l.includes("vaz")) return ICONS.vazao;
  if (l.includes("consum")) return ICONS.consumo;
  if (l.includes("água") || l.includes("agua") || l.includes("litro")) return ICONS.agua;
  if (l.includes("tens") || l.includes("volt")) return ICONS.tensao;
  if (l.includes("energ") || l.includes("pot") || l.includes("kwh") || l.includes("watt")) return ICONS.energia;
  if (l.includes("temp")) return ICONS.temperatura;
  if (l.includes("sinal") || l.includes("rssi") || l.includes("wifi")) return ICONS.sinal;
  return ICONS.padrao;
}

/* ---------------- render ---------------- */

function renderCards(fields) {
  const wrap = el("cards");
  if (!fields.length) {
    wrap.innerHTML = `<div class="banner">Nenhum campo retornado pela API. Abra <a href="?debug=1">?debug=1</a> para ver a resposta bruta.</div>`;
    return;
  }
  wrap.innerHTML = fields
    .map((f) => {
      const value = f.value === "" ? "—" : fmtNumber(f.value);
      const unit = f.unit ? `<span class="c-unit">${escapeHtml(f.unit)}</span>` : "";
      return `
        <div class="card">
          <div class="c-top">
            <span class="c-label">${escapeHtml(f.label)}</span>
            <span class="c-icon"><svg viewBox="0 0 24 24">${iconFor(f.label)}</svg></span>
          </div>
          <div class="c-value">${escapeHtml(value)}${unit}</div>
        </div>`;
    })
    .join("");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

/* ---------------- histórico (gráfico) ---------------- */

async function ensureChartJs() {
  if (window.Chart) return true;
  try {
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js";
      s.onload = resolve;
      s.onerror = () => reject(new Error("Falha ao carregar Chart.js"));
      document.head.appendChild(s);
    });
    return true;
  } catch {
    return false;
  }
}

// "15/07/2026 18:01:00" -> "18:01"
function shortTime(metamDate) {
  const m = String(metamDate || "").match(/(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : String(metamDate || "");
}

const CHART_PRIORITY = ["consum", "energia", "potenc", "vaz"];

// Escolhe um campo interessante e monta a série a partir dos reports embutidos.
function buildSeries(reading) {
  const cf = reading?.custom_fields;
  if (!Array.isArray(cf) || !cf.length) return null;

  const usable = cf.filter((f) => Array.isArray(f.reports) && f.reports.length >= 2);
  if (!usable.length) return null;

  let chosen = null;
  for (const key of CHART_PRIORITY) {
    chosen = usable.find((f) => (f.description || "").toLowerCase().includes(key));
    if (chosen) break;
  }
  if (!chosen) chosen = usable[0];

  // reports vêm do mais recente para o mais antigo -> inverter para cronológico
  const rows = [...chosen.reports].reverse();
  const points = rows
    .map((r) => {
      const { value } = splitValueUnit(r.correct_signal_level);
      const y = Number(String(value).replace(",", "."));
      return Number.isFinite(y) ? { x: shortTime(r.report_date), y } : null;
    })
    .filter(Boolean);

  return points.length ? { label: (chosen.description || "").trim(), points } : null;
}

// Desenha o gráfico a partir de uma série { label, points:[{x,y}] } (qualquer fonte).
async function drawChart(series) {
  if (!series || !series.points?.length) {
    el("chartCard").hidden = true;
    return;
  }
  if (!(await ensureChartJs())) return;

  el("chartCard").hidden = false;
  el("chartSub").textContent = `${series.label} · ${series.points.length} leituras`;
  const ctx = el("historyChart").getContext("2d");
  const labels = series.points.map((p) => p.x);
  const data = series.points.map((p) => p.y);

  if (chart) chart.destroy();
  chart = new window.Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          data,
          borderColor: "#844fff",
          backgroundColor: "rgba(132,79,255,0.15)",
          borderWidth: 2,
          fill: true,
          tension: 0.35,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#8b93a6", maxTicksLimit: 8 }, grid: { color: "rgba(34,48,80,0.4)" } },
        y: { ticks: { color: "#8b93a6" }, grid: { color: "rgba(34,48,80,0.4)" } },
      },
    },
  });
}

/* ---------------- carregadores por fonte ---------------- */

// Fonte "reading": medidor via /last-report (custom_fields). Ex.: energia.
async function loadReading() {
  const reading = await fetchJSON("reading");
  return {
    fields: normalize(reading),
    series: buildSeries(reading),
    name:
      reading?.installation_location_description ||
      reading?.client_name ||
      "Dispositivo",
    sub: reading?.client_name
      ? `${reading.client_name} · IMEI ${reading?.imei || "—"}`
      : "LifeSense · leitura em tempo real",
    last: reading?.last_report_date || nowLabel(),
    debug: reading,
  };
}

// Fonte "supervisory": dashboard 1940 (widgets). Ex.: água.
async function loadSupervisory() {
  const sup = await fetchJSON("supervisory");
  const widgets = Array.isArray(sup?.widgets) ? sup.widgets : [];

  // cards = widgets de valor atual
  const valueWidgets = widgets.filter((w) => /current_value/.test(w.widget_type || ""));
  const cards = await Promise.all(
    valueWidgets.map(async (w) => {
      try {
        const wd = await fetchJSON("widget", `&widgetId=${w.id}`);
        return {
          label: wd.description || w.description || "—",
          value: wd.data?.value ?? "",
          unit: wd.data?.unit || "",
        };
      } catch {
        return { label: w.description || "—", value: "", unit: "" };
      }
    })
  );

  // gráfico = primeiro widget de linha com chart_data
  let series = null;
  const lineWidget = widgets.find((w) => /line_chart/.test(w.widget_type || ""));
  if (lineWidget) {
    try {
      const wd = await fetchJSON("widget", `&widgetId=${lineWidget.id}`);
      const cd = wd.data?.chart_data;
      if (Array.isArray(cd) && cd.length) {
        series = {
          label: wd.description || "Histórico",
          points: cd.map((p) => ({
            x: shortTime(p.datetime),
            y: Number(p.value) || 0,
          })),
        };
      }
    } catch {
      /* gráfico opcional */
    }
  }

  const last = valueWidgets[0]?.last_report || sup?.last_report || nowLabel();
  return {
    fields: cards,
    series,
    name: activeDevice.label,
    sub: sup?.description ? `${sup.description}` : "LifeSense · supervisório",
    last,
    debug: sup,
  };
}

/* ---------------- ciclo principal ---------------- */

async function refresh() {
  try {
    const result =
      activeDevice.source === "supervisory"
        ? await loadSupervisory()
        : await loadReading();

    renderCards(result.fields);
    drawChart(result.series);
    el("deviceName").textContent = result.name;
    el("deviceSub").textContent = result.sub;
    el("lastUpdate").textContent = result.last;
    setStatus("ok", "Online");
    document.querySelector(".banner.live")?.remove();

    if (DEBUG) el("rawJson").textContent = JSON.stringify(result.debug, null, 2);
  } catch (e) {
    setStatus("bad", "Falha na leitura");
    showError(e.message);
    if (DEBUG) el("rawJson").textContent = "ERRO: " + e.message;
  }
}

function showError(msg) {
  let b = document.querySelector(".banner.live");
  if (!b) {
    b = document.createElement("div");
    b.className = "banner live";
    el("cards").before(b);
  }
  b.textContent = "Erro: " + msg;
}

function renderTabs() {
  const nav = el("tabs");
  if (!nav || DEVICES.length < 2) return; // 1 device só: sem abas
  nav.innerHTML = DEVICES.map(
    (d, i) => `
      <button type="button" class="tab${i === 0 ? " active" : ""}" data-id="${d.id}">
        <svg class="t-icon" viewBox="0 0 24 24">${ICONS[d.icon] || ICONS.padrao}</svg>
        ${escapeHtml(d.label)}
      </button>`
  ).join("");

  nav.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    const dev = DEVICES.find((d) => d.id === btn.dataset.id);
    if (!dev || dev === activeDevice) return;
    activeDevice = dev;
    nav.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === btn));

    // estado de carregando ao trocar
    el("cards").innerHTML = '<div class="card skeleton"></div>'.repeat(4);
    el("chartCard").hidden = true;
    el("deviceName").textContent = "Carregando…";
    refresh();
  });
}

function init() {
  el("intervalLabel").textContent = String(REFRESH_MS / 1000);
  if (DEBUG) el("debug").hidden = false;

  el("copyRaw")?.addEventListener("click", () => {
    navigator.clipboard?.writeText(el("rawJson").textContent || "");
  });

  renderTabs();
  refresh(); // refresh() já alimenta cards e gráfico com a mesma leitura
  timer = setInterval(refresh, REFRESH_MS);

  // pausa quando a aba não está visível (economia)
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearInterval(timer);
    } else {
      refresh();
      timer = setInterval(refresh, REFRESH_MS);
    }
  });
}

init();

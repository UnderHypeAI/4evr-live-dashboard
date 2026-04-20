// 4EVR Live Dashboard — app.js
// Vanilla JS. Chart.js via CDN. No build step.
(function () {
  "use strict";

  const CFG = window.DASHBOARD_CONFIG;
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // ---------- state ----------
  const state = {
    adminSecret: null,
    range: "day",
    histogramChart: null,
    pollTimer: null,
    progressTimer: null,
    progressStart: 0,
    lastFetchAt: null,
    lastOk: false,
    tickingRelativeTimes: null,
    lastData: null,
  };

  // ---------- small helpers ----------
  function fmtInt(n) {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
    return Number(n).toLocaleString("en-US");
  }
  function fmtUSD(n) {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
    return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtSats(n) {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
    return fmtInt(n) + " sats";
  }
  function fmtPct(n) {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
    return (Number(n) * 100).toFixed(1) + "%";
  }
  function relTime(iso) {
    if (!iso) return "—";
    const ts = typeof iso === "number" ? iso : Date.parse(iso);
    if (!ts) return "—";
    const diff = (Date.now() - ts) / 1000;
    if (diff < 5) return "now";
    if (diff < 60) return Math.floor(diff) + "s ago";
    if (diff < 3600) return Math.floor(diff / 60) + "m ago";
    if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
    return Math.floor(diff / 86400) + "d ago";
  }
  function toast(msg, kind) {
    const host = $("#toasts");
    const el = document.createElement("div");
    el.className = "toast" + (kind ? " " + kind : "");
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 220); }, 4000);
  }

  // ---------- gate ----------
  function showGate(msg) {
    $("#app").classList.add("hidden");
    $("#gate").classList.remove("hidden");
    $("#gate").setAttribute("aria-hidden", "false");
    $("#gate-error").textContent = msg || "";
    setTimeout(() => $("#gate-input") && $("#gate-input").focus(), 30);
  }
  function hideGate() {
    $("#gate").classList.add("hidden");
    $("#gate").setAttribute("aria-hidden", "true");
    $("#app").classList.remove("hidden");
  }

  async function testSecret(secret) {
    // Validate by hitting /api/admin/dashboard-metrics?range=day with x-admin-secret.
    // 200 => valid. 401/403 => invalid. Anything else (network/CORS/404) => accept
    // the secret so Aaron can see the layout until the backend is ready.
    const url = CFG.API_BASE + CFG.DASHBOARD_ENDPOINT + "?range=day";
    try {
      const r = await fetch(url, { headers: { "x-admin-secret": secret } });
      if (r.status === 401 || r.status === 403) return { ok: false, reason: "Invalid secret" };
      if (r.status === 200) return { ok: true };
      // 404/500/etc: backend not ready. Still accept so layout renders.
      return { ok: true, warn: "Backend responded " + r.status + " — layout will render with placeholders." };
    } catch (e) {
      // Network/CORS error. Accept so user still sees layout.
      return { ok: true, warn: "Backend unreachable (CORS or offline). Layout will render with placeholders." };
    }
  }

  async function onGateSubmit(ev) {
    ev.preventDefault();
    const val = $("#gate-input").value.trim();
    if (!val) return;
    $("#gate-btn").disabled = true;
    $("#gate-error").textContent = "";
    const res = await testSecret(val);
    $("#gate-btn").disabled = false;
    if (!res.ok) {
      $("#gate-error").textContent = res.reason || "Invalid";
      return;
    }
    sessionStorage.setItem(CFG.SESSION_KEY, val);
    state.adminSecret = val;
    if (res.warn) toast(res.warn);
    hideGate();
    start();
  }

  function logout() {
    sessionStorage.removeItem(CFG.SESSION_KEY);
    state.adminSecret = null;
    stopPolling();
    showGate("Logged out.");
    $("#gate-input").value = "";
  }

  // ---------- fetch + render ----------
  async function fetchMetrics(range) {
    const url = CFG.API_BASE + CFG.DASHBOARD_ENDPOINT + "?range=" + encodeURIComponent(range);
    const res = await fetch(url, { headers: { "x-admin-secret": state.adminSecret } });
    if (res.status === 401 || res.status === 403) {
      throw Object.assign(new Error("unauthorized"), { kind: "auth" });
    }
    if (!res.ok) {
      throw Object.assign(new Error("HTTP " + res.status), { kind: "http", status: res.status });
    }
    return res.json();
  }

  function setStatus(kind, label) {
    const dot = $("#status-dot");
    dot.classList.remove("ok", "stale", "err");
    if (kind) dot.classList.add(kind);
    $("#backend-state").textContent = label || "";
  }

  function updateLastUpdated() {
    $("#last-updated").textContent = state.lastFetchAt ? relTime(state.lastFetchAt) : "—";
  }

  // ---------- renderers ----------
  function renderPlaceholder(reason) {
    // Render the full layout with em-dashes/placeholders.
    ["kpi-live", "kpi-today", "kpi-decls", "kpi-rev"].forEach((id) => { $("#" + id).textContent = "—"; });
    $("#kpi-live-sub").textContent = "last 5 min";
    $("#kpi-today-sub").textContent = "visitors · GA4";
    $("#kpi-decls-sub").textContent = "paid + confirmed";
    $("#kpi-rev-sub").textContent = "USD";

    $("#histogram-empty").textContent = reason || "Backend not yet deployed";
    $("#histogram-empty").classList.remove("hidden");
    if (state.histogramChart) {
      state.histogramChart.data.labels = [];
      state.histogramChart.data.datasets.forEach((d) => d.data = []);
      state.histogramChart.update();
    }

    ["#pages-table tbody", "#sources-table tbody", "#affiliates-table tbody"].forEach((sel) => {
      const tbody = $(sel);
      const cols = $(sel.replace(" tbody", " thead tr")).children.length;
      tbody.innerHTML = `<tr class="empty"><td colspan="${cols}">${reason || "Backend not yet deployed"}</td></tr>`;
    });
    $("#funnel").innerHTML = `<div class="funnel-empty">${reason || "Backend not yet deployed"}</div>`;
    $("#feed").innerHTML = `<li class="feed-empty">${reason || "Backend not yet deployed"}</li>`;
  }

  function renderKPIs(d) {
    const kpi = d.kpi || {};
    $("#kpi-live").textContent = fmtInt(kpi.live_visitors);
    $("#kpi-live-sub").textContent = "last 5 min" + (kpi.live_visitors_delta != null ? " · Δ " + kpi.live_visitors_delta : "");

    $("#kpi-today").textContent = fmtInt(kpi.today_visitors);
    const tsub = [];
    tsub.push("visitors · GA4");
    if (kpi.today_visitors_delta_vs_yesterday != null) {
      const d2 = kpi.today_visitors_delta_vs_yesterday;
      tsub.push((d2 >= 0 ? "+" : "") + fmtInt(d2) + " vs yest");
    }
    $("#kpi-today-sub").textContent = tsub.join(" · ");

    $("#kpi-decls").textContent = fmtInt(kpi.today_declarations);
    const dsub = [];
    dsub.push("paid + confirmed");
    if (kpi.today_started_unpaid != null) dsub.push(fmtInt(kpi.today_started_unpaid) + " started/unpaid");
    $("#kpi-decls-sub").textContent = dsub.join(" · ");

    $("#kpi-rev").textContent = fmtUSD(kpi.today_revenue_usd);
    const rsub = [];
    if (kpi.today_revenue_sats != null) rsub.push(fmtSats(kpi.today_revenue_sats));
    if (kpi.today_revenue_delta_usd != null) {
      const d2 = kpi.today_revenue_delta_usd;
      rsub.push((d2 >= 0 ? "+" : "") + fmtUSD(Math.abs(d2)) + " vs yest");
    }
    $("#kpi-rev-sub").textContent = rsub.length ? rsub.join(" · ") : "USD";
  }

  function ensureChart() {
    if (state.histogramChart) return state.histogramChart;
    const ctx = document.getElementById("histogram").getContext("2d");
    Chart.defaults.color = "#888";
    Chart.defaults.font.family = "ui-monospace, SF Mono, Menlo, Consolas, monospace";
    state.histogramChart = new Chart(ctx, {
      type: "bar",
      data: {
        labels: [],
        datasets: [
          {
            label: "Visitors",
            data: [],
            backgroundColor: "#f7931a",
            borderRadius: 2,
            borderSkipped: false,
            maxBarThickness: 28,
          },
          {
            label: "Comparison",
            data: [],
            type: "line",
            borderColor: "#555",
            backgroundColor: "transparent",
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.25,
            hidden: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#1c1c1c",
            borderColor: "#262626",
            borderWidth: 1,
            titleColor: "#e5e5e5",
            bodyColor: "#e5e5e5",
            callbacks: {
              afterBody(items) {
                const i = items[0]?.dataIndex;
                if (i == null) return "";
                const meta = state._histMeta || [];
                const row = meta[i];
                if (!row) return "";
                const parts = [];
                if (row.sessions != null) parts.push("sessions: " + fmtInt(row.sessions));
                if (row.pageviews != null) parts.push("pageviews: " + fmtInt(row.pageviews));
                return parts.join("\n");
              },
            },
          },
        },
        scales: {
          x: { grid: { color: "#1c1c1c", drawBorder: false }, ticks: { color: "#888", maxRotation: 0 } },
          y: { grid: { color: "#1c1c1c", drawBorder: false }, ticks: { color: "#888", precision: 0 }, beginAtZero: true },
        },
      },
    });
    return state.histogramChart;
  }

  function renderHistogram(d) {
    const hist = d.histogram || {};
    const buckets = hist.buckets || [];
    const compare = hist.compare || null;
    if (!buckets.length) {
      $("#histogram-empty").textContent = "No data yet";
      $("#histogram-empty").classList.remove("hidden");
      return;
    }
    $("#histogram-empty").classList.add("hidden");
    const chart = ensureChart();
    chart.data.labels = buckets.map((b) => b.label);
    chart.data.datasets[0].data = buckets.map((b) => b.visitors ?? 0);
    state._histMeta = buckets;
    if (compare && Array.isArray(compare) && compare.length) {
      chart.data.datasets[1].data = compare.map((b) => b.visitors ?? 0);
      chart.data.datasets[1].hidden = false;
    } else {
      chart.data.datasets[1].data = [];
      chart.data.datasets[1].hidden = true;
    }
    chart.update();
  }

  function renderPages(d) {
    const rows = d.top_pages || [];
    const tbody = $("#pages-table tbody");
    if (!rows.length) { tbody.innerHTML = `<tr class="empty"><td colspan="4">No data</td></tr>`; return; }
    tbody.innerHTML = rows.slice(0, 10).map((r) => `
      <tr>
        <td>${escapeHtml(r.path || "—")}</td>
        <td class="num">${fmtInt(r.views)}</td>
        <td class="num">${fmtInt(r.uniques ?? r.unique_visitors)}</td>
        <td class="num">${r.avg_engagement_sec != null ? Number(r.avg_engagement_sec).toFixed(1) : "—"}</td>
      </tr>
    `).join("");
  }

  function renderSources(d) {
    const rows = d.traffic_sources || [];
    const tbody = $("#sources-table tbody");
    if (!rows.length) { tbody.innerHTML = `<tr class="empty"><td colspan="4">No data</td></tr>`; return; }
    tbody.innerHTML = rows.slice(0, 10).map((r) => `
      <tr>
        <td>${escapeHtml(r.source_medium || r.source || "—")}</td>
        <td class="num">${fmtInt(r.visitors)}</td>
        <td class="num">${fmtInt(r.paid_declarations)}</td>
        <td class="num">${fmtUSD(r.revenue_usd)}</td>
      </tr>
    `).join("");
  }

  function renderFunnel(d) {
    const f = d.funnel;
    const host = $("#funnel");
    if (!f) { host.innerHTML = `<div class="funnel-empty">No funnel data</div>`; return; }
    const steps = [
      { key: "visited", label: "Visited" },
      { key: "declaration_view", label: "Decl. viewed" },
      { key: "started", label: "Started" },
      { key: "paid", label: "Paid" },
      { key: "confirmed", label: "Confirmed" },
    ];
    const counts = steps.map((s) => Number(f[s.key] ?? 0));
    const max = Math.max(1, counts[0]);
    const html = steps.map((s, i) => {
      const c = counts[i];
      const prev = i === 0 ? null : counts[i - 1];
      const pct = prev ? c / prev : null;
      const widthPct = Math.max(2, (c / max) * 100);
      const isLast = i === steps.length - 1;
      return `
        <div class="funnel-row">
          <div class="funnel-label">${s.label}</div>
          <div class="funnel-bar"><div class="funnel-bar-fill ${isLast ? "" : "dim"}" style="width:${widthPct}%"></div></div>
          <div class="funnel-count mono">${fmtInt(c)}</div>
          <div class="funnel-pct mono">${pct == null ? "" : fmtPct(pct)}</div>
        </div>
      `;
    }).join("");
    host.innerHTML = html;
  }

  function renderAffiliates(d) {
    const rows = (d.affiliates || []).slice().sort((a, b) => Number(b.revenue_usd || 0) - Number(a.revenue_usd || 0));
    const tbody = $("#affiliates-table tbody");
    if (!rows.length) { tbody.innerHTML = `<tr class="empty"><td colspan="5">No affiliate activity</td></tr>`; return; }
    tbody.innerHTML = rows.map((r) => {
      const rev = Number(r.revenue_usd || 0);
      const commission = r.commission_usd != null ? Number(r.commission_usd) : rev * 0.15;
      return `
        <tr>
          <td>${escapeHtml(r.code || "—")}</td>
          <td class="num">${fmtInt(r.visitors)}</td>
          <td class="num">${fmtInt(r.paid_declarations)}</td>
          <td class="num">${fmtUSD(rev)}</td>
          <td class="num">${fmtUSD(commission)}</td>
        </tr>
      `;
    }).join("");
  }

  function renderFeed(d) {
    const rows = (d.recent_events || []).slice(0, 20);
    const host = $("#feed");
    if (!rows.length) { host.innerHTML = `<li class="feed-empty">No recent events</li>`; return; }
    host.innerHTML = rows.map((e) => {
      const kind = (e.type || e.kind || "default").toLowerCase();
      const dotClass = ["paid", "confirmed", "started", "view"].includes(kind) ? kind : "default";
      const label = escapeHtml(e.label || e.message || e.path || "—");
      return `
        <li class="feed-item" data-ts="${escapeAttr(e.ts || e.timestamp || "")}">
          <div class="feed-dot ${dotClass}"></div>
          <div class="feed-label"><span class="feed-kind">${escapeHtml(kind)}</span>${label}</div>
          <div class="feed-time mono">${relTime(e.ts || e.timestamp)}</div>
        </li>
      `;
    }).join("");
  }

  function escapeHtml(s) {
    if (s == null) return "";
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  function renderAll(d) {
    renderKPIs(d);
    renderHistogram(d);
    renderPages(d);
    renderSources(d);
    renderFunnel(d);
    renderAffiliates(d);
    renderFeed(d);
  }

  // ---------- poll loop ----------
  async function tick(opts) {
    const isImmediate = !!(opts && opts.immediate);
    try {
      setStatus(state.lastOk ? "ok" : null, "fetching…");
      const data = await fetchMetrics(state.range);
      state.lastData = data;
      state.lastFetchAt = Date.now();
      state.lastOk = true;
      renderAll(data);
      setStatus("ok", "live");
      updateLastUpdated();
    } catch (err) {
      if (err.kind === "auth") {
        toast("Admin secret rejected. Please sign in again.", "err");
        logout();
        return;
      }
      setStatus(state.lastData ? "stale" : "err", state.lastData ? "stale" : "offline");
      if (!state.lastData) {
        renderPlaceholder("Backend not reachable (" + (err.message || "error") + ")");
      }
      if (isImmediate) toast("Fetch failed: " + err.message, "err");
    } finally {
      if (!isImmediate) resetProgress();
    }
  }

  function startProgress() {
    stopProgress();
    state.progressStart = Date.now();
    const fill = $("#progress-fill");
    state.progressTimer = setInterval(() => {
      const elapsed = Date.now() - state.progressStart;
      const pct = Math.min(100, (elapsed / CFG.POLL_INTERVAL_MS) * 100);
      fill.style.width = pct + "%";
    }, 200);
  }
  function stopProgress() {
    if (state.progressTimer) { clearInterval(state.progressTimer); state.progressTimer = null; }
  }
  function resetProgress() {
    stopProgress();
    $("#progress-fill").style.width = "0%";
    startProgress();
  }

  function startPolling() {
    stopPolling();
    startProgress();
    state.pollTimer = setInterval(() => tick({ immediate: false }), CFG.POLL_INTERVAL_MS);
  }
  function stopPolling() {
    if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
    stopProgress();
  }

  function startRelativeTimeTicker() {
    if (state.tickingRelativeTimes) return;
    state.tickingRelativeTimes = setInterval(() => {
      updateLastUpdated();
      // update feed timestamps
      $$("#feed .feed-item").forEach((el) => {
        const ts = el.getAttribute("data-ts");
        const timeEl = el.querySelector(".feed-time");
        if (ts && timeEl) timeEl.textContent = relTime(ts);
      });
    }, 1000);
  }

  function onRangeTab(ev) {
    const btn = ev.target.closest(".tab");
    if (!btn) return;
    const range = btn.getAttribute("data-range");
    if (!range || range === state.range) return;
    state.range = range;
    $$("#range-tabs .tab").forEach((t) => t.classList.toggle("active", t === btn));
    tick({ immediate: true }).then(() => { if (document.hasFocus()) startPolling(); });
  }

  function onVisibility() {
    if (document.hidden) {
      stopPolling();
      setStatus(state.lastOk ? "stale" : null, "paused");
    } else if (state.adminSecret) {
      tick({ immediate: true }).then(() => startPolling());
    }
  }
  function onBlur() {
    stopPolling();
    if (state.lastOk) setStatus("stale", "paused");
  }
  function onFocus() {
    if (!state.adminSecret) return;
    tick({ immediate: true }).then(() => startPolling());
  }

  function start() {
    $("#footer-endpoint").textContent = CFG.API_BASE + CFG.DASHBOARD_ENDPOINT;
    ensureChart();
    renderPlaceholder();
    tick({ immediate: true }).then(() => startPolling());
    startRelativeTimeTicker();
  }

  // ---------- init ----------
  function init() {
    $("#gate-form").addEventListener("submit", onGateSubmit);
    $("#logout-btn").addEventListener("click", logout);
    $("#range-tabs").addEventListener("click", onRangeTab);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);

    const stored = sessionStorage.getItem(CFG.SESSION_KEY);
    if (stored) {
      state.adminSecret = stored;
      hideGate();
      start();
    } else {
      showGate();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

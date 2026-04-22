const app = document.getElementById("app");

/** 与 scripts/start-dev.sh 中 BACKEND_PORT 一致。__API_ORIGIN__ 可写为 http://host:8080 或带末尾的 /api（会规范化，避免 /api/api 导致 404） */
const API_PORT = (() => {
  const x = window.__API_PORT__;
  if (x == null || x === "") return 8080;
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? n : 8080;
})();

function inferApiOrigin() {
  if (window.__API_ORIGIN__) {
    let s = String(window.__API_ORIGIN__).replace(/\/$/, "");
    if (s.toLowerCase().endsWith("/api")) {
      s = s.slice(0, -4);
      s = s.replace(/\/$/, "");
    }
    return s;
  }
  const host = window.location.hostname;
  const proto = window.location.protocol;
  if (host && (proto === "http:" || proto === "https:")) {
    const p = proto === "https:" ? "https:" : "http:";
    return `${p}//${host}:${API_PORT}`.replace(/\/$/, "");
  }
  return `http://127.0.0.1:${API_PORT}`;
}

const API_ORIGIN = inferApiOrigin();
const API_BASE = `${API_ORIGIN}/api`;

const IMPORT_LAST_BATCH_KEY = "smart_route_import_last_batch";
const IMPORT_LIST_VIEW_TYPE_KEY = "smart_route_import_list_view_type";

function getLastBatchIds() {
  try {
    const raw = sessionStorage.getItem(IMPORT_LAST_BATCH_KEY);
    if (!raw) return { system: null, manual: null };
    const o = JSON.parse(raw);
    return { system: o.system || null, manual: o.manual || null };
  } catch {
    return { system: null, manual: null };
  }
}

function setLastBatchId(type, batchId) {
  const cur = getLastBatchIds();
  cur[type] = batchId;
  sessionStorage.setItem(IMPORT_LAST_BATCH_KEY, JSON.stringify(cur));
}

function setImportListViewType(type) {
  sessionStorage.setItem(IMPORT_LIST_VIEW_TYPE_KEY, type);
}

function getImportListViewType() {
  return sessionStorage.getItem(IMPORT_LIST_VIEW_TYPE_KEY) || "system";
}

function backendUnreachableHtml(err) {
  const detail = err && err.message ? `（${err.message}）` : "";
  const isFetchFail = /failed to fetch|networkerror|load failed/i.test(detail);
  const corsHint = isFetchFail
    ? `<br/><small>请先在新标签打开 <a href="${API_ORIGIN}/health" target="_blank" rel="noopener">${API_ORIGIN}/health</a>（应与地址栏主机一致）。不要用「文件」双击打开 HTML。若改过后端端口，在 <code>index.html</code> 里于 main.js 之前设置 <code>window.__API_PORT__</code> 或 <code>window.__API_ORIGIN__</code>。</small>`
    : "";
  return `<div class="alert alert--error">
    <strong>无法连接后端</strong>${detail}<br/>
    1）在项目根目录执行：<code>./scripts/start-dev.sh</code>（前后端一起启动）<br/>
    2）或仅后端：<code>cd backend &amp;&amp; source .venv/bin/activate &amp;&amp; uvicorn app.main:app --host 0.0.0.0 --port 8080</code><br/>
    3）浏览器打开自检：<a href="${API_ORIGIN}/health" target="_blank" rel="noopener">${API_ORIGIN}/health</a> 应返回 <code>{"status":"ok"}</code>${corsHint}<br/>
    <small>默认接口端口为 8080。页面会用<strong>当前网址的主机名</strong>访问后端（局域网打开页面时会连同一台电脑的 8080）。若改端口请设置 <code>window.__API_PORT__</code> 或 <code>window.__API_ORIGIN__</code>。</small>
  </div>`;
}

function escapeHtml(s) {
  if (s == null || s === "") return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const IMPORT_LIST_TABLE_HEADERS = [
  "ID",
  "排线日期",
  "运单号",
  "线路",
  "仓库",
  "门店",
  "车型",
  "体积",
  "装载率",
  "预估里程",
  "预估时效",
];

function renderImportListTableRowsOnly(rows) {
  const head = IMPORT_LIST_TABLE_HEADERS.map((t) => `<th>${escapeHtml(t)}</th>`).join("");
  const body = (rows || [])
    .map((r) => {
      const cells = [
        r.id,
        r.route_date ?? "",
        r.waybill_no ?? "",
        r.route_line ?? "",
        r.warehouse_name ?? "",
        r.stores ?? "",
        r.vehicle_type ?? "",
        r.volume ?? "",
        r.load_rate ?? "",
        r.est_distance ?? "",
        r.est_duration ?? "",
      ];
      return `<tr>${cells.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`;
    })
    .join("");
  return `<div class="table-scroll">
      <table class="data-table">
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

function datasetTypeLabel(v) {
  return v === "system" ? "系统建议数据" : "手动排线数据";
}

function buildImportListPanelHtml({
  selectedDatasetType,
  page,
  pageSize,
  payload,
  queryMode = "batch",
  dateFrom = "",
  dateTo = "",
}) {
  const mode = queryMode === "range" ? "range" : "batch";
  const safeFrom = dateFrom || "";
  const safeTo = dateTo || "";
  const total = Number(payload.total) || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const label = datasetTypeLabel(selectedDatasetType);
  const items = Array.isArray(payload.items) ? payload.items : [];
  const tableInner =
    total === 0
      ? mode === "range"
        ? `<p class="empty-hint">该排线日期范围内无有效数据。</p>`
        : `<p class="empty-hint">本批无明细行。</p>`
      : items.length === 0
        ? `<p class="empty-hint">本页无数据。</p>`
        : renderImportListTableRowsOnly(items);
  const rangeSummary =
    mode === "range" && safeFrom && safeTo
      ? ` · 排线 ${escapeHtml(safeFrom)}～${escapeHtml(safeTo)}`
      : mode === "batch"
        ? " · 本批"
        : "";
  return `<div id="importListPanel" class="import-list-panel" data-query-mode="${mode}" data-date-from="${escapeHtml(
    safeFrom
  )}" data-date-to="${escapeHtml(safeTo)}" data-page="${page}" data-total="${total}">
      <p class="page-head" style="margin-top:1rem;margin-bottom:0.5rem"><strong>导入明细列表</strong><br/><small class="empty-hint" style="font-size:0.9em">仅展示当前有效数据（覆盖导入后旧批次自动失效）。</small></p>
      <div class="toolbar import-list-toolbar">
        <div class="field">
          <span class="field-label">列表数据类型</span>
          <select id="importListSource">
            <option value="system" ${selectedDatasetType === "system" ? "selected" : ""}>系统建议数据</option>
            <option value="manual" ${selectedDatasetType === "manual" ? "selected" : ""}>手动排线数据</option>
          </select>
        </div>
        <div class="field">
          <span class="field-label">排线日期起</span>
          <input type="date" id="importListDateFrom" value="${escapeHtml(safeFrom)}" />
        </div>
        <div class="field">
          <span class="field-label">排线日期止</span>
          <input type="date" id="importListDateTo" value="${escapeHtml(safeTo)}" />
        </div>
        <button type="button" class="btn btn--primary" id="importListQueryBtn">查询</button>
        <button type="button" class="btn btn--secondary" id="importListManualCalcBtn" ${
          selectedDatasetType !== "manual" ? "hidden" : ""
        }>补算预估里程/时效</button>
        <div class="field">
          <span class="field-label">每页</span>
          <select id="importListPageSize">
            <option value="20" ${pageSize === 20 ? "selected" : ""}>20 条</option>
            <option value="50" ${pageSize === 50 ? "selected" : ""}>50 条</option>
          </select>
        </div>
        <button type="button" class="btn btn--secondary" id="importListPrev" ${page <= 1 ? "disabled" : ""}>上一页</button>
        <button type="button" class="btn btn--primary" id="importListNext" ${
          page >= totalPages ? "disabled" : ""
        }>下一页</button>
      </div>
      <p id="importListSummary" class="import-list-summary">${escapeHtml(label)}${rangeSummary} · 第 ${page} / ${totalPages} 页 · 共 ${total} 条</p>
      <div id="importListBackfillNotice" class="import-list-backfill-notice"></div>
      <div id="importListTableWrap">${tableInner}</div>
    </div>`;
}

async function fetchImportBatchPage(datasetType, batchId, page, pageSize) {
  const q = `dataset_type=${encodeURIComponent(datasetType)}&batch_id=${encodeURIComponent(
    batchId
  )}&page=${page}&page_size=${pageSize}`;
  const r = await fetch(`${API_BASE}/import-batch?${q}`);
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`HTTP ${r.status} ${t.slice(0, 200)}`);
  }
  return r.json();
}

async function fetchImportActivePage(datasetType, routeDateFrom, routeDateTo, page, pageSize) {
  const q = new URLSearchParams({
    dataset_type: datasetType,
    route_date_from: routeDateFrom,
    route_date_to: routeDateTo,
    page: String(page),
    page_size: String(pageSize),
  });
  const r = await fetch(`${API_BASE}/import-active?${q}`);
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`HTTP ${r.status} ${t.slice(0, 200)}`);
  }
  return r.json();
}

function updateImportListPanelDom(wrap, params) {
  const {
    selectedDatasetType,
    page,
    pageSize,
    payload,
    queryMode = "batch",
    dateFrom = "",
    dateTo = "",
  } = params;
  const panelHtml = buildImportListPanelHtml({
    selectedDatasetType,
    page,
    pageSize,
    payload,
    queryMode,
    dateFrom,
    dateTo,
  });
  const panel = wrap.querySelector("#importListPanel");
  if (panel) {
    const d = document.createElement("div");
    d.innerHTML = panelHtml.trim();
    panel.replaceWith(d.firstElementChild);
  }
}

async function syncImportListPanel(wrap, options = {}) {
  const panelEl = wrap.querySelector("#importListPanel");
  const datasetType =
    options.datasetType ?? wrap.querySelector("#importListSource")?.value ?? "system";
  const pageSize =
    options.pageSize ?? (Number(wrap.querySelector("#importListPageSize")?.value) || 20);
  const page = options.page ?? (panelEl ? Number(panelEl.dataset.page) || 1 : 1);

  let queryMode = options.queryMode;
  if (queryMode == null) {
    queryMode = panelEl?.getAttribute("data-query-mode") === "range" ? "range" : "batch";
  }
  let dateFrom = options.dateFrom;
  let dateTo = options.dateTo;
  if (dateFrom == null) dateFrom = panelEl?.dataset.dateFrom ?? "";
  if (dateTo == null) dateTo = panelEl?.dataset.dateTo ?? "";

  const ids = getLastBatchIds();
  const batchId = ids[datasetType];

  if (queryMode === "range") {
    if (!dateFrom || !dateTo) {
      updateImportListPanelDom(wrap, {
        selectedDatasetType: datasetType,
        page: 1,
        pageSize,
        payload: { items: [], total: 0 },
        queryMode: "range",
        dateFrom,
        dateTo,
      });
      const tw = wrap.querySelector("#importListTableWrap");
      if (tw) {
        tw.innerHTML = `<div class="alert alert--muted">请选择排线日期起、止后点击「查询」。</div>`;
      }
      return;
    }
    if (dateFrom > dateTo) {
      const tw = wrap.querySelector("#importListTableWrap");
      if (tw) {
        tw.innerHTML = `<div class="alert alert--error">日期起不能晚于日期止。</div>`;
      }
      return;
    }
    try {
      const payload = await fetchImportActivePage(datasetType, dateFrom, dateTo, page, pageSize);
      updateImportListPanelDom(wrap, {
        selectedDatasetType: datasetType,
        page,
        pageSize,
        payload,
        queryMode: "range",
        dateFrom,
        dateTo,
      });
    } catch (err) {
      const tw = wrap.querySelector("#importListTableWrap");
      if (tw) tw.innerHTML = backendUnreachableHtml(err);
    }
    return;
  }

  if (!batchId) {
    const df = panelEl?.querySelector("#importListDateFrom")?.value ?? "";
    const dt = panelEl?.querySelector("#importListDateTo")?.value ?? "";
    const emptyHtml = buildImportListPanelHtml({
      selectedDatasetType: datasetType,
      page: 1,
      pageSize,
      payload: { items: [], total: 0 },
      queryMode: "batch",
      dateFrom: df,
      dateTo: dt,
    });
    const panel = wrap.querySelector("#importListPanel");
    if (panel) {
      const d = document.createElement("div");
      d.innerHTML = emptyHtml.trim();
      panel.replaceWith(d.firstElementChild);
    } else {
      wrap.insertAdjacentHTML("beforeend", emptyHtml);
    }
    const tw = wrap.querySelector("#importListTableWrap");
    if (tw) {
      tw.innerHTML = `<div class="alert alert--muted">请先导入该类型数据以查看本批列表，或填写排线日期后点击「查询」按日期浏览。</div>`;
    }
    return;
  }

  try {
    const payload = await fetchImportBatchPage(datasetType, batchId, page, pageSize);
    const df = panelEl?.querySelector("#importListDateFrom")?.value ?? "";
    const dt = panelEl?.querySelector("#importListDateTo")?.value ?? "";
    updateImportListPanelDom(wrap, {
      selectedDatasetType: datasetType,
      page,
      pageSize,
      payload,
      queryMode: "batch",
      dateFrom: df,
      dateTo: dt,
    });
  } catch (err) {
    const tw = wrap.querySelector("#importListTableWrap");
    if (tw) tw.innerHTML = backendUnreachableHtml(err);
  }
}

async function refreshImportListFromCurrentPanel(wrap) {
  const panel = wrap.querySelector("#importListPanel");
  if (!panel) return;
  const datasetType = wrap.querySelector("#importListSource")?.value || "system";
  const pageSize = Number(wrap.querySelector("#importListPageSize")?.value) || 20;
  const page = Number(panel.dataset.page) || 1;
  const mode = panel.getAttribute("data-query-mode") === "range" ? "range" : "batch";
  const dateFrom = panel.dataset.dateFrom ?? "";
  const dateTo = panel.dataset.dateTo ?? "";
  if (mode === "range" && dateFrom && dateTo) {
    await syncImportListPanel(wrap, { datasetType, page, pageSize, queryMode: "range", dateFrom, dateTo });
  } else {
    await syncImportListPanel(wrap, { datasetType, page, pageSize, queryMode: "batch" });
  }
}

function bindImportListInteractions(wrap) {
  if (wrap.dataset.importListBound === "1") return;
  wrap.dataset.importListBound = "1";
  wrap.addEventListener("change", (e) => {
    const t = e.target;
    const panel = wrap.querySelector("#importListPanel");
    const mode = panel?.getAttribute("data-query-mode") === "range" ? "range" : "batch";
    const dateFrom = panel?.dataset.dateFrom ?? "";
    const dateTo = panel?.dataset.dateTo ?? "";
    if (t.id === "importListSource") {
      setImportListViewType(t.value);
      const pageSize = Number(wrap.querySelector("#importListPageSize")?.value) || 20;
      if (mode === "range" && dateFrom && dateTo) {
        void syncImportListPanel(wrap, {
          datasetType: t.value,
          page: 1,
          pageSize,
          queryMode: "range",
          dateFrom,
          dateTo,
        });
      } else {
        void syncImportListPanel(wrap, { datasetType: t.value, page: 1, pageSize, queryMode: "batch" });
      }
    } else if (t.id === "importListPageSize") {
      const datasetType = wrap.querySelector("#importListSource")?.value || "system";
      const pageSize = Number(t.value) || 20;
      if (mode === "range" && dateFrom && dateTo) {
        void syncImportListPanel(wrap, {
          datasetType,
          page: 1,
          pageSize,
          queryMode: "range",
          dateFrom,
          dateTo,
        });
      } else {
        void syncImportListPanel(wrap, { datasetType, page: 1, pageSize, queryMode: "batch" });
      }
    }
  });
  wrap.addEventListener("click", (e) => {
    const calcBtn = e.target.closest("#importListManualCalcBtn");
    if (calcBtn) {
      const notice = wrap.querySelector("#importListBackfillNotice");
      const manualBid = getLastBatchIds().manual;
      if (!manualBid) {
        if (notice) {
          notice.className = "alert alert--muted";
          notice.innerHTML = "请先在<strong>手动排线数据</strong>下完成一次导入后再补算。";
        }
        return;
      }
      if (notice) {
        notice.className = "alert alert--muted";
        notice.innerHTML = "正在补算预估里程/时效…";
      }
      void (async () => {
        try {
          const r = await fetch(`${API_BASE}/manual/backfill`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ batch_id: manualBid }),
          });
          let data;
          try {
            data = await r.json();
          } catch {
            data = {};
          }
          if (!r.ok) {
            const errHtml = `<strong>补算失败</strong>（HTTP ${r.status}）<pre>${escapeHtml(
              JSON.stringify(data, null, 2).slice(0, 800)
            )}</pre>`;
            if (notice) {
              notice.className = "alert alert--error";
              notice.innerHTML = errHtml;
            }
            return;
          }
          const okClass = data.failed ? "alert alert--error" : "alert alert--muted";
          let okHtml = `${escapeHtml(`补算完成：成功 ${data.updated} 条，失败 ${data.failed} 条。`)}`;
          if (data.failures && data.failures.length) {
            okHtml += `<pre>${escapeHtml(JSON.stringify(data.failures, null, 2))}</pre>`;
          }
          await refreshImportListFromCurrentPanel(wrap);
          const noticeAfter = wrap.querySelector("#importListBackfillNotice");
          if (noticeAfter) {
            noticeAfter.className = okClass;
            noticeAfter.innerHTML = okHtml;
          }
        } catch (err) {
          const errH = backendUnreachableHtml(err);
          if (notice) notice.innerHTML = errH;
          const noticeAfter = wrap.querySelector("#importListBackfillNotice");
          if (noticeAfter) {
            noticeAfter.className = "alert alert--error";
            noticeAfter.innerHTML = errH;
          }
        }
      })();
      return;
    }
    const qbtn = e.target.closest("#importListQueryBtn");
    if (qbtn) {
      const from = wrap.querySelector("#importListDateFrom")?.value || "";
      const to = wrap.querySelector("#importListDateTo")?.value || "";
      if (!from || !to) {
        const tw = wrap.querySelector("#importListTableWrap");
        if (tw) tw.innerHTML = `<div class="alert alert--muted">请填写排线日期起、止。</div>`;
        return;
      }
      if (from > to) {
        const tw = wrap.querySelector("#importListTableWrap");
        if (tw) tw.innerHTML = `<div class="alert alert--error">日期起不能晚于日期止。</div>`;
        return;
      }
      const datasetType = wrap.querySelector("#importListSource")?.value || "system";
      const pageSize = Number(wrap.querySelector("#importListPageSize")?.value) || 20;
      void syncImportListPanel(wrap, {
        datasetType,
        page: 1,
        pageSize,
        queryMode: "range",
        dateFrom: from,
        dateTo: to,
      });
      return;
    }
    const prev = e.target.closest("#importListPrev");
    const next = e.target.closest("#importListNext");
    if (!prev && !next) return;
    const panel = wrap.querySelector("#importListPanel");
    if (!panel) return;
    const pageSize = Number(wrap.querySelector("#importListPageSize")?.value) || 20;
    let page = Number(panel.dataset.page) || 1;
    const total = Number(panel.dataset.total) || 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
    const datasetType = wrap.querySelector("#importListSource")?.value || "system";
    const mode = panel.getAttribute("data-query-mode") === "range" ? "range" : "batch";
    const dateFrom = panel.dataset.dateFrom ?? "";
    const dateTo = panel.dataset.dateTo ?? "";
    if (prev && page > 1) {
      if (mode === "range" && dateFrom && dateTo) {
        void syncImportListPanel(wrap, {
          datasetType,
          page: page - 1,
          pageSize,
          queryMode: "range",
          dateFrom,
          dateTo,
        });
      } else {
        void syncImportListPanel(wrap, { datasetType, page: page - 1, pageSize, queryMode: "batch" });
      }
    } else if (next && page < totalPages) {
      if (mode === "range" && dateFrom && dateTo) {
        void syncImportListPanel(wrap, {
          datasetType,
          page: page + 1,
          pageSize,
          queryMode: "range",
          dateFrom,
          dateTo,
        });
      } else {
        void syncImportListPanel(wrap, { datasetType, page: page + 1, pageSize, queryMode: "batch" });
      }
    }
  });
}

async function restoreImportListPanelIfStored(wrap) {
  const ids = getLastBatchIds();
  if (!ids.system && !ids.manual) return;
  let viewType = getImportListViewType();
  if (!ids[viewType]) viewType = ids.system ? "system" : "manual";
  const pageSize = 20;
  wrap.insertAdjacentHTML(
    "beforeend",
    buildImportListPanelHtml({
      selectedDatasetType: viewType,
      page: 1,
      pageSize,
      payload: { items: [], total: 0 },
      queryMode: "batch",
      dateFrom: "",
      dateTo: "",
    })
  );
  await syncImportListPanel(wrap, { datasetType: viewType, page: 1, pageSize, queryMode: "batch" });
}

async function refreshApiStatusBanner() {
  const el = document.getElementById("api-status-banner");
  if (!el) return;
  el.removeAttribute("hidden");
  el.className = "api-status-banner api-status-banner--checking";
  el.textContent = "正在检测后端…";
  try {
    const r = await fetch(`${API_ORIGIN}/health`, { method: "GET", cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    el.setAttribute("hidden", "");
    el.innerHTML = "";
    el.className = "api-status-banner";
  } catch {
    el.removeAttribute("hidden");
    el.className = "api-status-banner api-status-banner--error";
    el.innerHTML = `<strong>未连接到后端</strong> <code>${API_ORIGIN}</code>
      · <a href="#" class="api-retry-check">重试检测</a>
      <div class="api-status-banner__hint">请先运行 <code>./scripts/start-dev.sh</code>（默认后端 <code>:8080</code>）。若已运行仍失败，看终端里 uvicorn 是否报错。</div>`;
    el.querySelector(".api-retry-check")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      refreshApiStatusBanner();
    });
  }
}

function routeMapIdFromHash() {
  const h = window.location.hash || "";
  if (!h.startsWith("#route-map")) return null;
  const q = h.indexOf("?");
  if (q === -1) return null;
  const id = new URLSearchParams(h.slice(q + 1)).get("id");
  return id ? parseInt(id, 10) : null;
}

function syncNav() {
  const raw = window.location.hash || "#import";
  const base = raw.split("?")[0];
  document.querySelectorAll(".nav-tab").forEach((el) => {
    const r = el.getAttribute("data-route");
    const active = base === r || (base === "#route-map" && r === "#result");
    el.classList.toggle("is-active", active);
  });
}

function setWorkspaceTitle(title) {
  const el = document.getElementById("workspace-page-title");
  if (el) el.textContent = title;
}

function loadAmapScript(key, securityJsCode) {
  return new Promise((resolve, reject) => {
    if (window.AMap) {
      resolve();
      return;
    }
    if (securityJsCode) {
      window._AMapSecurityConfig = { securityJsCode: securityJsCode };
    }
    const s = document.createElement("script");
    s.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}`;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("加载高德地图脚本失败"));
    document.head.appendChild(s);
  });
}

function matchStatusBadge(status) {
  const cls =
    status === "full" ? "badge--full" : status === "partial" ? "badge--partial" : "badge--none";
  const label =
    status === "full"
      ? "完全匹配"
      : status === "partial"
        ? "部分匹配"
        : status === "none"
          ? "未匹配"
          : status;
  return `<span class="badge ${cls}">${label}</span>`;
}

function overviewSection(o) {
  if (!o || o.route_date == null) return "";
  const n = (v) => (v == null || v === "" ? "—" : v);
  return `
    <div class="stat-grid">
      <div class="stat-card"><span class="stat-label">总记录</span><span class="stat-value">${n(o.total)}</span></div>
      <div class="stat-card"><span class="stat-label">完全匹配</span><span class="stat-value">${n(o.full_count)}</span></div>
      <div class="stat-card"><span class="stat-label">部分匹配</span><span class="stat-value">${n(o.partial_count)}</span></div>
      <div class="stat-card"><span class="stat-label">未匹配</span><span class="stat-value">${n(o.none_count)}</span></div>
      <div class="stat-card"><span class="stat-label">平均体积差</span><span class="stat-value">${n(o.avg_volume_diff)}</span></div>
      <div class="stat-card"><span class="stat-label">平均里程差</span><span class="stat-value">${n(o.avg_distance_diff)}</span></div>
      <div class="stat-card"><span class="stat-label">平均时效差</span><span class="stat-value">${n(o.avg_duration_diff)}</span></div>
    </div>
    <details style="margin-bottom:20px">
      <summary style="cursor:pointer;font-size:0.85rem;color:var(--text-secondary);font-weight:500">查看概览 JSON</summary>
      <div class="code-block" style="margin-top:10px"><pre>${JSON.stringify(o, null, 2)}</pre></div>
    </details>`;
}

function route() {
  const hash = window.location.hash || "#import";
  if (hash.startsWith("#route-map")) {
    renderRouteMap();
    setWorkspaceTitle("路线地图");
  } else if (hash === "#import") {
    renderImport();
    setWorkspaceTitle("数据导入");
  } else if (hash === "#data") {
    renderData();
    setWorkspaceTitle("数据管理");
  } else if (hash === "#compare") {
    renderCompare();
    setWorkspaceTitle("数据比对");
  } else if (hash === "#result") {
    renderResult();
    setWorkspaceTitle("比对结果");
  } else {
    renderImport();
    setWorkspaceTitle("数据导入");
  }
  syncNav();
  refreshApiStatusBanner();
}

function renderImport() {
  app.innerHTML = `
    <div class="page-head">
      <p>同一排线日期与数据类型会执行覆盖导入，历史批次自动失效。</p>
      <p>「导出Excel」模板含<strong>车辆类型</strong>等必填列及「填写说明」页，请按表头顺序填写（系统与手工可填不同车型，如标箱与高栏）。</p>
    </div>
    <div class="toolbar">
      <div class="field">
        <span class="field-label">数据类型</span>
        <select id="datasetType">
          <option value="system">系统建议数据</option>
          <option value="manual">手动排线数据</option>
        </select>
      </div>
      <div class="field" style="min-width:220px">
        <span class="field-label">Excel 文件</span>
        <input id="fileInput" type="file" accept=".xlsx,.xls" />
      </div>
      <button type="button" class="btn btn--secondary" id="exportTemplateBtn">导出Excel</button>
      <button type="button" class="btn btn--primary" id="importBtn">开始导入</button>
    </div>
    <div id="importRespWrap"></div>
  `;
  const importRespWrap = document.getElementById("importRespWrap");
  bindImportListInteractions(importRespWrap);
  void restoreImportListPanelIfStored(importRespWrap).catch(() => {});
  document.getElementById("exportTemplateBtn").onclick = async () => {
    const wrap = document.getElementById("importRespWrap");
    const datasetType = document.getElementById("datasetType").value;
    const url = `${API_BASE}/import-template?dataset_type=${encodeURIComponent(datasetType)}`;
    const filename =
      datasetType === "system" ? "智能排线_导入模板_系统建议.xlsx" : "智能排线_导入模板_手动排线.xlsx";
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = filename;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch (err) {
      wrap.innerHTML = backendUnreachableHtml(err);
    }
  };
  document.getElementById("importBtn").onclick = async () => {
    const wrap = document.getElementById("importRespWrap");
    const datasetType = document.getElementById("datasetType").value;
    const file = document.getElementById("fileInput").files[0];
    if (!file) {
      wrap.innerHTML = `<div class="alert alert--muted">请先选择 .xlsx / .xls 文件。</div>`;
      return;
    }
    wrap.innerHTML = `<div class="alert alert--muted">正在上传…</div>`;
    const formData = new FormData();
    formData.append("file", file);
    const importUrl = `${API_BASE}/import/${datasetType}`;
    try {
      const resp = await fetch(importUrl, { method: "POST", body: formData });
      if (!resp.ok) {
        const raw = await resp.text();
        let errPayload;
        try {
          errPayload = JSON.parse(raw);
        } catch {
          errPayload = { _nonJsonBody: (raw || "").slice(0, 800) };
        }
        wrap.innerHTML = `<div class="alert alert--error">导入失败（HTTP ${resp.status}）</div><div class="code-block"><pre>${JSON.stringify(errPayload, null, 2)}</pre></div>`;
        return;
      }
      const data = await resp.json();
      const jsonStr = JSON.stringify(data, null, 2);
      let html = `<div class="code-block"><pre>${escapeHtml(jsonStr)}</pre></div>`;
      const batchId = data.batch_id;
      const successRows = Number(data.success_rows) || 0;
      if (batchId && successRows > 0) {
        setLastBatchId(datasetType, batchId);
        setImportListViewType(datasetType);
        try {
          const payload = await fetchImportBatchPage(datasetType, batchId, 1, 20);
          html += buildImportListPanelHtml({
            selectedDatasetType: datasetType,
            page: 1,
            pageSize: 20,
            payload,
            queryMode: "batch",
            dateFrom: "",
            dateTo: "",
          });
        } catch (e2) {
          html += backendUnreachableHtml(e2);
        }
      }
      wrap.innerHTML = html;
    } catch (err) {
      wrap.innerHTML = backendUnreachableHtml(err);
    }
  };
}

function renderData() {
  app.innerHTML = `
    <div class="page-head">
      <p>当前 MVP 仅支持通过导入覆盖数据；列表维护能力可在后续版本接入。</p>
    </div>
    <div class="empty-hint">如需查看或导出明细，请使用「比对结果」页或连接数据库。</div>`;
}

function renderCompare() {
  app.innerHTML = `
    <div class="page-head">
      <p>将按所选排线日对手动数据做补算（若需要），再执行系统与手工匹配并写入结果。</p>
    </div>
    <div class="toolbar">
      <div class="field">
        <span class="field-label">排线日期</span>
        <input id="routeDate" type="date" />
      </div>
      <button type="button" class="btn btn--primary" id="compareBtn">开始比对</button>
    </div>
    <div id="compareRespWrap"></div>
  `;
  document.getElementById("compareBtn").onclick = async () => {
    const wrap = document.getElementById("compareRespWrap");
    const routeDate = document.getElementById("routeDate").value;
    if (!routeDate) {
      wrap.innerHTML = `<div class="alert alert--muted">请选择排线日期。</div>`;
      return;
    }
    wrap.innerHTML = `<div class="alert alert--muted">正在执行比对…</div>`;
    try {
      const resp = await fetch(`${API_BASE}/compare/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ route_date: routeDate, match_threshold: 0.5 }),
      });
      const data = await resp.json();
      if (data.calc?.failures?.length) {
        data.failed_stores = data.calc.failures;
      }
      wrap.innerHTML = `<div class="code-block"><pre>${JSON.stringify(data, null, 2)}</pre></div>`;
    } catch (err) {
      wrap.innerHTML = backendUnreachableHtml(err);
    }
  };
}

function renderResult() {
  app.innerHTML = `
    <div class="page-head">
      <p>按日期查看概览与明细，可导出 CSV；每行可打开路线地图对照轨迹。</p>
    </div>
    <div class="toolbar">
      <div class="field">
        <span class="field-label">排线日期</span>
        <input id="resultDate" type="date" />
      </div>
      <div class="field">
        <span class="field-label">匹配状态</span>
        <select id="matchStatus">
          <option value="">全部</option>
          <option value="full">完全匹配</option>
          <option value="partial">部分匹配</option>
          <option value="none">未匹配</option>
        </select>
      </div>
      <button type="button" class="btn btn--primary" id="queryBtn">查询</button>
      <button type="button" class="btn btn--secondary" id="exportBtn">导出 CSV</button>
    </div>
    <div id="overviewArea"></div>
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>地图</th>
            <th>系统运单</th>
            <th>手工运单</th>
            <th>系统车型</th>
            <th>手工车型</th>
            <th>匹配状态</th>
            <th>门店匹配率</th>
            <th>匹配度</th>
            <th>体积差异</th>
            <th>线路一致</th>
            <th>车型一致</th>
            <th>里程差</th>
            <th>时效差</th>
          </tr>
        </thead>
        <tbody id="resultTable"></tbody>
      </table>
    </div>
    <p id="resultEmpty" class="empty-hint" style="display:none">暂无数据，请先选择日期并点击查询。</p>
  `;
  document.getElementById("queryBtn").onclick = async () => {
    const routeDate = document.getElementById("resultDate").value;
    const status = document.getElementById("matchStatus").value;
    const overviewArea = document.getElementById("overviewArea");
    const tbody = document.getElementById("resultTable");
    const emptyEl = document.getElementById("resultEmpty");
    if (!routeDate) {
      overviewArea.innerHTML = `<div class="alert alert--muted">请选择排线日期。</div>`;
      tbody.innerHTML = "";
      emptyEl.style.display = "block";
      return;
    }
    overviewArea.innerHTML = `<div class="alert alert--muted">加载中…</div>`;
    try {
      const overviewResp = await fetch(`${API_BASE}/compare/overview?route_date=${routeDate}`);
      const overviewData = await overviewResp.json();
      overviewArea.innerHTML = overviewSection(overviewData);
      const resultResp = await fetch(`${API_BASE}/compare/results?route_date=${routeDate}&match_status=${status}`);
      const rows = await resultResp.json();
      tbody.innerHTML = rows
        .map(
          (r) =>
            `<tr>
            <td><button type="button" class="btn btn--map map-btn" data-crid="${r.id}">地图</button></td>
            <td>${r.sys_waybill_no ?? "—"}</td>
            <td>${r.manual_waybill_no ?? "—"}</td>
            <td>${r.sys_vehicle_type ?? "—"}</td>
            <td>${r.manual_vehicle_type ?? "—"}</td>
            <td>${matchStatusBadge(r.match_status)}</td>
            <td>${r.store_match_rate ?? "—"}</td>
            <td>${r.match_score ?? "—"}</td>
            <td>${r.volume_diff ?? "—"}</td>
            <td>${r.line_consistent ? "是" : "否"}</td>
            <td>${r.vehicle_type_consistent == null ? "—" : r.vehicle_type_consistent ? "是" : "否"}</td>
            <td>${r.est_distance_diff ?? "—"}</td>
            <td>${r.est_duration_diff ?? "—"}</td>
          </tr>`
        )
        .join("");
      emptyEl.style.display = rows.length ? "none" : "block";
      if (!rows.length) emptyEl.textContent = "该条件下没有比对记录，可先执行「数据比对」。";
    } catch (err) {
      overviewArea.innerHTML = backendUnreachableHtml(err);
      tbody.innerHTML = "";
    }
  };
  document.getElementById("exportBtn").onclick = () => {
    const routeDate = document.getElementById("resultDate").value;
    if (!routeDate) return;
    window.open(`${API_BASE}/compare/export?route_date=${routeDate}`, "_blank");
  };
  document.getElementById("resultTable").onclick = (ev) => {
    const btn = ev.target.closest(".map-btn");
    if (!btn) return;
    const id = btn.getAttribute("data-crid");
    if (id) window.location.hash = `#route-map?id=${id}`;
  };
}

function renderRouteMap() {
  const rid = routeMapIdFromHash();
  app.innerHTML = `
    <div class="page-head">
      <p>蓝色为系统建议路线，红色虚线为手工路线；图例与关键点序号见地图。</p>
    </div>
    <div class="map-layout">
      <p class="alert alert--muted" style="margin-bottom:16px;font-size:0.8rem">
        高德 Key 来自 <code style="font-size:0.85em">frontend/amap-config.js</code>；可用 localStorage 覆盖。
      </p>
      <div id="routeMapMeta" class="map-meta"></div>
      <div id="mapContainer"></div>
      <div id="routeMapErr"></div>
      <a class="back-link" href="#result">← 返回比对结果</a>
    </div>
  `;
  const errEl = document.getElementById("routeMapErr");
  const metaEl = document.getElementById("routeMapMeta");
  if (!rid || Number.isNaN(rid)) {
    errEl.innerHTML = `<div class="alert alert--error">缺少比对行 id，请从「比对结果」表格中点击「地图」进入。</div>`;
    return;
  }

  (async () => {
    let data;
    try {
      const resp = await fetch(`${API_BASE}/compare/route-map/${rid}`);
      if (!resp.ok) {
        errEl.innerHTML = `<div class="alert alert--error">${resp.status === 404 ? "未找到该比对记录。" : `请求失败（${resp.status}）`}</div>`;
        return;
      }
      data = await resp.json();
    } catch (err) {
      errEl.innerHTML = backendUnreachableHtml(err);
      return;
    }

    metaEl.innerHTML = `
      <div><strong>${data.warehouse_name || "—"}</strong></div>
      <div style="margin-top:8px">${matchStatusBadge(data.match_status)} 
        <span style="margin-left:12px;color:var(--text-secondary)">系统 <strong>${data.sys_waybill_no ?? "—"}</strong>
          <small>（${data.sys_vehicle_type ?? "—"}）</small></span>
        <span style="margin-left:12px;color:var(--text-secondary)">手工 <strong>${data.manual_waybill_no ?? "—"}</strong>
          <small>（${data.manual_vehicle_type ?? "—"}）</small></span>
      </div>
      <div class="legend">
        <span><span style="color:#1677FF;font-weight:700">■</span> 系统路线</span>
        <span><span style="color:#FF4D4F;font-weight:700">■</span> 手工路线（虚线）</span>
      </div>`;

    const key =
      (typeof window.__AMAP_WEB_KEY__ === "string" && window.__AMAP_WEB_KEY__) ||
      localStorage.getItem("amap_web_key") ||
      "";
    const securityJsCode =
      (typeof window.__AMAP_SECURITY_JS_CODE__ === "string" && window.__AMAP_SECURITY_JS_CODE__) ||
      localStorage.getItem("amap_security_js_code") ||
      "";
    if (!key) {
      errEl.innerHTML = `<div class="alert alert--error">未检测到地图 Key。</div>`;
      const pre = document.createElement("div");
      pre.className = "code-block";
      pre.innerHTML = `<pre>${JSON.stringify(
        {
          system_points: data.system?.path?.length ?? 0,
          manual_points: data.manual?.path?.length ?? 0,
        },
        null,
        2
      )}</pre>`;
      document.getElementById("mapContainer").before(pre);
      return;
    }

    try {
      await loadAmapScript(key, securityJsCode);
    } catch {
      errEl.innerHTML = `<div class="alert alert--error">高德脚本加载失败。</div>`;
      return;
    }

    const map = new AMap.Map("mapContainer", { zoom: 11, viewMode: "2D" });
    const overlays = [];

    if (data.system?.available && data.system.path?.length) {
      const pl = new AMap.Polyline({
        path: data.system.path.map(([lng, lat]) => [lng, lat]),
        strokeColor: data.style?.system_line_color || "#1677FF",
        strokeWeight: 7,
        strokeOpacity: 0.85,
        lineJoin: "round",
        zIndex: 50,
      });
      map.add(pl);
      overlays.push(pl);
    }

    if (data.manual?.available && data.manual.path?.length) {
      const pl2 = new AMap.Polyline({
        path: data.manual.path.map(([lng, lat]) => [lng, lat]),
        strokeColor: data.style?.manual_line_color || "#FF4D4F",
        strokeWeight: 5,
        strokeOpacity: 0.9,
        strokeStyle: "dashed",
        lineJoin: "round",
        zIndex: 60,
      });
      map.add(pl2);
      overlays.push(pl2);
    }

    const labelSrc =
      data.system?.markers?.length > 0 ? data.system.markers : data.manual?.markers || [];
    labelSrc.forEach((m) => {
      new AMap.Marker({
        position: [m.lng, m.lat],
        title: `${m.seq} ${m.name}`,
        label: { content: String(m.seq), direction: "top" },
        map,
      });
    });

    if (overlays.length) {
      map.setFitView(overlays, false, [40, 40, 40, 40]);
    } else {
      errEl.innerHTML = `<div class="alert alert--error">当前记录无可用轨迹（可能补算未完成或缺少门店）。</div>`;
    }
  })();
}

window.addEventListener("hashchange", route);
route();

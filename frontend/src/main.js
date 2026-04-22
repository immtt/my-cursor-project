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
const IMPORT_LIST_RANGE_FROM_KEY = "smart_route_data_list_from";
const IMPORT_LIST_RANGE_TO_KEY = "smart_route_data_list_to";

function defaultDateRange() {
  const to = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const from = new Date(to.getFullYear(), to.getMonth(), to.getDate() - 30);
  return { from: fmt(from), to: fmt(to) };
}

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

/** 差异分析行项目：与后端 `waybills[].dataset_type` 一致，枚举仅 `system` | `manual`（与筛选里「全部」不同）。 */
function diffDatasetTypeLabel(t) {
  if (t === "system") return "系统建议";
  if (t === "manual") return "手工排线";
  return "—";
}

/** 线路差异表：系统与手工运单同列，用标签区分。 */
function formatCompareWaybillCell(sys, manual) {
  const s =
    sys != null && String(sys).trim() !== "" ? escapeHtml(String(sys)) : "—";
  const m =
    manual != null && String(manual).trim() !== ""
      ? escapeHtml(String(manual))
      : "—";
  return `<td class="cell-waybills">
    <div class="waybill-line"><span class="waybill-tag waybill-tag--system">系统</span><span class="waybill-no">${s}</span></div>
    <div class="waybill-line"><span class="waybill-tag waybill-tag--manual">手工</span><span class="waybill-no">${m}</span></div>
  </td>`;
}

/** 线路差异表：不同门店分侧展示，系统 / 手工标签与运单列一致。 */
function formatDiffStoresCell(onlySystem, onlyManual) {
  const s =
    onlySystem != null && String(onlySystem).trim() !== ""
      ? escapeHtml(String(onlySystem))
      : "—";
  const m =
    onlyManual != null && String(onlyManual).trim() !== ""
      ? escapeHtml(String(onlyManual))
      : "—";
  return `<td class="cell-stores cell-diff-stores">
    <div class="waybill-line"><span class="waybill-tag waybill-tag--system">系统</span><span class="waybill-no">${s}</span></div>
    <div class="waybill-line"><span class="waybill-tag waybill-tag--manual">手工</span><span class="waybill-no">${m}</span></div>
  </td>`;
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
  "预估里程(km)",
  "预估时效(分钟)",
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
  dateFrom = "",
  dateTo = "",
  selectedWarehouse = "",
  warehouseOptions = [],
}) {
  const safeFrom = dateFrom || "";
  const safeTo = dateTo || "";
  const wh = selectedWarehouse || "";
  const whOpts = Array.isArray(warehouseOptions) ? warehouseOptions : [];
  const whSelectOpts = [
    `<option value="" ${wh === "" ? "selected" : ""}>全部</option>`,
    ...whOpts.map(
      (w) =>
        `<option value="${escapeHtml(w)}" ${wh === w ? "selected" : ""}>${escapeHtml(w)}</option>`,
    ),
  ].join("");
  const total = Number(payload.total) || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const label = datasetTypeLabel(selectedDatasetType);
  const items = Array.isArray(payload.items) ? payload.items : [];
  const tableInner =
    total === 0
      ? safeFrom && safeTo
        ? `<p class="empty-hint">该排线日期范围内无有效数据。</p>`
        : `<p class="empty-hint">请选择排线日期起、止后点击「查询」。</p>`
      : items.length === 0
        ? `<p class="empty-hint">本页无数据。</p>`
        : renderImportListTableRowsOnly(items);
  const rangeSummary =
    safeFrom && safeTo ? ` · 排线 ${escapeHtml(safeFrom)}～${escapeHtml(safeTo)}` : "";
  return `<div id="importListPanel" class="import-list-panel" data-query-mode="range" data-date-from="${escapeHtml(
    safeFrom
  )}" data-date-to="${escapeHtml(safeTo)}" data-warehouse="${escapeHtml(
    wh
  )}" data-page="${page}" data-total="${total}">
      <p class="page-head" style="margin-top:1rem;margin-bottom:0.5rem"><strong>数据明细</strong><br/><small class="empty-hint" style="font-size:0.9em">按排线日期查看当前有效数据，与是否本次导入无关；导入与查阅相互独立。</small></p>
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
        <div class="field">
          <span class="field-label">仓库</span>
          <select id="importListWarehouse">${whSelectOpts}</select>
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

async function fetchImportActivePage(
  datasetType,
  routeDateFrom,
  routeDateTo,
  page,
  pageSize,
  warehouseName = "",
) {
  const q = new URLSearchParams({
    dataset_type: datasetType,
    route_date_from: routeDateFrom,
    route_date_to: routeDateTo,
    page: String(page),
    page_size: String(pageSize),
  });
  const wh = (warehouseName || "").trim();
  if (wh) q.set("warehouse_name", wh);
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
    dateFrom = "",
    dateTo = "",
    selectedWarehouse = "",
    warehouseOptions,
  } = params;
  const opts = warehouseOptions ?? payload.warehouse_options ?? [];
  const panelHtml = buildImportListPanelHtml({
    selectedDatasetType,
    page,
    pageSize,
    payload,
    dateFrom,
    dateTo,
    selectedWarehouse,
    warehouseOptions: opts,
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

  let dateFrom = options.dateFrom;
  let dateTo = options.dateTo;
  if (dateFrom == null) dateFrom = panelEl?.dataset.dateFrom ?? "";
  if (dateTo == null) dateTo = panelEl?.dataset.dateTo ?? "";
  if (!dateFrom || !dateTo) {
    const d = defaultDateRange();
    if (!dateFrom) dateFrom = d.from;
    if (!dateTo) dateTo = d.to;
  }

  let warehouseName = options.warehouseName;
  if (warehouseName == null) {
    const whEl = wrap.querySelector("#importListWarehouse");
    warehouseName = whEl?.value ?? panelEl?.dataset.warehouse ?? "";
  }

  if (dateFrom > dateTo) {
    const tw = wrap.querySelector("#importListTableWrap");
    if (tw) tw.innerHTML = `<div class="alert alert--error">日期起不能晚于日期止。</div>`;
    return;
  }

  try {
    const payload = await fetchImportActivePage(
      datasetType,
      dateFrom,
      dateTo,
      page,
      pageSize,
      warehouseName,
    );
    updateImportListPanelDom(wrap, {
      selectedDatasetType: datasetType,
      page,
      pageSize,
      payload,
      dateFrom,
      dateTo,
      selectedWarehouse: warehouseName || "",
      warehouseOptions: payload.warehouse_options,
    });
    sessionStorage.setItem(IMPORT_LIST_RANGE_FROM_KEY, dateFrom);
    sessionStorage.setItem(IMPORT_LIST_RANGE_TO_KEY, dateTo);
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
  const dateFrom = panel.dataset.dateFrom ?? "";
  const dateTo = panel.dataset.dateTo ?? "";
  const warehouseName = wrap.querySelector("#importListWarehouse")?.value ?? panel.dataset.warehouse ?? "";
  await syncImportListPanel(wrap, {
    datasetType,
    page,
    pageSize,
    dateFrom,
    dateTo,
    warehouseName,
  });
}

function bindImportListInteractions(wrap) {
  if (wrap.dataset.importListBound === "1") return;
  wrap.dataset.importListBound = "1";
  wrap.addEventListener("change", (e) => {
    const t = e.target;
    const panel = wrap.querySelector("#importListPanel");
    const dateFrom = panel?.dataset.dateFrom ?? "";
    const dateTo = panel?.dataset.dateTo ?? "";
    const warehouseName = wrap.querySelector("#importListWarehouse")?.value ?? panel?.dataset.warehouse ?? "";
    if (t.id === "importListSource") {
      setImportListViewType(t.value);
      const pageSize = Number(wrap.querySelector("#importListPageSize")?.value) || 20;
      void syncImportListPanel(wrap, {
        datasetType: t.value,
        page: 1,
        pageSize,
        dateFrom,
        dateTo,
        warehouseName,
      });
    } else if (t.id === "importListPageSize") {
      const datasetType = wrap.querySelector("#importListSource")?.value || "system";
      const pageSize = Number(t.value) || 20;
      void syncImportListPanel(wrap, {
        datasetType,
        page: 1,
        pageSize,
        dateFrom,
        dateTo,
        warehouseName,
      });
    } else if (t.id === "importListWarehouse") {
      const datasetType = wrap.querySelector("#importListSource")?.value || "system";
      const pageSize = Number(wrap.querySelector("#importListPageSize")?.value) || 20;
      void syncImportListPanel(wrap, {
        datasetType,
        page: 1,
        pageSize,
        dateFrom,
        dateTo,
        warehouseName: t.value ?? "",
      });
    }
  });
  wrap.addEventListener("click", (e) => {
    const calcBtn = e.target.closest("#importListManualCalcBtn");
    if (calcBtn) {
      const panel = wrap.querySelector("#importListPanel");
      const datasetType = wrap.querySelector("#importListSource")?.value || "system";
      const dateFrom = panel?.dataset.dateFrom ?? "";
      const dateTo = panel?.dataset.dateTo ?? "";
      const notice = wrap.querySelector("#importListBackfillNotice");
      if (datasetType !== "manual") return;
      if (!dateFrom || !dateTo) {
        if (notice) {
          notice.className = "alert alert--muted";
          notice.innerHTML = "请先选择排线日期起止并加载列表后再补算。";
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
            body: JSON.stringify({ route_date_from: dateFrom, route_date_to: dateTo }),
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
      const warehouseName = wrap.querySelector("#importListWarehouse")?.value ?? "";
      void syncImportListPanel(wrap, {
        datasetType,
        page: 1,
        pageSize,
        dateFrom: from,
        dateTo: to,
        warehouseName,
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
    const dateFrom = panel.dataset.dateFrom ?? "";
    const dateTo = panel.dataset.dateTo ?? "";
    const warehouseName = wrap.querySelector("#importListWarehouse")?.value ?? panel.dataset.warehouse ?? "";
    if (prev && page > 1) {
      void syncImportListPanel(wrap, {
        datasetType,
        page: page - 1,
        pageSize,
        dateFrom,
        dateTo,
        warehouseName,
      });
    } else if (next && page < totalPages) {
      void syncImportListPanel(wrap, {
        datasetType,
        page: page + 1,
        pageSize,
        dateFrom,
        dateTo,
        warehouseName,
      });
    }
  });
}

async function initImportDataListPanel(wrap, options = {}) {
  const viewType = options.focusDataset ?? getImportListViewType();
  if (options.focusDataset) setImportListViewType(options.focusDataset);
  const pageSize = 20;
  let dateFrom = sessionStorage.getItem(IMPORT_LIST_RANGE_FROM_KEY) || "";
  let dateTo = sessionStorage.getItem(IMPORT_LIST_RANGE_TO_KEY) || "";
  if (!dateFrom || !dateTo) {
    const d = defaultDateRange();
    dateFrom = dateFrom || d.from;
    dateTo = dateTo || d.to;
  }
  if (!wrap.querySelector("#importListPanel")) {
    wrap.insertAdjacentHTML(
      "beforeend",
      buildImportListPanelHtml({
        selectedDatasetType: viewType,
        page: 1,
        pageSize,
        payload: { items: [], total: 0, warehouse_options: [] },
        dateFrom,
        dateTo,
        selectedWarehouse: "",
        warehouseOptions: [],
      })
    );
  }
  await syncImportListPanel(wrap, {
    datasetType: viewType,
    page: 1,
    pageSize,
    dateFrom,
    dateTo,
  });
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

let _compareResultRows = [];
const _compareResultSort = { key: null, dir: "asc" };

function _compareValueForKey(r, key) {
  switch (key) {
    case "waybill":
      return [String(r.sys_waybill_no ?? ""), String(r.manual_waybill_no ?? "")].join("\0");
    case "sys_vehicle_type":
      return String(r.sys_vehicle_type ?? "");
    case "manual_vehicle_type":
      return String(r.manual_vehicle_type ?? "");
    case "match_status": {
      const o = { full: 0, partial: 1, none: 2 };
      return o[r.match_status] != null ? o[r.match_status] : 9;
    }
    case "store_match_rate": {
      const n = Number(r.store_match_rate);
      return Number.isFinite(n) ? n : null;
    }
    case "same_stores":
      return String(r.same_stores ?? "");
    case "diff_stores": {
      if (r.diff_stores != null && String(r.diff_stores).length) return String(r.diff_stores);
      return [r.diff_stores_system, r.diff_stores_manual]
        .filter((x) => x != null && String(x) !== "")
        .join(" ");
    }
    case "match_score": {
      const n = Number(r.match_score);
      return Number.isFinite(n) ? n : null;
    }
    case "volume_diff": {
      if (r.volume_diff == null || r.volume_diff === "") return null;
      const n = Number(r.volume_diff);
      return Number.isFinite(n) ? n : null;
    }
    case "line_consistent":
      return r.line_consistent ? 1 : 0;
    case "vehicle_type_consistent": {
      if (r.vehicle_type_consistent == null) return -1;
      return r.vehicle_type_consistent ? 1 : 0;
    }
    case "est_distance_diff": {
      if (r.est_distance_diff == null || r.est_distance_diff === "") return null;
      const n = Number(r.est_distance_diff);
      return Number.isFinite(n) ? n : null;
    }
    case "est_duration_diff": {
      if (r.est_duration_diff == null || r.est_duration_diff === "") return null;
      const n = Number(r.est_duration_diff);
      return Number.isFinite(n) ? n : null;
    }
    default:
      return "";
  }
}

function getSortedCompareResultRows() {
  const base = _compareResultRows;
  if (!_compareResultSort.key) return base;
  const { key, dir } = _compareResultSort;
  const mult = dir === "asc" ? 1 : -1;
  const withIdx = base.map((r, i) => ({ r, i }));
  withIdx.sort((A, B) => {
    const va = _compareValueForKey(A.r, key);
    const vb = _compareValueForKey(B.r, key);
    if (va == null && vb == null) {
      // continue
    } else if (va == null) {
      return 1;
    } else if (vb == null) {
      return -1;
    }
    let c = 0;
    if (typeof va === "number" && typeof vb === "number") {
      c = va - vb;
    } else {
      c = String(va).localeCompare(String(vb), "zh-Hans", { numeric: true, sensitivity: "base" });
    }
    if (c !== 0) return c * mult;
    return A.i - B.i;
  });
  return withIdx.map((x) => x.r);
}

function buildCompareResultTableRowsHtml(rows) {
  return rows
    .map(
      (r) =>
        `<tr>
            <td><button type="button" class="btn btn--map map-btn" data-crid="${r.id}">地图</button></td>
            ${formatCompareWaybillCell(r.sys_waybill_no, r.manual_waybill_no)}
            <td>${r.sys_vehicle_type ?? "—"}</td>
            <td>${r.manual_vehicle_type ?? "—"}</td>
            <td>${matchStatusBadge(r.match_status)}</td>
            <td>${r.store_match_rate ?? "—"}</td>
            <td class="cell-stores">${r.same_stores != null && r.same_stores !== "" ? escapeHtml(String(r.same_stores)) : "—"}</td>
            ${formatDiffStoresCell(r.diff_stores_system, r.diff_stores_manual)}
            <td>${r.match_score ?? "—"}</td>
            <td>${r.volume_diff ?? "—"}</td>
            <td>${r.line_consistent ? "是" : "否"}</td>
            <td>${r.vehicle_type_consistent == null ? "—" : r.vehicle_type_consistent ? "是" : "否"}</td>
            <td>${r.est_distance_diff ?? "—"}</td>
            <td>${r.est_duration_diff ?? "—"}</td>
          </tr>`,
    )
    .join("");
}

function compareSortableTh(text, key) {
  return `<th class="th-sort" data-cmp-sort="${key}" tabindex="0" role="columnheader" scope="col" title="点击切换排序" aria-sort="none">
  <span class="th-sort__text">${text}</span>
  <span class="th-sort__icons" aria-hidden="true">
    <span class="th-sort__u">▲</span><span class="th-sort__d">▼</span>
  </span>
</th>`;
}

function refreshCompareResultThead() {
  const tr = document.querySelector(".data-table--compare-sort thead tr");
  if (!tr) return;
  for (const th of tr.querySelectorAll("th[data-cmp-sort]")) {
    const k = th.getAttribute("data-cmp-sort");
    th.classList.remove("th-sort--asc", "th-sort--desc", "th-sort--on");
    if (_compareResultSort.key === k) {
      th.classList.add("th-sort--on", _compareResultSort.dir === "asc" ? "th-sort--asc" : "th-sort--desc");
      th.setAttribute("aria-sort", _compareResultSort.dir === "asc" ? "ascending" : "descending");
    } else {
      th.setAttribute("aria-sort", "none");
    }
  }
}

function refreshCompareResultTable() {
  const tbody = document.getElementById("resultTable");
  if (!tbody) return;
  tbody.innerHTML = buildCompareResultTableRowsHtml(getSortedCompareResultRows());
  refreshCompareResultThead();
}

function onCompareResultSortThClick(key) {
  if (!key) return;
  if (_compareResultSort.key === key) {
    _compareResultSort.dir = _compareResultSort.dir === "asc" ? "desc" : "asc";
  } else {
    _compareResultSort.key = key;
    _compareResultSort.dir = "asc";
  }
  refreshCompareResultTable();
}

function fillCompareWarehouseSelect(selectEl, overviewPayload, preserveValue) {
  if (!selectEl) return;
  const opts = (overviewPayload && overviewPayload.warehouse_options) || [];
  const prev = preserveValue != null ? preserveValue : selectEl.value;
  selectEl.innerHTML =
    `<option value="">全部</option>` +
    opts.map((w) => `<option value="${escapeHtml(w)}">${escapeHtml(w)}</option>`).join("");
  if (prev && [...selectEl.options].some((o) => o.value === prev)) selectEl.value = prev;
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
      <div class="stat-card"><span class="stat-label">总车次差</span><span class="stat-value">${n(o.total_trip_diff)}</span></div>
      <div class="stat-card"><span class="stat-label">总体积差</span><span class="stat-value">${n(o.total_volume_diff)}</span></div>
      <div class="stat-card"><span class="stat-label">总公里差</span><span class="stat-value">${n(o.total_distance_diff)}</span></div>
      <div class="stat-card"><span class="stat-label">总时长差</span><span class="stat-value">${n(o.total_duration_diff)}</span></div>
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
  } else if (hash === "#diff-analysis") {
    renderDiffAnalysis();
    setWorkspaceTitle("差异分析");
  } else if (hash === "#store-master") {
    renderStoreMaster();
    setWorkspaceTitle("仓店距离");
  } else if (hash === "#customer-profiles") {
    renderCustomerProfiles();
    setWorkspaceTitle("客户基础数据");
  } else if (hash === "#compare" || hash === "#result") {
    if (hash === "#compare") {
      history.replaceState(null, "", `${location.pathname}${location.search}#result`);
    }
    renderResult();
    setWorkspaceTitle("线路差异结果");
  } else {
    renderImport();
    setWorkspaceTitle("数据导入");
  }
  syncNav();
  refreshApiStatusBanner();
}

function renderDiffAnalysis() {
  const dr = defaultDateRange();
  const defaultDay = dr.to;
  app.innerHTML = `
    <div class="page-head page-head--compact">
      <p><small class="empty-hint">选择<strong>排线日期</strong>与<strong>数据范围</strong>，查询当日<strong>一店多车</strong>。运单级来源为<strong>系统建议 / 手工排线</strong>两值之一。选「全部（合并）」时表格多一列「来源」；选「仅系统 / 仅手工」时与筛选一致，不重复该列。</small></p>
    </div>
    <div class="toolbar">
      <div class="field">
        <span class="field-label">排线日期</span>
        <input type="date" id="diffAnalysisDate" value="${escapeHtml(defaultDay)}" />
      </div>
      <div class="field">
        <span class="field-label">数据范围</span>
        <select id="diffAnalysisDataset">
          <option value="all" selected>全部（合并）</option>
          <option value="system">仅系统建议</option>
          <option value="manual">仅手工排线</option>
        </select>
      </div>
      <button type="button" class="btn btn--primary" id="diffAnalysisQuery">查询</button>
    </div>
    <div class="table-scroll">
      <table class="data-table" id="diffAnalysisTable" aria-label="一店多车">
        <thead>
          <tr id="diffAnalysisTheadRow">
            <th>门店名称</th>
            <th style="width:6rem">运单数</th>
            <th class="th-diff-src" style="width:7.5rem">来源</th>
            <th style="width:4.5rem">项次</th>
            <th>运单号</th>
          </tr>
        </thead>
        <tbody id="diffAnalysisTbody"></tbody>
      </table>
    </div>
    <p id="diffAnalysisEmpty" class="empty-hint" hidden>该日无一店多车，或该日无有效导入数据。</p>
  `;
  const tbody = document.getElementById("diffAnalysisTbody");
  const emptyEl = document.getElementById("diffAnalysisEmpty");
  const runQuery = async () => {
    const routeDate = document.getElementById("diffAnalysisDate").value;
    const datasetType = document.getElementById("diffAnalysisDataset").value;
    const showSourceCol = datasetType === "all";
    const colSpan = showSourceCol ? 5 : 4;
    const theadRow = document.getElementById("diffAnalysisTheadRow");
    if (theadRow) {
      theadRow.innerHTML = showSourceCol
        ? `<th>门店名称</th>
            <th style="width:6rem">运单数</th>
            <th class="th-diff-src" style="width:7.5rem" title="系统建议 或 手工排线">来源</th>
            <th style="width:4.5rem">项次</th>
            <th>运单号</th>`
        : `<th>门店名称</th>
            <th style="width:6rem">运单数</th>
            <th style="width:4.5rem">项次</th>
            <th>运单号</th>`;
    }
    if (!routeDate) {
      tbody.innerHTML = "";
      emptyEl.removeAttribute("hidden");
      emptyEl.textContent = "请选择排线日期。";
      return;
    }
    emptyEl.setAttribute("hidden", "");
    tbody.innerHTML = `<tr><td colspan="${colSpan}" class="empty-hint">加载中…</td></tr>`;
    const q = new URLSearchParams({ route_date: routeDate, dataset_type: datasetType });
    try {
      const resp = await fetch(`${API_BASE}/diff-analysis/multi-vehicle-stores?${q}`);
      let data = {};
      try {
        data = await resp.json();
      } catch {
        data = {};
      }
      if (!resp.ok) {
        const detail =
          typeof data.detail === "string"
            ? data.detail
            : Array.isArray(data.detail)
              ? data.detail.map((x) => x.msg || x).join(" ")
              : JSON.stringify(data.detail || data);
        tbody.innerHTML = `<tr><td colspan="${colSpan}" class="alert alert--error">${escapeHtml(
          String(detail).slice(0, 2000) || "请求失败",
        )}</td></tr>`;
        return;
      }
      const items = data.items || [];
      if (items.length === 0) {
        tbody.innerHTML = "";
        emptyEl.removeAttribute("hidden");
        emptyEl.textContent = "该日无一店多车，或该日无有效导入数据。";
        return;
      }
      emptyEl.setAttribute("hidden", "");
      const rows = [];
      for (const it of items) {
        const wbs = it.waybills || [];
        const n = wbs.length;
        const rs = n > 0 ? String(n) : "0";
        wbs.forEach((w, idx) => {
          const storeCell =
            idx === 0
              ? `<td rowspan="${n}">${escapeHtml(String(it.store_name || ""))}</td><td rowspan="${n}">${rs}</td>`
              : "";
          const srcCell = showSourceCol
            ? `<td>${escapeHtml(diffDatasetTypeLabel(w.dataset_type))}</td>`
            : "";
          rows.push(`<tr>
            ${storeCell}
            ${srcCell}
            <td>${Number(w.item_seq) || ""}</td>
            <td><code>${escapeHtml(String(w.waybill_no || ""))}</code></td>
          </tr>`);
        });
      }
      tbody.innerHTML = rows.join("");
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="${colSpan}">${backendUnreachableHtml(e)}</td></tr>`;
    }
  };
  document.getElementById("diffAnalysisQuery").addEventListener("click", runQuery);
}

let importModalKeyController = null;

function renderImport() {
  app.innerHTML = `
    <div class="page-head page-head--compact">
      <p><small class="empty-hint">导入按<strong>排线日期 + 运单号</strong>更新或新增；模板含<strong>车辆类型</strong>等必填列。下方「数据明细」按日期查询，与是否导入无关。</small></p>
    </div>
    <div class="toolbar toolbar--import">
      <div class="field">
        <span class="field-label">数据类型</span>
        <select id="datasetType">
          <option value="system">系统建议数据</option>
          <option value="manual">手动排线数据</option>
        </select>
      </div>
      <button type="button" class="btn btn--primary" id="openImportModalBtn">导入</button>
      <button type="button" class="btn btn--secondary" id="exportTemplateBtn">导出 Excel</button>
    </div>
    <div id="importMessageArea" class="import-message-area"></div>
    <div id="importRespWrap"></div>
    <div id="importModal" class="modal" hidden>
      <div class="modal__backdrop" data-import-modal-close aria-hidden="true"></div>
      <div class="modal__dialog" role="dialog" aria-modal="true" aria-labelledby="importModalTitle">
        <h2 id="importModalTitle" class="modal__title">导入 Excel</h2>
        <p id="importModalTypeHint" class="modal__subtitle empty-hint"></p>
        <div class="field field--modal-file">
          <span class="field-label">选择文件</span>
          <input id="importModalFile" type="file" accept=".xlsx,.xls" />
        </div>
        <div id="importModalInlineMsg" class="import-modal-inline-msg" hidden></div>
        <div class="modal__actions">
          <button type="button" class="btn btn--secondary" id="importModalCancel">取消</button>
          <button type="button" class="btn btn--primary" id="importModalSubmit">上传导入</button>
        </div>
      </div>
    </div>
  `;

  const importRespWrap = document.getElementById("importRespWrap");
  const importMessageArea = document.getElementById("importMessageArea");
  const importModal = document.getElementById("importModal");
  const importModalFile = document.getElementById("importModalFile");
  const importModalInlineMsg = document.getElementById("importModalInlineMsg");
  const importModalTypeHint = document.getElementById("importModalTypeHint");

  function syncImportModalTypeHint() {
    const datasetType = document.getElementById("datasetType").value;
    importModalTypeHint.textContent =
      datasetType === "system" ? "将导入为：系统建议数据" : "将导入为：手动排线数据";
  }

  function closeImportModal() {
    importModalKeyController?.abort();
    importModalKeyController = null;
    importModal.classList.remove("modal--open");
    importModal.setAttribute("hidden", "");
    importModalFile.value = "";
    importModalInlineMsg.innerHTML = "";
    importModalInlineMsg.setAttribute("hidden", "");
    const submit = document.getElementById("importModalSubmit");
    if (submit) submit.disabled = false;
  }

  function openImportModal() {
    syncImportModalTypeHint();
    importModalInlineMsg.innerHTML = "";
    importModalInlineMsg.setAttribute("hidden", "");
    importModal.removeAttribute("hidden");
    importModal.classList.add("modal--open");
    importModalKeyController?.abort();
    importModalKeyController = new AbortController();
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape") closeImportModal();
      },
      { signal: importModalKeyController.signal }
    );
    importModalFile.focus();
  }

  bindImportListInteractions(importRespWrap);
  void initImportDataListPanel(importRespWrap).catch(() => {});

  document.getElementById("openImportModalBtn").onclick = () => openImportModal();

  importModal.querySelectorAll("[data-import-modal-close]").forEach((el) => {
    el.addEventListener("click", () => closeImportModal());
  });
  document.getElementById("importModalCancel").onclick = () => closeImportModal();

  document.getElementById("datasetType").addEventListener("change", () => {
    if (importModal.classList.contains("modal--open")) syncImportModalTypeHint();
  });

  document.getElementById("exportTemplateBtn").onclick = async () => {
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
      importMessageArea.innerHTML = backendUnreachableHtml(err);
    }
  };

  document.getElementById("importModalSubmit").onclick = async () => {
    const datasetType = document.getElementById("datasetType").value;
    const file = importModalFile.files[0];
    const submit = document.getElementById("importModalSubmit");
    if (!file) {
      importModalInlineMsg.innerHTML = `<div class="alert alert--muted">请先选择 .xlsx / .xls 文件。</div>`;
      importModalInlineMsg.removeAttribute("hidden");
      return;
    }
    importModalInlineMsg.innerHTML = `<div class="alert alert--muted">正在上传…</div>`;
    importModalInlineMsg.removeAttribute("hidden");
    submit.disabled = true;
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
        closeImportModal();
        importMessageArea.innerHTML = `<div class="alert alert--error">导入失败（HTTP ${resp.status}）</div><div class="code-block"><pre>${escapeHtml(
          JSON.stringify(errPayload, null, 2)
        )}</pre></div>`;
        return;
      }
      const data = await resp.json();
      const jsonStr = JSON.stringify(data, null, 2);
      const successRows = Number(data.success_rows) || 0;
      const batchId = data.batch_id;
      closeImportModal();
      importMessageArea.innerHTML = `<div class="alert alert--muted">导入完成（成功 ${successRows} 条）。</div><div class="code-block"><pre>${escapeHtml(
        jsonStr
      )}</pre></div>`;
      if (batchId && successRows > 0) {
        setLastBatchId(datasetType, batchId);
      }
      setImportListViewType(datasetType);
      await initImportDataListPanel(importRespWrap, { focusDataset: datasetType });
    } catch (err) {
      closeImportModal();
      importMessageArea.innerHTML = backendUnreachableHtml(err);
    } finally {
      submit.disabled = false;
    }
  };
}

function renderResult() {
  app.innerHTML = `
    <div class="page-head page-head--compact">
      <p><small class="empty-hint">选择<strong>排线日期</strong>与<strong>匹配状态</strong>后点<strong>查询</strong>：将自动补算手动数据并写入比对结果，再展示概览与明细；可导出 CSV，表格中打开路线地图。</small></p>
    </div>
    <div id="compareRespWrap" class="compare-run-status"></div>
    <div class="toolbar toolbar--compare">
      <div class="field">
        <span class="field-label">排线日期</span>
        <input id="lineDiffDate" type="date" />
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
      <div class="field">
        <span class="field-label">仓库</span>
        <select id="compareWarehouse">
          <option value="">全部</option>
        </select>
      </div>
      <button type="button" class="btn btn--primary" id="queryBtn">查询</button>
      <button type="button" class="btn btn--secondary" id="exportBtn">导出 CSV</button>
    </div>
    <div id="overviewArea"></div>
    <div class="table-scroll">
      <table class="data-table data-table--compare-sort">
        <thead>
          <tr>
            <th scope="col">地图</th>
            ${compareSortableTh("运单号", "waybill")}
            ${compareSortableTh("系统车型", "sys_vehicle_type")}
            ${compareSortableTh("手工车型", "manual_vehicle_type")}
            ${compareSortableTh("匹配状态", "match_status")}
            ${compareSortableTh("门店匹配率", "store_match_rate")}
            ${compareSortableTh("相同门店", "same_stores")}
            ${compareSortableTh("不同门店", "diff_stores")}
            ${compareSortableTh("匹配度", "match_score")}
            ${compareSortableTh("体积差异", "volume_diff")}
            ${compareSortableTh("线路一致", "line_consistent")}
            ${compareSortableTh("车型一致", "vehicle_type_consistent")}
            ${compareSortableTh("里程差", "est_distance_diff")}
            ${compareSortableTh("时效差", "est_duration_diff")}
          </tr>
        </thead>
        <tbody id="resultTable"></tbody>
      </table>
    </div>
    <p id="resultEmpty" class="empty-hint" style="display:none">暂无数据，请先选择日期并点击查询。</p>
  `;
  document.getElementById("queryBtn").onclick = async () => {
    const routeDate = document.getElementById("lineDiffDate").value;
    const status = document.getElementById("matchStatus").value;
    const whSel = document.getElementById("compareWarehouse");
    const selectedWh = (whSel && whSel.value) || "";
    const overviewArea = document.getElementById("overviewArea");
    const tbody = document.getElementById("resultTable");
    const emptyEl = document.getElementById("resultEmpty");
    const statusWrap = document.getElementById("compareRespWrap");
    if (!routeDate) {
      statusWrap.innerHTML = "";
      overviewArea.innerHTML = `<div class="alert alert--muted">请选择排线日期。</div>`;
      _compareResultRows = [];
      _compareResultSort.key = null;
      _compareResultSort.dir = "asc";
      tbody.innerHTML = "";
      emptyEl.style.display = "block";
      return;
    }
    statusWrap.innerHTML = `<div class="alert alert--muted">正在执行比对并加载数据…</div>`;
    overviewArea.innerHTML = "";
    tbody.innerHTML = "";
    try {
      const runResp = await fetch(`${API_BASE}/compare/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ route_date: routeDate, match_threshold: 0.5 }),
      });
      let runData = {};
      try {
        runData = await runResp.json();
      } catch {
        runData = {};
      }
      if (!runResp.ok) {
        statusWrap.innerHTML = `<div class="alert alert--error"><strong>比对失败</strong>（HTTP ${runResp.status}）<pre>${escapeHtml(
          JSON.stringify(runData, null, 2).slice(0, 1200)
        )}</pre></div>`;
        _compareResultRows = [];
        _compareResultSort.key = null;
        emptyEl.style.display = "block";
        return;
      }
      if (runData.calc?.failures?.length) {
        statusWrap.innerHTML = `<div class="alert alert--error">手动数据补算部分失败：<pre>${escapeHtml(
          JSON.stringify(runData.calc.failures, null, 2).slice(0, 800)
        )}</pre></div>`;
      } else {
        statusWrap.innerHTML = "";
      }
      overviewArea.innerHTML = `<div class="alert alert--muted">加载概览与明细…</div>`;
      const whQ = selectedWh.trim()
        ? `&warehouse_name=${encodeURIComponent(selectedWh.trim())}`
        : "";
      const overviewResp = await fetch(`${API_BASE}/compare/overview?route_date=${routeDate}${whQ}`);
      const overviewData = await overviewResp.json();
      fillCompareWarehouseSelect(whSel, overviewData, selectedWh);
      overviewArea.innerHTML = overviewSection(overviewData);
      const whForRows = (document.getElementById("compareWarehouse")?.value || "").trim();
      const whRowsQ = whForRows ? `&warehouse_name=${encodeURIComponent(whForRows)}` : "";
      const resultResp = await fetch(
        `${API_BASE}/compare/results?route_date=${routeDate}&match_status=${encodeURIComponent(status)}${whRowsQ}`,
      );
      const rows = await resultResp.json();
      _compareResultRows = Array.isArray(rows) ? rows : [];
      _compareResultSort.key = null;
      _compareResultSort.dir = "asc";
      refreshCompareResultTable();
      emptyEl.style.display = _compareResultRows.length ? "none" : "block";
      if (!_compareResultRows.length) emptyEl.textContent = "该条件下没有线路差异记录。";
    } catch (err) {
      statusWrap.innerHTML = backendUnreachableHtml(err);
      overviewArea.innerHTML = "";
      _compareResultRows = [];
      _compareResultSort.key = null;
      tbody.innerHTML = "";
    }
  };
  (function bindCompareSort() {
    const st = document.querySelector(".data-table--compare-sort");
    if (!st) return;
    st.addEventListener("click", (e) => {
      const th = e.target && e.target.closest && e.target.closest("th[data-cmp-sort]");
      if (!th) return;
      e.preventDefault();
      onCompareResultSortThClick(th.getAttribute("data-cmp-sort"));
    });
    st.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const th = e.target && e.target.closest && e.target.closest("th[data-cmp-sort]");
      if (!th) return;
      e.preventDefault();
      onCompareResultSortThClick(th.getAttribute("data-cmp-sort"));
    });
  })();
  document.getElementById("exportBtn").onclick = () => {
    const routeDate = document.getElementById("lineDiffDate").value;
    if (!routeDate) return;
    const wh = (document.getElementById("compareWarehouse")?.value || "").trim();
    let url = `${API_BASE}/compare/export?route_date=${routeDate}`;
    if (wh) url += `&warehouse_name=${encodeURIComponent(wh)}`;
    window.open(url, "_blank");
  };
  document.getElementById("resultTable").onclick = (ev) => {
    const btn = ev.target.closest(".map-btn");
    if (!btn) return;
    const id = btn.getAttribute("data-crid");
    if (id) window.location.hash = `#route-map?id=${id}`;
  };
}

function formatMarkerLngLatSuffix(m) {
  const lng = m && m.lng;
  const lat = m && m.lat;
  if (lng == null || lat == null) return "";
  const x = Number(lng);
  const y = Number(lat);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return "";
  return ` <span class="route-map-ll" title="经度,纬度（与接口/库中数值一致，未做舍入）">${lng}, ${lat}</span>`;
}

/** 路线顺序卡片用：两点球面直线距离（km）。 */
function routeMapHaversineKm(lng1, lat1, lng2, lat2) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const aa = Math.min(1, Math.max(0, a));
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(Math.max(1e-12, 1 - aa)));
  return R * c;
}

function formatRouteMapSegmentKm(mFrom, mTo) {
  const a = Number(mFrom.lng);
  const b = Number(mFrom.lat);
  const c = Number(mTo.lng);
  const d = Number(mTo.lat);
  if (![a, b, c, d].every(Number.isFinite)) return null;
  const km = routeMapHaversineKm(a, b, c, d);
  return km < 10 ? km.toFixed(2) : km.toFixed(1);
}

/** 地图 pin：仅显示序号+仓/店类型；店名见 Marker title 悬停。side 为 system|manual 用于蓝/红区分。 */
function buildRouteMapMarkerLabelHtml(m, side) {
  const n = (m.seq ?? 0) + 1;
  const kind = m.kind === "warehouse" ? "仓" : "店";
  const scls = side === "manual" ? "route-map-pin-label--manual" : "route-map-pin-label--system";
  return `<div class="route-map-pin-label ${scls}"><span class="route-map-pin-label__row"><span class="route-map-pin-label__seq">${n}</span><span class="route-map-pin-label__kind">${kind}</span></span></div>`;
}

/**
 * 路线地图页：按运单展示送货顺序（箭头串联，段间为球面直线距离；序号与地图一致，自 1 起）。
 */
function buildRouteMapWaybillStopsSection(heading, waybillNo, markers, side) {
  const secCls =
    side === "manual" ? "route-map-wb-section route-map-wb-section--manual" : "route-map-wb-section route-map-wb-section--system";
  const hasWb = waybillNo != null && String(waybillNo).trim() !== "";
  const wb = hasWb ? String(waybillNo) : "—";
  const head = `<div class="route-map-wb-head"><span class="route-map-wb-label">${escapeHtml(heading)}</span> <code class="route-map-wb-no">${escapeHtml(wb)}</code></div>`;
  if (!markers || !markers.length) {
    return `<section class="${secCls}">${head}<p class="route-map-sub">送货顺序</p><p class="empty-hint" style="padding:12px 0 0">暂无站点</p></section>`;
  }
  const sorted = [...markers].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const chunks = [];
  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i];
    const n = (m.seq ?? 0) + 1;
    const kindLabel = m.kind === "warehouse" ? "仓库" : "门店";
    const kcls = m.kind === "warehouse" ? " route-map-kind--wh" : " route-map-kind--st";
    const ll = formatMarkerLngLatSuffix(m);
    chunks.push(`<div class="route-map-flow__node" role="listitem">
      <div class="route-map-flow__node-card">
        <div class="route-map-flow__node-head">
          <span class="route-map-flow__seq" aria-hidden="true">${n}</span>
          <span class="route-map-kind${kcls}">${kindLabel}</span>
        </div>
        <div class="route-map-flow__name">${escapeHtml(m.name || "")}</div>
        <div class="route-map-flow__ll">${ll.trim() || '<span class="route-map-ll">—</span>'}</div>
      </div>
    </div>`);
    if (i < sorted.length - 1) {
      const kmStr = formatRouteMapSegmentKm(sorted[i], sorted[i + 1]);
      const distHtml = kmStr != null ? `${kmStr}&nbsp;km` : "—";
      chunks.push(`<div class="route-map-flow__connector" aria-hidden="true">
        <span class="route-map-flow__arrow" title="途经顺序">→</span>
        <span class="route-map-flow__dist">${distHtml}</span>
      </div>`);
    }
  }
  const flow = `<div class="route-map-flow" role="list">${chunks.join("")}</div>
    <p class="route-map-flow-note">箭头表示配送先后；段上距离为相邻站点间<strong>球面直线距离</strong>，仅供参考。</p>`;
  return `<section class="${secCls}">${head}<p class="route-map-sub">送货顺序（与地图标注一致，自 1 起）</p>${flow}</section>`;
}

function buildRouteMapStopsBlock(data) {
  const out = [];
  const sysM = (data.system && data.system.markers) || [];
  const hasSysWb = data.sys_waybill_no != null && String(data.sys_waybill_no).trim() !== "";
  if (hasSysWb || sysM.length) {
    out.push(buildRouteMapWaybillStopsSection("系统运单", data.sys_waybill_no, sysM, "system"));
  }
  const manM = (data.manual && data.manual.markers) || [];
  const hasManWb = data.manual_waybill_no != null && String(data.manual_waybill_no).trim() !== "";
  if (hasManWb || manM.length) {
    out.push(buildRouteMapWaybillStopsSection("手工运单", data.manual_waybill_no, manM, "manual"));
  }
  if (!out.length) return "";
  return `<div class="route-map-stops-grid">${out.join("")}</div>`;
}

function renderRouteMap() {
  const rid = routeMapIdFromHash();
  app.innerHTML = `
    <div class="page-head">
      <p>路线为高德驾车路径（起终点与途经点与送货顺序一致，贴路行驶）。可同时展示系统（蓝）与手工（红）线路。地图上仅显示顺序号；店名可鼠标悬停标点查看。</p>
    </div>
    <div class="map-layout">
      <p class="alert alert--muted" style="margin-bottom:16px;font-size:0.8rem">
        高德 Key 来自 <code style="font-size:0.85em">frontend/amap-config.js</code>；可用 localStorage 覆盖。
      </p>
      <div id="routeMapMeta" class="map-meta"></div>
      <div id="routeMapStops" class="route-map-stops-wrap"></div>
      <div id="mapContainer"></div>
      <p id="routeMapPathNote" class="route-map-path-note" role="note" style="display:none"></p>
      <div id="routeMapErr"></div>
      <a class="back-link" href="#result">← 返回线路差异结果</a>
    </div>
  `;
  const errEl = document.getElementById("routeMapErr");
  const metaEl = document.getElementById("routeMapMeta");
  if (!rid || Number.isNaN(rid)) {
    errEl.innerHTML = `<div class="alert alert--error">缺少比对行 id，请从「线路差异结果」表格中点击「地图」进入。</div>`;
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

    const matchRateDisp =
      data.store_match_rate != null && data.store_match_rate !== ""
        ? `${escapeHtml(String(data.store_match_rate))}%`
        : "—";
    const volBits = [];
    if (data.sys_volume != null && data.sys_volume !== "") {
      volBits.push(`系统 ${escapeHtml(String(data.sys_volume))} m³`);
    }
    if (data.manual_volume != null && data.manual_volume !== "") {
      volBits.push(`手工 ${escapeHtml(String(data.manual_volume))} m³`);
    }
    const volDisp = volBits.length ? volBits.join(" · ") : "—";
    const hasSysWbMeta = data.sys_waybill_no != null && String(data.sys_waybill_no).trim() !== "";
    const hasManWbMeta = data.manual_waybill_no != null && String(data.manual_waybill_no).trim() !== "";
    const legendWbBlock =
      hasSysWbMeta && hasManWbMeta
        ? `<span><span class="map-legend-swatch map-legend-swatch--system">■</span> 系统运单</span> <span><span class="map-legend-swatch map-legend-swatch--manual">■</span> 手工运单</span>`
        : hasSysWbMeta
          ? `<span><span class="map-legend-swatch map-legend-swatch--system">■</span> 系统建议路线</span>`
          : hasManWbMeta
            ? `<span><span class="map-legend-swatch map-legend-swatch--manual">■</span> 手工运单路线</span>`
            : `<span><span class="map-legend-swatch map-legend-swatch--system">■</span> 系统</span>`;

    metaEl.innerHTML = `
      <div><strong>${data.warehouse_name || "—"}</strong></div>
      <div style="margin-top:8px">${matchStatusBadge(data.match_status)} 
        <span style="margin-left:12px;color:var(--text-secondary)">系统 <strong class="text-waybill--system">${data.sys_waybill_no ?? "—"}</strong>
          <small>（${data.sys_vehicle_type ?? "—"}）</small></span>
        <span style="margin-left:12px;color:var(--text-secondary)">手工 <strong class="text-waybill--manual">${data.manual_waybill_no ?? "—"}</strong>
          <small>（${data.manual_vehicle_type ?? "—"}）</small></span>
      </div>
      <div class="map-meta__stats" style="margin-top:10px;font-size:0.88rem;color:var(--text-secondary);line-height:1.6">
        <span>匹配度 <strong style="color:var(--text)">${matchRateDisp}</strong></span>
        <span style="margin-left:18px">配送体积 <strong style="color:var(--text)">${volDisp}</strong></span>
      </div>
      <div class="legend" id="routeMapLegend">
        ${legendWbBlock}
      </div>`;

    const stopsEl = document.getElementById("routeMapStops");
    if (stopsEl) stopsEl.innerHTML = buildRouteMapStopsBlock(data);

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

    const pathNoteEl = document.getElementById("routeMapPathNote");
    const legendEl = document.getElementById("routeMapLegend");

    const canShowSystem =
      data.system?.available &&
      Array.isArray(data.system.path) &&
      data.system.path.length >= 2;
    const canShowManual =
      data.manual?.available &&
      Array.isArray(data.manual.path) &&
      data.manual.path.length >= 2;
    const canShowManualOnly = !canShowSystem && canShowManual;

    if (pathNoteEl) {
      pathNoteEl.style.display = "block";
      if (canShowSystem && canShowManual) {
        pathNoteEl.textContent =
          "同时绘制系统（蓝）与手工（红）驾车路线。轨迹由起终点与途经点一次/分段高德驾车规划，沿道路显示。";
      } else if (canShowSystem) {
        pathNoteEl.textContent = "路线由高德驾车规划，沿道路显示（非起终点直线）。";
      } else if (canShowManualOnly) {
        pathNoteEl.textContent =
          "本比对无系统侧轨迹或系统路径不可用，仅展示手工运单路线（驾车规划，沿道路）。";
      } else {
        pathNoteEl.style.display = "none";
      }
    }
    if (legendEl) {
      if (canShowSystem && canShowManual) {
        legendEl.innerHTML = `<span><span class="map-legend-swatch map-legend-swatch--system">■</span> 系统建议路线</span> <span><span class="map-legend-swatch map-legend-swatch--manual">■</span> 手工运单路线</span>`;
      } else if (canShowManualOnly) {
        legendEl.innerHTML = `<span><span class="map-legend-swatch map-legend-swatch--manual">■</span> 手工运单路线</span>`;
      }
    }

    const map = new AMap.Map("mapContainer", { zoom: 11, viewMode: "2D" });
    const overlays = [];
    const markerOverlays = [];

    if (canShowSystem) {
      const pl = new AMap.Polyline({
        path: data.system.path.map(([lng, lat]) => [lng, lat]),
        strokeColor: data.style?.system_line_color || "#1677FF",
        strokeWeight: 7,
        strokeOpacity: 0.85,
        lineJoin: "round",
        zIndex: 50,
        cursor: "default",
        bubble: true,
      });
      map.add(pl);
      overlays.push(pl);
    }
    if (canShowManual) {
      const pl2 = new AMap.Polyline({
        path: data.manual.path.map(([lng, lat]) => [lng, lat]),
        strokeColor: data.style?.manual_line_color || "#FF4D4F",
        strokeWeight: 6,
        strokeOpacity: 0.9,
        lineJoin: "round",
        zIndex: 48,
        cursor: "default",
        bubble: true,
      });
      map.add(pl2);
      overlays.push(pl2);
    }

    const addLabelMarkers = (markers, side, labelYOffset) => {
      (markers || []).forEach((m) => {
        const n = (m.seq ?? 0) + 1;
        const name = (m.name && String(m.name).trim()) || "—";
        const mk = new AMap.Marker({
          position: [m.lng, m.lat],
          title: `${n} ${name}`,
          label: {
            content: buildRouteMapMarkerLabelHtml(m, side),
            direction: "top",
            offset: [0, labelYOffset],
          },
          map,
        });
        markerOverlays.push(mk);
      });
    };
    if (canShowSystem) {
      addLabelMarkers(data.system?.markers, "system", 4);
    }
    if (canShowManual) {
      const yOff = canShowSystem ? 22 : 4;
      addLabelMarkers(data.manual?.markers, "manual", yOff);
    }

    const fit = [...overlays, ...markerOverlays];
    if (fit.length) {
      map.setFitView(fit, false, [40, 40, 40, 40]);
    } else {
      errEl.innerHTML = `<div class="alert alert--error">当前记录无可用轨迹（需系统或手工运单、门店及高德路线数据）。</div>`;
    }
  })();
}

const CP = {
  skip: 0,
  limit: 20,
  q: "",
  editId: null,
  modalKey: null,
};

/** 列表列：与产品「客户主数据」表头一致；`w` 为默认列宽，可被拖动与「重置列宽」覆盖。 */
const CP_LIST_COLUMNS = [
  { k: "customer_code", label: "客户编码", w: "6.5rem" },
  { k: "customer_name", label: "客户名称", w: "9rem" },
  { k: "customer_short_name", label: "客户简称", w: "5.5rem" },
  { k: "customer_category", label: "客户分类", fallback: "customer_type", w: "5.5rem" },
  { k: "sales_org", label: "销售组织", w: "7.5rem" },
  { k: "province", label: "省", w: "4.5rem" },
  { k: "city", label: "市", w: "5rem" },
  { k: "district", label: "区", w: "5rem" },
  { k: "addr_street", label: "街道", fallback: "delivery_street", w: "6rem" },
  { k: "address", label: "详细地址", fallback: "delivery_address", w: "16rem" },
  { k: "delivery_coordinate", label: "收货坐标", w: "12rem" },
  { k: "contact_name", label: "联系人", w: "5.5rem" },
  { k: "contact_phone", label: "联系电话", w: "7.5rem" },
  { k: "settlement_unit", label: "结算单位", w: "7rem" },
  { k: "status", label: "状态", fallback: "business_status", w: "5rem" },
  { k: "created_by", label: "创建人", w: "5rem" },
  { k: "created_at", label: "创建时间", w: "9.5rem" },
  { k: "updated_by", label: "修改人", w: "5rem" },
  { k: "updated_at", label: "修改时间", w: "9.5rem" },
  { k: "remark", label: "备注", w: "11rem" },
];

const CP_LIST_COL_WIDTHS_KEY = "smart_route_cp_list_col_widths";

let _cpWidthOverrides = null;
function cpLoadWidthOverrides() {
  if (_cpWidthOverrides !== null) return;
  try {
    const raw = localStorage.getItem(CP_LIST_COL_WIDTHS_KEY);
    _cpWidthOverrides = raw && raw.trim() ? JSON.parse(raw) : {};
  } catch {
    _cpWidthOverrides = {};
  }
}
function cpSaveWidthOverrides() {
  if (_cpWidthOverrides == null) return;
  try {
    localStorage.setItem(CP_LIST_COL_WIDTHS_KEY, JSON.stringify(_cpWidthOverrides));
  } catch {
    /* ignore */
  }
}
function cpColWidthFor(k) {
  cpLoadWidthOverrides();
  const o = _cpWidthOverrides;
  if (o && o[k] != null && String(o[k]).trim() !== "") return String(o[k]).trim();
  const c = CP_LIST_COLUMNS.find((x) => x.k === k);
  return (c && c.w) || "7rem";
}
function buildCpColgroupHtml() {
  cpLoadWidthOverrides();
  return `<colgroup>
    ${CP_LIST_COLUMNS.map((c) => {
      const w = cpColWidthFor(c.k);
      return `<col class="cp-col" data-cp-colk="${c.k}" style="width:${w};min-width:${w}"/>`;
    }).join("")}
    <col class="cp-col cp-col--actions" data-cp-colk="_actions" style="width:5.5rem;min-width:5.5rem"/>
  </colgroup>`;
}
function cpResetColumnWidths() {
  localStorage.removeItem(CP_LIST_COL_WIDTHS_KEY);
  _cpWidthOverrides = null;
  cpLoadWidthOverrides();
  for (const c of CP_LIST_COLUMNS) {
    const el = document.querySelector(`#cp-table col[data-cp-colk="${c.k}"]`);
    if (!el) continue;
    const w = c.w || "7rem";
    el.style.width = w;
    el.style.minWidth = w;
  }
}

let _cpColDrag = null;
function cpOnResizeMove(e) {
  if (!_cpColDrag) return;
  const d = e.clientX - _cpColDrag.startX;
  const w = Math.max(48, _cpColDrag.startW + d);
  _cpColDrag.col.style.width = `${w}px`;
  _cpColDrag.col.style.minWidth = `${w}px`;
}
function cpOnResizeEnd() {
  document.removeEventListener("mousemove", cpOnResizeMove);
  if (_cpColDrag) {
    const w = _cpColDrag.col.getBoundingClientRect().width;
    if (!_cpWidthOverrides) _cpWidthOverrides = {};
    _cpWidthOverrides[_cpColDrag.k] = `${Math.round(w)}px`;
    cpSaveWidthOverrides();
    _cpColDrag = null;
  }
}
function cpOnResizeStart(e) {
  const h = e.target && e.target.closest && e.target.closest(".cp-resize-h");
  if (!h) return;
  e.preventDefault();
  e.stopPropagation();
  const k = h.getAttribute("data-cp-colk");
  if (!k) return;
  const col = document.querySelector(`#cp-table col[data-cp-colk="${k}"]`);
  if (!col) return;
  const startX = e.clientX;
  const startW = col.getBoundingClientRect().width;
  _cpColDrag = { k, col, startX, startW };
  document.addEventListener("mousemove", cpOnResizeMove);
  document.addEventListener("mouseup", cpOnResizeEnd, { once: true });
}

const CP_NCOL = CP_LIST_COLUMNS.length + 1;

function cpListCellText(it, col) {
  let raw = it[col.k];
  if (col.fallback) {
    if (raw == null || raw === "") {
      if (col.fallback === "comment_legacy") {
        raw = it.remark;
      } else {
        raw = it[col.fallback];
      }
    }
  }
  if (raw == null || raw === "") return "—";
  const s = String(raw);
  if (col.k === "created_at" || col.k === "updated_at") {
    return s.replace("T", " ").slice(0, 19);
  }
  return s;
}

function cpListCellDisplay(it, col) {
  const full = cpListCellText(it, col);
  if (full === "—") return { html: "—", title: "" };
  const maxCh =
    col.k === "address" || col.k === "delivery_coordinate" || col.k === "remark" ? 48 : 36;
  const t = full.length > maxCh ? full.slice(0, maxCh) + "…" : full;
  return {
    html: escapeHtml(t),
    title: full.length > maxCh ? ` title="${escapeHtml(full)}"` : "",
  };
}

/** 与后端 `CustomerProfile` 可编辑字段一致（主数据字段在前，扩展字段在后） */
const CP_FIELDS = [
  { k: "customer_code", label: "客户编码", t: "text", req: true },
  { k: "customer_name", label: "客户名称", t: "text", req: true },
  { k: "customer_short_name", label: "客户简称", t: "text" },
  { k: "customer_category", label: "客户分类", t: "text" },
  { k: "sales_org", label: "销售组织", t: "text" },
  { k: "contact_name", label: "联系人", t: "text" },
  { k: "business_hours", label: "营业时间", t: "text" },
  { k: "contact_phone", label: "联系电话", t: "text" },
  { k: "province", label: "省", t: "text" },
  { k: "city", label: "市", t: "text" },
  { k: "district", label: "区", t: "text" },
  { k: "addr_street", label: "街道", t: "text" },
  { k: "county", label: "县", t: "text" },
  { k: "address", label: "详细地址", t: "area" },
  { k: "delivery_coordinate", label: "收货坐标", t: "text" },
  { k: "settlement_unit", label: "结算单位", t: "text" },
  { k: "status", label: "状态", t: "text" },
  { k: "created_by", label: "创建人", t: "text" },
  { k: "updated_by", label: "修改人", t: "text" },
  { k: "remark", label: "备注", t: "area" },
  { k: "customer_type", label: "客户类型(供应链列表)", t: "text" },
  { k: "business_status", label: "营业状态", t: "text" },
  { k: "performance_sla", label: "履约时效", t: "text" },
  { k: "line_count", label: "线路数", t: "text" },
  { k: "route_line", label: "所属线路", t: "text" },
  { k: "e_sign", label: "开启电子签", t: "text" },
  { k: "latest_delivery", label: "最晚送达时间", t: "text" },
  { k: "auth_status", label: "认证状态", t: "text" },
  { k: "settlement_warehouse_km", label: "结算仓店距离（km）", t: "num" },
  { k: "warehouse_store_km", label: "仓店距离（km）", t: "num" },
  { k: "customer_coordinate", label: "客户坐标", t: "text" },
  { k: "driver_coordinate", label: "司机上报坐标", t: "text" },
  { k: "carrier", label: "所属承运商", t: "text" },
  { k: "staff_auth_detail", label: "员工认证明细", t: "area" },
  { k: "customer_group", label: "所属客户组", t: "text" },
  { k: "group_min_order", label: "客户组起送量", t: "text" },
  { k: "min_order_type", label: "起送量类型", t: "text" },
  { k: "min_order", label: "起送量", t: "text" },
  { k: "delivery_schedule", label: "配送排程", t: "text" },
  { k: "loop_mode", label: "循环模式", t: "text" },
  { k: "consignee", label: "收货人", t: "text" },
  { k: "consignee_phone", label: "收货电话", t: "text" },
  { k: "delivery_address", label: "收货地址", t: "area" },
  { k: "delivery_province", label: "收货省", t: "text" },
  { k: "delivery_city", label: "收货市", t: "text" },
  { k: "delivery_district", label: "收货区", t: "text" },
  { k: "delivery_street", label: "收货街道", t: "text" },
  { k: "import_source", label: "写入来源", t: "text" },
];

function cpFieldInputHtml(f, val) {
  const v = val != null && val !== "" ? String(val) : "";
  const req = f.req ? " *" : "";
  if (f.t === "area") {
    return `<div class="field field--cp">
      <span class="field-label">${escapeHtml(f.label)}${req}</span>
      <textarea data-cp-key="${f.k}" rows="2" class="cp-input">${escapeHtml(v)}</textarea>
    </div>`;
  }
  if (f.t === "num") {
    const numV = v === "" || v === "null" ? "" : v;
    return `<div class="field field--cp">
      <span class="field-label">${escapeHtml(f.label)}</span>
      <input class="cp-input" type="number" step="any" data-cp-key="${f.k}" value="${escapeHtml(
        numV,
      )}" />
    </div>`;
  }
  return `<div class="field field--cp">
    <span class="field-label">${escapeHtml(f.label)}${req}</span>
    <input class="cp-input" type="text" data-cp-key="${f.k}" value="${escapeHtml(v)}" />
  </div>`;
}

function cpBuildFormFieldsHtml() {
  return CP_FIELDS.map((f) => cpFieldInputHtml(f, "")).join("");
}

function cpFormValuesFromData(data) {
  if (!data) return;
  for (const f of CP_FIELDS) {
    const el = document.querySelector(`[data-cp-key="${f.k}"]`);
    if (!el) continue;
    let v = data[f.k];
    if (v == null) v = "";
    else v = String(v);
    if (f.t === "num" && (v === "" || v === "null")) {
      el.value = "";
    } else {
      el.value = v;
    }
  }
}

function cpFormCollectPayload() {
  const o = {};
  for (const f of CP_FIELDS) {
    const el = document.querySelector(`[data-cp-key="${f.k}"]`);
    if (!el) continue;
    const raw = "value" in el ? el.value : "";
    if (f.t === "num") {
      const t = String(raw).trim();
      o[f.k] = t === "" ? null : parseFloat(t);
    } else {
      const t = String(raw).trim();
      o[f.k] = t === "" ? null : t;
    }
  }
  return o;
}

function cpOpenModal() {
  const m = document.getElementById("cp-modal");
  if (!m) return;
  m.removeAttribute("hidden");
  m.classList.add("modal--open");
  CP.modalKey?.abort();
  CP.modalKey = new AbortController();
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") cpCloseModal();
    },
    { signal: CP.modalKey.signal },
  );
}

function cpCloseModal() {
  const m = document.getElementById("cp-modal");
  if (!m) return;
  CP.modalKey?.abort();
  CP.modalKey = null;
  m.classList.remove("modal--open");
  m.setAttribute("hidden", "");
  CP.editId = null;
}

async function cpLoadList() {
  const tbody = document.getElementById("cp-tbody");
  const totalEl = document.getElementById("cp-total");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="${CP_NCOL}" class="empty-hint">加载中…</td></tr>`;
  const q = new URLSearchParams({
    skip: String(CP.skip),
    limit: String(CP.limit),
  });
  if (CP.q) q.set("search", CP.q);
  try {
    const r = await fetch(`${API_BASE}/customer-profiles?${q}`);
    const d = await r.json();
    if (!r.ok) {
      tbody.innerHTML = `<tr><td colspan="${CP_NCOL}" class="alert alert--error">加载失败</td></tr>`;
      return;
    }
    if (totalEl) totalEl.textContent = `共 ${d.total} 条`;
    const items = d.items || [];
    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${CP_NCOL}" class="empty-hint">暂无数据</td></tr>`;
      return;
    }
    tbody.innerHTML = items
      .map((it) => {
        const cells = CP_LIST_COLUMNS.map((col) => {
          const { html, title } = cpListCellDisplay(it, col);
          return `<td class="cp-list-cell"${title}>${html}</td>`;
        }).join("");
        return `<tr>${cells}<td class="table-actions">
        <button type="button" class="btn btn--secondary btn--sm" data-cp="edit" data-id="${it.id}">编辑</button>
        <button type="button" class="btn btn--secondary btn--sm" data-cp="del" data-id="${it.id}" style="color:var(--danger)">删除</button>
      </td></tr>`;
      })
      .join("");
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="${CP_NCOL}">${backendUnreachableHtml(e)}</td></tr>`;
  }
}

function renderCustomerProfiles() {
  CP.editId = null;
  app.innerHTML = `
    <div class="page-head page-head--compact">
      <p><small class="empty-hint">列表字段与主数据表头一致（客户编码、名称、简称、分类、销售组织、地址、收货坐标、结算与状态、创建/修改信息、备注等）。导入 <strong>客户列表</strong> Excel 仍支持原列；页面新增可将「写入来源」填为 <code>页面录入</code>。</small></p>
    </div>
    <div class="toolbar" style="flex-wrap:wrap">
      <div class="field" style="min-width:200px">
        <span class="field-label">搜索</span>
        <input type="search" id="cp-q" placeholder="编码 / 名称 / 简称 / 销售组织" value="${escapeHtml(CP.q)}" />
      </div>
      <button type="button" class="btn btn--secondary" id="cp-search">查询</button>
      <button type="button" class="btn btn--secondary" id="cp-refresh">刷新</button>
      <button type="button" class="btn btn--primary" id="cp-new">新增</button>
      <a class="btn btn--secondary" id="cp-export" href="${API_BASE}/customer-profiles/export" target="_blank" rel="noopener">导出 Excel</a>
      <div class="field" style="min-width:200px">
        <span class="field-label">导入</span>
        <input type="file" id="cp-file" accept=".xlsx" />
      </div>
      <button type="button" class="btn btn--primary" id="cp-import">上传导入</button>
      <span id="cp-total" class="field-label" style="align-self:center"></span>
      <button type="button" class="btn btn--secondary" id="cp-width-reset" title="清除本机保存的列宽，恢复默认">重置列宽</button>
    </div>
    <div id="cp-msg" style="margin-top:8px"></div>
    <p class="empty-hint" style="margin:0 0 8px;font-size:0.8rem">列宽可拖动表头右缘调整，刷新后仍保留；地址、坐标、备注等列已加默认可视宽度。</p>
    <div class="table-scroll cp-table-scroll">
      <table class="data-table data-table--cp" id="cp-table">
        ${buildCpColgroupHtml()}
        <thead>
          <tr>
            ${CP_LIST_COLUMNS.map(
              (c) =>
                `<th class="cp-th" scope="col">
  <span class="cp-th__text">${escapeHtml(c.label)}</span>
  <span class="cp-resize-h" data-cp-colk="${c.k}" title="拖动调整列宽" role="separator" aria-grabbed="false"></span>
</th>`,
            ).join("")}
            <th class="cp-th cp-th--action" scope="col"><span class="cp-th__text">操作</span></th>
          </tr>
        </thead>
        <tbody id="cp-tbody"></tbody>
      </table>
    </div>
    <div class="toolbar">
      <button type="button" class="btn btn--secondary" id="cp-prev" ${CP.skip <= 0 ? "disabled" : ""}>上一页</button>
      <button type="button" class="btn btn--secondary" id="cp-next">下一页</button>
    </div>
    <div id="cp-modal" class="modal" hidden>
      <div class="modal__backdrop" data-cp-m-close></div>
      <div class="modal__dialog modal__dialog--xl" role="dialog" aria-modal="true">
        <h2 class="modal__title" id="cp-modal-title">客户</h2>
        <p class="empty-hint" style="margin-top:0">标 * 为必填。保存时写入数据库。</p>
        <div class="cp-form-grid" id="cp-form-fields">${cpBuildFormFieldsHtml()}</div>
        <div class="modal__actions">
          <button type="button" class="btn btn--secondary" data-cp-m-close>取消</button>
          <button type="button" class="btn btn--primary" id="cp-save">保存</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById("cp-search")?.addEventListener("click", () => {
    CP.q = (document.getElementById("cp-q")?.value || "").trim();
    CP.skip = 0;
    void cpLoadList();
  });
  document.getElementById("cp-refresh")?.addEventListener("click", () => {
    void cpLoadList();
  });
  document.getElementById("cp-width-reset")?.addEventListener("click", () => {
    cpResetColumnWidths();
  });
  document.getElementById("cp-table")?.addEventListener("mousedown", cpOnResizeStart);
  document.getElementById("cp-new")?.addEventListener("click", () => {
    CP.editId = null;
    const t = document.getElementById("cp-modal-title");
    if (t) t.textContent = "新增客户";
    const wrap = document.getElementById("cp-form-fields");
    if (wrap) {
      wrap.innerHTML = cpBuildFormFieldsHtml();
      const imp = document.querySelector(`[data-cp-key="import_source"]`);
      if (imp) imp.value = "页面录入";
    }
    cpOpenModal();
  });
  document.getElementById("cp-import")?.addEventListener("click", async () => {
    const file = document.getElementById("cp-file")?.files?.[0];
    if (!file) {
      const el = document.getElementById("cp-msg");
      if (el) el.innerHTML = `<div class="alert alert--muted">请先选择 .xlsx 文件</div>`;
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    const el = document.getElementById("cp-msg");
    if (el) el.innerHTML = `<div class="alert alert--muted">正在上传…</div>`;
    const r = await fetch(
      `${API_BASE}/customer-list/import?${new URLSearchParams({ data_source: "页面导入" })}`,
      { method: "POST", body: fd },
    );
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (el) {
        el.innerHTML = `<div class="alert alert--error">${escapeHtml(
          typeof d.detail === "string" ? d.detail : JSON.stringify(d.detail || d) || "导入失败",
        )}</div>`;
      }
      return;
    }
    if (el) {
      el.innerHTML = `<div class="code-block"><pre>${escapeHtml(JSON.stringify(d, null, 2))}</pre></div>`;
    }
    void cpLoadList();
  });
  document.getElementById("cp-prev")?.addEventListener("click", () => {
    if (CP.skip <= 0) return;
    CP.skip = Math.max(0, CP.skip - CP.limit);
    void cpLoadList();
  });
  document.getElementById("cp-next")?.addEventListener("click", () => {
    CP.skip += CP.limit;
    void cpLoadList();
  });
  document.getElementById("cp-modal")?.querySelectorAll("[data-cp-m-close]").forEach((b) => {
    b.addEventListener("click", () => cpCloseModal());
  });
  document.getElementById("cp-save")?.addEventListener("click", async () => {
    const body = cpFormCollectPayload();
    if (!(body.customer_code || "").trim() || !(body.customer_name || "").trim()) {
      const el = document.getElementById("cp-msg");
      if (el) el.innerHTML = `<div class="alert alert--error">请填写客户代码与客户名称</div>`;
      return;
    }
    const isEdit = CP.editId != null;
    const url = isEdit
      ? `${API_BASE}/customer-profiles/${CP.editId}`
      : `${API_BASE}/customer-profiles`;
    const r = await fetch(url, {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      const el = document.getElementById("cp-msg");
      if (el) {
        el.innerHTML = `<div class="alert alert--error">${escapeHtml(
          typeof d.detail === "string" ? d.detail : JSON.stringify(d.detail || d) || "保存失败",
        )}</div>`;
      }
      return;
    }
    cpCloseModal();
    const el = document.getElementById("cp-msg");
    if (el) el.innerHTML = `<div class="alert" style="background:#ecfdf5;border-color:#a7f3d0">已保存</div>`;
    void cpLoadList();
  });

  document.getElementById("cp-table")?.addEventListener("click", async (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    const id = t.getAttribute("data-id");
    if (t.getAttribute("data-cp") === "edit" && id) {
      CP.editId = parseInt(id, 10);
      const r = await fetch(`${API_BASE}/customer-profiles/${id}`);
      const it = await r.json();
      if (!r.ok) return;
      const title = document.getElementById("cp-modal-title");
      if (title) title.textContent = "编辑客户";
      const wrap = document.getElementById("cp-form-fields");
      if (wrap) {
        wrap.innerHTML = cpBuildFormFieldsHtml();
        cpFormValuesFromData(it);
      }
      cpOpenModal();
    }
    if (t.getAttribute("data-cp") === "del" && id) {
      if (!window.confirm("确定删除该条客户基础资料？")) return;
      const r2 = await fetch(`${API_BASE}/customer-profiles/${id}`, { method: "DELETE" });
      if (r2.ok) {
        void cpLoadList();
      } else {
        const x = await r2.json().catch(() => ({}));
        const el = document.getElementById("cp-msg");
        if (el) {
          el.innerHTML = `<div class="alert alert--error">${escapeHtml(x.detail || "删除失败")}</div>`;
        }
      }
    }
  });
  void cpLoadList();
}

const SM = {
  tab: "coord",
  cSkip: 0,
  pSkip: 0,
  cQ: "",
  pQ: "",
  limit: 20,
  editCoordId: null,
  editPairId: null,
};

async function smLoadCoord() {
  const wrap = document.getElementById("sm-coord-tbody");
  if (!wrap) return;
  wrap.innerHTML = `<tr><td colspan="6" class="empty-hint">加载中…</td></tr>`;
  const q = new URLSearchParams({
    skip: String(SM.cSkip),
    limit: String(SM.limit),
  });
  if (SM.cQ) q.set("search", SM.cQ);
  try {
    const r = await fetch(`${API_BASE}/store-coordinates?${q}`);
    const d = await r.json();
    if (!r.ok) {
      wrap.innerHTML = `<tr><td colspan="6" class="alert alert--error">加载失败</td></tr>`;
      return;
    }
    const elTotal = document.getElementById("sm-coord-total");
    if (elTotal) elTotal.textContent = `共 ${d.total} 条`;
    if (!d.items || !d.items.length) {
      wrap.innerHTML = `<tr><td colspan="6" class="empty-hint">暂无数据</td></tr>`;
      return;
    }
    wrap.innerHTML = d.items
      .map(
        (it) => `<tr>
      <td>${it.id}</td>
      <td>${escapeHtml(it.store_name || "")}</td>
      <td>${it.longitude}</td>
      <td>${it.latitude}</td>
      <td>${escapeHtml(it.data_source || "—")}</td>
      <td class="table-actions">
        <button type="button" class="btn btn--secondary btn--sm" data-sm="ec" data-id="${it.id}">编辑</button>
        <button type="button" class="btn btn--secondary btn--sm" data-sm="dc" data-id="${it.id}" style="color:var(--danger)">删除</button>
      </td>
    </tr>`,
      )
      .join("");
  } catch (e) {
    wrap.innerHTML = `<tr><td colspan="6">${backendUnreachableHtml(e)}</td></tr>`;
  }
}

async function smLoadPair() {
  const wrap = document.getElementById("sm-pair-tbody");
  if (!wrap) return;
  wrap.innerHTML = `<tr><td colspan="5" class="empty-hint">加载中…</td></tr>`;
  const q = new URLSearchParams({ skip: String(SM.pSkip), limit: String(SM.limit) });
  if (SM.pQ) q.set("search", SM.pQ);
  try {
    const r = await fetch(`${API_BASE}/store-pair-distances?${q}`);
    const d = await r.json();
    if (!r.ok) {
      wrap.innerHTML = `<tr><td colspan="5" class="alert alert--error">加载失败</td></tr>`;
      return;
    }
    const elTotal = document.getElementById("sm-pair-total");
    if (elTotal) elTotal.textContent = `共 ${d.total} 条`;
    if (!d.items || !d.items.length) {
      wrap.innerHTML = `<tr><td colspan="5" class="empty-hint">暂无数据</td></tr>`;
      return;
    }
    wrap.innerHTML = d.items
      .map(
        (it) => `<tr>
      <td>${it.id}</td>
      <td>${escapeHtml(it.store_from || "")}</td>
      <td>${escapeHtml(it.store_to || "")}</td>
      <td>${it.distance_km}</td>
      <td class="table-actions">
        <button type="button" class="btn btn--secondary btn--sm" data-sm="ep" data-id="${it.id}">编辑</button>
        <button type="button" class="btn btn--secondary btn--sm" data-sm="dp" data-id="${it.id}" style="color:var(--danger)">删除</button>
      </td>
    </tr>`,
      )
      .join("");
  } catch (e) {
    wrap.innerHTML = `<tr><td colspan="5">${backendUnreachableHtml(e)}</td></tr>`;
  }
}

function smRefreshVisibility() {
  const isC = SM.tab === "coord";
  document.getElementById("sm-tab-coord")?.classList.toggle("is-active", isC);
  document.getElementById("sm-tab-pair")?.classList.toggle("is-active", !isC);
  const pc = document.getElementById("sm-p-coord");
  const pp = document.getElementById("sm-p-pair");
  if (pc) pc.hidden = !isC;
  if (pp) pp.hidden = isC;
}

function renderStoreMaster() {
  SM.editCoordId = null;
  SM.editPairId = null;
  app.innerHTML = `
    <div class="page-head">
      <p>维护 <strong>门店坐标</strong>（<code>store_coordinate</code>）与 <strong>仓店有向距离</strong>（<code>store_pair_distance</code>）。导入 Excel 表头与脚本 <code>import_store_distances.py</code> 一致：客户1｜客户1坐标｜客户2｜客户2坐标｜距离（km）。</p>
    </div>
    <div class="subnav-tabs" role="tablist">
      <button type="button" class="subnav-tab" id="sm-tab-coord" data-sm-t="coord" role="tab">门店坐标</button>
      <button type="button" class="subnav-tab" id="sm-tab-pair" data-sm-t="pair" role="tab">仓店距离</button>
    </div>
    <div id="sm-p-coord" ${SM.tab === "pair" ? "hidden" : ""}>
      <div class="toolbar" style="flex-wrap:wrap">
        <div class="field" style="min-width:180px">
          <span class="field-label">搜索门店名</span>
          <input type="search" id="sm-cq" placeholder="模糊" value="${escapeHtml(SM.cQ)}" />
        </div>
        <button type="button" class="btn btn--secondary" id="sm-c-search">查询</button>
        <button type="button" class="btn btn--secondary" id="sm-c-refresh">刷新</button>
        <button type="button" class="btn btn--primary" id="sm-c-new">新增坐标</button>
        <a class="btn btn--secondary" id="sm-export" href="${API_BASE}/store-master/export" target="_blank" rel="noopener">导出 Excel</a>
        <div class="field" style="min-width:200px">
          <span class="field-label">导入</span>
          <input type="file" id="sm-c-file" accept=".xlsx" />
        </div>
        <button type="button" class="btn btn--primary" id="sm-c-import">上传导入</button>
        <span id="sm-coord-total" class="field-label" style="align-self:center"></span>
      </div>
      <div id="sm-coord-form" class="sm-form" hidden>
        <div class="field"><span class="field-label">门店名称</span><input id="sm-cfn" type="text" /></div>
        <div class="field"><span class="field-label">经度</span><input id="sm-cfl" type="number" step="any" /></div>
        <div class="field"><span class="field-label">纬度</span><input id="sm-cfa" type="number" step="any" /></div>
        <div class="field"><span class="field-label">数据来源</span><input id="sm-cfs" type="text" placeholder="可选" /></div>
        <div class="toolbar">
          <button type="button" class="btn btn--primary" id="sm-c-save">保存</button>
          <button type="button" class="btn btn--secondary" id="sm-c-cancel">取消</button>
        </div>
      </div>
      <div class="table-scroll">
        <table class="data-table" id="sm-coord-table">
          <thead><tr><th>ID</th><th>门店名称</th><th>经度</th><th>纬度</th><th>数据来源</th><th>操作</th></tr></thead>
          <tbody id="sm-coord-tbody"></tbody>
        </table>
      </div>
      <div class="toolbar">
        <button type="button" class="btn btn--secondary" id="sm-c-prev" ${SM.cSkip <= 0 ? "disabled" : ""}>上一页</button>
        <button type="button" class="btn btn--secondary" id="sm-c-next">下一页</button>
      </div>
    </div>
    <div id="sm-p-pair" ${SM.tab === "coord" ? "hidden" : ""}>
      <div class="toolbar" style="flex-wrap:wrap">
        <div class="field" style="min-width:180px">
          <span class="field-label">搜索起终点</span>
          <input type="search" id="sm-pq" placeholder="模糊" value="${escapeHtml(SM.pQ)}" />
        </div>
        <button type="button" class="btn btn--secondary" id="sm-p-search">查询</button>
        <button type="button" class="btn btn--secondary" id="sm-p-refresh">刷新</button>
        <button type="button" class="btn btn--primary" id="sm-p-new">新增有向边</button>
        <a class="btn btn--secondary" href="${API_BASE}/store-master/export" target="_blank" rel="noopener">导出 Excel</a>
        <div class="field" style="min-width:200px">
          <span class="field-label">导入</span>
          <input type="file" id="sm-p-file" accept=".xlsx" />
        </div>
        <button type="button" class="btn btn--primary" id="sm-p-import">上传导入</button>
        <span id="sm-pair-total" class="field-label" style="align-self:center"></span>
      </div>
      <div id="sm-pair-form" class="sm-form" hidden>
        <div class="field"><span class="field-label">起点</span><input id="sm-pff" type="text" /></div>
        <div class="field"><span class="field-label">终点</span><input id="sm-pft" type="text" /></div>
        <div class="field"><span class="field-label">距离 km</span><input id="sm-pfd" type="number" step="any" min="0" /></div>
        <div class="toolbar">
          <button type="button" class="btn btn--primary" id="sm-p-save">保存</button>
          <button type="button" class="btn btn--secondary" id="sm-p-cancel">取消</button>
        </div>
      </div>
      <div class="table-scroll">
        <table class="data-table" id="sm-pair-table">
          <thead><tr><th>ID</th><th>起点</th><th>终点</th><th>距离(km)</th><th>操作</th></tr></thead>
          <tbody id="sm-pair-tbody"></tbody>
        </table>
      </div>
      <div class="toolbar">
        <button type="button" class="btn btn--secondary" id="sm-p-prev" ${SM.pSkip <= 0 ? "disabled" : ""}>上一页</button>
        <button type="button" class="btn btn--secondary" id="sm-p-next">下一页</button>
      </div>
    </div>
    <div id="sm-msg" style="margin-top:12px"></div>`;
  smRefreshVisibility();
  document.getElementById("sm-tab-coord")?.addEventListener("click", () => {
    SM.tab = "coord";
    smRefreshVisibility();
    smLoadCoord();
  });
  document.getElementById("sm-tab-pair")?.addEventListener("click", () => {
    SM.tab = "pair";
    smRefreshVisibility();
    smLoadPair();
  });
  document.getElementById("sm-c-search")?.addEventListener("click", () => {
    SM.cQ = (document.getElementById("sm-cq")?.value || "").trim();
    SM.cSkip = 0;
    smLoadCoord();
  });
  document.getElementById("sm-c-refresh")?.addEventListener("click", () => {
    smLoadCoord();
  });
  document.getElementById("sm-p-search")?.addEventListener("click", () => {
    SM.pQ = (document.getElementById("sm-pq")?.value || "").trim();
    SM.pSkip = 0;
    smLoadPair();
  });
  document.getElementById("sm-p-refresh")?.addEventListener("click", () => {
    smLoadPair();
  });
  document.getElementById("sm-c-new")?.addEventListener("click", () => {
    SM.editCoordId = null;
    document.getElementById("sm-cfn").value = "";
    document.getElementById("sm-cfl").value = "";
    document.getElementById("sm-cfa").value = "";
    document.getElementById("sm-cfs").value = "";
    document.getElementById("sm-coord-form").hidden = false;
  });
  document.getElementById("sm-c-cancel")?.addEventListener("click", () => {
    document.getElementById("sm-coord-form").hidden = true;
  });
  document.getElementById("sm-c-save")?.addEventListener("click", async () => {
    const body = {
      store_name: (document.getElementById("sm-cfn")?.value || "").trim(),
      longitude: parseFloat(document.getElementById("sm-cfl")?.value),
      latitude: parseFloat(document.getElementById("sm-cfa")?.value),
      data_source: (document.getElementById("sm-cfs")?.value || "").trim() || null,
    };
    if (!body.store_name || Number.isNaN(body.longitude) || Number.isNaN(body.latitude)) {
      document.getElementById("sm-msg").innerHTML = `<div class="alert alert--error">请填写完整坐标</div>`;
      return;
    }
    const url = SM.editCoordId
      ? `${API_BASE}/store-coordinates/${SM.editCoordId}`
      : `${API_BASE}/store-coordinates`;
    const r = await fetch(url, {
      method: SM.editCoordId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      const em =
        typeof d.detail === "string" ? d.detail : JSON.stringify(d.detail || d || r.status);
      document.getElementById("sm-msg").innerHTML = `<div class="alert alert--error">${escapeHtml(em)}</div>`;
      return;
    }
    document.getElementById("sm-coord-form").hidden = true;
    document.getElementById("sm-msg").innerHTML = `<div class="alert" style="background:#ecfdf5;border-color:#a7f3d0">已保存</div>`;
    smLoadCoord();
  });
  document.getElementById("sm-c-prev")?.addEventListener("click", () => {
    if (SM.cSkip <= 0) return;
    SM.cSkip = Math.max(0, SM.cSkip - SM.limit);
    smLoadCoord();
  });
  document.getElementById("sm-c-next")?.addEventListener("click", () => {
    SM.cSkip += SM.limit;
    smLoadCoord();
  });
  document.getElementById("sm-p-new")?.addEventListener("click", () => {
    SM.editPairId = null;
    document.getElementById("sm-pff").value = "";
    document.getElementById("sm-pft").value = "";
    document.getElementById("sm-pfd").value = "";
    document.getElementById("sm-pair-form").hidden = false;
  });
  document.getElementById("sm-p-cancel")?.addEventListener("click", () => {
    document.getElementById("sm-pair-form").hidden = true;
  });
  document.getElementById("sm-p-save")?.addEventListener("click", async () => {
    const body = {
      store_from: (document.getElementById("sm-pff")?.value || "").trim(),
      store_to: (document.getElementById("sm-pft")?.value || "").trim(),
      distance_km: parseFloat(document.getElementById("sm-pfd")?.value),
    };
    if (!body.store_from || !body.store_to || Number.isNaN(body.distance_km)) {
      document.getElementById("sm-msg").innerHTML = `<div class="alert alert--error">请填写起终点与距离</div>`;
      return;
    }
    const url = SM.editPairId
      ? `${API_BASE}/store-pair-distances/${SM.editPairId}`
      : `${API_BASE}/store-pair-distances`;
    const r = await fetch(url, {
      method: SM.editPairId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      document.getElementById("sm-msg").innerHTML = `<div class="alert alert--error">${escapeHtml(
        (typeof d.detail === "string" ? d.detail : JSON.stringify(d.detail)) || r.status,
      )}</div>`;
      return;
    }
    document.getElementById("sm-pair-form").hidden = true;
    document.getElementById("sm-msg").innerHTML = `<div class="alert" style="background:#ecfdf5;border-color:#a7f3d0">已保存</div>`;
    smLoadPair();
  });
  document.getElementById("sm-p-prev")?.addEventListener("click", () => {
    if (SM.pSkip <= 0) return;
    SM.pSkip = Math.max(0, SM.pSkip - SM.limit);
    smLoadPair();
  });
  document.getElementById("sm-p-next")?.addEventListener("click", () => {
    SM.pSkip += SM.limit;
    smLoadPair();
  });
  const doImport = async (file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    document.getElementById("sm-msg").innerHTML = `<div class="alert alert--muted">正在上传…</div>`;
    const r = await fetch(`${API_BASE}/store-master/import?data_source=页面导入`, { method: "POST", body: fd });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      document.getElementById("sm-msg").innerHTML = `<div class="alert alert--error">${escapeHtml(
        d.detail || String(r.status),
      )}</div>`;
      return;
    }
    document.getElementById("sm-msg").innerHTML = `<div class="code-block"><pre>${escapeHtml(
      JSON.stringify(d, null, 2),
    )}</pre></div>`;
    smLoadCoord();
    smLoadPair();
  };
  document.getElementById("sm-c-import")?.addEventListener("click", () => {
    const f = document.getElementById("sm-c-file")?.files[0];
    doImport(f);
  });
  document.getElementById("sm-p-import")?.addEventListener("click", () => {
    const f = document.getElementById("sm-p-file")?.files[0];
    doImport(f);
  });
  document.getElementById("sm-coord-table")?.addEventListener("click", async (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    const id = t.getAttribute("data-id");
    if (t.getAttribute("data-sm") === "ec" && id) {
      SM.editCoordId = parseInt(id, 10);
      const r = await fetch(`${API_BASE}/store-coordinates/${id}`);
      const it = await r.json();
      if (!r.ok) return;
      document.getElementById("sm-cfn").value = it.store_name;
      document.getElementById("sm-cfl").value = it.longitude;
      document.getElementById("sm-cfa").value = it.latitude;
      document.getElementById("sm-cfs").value = it.data_source || "";
      document.getElementById("sm-coord-form").hidden = false;
    }
    if (t.getAttribute("data-sm") === "dc" && id) {
      if (!window.confirm("确定删除该门店坐标？")) return;
      const r2 = await fetch(`${API_BASE}/store-coordinates/${id}`, { method: "DELETE" });
      if (r2.ok) {
        smLoadCoord();
      } else {
        const x = await r2.json();
        document.getElementById("sm-msg").innerHTML = `<div class="alert alert--error">${escapeHtml(
          x.detail || "删除失败",
        )}</div>`;
      }
    }
  });
  document.getElementById("sm-pair-table")?.addEventListener("click", async (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    const id = t.getAttribute("data-id");
    if (t.getAttribute("data-sm") === "ep" && id) {
      SM.editPairId = parseInt(id, 10);
      const r = await fetch(`${API_BASE}/store-pair-distances/${id}`);
      const it = await r.json();
      if (!r.ok) return;
      document.getElementById("sm-pff").value = it.store_from;
      document.getElementById("sm-pft").value = it.store_to;
      document.getElementById("sm-pfd").value = it.distance_km;
      document.getElementById("sm-pair-form").hidden = false;
    }
    if (t.getAttribute("data-sm") === "dp" && id) {
      if (!window.confirm("确定删除该仓店距离？")) return;
      const r2 = await fetch(`${API_BASE}/store-pair-distances/${id}`, { method: "DELETE" });
      if (r2.ok) smLoadPair();
    }
  });
  if (SM.tab === "coord") smLoadCoord();
  else smLoadPair();
}

window.addEventListener("hashchange", route);
route();

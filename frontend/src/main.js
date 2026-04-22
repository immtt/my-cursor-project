const app = document.getElementById("app");
const API_ORIGIN = String(window.__API_ORIGIN__ || "http://127.0.0.1:8080").replace(/\/$/, "");
const API_BASE = `${API_ORIGIN}/api`;

function backendUnreachableHtml(err) {
  const detail = err && err.message ? `（${err.message}）` : "";
  return `<div class="alert alert--error">
    <strong>无法连接后端</strong>${detail}<br/>
    1）在项目根目录执行：<code>./scripts/start-dev.sh</code>（前后端一起启动）<br/>
    2）或仅后端：<code>cd backend &amp;&amp; source .venv/bin/activate &amp;&amp; uvicorn app.main:app --host 127.0.0.1 --port 8080</code><br/>
    3）浏览器打开自检：<a href="${API_ORIGIN}/health" target="_blank" rel="noopener">${API_ORIGIN}/health</a> 应返回 <code>{"status":"ok"}</code><br/>
    <small>默认接口端口为 8080（避免与 Mac 隔空播放占用 8000）。若改端口，请在 <code>index.html</code> 中于 main.js 之前设置 <code>window.__API_ORIGIN__</code>。</small>
  </div>`;
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
    try {
      const resp = await fetch(`${API_BASE}/import/${datasetType}`, { method: "POST", body: formData });
      const data = await resp.json();
      wrap.innerHTML = `<div class="code-block"><pre>${JSON.stringify(data, null, 2)}</pre></div>`;
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

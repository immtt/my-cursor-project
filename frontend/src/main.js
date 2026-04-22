const app = document.getElementById("app");
const API_BASE = "http://127.0.0.1:8000/api";

function routeMapIdFromHash() {
  const h = window.location.hash || "";
  if (!h.startsWith("#route-map")) return null;
  const q = h.indexOf("?");
  if (q === -1) return null;
  const id = new URLSearchParams(h.slice(q + 1)).get("id");
  return id ? parseInt(id, 10) : null;
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

function route() {
  const hash = window.location.hash || "#import";
  if (hash.startsWith("#route-map")) return renderRouteMap();
  if (hash === "#import") return renderImport();
  if (hash === "#data") return renderData();
  if (hash === "#compare") return renderCompare();
  if (hash === "#result") return renderResult();
  return renderImport();
}

function renderImport() {
  app.innerHTML = `
    <h2>数据导入</h2>
    <p>说明：同一排线日期 + 同一数据类型会执行覆盖导入（旧批次失效）。</p>
    <select id="datasetType">
      <option value="system">系统建议数据</option>
      <option value="manual">手动排线数据</option>
    </select>
    <input id="fileInput" type="file" accept=".xlsx,.xls" />
    <button id="importBtn">导入</button>
    <pre id="importResp"></pre>
  `;
  document.getElementById("importBtn").onclick = async () => {
    const datasetType = document.getElementById("datasetType").value;
    const file = document.getElementById("fileInput").files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    const resp = await fetch(`${API_BASE}/import/${datasetType}`, { method: "POST", body: formData });
    const data = await resp.json();
    document.getElementById("importResp").textContent = JSON.stringify(data, null, 2);
  };
}

function renderData() {
  app.innerHTML = `<h2>数据管理</h2><p>MVP阶段：可通过数据库或后端API扩展增删改查。</p>`;
}

function renderCompare() {
  app.innerHTML = `
    <h2>数据比对</h2>
    <input id="routeDate" type="date" />
    <button id="compareBtn">开始比对</button>
    <pre id="compareResp"></pre>
  `;
  document.getElementById("compareBtn").onclick = async () => {
    const routeDate = document.getElementById("routeDate").value;
    const resp = await fetch(`${API_BASE}/compare/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ route_date: routeDate, match_threshold: 0.5 }),
    });
    const data = await resp.json();
    if (data.calc?.failures?.length) {
      data.failed_stores = data.calc.failures;
    }
    document.getElementById("compareResp").textContent = JSON.stringify(data, null, 2);
  };
}

function renderResult() {
  app.innerHTML = `
    <h2>比对结果</h2>
    <input id="resultDate" type="date" />
    <select id="matchStatus">
      <option value="">全部</option>
      <option value="full">完全匹配</option>
      <option value="partial">部分匹配</option>
      <option value="none">未匹配</option>
    </select>
    <button id="queryBtn">查询</button>
    <button id="exportBtn">导出CSV</button>
    <pre id="overview"></pre>
    <table>
      <thead>
        <tr>
          <th>地图</th>
          <th>系统运单号</th><th>手动运单号</th><th>匹配状态</th><th>门店匹配率</th>
          <th>匹配度</th><th>体积差异</th><th>线路一致</th><th>公里数差异</th><th>时效差异</th>
        </tr>
      </thead>
      <tbody id="resultTable"></tbody>
    </table>
  `;
  document.getElementById("queryBtn").onclick = async () => {
    const routeDate = document.getElementById("resultDate").value;
    const status = document.getElementById("matchStatus").value;
    const overviewResp = await fetch(`${API_BASE}/compare/overview?route_date=${routeDate}`);
    const overviewData = await overviewResp.json();
    document.getElementById("overview").textContent = JSON.stringify(overviewData, null, 2);
    const resultResp = await fetch(`${API_BASE}/compare/results?route_date=${routeDate}&match_status=${status}`);
    const rows = await resultResp.json();
    document.getElementById("resultTable").innerHTML = rows
      .map(
        (r) =>
          `<tr><td><button type="button" class="map-btn" data-crid="${r.id}">地图</button></td><td>${r.sys_waybill_no ?? ""}</td><td>${r.manual_waybill_no ?? ""}</td><td>${r.match_status}</td>
      <td>${r.store_match_rate}</td><td>${r.match_score ?? ""}</td><td>${r.volume_diff ?? ""}</td><td>${r.line_consistent}</td>
      <td>${r.est_distance_diff ?? ""}</td><td>${r.est_duration_diff ?? ""}</td></tr>`
      )
      .join("");
  };
  document.getElementById("exportBtn").onclick = () => {
    const routeDate = document.getElementById("resultDate").value;
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
    <h2>路线地图</h2>
    <p style="font-size:13px;color:#555">默认读取 <code>frontend/amap-config.local.js</code>（见 <code>amap-config.example.js</code>）。
      也可在控制台设置 <code>localStorage.amap_web_key</code> / <code>amap_security_js_code</code> 覆盖。</p>
    <p id="routeMapMeta"></p>
    <div id="mapContainer"></div>
    <p id="routeMapErr" style="color:#c00;"></p>
    <p><a href="#result">返回比对结果</a></p>
  `;
  const errEl = document.getElementById("routeMapErr");
  const metaEl = document.getElementById("routeMapMeta");
  if (!rid || Number.isNaN(rid)) {
    errEl.textContent = "缺少比对行 id，请从结果列表点击「地图」进入。";
    return;
  }

  (async () => {
    let data;
    try {
      const resp = await fetch(`${API_BASE}/compare/route-map/${rid}`);
      if (!resp.ok) {
        errEl.textContent = resp.status === 404 ? "未找到该比对记录。" : `请求失败 ${resp.status}`;
        return;
      }
      data = await resp.json();
    } catch (e) {
      errEl.textContent = "无法连接后端，请确认服务已启动。";
      return;
    }

    metaEl.innerHTML = `<strong>${data.warehouse_name || ""}</strong> · 匹配 <code>${data.match_status}</code> ·
      系统 <code>${data.sys_waybill_no ?? "—"}</code> · 手工 <code>${data.manual_waybill_no ?? "—"}</code>
      <span style="margin-left:12px;color:#1677FF">■ 系统</span> <span style="color:#FF4D4F">■ 手工</span>`;

    const key =
      (typeof window.__AMAP_WEB_KEY__ === "string" && window.__AMAP_WEB_KEY__) ||
      localStorage.getItem("amap_web_key") ||
      "";
    const securityJsCode =
      (typeof window.__AMAP_SECURITY_JS_CODE__ === "string" && window.__AMAP_SECURITY_JS_CODE__) ||
      localStorage.getItem("amap_security_js_code") ||
      "";
    if (!key) {
      errEl.textContent =
        "未检测到地图 Key（请配置 frontend/amap-config.local.js 或 localStorage.amap_web_key），已仅在下方展示路径点数。";
      const pre = document.createElement("pre");
      pre.style.fontSize = "12px";
      pre.textContent = JSON.stringify(
        {
          system_points: data.system?.path?.length ?? 0,
          manual_points: data.manual?.path?.length ?? 0,
        },
        null,
        2
      );
      app.insertBefore(pre, document.getElementById("mapContainer"));
      return;
    }

    try {
      await loadAmapScript(key, securityJsCode);
    } catch {
      errEl.textContent = "高德脚本加载失败。";
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
      errEl.textContent = "当前记录无可用轨迹数据（可能补算未完成或缺少门店）。";
    }
  })();
}

window.addEventListener("hashchange", route);
route();

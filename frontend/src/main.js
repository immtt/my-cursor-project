const app = document.getElementById("app");
const API_BASE = "http://127.0.0.1:8000/api";

function route() {
  const hash = window.location.hash || "#import";
  if (hash === "#import") return renderImport();
  if (hash === "#data") return renderData();
  if (hash === "#compare") return renderCompare();
  if (hash === "#result") return renderResult();
  return renderImport();
}

function renderImport() {
  app.innerHTML = `
    <h2>数据导入</h2>
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
          <th>系统运单号</th><th>手动运单号</th><th>匹配状态</th><th>门店匹配率</th>
          <th>体积差异率</th><th>线路一致</th><th>公里数差异</th><th>时效差异</th>
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
        (r) => `<tr><td>${r.sys_waybill_no ?? ""}</td><td>${r.manual_waybill_no ?? ""}</td><td>${r.match_status}</td>
      <td>${r.store_match_rate}</td><td>${r.volume_diff_rate ?? ""}</td><td>${r.line_consistent}</td>
      <td>${r.est_distance_diff ?? ""}</td><td>${r.est_duration_diff ?? ""}</td></tr>`
      )
      .join("");
  };
  document.getElementById("exportBtn").onclick = () => {
    const routeDate = document.getElementById("resultDate").value;
    window.open(`${API_BASE}/compare/export?route_date=${routeDate}`, "_blank");
  };
}

window.addEventListener("hashchange", route);
route();

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

/** 将地址栏中 `#/xxx` 规范为 `#xxx`，与侧栏 `href="#import"` 等一致，避免 `/#/login` 时路由不命中 */
function normalizeHashPathSegment(seg) {
  const s = (seg || "").split("?")[0];
  if (s.startsWith("#/") && s.length > 2) return `#${s.slice(2)}`;
  return s;
}

function currentRoutePath() {
  return normalizeHashPathSegment((window.location.hash || "#import").split("?")[0]);
}

const AUTH_TOKEN_KEY = "smart_route_jwt";
const AUTH_ME_KEY = "smart_route_me";

function getAuthToken() {
  return sessionStorage.getItem(AUTH_TOKEN_KEY) || "";
}

function getAuthUser() {
  try {
    const s = sessionStorage.getItem(AUTH_ME_KEY);
    if (!s) return null;
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function setAuthUser(u) {
  if (u == null) sessionStorage.removeItem(AUTH_ME_KEY);
  else sessionStorage.setItem(AUTH_ME_KEY, JSON.stringify(u));
}

function clearAuth() {
  sessionStorage.removeItem(AUTH_TOKEN_KEY);
  sessionStorage.removeItem(AUTH_ME_KEY);
}

function getAuthHeader() {
  const t = getAuthToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/**
 * 请求业务 API 时自动附加 Bearer，并在 401/403 时清理凭证回到登录（登录接口除外）。
 * @param {string} url
 * @param {RequestInit} [options]
 */
async function apiFetch(url, options = {}) {
  const o = { ...options };
  const baseH = { ...getAuthHeader() };
  if (o.headers instanceof Headers) {
    o.headers.forEach((v, k) => {
      baseH[k] = v;
    });
  } else if (o.headers && typeof o.headers === "object") {
    Object.assign(baseH, o.headers);
  }
  o.headers = baseH;
  const r = await fetch(url, o);
  if ((r.status === 401 || r.status === 403) && !String(url).includes("/auth/login")) {
    clearAuth();
    if (currentRoutePath() !== "#login") {
      location.hash = "#login";
    }
  }
  return r;
}

/** 已登录请求后触发浏览器下载（用于原 `target=_blank` 的导出，需带 Bearer） */
async function downloadBlobFromApiUrl(url, filename) {
  const r = await apiFetch(url);
  if (!r.ok) {
    window.alert(`下载失败（HTTP ${r.status}）`);
    return;
  }
  const blob = await r.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

const IMPORT_LAST_BATCH_KEY = "smart_route_import_last_batch";
const IMPORT_LIST_VIEW_TYPE_KEY = "smart_route_import_list_view_type";
const IMPORT_LIST_RANGE_FROM_KEY = "smart_route_data_list_from";
const IMPORT_LIST_RANGE_TO_KEY = "smart_route_data_list_to";
const IMPORT_LIST_STORE_KEY = "smart_route_import_list_store";
const BRAND_NAME_KEY = "smart_route_brand_display_name";
const BRAND_LOGO_KEY = "smart_route_brand_logo_data_url";
/** 多品牌配置（本机 localStorage） */
const BRAND_IDENTITIES_KEY = "smart_route_brand_identities_v1";
const DEFAULT_BRAND_NAME = "供应链非正式行为";
const DEFAULT_BRAND_LOGO_PATH = "./brand-logo.png";
/** 常见 App / PWA 主图标与侧栏：正方、适中分辨率；与「≥32 / ≤1024」校验一致 */
const BRAND_LOGO_RECOMM_PX = 512;
const BRAND_LOGO_MAX_SIDE = 1024;
const BRAND_LOGO_MIN_SIDE = 32;
const BRAND_LOGO_MAX_FILE_BYTES = Math.floor(1.2 * 1024 * 1024);

function genBrandId() {
  return `b_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * @returns {{ id: string, name: string, logoDataUrl: string | null }[]}
 */
function loadBrandIdentities() {
  const legacyName = (() => {
    const s = localStorage.getItem(BRAND_NAME_KEY);
    if (s != null && String(s).trim() !== "") return String(s).trim();
    return null;
  })();
  const legacyLogo = (() => {
    const s = localStorage.getItem(BRAND_LOGO_KEY);
    if (s != null && String(s).startsWith("data:")) return s;
    return null;
  })();
  try {
    const raw = localStorage.getItem(BRAND_IDENTITIES_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) {
        return arr
          .map((o) => ({
            id: o && o.id != null && String(o.id) ? String(o.id) : genBrandId(),
            name: o && o.name != null ? String(o.name) : "",
            logoDataUrl:
              o && o.logoDataUrl != null && String(o.logoDataUrl).startsWith("data:") ? String(o.logoDataUrl) : null,
          }))
          .filter((o) => o.id);
      }
    }
  } catch {
    /* fallthrough */
  }
  if (legacyName || legacyLogo) {
    return [
      {
        id: genBrandId(),
        name: legacyName && legacyName.trim() ? legacyName : DEFAULT_BRAND_NAME,
        logoDataUrl: legacyLogo,
      },
    ];
  }
  return [{ id: genBrandId(), name: DEFAULT_BRAND_NAME, logoDataUrl: null }];
}

/**
 * @param {{ id: string, name: string, logoDataUrl: string | null }[]} list
 */
function persistBrandIdentities(list) {
  const safe = list.map((o) => ({
    id: o.id,
    name: o.name,
    logoDataUrl: o.logoDataUrl && String(o.logoDataUrl).startsWith("data:") ? o.logoDataUrl : null,
  }));
  try {
    localStorage.setItem(BRAND_IDENTITIES_KEY, JSON.stringify(safe));
    localStorage.removeItem(BRAND_NAME_KEY);
    localStorage.removeItem(BRAND_LOGO_KEY);
  } catch (e) {
    throw e;
  }
}

function getBrandDisplayName() {
  const list = loadBrandIdentities();
  const p = list[0];
  if (p && String(p.name || "").trim() !== "") return String(p.name).trim();
  return DEFAULT_BRAND_NAME;
}

function getBrandLogoDataUrl() {
  const list = loadBrandIdentities();
  const p = list[0];
  if (!p) return null;
  const s = p.logoDataUrl;
  if (s && String(s).startsWith("data:")) return s;
  return null;
}

function getBrandLogoUrlForDisplay() {
  return getBrandLogoDataUrl() || DEFAULT_BRAND_LOGO_PATH;
}

function applyBrandingToShell() {
  const name = getBrandDisplayName();
  const url = getBrandLogoUrlForDisplay();
  document.querySelectorAll(".sidebar__brand-logo").forEach((el) => {
    el.src = url;
  });
  const titleEl = document.querySelector(".sidebar__brand-title");
  if (titleEl) titleEl.textContent = name;
  document.title = name;
  const linkIcon = document.querySelector('link[rel="icon"]');
  if (linkIcon) {
    linkIcon.href = url;
    if (url.startsWith("data:")) {
      const m = /^data:([^;,]+)/.exec(url);
      if (m) {
        const t = m[1];
        linkIcon.type = t === "image/svg+xml" ? "image/svg+xml" : t;
      }
    } else {
      linkIcon.type = "image/png";
    }
  }
  document.querySelector('link[rel="apple-touch-icon"]')?.setAttribute("href", url);
}

/**
 * 校验品牌图示尺寸与类型；SVG 不校验像素边长、仅校大小与格式。
 * @param {File} file
 * @returns {Promise<{ dataUrl: string, w: number, h: number, isSvg: boolean }>}
 */
function processBrandImageFile(file) {
  return new Promise((resolve, reject) => {
    const allowed = new Set([
      "image/png",
      "image/jpeg",
      "image/jpg",
      "image/webp",
      "image/svg+xml",
    ]);
    if (!allowed.has(file.type)) {
      reject(new Error("请使用 PNG、JPEG、WebP 或 SVG 格式的文件。"));
      return;
    }
    if (file.size > BRAND_LOGO_MAX_FILE_BYTES) {
      reject(new Error(`单文件需 ≤ ${Math.round((BRAND_LOGO_MAX_FILE_BYTES / 1024 / 1024) * 10) / 10}MB（与浏览器本地存储常见上限适配）。`));
      return;
    }
    const isSvg = file.type === "image/svg+xml";
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl !== "string") {
        reject(new Error("无法读取文件。"));
        return;
      }
      if (isSvg) {
        resolve({ dataUrl, w: 0, h: 0, isSvg: true });
        return;
      }
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (w < BRAND_LOGO_MIN_SIDE || h < BRAND_LOGO_MIN_SIDE) {
          reject(
            new Error(
              `图示像素边长需 ≥ ${BRAND_LOGO_MIN_SIDE}px（当前 ${w}×${h}）。`,
            ),
          );
          return;
        }
        if (w > BRAND_LOGO_MAX_SIDE || h > BRAND_LOGO_MAX_SIDE) {
          reject(
            new Error(
              `图示单边需 ≤ ${BRAND_LOGO_MAX_SIDE}px，请先按常见规格导出（当前 ${w}×${h}，推荐 ${BRAND_LOGO_RECOMM_PX}×${BRAND_LOGO_RECOMM_PX} 方图）。`,
            ),
          );
          return;
        }
        resolve({ dataUrl, w, h, isSvg: false });
      };
      img.onerror = () => reject(new Error("无法解析为位图，请换一张图片。"));
      img.src = dataUrl;
    };
    reader.onerror = () => reject(new Error("读取文件失败。"));
    reader.readAsDataURL(file);
  });
}

/** 品牌标识页多行；路由重复进入时先 abort 避免重复监听 */
let _brandIdentityPageAC = null;

function _brandListMsg(host, text, isErr) {
  if (!host) return;
  host.style.display = text ? "block" : "none";
  host.className = isErr ? "alert alert--error" : "alert alert--muted";
  host.textContent = text || "";
}

/**
 * 侧栏弹窗：仅编辑「主展示」= 列表中第一项
 * @param {{ onAfterSave?: () => void, saveOkHint?: string, resetOkHint?: string, signal?: AbortSignal }} meta
 * @returns {{ resetPendingState: () => void }}
 */
function attachBrandIdentityModalPrimaryHandlers(meta) {
  const { onAfterSave, saveOkHint = "已保存并应用。", resetOkHint = "已把主展示恢复为默认。", signal } = meta || {};
  const nameIn = document.getElementById("brandModalNameInput");
  const fileIn = document.getElementById("brandModalLogoFile");
  const prev = document.getElementById("brandModalPreview");
  const msg = document.getElementById("brandModalMsg");
  const saveBtn = document.getElementById("brandModalSaveBtn");
  const resetBtn = document.getElementById("brandModalResetBtn");
  let pendingDataUrl = null;
  const showM = (text, isErr) => {
    if (!msg) return;
    msg.style.display = text ? "block" : "none";
    msg.className = isErr ? "alert alert--error" : "alert alert--muted";
    msg.textContent = text;
  };
  const resetPendingState = () => {
    pendingDataUrl = null;
    if (fileIn) fileIn.value = "";
    if (prev) prev.src = getBrandLogoUrlForDisplay();
  };
  const add = (el, type, fn) => {
    if (!el) return;
    el.addEventListener(type, fn, signal ? { signal } : undefined);
  };
  add(fileIn, "change", () => {
    const f = fileIn && fileIn.files && fileIn.files[0];
    if (!f) {
      pendingDataUrl = null;
      if (prev) prev.src = getBrandLogoUrlForDisplay();
      showM("", false);
      return;
    }
    void processBrandImageFile(f)
      .then((ok) => {
        pendingDataUrl = ok.dataUrl;
        if (prev) prev.src = ok.dataUrl;
        showM(ok.isSvg ? "已选择 SVG。点击保存以写入主展示。" : `已解析 ${ok.w}×${ok.h} px。点保存。`, false);
      })
      .catch((e) => {
        pendingDataUrl = null;
        if (prev) prev.src = getBrandLogoUrlForDisplay();
        showM(e instanceof Error ? e.message : String(e), true);
        if (fileIn) fileIn.value = "";
      });
  });
  add(saveBtn, "click", () => {
    const name = (nameIn && nameIn.value) || "";
    const n = String(name).trim() || DEFAULT_BRAND_NAME;
    const list = loadBrandIdentities();
    if (list.length === 0) list.push({ id: genBrandId(), name: n, logoDataUrl: null });
    else list[0].name = n;
    if (pendingDataUrl) list[0].logoDataUrl = pendingDataUrl;
    try {
      persistBrandIdentities(list);
    } catch (e) {
      showM(
        e && e.name === "QuotaExceededError" ? "本机存储空间不足，请减缩图示或删行后重试。" : (e && e.message) || String(e),
        true,
      );
      return;
    }
    applyBrandingToShell();
    if (prev) prev.src = getBrandLogoUrlForDisplay();
    if (fileIn) fileIn.value = "";
    pendingDataUrl = null;
    if (nameIn) nameIn.value = getBrandDisplayName();
    showM(saveOkHint, false);
    onAfterSave && onAfterSave();
  });
  add(resetBtn, "click", () => {
    const list = loadBrandIdentities();
    if (list.length === 0) list.push({ id: genBrandId(), name: DEFAULT_BRAND_NAME, logoDataUrl: null });
    list[0].name = DEFAULT_BRAND_NAME;
    list[0].logoDataUrl = null;
    try {
      persistBrandIdentities(list);
    } catch (e) {
      showM(e && e.message ? String(e.message) : String(e), true);
      return;
    }
    pendingDataUrl = null;
    if (fileIn) fileIn.value = "";
    if (nameIn) nameIn.value = DEFAULT_BRAND_NAME;
    if (prev) prev.src = DEFAULT_BRAND_LOGO_PATH;
    applyBrandingToShell();
    showM(resetOkHint, false);
  });
  return { resetPendingState };
}

function _brandRowPreviewSrc(row) {
  const s = row && row.logoDataUrl;
  if (s && String(s).startsWith("data:")) return s;
  return DEFAULT_BRAND_LOGO_PATH;
}

function _brandListRowsHtml(list) {
  return list
    .map((row, i) => {
      const nm = row && row.name != null ? String(row.name) : "";
      return `<div class="brand-identity-row" data-brand-id="${escapeHtml(String(row.id))}" data-brand-idx="${i}">
    <div class="brand-identity-row__head">
      <span class="brand-identity-row__badge">${i === 0 ? "主展示（侧栏/标题/页签）" : `品牌 ${i + 1}`}</span>
    </div>
    <div class="brand-identity-row__body">
      <div class="field" style="margin:0;flex:1;min-width:8rem;max-width:20rem">
        <span class="field-label">品牌名称</span>
        <input type="text" class="cp-input brand-identity-row__name" maxlength="80" autocomplete="off" spellcheck="false" value="${escapeHtml(
          nm,
        )}" placeholder="与对外展示一致" />
      </div>
      <div class="field" style="margin:0">
        <span class="field-label">品牌图示</span>
        <input type="file" class="input-file brand-identity-row__file" accept="image/png,image/jpeg,image/webp,image/svg+xml" />
      </div>
    </div>
    <div class="brand-identity-row__mark">
      <img class="brand-identity-row__logo" width="80" height="80" alt="" src="${DEFAULT_BRAND_LOGO_PATH}" data-bi-preview="1" />
      <div class="brand-identity-row__actions">
        <button type="button" class="btn btn--primary btn--sm" data-bi-action="save">保存本行</button>
        ${i > 0 ? '<button type="button" class="btn btn--secondary btn--sm" data-bi-action="primary">设为主展示</button>' : ""}
        <button type="button" class="btn btn--secondary btn--sm" data-bi-action="remove" ${
          list.length <= 1 ? "disabled" : ""
        }>删除</button>
      </div>
    </div>
  </div>`;
    })
    .join("");
}

function _hydrateBrandListPreviews() {
  const list = loadBrandIdentities();
  const byId = new Map(list.map((r) => [r.id, r]));
  document.querySelectorAll(".brand-identity-row[data-brand-id]").forEach((wrap) => {
    const id = wrap.getAttribute("data-brand-id");
    const row = id ? byId.get(id) : null;
    if (!row) return;
    const im = wrap.querySelector("[data-bi-preview]");
    if (im) im.src = _brandRowPreviewSrc(row);
  });
}

function renderBrandIdentitiesListShell() {
  const host = document.getElementById("brandIdentitiesList");
  if (!host) return;
  const list = loadBrandIdentities();
  host.innerHTML = _brandListRowsHtml(list);
  _hydrateBrandListPreviews();
}

function bindBrandIdentityPage() {
  const msg = document.getElementById("brandIdentityMsg");
  _brandIdentityPageAC?.abort();
  _brandIdentityPageAC = new AbortController();
  const sig = _brandIdentityPageAC.signal;
  const pendingById = new Map();
  const showPageMsg = (t, e) => _brandListMsg(msg, t, e);

  renderBrandIdentitiesListShell();

  const listEl = document.getElementById("brandIdentitiesList");
  if (listEl) {
    listEl.addEventListener(
      "click",
      (ev) => {
        const t = ev.target;
        if (!(t instanceof Element)) return;
        const row = t.closest(".brand-identity-row");
        const act = t.closest("[data-bi-action]");
        if (!row || !act) return;
        const id = row.getAttribute("data-brand-id");
        if (!id) return;
        const action = act.getAttribute("data-bi-action");
        const list0 = loadBrandIdentities();
        const idx = list0.findIndex((x) => x.id === id);
        if (idx < 0) return;

        if (action === "save") {
          const nameIn = row.querySelector(".brand-identity-row__name");
          const name = (nameIn && nameIn.value) != null ? String(nameIn.value).trim() : "";
          if (!name) {
            showPageMsg("请填写该行的品牌名称后再保存。", true);
            return;
          }
          const patch = { name, logoDataUrl: list0[idx].logoDataUrl };
          if (pendingById.has(id)) {
            patch.logoDataUrl = pendingById.get(id) || null;
          }
          try {
            const listA = loadBrandIdentities();
            const j = listA.findIndex((x) => x.id === id);
            if (j < 0) return;
            listA[j].name = name;
            listA[j].logoDataUrl = patch.logoDataUrl;
            persistBrandIdentities(listA);
          } catch (e) {
            showPageMsg(
              e && e.name === "QuotaExceededError" ? "本机存储空间不足，请使用更小的图片或删除部分品牌行。" : String(e),
              true,
            );
            return;
          }
          pendingById.delete(id);
          if (idx === 0) applyBrandingToShell();
          const im = row.querySelector("[data-bi-preview]");
          const rSaved = loadBrandIdentities().find((x) => x.id === id);
          if (im && rSaved) im.src = _brandRowPreviewSrc(rSaved);
          showPageMsg("该行已保存。", false);
          return;
        }
        if (action === "primary") {
          if (idx === 0) return;
          const listB = loadBrandIdentities();
          const [moved] = listB.splice(idx, 1);
          listB.unshift(moved);
          persistBrandIdentities(listB);
          applyBrandingToShell();
          renderBrandIdentitiesListShell();
          showPageMsg("已设为主展示（列表首行）。", false);
          return;
        }
        if (action === "remove") {
          if (list0.length <= 1) {
            showPageMsg("请至少保留一条品牌标识。", true);
            return;
          }
          if (!window.confirm("确定删除该条品牌行？")) return;
          const listC = loadBrandIdentities().filter((x) => x.id !== id);
          persistBrandIdentities(listC);
          pendingById.delete(id);
          applyBrandingToShell();
          renderBrandIdentitiesListShell();
          showPageMsg("已删除。", false);
        }
      },
      { signal: sig },
    );
    listEl.addEventListener(
      "change",
      (ev) => {
        const t = ev.target;
        if (!(t instanceof HTMLInputElement) || t.type !== "file" || !t.classList.contains("brand-identity-row__file")) return;
        const row = t.closest(".brand-identity-row");
        if (!row) return;
        const id = row.getAttribute("data-brand-id");
        if (!id) return;
        const f = t.files && t.files[0];
        if (!f) {
          pendingById.delete(id);
          const list = loadBrandIdentities();
          const r = list.find((x) => x.id === id);
          const im = row.querySelector("[data-bi-preview]");
          if (im) im.src = r ? _brandRowPreviewSrc(r) : DEFAULT_BRAND_LOGO_PATH;
          return;
        }
        void processBrandImageFile(f)
          .then((ok) => {
            pendingById.set(id, ok.dataUrl);
            const im = row.querySelector("[data-bi-preview]");
            if (im) im.src = ok.dataUrl;
            showPageMsg("已选中新文件，请点「保存本行」写入。", false);
          })
          .catch((e) => {
            showPageMsg(e instanceof Error ? e.message : String(e), true);
            t.value = "";
          });
      },
      { signal: sig },
    );
  }

  const addBtn = document.getElementById("brandAddRowBtn");
  addBtn?.addEventListener(
    "click",
    () => {
      const list = loadBrandIdentities();
      list.push({ id: genBrandId(), name: "", logoDataUrl: null });
      try {
        persistBrandIdentities(list);
      } catch (e) {
        showPageMsg(String(e), true);
        return;
      }
      renderBrandIdentitiesListShell();
      showPageMsg("已添加一行。请填写名称、上传图示后点「保存本行」。", false);
    },
    { signal: sig },
  );

  const resetAll = document.getElementById("brandResetAllBtn");
  resetAll?.addEventListener(
    "click",
    () => {
      if (!window.confirm("将清空多品牌配置，只保留一条内置默认主展示。确定？")) return;
      pendingById.clear();
      const list = [{ id: genBrandId(), name: DEFAULT_BRAND_NAME, logoDataUrl: null }];
      try {
        persistBrandIdentities(list);
      } catch (e) {
        showPageMsg(String(e), true);
        return;
      }
      applyBrandingToShell();
      renderBrandIdentitiesListShell();
      showPageMsg("已恢复为单条默认品牌，并已应用到侧栏。", false);
    },
    { signal: sig },
  );
}

function initBrandIdentityModal() {
  const modal = document.getElementById("brandIdentityModal");
  if (!modal) return;
  const nameIn = document.getElementById("brandModalNameInput");
  const { resetPendingState } = attachBrandIdentityModalPrimaryHandlers({
    onAfterSave: () => {
      modal.classList.remove("modal--open");
      modal.hidden = true;
    },
  });
  const open = () => {
    resetPendingState();
    if (nameIn) nameIn.value = getBrandDisplayName();
    const pMsg = document.getElementById("brandModalMsg");
    if (pMsg) {
      pMsg.style.display = "none";
      pMsg.textContent = "";
    }
    modal.hidden = false;
    modal.classList.add("modal--open");
    nameIn && nameIn.focus();
  };
  const close = () => {
    modal.classList.remove("modal--open");
    modal.hidden = true;
  };
  const brandInner = document.querySelector(".sidebar__brand-inner");
  brandInner && brandInner.addEventListener("click", (e) => {
    e.preventDefault();
    open();
  });
  brandInner && brandInner.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  });
  modal.querySelectorAll("[data-brand-modal-close]").forEach((el) => {
    el.addEventListener("click", close);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal && modal.classList.contains("modal--open")) close();
  });
}

/** 由 renderResult / renderDiffAnalysis 挂接；导入成功后仅刷新展示（后台已重算比对）。 */
let _refetchCompareDisplayOnly = null;
let _refetchDiffAnalysis = null;

/** 门店差异列表（仅一侧有）客户端分页用 */
let _diffAnalysisStoreListSnapshot = null;
const DIFF_STORE_LIST_DEFAULT_PAGE_SIZE = 20;
const DIFF_STORE_LIST_PAGE_SIZES = [20, 50];

function _normalizedStoreDiffArrays(sd) {
  const onlySys = Array.isArray(sd?.only_in_system) ? sd.only_in_system : [];
  const onlyMan = Array.isArray(sd?.only_in_manual) ? sd.only_in_manual : [];
  return { onlySys, onlyMan };
}

/**
 * 门店对称差表 + 分页条（仅 innerHTML 片段，无外层 h4）
 * @param {object} sd store_diff
 * @param {number} page
 * @param {number} pageSize
 */
function renderDiffAnalysisStoreListSectionHTML(sd, page, pageSize) {
  const { onlySys, onlyMan } = _normalizedStoreDiffArrays(sd);
  const ps = DIFF_STORE_LIST_PAGE_SIZES.includes(Number(pageSize))
    ? Number(pageSize)
    : DIFF_STORE_LIST_DEFAULT_PAGE_SIZE;
  if (onlySys.length === 0 && onlyMan.length === 0) {
    return `<div class="table-scroll table-scroll--diff-stores">
    <table class="data-table data-table--diff-stores" aria-label="仅系统有与仅手工有的门店名">
    <thead><tr><th>仅系统侧有</th><th>仅手工侧有</th></tr></thead>
    <tbody><tr><td colspan="2" class="empty-hint">两侧配送门店集合（去重）一致，无仅单侧门店。</td></tr></tbody>
    </table></div>`;
  }
  const nRows = Math.max(onlySys.length, onlyMan.length);
  const totalPages = Math.max(1, Math.ceil(nRows / ps) || 1);
  const p = Math.max(1, Math.min(Number(page) || 1, totalPages));
  const start = (p - 1) * ps;
  const end = Math.min(start + ps, nRows);
  const listRows = [];
  for (let i = start; i < end; i += 1) {
    const left =
      onlySys[i] != null && String(onlySys[i]).trim() !== ""
        ? escapeHtml(String(onlySys[i]))
        : "—";
    const right =
      onlyMan[i] != null && String(onlyMan[i]).trim() !== ""
        ? escapeHtml(String(onlyMan[i]))
        : "—";
    listRows.push(`<tr><td>${left}</td><td>${right}</td></tr>`);
  }
  const sizeOpts = DIFF_STORE_LIST_PAGE_SIZES.map(
    (n) => `<option value="${n}" ${ps === n ? "selected" : ""}>${n} 行</option>`,
  ).join("");
  const pager = `<div class="diff-store-list-pager toolbar" role="navigation" aria-label="门店差异列表分页">
    <p class="diff-store-list-pager__summary">第 <strong>${p}</strong> / ${totalPages} 页 · 共 <strong>${nRows}</strong> 行 <span class="empty-hint">（左右两列按行号对齐，行数以较长一侧为准）</span></p>
    <div class="field">
      <span class="field-label">每页</span>
      <select id="diffAnalysisStoreListPageSize" aria-label="每页行数">${sizeOpts}</select>
    </div>
    <button type="button" class="btn btn--secondary" id="diffAnalysisStoreListPrev" ${p <= 1 ? "disabled" : ""} aria-label="上一页">上一页</button>
    <button type="button" class="btn btn--primary" id="diffAnalysisStoreListNext" ${
      p >= totalPages ? "disabled" : ""
    } aria-label="下一页">下一页</button>
  </div>`;
  return `<div class="diff-store-list-paged" data-page="${p}" data-total-pages="${totalPages}">
  <div class="table-scroll table-scroll--diff-stores">
    <table class="data-table data-table--diff-stores" aria-label="仅系统有与仅手工有的门店名">
    <thead><tr><th>仅系统侧有</th><th>仅手工侧有</th></tr></thead>
    <tbody>${listRows.join("")}</tbody>
    </table>
  </div>
  ${pager}
  </div>`;
}

function bindDiffAnalysisStoreListPager() {
  const section = document.getElementById("diffAnalysisStoreListSection");
  if (!section || !_diffAnalysisStoreListSnapshot) return;
  const wrap = section.querySelector(".diff-store-list-paged");
  const pCur = Number(wrap?.getAttribute("data-page")) || 1;
  const tps = Number(wrap?.getAttribute("data-total-pages")) || 1;
  const go = (targetPage, explicitPageSize) => {
    let ps0 = Number(explicitPageSize);
    if (!DIFF_STORE_LIST_PAGE_SIZES.includes(ps0)) {
      const el = document.getElementById("diffAnalysisStoreListPageSize");
      ps0 = Number(el?.value) || DIFF_STORE_LIST_DEFAULT_PAGE_SIZE;
      if (!DIFF_STORE_LIST_PAGE_SIZES.includes(ps0)) {
        ps0 = DIFF_STORE_LIST_DEFAULT_PAGE_SIZE;
      }
    }
    const { onlySys, onlyMan } = _normalizedStoreDiffArrays(_diffAnalysisStoreListSnapshot);
    const nRows = Math.max(onlySys.length, onlyMan.length);
    const totalPages = nRows > 0 ? Math.max(1, Math.ceil(nRows / ps0) || 1) : 1;
    const p = Math.max(1, Math.min(Number(targetPage) || 1, totalPages));
    section.innerHTML = renderDiffAnalysisStoreListSectionHTML(
      _diffAnalysisStoreListSnapshot,
      p,
      ps0,
    );
    bindDiffAnalysisStoreListPager();
  };
  document.getElementById("diffAnalysisStoreListPrev")?.addEventListener("click", () => {
    if (pCur <= 1) return;
    go(pCur - 1);
  });
  document.getElementById("diffAnalysisStoreListNext")?.addEventListener("click", () => {
    if (pCur >= tps) return;
    go(pCur + 1);
  });
  document.getElementById("diffAnalysisStoreListPageSize")?.addEventListener("change", (e) => {
    go(1, Number(e.target.value));
  });
}

function renderDiffAnalysisWbLoadSummaryP(sum, datasetType) {
  const w = sum || {};
  const n = Number(w.waybill_count) || 0;
  const avg = w.avg_store_count != null && w.avg_store_count !== "" ? Number(w.avg_store_count) : 0;
  const avgStr = Number.isFinite(avg) ? String(avg) : "0";
  if (datasetType === "all") {
    const sc = Number(w.system_waybill_count) || 0;
    const sa =
      w.system_avg_store_count != null && w.system_avg_store_count !== ""
        ? Number(w.system_avg_store_count)
        : 0;
    const mc = Number(w.manual_waybill_count) || 0;
    const ma =
      w.manual_avg_store_count != null && w.manual_avg_store_count !== ""
        ? Number(w.manual_avg_store_count)
        : 0;
    return `<p class="diff-wbload-summary">在筛选范围内共 <strong>${n}</strong> 条运单；<strong>平均每条运单配载</strong> <strong>${avgStr}</strong> 家门店（拼载列去重）。系统 <strong>${sc}</strong> 单、单均 <strong>${Number.isFinite(sa) ? sa : 0}</strong> 家；手工 <strong>${mc}</strong> 单、单均 <strong>${Number.isFinite(ma) ? ma : 0}</strong> 家。</p>`;
  }
  if (datasetType === "system") {
    return `<p class="diff-wbload-summary">在筛选范围内共 <strong>${n}</strong> 条系统运单；<strong>平均每条运单配载</strong> <strong>${avgStr}</strong> 家门店（拼载列去重）。</p>`;
  }
  return `<p class="diff-wbload-summary">在筛选范围内共 <strong>${n}</strong> 条手工运单；<strong>平均每条运单配载</strong> <strong>${avgStr}</strong> 家门店（拼载列去重）。</p>`;
}

/** 如：1 家门店 2 单；2 家门店 3 单 */
function formatWbLoadDistributionLine(dist) {
  if (!dist || typeof dist !== "object") return "—";
  const keys = Object.keys(dist).sort((a, b) => Number(a) - Number(b));
  if (keys.length === 0) return "—";
  return keys
    .map((k) => {
      const c = dist[k];
      return `${k} 家门店 <strong>${c}</strong> 单`;
    })
    .join("；");
}

function renderWbLoadByVehicleTypeTable(bv, datasetType) {
  const rows = Array.isArray(bv) ? bv : [];
  if (rows.length === 0) {
    return "";
  }
  const colHead =
    datasetType === "all"
      ? `<th scope="col" style="width:5rem">侧别</th><th scope="col" style="min-width:6rem">车型</th><th scope="col" class="td-num" style="width:5rem">运单数</th><th scope="col">各配载店数档（命中运单数）</th><th scope="col" class="td-num" style="width:7rem">单均配载店数</th>`
      : `<th scope="col" style="min-width:6rem">车型</th><th scope="col" class="td-num" style="width:5rem">运单数</th><th scope="col">各配载店数档（命中运单数）</th><th scope="col" class="td-num" style="width:7rem">单均配载店数</th>`;
  const body = rows
    .map((r) => {
      const vt = escapeHtml(String(r.vehicle_type || "—"));
      const wc = String(Number(r.waybill_count) || 0);
      const distHtml = formatWbLoadDistributionLine(r.store_count_distribution);
      const avg = r.avg_store_count != null && r.avg_store_count !== "" ? Number(r.avg_store_count) : 0;
      const avgS = Number.isFinite(avg) ? avg.toFixed(2) : "0.00";
      if (datasetType === "all") {
        const side = r.dataset_type === "system" ? "系统" : "手工";
        return `<tr><td>${escapeHtml(side)}</td><td>${vt}</td><td class="td-num">${wc}</td><td class="td-dist">${distHtml}</td><td class="td-num">${avgS}</td></tr>`;
      }
      return `<tr><td>${vt}</td><td class="td-num">${wc}</td><td class="td-dist">${distHtml}</td><td class="td-num">${avgS}</td></tr>`;
    })
    .join("");
  return `<div class="diff-wbload-vt-wrap">
  <h4 class="diff-wbload-vt__title">按车型 · 配载门店数分布与单均</h4>
  <p class="empty-hint diff-wbload-vt__sub">在<strong>当前排线起止、仓库、数据范围</strong>内，按车型统计：各「1 / 2 / 3… 家配载」档上的运单条数，以及该车型在筛选区间内的<strong>平均每条运单</strong>配载门店数（店名去重，与文首全样本均值为同一数据口径）。</p>
  <div class="table-scroll table-scroll--diff-wbload-vt">
  <table class="data-table data-table--diff-wbload-vt" aria-label="按车型配载分布">
  <thead><tr>${colHead}</tr></thead>
  <tbody>${body}</tbody>
  </table>
  </div>
  </div>`;
}

function renderDiffAnalysisWaybillLoadInner(wsl, datasetType) {
  if (!wsl || typeof wsl !== "object") {
    return '<p class="empty-hint">无法加载运单配载分析。</p>';
  }
  const byVt = wsl.by_vehicle_type;
  return `${renderDiffAnalysisWbLoadSummaryP(wsl.summary, datasetType)}
  ${renderWbLoadByVehicleTypeTable(byVt, datasetType)}
  <p class="empty-hint" style="margin:12px 0 0;max-width:48rem">本区块不展示按运单逐行明细，仅保留<strong>全样本单均</strong>与<strong>按车型</strong>的配载店数分布与单均。统计均基于 <code>is_active=1</code> 运单，<strong>配载门店数</strong> = 「拼载门店」经去重后的店名个数。</p>`;
}

function refetchDiffAndCompareAfterImport() {
  try {
    if (typeof _refetchDiffAnalysis === "function") _refetchDiffAnalysis();
  } catch {
    /* ignore */
  }
  try {
    if (typeof _refetchCompareDisplayOnly === "function") _refetchCompareDisplayOnly();
  } catch {
    /* ignore */
  }
}

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

/** 一店多车表：不展示「手工排线 + 项次 1」行（系统侧项次 1 仍展示）。 */
function filterDiffAnalysisWaybills(wbs) {
  return (wbs || []).filter(
    (w) => !(String(w.dataset_type) === "manual" && Number(w.item_seq) === 1),
  );
}

/** 按 data set 分侧，顺序固定为手工 → 系统，与「来源」列一致。 */
function groupDiffAnalysisWaybillsByDatasetType(wbs) {
  const by = { manual: [], system: [] };
  for (const w of wbs) {
    const t = String(w.dataset_type) === "system" ? "system" : "manual";
    by[t].push(w);
  }
  const out = [];
  if (by.manual.length) out.push({ dataset_type: "manual", waybills: by.manual });
  if (by.system.length) out.push({ dataset_type: "system", waybills: by.system });
  return out;
}

/** 项次按「同侧、过滤后」从 1 起展示，避免隐藏手工项次 1 后仍显示原序号 2 与运单数不一致。 */
function diffMvItemSeqBlock(waybills) {
  if (waybills.length === 0) return "—";
  if (waybills.length === 1) {
    return "1";
  }
  return (
    `<div class="diff-mv-box">` +
    waybills
      .map(
        (_w, i) =>
          `<div class="diff-mv-box__row">${escapeHtml(String(i + 1))}</div>`,
      )
      .join("") +
    `</div>`
  );
}

function diffMvWaybillBlock(waybills) {
  if (waybills.length <= 1) {
    return `<code>${escapeHtml(String(waybills[0].waybill_no || ""))}</code>`;
  }
  return (
    `<div class="diff-mv-box">` +
    waybills
      .map(
        (w) =>
          `<div class="diff-mv-box__row"><code>${escapeHtml(String(w.waybill_no || ""))}</code></div>`,
      )
      .join("") +
    `</div>`
  );
}

/** 排线差异表：系统与手工运单同列，用标签区分。 */
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

/** 排线差异表：不同门店分侧展示，系统 / 手工标签与运单列一致。 */
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
  "排序ID",
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

function renderImportListTableRowsOnly(rows, page, pageSize) {
  const p = Math.max(1, Number(page) || 1);
  const ps = Number(pageSize) || 20;
  const off = (p - 1) * ps;
  const head = IMPORT_LIST_TABLE_HEADERS.map((t) => `<th>${escapeHtml(t)}</th>`).join("");
  const body = (rows || [])
    .map((r, idx) => {
      const sortOrder =
        r.sort_order != null && r.sort_order !== "" ? r.sort_order : off + idx + 1;
      const cells = [
        sortOrder,
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
  selectedStore = "",
  warehouseOptions = [],
}) {
  const safeFrom = dateFrom || "";
  const safeTo = dateTo || "";
  const wh = selectedWarehouse || "";
  const st = (selectedStore != null && String(selectedStore)) || "";
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
        : renderImportListTableRowsOnly(items, page, pageSize);
  const rangeSummary =
    safeFrom && safeTo ? ` · 排线 ${escapeHtml(safeFrom)}～${escapeHtml(safeTo)}` : "";
  return `<div id="importListPanel" class="import-list-panel" data-query-mode="range" data-date-from="${escapeHtml(
    safeFrom
  )}" data-date-to="${escapeHtml(safeTo)}" data-warehouse="${escapeHtml(
    wh
  )}" data-store="${escapeHtml(st)}" data-page="${page}" data-total="${total}">
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
        <div class="field field--grow">
          <span class="field-label">拼载门店</span>
          <input type="search" id="importListStore" class="import-list-store-input" value="${escapeHtml(
            st
          )}" placeholder="子串，含于拼载即匹配" autocomplete="off" enterkeyhint="search" />
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

async function fetchImportBatchPage(datasetType, batchId, page, pageSize, storeName = "") {
  const q = new URLSearchParams({
    dataset_type: datasetType,
    batch_id: batchId,
    page: String(page),
    page_size: String(pageSize),
  });
  const s = (storeName || "").trim();
  if (s) q.set("store_name", s);
  const r = await apiFetch(`${API_BASE}/import-batch?${q}`);
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
  storeName = "",
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
  const st = (storeName || "").trim();
  if (st) q.set("store_name", st);
  const r = await apiFetch(`${API_BASE}/import-active?${q}`);
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
    selectedStore = "",
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
    selectedStore,
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
  let storeName = options.storeName;
  if (storeName == null) {
    const sEl = wrap.querySelector("#importListStore");
    storeName = sEl != null ? sEl.value : panelEl?.dataset.store ?? "";
  }
  if (storeName == null) storeName = "";
  storeName = String(storeName).trim();

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
      storeName,
    );
    updateImportListPanelDom(wrap, {
      selectedDatasetType: datasetType,
      page,
      pageSize,
      payload,
      dateFrom,
      dateTo,
      selectedWarehouse: warehouseName || "",
      selectedStore: storeName,
      warehouseOptions: payload.warehouse_options,
    });
    sessionStorage.setItem(IMPORT_LIST_RANGE_FROM_KEY, dateFrom);
    sessionStorage.setItem(IMPORT_LIST_RANGE_TO_KEY, dateTo);
    sessionStorage.setItem(IMPORT_LIST_STORE_KEY, storeName);
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
  const storeName = wrap.querySelector("#importListStore")?.value ?? panel.dataset.store ?? "";
  await syncImportListPanel(wrap, {
    datasetType,
    page,
    pageSize,
    dateFrom,
    dateTo,
    warehouseName,
    storeName,
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
    const storeName = wrap.querySelector("#importListStore")?.value ?? panel?.dataset.store ?? "";
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
        storeName,
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
        storeName,
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
        storeName,
      });
    } else if (t.id === "importListStore") {
      const datasetType = wrap.querySelector("#importListSource")?.value || "system";
      const pageSize = Number(wrap.querySelector("#importListPageSize")?.value) || 20;
      void syncImportListPanel(wrap, {
        datasetType,
        page: 1,
        pageSize,
        dateFrom,
        dateTo,
        warehouseName,
        storeName: t.value ?? "",
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
          const r = await apiFetch(`${API_BASE}/manual/backfill`, {
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
      const storeName = wrap.querySelector("#importListStore")?.value ?? "";
      void syncImportListPanel(wrap, {
        datasetType,
        page: 1,
        pageSize,
        dateFrom: from,
        dateTo: to,
        warehouseName,
        storeName,
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
    const storeName = wrap.querySelector("#importListStore")?.value ?? panel.dataset.store ?? "";
    if (prev && page > 1) {
      void syncImportListPanel(wrap, {
        datasetType,
        page: page - 1,
        pageSize,
        dateFrom,
        dateTo,
        warehouseName,
        storeName,
      });
    } else if (next && page < totalPages) {
      void syncImportListPanel(wrap, {
        datasetType,
        page: page + 1,
        pageSize,
        dateFrom,
        dateTo,
        warehouseName,
        storeName,
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
  const savedStore = sessionStorage.getItem(IMPORT_LIST_STORE_KEY) || "";
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
        selectedStore: savedStore,
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
    storeName: savedStore,
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
  if (currentRoutePath() !== "#route-map") return null;
  const q = h.indexOf("?");
  if (q === -1) return null;
  const id = new URLSearchParams(h.slice(q + 1)).get("id");
  return id ? parseInt(id, 10) : null;
}

function syncNav() {
  const base = currentRoutePath();
  document.querySelectorAll(".nav-tab").forEach((el) => {
    const r = el.getAttribute("data-route");
    const active = base === r || (base === "#route-map" && r === "#result");
    el.classList.toggle("is-active", active);
  });
}

function updateAdminNavFromUser(user) {
  const li = document.getElementById("admin-nav-item");
  if (li) li.hidden = !user || !user.is_admin;
}

function refreshHeaderAuth() {
  const u = getAuthUser();
  const w = document.getElementById("workspace-auth");
  const lab = document.getElementById("auth-user-label");
  const onLogin = currentRoutePath() === "#login";
  if (lab) lab.textContent = u && u.username ? u.username : "";
  if (w) {
    if (!getAuthToken() || onLogin) w.setAttribute("hidden", "");
    else w.removeAttribute("hidden");
  }
}

async function syncAuthMe() {
  if (!getAuthToken()) {
    updateAdminNavFromUser(null);
    refreshHeaderAuth();
    return;
  }
  const r = await apiFetch(`${API_BASE}/auth/me`);
  if (r.ok) {
    const u = await r.json();
    setAuthUser(u);
    updateAdminNavFromUser(u);
  } else {
    clearAuth();
    updateAdminNavFromUser(null);
  }
  refreshHeaderAuth();
}

function bindAuthLogout() {
  document.getElementById("auth-logout")?.addEventListener("click", () => {
    clearAuth();
    updateAdminNavFromUser(null);
    refreshHeaderAuth();
    location.hash = "#login";
  });
}

function renderLogin() {
  setWorkspaceTitle("登录");
  document.title = `${getBrandDisplayName()} · 登录`;
  const auth = document.getElementById("workspace-auth");
  if (auth) auth.setAttribute("hidden", "");
  const brandName = getBrandDisplayName();
  const logoUrl = getBrandLogoUrlForDisplay();
  app.innerHTML = `
    <div class="login-card" role="region" aria-labelledby="login-system-name">
      <header class="login-card__brand">
        <img class="login-card__logo" width="72" height="72" alt="" decoding="async" id="login-brand-logo" />
        <div class="login-card__brand-text">
          <h1 class="login-card__system-name" id="login-system-name">${escapeHtml(brandName)}</h1>
          <p class="login-card__tagline">智能排线工作台</p>
        </div>
      </header>
      <div class="login-card__body">
        <p class="login-card__hint">无账号请联系管理员在后台开通。</p>
        <form id="login-form" class="login-form" autocomplete="on">
          <div class="field">
            <span class="field-label">用户名</span>
            <input type="text" id="login-user" name="username" class="login-form__input" autocomplete="username" required />
          </div>
          <div class="field">
            <span class="field-label">密码</span>
            <input type="password" id="login-pass" name="password" class="login-form__input" autocomplete="current-password" required />
          </div>
          <p id="login-msg" class="alert alert--error login-card__msg" style="display:none" role="alert"></p>
          <button type="submit" class="btn btn--primary login-card__submit" id="login-submit">登录</button>
        </form>
      </div>
    </div>`;
  const logoEl = document.getElementById("login-brand-logo");
  if (logoEl) logoEl.src = logoUrl;
  document.getElementById("login-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const u = (document.getElementById("login-user")?.value || "").trim();
    const p = (document.getElementById("login-pass")?.value || "");
    const msg = document.getElementById("login-msg");
    if (msg) {
      msg.style.display = "none";
      msg.textContent = "";
    }
    const r = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: u, password: p }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (msg) {
        msg.style.display = "block";
        msg.textContent = typeof j.detail === "string" ? j.detail : "登录失败";
      }
      return;
    }
    sessionStorage.setItem(AUTH_TOKEN_KEY, j.access_token);
    if (j.user) {
      setAuthUser(j.user);
      updateAdminNavFromUser(j.user);
      refreshHeaderAuth();
    } else {
      void syncAuthMe();
    }
    applyBrandingToShell();
    location.hash = "#import";
  });
}

function renderAdmin() {
  setWorkspaceCrumb("智能排线");
  setWorkspaceTitle("用户管理");
  const u0 = getAuthUser();
  if (!u0 || !u0.is_admin) {
    app.innerHTML = `<p class="empty-hint">需要管理员权限。</p>`;
    return;
  }
  app.innerHTML = `
    <div class="page-head page-head--compact">
      <p class="empty-hint" style="margin:0">仅管理员可创建或维护账号。自助注册与找回密码已关闭。</p>
    </div>
    <div class="toolbar" style="flex-wrap:wrap;align-items:flex-end;gap:12px">
      <div class="field" style="min-width:120px">
        <span class="field-label">用户名</span>
        <input type="text" id="admin-new-user" placeholder="新登录名" />
      </div>
      <div class="field" style="min-width:120px">
        <span class="field-label">初始密码</span>
        <input type="text" id="admin-new-pass" placeholder="至少 1 个字符" />
      </div>
      <div class="field" style="min-width:80px">
        <span class="field-label">管理员</span>
        <label class="field-inline"><input type="checkbox" id="admin-new-is-admin" /> 是</label>
      </div>
      <button type="button" class="btn btn--primary" id="admin-btn-create">创建用户</button>
    </div>
    <div id="admin-msg" style="margin-top:8px"></div>
    <div class="table-scroll" style="margin-top:16px">
      <table class="data-table" id="admin-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>用户名</th>
            <th>启用</th>
            <th>管理员</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody id="admin-tbody"></tbody>
      </table>
    </div>
    <div id="admin-modal" class="modal" hidden>
      <div class="modal__backdrop" data-adm-close></div>
      <div class="modal__dialog" role="dialog" aria-modal="true">
        <h2 class="modal__title">重置密码</h2>
        <p class="empty-hint" style="margin-top:0">用户 <span id="admin-rp-name"></span></p>
        <div class="field">
          <span class="field-label">新密码</span>
          <input type="text" id="admin-rp-pass" />
        </div>
        <div class="modal__actions">
          <button type="button" class="btn btn--secondary" data-adm-close>取消</button>
          <button type="button" class="btn btn--primary" id="admin-rp-ok">保存</button>
        </div>
      </div>
    </div>`;

  const tbody = document.getElementById("admin-tbody");
  const adminMsg = document.getElementById("admin-msg");
  const modal = document.getElementById("admin-modal");
  let resetId = null;

  const load = async () => {
    if (!tbody) return;
    const r = await apiFetch(`${API_BASE}/admin/users`);
    if (!r.ok) {
      if (adminMsg) adminMsg.innerHTML = `<div class="alert alert--error">加载失败（${r.status}）</div>`;
      return;
    }
    const rows = await r.json();
    if (!Array.isArray(rows)) return;
    tbody.innerHTML = rows
      .map(
        (x) => `<tr data-uid="${x.id}">
  <td>${x.id}</td>
  <td>${escapeHtml(x.username)}</td>
  <td><label><input type="checkbox" class="admin-chk-active" data-uid="${x.id}" ${x.is_active ? "checked" : ""} /></label></td>
  <td><label><input type="checkbox" class="admin-chk-role" data-uid="${x.id}" ${x.is_admin ? "checked" : ""} /></label></td>
  <td>
    <button type="button" class="btn btn--secondary btn--sm admin-btn-rp" data-uid="${x.id}">重置密码</button>
  </td>
</tr>`,
      )
      .join("");
  };

  void load();

  document.getElementById("admin-btn-create")?.addEventListener("click", async () => {
    const username = (document.getElementById("admin-new-user")?.value || "").trim();
    const password = document.getElementById("admin-new-pass")?.value || "";
    const is_admin = !!document.getElementById("admin-new-is-admin")?.checked;
    if (!adminMsg) return;
    if (!username || !password) {
      adminMsg.innerHTML = `<div class="alert alert--error">请填写用户名与密码</div>`;
      return;
    }
    const r = await apiFetch(`${API_BASE}/admin/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, is_active: true, is_admin }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      adminMsg.innerHTML = `<div class="alert alert--error">${escapeHtml(
        typeof d.detail === "string" ? d.detail : "创建失败",
      )}</div>`;
      return;
    }
    adminMsg.innerHTML = `<div class="alert" style="background:#ecfdf5;border-color:#a7f3d0">已创建</div>`;
    if (document.getElementById("admin-new-user")) document.getElementById("admin-new-user").value = "";
    if (document.getElementById("admin-new-pass")) document.getElementById("admin-new-pass").value = "";
    void load();
  });

  tbody?.addEventListener("change", async (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLInputElement)) return;
    const uid = t.getAttribute("data-uid");
    if (!uid) return;
    const id = parseInt(uid, 10);
    if (t.classList.contains("admin-chk-active")) {
      const r = await apiFetch(`${API_BASE}/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: t.checked }),
      });
      if (!r.ok) {
        t.checked = !t.checked;
        if (adminMsg) adminMsg.innerHTML = `<div class="alert alert--error">更新失败</div>`;
      } else if (adminMsg) adminMsg.innerHTML = "";
    }
    if (t.classList.contains("admin-chk-role")) {
      const r = await apiFetch(`${API_BASE}/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_admin: t.checked }),
      });
      if (!r.ok) {
        t.checked = !t.checked;
        if (adminMsg) adminMsg.innerHTML = `<div class="alert alert--error">更新失败</div>`;
      } else {
        const me = getAuthUser();
        if (me && id === me.id) {
          void syncAuthMe();
        }
        if (adminMsg) adminMsg.innerHTML = "";
      }
    }
  });

  tbody?.addEventListener("click", (ev) => {
    const b = ev.target;
    if (!(b instanceof HTMLElement)) return;
    if (!b.classList.contains("admin-btn-rp")) return;
    const uid = b.getAttribute("data-uid");
    if (!uid) return;
    resetId = parseInt(uid, 10);
    const row = b.closest("tr");
    const nameCell = row && row.querySelector("td:nth-child(2)");
    const nm = nameCell ? nameCell.textContent : "";
    const nameEl = document.getElementById("admin-rp-name");
    if (nameEl) nameEl.textContent = String(nm);
    const pi = document.getElementById("admin-rp-pass");
    if (pi) pi.value = "";
    if (modal) modal.removeAttribute("hidden");
  });

  modal?.querySelectorAll("[data-adm-close]").forEach((b) => {
    b.addEventListener("click", () => {
      if (modal) modal.setAttribute("hidden", "");
    });
  });
  document.getElementById("admin-rp-ok")?.addEventListener("click", async () => {
    if (resetId == null) return;
    const p = (document.getElementById("admin-rp-pass")?.value || "").trim();
    if (!p) {
      if (adminMsg) adminMsg.innerHTML = `<div class="alert alert--error">请填写新密码</div>`;
      return;
    }
    const r = await apiFetch(`${API_BASE}/admin/users/${resetId}/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ new_password: p }),
    });
    if (r.ok) {
      if (modal) modal.setAttribute("hidden", "");
      if (adminMsg) adminMsg.innerHTML = `<div class="alert" style="background:#ecfdf5;border-color:#a7f3d0">密码已更新</div>`;
    } else {
      if (adminMsg) adminMsg.innerHTML = `<div class="alert alert--error">重置失败</div>`;
    }
  });
}

function setWorkspaceTitle(title) {
  const el = document.getElementById("workspace-page-title");
  if (el) el.textContent = title;
}

function setWorkspaceCrumb(text) {
  const el = document.getElementById("workspace-l1-crumb");
  if (el) el.textContent = text;
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
const COMPARE_RESULT_PAGE_SIZES = [20, 50, 100];
let _compareResultPage = 1;
let _compareResultPageSize = 20;

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
            <td>${escapeHtml(String(r.sys_vehicle_type ?? "—"))}</td>
            <td>${escapeHtml(String(r.manual_vehicle_type ?? "—"))}</td>
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

function _getCompareResultPageSlice() {
  const sorted = getSortedCompareResultRows();
  const n = sorted.length;
  const ps = COMPARE_RESULT_PAGE_SIZES.includes(_compareResultPageSize)
    ? _compareResultPageSize
    : 20;
  const totalPages = n === 0 ? 1 : Math.max(1, Math.ceil(n / ps));
  if (_compareResultPage > totalPages) _compareResultPage = totalPages;
  if (_compareResultPage < 1) _compareResultPage = 1;
  const start = (_compareResultPage - 1) * ps;
  const slice = sorted.slice(start, start + ps);
  return { n, ps, totalPages, slice };
}

function refreshCompareResultPager(meta) {
  const wrap = document.getElementById("compareResultPagerWrap");
  const sumEl = document.getElementById("compareResultPagerSummary");
  const prev = document.getElementById("compareResultPrev");
  const next = document.getElementById("compareResultNext");
  const sizeSel = document.getElementById("compareResultPageSize");
  if (!wrap || !sumEl) return;
  const { n, totalPages } = meta;
  if (n === 0) {
    wrap.style.display = "none";
    wrap.setAttribute("aria-hidden", "true");
    return;
  }
  wrap.style.display = "";
  wrap.setAttribute("aria-hidden", "false");
  sumEl.textContent = `第 ${_compareResultPage} / ${totalPages} 页 · 共 ${n} 条`;
  if (prev) prev.disabled = _compareResultPage <= 1;
  if (next) next.disabled = _compareResultPage >= totalPages;
  if (sizeSel && String(sizeSel.value) !== String(_compareResultPageSize)) {
    sizeSel.value = String(_compareResultPageSize);
  }
}

function refreshCompareResultTable() {
  const tbody = document.getElementById("resultTable");
  if (!tbody) return;
  const meta = _getCompareResultPageSlice();
  const { slice, n } = meta;
  if (n === 0) {
    tbody.innerHTML = "";
  } else {
    tbody.innerHTML = buildCompareResultTableRowsHtml(slice);
  }
  refreshCompareResultThead();
  refreshCompareResultPager(meta);
}

function onCompareResultSortThClick(key) {
  if (!key) return;
  if (_compareResultSort.key === key) {
    _compareResultSort.dir = _compareResultSort.dir === "asc" ? "desc" : "asc";
  } else {
    _compareResultSort.key = key;
    _compareResultSort.dir = "asc";
  }
  _compareResultPage = 1;
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
  const rdf = o.route_date_from != null ? o.route_date_from : o.route_date;
  const rdt = o.route_date_to != null ? o.route_date_to : o.route_date;
  const sameDay =
    rdf && rdt && String(rdf).slice(0, 10) === String(rdt).slice(0, 10);
  const drLabel = sameDay ? `排线日 ${n(rdf)}` : `排线 ${n(rdf)} ～ ${n(rdt)}`;
  return `
    <p class="empty-hint" style="margin:0 0 10px;font-size:0.86rem;font-weight:600;color:var(--text)">${drLabel}</p>
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

function renderBrandIdentity() {
  app.innerHTML = `
    <div class="page-head">
      <p>支持<strong>多行品牌</strong>，每行可单独维护 <strong>名称 + 图示</strong>。侧栏、浏览器页签、窗口标题使用<strong>第一行</strong>（可点「设为主展示」将某行调到最上）。数据写入本机 <code>localStorage</code>，仅本机可见。</p>
    </div>
    <div class="brand-identity-block">
      <p class="brand-identity-hint">
        图示建议：<strong>${BRAND_LOGO_RECOMM_PX}×${BRAND_LOGO_RECOMM_PX} px</strong> 方图、PNG 或 WebP；单边
        <strong>${BRAND_LOGO_MIN_SIDE}～${BRAND_LOGO_MAX_SIDE} px</strong>，单文件 <strong>≤ 1.2MB</strong>。亦支持 SVG。选完文件后须点该行的 <strong>保存本行</strong> 才会落库（主展示为第 1 行时同时刷新侧栏）。
      </p>
      <p id="brandIdentityMsg" class="alert" style="display:none" role="status"></p>
      <div class="toolbar brand-identity-list-toolbar" style="flex-wrap:wrap;align-items:center;gap:8px">
        <button type="button" class="btn btn--secondary" id="brandAddRowBtn">添加品牌</button>
        <button type="button" class="btn btn--secondary" id="brandResetAllBtn" title="清空多品牌，只留一条系统默认主展示">全部恢复为内置默认</button>
      </div>
      <p class="empty-hint" style="margin:0 0 10px">与「<strong>仓库主数据</strong>」里的业务品牌不是同一数据；本页为<strong>本系统</strong>侧栏/展示用。</p>
      <div id="brandIdentitiesList" class="brand-identity-list" role="list"></div>
    </div>
  `;
  bindBrandIdentityPage();
}

function route() {
  _refetchCompareDisplayOnly = null;
  _refetchDiffAnalysis = null;
  setWorkspaceCrumb("智能排线");
  const hash = window.location.hash || "#import";
  const path = currentRoutePath();
  if (path === "#login") {
    if (getAuthToken()) {
      location.replace(`${location.pathname}${location.search}#import`);
      return;
    }
    document.body.classList.add("app-auth--login");
    setWorkspaceTitle("登录");
    renderLogin();
    syncNav();
    refreshHeaderAuth();
    return;
  }
  document.body.classList.remove("app-auth--login");
  if (!getAuthToken()) {
    location.hash = "#login";
    return;
  }
  void syncAuthMe();
  if (path === "#admin") {
    renderAdmin();
    syncNav();
    refreshHeaderAuth();
    refreshApiStatusBanner();
    return;
  }
  if (path === "#route-map") {
    renderRouteMap();
    setWorkspaceTitle("路线地图");
  } else if (path === "#net-map") {
    setWorkspaceCrumb("仓网规划");
    renderNetMap();
    setWorkspaceTitle("仓网地图");
  } else if (path === "#warehouse-base") {
    setWorkspaceCrumb("仓网规划");
    renderWarehouseBase();
    setWorkspaceTitle("仓库基础数据");
  } else if (path === "#import") {
    renderImport();
    setWorkspaceTitle("数据导入");
  } else if (path === "#diff-analysis") {
    renderDiffAnalysis();
    setWorkspaceTitle("差异分析");
  } else if (path === "#store-master") {
    renderStoreMaster();
    setWorkspaceTitle("仓店距离");
  } else if (path === "#customer-profiles") {
    renderCustomerProfiles();
    setWorkspaceTitle("客户基础数据");
  } else if (path === "#brand-identity") {
    setWorkspaceCrumb("仓网规划");
    renderBrandIdentity();
    setWorkspaceTitle("品牌标识");
  } else if (path === "#compare" || path === "#result") {
    if (path === "#compare") {
      history.replaceState(null, "", `${location.pathname}${location.search}#result`);
    }
    renderResult();
    setWorkspaceTitle("排线差异");
  } else {
    renderImport();
    setWorkspaceTitle("数据导入");
  }
  refreshHeaderAuth();
  syncNav();
  refreshApiStatusBanner();
}

/**
 * 一店多车按日趋势：分组柱（系统 / 手工侧「多车店」数），SVG。
 * @param {HTMLElement} host
 * @param {Array<{ route_date: string, system_multi_vehicle_store_count: number, manual_multi_vehicle_store_count: number }>} series
 */
function renderDiffAnalysisTrendChart(host, series) {
  if (!host) return;
  if (!Array.isArray(series) || series.length === 0) {
    host.innerHTML = "";
    return;
  }
  const padL = 40;
  const padR = 16;
  const padT = 12;
  const padB = 40;
  const W = 720;
  const H = 200;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = series.length;
  const sysV = series.map((s) => Number(s.system_multi_vehicle_store_count) || 0);
  const manV = series.map((s) => Number(s.manual_multi_vehicle_store_count) || 0);
  const maxY = Math.max(1, ...sysV, ...manV, 0.0001);
  const yBase = padT + innerH;
  const barH = (v) => (v / maxY) * innerH;
  const slotW = innerW / n;
  const innerGap = 1.5;
  const barPairMax = Math.min(slotW * 0.9, Math.max(4, 0.75 * slotW));
  const barW = Math.max(2, (barPairMax - innerGap) / 2);
  const groupCenters = Array.from({ length: n }, (_, i) => padL + (i + 0.5) * slotW);
  const rects = [];
  for (let i = 0; i < n; i += 1) {
    const cx = groupCenters[i];
    const s = sysV[i];
    const m = manV[i];
    const hs = barH(s);
    const hm = barH(m);
    const xSys = cx - barW - innerGap / 2;
    const xMan = cx + innerGap / 2;
    rects.push(
      `<rect class="diff-analysis-chart__bar diff-analysis-chart__bar--sys" x="${xSys.toFixed(2)}" y="${(yBase - hs).toFixed(2)}" width="${barW.toFixed(2)}" height="${hs.toFixed(2)}" rx="1" />`,
    );
    rects.push(
      `<rect class="diff-analysis-chart__bar diff-analysis-chart__bar--man" x="${xMan.toFixed(2)}" y="${(yBase - hm).toFixed(2)}" width="${barW.toFixed(2)}" height="${hm.toFixed(2)}" rx="1" />`,
    );
  }
  const tickCount = Math.min(8, n);
  const step = n <= 1 ? 1 : Math.max(1, Math.ceil((n - 1) / (tickCount - 1)));
  const ticks = [];
  for (let i = 0; i < n; i += step) ticks.push(i);
  if (ticks.length === 0 || ticks[ticks.length - 1] !== n - 1) ticks.push(n - 1);
  const labelX = (i) => padL + (i + 0.5) * slotW;
  const labels = ticks
    .map((i) => {
      const raw = String(series[i].route_date || "").slice(0, 10);
      const [yy, mo, d] = raw.split("-");
      return `<text x="${labelX(i)}" y="${H - 8}" text-anchor="middle" class="diff-analysis-chart__tick">${mo}-${d}</text>`;
    })
    .join("");
  const yTickCount = 4;
  const yLines = [];
  for (let k = 0; k <= yTickCount; k += 1) {
    const v = (maxY * (yTickCount - k)) / yTickCount;
    const y = padT + (innerH * k) / yTickCount;
    yLines.push(
      `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" class="diff-analysis-chart__grid" />`,
    );
    yLines.push(
      `<text x="${padL - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end" class="diff-analysis-chart__ytick">${Number.isInteger(v) ? v : v.toFixed(1)}</text>`,
    );
  }
  host.innerHTML = `<svg class="diff-analysis-chart__svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  ${yLines.join("")}
  ${rects.join("")}
  ${labels}
  </svg>`;
}

/**
 * 运单预计里程分档：系统/手工运单数对比（与「车辆差异」同区间/仓库、不受数据范围影响）。
 * @param {Array<{ label?: string, layer_key?: string, system_count?: number, manual_count?: number, diff?: number, manual_with_inter_store_over_35km?: number, ratio_manual_with_inter_store_over_35km_in_manual?: number }>} layers
 * @param {object|undefined} vehicleDiff 用于与合计交叉核对
 */
function renderDiffAnalysisDistanceLayersInner(layers, vehicleDiff) {
  const list = Array.isArray(layers) ? layers : [];
  const vd = vehicleDiff && typeof vehicleDiff === "object" ? vehicleDiff : {};
  const st = Number(vd.system_total) || 0;
  const mt = Number(vd.manual_total) || 0;
  if (list.length === 0) {
    return `<p class="empty-hint">暂无分档数据。</p>
      <p class="empty-hint" style="margin-top:8px">与「车辆差异」合计可核对：系统 <strong>${st}</strong> 单、手工 <strong>${mt}</strong> 单。</p>`;
  }
  const body = list
    .map((row) => {
      const label = escapeHtml(String(row.label || row.layer_key || "—"));
      const sc = String(Number(row.system_count) || 0);
      const mc = String(Number(row.manual_count) || 0);
      const mLong = String(Number(row.manual_with_inter_store_over_35km) || 0);
      const rLong = row.ratio_manual_with_inter_store_over_35km_in_manual;
      const rLongStr =
        rLong != null && rLong !== "" && Number.isFinite(Number(rLong))
          ? `${(Number(rLong) * 100).toFixed(1)}%`
          : "—";
      const dRaw = row.diff;
      const d =
        dRaw != null && dRaw !== "" && Number.isFinite(Number(dRaw))
          ? String(Number(dRaw))
          : String((Number(row.system_count) || 0) - (Number(row.manual_count) || 0));
      return `<tr>
        <td>${label}</td>
        <td class="td-num">${sc}</td>
        <td class="td-num">${mc}</td>
        <td class="td-num">${d}</td>
        <td class="td-num">${mLong}</td>
        <td class="td-num">${rLongStr}</td>
      </tr>`;
    })
    .join("");
  return `<p class="diff-distance-crosshint empty-hint">各档运单数之和应与「车辆差异」合计一致：系统 <strong>${st}</strong> 单、手工 <strong>${mt}</strong> 单。手工 <strong>est_distance</strong> 为空时计入最末行。「手工·长店间段」按途经店序相邻店对距离 >35 km 计数（与整单 est_distance 分档独立）。</p>
  <div class="table-scroll table-scroll--diff-distance">
  <table class="data-table data-table--diff-distance" aria-label="运单距离分层">
    <thead><tr><th>里程分层</th><th>系统运单数</th><th>手工运单数</th><th>差异（系统−手工）</th><th>手工·>35 km 店间段</th><th>占本档手工比</th></tr></thead>
    <tbody>${body}</tbody>
  </table>
  </div>`;
}

function renderDiffAnalysisVehicleDiffInner(vd) {
  if (!vd || typeof vd !== "object") {
    return '<p class="empty-hint">无法加载车辆差异。</p>';
  }
  const rows = Array.isArray(vd.by_vehicle_type) ? vd.by_vehicle_type : [];
  const st = Number(vd.system_total) || 0;
  const mt = Number(vd.manual_total) || 0;
  const totRaw = vd.total_vehicle_diff;
  const totDiff =
    totRaw != null && totRaw !== "" && Number.isFinite(Number(totRaw))
      ? Number(totRaw)
      : st - mt;
  const summary = `<div class="diff-analysis-vehicle-summary" role="group" aria-label="车辆差异合计">
    <div class="diff-analysis-vehicle-summary__row">
      <span class="diff-analysis-vehicle-summary__cell">系统运单总数 <strong>${st}</strong></span>
      <span class="diff-analysis-vehicle-summary__sep" aria-hidden="true">·</span>
      <span class="diff-analysis-vehicle-summary__cell">手工运单总数 <strong>${mt}</strong></span>
      <span class="diff-analysis-vehicle-summary__sep" aria-hidden="true">·</span>
      <span class="diff-analysis-vehicle-summary__cell diff-analysis-vehicle-summary__cell--diff">运单差异（系统−手工） <strong>${totDiff}</strong></span>
    </div>
  </div>`;
  if (rows.length === 0) {
    return `${summary}<p class="empty-hint" style="margin:12px 0 0">当前排线起止与仓库下无按车型汇总的运单（两侧可能均为 0）。</p>`;
  }
  const body = rows
    .map(
      (r) => `<tr>
          <td>${escapeHtml(String(r.vehicle_type ?? "—"))}</td>
          <td>${Number(r.system_count) || 0}</td>
          <td>${Number(r.manual_count) || 0}</td>
          <td>${String(Number(r.diff) || 0)}</td>
        </tr>`,
    )
    .join("");
  return `${summary}
  <p class="diff-analysis-vehicle-totals empty-hint" style="margin:10px 0 10px">下表为各<strong>车型</strong>下系统/手工<strong>运单数</strong>；合计为两侧<strong>运单总数</strong>。车辆数与运单一一对应。同上方日期与仓库，与「数据范围」列无关。</p>
  <div class="table-scroll"><table class="data-table data-table--diff-vehicle" aria-label="车辆差异按车型运单数">
    <thead><tr><th>车型</th><th>系统运单数</th><th>手工运单数</th><th>差异（系统−手工）</th></tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
}

function renderDiffAnalysisStoreDiffInner(sd) {
  if (!sd || typeof sd !== "object") {
    return '<p class="empty-hint">无法加载门店差异。</p>';
  }
  const s = Number(sd.system_store_count) || 0;
  const m = Number(sd.manual_store_count) || 0;
  const dRaw = sd.diff;
  const d =
    dRaw != null && dRaw !== "" && Number.isFinite(Number(dRaw)) ? Number(dRaw) : s - m;
  return `<div class="diff-analysis-store-grid" role="group" aria-label="门店差异">
    <div class="diff-analysis-store-metric">
      <span class="diff-analysis-store-metric__label">系统侧门店数（去重）</span>
      <span class="diff-analysis-store-metric__value">${s}</span>
    </div>
    <div class="diff-analysis-store-metric">
      <span class="diff-analysis-store-metric__label">手工侧门店数（去重）</span>
      <span class="diff-analysis-store-metric__value">${m}</span>
    </div>
    <div class="diff-analysis-store-metric diff-analysis-store-metric--diff">
      <span class="diff-analysis-store-metric__label">门店数差异（系统−手工）</span>
      <span class="diff-analysis-store-metric__value">${d}</span>
    </div>
  </div>
  <h4 class="diff-analysis-store-list__title">门店差异列表（去重后仅一侧有）</h4>
  <div id="diffAnalysisStoreListSection">${renderDiffAnalysisStoreListSectionHTML(
    sd,
    1,
    DIFF_STORE_LIST_DEFAULT_PAGE_SIZE,
  )}</div>
  <p class="empty-hint" style="margin:12px 0 0;max-width:40rem">将各运单「拼载门店」列展开后按店名去重，对比两侧门店集合的<strong>对称差</strong>；与「车辆差异」中运单数相互对照。</p>`;
}

function renderDiffAnalysis() {
  const dr = defaultDateRange();
  app.innerHTML = `
    <div class="page-head page-head--compact">
      <p><small class="empty-hint">选择<strong>排线起止</strong>（闭区间，默认近 30 天）、<strong>始发仓库</strong>与<strong>数据范围</strong>。<strong>车辆差异</strong>按<strong>运单/车型</strong>；<strong>门店差异</strong>按拼载店<strong>去重</strong>。下方为<strong>一店多车</strong>与按日柱图。选「全部」时一店多车表不合并两来源；<strong>项次</strong>为同侧从 1 起；「全部」时表含「来源」列。</small></p>
    </div>
    <div class="toolbar">
      <div class="field">
        <span class="field-label">排线起</span>
        <input type="date" id="diffAnalysisDateFrom" value="${escapeHtml(dr.from)}" />
      </div>
      <div class="field">
        <span class="field-label">排线止</span>
        <input type="date" id="diffAnalysisDateTo" value="${escapeHtml(dr.to)}" />
      </div>
      <div class="field">
        <span class="field-label">仓库</span>
        <select id="diffAnalysisWarehouse" title="与列表一致时筛选始发仓库，查询后拉选项随日期变">
          <option value="">全部</option>
        </select>
      </div>
      <div class="field">
        <span class="field-label">数据范围</span>
        <select id="diffAnalysisDataset">
          <option value="all" selected>全部</option>
          <option value="system">仅系统建议</option>
          <option value="manual">仅手工排线</option>
        </select>
      </div>
      <button type="button" class="btn btn--primary" id="diffAnalysisQuery">查询</button>
    </div>
    <div id="diffAnalysisVehicleBlock" class="diff-analysis-vehicle-block" hidden>
      <h3 class="diff-analysis-chart-block__title">车辆差异（运单 / 车型）</h3>
      <p class="empty-hint diff-analysis-chart-block__sub">在<strong>排线起止、仓库</strong>内，对 <code>is_active=1</code> 行按「车型」统计<strong>运单数</strong>，合计为<strong>运单总数</strong>。与「门店差异」独立。与「一店多车」共用日期与仓库；<strong>不受</strong>「数据范围」列影响。</p>
      <div id="diffAnalysisVehicleDiffInner"></div>
    </div>
    <div id="diffAnalysisStoreBlock" class="diff-analysis-store-block" hidden>
      <h3 class="diff-analysis-chart-block__title">门店差异（配送面 · 去重）</h3>
      <p class="empty-hint diff-analysis-chart-block__sub">拼载门店展开后店名去重，对比系统/手工在<strong>配送门店数量</strong>上的差异，便于对照上方<strong>运单/车辆</strong>变化。同一筛选与「车辆差异」一致。</p>
      <div id="diffAnalysisStoreDiffInner"></div>
    </div>
    <div id="diffAnalysisWaybillLoadBlock" class="diff-analysis-wbload-block" hidden>
      <h3 class="diff-analysis-chart-block__title">运单配载门店（一车配几家）</h3>
      <p class="empty-hint diff-analysis-chart-block__sub">在<strong>排线起止、仓库、数据范围</strong>下给出<strong>全样本单均</strong>与<strong>按车型</strong>的配载店数分布（不展示按运单逐行列表）。<strong>配载门店数</strong> = 拼载门店经去重后的店名个数。与一店多车表<strong>无依赖</strong>。</p>
      <div id="diffAnalysisWaybillLoadInner"></div>
    </div>
    <div id="diffAnalysisDistanceLayersBlock" class="diff-analysis-distance-block" hidden>
      <h3 class="diff-analysis-chart-block__title">运单距离分层（系统 vs 手工）</h3>
      <p class="empty-hint diff-analysis-chart-block__sub">在<strong>排线起止、仓库</strong>下按 <code>est_distance</code>（预计里程 km）分档累加各侧运单数；<strong>不受</strong>「数据范围」影响，与「车辆差异」同筛选。末行含手工未填里程。</p>
      <div id="diffAnalysisDistanceLayersInner"></div>
    </div>
    <div id="diffAnalysisChartBlock" class="diff-analysis-chart-block" hidden>
      <h3 class="diff-analysis-chart-block__title">一店多车 · 按日趋势（门店数）</h3>
      <p class="empty-hint diff-analysis-chart-block__sub">与上方筛选条件一致；每日<strong>两根柱</strong>：蓝=系统侧多车店数，橙=手工侧。纵轴为当日满足一店多车的<strong>门店个数</strong>。</p>
      <div class="diff-analysis-chart-legend" aria-hidden="true">
        <span class="diff-analysis-chart-legend__item diff-analysis-chart-legend__item--sys">系统</span>
        <span class="diff-analysis-chart-legend__item diff-analysis-chart-legend__item--man">手工</span>
      </div>
      <div id="diffAnalysisChart" class="diff-analysis-chart" role="img" aria-label="一店多车按日趋势柱状图"></div>
    </div>
    <div class="table-scroll">
      <table class="data-table data-table--diff-mv" id="diffAnalysisTable" aria-label="一店多车">
        <thead>
          <tr id="diffAnalysisTheadRow">
            <th style="width:6.5rem">排线日</th>
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
    <p id="diffAnalysisEmpty" class="empty-hint" hidden>无符合条件的一店多车记录。</p>
  `;
  const tbody = document.getElementById("diffAnalysisTbody");
  const emptyEl = document.getElementById("diffAnalysisEmpty");
  const runQuery = async () => {
    const routeDateFrom = document.getElementById("diffAnalysisDateFrom").value;
    const routeDateTo = document.getElementById("diffAnalysisDateTo").value;
    const datasetType = document.getElementById("diffAnalysisDataset").value;
    const warehouseName = (document.getElementById("diffAnalysisWarehouse")?.value || "").trim();
    const showSourceCol = datasetType === "all";
    const colSpan = showSourceCol ? 6 : 5;
    const chartBlock = document.getElementById("diffAnalysisChartBlock");
    const chartHost = document.getElementById("diffAnalysisChart");
    const theadRow = document.getElementById("diffAnalysisTheadRow");
    if (theadRow) {
      theadRow.innerHTML = showSourceCol
        ? `<th style="width:6.5rem">排线日</th>
            <th>门店名称</th>
            <th style="width:6rem">运单数</th>
            <th class="th-diff-src" style="width:7.5rem" title="系统建议 或 手工排线">来源</th>
            <th style="width:4.5rem">项次</th>
            <th>运单号</th>`
        : `<th style="width:6.5rem">排线日</th>
            <th>门店名称</th>
            <th style="width:6rem">运单数</th>
            <th style="width:4.5rem">项次</th>
            <th>运单号</th>`;
    }
    const vehicleBlock = document.getElementById("diffAnalysisVehicleBlock");
    const storeBlock = document.getElementById("diffAnalysisStoreBlock");
    const waybillBlock = document.getElementById("diffAnalysisWaybillLoadBlock");
    const distanceBlock = document.getElementById("diffAnalysisDistanceLayersBlock");
    if (!routeDateFrom || !routeDateTo) {
      tbody.innerHTML = "";
      if (chartBlock) chartBlock.setAttribute("hidden", "");
      if (vehicleBlock) vehicleBlock.setAttribute("hidden", "");
      if (storeBlock) storeBlock.setAttribute("hidden", "");
      if (waybillBlock) waybillBlock.setAttribute("hidden", "");
      if (distanceBlock) distanceBlock.setAttribute("hidden", "");
      _diffAnalysisStoreListSnapshot = null;
      emptyEl.removeAttribute("hidden");
      emptyEl.textContent = "请填写排线起止日期。";
      return;
    }
    if (routeDateFrom > routeDateTo) {
      tbody.innerHTML = "";
      if (chartBlock) chartBlock.setAttribute("hidden", "");
      if (vehicleBlock) vehicleBlock.setAttribute("hidden", "");
      if (storeBlock) storeBlock.setAttribute("hidden", "");
      if (waybillBlock) waybillBlock.setAttribute("hidden", "");
      if (distanceBlock) distanceBlock.setAttribute("hidden", "");
      _diffAnalysisStoreListSnapshot = null;
      emptyEl.removeAttribute("hidden");
      emptyEl.textContent = "排线起不能晚于排线止。";
      return;
    }
    emptyEl.setAttribute("hidden", "");
    tbody.innerHTML = `<tr><td colspan="${colSpan}" class="empty-hint">加载中…</td></tr>`;
    if (chartBlock) chartBlock.setAttribute("hidden", "");
    if (vehicleBlock) vehicleBlock.setAttribute("hidden", "");
    if (storeBlock) storeBlock.setAttribute("hidden", "");
    if (waybillBlock) waybillBlock.setAttribute("hidden", "");
    if (distanceBlock) distanceBlock.setAttribute("hidden", "");
    _diffAnalysisStoreListSnapshot = null;
    const q = new URLSearchParams({
      route_date_from: routeDateFrom,
      route_date_to: routeDateTo,
      dataset_type: datasetType,
    });
    if (warehouseName) q.set("warehouse_name", warehouseName);
    try {
      const resp = await apiFetch(`${API_BASE}/diff-analysis/multi-vehicle-stores?${q}`);
      let data = {};
      try {
        data = await resp.json();
      } catch {
        data = {};
      }
      if (!resp.ok) {
        if (chartBlock) chartBlock.setAttribute("hidden", "");
        if (vehicleBlock) vehicleBlock.setAttribute("hidden", "");
        if (storeBlock) storeBlock.setAttribute("hidden", "");
        if (waybillBlock) waybillBlock.setAttribute("hidden", "");
        if (distanceBlock) distanceBlock.setAttribute("hidden", "");
        _diffAnalysisStoreListSnapshot = null;
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
      const vInner = document.getElementById("diffAnalysisVehicleDiffInner");
      if (vehicleBlock && vInner) {
        vInner.innerHTML = renderDiffAnalysisVehicleDiffInner(data.vehicle_diff);
        vehicleBlock.removeAttribute("hidden");
      }
      const sInner = document.getElementById("diffAnalysisStoreDiffInner");
      if (storeBlock && sInner) {
        _diffAnalysisStoreListSnapshot = data.store_diff && typeof data.store_diff === "object" ? data.store_diff : null;
        sInner.innerHTML = renderDiffAnalysisStoreDiffInner(data.store_diff);
        storeBlock.removeAttribute("hidden");
        bindDiffAnalysisStoreListPager();
      }
      const wbInner = document.getElementById("diffAnalysisWaybillLoadInner");
      if (waybillBlock && wbInner) {
        const wsl =
          data.waybill_store_load && typeof data.waybill_store_load === "object"
            ? data.waybill_store_load
            : { summary: {}, by_vehicle_type: [] };
        wbInner.innerHTML = renderDiffAnalysisWaybillLoadInner(wsl, datasetType);
        waybillBlock.removeAttribute("hidden");
      }
      const dInner = document.getElementById("diffAnalysisDistanceLayersInner");
      if (distanceBlock && dInner) {
        dInner.innerHTML = renderDiffAnalysisDistanceLayersInner(
          data.waybill_distance_layers,
          data.vehicle_diff,
        );
        distanceBlock.removeAttribute("hidden");
      }
      const whSel = document.getElementById("diffAnalysisWarehouse");
      const wOpts = Array.isArray(data.warehouse_options) ? data.warehouse_options : [];
      if (whSel) {
        const keep = (whSel.value || "").trim();
        whSel.innerHTML = [`<option value="" ${!keep ? "selected" : ""}>全部</option>`]
          .concat(
            wOpts.map(
              (w) =>
                `<option value="${escapeHtml(w)}" ${keep === w ? "selected" : ""}>${escapeHtml(
                  w,
                )}</option>`,
            ),
          )
          .join("");
        if (keep && wOpts.indexOf(keep) === -1) {
          whSel.insertAdjacentHTML(
            "beforeend",
            `<option value="${escapeHtml(keep)}" selected>${escapeHtml(keep)}</option>`,
          );
        }
      }
      const trend = data.trend_by_day || [];
      if (chartBlock && chartHost) {
        if (trend.length) {
          renderDiffAnalysisTrendChart(chartHost, trend);
          chartBlock.removeAttribute("hidden");
        } else {
          chartHost.innerHTML = "";
          chartBlock.setAttribute("hidden", "");
        }
      }
      const items = data.items || [];
      if (items.length === 0) {
        tbody.innerHTML = "";
        emptyEl.removeAttribute("hidden");
        emptyEl.textContent = "在日期与筛选条件下无一店多车，或该区间无有效导入数据。";
        return;
      }
      emptyEl.setAttribute("hidden", "");
      const rows = [];
      for (const it of items) {
        const filtered = filterDiffAnalysisWaybills(it.waybills);
        if (filtered.length === 0) continue;
        const groups = groupDiffAnalysisWaybillsByDatasetType(filtered);
        const nGroups = groups.length;
        const totalStr = String(filtered.length);
        const rd =
          it.route_date != null && it.route_date !== ""
            ? escapeHtml(String(it.route_date).slice(0, 10))
            : "—";
        let gi = 0;
        for (const g of groups) {
          const head = gi === 0;
          const storeCells = head
            ? `<td rowspan="${nGroups}">${rd}</td><td rowspan="${nGroups}">${escapeHtml(String(it.store_name || ""))}</td><td rowspan="${nGroups}">${totalStr}</td>`
            : "";
          const srcCell = showSourceCol
            ? `<td>${escapeHtml(diffDatasetTypeLabel(g.waybills[0].dataset_type))}</td>`
            : "";
          rows.push(`<tr>
            ${storeCells}
            ${srcCell}
            <td>${diffMvItemSeqBlock(g.waybills)}</td>
            <td>${diffMvWaybillBlock(g.waybills)}</td>
          </tr>`);
          gi += 1;
        }
      }
      if (rows.length === 0) {
        tbody.innerHTML = "";
        emptyEl.removeAttribute("hidden");
        emptyEl.textContent =
          "在展示规则下暂无记录。若本日曾有一店多车，可能均为「手工、项次 1」行已隐藏，或需调整排线日期与数据。";
        return;
      }
      tbody.innerHTML = rows.join("");
    } catch (e) {
      if (chartBlock) chartBlock.setAttribute("hidden", "");
      if (vehicleBlock) vehicleBlock.setAttribute("hidden", "");
      if (storeBlock) storeBlock.setAttribute("hidden", "");
      if (waybillBlock) waybillBlock.setAttribute("hidden", "");
      if (distanceBlock) distanceBlock.setAttribute("hidden", "");
      _diffAnalysisStoreListSnapshot = null;
      tbody.innerHTML = `<tr><td colspan="${colSpan}">${backendUnreachableHtml(e)}</td></tr>`;
    }
  };
  document.getElementById("diffAnalysisQuery").addEventListener("click", runQuery);
  _refetchDiffAnalysis = runQuery;
  void runQuery();
}

let importModalKeyController = null;

function renderImport() {
  app.innerHTML = `
    <div class="page-head page-head--compact">
      <p><small class="empty-hint">导入按<strong>排线日期 + 运单号</strong>更新或新增；模板含<strong>车辆类型</strong>等必填列。成功导入后会在后台对<strong>所涉排线日</strong>重算人工补算与<strong>排线对比结果</strong>。停留在「排线差异」「差异分析」页时会自动拉取最新数据。下方「数据明细」按日期查询，与是否导入无关。</small></p>
    </div>
    <div class="toolbar toolbar--import">
      <div class="field">
        <span class="field-label">数据类型</span>
        <select id="datasetType">
          <option value="system">系统建议数据</option>
          <option value="manual">手动排线数据</option>
        </select>
      </div>
      <button
        type="button"
        class="btn btn--primary"
        id="openImportModalBtn"
        aria-haspopup="dialog"
        aria-controls="importModal"
      >
        导入
      </button>
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
          <span class="field-label">Excel 文件</span>
          <input id="importModalFile" class="input-file" type="file" accept=".xlsx,.xls" />
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
      const resp = await apiFetch(url);
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
      const resp = await apiFetch(importUrl, { method: "POST", body: formData });
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
      refetchDiffAndCompareAfterImport();
    } catch (err) {
      closeImportModal();
      importMessageArea.innerHTML = backendUnreachableHtml(err);
    } finally {
      submit.disabled = false;
    }
  };
}

function renderResult() {
  const _drD = defaultDateRange();
  const _d0 = _drD.to;
  app.innerHTML = `
    <div class="page-head page-head--compact">
      <p><small class="empty-hint">选择<strong>排线起止日期</strong>与<strong>匹配状态</strong>后点<strong>查询</strong>：将按闭区间补算并逐日比对，再展示汇总概览与区间明细；可导出 CSV，表格中打开路线地图。</small></p>
    </div>
    <div id="compareRespWrap" class="compare-run-status"></div>
    <div class="toolbar toolbar--compare">
      <div class="field">
        <span class="field-label">排线起</span>
        <input id="lineDiffDateFrom" type="date" value="${escapeHtml(_d0)}" />
      </div>
      <div class="field">
        <span class="field-label">排线止</span>
        <input id="lineDiffDateTo" type="date" value="${escapeHtml(_d0)}" />
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
    <div id="compareResultPagerWrap" class="compare-result-pager-wrap" style="display:none" aria-hidden="true">
      <div class="toolbar compare-result-pager" role="navigation" aria-label="排线差异表格分页">
        <p class="compare-result-pager__summary" id="compareResultPagerSummary"></p>
        <div class="field">
          <span class="field-label">每页</span>
          <select id="compareResultPageSize" title="每页行数" aria-label="每页行数">
            <option value="20">20 条</option>
            <option value="50">50 条</option>
            <option value="100">100 条</option>
          </select>
        </div>
        <button type="button" class="btn btn--secondary" id="compareResultPrev" aria-label="上一页">上一页</button>
        <button type="button" class="btn btn--primary" id="compareResultNext" aria-label="下一页">下一页</button>
      </div>
    </div>
    <p id="resultEmpty" class="empty-hint" style="display:none">暂无数据，请先选择排线起止日期并点击查询。</p>
  `;
  {
    const psEl = document.getElementById("compareResultPageSize");
    if (psEl) psEl.value = String(_compareResultPageSize);
  }
  const loadCompareDataOnly = async (opts) => {
    const fromImport = opts && opts.fromImport;
    const routeFrom = (document.getElementById("lineDiffDateFrom")?.value || "").trim();
    const routeTo = (document.getElementById("lineDiffDateTo")?.value || "").trim();
    const status = document.getElementById("matchStatus").value;
    const whSel = document.getElementById("compareWarehouse");
    const selectedWh = (whSel && whSel.value) || "";
    const overviewArea = document.getElementById("overviewArea");
    const tbody = document.getElementById("resultTable");
    const emptyEl = document.getElementById("resultEmpty");
    const statusWrap = document.getElementById("compareRespWrap");
    if (!routeFrom || !routeTo || routeFrom > routeTo) return;
    if (fromImport && statusWrap) {
      statusWrap.innerHTML = `<div class="alert alert--muted">已随导入在后台重算所涉日期的比对，正在刷新本页数据…</div>`;
    }
    overviewArea.innerHTML = `<div class="alert alert--muted">加载概览与明细…</div>`;
    tbody.innerHTML = "";
    try {
      const whQ = selectedWh.trim()
        ? `&warehouse_name=${encodeURIComponent(selectedWh.trim())}`
        : "";
      const overviewResp = await apiFetch(
        `${API_BASE}/compare/overview?route_date_from=${encodeURIComponent(
          routeFrom,
        )}&route_date_to=${encodeURIComponent(routeTo)}${whQ}`,
      );
      const overviewData = await overviewResp.json();
      fillCompareWarehouseSelect(whSel, overviewData, selectedWh);
      overviewArea.innerHTML = overviewSection(overviewData);
      const whForRows = (document.getElementById("compareWarehouse")?.value || "").trim();
      const whRowsQ = whForRows ? `&warehouse_name=${encodeURIComponent(whForRows)}` : "";
      const resultResp = await apiFetch(
        `${API_BASE}/compare/results?route_date_from=${encodeURIComponent(
          routeFrom,
        )}&route_date_to=${encodeURIComponent(
          routeTo,
        )}&match_status=${encodeURIComponent(status)}${whRowsQ}`,
      );
      const rows = await resultResp.json();
      _compareResultRows = Array.isArray(rows) ? rows : [];
      _compareResultSort.key = null;
      _compareResultSort.dir = "asc";
      _compareResultPage = 1;
      if (fromImport && statusWrap) {
        statusWrap.innerHTML = "";
      }
      refreshCompareResultTable();
      emptyEl.style.display = _compareResultRows.length ? "none" : "block";
      if (!_compareResultRows.length) emptyEl.textContent = "该条件下没有排线差异记录。";
    } catch (err) {
      if (statusWrap) statusWrap.innerHTML = backendUnreachableHtml(err);
      if (overviewArea) overviewArea.innerHTML = "";
      _compareResultRows = [];
      _compareResultSort.key = null;
      _compareResultPage = 1;
      if (tbody) tbody.innerHTML = "";
      refreshCompareResultTable();
    }
  };
  _refetchCompareDisplayOnly = () => loadCompareDataOnly({ fromImport: true });
  document.getElementById("queryBtn").onclick = async () => {
    const routeFrom = (document.getElementById("lineDiffDateFrom")?.value || "").trim();
    const routeTo = (document.getElementById("lineDiffDateTo")?.value || "").trim();
    const whSel = document.getElementById("compareWarehouse");
    const selectedWh = (whSel && whSel.value) || "";
    const overviewArea = document.getElementById("overviewArea");
    const tbody = document.getElementById("resultTable");
    const emptyEl = document.getElementById("resultEmpty");
    const statusWrap = document.getElementById("compareRespWrap");
    if (!routeFrom || !routeTo) {
      statusWrap.innerHTML = "";
      overviewArea.innerHTML = `<div class="alert alert--muted">请填写排线起、止日期。</div>`;
      _compareResultRows = [];
      _compareResultSort.key = null;
      _compareResultSort.dir = "asc";
      _compareResultPage = 1;
      tbody.innerHTML = "";
      emptyEl.style.display = "block";
      refreshCompareResultTable();
      return;
    }
    if (routeFrom > routeTo) {
      statusWrap.innerHTML = "";
      overviewArea.innerHTML = `<div class="alert alert--muted">排线起不能晚于排线止。</div>`;
      _compareResultRows = [];
      _compareResultSort.key = null;
      _compareResultSort.dir = "asc";
      _compareResultPage = 1;
      tbody.innerHTML = "";
      emptyEl.style.display = "block";
      refreshCompareResultTable();
      return;
    }
    statusWrap.innerHTML = `<div class="alert alert--muted">正在执行比对并加载数据…</div>`;
    overviewArea.innerHTML = "";
    tbody.innerHTML = "";
    try {
      const runResp = await apiFetch(`${API_BASE}/compare/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ route_date_from: routeFrom, route_date_to: routeTo, match_threshold: 0.5 }),
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
        _compareResultPage = 1;
        emptyEl.style.display = "block";
        refreshCompareResultTable();
        return;
      }
      if (runData.calc?.failures?.length) {
        statusWrap.innerHTML = `<div class="alert alert--error">手动数据补算部分失败：<pre>${escapeHtml(
          JSON.stringify(runData.calc.failures, null, 2).slice(0, 800)
        )}</pre></div>`;
      } else {
        statusWrap.innerHTML = "";
      }
      void loadCompareDataOnly();
    } catch (err) {
      statusWrap.innerHTML = backendUnreachableHtml(err);
      overviewArea.innerHTML = "";
      _compareResultRows = [];
      _compareResultSort.key = null;
      _compareResultPage = 1;
      tbody.innerHTML = "";
      emptyEl.style.display = "block";
      refreshCompareResultTable();
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
    const a = (document.getElementById("lineDiffDateFrom")?.value || "").trim();
    const b = (document.getElementById("lineDiffDateTo")?.value || "").trim();
    if (!a || !b || a > b) return;
    const wh = (document.getElementById("compareWarehouse")?.value || "").trim();
    let url = `${API_BASE}/compare/export?route_date_from=${encodeURIComponent(
      a,
    )}&route_date_to=${encodeURIComponent(b)}`;
    if (wh) url += `&warehouse_name=${encodeURIComponent(wh)}`;
    window.open(url, "_blank");
  };
  document.getElementById("resultTable").onclick = (ev) => {
    const btn = ev.target.closest(".map-btn");
    if (!btn) return;
    const id = btn.getAttribute("data-crid");
    if (id) window.location.hash = `#route-map?id=${id}`;
  };
  const prevPageBtn = document.getElementById("compareResultPrev");
  const nextPageBtn = document.getElementById("compareResultNext");
  const pageSizeSel = document.getElementById("compareResultPageSize");
  if (prevPageBtn) {
    prevPageBtn.addEventListener("click", () => {
      if (_compareResultPage <= 1) return;
      _compareResultPage -= 1;
      refreshCompareResultTable();
    });
  }
  if (nextPageBtn) {
    nextPageBtn.addEventListener("click", () => {
      const { totalPages } = _getCompareResultPageSlice();
      if (_compareResultPage >= totalPages) return;
      _compareResultPage += 1;
      refreshCompareResultTable();
    });
  }
  if (pageSizeSel) {
    pageSizeSel.addEventListener("change", (e) => {
      const v = Number(e.target && e.target.value);
      if (COMPARE_RESULT_PAGE_SIZES.includes(v)) {
        _compareResultPageSize = v;
        _compareResultPage = 1;
        refreshCompareResultTable();
      }
    });
  }
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

/** 地图 pin：仓=绿；店=系统侧蓝 / 手工侧红。side 为 system|manual。 */
function buildRouteMapMarkerLabelHtml(m, side) {
  const n = (m.seq ?? 0) + 1;
  const kind = m.kind === "warehouse" ? "仓" : "店";
  const isWh = m.kind === "warehouse";
  const scls = isWh
    ? "route-map-pin-label--warehouse"
    : side === "manual"
      ? "route-map-pin-label--manual"
      : "route-map-pin-label--system";
  const ncls = isWh
    ? "route-map-pin-label__num--warehouse"
    : side === "manual"
      ? "route-map-pin-label__num--manual"
      : "route-map-pin-label__num--system";
  return `<div class="route-map-pin-label ${scls}"><span class="route-map-pin-label__row"><span class="route-map-pin-label__num ${ncls}">${n}</span><span class="route-map-pin-label__kind">${kind}</span></span></div>`;
}

function _routeMapCoordKey(m) {
  const r = (x) => Math.round(Number(x) * 1e5) / 1e5;
  return `${r(m.lng)},${r(m.lat)}`;
}

/** 同坐标（经四舍五入到约 1m）的仓/店合并为一条标注；两侧序号用蓝/红分开展示。 */
function mergeRouteMapMarkersByPosition(sysMarkers, manMarkers) {
  const by = new Map();
  const put = (m, side) => {
    const k = _routeMapCoordKey(m);
    if (!by.has(k)) {
      by.set(k, { lng: m.lng, lat: m.lat, system: null, manual: null });
    }
    const e = by.get(k);
    e[side] = { seq: m.seq, name: m.name, kind: m.kind };
  };
  (sysMarkers || []).forEach((m) => put(m, "system"));
  (manMarkers || []).forEach((m) => put(m, "manual"));
  return Array.from(by.values());
}

function buildRouteMapMergedPinLabelHtml(entry) {
  const ksys = entry.system?.kind;
  const kman = entry.manual?.kind;
  const isWh = ksys === "warehouse" || kman === "warehouse";
  const kind = isWh ? "仓" : "店";
  const hasS = Boolean(entry.system);
  const hasM = Boolean(entry.manual);
  const nS = hasS ? (entry.system.seq ?? 0) + 1 : null;
  const nM = hasM ? (entry.manual.seq ?? 0) + 1 : null;
  let numsHtml = "";
  if (hasS && hasM && nS === nM) {
    numsHtml = `<span class="route-map-pin-label__num route-map-pin-label__num--both-same" title="系统与手工相同顺序">${nS}</span>`;
  } else {
    const parts = [];
    if (hasS) {
      parts.push(`<span class="route-map-pin-label__num route-map-pin-label__num--system">${nS}</span>`);
    }
    if (hasM) {
      parts.push(`<span class="route-map-pin-label__num route-map-pin-label__num--manual">${nM}</span>`);
    }
    numsHtml = parts.join("");
  }
  const nmS = hasS ? String(entry.system.name || "").trim() : "";
  const nmM = hasM ? String(entry.manual.name || "").trim() : "";
  const sharedName = hasS && hasM && nmS && nmS === nmM;
  let boxCls = "route-map-pin-label";
  if (sharedName) {
    boxCls += " route-map-pin-label--shared";
  } else if (isWh) {
    boxCls += " route-map-pin-label--warehouse";
  } else if (hasS && hasM) {
    boxCls += " route-map-pin-label--merged-common";
  } else if (hasS) {
    boxCls += " route-map-pin-label--system";
  } else {
    boxCls += " route-map-pin-label--manual";
  }
  return `<div class="${boxCls}"><span class="route-map-pin-label__row route-map-pin-label__row--merged"><span class="route-map-pin-label__nums">${numsHtml}</span><span class="route-map-pin-label__kind">${kind}</span></span></div>`;
}

function buildRouteMapMergedMarkerTitle(entry) {
  const bits = [];
  if (entry.system) {
    const n = (entry.system.seq ?? 0) + 1;
    const nm = (entry.system.name && String(entry.system.name).trim()) || "—";
    bits.push(`系统 ${n} ${nm}`);
  }
  if (entry.manual) {
    const n = (entry.manual.seq ?? 0) + 1;
    const nm = (entry.manual.name && String(entry.manual.name).trim()) || "—";
    bits.push(`手工 ${n} ${nm}`);
  }
  return bits.join(" · ");
}

const _ROUTE_PIN_BLUE = "#1677FF";
const _ROUTE_PIN_RED = "#FF4D4F";
const _ROUTE_PIN_GREEN = "#16A34A";
const _ROUTE_PIN_W = 28;
const _ROUTE_PIN_H = 40;

/**
 * 定位图钉 SVG（与折线色一致：系统蓝 / 手工红 / 系统+手工同点则左蓝右红渐变）
 * 上圆+下三角，尖角落在 viewBox 底边中点。
 */
function routeMapPinSvgDataUrl(variant) {
  const gradId = "rpsplit";
  const defsBoth = `<defs><linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${_ROUTE_PIN_BLUE}"/><stop offset="0.5" stop-color="${_ROUTE_PIN_BLUE}"/><stop offset="0.5" stop-color="${_ROUTE_PIN_RED}"/><stop offset="1" stop-color="${_ROUTE_PIN_RED}"/></linearGradient></defs>`;
  let fill;
  if (variant === "system") {
    fill = _ROUTE_PIN_BLUE;
  } else if (variant === "manual") {
    fill = _ROUTE_PIN_RED;
  } else if (variant === "warehouse") {
    fill = _ROUTE_PIN_GREEN;
  } else {
    fill = `url(#${gradId})`;
  }
  const inner =
    variant === "both"
      ? `${defsBoth}<circle cx="14" cy="9.5" r="8.2" fill="url(#${gradId})"/><path d="M5.2 16L14 40L22.8 16Z" fill="url(#${gradId})" stroke="none"/><circle cx="14" cy="9.5" r="2.4" fill="#fff" stroke="none"/>`
      : `<circle cx="14" cy="9.5" r="8.2" fill="${fill}"/><path d="M5.2 16L14 40L22.8 16Z" fill="${fill}" stroke="none"/><circle cx="14" cy="9.5" r="2.4" fill="#fff" stroke="none"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 40" width="${_ROUTE_PIN_W}" height="${_ROUTE_PIN_H}">${inner}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function routeMapPinIconForMarker(AMap, variant) {
  const u = routeMapPinSvgDataUrl(variant);
  return new AMap.Icon({
    image: u,
    size: new AMap.Size(_ROUTE_PIN_W, _ROUTE_PIN_H),
    imageSize: new AMap.Size(_ROUTE_PIN_W, _ROUTE_PIN_H),
  });
}

/** 图钉底尖落在坐标上：略向左上，使尖端对准经纬度。 */
function routeMapPinOffset(AMap) {
  return new AMap.Pixel(-Math.floor(_ROUTE_PIN_W / 2), -_ROUTE_PIN_H);
}

function routeMapMarkerPinVariantForMerged(entry) {
  const hasS = Boolean(entry.system);
  const hasM = Boolean(entry.manual);
  if (hasS && hasM) return "both";
  if (hasM) return "manual";
  return "system";
}

/** 系统/手工两侧均出现的站点名称（trim 后一致），用于侧栏绿色序号牌。 */
function routeMapSharedStopNames(sysMarkers, manMarkers) {
  const names = (arr) => {
    const s = new Set();
    for (const m of arr || []) {
      const n = String(m.name || "").trim();
      if (n) s.add(n);
    }
    return s;
  };
  const A = names(sysMarkers);
  const B = names(manMarkers);
  if (!A.size || !B.size) return new Set();
  const out = new Set();
  for (const n of A) {
    if (B.has(n)) out.add(n);
  }
  return out;
}

/**
 * 路线地图页：按运单展示送货顺序（箭头串联，段间为球面直线距离；序号与地图一致，自 1 起）。
 */
function buildRouteMapWaybillStopsSection(heading, waybillNo, markers, side, sharedNames, vehicleType) {
  const secCls =
    side === "manual" ? "route-map-wb-section route-map-wb-section--manual" : "route-map-wb-section route-map-wb-section--system";
  const hasWb = waybillNo != null && String(waybillNo).trim() !== "";
  const wb = hasWb ? String(waybillNo) : "—";
  const vtRaw = vehicleType != null && vehicleType !== "" ? String(vehicleType).trim() : "";
  const vehicleLine = vtRaw ? `<p class="route-map-wb-vt-line">（${escapeHtml(vtRaw)}）</p>` : "";
  const head = `<div class="route-map-wb-head"><span class="route-map-wb-label">${escapeHtml(heading)}</span> <code class="route-map-wb-no">${escapeHtml(wb)}</code></div>`;
  if (!markers || !markers.length) {
    return `<section class="${secCls}">${head}${vehicleLine}<p class="empty-hint" style="padding:12px 0 0">暂无站点</p></section>`;
  }
  const shared = sharedNames && sharedNames.size ? sharedNames : null;
  const sorted = [...markers].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const chunks = [];
  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i];
    const n = (m.seq ?? 0) + 1;
    const kindLabel = m.kind === "warehouse" ? "仓库" : "门店";
    const kcls = m.kind === "warehouse" ? " route-map-kind--wh" : " route-map-kind--st";
    const ll = formatMarkerLngLatSuffix(m);
    const nm = String(m.name || "").trim();
    const seqShared = shared && nm && shared.has(nm);
    const seqCls = `route-map-flow__seq${seqShared ? " route-map-flow__seq--shared" : ""}`;
    chunks.push(`<div class="route-map-flow__node" role="listitem">
      <div class="route-map-flow__node-card">
        <div class="route-map-flow__node-head">
          <span class="${seqCls}" aria-hidden="true">${n}</span>
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
  return `<section class="${secCls}">${head}${vehicleLine}${flow}</section>`;
}

function buildRouteMapStopsBlock(data) {
  const out = [];
  const sysM = (data.system && data.system.markers) || [];
  const hasSysWb = data.sys_waybill_no != null && String(data.sys_waybill_no).trim() !== "";
  const manM = (data.manual && data.manual.markers) || [];
  const hasManWb = data.manual_waybill_no != null && String(data.manual_waybill_no).trim() !== "";
  const hasBothSides =
    (hasSysWb || sysM.length > 0) && (hasManWb || manM.length > 0);
  const sharedNames = hasBothSides ? routeMapSharedStopNames(sysM, manM) : new Set();
  if (hasSysWb || sysM.length) {
    out.push(
      buildRouteMapWaybillStopsSection("系统运单", data.sys_waybill_no, sysM, "system", sharedNames, data.sys_vehicle_type),
    );
  }
  if (hasManWb || manM.length) {
    out.push(
      buildRouteMapWaybillStopsSection("手工运单", data.manual_waybill_no, manM, "manual", sharedNames, data.manual_vehicle_type),
    );
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
      <a class="back-link" href="#result">← 返回排线差异</a>
    </div>
  `;
  const errEl = document.getElementById("routeMapErr");
  const metaEl = document.getElementById("routeMapMeta");
  if (!rid || Number.isNaN(rid)) {
    errEl.innerHTML = `<div class="alert alert--error">缺少比对行 id，请从「排线差异」表格中点击「地图」进入。</div>`;
    return;
  }

  (async () => {
    let data;
    try {
      const resp = await apiFetch(`${API_BASE}/compare/route-map/${rid}`);
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
        ? `<span><span class="map-legend-swatch map-legend-swatch--system">■</span> 系统建议路线</span> <span><span class="map-legend-swatch map-legend-swatch--manual">■</span> 手工运单路线</span>`
        : hasSysWbMeta
          ? `<span><span class="map-legend-swatch map-legend-swatch--system">■</span> 系统建议路线</span>`
          : hasManWbMeta
            ? `<span><span class="map-legend-swatch map-legend-swatch--manual">■</span> 手工运单路线</span>`
            : `<span><span class="map-legend-swatch map-legend-swatch--system">■</span> 系统建议路线</span>`;

    metaEl.innerHTML = `
      <div><strong>${escapeHtml(data.warehouse_name || "—")}</strong></div>
      <div style="margin-top:8px">${matchStatusBadge(data.match_status)}</div>
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

    const addLabelMarkers = (markers, side) => {
      const v = side === "manual" ? "manual" : "system";
      (markers || []).forEach((m) => {
        const n = (m.seq ?? 0) + 1;
        const name = (m.name && String(m.name).trim()) || "—";
        const mk = new AMap.Marker({
          position: [m.lng, m.lat],
          title: `${n} ${name}`,
          icon: routeMapPinIconForMarker(AMap, v),
          offset: routeMapPinOffset(AMap),
          label: {
            content: buildRouteMapMarkerLabelHtml(m, side),
            direction: "top",
            offset: [0, 4],
          },
          map,
        });
        markerOverlays.push(mk);
      });
    };
    if (canShowSystem && canShowManual) {
      const merged = mergeRouteMapMarkersByPosition(data.system?.markers, data.manual?.markers);
      merged.forEach((entry) => {
        const pv = routeMapMarkerPinVariantForMerged(entry);
        const mk = new AMap.Marker({
          position: [entry.lng, entry.lat],
          title: buildRouteMapMergedMarkerTitle(entry),
          icon: routeMapPinIconForMarker(AMap, pv),
          offset: routeMapPinOffset(AMap),
          label: {
            content: buildRouteMapMergedPinLabelHtml(entry),
            direction: "top",
            offset: [0, 4],
          },
          map,
        });
        markerOverlays.push(mk);
      });
    } else if (canShowSystem) {
      addLabelMarkers(data.system?.markers, "system");
    } else if (canShowManual) {
      addLabelMarkers(data.manual?.markers, "manual");
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
    const r = await apiFetch(`${API_BASE}/customer-profiles?${q}`);
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

/** 是否可作为一对合法 (经度, 纬度) */
function _isValidLngLatPair(lng, lat) {
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    lng >= -180 &&
    lng <= 180 &&
    lat >= -90 &&
    lat <= 90
  );
}

/**
 * 解析主数据「仓库坐标」为 [经度, 纬度]（用于高德底图，即 GCJ-02）。
 * 若单元格按国内习惯写成「纬度,经度」而非法为经度,纬度 时，会按中国大陆/周边范围尝试纠正。
 * @returns {[number, number] | null}
 */
function parseWarehouseLngLat(raw) {
  if (raw == null || String(raw).trim() === "") return null;
  const t = String(raw).trim();
  const i = t.indexOf(",");
  if (i < 0) return null;
  const a = parseFloat(t.slice(0, i).trim());
  const b = parseFloat(t.slice(i + 1).trim());
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

  const pLngLat = [a, b];
  const pLatLng = [b, a];

  /* 仅当「经度,纬度」非法，但「纬度,经度」合法且像国内/周边常见写法时，才交换。不在「两顺序都合法」时自动互换，避免国外点被误判。 */
  if (!_isValidLngLatPair(a, b) && _isValidLngLatPair(b, a) && a >= 2 && a <= 55 && b >= 70 && b <= 150) {
    return pLatLng;
  }
  if (_isValidLngLatPair(a, b)) {
    return pLngLat;
  }
  return null;
}

/**
 * 从仓库主数据项提取业务品牌名（供与「品牌标识」localStorage 行匹配）。
 * @param {any} it
 * @returns {string[]}
 */
function extractWarehouseBusinessBrandNames(it) {
  if (!it) return [];
  const bb = it.business_brands;
  if (Array.isArray(bb) && bb.length) {
    const out = [];
    for (const row of bb) {
      if (row && row.name != null) {
        const s = String(row.name).trim();
        if (s) out.push(s);
      }
    }
    if (out.length) return out;
  }
  const s0 = (it.brand || "").trim();
  if (!s0) return [];
  return s0
    .split(";")
    .map((part) => {
      const p = part.trim();
      if (!p) return null;
      const k = p.indexOf("（LOGO：");
      if (k > 0) return p.slice(0, k).trim() || null;
      return p;
    })
    .filter((x) => x != null && String(x).trim() !== "");
}

/**
 * @param {string} name
 * @returns {{ imageUrl: string, identityHit: boolean, hasDataLogo: boolean }}
 */
function resolveIdentityLogoByBusinessBrandName(name) {
  const n = (name || "").trim();
  const fallbackUrl = new URL(DEFAULT_BRAND_LOGO_PATH, window.location.href).href;
  if (!n) {
    return { imageUrl: fallbackUrl, identityHit: false, hasDataLogo: false };
  }
  for (const id of loadBrandIdentities()) {
    if (String(id.name || "").trim() === n) {
      const u = id.logoDataUrl && String(id.logoDataUrl).startsWith("data:") ? id.logoDataUrl : null;
      return {
        imageUrl: u || fallbackUrl,
        identityHit: true,
        hasDataLogo: !!u,
      };
    }
  }
  return { imageUrl: fallbackUrl, identityHit: false, hasDataLogo: false };
}

/**
 * @param {string[]} names
 * @returns {{ name: string, imageUrl: string, identityHit: boolean, hasDataLogo: boolean }[]}
 */
function resolveNetMapBrandSlots(names) {
  const arr = Array.isArray(names) ? names : [];
  if (arr.length === 0) {
    return [{ name: "—", imageUrl: new URL(DEFAULT_BRAND_LOGO_PATH, window.location.href).href, identityHit: false, hasDataLogo: false }];
  }
  return arr.map((nm) => {
    const r = resolveIdentityLogoByBusinessBrandName(nm);
    return { name: nm, imageUrl: r.imageUrl, identityHit: r.identityHit, hasDataLogo: r.hasDataLogo };
  });
}

/**
 * 标记点图标：优先第一条带 data: LOGO 的；否则首品牌图示 URL
 * @param {{ name: string, imageUrl: string, hasDataLogo: boolean }[]} slots
 */
function netMapMarkerImageUrlFromSlots(slots) {
  const s = Array.isArray(slots) && slots.length ? slots : resolveNetMapBrandSlots([]);
  const withData = s.find((x) => x.hasDataLogo && x.imageUrl && x.imageUrl.startsWith("data:"));
  if (withData) return withData.imageUrl;
  if (s[0] && s[0].imageUrl) return s[0].imageUrl;
  return new URL(DEFAULT_BRAND_LOGO_PATH, window.location.href).href;
}

/**
 * @param {any} wh
 * @param {{ name: string, imageUrl: string, identityHit: boolean, hasDataLogo: boolean }[]} brandSlots
 */
function buildNetMapInfoWindowHtml(wh, brandSlots) {
  const wn = wh && wh.warehouse_name != null ? String(wh.warehouse_name) : "—";
  const code = wh && wh.warehouse_code != null && String(wh.warehouse_code).trim() ? String(wh.warehouse_code).trim() : null;
  const addr = wh && wh.address != null ? String(wh.address) : "";
  const grp = wh && wh.group_name != null ? String(wh.group_name) : "";
  const org = wh && wh.owning_org != null ? String(wh.owning_org) : "";
  const brandRows = (Array.isArray(brandSlots) && brandSlots.length ? brandSlots : resolveNetMapBrandSlots([]))
    .map(
      (b) => `<div class="net-map-info__brand">
        <img class="net-map-info__brand-img" width="40" height="40" alt="" src=${JSON.stringify(
          b.imageUrl,
        )} />
        <div>
          <span class="net-map-info__brand-name">${escapeHtml(b.name)}</span>
          ${b.identityHit ? "" : '<span class="net-map-info__brand-miss">未在品牌标识中配置</span>'}
        </div>
      </div>`,
    )
    .join("");
  const cRow =
    wh && wh._mapLng != null && wh._mapLat != null
      ? `<p class="net-map-info__coord"><span>打点</span> <code>经度 ${Number(wh._mapLng).toFixed(5)}，纬度 ${Number(wh._mapLat).toFixed(5)}</code></p>`
      : "";
  return `<div class="net-map-info">
    <p class="net-map-info__title">${escapeHtml(wn)}${
    code
      ? ` <span class="net-map-info__code"><code>${escapeHtml(code)}</code></span>`
      : ""
  }</p>
    ${cRow}
    ${addr ? `<p class="net-map-info__row"><span>地址</span> ${escapeHtml(addr)}</p>` : ""}
    ${grp ? `<p class="net-map-info__row"><span>集团</span> ${escapeHtml(grp)}</p>` : ""}
    ${org ? `<p class="net-map-info__row"><span>组织</span> ${escapeHtml(org)}</p>` : ""}
    <div class="net-map-info__brands">${brandRows}</div>
  </div>`;
}

/** 仓网地图筛选项：与「仓库主数据」接口 group_name / brand 一致（精确匹配） */
const NET_MAP = { fGroupName: "", fBrand: "" };
let _netMapAMapInstance = null;

function netMapWarehouseListQuery() {
  const p = new URLSearchParams();
  p.set("skip", "0");
  p.set("limit", "200");
  if (NET_MAP.fGroupName) p.set("group_name", NET_MAP.fGroupName);
  if (NET_MAP.fBrand) p.set("brand", NET_MAP.fBrand);
  return p;
}

function netMapDestroyMap() {
  if (_netMapAMapInstance) {
    try {
      _netMapAMapInstance.destroy();
    } catch (e) {
      /* 忽略 */
    }
    _netMapAMapInstance = null;
  }
}

async function initNetMapPage() {
  const errEl = document.getElementById("netMapErr");
  const metaEl = document.getElementById("netMapMeta");
  const mapEl = document.getElementById("netMapContainer");
  if (!mapEl) return;
  netMapDestroyMap();
  if (errEl) errEl.innerHTML = "";

  let totalAll = 0;
  let items = [];
  try {
    const r = await apiFetch(`${API_BASE}/warehouse-base?${netMapWarehouseListQuery()}`);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (errEl) {
        errEl.innerHTML = `<div class="alert alert--error">加载仓库主数据失败：${escapeHtml(
          typeof d.detail === "string" ? d.detail : JSON.stringify(d.detail || d) || r.status,
        )}</div>`;
      }
      if (metaEl) metaEl.textContent = "—";
      return;
    }
    totalAll = Number(d.total) || 0;
    items = Array.isArray(d.items) ? d.items : [];
  } catch (e) {
    if (errEl) errEl.innerHTML = `<div class="alert alert--error">${backendUnreachableHtml(e)}</div>`;
    if (metaEl) metaEl.textContent = "—";
    return;
  }

  const withCoord = [];
  for (const it of items) {
    const xy = parseWarehouseLngLat(it && it.coordinate_raw);
    if (!xy) continue;
    const names = extractWarehouseBusinessBrandNames(it);
    const brandSlots = resolveNetMapBrandSlots(names);
    const entry = { ...it, _mapLng: xy[0], _mapLat: xy[1] };
    withCoord.push({ it: entry, lng: xy[0], lat: xy[1], brandSlots });
  }

  if (metaEl) {
    const fg = NET_MAP.fGroupName ? `集团=<strong>${escapeHtml(NET_MAP.fGroupName)}</strong> ` : "";
    const fb = NET_MAP.fBrand ? `品牌=<strong>${escapeHtml(NET_MAP.fBrand)}</strong> ` : "";
    const fHint = NET_MAP.fGroupName || NET_MAP.fBrand ? `当前筛选：${fg}${fb}。` : "当前为全部。 ";
    let m = `${fHint}本批请求 ${items.length} 条；有有效「仓库坐标」可打点 ${withCoord.length} 条。底图与坐标均为 <strong>GCJ-02</strong>。自采 <strong>GPS WGS-84</strong> 与底图会偏差，建议用主数据按地址补缺。`;
    if (totalAll > 200) m += " 全库条数可能超过 200，当前仅使用前 200 条。";
    metaEl.innerHTML = m;
  }

  if (withCoord.length === 0) {
    if (errEl) {
      if (items.length === 0) {
        const hf =
          NET_MAP.fGroupName || NET_MAP.fBrand
            ? "本筛选下暂无仓库。可尝试放宽「集团 / 业务品牌」或到"
            : "暂无数据。可先到";
        errEl.innerHTML = `<div class="alert alert--muted">${hf}<a href="#warehouse-base" class="nav-tab">仓库基础数据</a>维护。</div>`;
      } else {
        errEl.innerHTML = `<div class="alert alert--muted">本批共 ${items.length} 条，但无有效「仓库坐标」可打点。请在<a href="#warehouse-base" class="nav-tab">仓库主数据</a>中补全经纬度或点「应用筛选」换一批。</div>`;
      }
    }
    return;
  }

  const key =
    (typeof window.__AMAP_WEB_KEY__ === "string" && window.__AMAP_WEB_KEY__) || localStorage.getItem("amap_web_key") || "";
  const securityJsCode =
    (typeof window.__AMAP_SECURITY_JS_CODE__ === "string" && window.__AMAP_SECURITY_JS_CODE__) ||
    localStorage.getItem("amap_security_js_code") ||
    "";
  if (!key) {
    if (errEl) errEl.innerHTML = `<div class="alert alert--error">未配置高德 Web Key（<code>amap-config.js</code> 或 localStorage <code>amap_web_key</code>）。</div>`;
    return;
  }

  try {
    await loadAmapScript(key, securityJsCode);
  } catch {
    if (errEl) errEl.innerHTML = `<div class="alert alert--error">高德地图脚本加载失败。</div>`;
    return;
  }

  const AMap = window.AMap;
  if (!AMap) {
    if (errEl) errEl.innerHTML = `<div class="alert alert--error">高德 AMap 未就绪。</div>`;
    return;
  }

  const map = new AMap.Map("netMapContainer", { zoom: 6, viewMode: "2D" });
  _netMapAMapInstance = map;
  const infoWin = new AMap.InfoWindow({ offset: new AMap.Pixel(0, -28), closeWhenClickMap: true });
  const markers = [];
  for (const row of withCoord) {
    const { it, lng, lat, brandSlots } = row;
    const pos = [lng, lat];
    const iconUrl = netMapMarkerImageUrlFromSlots(brandSlots);
    const mk = new AMap.Marker({
      position: pos,
      map,
      title: (it.warehouse_name && String(it.warehouse_name)) || "",
      zIndex: 100,
    });
    try {
      const S = 32;
      const half = S / 2;
      mk.setIcon(
        new AMap.Icon({
          size: new AMap.Size(S, S),
          image: iconUrl,
          imageSize: new AMap.Size(S, S),
        }),
      );
      // 方标底边中心对准地理点（x 负一半宽、y 负整高，与默认针语义一致，减轻「点不在图标下」的错觉）
      mk.setOffset(new AMap.Pixel(-half, -S));
    } catch {
      /* 退化为默认针 */
    }
    const html = buildNetMapInfoWindowHtml(it, brandSlots);
    mk.on("click", () => {
      infoWin.setContent(html);
      infoWin.open(map, pos);
    });
    markers.push(mk);
  }
  if (markers.length) {
    try {
      map.setFitView(markers, false, [48, 48, 48, 48], 14);
    } catch {
      map.setCenter([withCoord[0].lng, withCoord[0].lat]);
    }
  }
}

function renderNetMap() {
  app.innerHTML = `
    <div class="page-head page-head--compact">
      <p class="empty-hint" style="margin:0;max-width:50rem">
        地图与<strong>高德底图</strong>使用同一坐标系 <strong>GCJ-02</strong>。主数据里「仓库坐标」须为 <strong>经度,纬度</strong>；从表格粘贴成「纬度,经度」时，系统会尽量按国内范围自动纠正。若自采
        <strong>GPS 经纬度</strong> 直填，在图上会与道路偏几十至几百米，建议用主数据里<a href="#warehouse-base" class="nav-tab">按地址</a>重算/补缺。<strong>品牌图示</strong>与「<a href="#brand-identity" class="nav-tab">品牌标识</a>」<strong>同名</strong>行一致（<code>localStorage</code>），未配则用默认图。下方 <strong>集团、业务品牌</strong>筛选会限制本页从接口加载的仓库，从而只显示符合条件的点与信息窗内品牌。
      </p>
    </div>
    <div class="net-map-filters" role="search" aria-label="仓网地图筛选">
      <div class="field" style="min-width:6.5rem">
        <span class="field-label">集团</span>
        <select id="nm-f-group_name" class="net-map-filter-select" aria-label="集团"><option value="">全部</option></select>
      </div>
      <div class="field" style="min-width:7.5rem">
        <span class="field-label">业务品牌</span>
        <select id="nm-f-brand" class="net-map-filter-select" aria-label="业务品牌"><option value="">全部</option></select>
      </div>
      <div class="toolbar" style="margin:0;align-items:flex-end">
        <button type="button" class="btn btn--primary" id="nm-apply">应用筛选</button>
        <button type="button" class="btn btn--secondary" id="nm-reset" title="集团、品牌改回全部">重置</button>
      </div>
    </div>
    <p id="netMapMeta" class="net-map-meta empty-hint" style="margin:8px 0 10px">正在加载数据…</p>
    <div id="netMapErr" class="net-map-err" aria-live="polite"></div>
    <div id="netMapContainer" class="net-map-canvas" role="application" aria-label="高德地图 仓网"></div>
  `;
  void (async function netMapBootstrap() {
    let fo2 = { group_name: [], brand: [] };
    try {
      const r0 = await apiFetch(`${API_BASE}/warehouse-base/filter-options`);
      if (r0.ok) fo2 = await r0.json();
    } catch {
      /* 忽略 */
    }
    const c2 = (k) => (fo2 && Array.isArray(fo2[k]) ? fo2[k] : []);
    const gE = document.getElementById("nm-f-group_name");
    const bE = document.getElementById("nm-f-brand");
    if (gE) gE.innerHTML = wbSelectOptionsHtml(c2("group_name"), NET_MAP.fGroupName);
    if (bE) bE.innerHTML = wbSelectOptionsHtml(c2("brand"), NET_MAP.fBrand);
    const syncN = () => {
      const ga = document.getElementById("nm-f-group_name");
      const ba = document.getElementById("nm-f-brand");
      NET_MAP.fGroupName = ((ga && ga.value) || "").trim();
      NET_MAP.fBrand = ((ba && ba.value) || "").trim();
    };
    document.getElementById("nm-apply")?.addEventListener("click", () => {
      syncN();
      void initNetMapPage();
    });
    document.getElementById("nm-reset")?.addEventListener("click", () => {
      NET_MAP.fGroupName = "";
      NET_MAP.fBrand = "";
      if (gE) gE.innerHTML = wbSelectOptionsHtml(c2("group_name"), "");
      if (bE) bE.innerHTML = wbSelectOptionsHtml(c2("brand"), "");
      void initNetMapPage();
    });
    await initNetMapPage();
  })();
}

const WB = {
  fWarehouse: "",
  warehouseOptions: [],
  fGroupName: "",
  fOwningOrg: "",
  fBrand: "",
  fStatus: "",
  fWarehouseType: "",
  skip: 0,
  limit: 20,
  total: 0,
  editId: null,
  modalKey: null,
  _warehouseComboBlurT: null,
};

const WB_LIST_COLUMNS = [
  { k: "warehouse_code", label: "仓库代码", w: "7rem" },
  { k: "warehouse_name", label: "仓库名称", w: "8.5rem" },
  { k: "group_name", label: "集团", w: "6.5rem" },
  { k: "owning_org", label: "所属组织", w: "9rem" },
  { k: "brand", label: "业务品牌", w: "9.5rem" },
  { k: "status", label: "状态", w: "5rem" },
  { k: "warehouse_type", label: "仓库类型", w: "5.5rem" },
  { k: "address", label: "仓库地址", w: "12rem" },
  { k: "coordinate_raw", label: "仓库坐标", w: "8rem" },
  { k: "area_sqm", label: "仓库面积", w: "5.5rem" },
  { k: "applicant", label: "申请人", w: "5rem" },
  { k: "import_source", label: "写入来源", w: "6.5rem" },
  { k: "created_at", label: "创建时间", w: "9.5rem" },
];

const WB_NCOL = WB_LIST_COLUMNS.length + 1;

const WB_FIELDS = [
  { k: "warehouse_code", label: "仓库代码", t: "text" },
  { k: "warehouse_name", label: "仓库名称", t: "text", req: true },
  { k: "group_name", label: "集团", t: "text", req: true },
  { k: "owning_org", label: "所属组织", t: "text" },
  { k: "logistics_org", label: "物流组织", t: "text" },
  { k: "dc_store_name", label: "配送中心门店名称", t: "text" },
  { k: "warehouse_category", label: "仓库分类", t: "text" },
  { k: "temperature_layer", label: "仓库温层", t: "text" },
  { k: "manager_name", label: "仓库负责人", t: "text" },
  { k: "manager_phone", label: "联系电话", t: "text" },
  { k: "address", label: "仓库地址", t: "area", req: true },
  { k: "coordinate_raw", label: "仓库坐标", t: "text" },
  { k: "status", label: "状态", t: "text" },
  { k: "warehouse_type", label: "仓库类型", t: "text" },
  { k: "business_type", label: "仓库经营类型", t: "text" },
  { k: "property_type", label: "仓库产权", t: "text" },
  { k: "receiver_contact", label: "收货联系人", t: "text" },
  { k: "receiver_phone", label: "收货电话", t: "text" },
  { k: "area_sqm", label: "仓库面积", t: "num" },
  { k: "coverage_region", label: "覆盖门店区域", t: "text" },
  { k: "zone_function", label: "库区功能", t: "text" },
  { k: "expected_store_count", label: "预计覆盖门店数", t: "num" },
  { k: "monthly_covered_stores", label: "本月真实覆盖门店数量", t: "text" },
  { k: "opening_date", label: "开仓日", t: "text" },
  { k: "sku_count_text", label: "覆盖SKU数", t: "text" },
  { k: "purchase_shared_flag", label: "是否启用采购共享仓", t: "text" },
  { k: "purchase_direct_flag", label: "是否启用采购直通", t: "text" },
  { k: "is_group_order_warehouse", label: "当前仓是否商品组下单仓", t: "text" },
  { k: "remark", label: "备注", t: "area" },
  { k: "applicant", label: "申请人", t: "text" },
  { k: "source_created_at", label: "来源侧创建时间", t: "text" },
  { k: "import_source", label: "写入来源", t: "text" },
];

function buildWbColgroupHtml() {
  return `<colgroup>
    ${WB_LIST_COLUMNS.map(
      (c) => `<col class="cp-col" data-wb-colk="${c.k}" style="width:${c.w};min-width:${c.w}"/>`,
    ).join("")}
    <col class="cp-col cp-col--actions" data-wb-colk="_actions" style="width:5.5rem;min-width:5.5rem"/>
  </colgroup>`;
}

function wbListCellText(it, col) {
  const raw = it[col.k];
  if (raw == null || raw === "") return "—";
  const s = String(raw);
  if (col.k === "created_at" || col.k === "updated_at") {
    return s.replace("T", " ").slice(0, 19);
  }
  if (col.k === "area_sqm" && Number.isFinite(Number(raw))) {
    return String(raw);
  }
  return s;
}

function wbListCellDisplay(it, col) {
  const full = wbListCellText(it, col);
  if (full === "—") return { html: "—", title: "" };
  const maxCh = col.k === "address" ? 40 : 32;
  const t = full.length > maxCh ? full.slice(0, maxCh) + "…" : full;
  return {
    html: escapeHtml(t),
    title: full.length > maxCh ? ` title="${escapeHtml(full)}"` : "",
  };
}

function wbFieldInputHtml(f, val) {
  const v = val != null && val !== "" ? String(val) : "";
  const req = f.req ? " *" : "";
  if (f.t === "area") {
    return `<div class="field field--cp">
      <span class="field-label">${escapeHtml(f.label)}${req}</span>
      <textarea data-wb-key="${f.k}" rows="2" class="cp-input">${escapeHtml(v)}</textarea>
    </div>`;
  }
  if (f.t === "num") {
    const numV = v === "" || v === "null" ? "" : v;
    return `<div class="field field--cp">
      <span class="field-label">${escapeHtml(f.label)}</span>
      <input class="cp-input" type="number" step="any" data-wb-key="${f.k}" value="${escapeHtml(
        numV,
      )}" />
    </div>`;
  }
  return `<div class="field field--cp">
    <span class="field-label">${escapeHtml(f.label)}${req}</span>
    <input class="cp-input" type="text" data-wb-key="${f.k}" value="${escapeHtml(v)}" />
  </div>`;
}

function _wbApiOrigin() {
  try {
    return new URL(API_BASE, window.location.href).origin;
  } catch {
    return "";
  }
}

function _wbPublicLogoUrl(logoPath) {
  if (!logoPath) return "";
  const p = String(logoPath);
  if (p.startsWith("http://") || p.startsWith("https://")) return p;
  return _wbApiOrigin() + (p.startsWith("/") ? p : `/${p}`);
}

function wbBusinessBrandRowHtml(b) {
  const name = b && b.name != null ? String(b.name) : "";
  const la = b && b.logo_as != null ? String(b.logo_as) : "";
  const imgSrc = b && b.logo_url ? _wbPublicLogoUrl(b.logo_url) : "";
  const prev = imgSrc
    ? `<img class="wb-bb-preview" src="${escapeHtml(imgSrc)}" alt="" width="64" height="32" style="object-fit:contain" />`
    : "";
  return `<div class="wb-bb-row">
    <div class="wb-bb-row__grid">
      <div class="field field--cp" style="margin:0">
        <span class="field-label">业务品牌 *</span>
        <input type="text" class="cp-input wb-bb-name" value="${escapeHtml(
          name,
        )}" placeholder="如 万好" />
      </div>
      <div class="field field--cp" style="margin:0">
        <span class="field-label">LOGO 沿用</span>
        <input type="text" class="cp-input wb-bb-logo-as" value="${escapeHtml(
          la,
        )}" placeholder="如 好想来" />
        <p class="empty-hint" style="margin:2px 0 0;font-size:0.75rem">使用哪套门店/连锁图示（与侧栏系统品牌不同）</p>
      </div>
    </div>
    <div class="wb-bb-file-row" style="margin-top:6px;align-items:center;gap:8px;flex-wrap:wrap;display:flex">
      <span class="field-label" style="margin:0;min-width:4rem">图示上传</span>
      <input type="file" class="input-file wb-bb-file" accept="image/*" />
      ${prev}
    </div>
  </div>`;
}

function wbBuildBusinessBrandsBlockHtml(biz) {
  const rows = Array.isArray(biz) && biz.length > 0 ? biz : [{ name: "", logo_as: "" }];
  return `<div class="field field--cp wb-bb-block" id="wb-bb-block">
  <span class="field-label">业务品牌（可多行）</span>
  <p class="empty-hint" style="margin:0 0 8px">
    用于业务数据、报表与展示，<strong>不是</strong>本系统侧栏的「品牌标识」设置。可多条，如 <strong>万好</strong> 且 LOGO 沿用 <strong>好想来</strong>。
  </p>
  <div id="wb-bb-rows" class="wb-bb-rows">${rows.map((b) => wbBusinessBrandRowHtml(b)).join("")}</div>
  <button type="button" class="btn btn--secondary btn--sm" id="wb-bb-add" type="button">添加一行业务品牌</button>
</div>`;
}

function wbBuildFormFieldsHtml(bizBrands) {
  const bbr = Array.isArray(bizBrands) && bizBrands.length ? bizBrands : null;
  return (
    WB_FIELDS.map((f) => wbFieldInputHtml(f, "")).join("") + wbBuildBusinessBrandsBlockHtml(bbr)
  );
}

function wbFormValuesFromData(data) {
  if (!data) return;
  const wrap = document.getElementById("wb-form-fields");
  if (wrap) {
    const bbr =
      Array.isArray(data.business_brands) && data.business_brands.length
        ? data.business_brands
        : [{ name: "", logo_as: "" }];
    wrap.innerHTML = wbBuildFormFieldsHtml(bbr);
    wbBindBusinessBrandsAdd();
  }
  for (const f of WB_FIELDS) {
    const el = document.querySelector(`[data-wb-key="${f.k}"]`);
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

function wbBindBusinessBrandsAdd() {
  document.getElementById("wb-bb-add")?.addEventListener("click", () => {
    const c = document.getElementById("wb-bb-rows");
    if (!c) return;
    c.insertAdjacentHTML("beforeend", wbBusinessBrandRowHtml({ name: "", logo_as: "" }));
  });
}

function wbCollectBusinessBrandsPayload() {
  const rows = document.querySelectorAll("#wb-bb-rows .wb-bb-row");
  const out = [];
  for (const row of rows) {
    const name = (row.querySelector(".wb-bb-name")?.value ?? "").trim();
    const logo_as = (row.querySelector(".wb-bb-logo-as")?.value ?? "").trim();
    if (!name) continue;
    out.push({ name, logo_as: logo_as || null });
  }
  return out;
}

function wbFormCollectPayload() {
  const o = {};
  for (const f of WB_FIELDS) {
    const el = document.querySelector(`[data-wb-key="${f.k}"]`);
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
  o.business_brands = wbCollectBusinessBrandsPayload();
  return o;
}

/**
 * 保存成功后，按与提交顺序一致的业务品牌行上传各 `图示上传` 文件（仅含名称非空的行与服务器返回的 id 对齐）。
 * @param {any} saved
 * @returns {Promise<string[]>} 每行错误说明，空数组表示均成功
 */
async function wbUploadBusinessBrandLogosAfterSave(saved) {
  const bbs = Array.isArray(saved?.business_brands) ? saved.business_brands : [];
  const rows = document.querySelectorAll("#wb-bb-rows .wb-bb-row");
  const errs = [];
  let j = 0;
  for (const row of rows) {
    const name = (row.querySelector(".wb-bb-name")?.value ?? "").trim();
    if (!name) continue;
    const bb = bbs[j];
    j += 1;
    const id = bb?.id;
    if (id == null) continue;
    const file = row.querySelector(".wb-bb-file")?.files?.[0];
    if (!file) continue;
    const fd = new FormData();
    fd.append("file", file);
    const r = await apiFetch(`${API_BASE}/warehouse-base/business-brands/${id}/file`, {
      method: "POST",
      body: fd,
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      const msg = typeof d.detail === "string" ? d.detail : JSON.stringify(d.detail || d) || String(r.status);
      errs.push(`${name}：${msg}`);
    }
  }
  return errs;
}

function wbOpenModal() {
  const m = document.getElementById("wb-modal");
  if (!m) return;
  m.removeAttribute("hidden");
  m.classList.add("modal--open");
  WB.modalKey?.abort();
  WB.modalKey = new AbortController();
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") wbCloseModal();
    },
    { signal: WB.modalKey.signal },
  );
}

function wbCloseModal() {
  const m = document.getElementById("wb-modal");
  if (!m) return;
  WB.modalKey?.abort();
  WB.modalKey = null;
  m.classList.remove("modal--open");
  m.setAttribute("hidden", "");
  WB.editId = null;
}

function wbSyncFiltersFromInputs() {
  const gv = (id) => (document.getElementById(id)?.value ?? "").trim();
  WB.fWarehouse = gv("wb-f-warehouse");
  WB.fGroupName = gv("wb-f-group_name");
  WB.fOwningOrg = gv("wb-f-owning_org");
  WB.fBrand = gv("wb-f-brand");
  WB.fStatus = gv("wb-f-status");
  WB.fWarehouseType = gv("wb-f-warehouse_type");
  const ps = document.getElementById("wb-page-size");
  if (ps) {
    const n = parseInt(String(ps.value), 10);
    if (n === 20 || n === 50 || n === 100) WB.limit = n;
  }
}

function wbBuildFilterQuery() {
  const p = new URLSearchParams();
  if (WB.fWarehouse) p.set("warehouse", WB.fWarehouse);
  if (WB.fGroupName) p.set("group_name", WB.fGroupName);
  if (WB.fOwningOrg) p.set("owning_org", WB.fOwningOrg);
  if (WB.fBrand) p.set("brand", WB.fBrand);
  if (WB.fStatus) p.set("status", WB.fStatus);
  if (WB.fWarehouseType) p.set("warehouse_type", WB.fWarehouseType);
  return p;
}

function wbUpdateExportLink() {
  /* 导出已改为带 Token 的点击下载，筛选在点击「导出」时读取当前表单 */
}

function wbComboboxLabel(row) {
  if (!row || typeof row !== "object") return "";
  const c = String(row.warehouse_code != null ? row.warehouse_code : "").trim();
  const n = String(row.warehouse_name != null ? row.warehouse_name : "").trim();
  if (c && n) return `${c}（${n}）`;
  if (n) return n;
  return c || "";
}

function wbRowMatchesLocalWarehouseQ(row, q) {
  if (!q) return true;
  const t = String(q).toLowerCase();
  const c = String(row.warehouse_code != null ? row.warehouse_code : "").toLowerCase();
  const n = String(row.warehouse_name != null ? row.warehouse_name : "").toLowerCase();
  if (c.includes(t) || n.includes(t)) return true;
  return wbComboboxLabel(row).toLowerCase().includes(t);
}

function wbShowWarehouseCombobox() {
  const input = document.getElementById("wb-f-warehouse");
  if (input) {
    input.setAttribute("aria-expanded", "true");
  }
  const ul = document.getElementById("wb-warehouse-cb-list");
  if (ul) ul.removeAttribute("hidden");
}

function wbHideWarehouseCombobox() {
  const input = document.getElementById("wb-f-warehouse");
  if (input) {
    input.setAttribute("aria-expanded", "false");
  }
  const ul = document.getElementById("wb-warehouse-cb-list");
  if (ul) ul.setAttribute("hidden", "");
}

function wbRefreshWarehouseComboboxList() {
  const input = document.getElementById("wb-f-warehouse");
  const ul = document.getElementById("wb-warehouse-cb-list");
  if (!input || !ul) return;
  const q = (input.value ?? "").trim();
  let rows = Array.isArray(WB.warehouseOptions) ? [...WB.warehouseOptions] : [];
  rows = rows.filter((r) => wbRowMatchesLocalWarehouseQ(r, q));
  const cap = 300;
  rows = rows.slice(0, cap);
  if (rows.length === 0) {
    ul.innerHTML = `<li class="wb-warehouse-cb__empty" role="presentation">无匹配项</li>`;
    return;
  }
  ul.innerHTML = rows
    .map((r) => {
      const label = wbComboboxLabel(r);
      const payload = encodeURIComponent(
        JSON.stringify({
          warehouse_code: r.warehouse_code,
          warehouse_name: r.warehouse_name,
        }),
      );
      return `<li role="presentation">
      <button type="button" class="wb-warehouse-cb__opt" data-payload="${escapeHtml(payload)}">${escapeHtml(
        label,
      )}</button>
    </li>`;
    })
    .join("");
}

function wbSetWarehouseComboboxData(fo) {
  WB.warehouseOptions = Array.isArray(fo && fo.warehouses) ? fo.warehouses : [];
}

let _wbComboboxDocBound = false;
function wbBindWarehouseCombobox() {
  if (_wbComboboxDocBound) {
    return;
  }
  _wbComboboxDocBound = true;
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof Node)) return;
    const wrap = document.querySelector(".wb-warehouse-cb__wrap");
    if (wrap && !wrap.contains(t)) {
      wbHideWarehouseCombobox();
    }
  });
}

function wbInitWarehouseCombobox() {
  const input = document.getElementById("wb-f-warehouse");
  const ul = document.getElementById("wb-warehouse-cb-list");
  if (!input || !ul) return;
  wbBindWarehouseCombobox();
  input.setAttribute("aria-controls", "wb-warehouse-cb-list");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  if (input.value !== WB.fWarehouse) {
    input.value = WB.fWarehouse;
  }
  const onOpen = () => {
    if (WB._warehouseComboBlurT) {
      clearTimeout(WB._warehouseComboBlurT);
      WB._warehouseComboBlurT = null;
    }
    wbRefreshWarehouseComboboxList();
    wbShowWarehouseCombobox();
  };
  input.addEventListener("focus", onOpen);
  input.addEventListener("input", () => {
    WB.fWarehouse = (input.value ?? "").trim();
    wbRefreshWarehouseComboboxList();
    wbShowWarehouseCombobox();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      wbHideWarehouseCombobox();
    }
  });
  input.addEventListener("blur", () => {
    if (WB._warehouseComboBlurT) {
      clearTimeout(WB._warehouseComboBlurT);
    }
    WB._warehouseComboBlurT = setTimeout(() => {
      wbHideWarehouseCombobox();
    }, 120);
  });
  ul.addEventListener("mousedown", (e) => {
    const b = e.target && e.target.closest ? e.target.closest("button.wb-warehouse-cb__opt") : null;
    if (!(b instanceof HTMLButtonElement) || !b.dataset.payload) return;
    e.preventDefault();
    let o;
    try {
      o = JSON.parse(decodeURIComponent(b.dataset.payload));
    } catch {
      return;
    }
    const code = (o.warehouse_code != null ? String(o.warehouse_code) : "").trim();
    const name = (o.warehouse_name != null ? String(o.warehouse_name) : "").trim();
    input.value = code && name ? `${code} ${name}` : code || name;
    WB.fWarehouse = (input.value ?? "").trim();
    wbUpdateExportLink();
    wbRefreshWarehouseComboboxList();
  });
}

/** 筛选项：枚举多选一下拉；value 用 escapeHtml 防注入 */
function wbSelectOptionsHtml(options, currentVal) {
  const list = Array.isArray(options) ? options : [];
  const cur = (currentVal != null && currentVal !== "" ? String(currentVal) : "").trim();
  const set = new Set(list);
  let html = `<option value="">全部</option>`;
  for (const v of list) {
    const s = v != null ? String(v) : "";
    const selected = s === cur ? " selected" : "";
    html += `<option value="${escapeHtml(s)}"${selected}>${escapeHtml(s)}</option>`;
  }
  if (cur && !set.has(cur)) {
    html += `<option value="${escapeHtml(cur)}" selected>${escapeHtml(
      cur,
    )}（未在枚举中）</option>`;
  }
  return html;
}

/**
 * @param {Record<string, string[]>} fo
 * @param {number} lim
 */
function buildWarehouseBasePageHtml(fo, lim) {
  wbSetWarehouseComboboxData(fo);
  const c = (k) => (fo && Array.isArray(fo[k]) ? fo[k] : []);
  const wv = escapeHtml(WB.fWarehouse);
  return `
    <div class="page-head page-head--compact">
      <p><small class="empty-hint">与「<strong>仓管理</strong>」Excel 一致。业务必填为<strong>仓库名称、仓库地址、业务品牌、集团</strong>（与页面标 * 一致）；<strong>仓库代码可空</strong>。保存仓库后会<strong>按仓库地址</strong>自动请求高德并写入「仓库坐标」（未配置 Key 时与排线页一致为模拟）。可点<strong>经纬度补缺</strong>对当前筛条件下的记录批量补坐标。<strong>上传导入成功</strong>后，库表<strong>仅保留</strong>本次 Excel 中<strong>校验通过</strong>的行；未出现在文件中的旧数据会<strong>全部删除</strong>。同次导入中相同「仓库代码」或（无代码时）相同「名称+集团+地址」以<strong>后者为准</strong>。导入时必填列须均有值。下拉里可<strong>输入关键字</strong>在「代码+名称」候选中再过滤；<strong>仓库</strong>筛选项对库内为<strong>代码或名称子串</strong>；其余为<strong>精确</strong>。多选为「且」。<strong>导出会带上当前筛选</strong>。导入/新增/编辑后点「刷新」可更新候选项。</small></p>
    </div>
    <div class="wb-filters" role="search" aria-label="仓库主数据筛选">
      <div class="field field--wb-warehouse" style="min-width:10rem;max-width:20rem">
        <span class="field-label">仓库</span>
        <div class="wb-warehouse-cb__wrap">
          <input
            type="text"
            id="wb-f-warehouse"
            class="cp-input wb-warehouse-cb__input"
            placeholder="代码或名称，模糊"
            value="${wv}"
            autocomplete="off"
            aria-label="仓库（代码与名称，模糊）"
            aria-autocomplete="list"
            role="combobox"
            aria-controls="wb-warehouse-cb-list"
            aria-expanded="false"
          />
          <ul id="wb-warehouse-cb-list" class="wb-warehouse-cb__list" role="listbox" hidden></ul>
        </div>
      </div>
      <div class="field" style="min-width:6.5rem">
        <span class="field-label">集团</span>
        <select id="wb-f-group_name" class="wb-filter-select" aria-label="集团">${wbSelectOptionsHtml(
          c("group_name"),
          WB.fGroupName,
        )}</select>
      </div>
      <div class="field" style="min-width:8.5rem">
        <span class="field-label">所属组织</span>
        <select id="wb-f-owning_org" class="wb-filter-select" aria-label="所属组织">${wbSelectOptionsHtml(
          c("owning_org"),
          WB.fOwningOrg,
        )}</select>
      </div>
      <div class="field" style="min-width:8.5rem">
        <span class="field-label">业务品牌</span>
        <select
          id="wb-f-brand"
          class="wb-filter-select"
          aria-label="业务品牌（数据中的品牌名，与侧栏系统品牌无关）"
        >${wbSelectOptionsHtml(
          c("brand"),
          WB.fBrand,
        )}</select>
      </div>
      <div class="field" style="min-width:5.5rem">
        <span class="field-label">状态</span>
        <select id="wb-f-status" class="wb-filter-select" aria-label="状态">${wbSelectOptionsHtml(
          c("status"),
          WB.fStatus,
        )}</select>
      </div>
      <div class="field" style="min-width:6.5rem">
        <span class="field-label">仓库类型</span>
        <select id="wb-f-warehouse_type" class="wb-filter-select" aria-label="仓库类型">${wbSelectOptionsHtml(
          c("warehouse_type"),
          WB.fWarehouseType,
        )}</select>
      </div>
    </div>
    <div class="toolbar" style="flex-wrap:wrap;align-items:center;margin-top:10px;gap:8px 12px">
      <button type="button" class="btn btn--secondary" id="wb-search">查询</button>
      <button type="button" class="btn btn--secondary" id="wb-filter-reset" title="筛选项改回全部">重置条件</button>
      <button type="button" class="btn btn--secondary" id="wb-refresh">刷新</button>
      <span class="toolbar__sep" aria-hidden="true" style="opacity:0.35">|</span>
      <button type="button" class="btn btn--primary" id="wb-new">新增</button>
      <button type="button" class="btn btn--secondary" id="wb-geocode-bulk" title="按当前筛选，对无「仓库坐标」的仓库用地址调高德并落库，最多 3000 条">
        经纬度补缺
      </button>
      <button type="button" class="btn btn--secondary" id="wb-export">导出 Excel</button>
      <div class="field field--file-import">
        <span class="field-label">导入</span>
        <input type="file" id="wb-file" class="input-file" accept=".xlsx,.xls" />
      </div>
      <button type="button" class="btn btn--primary" id="wb-import">上传导入</button>
    </div>
    <div id="wb-msg" style="margin-top:8px"></div>
    <div class="toolbar wb-pager" role="group" aria-label="分页" style="flex-wrap:wrap;align-items:center;margin:12px 0;gap:8px 12px">
      <span id="wb-total" class="cp-list-meta__total" style="margin:0">共 — 条</span>
      <div class="field" style="min-width:5rem">
        <span class="field-label">每页</span>
        <select id="wb-page-size" aria-label="每页条数">
          <option value="20" ${lim === 20 ? "selected" : ""}>20</option>
          <option value="50" ${lim === 50 ? "selected" : ""}>50</option>
          <option value="100" ${lim === 100 ? "selected" : ""}>100</option>
        </select>
      </div>
      <span id="wb-page-info" class="empty-hint" style="margin:0"></span>
      <button type="button" class="btn btn--secondary" id="wb-prev" disabled>上一页</button>
      <button type="button" class="btn btn--secondary" id="wb-next" disabled>下一页</button>
    </div>
    <div class="table-scroll cp-table-scroll">
      <table class="data-table data-table--cp" id="wb-table">
        ${buildWbColgroupHtml()}
        <thead>
          <tr>
            ${WB_LIST_COLUMNS.map(
              (c2) =>
                `<th class="cp-th" scope="col"><span class="cp-th__text">${escapeHtml(
                  c2.label,
                )}</span></th>`,
            ).join("")}
            <th class="cp-th cp-th--action" scope="col"><span class="cp-th__text">操作</span></th>
          </tr>
        </thead>
        <tbody id="wb-tbody"></tbody>
      </table>
    </div>
    <div id="wb-modal" class="modal" hidden>
      <div class="modal__backdrop" data-wb-m-close></div>
      <div class="modal__dialog modal__dialog--xl" role="dialog" aria-modal="true">
        <h2 class="modal__title" id="wb-modal-title">仓库</h2>
        <p class="empty-hint" style="margin-top:0">标 * 为必填（<strong>仓库名称、仓库地址、集团</strong>，以及下方<strong>至少一条业务品牌</strong>）；仓库代码可空。与来源 Excel 字段对齐；<strong>业务品牌</strong>与侧栏「品牌标识」不是同一套设置。</p>
        <div class="cp-form-grid" id="wb-form-fields">${wbBuildFormFieldsHtml(null)}</div>
        <div class="modal__actions">
          <button type="button" class="btn btn--secondary" data-wb-m-close>取消</button>
          <button type="button" class="btn btn--primary" id="wb-save">保存</button>
        </div>
      </div>
    </div>
  `;
}

function wbRepaintFilterSelects(fo) {
  const c = (k) => (fo && Array.isArray(fo[k]) ? fo[k] : []);
  const m = [
    ["fGroupName", "group_name", "wb-f-group_name"],
    ["fOwningOrg", "owning_org", "wb-f-owning_org"],
    ["fBrand", "brand", "wb-f-brand"],
    ["fStatus", "status", "wb-f-status"],
    ["fWarehouseType", "warehouse_type", "wb-f-warehouse_type"],
  ];
  for (const [wk, fk, elid] of m) {
    const el = document.getElementById(elid);
    if (el) el.innerHTML = wbSelectOptionsHtml(c(fk), WB[wk]);
  }
  wbSetWarehouseComboboxData(fo);
  wbRefreshWarehouseComboboxList();
}

async function wbReloadFilterOptions() {
  try {
    const r = await apiFetch(`${API_BASE}/warehouse-base/filter-options`);
    if (!r.ok) return;
    const fo = await r.json();
    wbSyncFiltersFromInputs();
    wbRepaintFilterSelects(fo);
  } catch (e) {
    /* 忽略，列表仍可用手动保留下来的筛选 */
  }
}

async function wbAfterDataMutation() {
  await wbReloadFilterOptions();
  await wbLoadList();
}

function wbUpdatePager() {
  const total = Number(WB.total) || 0;
  const limit = Math.min(200, Math.max(1, Number(WB.limit) || 20));
  const skip = Math.max(0, Number(WB.skip) || 0);
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
  const currentPage = total === 0 ? 0 : Math.min(totalPages, Math.floor(skip / limit) + 1);
  const totalEl = document.getElementById("wb-total");
  if (totalEl) {
    totalEl.textContent = `共 ${total} 条`;
  }
  const pageEl = document.getElementById("wb-page-info");
  if (pageEl) {
    pageEl.textContent =
      total === 0
        ? "第 0 / 0 页"
        : `第 ${currentPage} / ${totalPages} 页（每页 ${limit} 条）`;
  }
  const prev = document.getElementById("wb-prev");
  const next = document.getElementById("wb-next");
  if (prev) prev.disabled = total === 0 || skip <= 0;
  if (next) next.disabled = total === 0 || skip + limit >= total;
  const psize = document.getElementById("wb-page-size");
  if (psize && String(psize.value) !== String(WB.limit)) psize.value = String(WB.limit);
}

function wbResetFilters() {
  WB.fWarehouse = "";
  WB.fGroupName = "";
  WB.fOwningOrg = "";
  WB.fBrand = "";
  WB.fStatus = "";
  WB.fWarehouseType = "";
  WB.skip = 0;
  for (const id of [
    "wb-f-warehouse",
    "wb-f-group_name",
    "wb-f-owning_org",
    "wb-f-brand",
    "wb-f-status",
    "wb-f-warehouse_type",
  ]) {
    const el = document.getElementById(id);
    if (el) el.value = "";
  }
  wbHideWarehouseCombobox();
}

async function wbLoadList() {
  const tbody = document.getElementById("wb-tbody");
  if (!tbody) return;
  wbSyncFiltersFromInputs();
  tbody.innerHTML = `<tr><td colspan="${WB_NCOL}" class="empty-hint">加载中…</td></tr>`;
  const q = wbBuildFilterQuery();
  q.set("skip", String(WB.skip));
  q.set("limit", String(WB.limit));
  try {
    const r = await apiFetch(`${API_BASE}/warehouse-base?${q}`);
    const d = await r.json();
    if (!r.ok) {
      tbody.innerHTML = `<tr><td colspan="${WB_NCOL}" class="alert alert--error">加载失败</td></tr>`;
      return;
    }
    WB.total = Number(d.total) || 0;
    wbUpdatePager();
    wbUpdateExportLink();
    const items = d.items || [];
    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${WB_NCOL}" class="empty-hint">暂无数据。可调整筛选条件、导入与「仓管理」模板一致的 .xlsx，或点新增。</td></tr>`;
      return;
    }
    tbody.innerHTML = items
      .map((it) => {
        const cells = WB_LIST_COLUMNS.map((col) => {
          const { html, title } = wbListCellDisplay(it, col);
          return `<td class="cp-list-cell"${title}>${html}</td>`;
        }).join("");
        return `<tr>${cells}<td class="table-actions">
        <button type="button" class="btn btn--secondary btn--sm" data-wb="edit" data-id="${it.id}">编辑</button>
        <button type="button" class="btn btn--secondary btn--sm" data-wb="del" data-id="${it.id}" style="color:var(--danger)">删除</button>
      </td></tr>`;
      })
      .join("");
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="${WB_NCOL}">${backendUnreachableHtml(e)}</td></tr>`;
  }
}

function bindWarehouseBaseEvents() {
  wbInitWarehouseCombobox();
  document.getElementById("wb-export")?.addEventListener("click", (ev) => {
    ev.preventDefault();
    const q = wbBuildFilterQuery().toString();
    const url = q ? `${API_BASE}/warehouse-base/export?${q}` : `${API_BASE}/warehouse-base/export`;
    void downloadBlobFromApiUrl(url, "仓库基础数据.xlsx");
  });
  document.getElementById("wb-search")?.addEventListener("click", () => {
    wbSyncFiltersFromInputs();
    WB.skip = 0;
    void wbLoadList();
  });
  document.getElementById("wb-filter-reset")?.addEventListener("click", () => {
    wbResetFilters();
    void wbLoadList();
  });
  document.getElementById("wb-refresh")?.addEventListener("click", () => {
    void (async () => {
      await wbReloadFilterOptions();
      await wbLoadList();
    })();
  });
  document.getElementById("wb-page-size")?.addEventListener("change", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLSelectElement)) return;
    const n = parseInt(String(t.value), 10);
    if (n === 20 || n === 50 || n === 100) {
      WB.limit = n;
      WB.skip = 0;
      void wbLoadList();
    }
  });
  document.getElementById("wb-new")?.addEventListener("click", () => {
    WB.editId = null;
    const t = document.getElementById("wb-modal-title");
    if (t) t.textContent = "新增仓库";
    const wrap = document.getElementById("wb-form-fields");
    if (wrap) {
      wrap.innerHTML = wbBuildFormFieldsHtml(null);
      const imp = document.querySelector(`[data-wb-key="import_source"]`);
      if (imp) imp.value = "页面录入";
    }
    wbBindBusinessBrandsAdd();
    wbOpenModal();
  });
  document.getElementById("wb-import")?.addEventListener("click", async () => {
    const file = document.getElementById("wb-file")?.files?.[0];
    if (!file) {
      const el = document.getElementById("wb-msg");
      if (el) el.innerHTML = `<div class="alert alert--muted">请先选择 .xlsx 文件</div>`;
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    const el = document.getElementById("wb-msg");
    if (el) el.innerHTML = `<div class="alert alert--muted">正在上传…</div>`;
    const r = await apiFetch(
      `${API_BASE}/warehouse-base/import?${new URLSearchParams({ data_source: "页面导入" })}`,
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
    void wbAfterDataMutation();
  });
  document.getElementById("wb-geocode-bulk")?.addEventListener("click", async () => {
    wbSyncFiltersFromInputs();
    const q = wbBuildFilterQuery();
    q.set("only_missing", "true");
    const el = document.getElementById("wb-msg");
    if (el) el.innerHTML = `<div class="alert alert--muted">正在按地址补全经纬度（当前筛选，仅补缺）…</div>`;
    try {
      const r = await apiFetch(`${API_BASE}/warehouse-base/batch-geocode?${q}`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (el) {
          el.innerHTML = `<div class="alert alert--error">${escapeHtml(
            typeof d.detail === "string" ? d.detail : JSON.stringify(d.detail || d) || "请求失败",
          )}</div>`;
        }
        return;
      }
      const cap = d.capped ? "（命中超过 3000 条，仅处理前 3000 条）" : "";
      if (el) {
        el.innerHTML = `<div class="alert" style="background:#ecfdf5;border-color:#a7f3d0">${escapeHtml(
          `补缺完成：更新 ${d.updated ?? 0} 条，跳过 ${d.skipped ?? 0} 条，失败 ${d.failed ?? 0} 条${cap}。`,
        )}</div>`;
      }
      void wbAfterDataMutation();
    } catch (e) {
      if (el) {
        el.innerHTML = `<div class="alert alert--error">${escapeHtml(String(e && e.message ? e.message : e))}</div>`;
      }
    }
  });
  document.getElementById("wb-prev")?.addEventListener("click", () => {
    wbSyncFiltersFromInputs();
    if (WB.skip <= 0) return;
    WB.skip = Math.max(0, WB.skip - WB.limit);
    void wbLoadList();
  });
  document.getElementById("wb-next")?.addEventListener("click", () => {
    wbSyncFiltersFromInputs();
    if (Number(WB.total) > 0 && WB.skip + WB.limit < WB.total) {
      WB.skip += WB.limit;
      void wbLoadList();
    }
  });
  document.getElementById("wb-modal")?.querySelectorAll("[data-wb-m-close]").forEach((b) => {
    b.addEventListener("click", () => wbCloseModal());
  });
  document.getElementById("wb-save")?.addEventListener("click", async () => {
    const body = wbFormCollectPayload();
    const wbRequired = [
      ["warehouse_name", "仓库名称"],
      ["group_name", "集团"],
      ["address", "仓库地址"],
    ];
    for (const [key, label] of wbRequired) {
      const raw = body[key];
      if (raw == null || String(raw).trim() === "") {
        const el = document.getElementById("wb-msg");
        if (el) el.innerHTML = `<div class="alert alert--error">请填写${label}</div>`;
        return;
      }
    }
    if (!Array.isArray(body.business_brands) || body.business_brands.length === 0) {
      const el = document.getElementById("wb-msg");
      if (el) {
        el.innerHTML = `<div class="alert alert--error">请至少添加一行业务品牌并填写「业务品牌」名称</div>`;
      }
      return;
    }
    const isEdit = WB.editId != null;
    const url = isEdit
      ? `${API_BASE}/warehouse-base/${WB.editId}`
      : `${API_BASE}/warehouse-base`;
    const r = await apiFetch(url, {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      const el = document.getElementById("wb-msg");
      if (el) {
        el.innerHTML = `<div class="alert alert--error">${escapeHtml(
          typeof d.detail === "string" ? d.detail : JSON.stringify(d.detail || d) || "保存失败",
        )}</div>`;
      }
      return;
    }
    const logoErrs = await wbUploadBusinessBrandLogosAfterSave(d);
    wbCloseModal();
    const el = document.getElementById("wb-msg");
    if (el) {
      if (logoErrs.length) {
        el.innerHTML = `<div class="alert" style="background:#fef3c7;border-color:#fcd34d">${escapeHtml(
          "已保存。部分业务品牌图示未上传：",
        )}${escapeHtml(logoErrs.join("；"))}</div>`;
      } else {
        el.innerHTML = `<div class="alert" style="background:#ecfdf5;border-color:#a7f3d0">已保存</div>`;
      }
    }
    void wbAfterDataMutation();
  });

  document.getElementById("wb-table")?.addEventListener("click", async (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    const id = t.getAttribute("data-id");
    if (t.getAttribute("data-wb") === "edit" && id) {
      WB.editId = parseInt(id, 10);
      const r = await apiFetch(`${API_BASE}/warehouse-base/${id}`);
      const it = await r.json();
      if (!r.ok) return;
      const title = document.getElementById("wb-modal-title");
      if (title) title.textContent = "编辑仓库";
      wbFormValuesFromData(it);
      wbOpenModal();
    }
    if (t.getAttribute("data-wb") === "del" && id) {
      if (!window.confirm("确定删除该条仓库主数据？")) return;
      const r2 = await apiFetch(`${API_BASE}/warehouse-base/${id}`, { method: "DELETE" });
      if (r2.ok) {
        void wbAfterDataMutation();
      } else {
        const x = await r2.json().catch(() => ({}));
        const el = document.getElementById("wb-msg");
        if (el) {
          el.innerHTML = `<div class="alert alert--error">${escapeHtml(x.detail || "删除失败")}</div>`;
        }
      }
    }
  });
  void wbLoadList();
}

function renderWarehouseBase() {
  WB.editId = null;
  if (![20, 50, 100].includes(WB.limit)) WB.limit = 20;
  const lim = WB.limit;
  app.innerHTML = `<div class="page-head page-head--compact"><p class="empty-hint" style="margin:0">正在加载筛选项…</p></div>`;
  void (async () => {
    let fo = {
      warehouses: [],
      group_name: [],
      owning_org: [],
      brand: [],
      status: [],
      warehouse_type: [],
    };
    try {
      const r = await apiFetch(`${API_BASE}/warehouse-base/filter-options`);
      if (r.ok) fo = { ...fo, ...(await r.json()) };
    } catch (_e) {
      /* 忽略，仍渲染空下拉 */
    }
    app.innerHTML = buildWarehouseBasePageHtml(fo, lim);
    bindWarehouseBaseEvents();
    void wbLoadList();
  })();
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
      <button type="button" class="btn btn--secondary" id="cp-export">导出 Excel</button>
      <div class="field field--file-import">
        <span class="field-label">导入</span>
        <input type="file" id="cp-file" class="input-file" accept=".xlsx,.xls" />
      </div>
      <button type="button" class="btn btn--primary" id="cp-import">上传导入</button>
    </div>
    <div id="cp-msg" style="margin-top:8px"></div>
    <p class="empty-hint" style="margin:0 0 8px;font-size:0.8rem">列宽可拖动表头右缘调整，刷新后仍保留；地址、坐标、备注等列已加默认可视宽度。</p>
    <div class="cp-list-meta" role="toolbar" aria-label="列表信息">
      <span id="cp-total" class="cp-list-meta__total"></span>
      <button type="button" class="btn btn--secondary btn--sm cp-list-meta__reset" id="cp-width-reset" title="清除本机保存的列宽，恢复默认">重置列宽</button>
    </div>
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
  document.getElementById("cp-export")?.addEventListener("click", (ev) => {
    ev.preventDefault();
    void downloadBlobFromApiUrl(`${API_BASE}/customer-profiles/export`, "客户列表.xlsx");
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
    const r = await apiFetch(
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
    const r = await apiFetch(url, {
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
      const r = await apiFetch(`${API_BASE}/customer-profiles/${id}`);
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
      const r2 = await apiFetch(`${API_BASE}/customer-profiles/${id}`, { method: "DELETE" });
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
    const r = await apiFetch(`${API_BASE}/store-coordinates?${q}`);
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
    const r = await apiFetch(`${API_BASE}/store-pair-distances?${q}`);
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
        <button type="button" class="btn btn--secondary" id="sm-export">导出 Excel</button>
        <div class="field field--file-import">
          <span class="field-label">导入</span>
          <input type="file" id="sm-c-file" class="input-file" accept=".xlsx,.xls" />
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
        <button type="button" class="btn btn--secondary" id="sm-export-panel">导出 Excel</button>
        <div class="field field--file-import">
          <span class="field-label">导入</span>
          <input type="file" id="sm-p-file" class="input-file" accept=".xlsx,.xls" />
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
  const smDoExport = (ev) => {
    ev.preventDefault();
    void downloadBlobFromApiUrl(
      `${API_BASE}/store-master/export`,
      "智能排线_仓店距离与门店坐标.xlsx",
    );
  };
  document.getElementById("sm-export")?.addEventListener("click", smDoExport);
  document.getElementById("sm-export-panel")?.addEventListener("click", smDoExport);
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
    const r = await apiFetch(url, {
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
    const r = await apiFetch(url, {
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
    const r = await apiFetch(`${API_BASE}/store-master/import?data_source=页面导入`, { method: "POST", body: fd });
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
      const r = await apiFetch(`${API_BASE}/store-coordinates/${id}`);
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
      const r2 = await apiFetch(`${API_BASE}/store-coordinates/${id}`, { method: "DELETE" });
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
      const r = await apiFetch(`${API_BASE}/store-pair-distances/${id}`);
      const it = await r.json();
      if (!r.ok) return;
      document.getElementById("sm-pff").value = it.store_from;
      document.getElementById("sm-pft").value = it.store_to;
      document.getElementById("sm-pfd").value = it.distance_km;
      document.getElementById("sm-pair-form").hidden = false;
    }
    if (t.getAttribute("data-sm") === "dp" && id) {
      if (!window.confirm("确定删除该仓店距离？")) return;
      const r2 = await apiFetch(`${API_BASE}/store-pair-distances/${id}`, { method: "DELETE" });
      if (r2.ok) smLoadPair();
    }
  });
  if (SM.tab === "coord") smLoadCoord();
  else smLoadPair();
}

initBrandIdentityModal();
applyBrandingToShell();
bindAuthLogout();
window.addEventListener("hashchange", route);
route();

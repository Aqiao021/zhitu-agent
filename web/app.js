"use strict";
/* 职途助手前端：无构建、无依赖。路由 #/ #/app/<tab> #/about */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const STATIC_MODE = document.documentElement.dataset.mode === 'static';
let browserClient = null;
document.documentElement.classList.add("js");

/* ------------------------------------------------------------------ icons (24px stroke, round) */
const P = {
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  minus: '<path d="M6 12h12"/>',
  shield: '<path d="M12 3l7 3v5c0 4.4-3 8.3-7 10-4-1.7-7-5.6-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21"/>',
  file: '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  chat: '<path d="M20 15a2 2 0 01-2 2H8l-4 4V5a2 2 0 012-2h12a2 2 0 012 2z"/><path d="M8 9h8M8 12.5h5"/>',
  quote: '<path d="M7 7h4v4c0 3-1.5 5-4 6M15 7h4v4c0 3-1.5 5-4 6"/>',
  gauge: '<path d="M4 16a8 8 0 1116 0"/><path d="M12 16l4-5"/><circle cx="12" cy="16" r="1.4"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 018 0v3"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 016.5 3H20v15H6.5A2.5 2.5 0 004 20.5z"/><path d="M4 20.5A2.5 2.5 0 016.5 23H20v-5"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3"/>',
  send: '<path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" fill="currentColor"/>',
  printer: '<path d="M6 9V3h12v6M6 17H4.5A1.5 1.5 0 013 15.5V10.5A1.5 1.5 0 014.5 9h15a1.5 1.5 0 011.5 1.5v5a1.5 1.5 0 01-1.5 1.5H18"/><rect x="6" y="14" width="12" height="7" rx="1"/>',
  refresh: '<path d="M20 11a8 8 0 00-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0014.5 4.5L20 16M20 20v-4h-4"/>',
  bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 00-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0012 3z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>',
  bot: '<rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3v4M9 12h.01M15 12h.01M9 16h6"/>',
  alert: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17.5h.01"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M8.5 7V5.5A1.5 1.5 0 0110 4h4a1.5 1.5 0 011.5 1.5V7M3 12.5h18"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  award: '<circle cx="12" cy="9" r="5.5"/><path d="M8.5 13.5L7 21l5-2.5 5 2.5-1.5-7.5"/>',
  chevL: '<path d="M15 6l-6 6 6 6"/>',
  chevR: '<path d="M9 6l6 6-6 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5h.01"/>',
  plus: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
};
function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ""}</svg>`;
}
function hydrateIcons(root = document) { $$("[data-icon]", root).forEach((el) => { if (!el.firstChild) el.innerHTML = icon(el.dataset.icon); }); }
const I = (n) => `<span data-icon="${n}">${icon(n)}</span>`;

/* ------------------------------------------------------------------ utils */
const store = {
  get(k, d) { try { const v = localStorage.getItem("zt_" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("zt_" + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
};
/* visitor's own model key: sessionStorage by default, localStorage only if they tick "remember" */
const KEY = {
  get() { for (const st of ["sessionStorage", "localStorage"]) { try { const v = window[st].getItem("zt_key"); if (v) return JSON.parse(v); } catch (e) { /* unavailable */ } } return null; },
  set(v, remember) { this.clear(); try { window[remember ? "localStorage" : "sessionStorage"].setItem("zt_key", JSON.stringify(v)); } catch (e) { toast("浏览器不允许保存，Key 只在本次页面有效", true); KEY.mem = v; } },
  clear() { KEY.mem = null; for (const st of ["sessionStorage", "localStorage"]) { try { window[st].removeItem("zt_key"); } catch (e) { /* unavailable */ } } },
  mem: null,
};
const userKey = () => STATIC_MODE ? KEY.mem : KEY.get() || KEY.mem;
let H = { providers: [], allow_user_key: false, server_key: false };
function session() { let s = store.get("session"); if (!s) { s = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set("session", s); } return s; }
function toast(msg, err = false) {
  const t = $("#toast"); t.textContent = msg; t.classList.toggle("err", err); t.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 4200);
}
async function api(path, body, llm) {
  if (STATIC_MODE) {
    await browserReady;
    if (!browserClient) throw new Error('页面资料加载失败，请刷新重试');
    if (path !== '/api/feedback' && browserClient.status === 'disconnected') {
      keySheet(); throw new Error('请先连接模型，填写你自己的 API Key');
    }
    return browserClient.request(path, body);
  }
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 170000);
  const k = llm || userKey();
  try {
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, session: session(), ...(k ? { llm: k } : {}) }), signal: ctrl.signal });
    const data = await r.json().catch(() => ({ error: "服务器返回格式不正确" }));
    if (!r.ok) throw new Error(data.error || `请求失败（${r.status}）`);
    return data;
  } catch (e) { throw new Error(e.name === "AbortError" ? "等待时间过长，请稍后重试" : (e.message === "Failed to fetch" ? "连接不上服务器，请确认服务已启动" : e.message)); }
  finally { clearTimeout(timer); }
}
async function busy(btn, label, fn) {
  const old = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spin"></span>${label}`;
  try { return await fn(); } catch (e) { toast(e.message, true); } finally { btn.disabled = false; btn.innerHTML = old; }
}
function skeleton(msg) {
  return `<div class="skeleton"><div class="sk-msg"><span class="spin"></span>${esc(msg)}</div><div class="sk" style="width:70%"></div><div class="sk"></div><div class="sk" style="width:85%"></div><div class="sk" style="width:60%"></div></div>`;
}

/* ------------------------------------------------------------------ state */
const S = { diagnosis: store.get("diagnosis", null), plan: store.get("plan", null), done: store.get("done", {}), history: [], current: null, filter: "全部",
  job: store.get("job", null), mode: store.get("mode", "job"), major: "", selDay: null, majors: [] };
async function getJSON(path) {
  if (STATIC_MODE) {
    await browserReady;
    if (!browserClient) throw new Error('页面资料加载失败，请刷新重试');
    return browserClient.get(path);
  }
  const r = await fetch(path); const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `请求失败（${r.status}）`); return d;
}

/* ------------------------------------------------------------------ router */
const TABS = ["jobs", "diagnose", "plan", "interview", "ask"];
function route() {
  const h = location.hash.replace(/^#/, "") || "/";
  const [path, query] = h.split("?");
  const parts = path.split("/").filter(Boolean);
  const view = parts[0] === "app" ? "app" : parts[0] === "about" ? "about" : "home";
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + view));
  $$(".nav-links a").forEach((a) => a.classList.toggle("active", a.dataset.route === view));
  document.body.classList.toggle("in-app", view === "app");
  if (view === "app") {
    const tab = TABS.includes(parts[1]) ? parts[1] : "jobs";
    $$(".pane").forEach((p) => p.classList.toggle("active", p.id === "pane-" + tab));
    $$(".side-item").forEach((a) => a.classList.toggle("active", a.dataset.tab === tab));
    if (query && query.includes("sample=1") && !$("#resume").value) loadSample();
    document.title = { jobs: "找岗位", diagnose: "差距诊断", plan: "30 天计划", interview: "模拟面试", ask: "就业问答" }[tab] + " · 职途助手";
  } else {
    document.title = "职途助手 · 求职差距诊断";
  }
  window.scrollTo({ top: 0 });
}
window.addEventListener("hashchange", route);
window.addEventListener("scroll", () => $("#nav").classList.toggle("scrolled", window.scrollY > 8), { passive: true });

/* reveal on scroll — content stays visible if the observer never fires */
function setupReveal() {
  if (!("IntersectionObserver" in window)) return;
  const els = $$(".reveal").filter((el) => el.getBoundingClientRect().top > window.innerHeight);
  els.forEach((el) => el.classList.add("pending"));
  const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.remove("pending"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -10% 0px" });
  els.forEach((el) => io.observe(el));
}

/* ------------------------------------------------------------------ health */
function updateMode() {
  if (STATIC_MODE) return updateBrowserMode();
  const m = $("#mode"), k = userKey();
  const pname = k && (H.providers.find((p) => p.id === k.provider) || {}).name;
  $(".mode-text", m).textContent = k ? `我的 Key · ${pname || "已设置"}` : H.server_key ? `模型：${H.model}` : "演示模式";
  m.title = k ? `使用你自己的 Key（模型：${k.model}），点击修改` : H.server_key ? "模型：" + H.model + (H.allow_user_key ? "，点击可改用自己的 Key" : "") : "未配置模型，点击填写自己的 API Key";
  m.classList.toggle("demo", !k && !H.server_key); m.classList.toggle("user", !!k);
  $("#keyHint").classList.toggle("hidden", !!k || H.server_key || !H.allow_user_key);
}
const browserReady = STATIC_MODE ? loadBrowserEdition() : Promise.resolve();
if (!STATIC_MODE) fetch("/api/health").then((r) => r.json()).then((h) => {
  H = h; updateMode();
  $("#docCount").textContent = h.documents.length;
  $("#docList").innerHTML = h.documents.map((d) => `<li>${esc(d.title)}（${esc(d.source)}${d.date ? "，" + esc(d.date) : ""}）${d.url ? ` <a href="${esc(d.url)}" target="_blank" rel="noopener">原文</a>` : ""}</li>`).join("");
}).catch(() => { const m = $("#mode"); $(".mode-text", m).textContent = "服务未连接"; m.classList.add("off"); });

/* ------------------------------------------------------------------ feedback */
function feedback(kind) {
  const id = "fb" + Math.random().toString(36).slice(2, 8);
  queueMicrotask(() => {
    const box = document.getElementById(id); if (!box) return;
    let rating = 0, useful = null;
    $$(".stars button", box).forEach((b, i) => b.addEventListener("click", () => { rating = i + 1; $$(".stars button", box).forEach((x, j) => x.classList.toggle("on", j < rating)); }));
    $$(".seg button", box).forEach((b) => b.addEventListener("click", () => { useful = b.dataset.v === "1"; $$(".seg button", box).forEach((x) => x.classList.toggle("on", x === b)); }));
    $(".fb-send", box).addEventListener("click", async (e) => {
      if (!rating) return toast("先点星星打个分吧");
      await busy(e.currentTarget, "提交中", async () => {
        await api("/api/feedback", { kind, rating, useful, comment: $("input", box).value });
        box.innerHTML = `<span class="fb-done">${I("check")}谢谢反馈，它会帮助职途助手变得更准确</span>`;
      });
    });
  });
  return `<div class="fb" id="${id}"><span class="fb-label">这个结果准吗？</span>
    <span class="stars">${[1, 2, 3, 4, 5].map((n) => `<button type="button" aria-label="${n} 星">${icon("star")}</button>`).join("")}</span>
    <span class="seg"><button type="button" data-v="1">有用</button><button type="button" data-v="0">没用</button></span>
    <input placeholder="哪里不准或可以改进（可选）" maxlength="200" aria-label="反馈内容">
    <button type="button" class="btn btn-ghost btn-sm fb-send">提交</button></div>`;
}

/* ------------------------------------------------------------------ sheet (job detail / forms) */
function openSheet(html) {
  $("#sheetBody").innerHTML = html; hydrateIcons($("#sheetBody"));
  $("#sheet").classList.remove("hidden"); document.body.classList.add("no-scroll");
  requestAnimationFrame(() => $("#sheet").classList.add("open"));
  const f = $("#sheetBody").querySelector("button, input, textarea, a"); if (f) f.focus({ preventScroll: true });
}
function closeSheet() {
  const keyField = $('#kKey'); if (keyField) keyField.value = '';
  $("#sheet").classList.remove("open"); document.body.classList.remove("no-scroll");
  setTimeout(() => $("#sheet").classList.add("hidden"), 200);
}
$("#sheet").addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeSheet(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#sheet").classList.contains("hidden")) closeSheet(); });

/* ------------------------------------------------------------------ own API key */
function keySheet() {
  if (STATIC_MODE) return browserKeySheet();
  if (!H.allow_user_key) {
    return openSheet(`<p class="eyebrow">模型设置</p><h3 class="sheet-title">当前模型</h3><p>${H.server_key ? `本站已接入模型：${esc(H.model)}，直接使用即可。` : "本站目前是演示模式，管理员没有开放填写自己的 API Key。"}</p>`);
  }
  const k = userKey() || {};
  const cur = H.providers.find((p) => p.id === k.provider) || H.providers[0];
  openSheet(`
    <p class="eyebrow">模型设置</p>
    <h3 class="sheet-title">使用自己的 API Key</h3>
    <p class="muted small">${H.server_key ? `本站已接入模型（${esc(H.model)}），不填也能用；填写后会改用你自己的账户。` : "本站没有内置模型，填写你自己的大模型 API Key 后即可获得真实的 AI 分析。"}</p>
    <label class="lbl" for="kProv">模型服务商</label>
    <select class="input" id="kProv">${H.providers.map((p) => `<option value="${esc(p.id)}" ${p.id === cur.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
    <label class="lbl" for="kModel">模型名</label>
    <input class="input" id="kModel" maxlength="80" autocomplete="off" spellcheck="false" value="${esc(k.model || cur.model)}" placeholder="以服务商文档为准">
    <p class="muted small" id="kModelHint"></p>
    <label class="lbl" for="kKey">API Key</label>
    <input class="input" id="kKey" type="password" maxlength="200" autocomplete="off" spellcheck="false" value="${esc(k.api_key || "")}" placeholder="sk-…">
    <label class="check"><input type="checkbox" id="kRemember" ${KEY.get() && (() => { try { return !!localStorage.getItem("zt_key"); } catch (e) { return false; } })() ? "checked" : ""}>在这台设备上记住（公共电脑请不要勾选）</label>
    <div class="notice">${I("lock")}<span>Key 默认只保存在当前标签页，关闭后清除。每次使用时随请求发到职途助手服务器，只用来调用你选的服务商，服务器不保存、不记录。费用由你的账户承担，建议在服务商后台设置额度上限。</span></div>
    <div class="notice">${I("bulb")}<span>还没有 Key？到所选服务商的开放平台注册，在“API Key”页面创建一个；新用户通常有免费额度，具体以服务商说明为准。</span></div>
    <div class="sheet-actions key-actions">
      <button class="btn btn-ghost" type="button" id="kTest">测试连接</button>
      <button class="btn btn-primary" type="button" id="kSave">保存并使用</button>
      ${userKey() ? `<button class="btn btn-ghost" type="button" id="kClear">清除 Key</button>` : ""}
    </div>`);
  const hint = () => { const p = H.providers.find((x) => x.id === $("#kProv").value); $("#kModelHint").textContent = p.model ? `默认 ${p.model}，可改为服务商文档里的其他模型名` : "请填写服务商控制台或文档里的模型名（例如火山方舟填模型 ID）"; };
  hint();
  $("#kProv").addEventListener("change", () => { const p = H.providers.find((x) => x.id === $("#kProv").value); $("#kModel").value = p.model; hint(); });
  const read = () => {
    const v = { provider: $("#kProv").value, model: $("#kModel").value.trim(), api_key: $("#kKey").value.trim() };
    if (v.api_key.length < 8) { toast("请粘贴完整的 API Key", true); return null; }
    if (!v.model) { toast("请填写模型名", true); return null; }
    return v;
  };
  $("#kTest").addEventListener("click", (e) => { const v = read(); if (!v) return; busy(e.currentTarget, "测试中", async () => { const r = await api("/api/key/test", {}, v); toast(`连接成功：${r.model}`); }); });
  $("#kSave").addEventListener("click", () => { const v = read(); if (!v) return; KEY.set(v, $("#kRemember").checked); updateMode(); closeSheet(); toast("已保存，接下来的诊断和计划会使用你的 Key"); });
  const c = $("#kClear"); if (c) c.addEventListener("click", () => { KEY.clear(); updateMode(); closeSheet(); toast("已清除你的 Key"); });
}

/* ------------------------------------------------------------------ job library */
const KIND = { "画像": ["岗位画像", "tag-profile"], "导入": ["真实招聘", "tag-real"] };
const kindTag = (k) => { const [t, c] = KIND[k] || KIND["画像"]; return `<span class="tag ${c}">${t}</span>`; };
function renderMajors() {
  $("#majorChips").innerHTML = [{ name: "", label: "全部专业" }, ...S.majors.map((m) => ({ name: m.name, label: m.name, count: m.count }))]
    .map((m) => `<button type="button" class="major ${S.major === m.name ? "on" : ""}" data-major="${esc(m.name)}">${esc(m.label)}${m.count != null ? `<small>${m.count}</small>` : ""}</button>`).join("");
  $$("#majorChips .major").forEach((b) => b.addEventListener("click", () => { S.major = b.dataset.major; renderMajors(); searchJobs(); }));
}
async function loadMajors() {
  try {
    const d = await getJSON("/api/majors");
    S.majors = d.majors; renderMajors();
    $("#homeMajors").innerHTML = `<table class="spec majors"><thead><tr><th>专业名称</th><th>专业代码</th><th class="hide-sm">专业大类 / 专业类</th><th>岗位数</th><th></th></tr></thead><tbody>${d.majors.map((m) =>
      `<tr><td><b>${esc(m.name)}</b></td><td class="num">${esc(m.code)}</td><td class="hide-sm muted">${esc(m.category)}</td><td class="num">${m.count}</td><td class="right"><a class="linkish" href="#/app/jobs" data-major-go="${esc(m.name)}">查看岗位</a></td></tr>`).join("")}</tbody></table>`;
    $$("[data-major-go]").forEach((a) => a.addEventListener("click", () => { S.major = a.dataset.majorGo; renderMajors(); searchJobs(); }));
    $("#majorCount").textContent = d.majors.length; $("#jobCount").textContent = d.total_jobs;
    $("#jobNotice").innerHTML = `${I("alert")}<span>${esc(d.notice)}（更新于 ${esc(d.updated)}）</span>`;
    searchJobs();
  } catch (e) { $("#jobResults").innerHTML = `<p class="muted">岗位库加载失败：${esc(e.message)}</p>`; }
}
let searchSeq = 0;
async function searchJobs() {
  const q = $("#jobQ").value.trim(), seq = ++searchSeq;
  try {
    const d = await getJSON(`/api/jobs?q=${encodeURIComponent(q)}&major=${encodeURIComponent(S.major)}`);
    if (seq !== searchSeq) return;
    const major = S.majors.find((m) => m.name === S.major);
    $("#jobMeta").innerHTML = `${S.major ? `<b>${esc(S.major)}</b>${major?.code ? `（专业代码 ${esc(major.code)}）` : ""} · ` : ""}${q ? `“${esc(q)}” · ` : ""}找到 <b>${d.results.length}</b> 个岗位`;
    $("#jobResults").innerHTML = d.results.map((j) => `
      <button type="button" class="job-card ${S.job?.id === j.id ? "picked" : ""}" data-id="${esc(j.id)}">
        <span class="jc-top"><b>${esc(j.title)}</b>${kindTag(j.kind)}</span>
        <span class="jc-sum">${esc(j.summary)}</span>
        <span class="jc-majors">${j.majors.map((m) => `<i>${esc(m)}</i>`).join("")}</span>
        <span class="jc-tools">${j.tools.map((t) => `<em>${esc(t)}</em>`).join("")}</span>
        <span class="jc-foot"><span>必需 ${j.must} 条 · 共 ${j.total} 条要求</span><span class="jc-go">查看要求${I("arrow")}</span></span>
      </button>`).join("") || `<div class="need">${I("search")}<p>没有找到相关岗位，换个关键词试试，或者切换到“粘贴招聘”直接诊断。</p></div>`;
    $$("#jobResults .job-card").forEach((b) => b.addEventListener("click", () => openJob(b.dataset.id)));
  } catch (e) { if (seq === searchSeq) toast(e.message, true); }
}
$("#jobForm").addEventListener("submit", (e) => { e.preventDefault(); searchJobs(); });
$("#jobQ").addEventListener("input", () => { clearTimeout(searchJobs.t); searchJobs.t = setTimeout(searchJobs, 300); });

function reqList(reqs) {
  return reqs.map((r) => `<li><span class="lvl ${r.level === "必需" ? "lvl-must" : "lvl-plus"}">${esc(r.level)}</span><span>${esc(r.item)}<small>${esc(r.category)}</small></span></li>`).join("");
}
async function openJob(id) {
  let j;
  try { j = await getJSON("/api/jobs/" + encodeURIComponent(id)); } catch (e) { return toast(e.message, true); }
  const must = j.requirements.filter((r) => r.level === "必需"), plus = j.requirements.filter((r) => r.level !== "必需");
  openSheet(`
    <p class="eyebrow">${j.kind === "导入" ? "同学提交的真实招聘" : "岗位画像"}</p>
    <h3 class="sheet-title">${esc(j.title)} ${kindTag(j.kind)}</h3>
    ${j.aliases.length ? `<p class="muted small">也叫：${j.aliases.map(esc).join("、")}</p>` : ""}
    <p>${esc(j.summary)}</p>
    <div class="jc-majors">${j.majors.map((m) => `<i>${esc(m)}</i>`).join("")}${j.city ? `<i>${esc(j.city)}</i>` : ""}${j.education ? `<i>${esc(j.education)}</i>` : ""}</div>
    ${j.duties.length ? `<h4>${I("briefcase")}主要工作</h4><ul class="plain">${j.duties.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    <h4>${I("check")}必需要求 ${must.length} 条</h4><ul class="reqs">${reqList(must)}</ul>
    ${plus.length ? `<h4>${I("plus")}加分要求 ${plus.length} 条</h4><ul class="reqs">${reqList(plus)}</ul>` : ""}
    ${j.tools.length ? `<h4>${I("layers")}要会的软件 / 工具</h4><div class="jc-tools">${j.tools.map((t) => `<em>${esc(t)}</em>`).join("")}</div>` : ""}
    ${j.certificates.length ? `<h4>${I("award")}可考的证书（加分项）</h4><ul class="plain">${j.certificates.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    <h4>${I("link")}来源</h4><ul class="plain src">${j.sources.map((x) => `<li>${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>` : esc(x.title)}${x.date ? ` · ${esc(x.date)}` : ""}</li>`).join("")}</ul>
    <p class="notice">${I("alert")}<span>${j.kind === "导入" ? "这是同学提交、经整理的真实招聘信息，已隐去公司和联系方式；投递前请到招聘平台核实。" : "岗位画像根据公开资料归纳，不代表某家公司的真实招聘；部分来源要求本科，只用于归纳技能要求。"}</span></p>
    <div class="sheet-actions"><button class="btn btn-primary" type="button" id="btnPickJob">用这个岗位诊断我的简历 ${I("arrow")}</button></div>`);
  $("#btnPickJob").addEventListener("click", () => { pickJob(j); closeSheet(); location.hash = "#/app/diagnose"; });
}
function pickJob(j) {
  S.job = { id: j.id, title: j.title, kind: j.kind, majors: j.majors, must: j.requirements.filter((r) => r.level === "必需").length, total: j.requirements.length, tools: j.tools.slice(0, 6) };
  S.mode = "job"; store.set("job", S.job); store.set("mode", "job");
  renderTarget(); syncSteps(); toast(`已选择目标岗位：${j.title}`);
}

function contribute(prefill = "") {
  if (STATIC_MODE) return toast('公共岗位库由维护者更新；你可以在「粘贴招聘」中诊断自己的招聘信息。');
  openSheet(`
    <p class="eyebrow">一起把岗位库变真实</p>
    <h3 class="sheet-title">贡献一条真实招聘</h3>
    <p class="muted small">把在招聘平台、学校就业网或招聘会上看到的岗位信息贴进来。提交时会自动隐藏手机号、邮箱等信息；管理员整理审核后会以“真实招聘”标签入库，供其他同学诊断使用。</p>
    <div class="field"><textarea id="cText" placeholder="岗位名称、岗位职责、任职要求……（请删掉联系人、电话等信息）" style="min-height:220px">${esc(prefill)}</textarea></div>
    <label class="lbl" for="cUrl">原链接（可选）</label><input class="input" id="cUrl" placeholder="https://" maxlength="300">
    <label class="lbl" for="cNote">备注（可选）</label><input class="input" id="cNote" placeholder="例如：2026 秋招 · 厦门 · 大专可投" maxlength="100">
    <div class="sheet-actions"><button class="btn btn-primary" type="button" id="btnSubmitJob">提交审核 ${I("send")}</button></div>`);
  $("#btnSubmitJob").addEventListener("click", (e) => {
    const text = $("#cText").value.trim(); if (text.length < 40) return toast("招聘信息至少 40 字", true);
    busy(e.currentTarget, "提交中", async () => {
      await api("/api/jobs/submit", { text, url: $("#cUrl").value.trim(), note: $("#cNote").value.trim() });
      closeSheet(); toast("提交成功，谢谢你！审核后会出现在岗位库里");
    });
  });
}
$("#btnContribute").addEventListener("click", () => contribute());

/* diagnose target: job library or pasted posting */
function renderTarget() {
  $$("#targetSeg button").forEach((b) => b.classList.toggle("on", b.dataset.m === S.mode));
  $("#targetJob").classList.toggle("hidden", S.mode !== "job"); $("#targetPaste").classList.toggle("hidden", S.mode !== "paste");
  const j = S.job;
  $("#targetJob").innerHTML = j ? `
    <div class="picked-job"><div class="pj-top"><b>${esc(j.title)}</b>${kindTag(j.kind)}</div>
      <div class="jc-majors">${(j.majors || []).map((m) => `<i>${esc(m)}</i>`).join("")}</div>
      <p class="muted small">必需 ${j.must} 条 · 共 ${j.total} 条要求，将逐条对照你的简历</p>
      <div class="jc-tools">${(j.tools || []).map((t) => `<em>${esc(t)}</em>`).join("")}</div>
      <div class="pj-actions"><button type="button" class="btn btn-ghost btn-sm" id="btnViewJob">${I("file")}查看要求</button><a class="btn btn-ghost btn-sm" href="#/app/jobs">${I("refresh")}更换岗位</a></div></div>`
    : `<div class="need small-need">${I("briefcase")}<p>还没有选择目标岗位</p><a class="btn btn-primary btn-sm" href="#/app/jobs">去岗位库选择</a><button type="button" class="linkish" data-m2="paste">或者粘贴一条招聘信息</button></div>`;
  const v = $("#btnViewJob"); if (v) v.addEventListener("click", () => openJob(j.id));
  const p = $("#targetJob [data-m2]"); if (p) p.addEventListener("click", () => setMode("paste"));
}
function setMode(m) { S.mode = m; store.set("mode", m); renderTarget(); }
$$("#targetSeg button").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.m)));

/* ------------------------------------------------------------------ diagnose */
const SAMPLE_RESUME = `【示例简历 · 人物为虚构】
姓名：小林    电话：13800001234
学校：漳州职业技术学院 人工智能技术应用专业 2026级
技能：会使用 Python 写简单脚本；了解 Git 基本操作；能用大模型 API 做对话程序
项目经历：
1. 校园问答小程序（课程作业）：用 Python 调用大模型 API，实现按课程资料回答同学提问，负责接口调用和提示词编写。
2. 班级活动报名表：用 Excel 和简单网页收集报名信息，组织 30 名同学试用并根据反馈修改。
其他：担任班级学习委员，负责收集作业和组织学习小组。`;
const SAMPLE_JD = `【示例岗位】AI 应用开发实习生
岗位职责：
1. 参与基于大模型的智能客服/知识库应用开发；
2. 编写提示词并评估回答效果；
3. 配合测试，修复问题，编写接口文档。
任职要求：
1. 熟悉 Python，了解 Linux 常用命令；
2. 了解大模型 API 调用、RAG 检索增强生成或 Agent 开发；
3. 熟悉 Git，有项目经验者优先；
4. 具备良好的沟通能力和团队协作意识；
5. 大专及以上学历，计算机相关专业。`;
async function loadSample() {
  $("#resume").value = SAMPLE_RESUME; $("#jd").value = SAMPLE_JD; count();
  if (S.mode === "job" && !S.job) { try { pickJob(await getJSON("/api/jobs/ai_app_dev_assistant")); } catch (e) { setMode("paste"); } }
  toast("已载入示例简历（虚构人物）");
}
function count() { $("#cResume").textContent = $("#resume").value.trim().length + " 字"; $("#cJd").textContent = $("#jd").value.trim().length + " 字"; }
$("#resume").addEventListener("input", count); $("#jd").addEventListener("input", count);
$("#btnSample").addEventListener("click", loadSample);
$("#resumeFile").addEventListener("change", (e) => {
  const f = e.target.files[0]; if (!f) return;
  if (f.size > 200000) return toast("文件太大，请直接粘贴文字", true);
  const r = new FileReader(); r.onload = () => { $("#resume").value = r.result; count(); }; r.readAsText(f, "utf-8");
});

$("#btnDiagnose").addEventListener("click", (e) => {
  const resume = $("#resume").value.trim(), jd = $("#jd").value.trim();
  if (resume.length < 30) return toast("简历内容至少 30 字", true);
  if (S.mode === "job" && !S.job) return toast("请先从岗位库选择目标岗位，或切换到“粘贴招聘”", true);
  if (S.mode === "paste" && jd.length < 20) return toast("招聘信息至少 20 字", true);
  const body = S.mode === "job" ? { resume, job_id: S.job.id } : { resume, jd };
  $("#diagResult").innerHTML = skeleton("正在逐条对照岗位要求，通常需要 10～40 秒…");
  $("#diagResult").scrollIntoView({ behavior: "smooth", block: "start" });
  busy(e.currentTarget, "诊断中", async () => {
    const d = await api("/api/diagnose", body);
    S.diagnosis = d; S.plan = null; S.done = {}; S.filter = "全部"; S.selDay = null;
    store.set("diagnosis", d); store.set("plan", null); store.set("done", {});
    renderDiagnosis(); syncSteps();
  }).then(() => { if ($("#diagResult .skeleton")) { if (S.diagnosis) renderDiagnosis(); else $("#diagResult").innerHTML = ""; } });
});

const ST = { "具备": ["have", "st-have", "check"], "部分具备": ["part", "st-part", "minus"], "缺少": ["miss", "st-miss", "x"] };
function renderDiagnosis() {
  const d = S.diagnosis; if (!d) return;
  const s = d.match_score, color = s >= 75 ? "var(--have)" : s >= 50 ? "#E19A2C" : "var(--miss)";
  const n = d.requirements.length, c = d.counts;
  const hidden = Object.entries(d.privacy || {}).map(([k, v]) => `${k} ${v} 处`).join("、");
  const list = d.requirements.filter((r) => S.filter === "全部" || r.status === S.filter);
  const so = d.source || {};
  const src = so.type === "job" ? `<p class="src-line">${I("briefcase")}岗位要求来自岗位库（${so.kind === "导入" ? "同学提交的真实招聘" : "岗位画像"}）${(so.sources || []).slice(0, 2).map((x) => x.url ? ` · <a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title.slice(0, 22))}…</a>` : "").join("")} · <button type="button" class="linkish" id="btnSrcJob">查看全部要求</button></p>`
    : so.type === "paste" ? `<p class="src-line">${I("file")}岗位要求从你粘贴的招聘信息中拆解 · <button type="button" class="linkish server-only" id="btnShare">把这条招聘贡献到岗位库</button></p>` : "";
  const lv = (r) => r.level ? `<span class="lvl ${r.level === "必需" ? "lvl-must" : "lvl-plus"}">${esc(r.level)}</span>` : "—";
  $("#diagResult").innerHTML = `
  <div class="card report">
    <div class="report-top">
      <div class="report-main">
        <p class="eyebrow">诊断报告${d.demo ? " · 演示模式" : ""}</p>
        <h2 class="report-title">${esc(d.job_title)}</h2>
        <p class="muted">${esc(d.summary)}</p>
        ${src}
      </div>
      <div class="report-actions"><button class="btn btn-default btn-sm" type="button" data-action="print">${I("printer")}打印报告</button></div>
    </div>
    <div class="stat-row">
      <div class="stat stat-score"><div class="gauge"><svg viewBox="0 0 136 136"><circle class="trk" cx="68" cy="68" r="58"/><circle class="val" cx="68" cy="68" r="58" stroke="${color}" style="stroke-dasharray:364.4;stroke-dashoffset:364.4"/></svg></div><div><span>匹配度</span><b class="num">${s}<small>/100</small></b></div></div>
      <div class="stat"><span>具备</span><b class="num c-have">${c["具备"]}</b></div>
      <div class="stat"><span>部分具备</span><b class="num c-part">${c["部分具备"]}</b></div>
      <div class="stat"><span>缺少</span><b class="num c-miss">${c["缺少"]}</b></div>
      <div class="stat"><span>必需项缺口</span><b class="num ${d.must_gaps ? "c-miss" : ""}">${d.must_gaps || 0}</b></div>
    </div>
    <div class="stack" aria-hidden="true"><i style="width:${c["具备"] / n * 100}%;background:var(--have)"></i><i style="width:${c["部分具备"] / n * 100}%;background:var(--part)"></i><i style="width:${c["缺少"] / n * 100}%;background:var(--miss)"></i></div>
    <p class="method">${I("info")}匹配度按具备 1 分、部分具备 0.5 分、缺少 0 分计算，必需项权重 2、加分项权重 1，由程序计算${hidden ? `；已自动隐藏 ${esc(hidden)}` : ""}${d.unverified_evidence ? `；${d.unverified_evidence} 条模型依据在简历中找不到原文，已降级` : ""}</p>
  </div>
  <div class="report-grid">
    <div class="card table-card">
      <div class="card-head"><h3>逐条对照 <small>${n} 条</small></h3>
        <div class="filters">${["全部", "缺少", "部分具备", "具备"].map((f) => `<button type="button" class="filter ${S.filter === f ? "on" : ""}" data-f="${f}">${f} ${f === "全部" ? n : c[f]}</button>`).join("")}</div></div>
      <div class="rtable" role="table" aria-label="岗位要求逐条对照">
        <div class="rt-row rt-head" role="row"><span role="columnheader">状态</span><span role="columnheader">岗位要求</span><span role="columnheader">类别</span><span role="columnheader">重要度</span><span role="columnheader">依据与建议</span></div>
        ${list.map((r) => { const [cls, pill] = ST[r.status]; return `
        <div class="rt-row ${cls}" role="row">
          <span role="cell"><span class="st ${pill}">${esc(r.status)}</span></span>
          <span role="cell" class="rt-item">${esc(r.item)}</span>
          <span role="cell" class="rt-cat">${esc(r.category)}</span>
          <span role="cell">${lv(r)}</span>
          <span role="cell" class="rt-ev">
            ${r.evidence ? `<span class="quote-box"><small>${I("check")}简历原文 · 已核验</small>${esc(r.evidence)}</span>` : ""}
            ${r.note ? `<span class="note">${I("alert")}${esc(r.note)}</span>` : ""}
            ${r.advice ? `<span class="advice">${I("bulb")}<span>${esc(r.advice)}</span></span>` : ""}
          </span>
        </div>`; }).join("") || `<p class="muted pad">这一类没有条目</p>`}
      </div>
    </div>
    <div>
      ${d.strengths.length ? `<div class="card side-card"><h3>${I("check")}你的优势</h3><ul>${d.strengths.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
      ${d.honesty_notes.length ? `<div class="card side-card"><h3>${I("alert")}需要如实修改</h3><ul>${d.honesty_notes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
      <div class="card side-card"><h3>${I("book")}国家职业标准对应</h3><div class="muted" style="font-size:14px">${esc(d.standard_note || "本岗位没有匹配到具体的标准条目。")}</div>
        ${d.references.length ? `<div class="refs">${d.references.map((r, i) => `[${i + 1}] 《${esc(r.title)}》${esc(r.section)}${r.url ? ` · <a href="${esc(r.url)}" target="_blank" rel="noopener">来源</a>` : ""}`).join("<br>")}</div>` : ""}</div>
    </div>
  </div>
  <div class="next">
    <a href="#/app/plan">${I("calendar")}<span><b>生成 30 天补差计划</b><small>每天做什么、要学会哪些软件</small></span></a>
    <a href="#/app/interview">${I("mic")}<span><b>针对短板模拟面试</b><small>5 道题 · 五维评分</small></span></a>
  </div>
  <div class="card" style="margin-top:24px">${feedback("diagnose")}<p class="meta">用时 ${(d.elapsed_ms / 1000).toFixed(1)} 秒</p></div>`;
  $$(".filter", $("#diagResult")).forEach((b) => b.addEventListener("click", () => { S.filter = b.dataset.f; renderDiagnosis(); }));
  const sj = $("#btnSrcJob"); if (sj) sj.addEventListener("click", () => openJob(so.id));
  const sh = $("#btnShare"); if (sh) sh.addEventListener("click", () => contribute($("#jd").value.trim()));
  requestAnimationFrame(() => requestAnimationFrame(() => { const v = $("#diagResult .gauge .val"); if (v) v.style.strokeDashoffset = 364.4 * (1 - s / 100); }));
}

/* ------------------------------------------------------------------ 30-day plan */
$("#hours").addEventListener("input", (e) => { $("#hoursVal").textContent = e.target.value; });
$("#btnPlan").addEventListener("click", (e) => {
  $("#planResult").innerHTML = skeleton("AI 正在设计学习模块，程序随后排进 30 天日历，通常需要 20～60 秒…");
  busy(e.currentTarget, "规划中", async () => {
    const p = await api("/api/plan", { diagnosis: S.diagnosis, daily_hours: +$("#hours").value });
    S.plan = p; S.done = {}; S.selDay = null; store.set("plan", p); store.set("done", {}); renderPlan(); syncSteps();
  }).then(() => { if ($("#planResult .skeleton")) { if (S.plan) renderPlan(); else $("#planResult").innerHTML = ""; } });
});
const DTYPE = { "学习": "t-learn", "复盘": "t-review", "项目": "t-project", "面试": "t-iv" };
const fmtMin = (m) => (m >= 60 ? `${+(m / 60).toFixed(1)} 小时` : `${m} 分钟`);
function dayRange(days) {
  if (!days.length) return "未排入";
  const out = []; let a = days[0], b = days[0];
  for (const d of days.slice(1).concat([null])) { if (d === b + 1) { b = d; continue; } out.push(a === b ? `${a}` : `${a}–${b}`); a = b = d; }
  return "第 " + out.join("、") + " 天";
}
function dayDone(day) { return day.tasks.length && day.tasks.every((t) => S.done[t.id]); }
function taskRow(t) {
  return `<label class="task ${S.done[t.id] ? "done" : ""}"><input type="checkbox" data-k="${esc(t.id)}" ${S.done[t.id] ? "checked" : ""}>
    <span><span class="t">${esc(t.title)}</span><span class="c">完成标准：${esc(t.output)}</span>${t.tools?.length ? `<span class="tt">${t.tools.map((x) => `<em>${esc(x)}</em>`).join("")}</span>` : ""}</span>
    <span class="h">${t.minutes} 分</span></label>`;
}
function renderPlan() {
  const p = S.plan; if (!p || !p.days) return;
  const all = p.days.flatMap((d) => d.tasks), done = all.filter((t) => S.done[t.id]).length;
  if (!S.selDay) S.selDay = (p.days.find((d) => !dayDone(d)) || p.days[0]).day;
  const sel = p.days.find((d) => d.day === S.selDay) || p.days[0];
  const doneDays = p.days.filter(dayDone).length;
  $("#planResult").innerHTML = `
  <div class="card">
    <div class="plan-summary">
      <div><p class="eyebrow">${esc(p.job_title || S.diagnosis?.job_title || "")}${p.demo ? " · 演示模式" : ""}</p><h3 class="report-title" style="margin:0">30 天 · 每天不超过 ${fmtMin(p.daily_minutes)}</h3></div>
      <div class="progress"><div class="progress-bar"><i style="width:${all.length ? done / all.length * 100 : 0}%"></i></div><small>已完成 ${done} / ${all.length} 项任务 · ${doneDays} 天全部完成（进度只保存在这台设备上）</small></div>
      <button class="btn btn-ghost btn-sm" type="button" data-action="print">${I("printer")}打印 / 存为 PDF</button>
    </div>
  </div>
  <div class="card">
    <h3>${I("layers")}这 30 天要学会的软件和技能</h3>
    <div class="skill-grid">${p.skills.map((k) => `<div class="skill"><b>${esc(k.skill)}</b><small>${esc(dayRange(k.days))}</small>
      ${k.gap ? `<p>对应差距：${esc(k.gap)}</p>` : ""}${k.tools.length ? `<div class="jc-tools">${k.tools.map((t) => `<em>${esc(t)}</em>`).join("")}</div>` : ""}</div>`).join("")}</div>
    ${p.tools.length ? `<p class="tool-line"><b>软件 / 工具清单：</b>${p.tools.map(esc).join("、")}</p>` : ""}
    <div class="plan-extra">
      <div class="tip">${I("briefcase")}<span><b>综合项目（第 26、27、29 天）：${esc(p.project.title)}</b><br>${esc(p.project.desc)}<br><small>交付：${esc(p.project.output)}</small></span></div>
      ${p.certificates.length ? `<div class="tip">${I("award")}<span><b>可以开始准备的证书（加分项，不承诺拿证）</b><br>${p.certificates.map(esc).join("<br>")}</span></div>` : ""}
    </div>
  </div>
  <div class="card no-print">
    <div class="cal-head"><h3>${I("calendar")}30 天日历</h3><div class="cal-legend"><span class="t-learn">学习</span><span class="t-review">复盘</span><span class="t-project">项目</span><span class="t-iv">面试</span></div></div>
    <div class="cal" role="list">${p.days.map((d) => `<button type="button" role="listitem" class="day ${DTYPE[d.type] || ""} ${d.day === sel.day ? "sel" : ""} ${dayDone(d) ? "ok" : ""}" data-day="${d.day}" aria-label="第 ${d.day} 天 ${esc(d.theme)}">
      <span class="dn">${d.day}</span>${dayDone(d) ? `<span class="dk">${icon("check")}</span>` : ""}<span class="dt">${esc(d.theme)}</span><span class="dm">${d.minutes} 分</span></button>`).join("")}</div>
    <div class="day-detail">
      <div class="dd-head"><button type="button" class="icon-btn" data-step="-1" aria-label="前一天" ${sel.day === 1 ? "disabled" : ""}>${icon("chevL")}</button>
        <div><b>第 ${sel.day} 天 · ${esc(sel.type)}日</b><small>${esc(sel.theme)} · 共 ${sel.minutes} 分钟 · 第 ${sel.week} 周</small></div>
        <button type="button" class="icon-btn" data-step="1" aria-label="后一天" ${sel.day === 30 ? "disabled" : ""}>${icon("chevR")}</button></div>
      ${sel.tasks.map(taskRow).join("")}
      ${sel.day === 30 ? `<div class="pj-actions"><a class="btn btn-primary btn-sm" href="#/app/diagnose">${I("refresh")}重新诊断</a><a class="btn btn-ghost btn-sm" href="#/app/interview">${I("mic")}模拟面试</a></div>` : ""}
    </div>
  </div>
  <div class="card print-only">
    <h3>30 天每日任务</h3>
    ${p.days.map((d) => `<div class="pday"><b>第 ${d.day} 天 · ${esc(d.type)} · ${esc(d.theme)}（${d.minutes} 分钟）</b><ul>${d.tasks.map((t) => `<li>${S.done[t.id] ? "☑" : "☐"} ${esc(t.title)}（${t.minutes} 分）— 完成标准：${esc(t.output)}</li>`).join("")}</ul></div>`).join("")}
  </div>
  ${p.unscheduled?.length ? `<div class="card"><h3>${I("alert")}没排进 30 天的任务（${p.unscheduled.length} 项）</h3><p class="muted small">每天的时间有限，这些任务可以在第二个月继续，或把每天的时间调多一点重新生成。</p><ul class="plain">${p.unscheduled.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
  <div class="card">
    ${p.tips?.length ? `<h3>${I("bulb")}执行建议</h3><div class="tips">${p.tips.map((x) => `<div class="tip">${I("check")}<span>${esc(x)}</span></div>`).join("")}</div>` : ""}
    ${feedback("plan")}
  </div>`;
  $$("#planResult .day").forEach((b) => b.addEventListener("click", () => { S.selDay = +b.dataset.day; renderPlan(); $("#planResult .day-detail").scrollIntoView({ behavior: "smooth", block: "nearest" }); }));
  $$("#planResult [data-step]").forEach((b) => b.addEventListener("click", () => { S.selDay = Math.max(1, Math.min(30, sel.day + +b.dataset.step)); renderPlan(); }));
  $$("#planResult .task input").forEach((cb) => cb.addEventListener("change", () => { S.done[cb.dataset.k] = cb.checked; store.set("done", S.done); renderPlan(); }));
}

/* ------------------------------------------------------------------ interview */
const ROUNDS = 5;
function ivProgress() { $("#ivProgress").innerHTML = Array.from({ length: ROUNDS }, (_, i) => `<i class="${i < S.history.length ? "on" : i === S.history.length && S.current ? "cur" : ""}"></i>`).join(""); }
function addMsg(who, html) {
  $("#ivChat").insertAdjacentHTML("beforeend", `<div class="msg ${who === "me" ? "me" : ""}"><span class="avatar">${I(who === "me" ? "user" : "bot")}</span><div class="bubble">${html}</div></div>`);
  $("#ivChat").lastElementChild.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
$("#btnIvStart").addEventListener("click", (e) => {
  S.history = []; S.current = null; $("#ivChat").innerHTML = ""; $("#ivResult").innerHTML = ""; ivProgress();
  e.currentTarget.innerHTML = `${I("refresh")}重新开始`;
  busy(e.currentTarget, "准备中", nextQuestion);
});
async function nextQuestion() {
  const r = await api("/api/interview", { diagnosis: S.diagnosis, history: S.history, rounds: ROUNDS });
  if (r.done) { S.current = null; ivProgress(); $("#ivComposer").classList.add("hidden"); return renderIvResult(r); }
  S.current = r.question; ivProgress();
  addMsg("bot", `<small>第 ${r.index} / ${r.rounds} 题 · ${esc(r.focus)}</small>${esc(r.question)}`);
  $("#ivComposer").classList.remove("hidden"); $("#ivAnswer").value = ""; $("#cIv").textContent = "建议 80～300 字"; $("#ivAnswer").focus({ preventScroll: true });
}
$("#ivAnswer").addEventListener("input", () => { const n = $("#ivAnswer").value.trim().length; $("#cIv").textContent = `${n} 字${n < 80 ? " · 再具体一点会更好" : ""}`; });
$("#btnIvNext").addEventListener("click", (e) => {
  const a = $("#ivAnswer").value.trim();
  if (a.length < 5) return toast("回答太短了，像真实面试一样多说几句吧");
  S.history.push({ q: S.current, a }); S.current = null; addMsg("me", esc(a)); ivProgress();
  $("#ivComposer").classList.add("hidden");
  let ok = false;
  busy(e.currentTarget, "思考中", async () => {
    addMsg("bot", `<span class="sk-msg"><span class="spin"></span>${S.history.length >= ROUNDS ? "正在评估你的整体表现…" : "面试官正在思考下一题…"}</span>`);
    try { await nextQuestion(); ok = true; } finally { const t = $$("#ivChat .msg").find((m) => m.querySelector(".sk-msg")); if (t) t.remove(); }
  }).then(() => {
    if (ok) return;
    const last = S.history.pop(); S.current = last.q; ivProgress();   // let the student resend the same answer
    const mine = $$("#ivChat .msg.me").pop(); if (mine) mine.remove();
    $("#ivComposer").classList.remove("hidden"); $("#ivAnswer").value = a;
  });
});
function radar(scores) {
  const keys = Object.keys(scores), N = keys.length, cx = 130, cy = 120, R = 82;
  const pt = (i, r) => { const a = -Math.PI / 2 + i * 2 * Math.PI / N; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
  const rings = [1, 2, 3, 4, 5].map((l) => `<polygon points="${keys.map((_, i) => pt(i, R * l / 5).join(",")).join(" ")}" fill="none" stroke="#E3E8F0"/>`).join("");
  const axes = keys.map((_, i) => `<line x1="${cx}" y1="${cy}" x2="${pt(i, R)[0]}" y2="${pt(i, R)[1]}" stroke="#E3E8F0"/>`).join("");
  const poly = keys.map((k, i) => pt(i, R * scores[k] / 5).join(",")).join(" ");
  const labels = keys.map((k, i) => { const [x, y] = pt(i, R + 22); return `<text x="${x}" y="${y + 4}" text-anchor="middle">${esc(k)}</text>`; }).join("");
  return `<svg class="radar" viewBox="0 0 260 240" role="img" aria-label="五维评分雷达图">${rings}${axes}<polygon points="${poly}" fill="rgba(14,159,142,.18)" stroke="#0E9F8E" stroke-width="2"/>${labels}</svg>`;
}
function renderIvResult(r) {
  $("#ivResult").innerHTML = `<div class="card" style="margin-top:24px">
    <p class="eyebrow">面试评价${r.demo ? " · 演示模式" : ""}</p><h3 class="report-title">综合 ${r.total} 分</h3>
    <div class="score-grid">${radar(r.scores)}
      <div class="dims">${Object.entries(r.scores).map(([k, v]) => `<div><span>${esc(k)}</span><span class="bar"><i style="width:${v * 20}%"></i></span><b>${v}/5</b>${r.reasons[k] ? `<p>${esc(r.reasons[k])}</p>` : ""}</div>`).join("")}</div></div>
    <h3 style="margin-top:24px">${I("bulb")}最重要的三点改进</h3>
    <div class="tips">${r.advice.map((x) => `<div class="tip">${I("arrow")}<span>${esc(x)}</span></div>`).join("")}</div>
    ${r.better_answer.answer ? `<h3 style="margin-top:24px">${I("quote")}回答示范</h3><div class="quote-box"><small>${esc(r.better_answer.question)}</small>${esc(r.better_answer.answer)}</div>` : ""}
    ${feedback("interview")}</div>`;
  $("#ivResult").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ------------------------------------------------------------------ ask */
$$("#askChips .chip").forEach((c) => c.addEventListener("click", () => { $("#question").value = c.textContent; $("#askForm").requestSubmit(); }));
$("#askForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("#question").value.trim(); if (q.length < 2) return toast("请输入问题");
  $("#askResult").innerHTML = skeleton("正在检索资料库…");
  busy($("#btnAsk"), "查询中", async () => {
    const r = await api("/api/ask", { question: q });
    const html = esc(r.answer).replace(/\[(\d+)\]/g, (m, n) => `<button type="button" class="cite" data-n="${n}" aria-label="查看出处 ${n}">${n}</button>`);
    $("#askResult").innerHTML = `<div class="card"><p class="eyebrow">回答${r.demo ? " · 演示模式" : ""}</p><div class="answer">${html}</div>
      ${r.references.length ? `<div class="sources">${r.references.map((c) => `<div class="source" id="src${c.n}"><div class="source-top"><span class="cite">${c.n}</span>《${esc(c.title)}》${esc(c.section)}</div><p>${esc(c.text.slice(0, 220))}${c.text.length > 220 ? "…" : ""}</p><small>来源：${esc(c.source)}${c.date ? " · " + esc(c.date) : ""}${c.url ? ` · <a href="${esc(c.url)}" target="_blank" rel="noopener">原文</a>` : ""}</small></div>`).join("")}</div>`
        : `<p class="meta">${r.grounded ? "" : "没有引用资料库内容，请以学校老师的答复为准。"}</p>`}
      ${feedback("ask")}</div>`;
    $$("#askResult .answer .cite").forEach((b) => b.addEventListener("click", () => { const s = $("#src" + b.dataset.n); if (s) { s.scrollIntoView({ behavior: "smooth", block: "center" }); s.classList.add("flash"); setTimeout(() => s.classList.remove("flash"), 1500); } }));
  }).then(() => { if ($("#askResult .skeleton")) $("#askResult").innerHTML = ""; });
});

/* ------------------------------------------------------------------ step status */
function syncSteps() {
  const has = !!S.diagnosis;
  $("#st-jobs").textContent = S.job ? `已选：${S.job.title.length > 11 ? S.job.title.slice(0, 11) + "…" : S.job.title}` : "第一步";
  $("#st-jobs").classList.toggle("done", !!S.job);
  $("#st-diagnose").textContent = has ? `已完成 · 匹配度 ${S.diagnosis.match_score}` : S.job || S.mode === "paste" ? "可以开始" : "选好岗位后";
  $("#st-diagnose").classList.toggle("done", has);
  $("#st-plan").textContent = S.plan ? "已生成" : has ? "可以开始" : "需先诊断";
  $("#st-plan").classList.toggle("done", !!S.plan);
  $("#st-interview").textContent = has ? "可以开始" : "需先诊断";
  ["#planNeed", "#ivNeed"].forEach((s) => $(s).classList.toggle("hidden", has));
  $("#planForm").classList.toggle("hidden", !has); $("#ivArea").classList.toggle("hidden", !has);
  if (!S.plan) $("#planResult").innerHTML = "";
  ivProgress();
}

document.addEventListener("click", (e) => {
  if (e.target.closest("[data-action=print]")) window.print();
  if (e.target.closest("[data-action=key]")) keySheet();
});

/* ------------------------------------------------------------------ boot */
if (S.plan && !S.plan.days) {
  store.set('legacy_plan', { plan: S.plan, done: S.done });
  S.plan = null; S.done = {}; store.set('plan', null); store.set('done', {});
}   // drop plans saved by the old 4-week version
hydrateIcons(); count(); renderTarget(); syncSteps(); loadMajors();
if (S.diagnosis) renderDiagnosis();
if (S.plan) renderPlan();
route(); setupReveal();

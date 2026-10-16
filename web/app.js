"use strict";
/* 职途助手前端：无构建、无依赖。路由 #/ #/app/<tab> #/about */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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
function session() { let s = store.get("session"); if (!s) { s = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set("session", s); } return s; }
function toast(msg, err = false) {
  const t = $("#toast"); t.textContent = msg; t.classList.toggle("err", err); t.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 4200);
}
async function api(path, body) {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 150000);
  try {
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, session: session() }), signal: ctrl.signal });
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
const S = { diagnosis: store.get("diagnosis", null), plan: store.get("plan", null), done: store.get("done", {}), history: [], current: null, filter: "全部" };

/* ------------------------------------------------------------------ router */
const TABS = ["diagnose", "plan", "interview", "ask"];
function route() {
  const h = location.hash.replace(/^#/, "") || "/";
  const [path, query] = h.split("?");
  const parts = path.split("/").filter(Boolean);
  const view = parts[0] === "app" ? "app" : parts[0] === "about" ? "about" : "home";
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + view));
  $$(".nav-links a").forEach((a) => a.classList.toggle("active", a.dataset.route === view));
  document.body.classList.toggle("in-app", view === "app");
  if (view === "app") {
    const tab = TABS.includes(parts[1]) ? parts[1] : "diagnose";
    $$(".pane").forEach((p) => p.classList.toggle("active", p.id === "pane-" + tab));
    $$(".side-item").forEach((a) => a.classList.toggle("active", a.dataset.tab === tab));
    if (query && query.includes("sample=1") && !$("#resume").value) loadSample();
    document.title = { diagnose: "差距诊断", plan: "补差计划", interview: "模拟面试", ask: "就业问答" }[tab] + " · 职途助手";
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
fetch("/api/health").then((r) => r.json()).then((h) => {
  const m = $("#mode"); m.textContent = h.demo ? "演示模式" : "AI 已连接"; m.title = h.demo ? "未配置 API Key，使用规则演示" : "模型：" + h.model;
  m.classList.toggle("demo", h.demo);
  $("#docCount").textContent = h.documents.length;
  $("#docList").innerHTML = h.documents.map((d) => `<li>${esc(d.title)}（${esc(d.source)}${d.date ? "，" + esc(d.date) : ""}）${d.url ? ` <a href="${esc(d.url)}" target="_blank" rel="noopener">原文</a>` : ""}</li>`).join("");
}).catch(() => { const m = $("#mode"); m.textContent = "服务未连接"; m.classList.add("off"); });

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
function loadSample() { $("#resume").value = SAMPLE_RESUME; $("#jd").value = SAMPLE_JD; count(); toast("已载入示例（虚构人物与岗位）"); }
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
  if (jd.length < 20) return toast("招聘信息至少 20 字", true);
  $("#diagResult").innerHTML = skeleton("正在逐条对照岗位要求，通常需要 10～40 秒…");
  $("#diagResult").scrollIntoView({ behavior: "smooth", block: "start" });
  busy(e.currentTarget, "诊断中", async () => {
    const d = await api("/api/diagnose", { resume, jd });
    S.diagnosis = d; S.plan = null; S.done = {}; S.filter = "全部";
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
  $("#diagResult").innerHTML = `
  <div class="card">
    <div class="report-head">
      <div class="gauge"><svg viewBox="0 0 136 136"><circle class="trk" cx="68" cy="68" r="58"/><circle class="val" cx="68" cy="68" r="58" stroke="${color}" style="stroke-dasharray:364.4;stroke-dashoffset:364.4"/></svg><div><b>${s}</b><small>匹配度</small></div></div>
      <div>
        <p class="eyebrow">诊断报告${d.demo ? " · 演示模式" : ""}</p>
        <h3 class="report-title">${esc(d.job_title)}</h3>
        <div class="muted">${esc(d.summary)}</div>
        <div class="stack" aria-hidden="true"><i style="width:${c["具备"] / n * 100}%;background:var(--have)"></i><i style="width:${c["部分具备"] / n * 100}%;background:#E19A2C"></i><i style="width:${c["缺少"] / n * 100}%;background:var(--miss)"></i></div>
        <div class="legend"><span>具备 <b>${c["具备"]}</b></span><span>部分具备 <b>${c["部分具备"]}</b></span><span>缺少 <b>${c["缺少"]}</b></span><span>共 <b>${n}</b> 条要求</span></div>
        <p class="method">匹配度 = 具备 1 分、部分具备 0.5 分、缺少 0 分的平均值，由程序计算${hidden ? `；已自动隐藏 ${esc(hidden)}` : ""}${d.unverified_evidence ? `；${d.unverified_evidence} 条模型依据在简历中找不到原文，已降级` : ""}</p>
      </div>
      <div class="report-actions"><button class="btn btn-ghost btn-sm" type="button" data-action="print">${I("printer")}打印报告</button></div>
    </div>
  </div>
  <div class="report-grid">
    <div class="card">
      <h3>${I("file")}逐条对照</h3>
      <div class="filters">${["全部", "缺少", "部分具备", "具备"].map((f) => `<button type="button" class="filter ${S.filter === f ? "on" : ""}" data-f="${f}">${f}${f === "全部" ? " " + n : " " + c[f]}</button>`).join("")}</div>
      ${list.map((r) => { const [cls, pill, ic] = ST[r.status]; return `
      <div class="req ${cls}"><span class="req-ic">${I(ic)}</span><div>
        <div class="req-top"><b>${esc(r.item)}<span class="cat">${esc(r.category)}</span></b><span class="st ${pill}">${esc(r.status)}</span></div>
        ${r.evidence ? `<div class="quote-box"><small>${I("check")}简历原文 · 已核验</small>${esc(r.evidence)}</div>` : ""}
        ${r.note ? `<div class="note">${I("alert")}${esc(r.note)}</div>` : ""}
        ${r.advice ? `<div class="advice">${I("bulb")}<span>${esc(r.advice)}</span></div>` : ""}
      </div></div>`; }).join("") || `<p class="muted">这一类没有条目</p>`}
    </div>
    <div>
      ${d.strengths.length ? `<div class="card side-card"><h3>${I("sparkle")}你的优势</h3><ul>${d.strengths.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
      ${d.honesty_notes.length ? `<div class="card side-card"><h3>${I("alert")}需要如实修改</h3><ul>${d.honesty_notes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
      <div class="card side-card"><h3>${I("book")}国家职业标准对应</h3><div class="muted" style="font-size:14px">${esc(d.standard_note || "本岗位没有匹配到具体的标准条目。")}</div>
        ${d.references.length ? `<div class="refs">${d.references.map((r, i) => `[${i + 1}] 《${esc(r.title)}》${esc(r.section)}${r.url ? ` · <a href="${esc(r.url)}" target="_blank" rel="noopener">来源</a>` : ""}`).join("<br>")}</div>` : ""}</div>
    </div>
  </div>
  <div class="next">
    <a href="#/app/plan">${I("calendar")}<span><b>生成 4 周补差计划</b><small>按你的可用时间安排任务</small></span></a>
    <a href="#/app/interview">${I("mic")}<span><b>针对短板模拟面试</b><small>5 道题 · 五维评分</small></span></a>
  </div>
  <div class="card" style="margin-top:24px">${feedback("diagnose")}<p class="meta">用时 ${(d.elapsed_ms / 1000).toFixed(1)} 秒</p></div>`;
  $$(".filter", $("#diagResult")).forEach((b) => b.addEventListener("click", () => { S.filter = b.dataset.f; renderDiagnosis(); }));
  requestAnimationFrame(() => requestAnimationFrame(() => { const v = $("#diagResult .gauge .val"); if (v) v.style.strokeDashoffset = 364.4 * (1 - s / 100); }));
}

/* ------------------------------------------------------------------ plan */
$("#hours").addEventListener("input", (e) => { $("#hoursVal").textContent = e.target.value; });
$("#btnPlan").addEventListener("click", (e) => {
  $("#planResult").innerHTML = skeleton("正在按你的时间安排 4 周任务…");
  busy(e.currentTarget, "规划中", async () => {
    const p = await api("/api/plan", { diagnosis: S.diagnosis, weekly_hours: +$("#hours").value });
    S.plan = p; S.done = {}; store.set("plan", p); store.set("done", {}); renderPlan(); syncSteps();
  }).then(() => { if ($("#planResult .skeleton")) $("#planResult").innerHTML = ""; });
});
function renderPlan() {
  const p = S.plan; if (!p) return;
  const total = p.weeks.reduce((a, w) => a + w.tasks.length, 0);
  const done = Object.values(S.done).filter(Boolean).length;
  $("#planResult").innerHTML = `
  <div class="card">
    <div class="plan-summary">
      <div><p class="eyebrow">${esc(S.diagnosis?.job_title || "")}${p.demo ? " · 演示模式" : ""}</p><h3 class="report-title" style="margin:0">4 周 · 每周不超过 ${p.weekly_hours} 小时</h3></div>
      <div class="progress"><div class="progress-bar"><i style="width:${total ? done / total * 100 : 0}%"></i></div><small>已完成 ${done} / ${total} 项（进度只保存在这台设备上）</small></div>
      <button class="btn btn-ghost btn-sm" type="button" data-action="print">${I("printer")}打印 / 存为 PDF</button>
    </div>
    <div class="timeline">${p.weeks.map((w) => `
      <div class="week"><span class="week-dot">${w.week}</span><div class="week-card">
        <div class="week-head"><b>第 ${w.week} 周 · ${esc(w.goal)}</b><span>${w.hours} h</span></div>
        ${w.tasks.map((t, i) => { const k = `${w.week}-${i}`; return `<label class="task ${S.done[k] ? "done" : ""}"><input type="checkbox" data-k="${k}" ${S.done[k] ? "checked" : ""}><span><span class="t">${esc(t.task)}</span><span class="c">验收：${esc(t.check)}</span></span><span class="h">${t.hours} h</span></label>`; }).join("")}
      </div></div>`).join("")}</div>
    ${p.tips.length ? `<h3 style="margin-top:8px">${I("bulb")}执行建议</h3><div class="tips">${p.tips.map((x) => `<div class="tip">${I("check")}<span>${esc(x)}</span></div>`).join("")}</div>` : ""}
    ${feedback("plan")}
  </div>`;
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
  $("#st-diagnose").textContent = has ? `已完成 · 匹配度 ${S.diagnosis.match_score}` : "第一步";
  $("#st-diagnose").classList.toggle("done", has);
  $("#st-plan").textContent = S.plan ? "已生成" : has ? "可以开始" : "需先诊断";
  $("#st-plan").classList.toggle("done", !!S.plan);
  $("#st-interview").textContent = has ? "可以开始" : "需先诊断";
  ["#planNeed", "#ivNeed"].forEach((s) => $(s).classList.toggle("hidden", has));
  $("#planForm").classList.toggle("hidden", !has); $("#ivArea").classList.toggle("hidden", !has);
  if (!S.plan) $("#planResult").innerHTML = "";
  ivProgress();
}

document.addEventListener("click", (e) => { if (e.target.closest("[data-action=print]")) window.print(); });

/* ------------------------------------------------------------------ boot */
hydrateIcons(); count(); syncSteps();
if (S.diagnosis) renderDiagnosis();
if (S.plan) renderPlan();
route(); setupReveal();

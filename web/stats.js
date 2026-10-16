"use strict";
const NAMES = { diagnose: "差距诊断", plan: "补差计划", interview: "模拟面试", ask: "就业问答" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const q = location.search;
document.getElementById("csv").href = "/stats.csv" + q;
fetch("/api/stats" + q).then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; }).then((d) => {
  const total = Object.values(d.events).reduce((a, e) => a + e.count, 0);
  const fbCount = Object.values(d.feedback).reduce((a, e) => a + e.count, 0);
  const diag = d.feedback.diagnose || {};
  document.getElementById("kpis").innerHTML = [
    ["试用人数", d.users, "按浏览器去重"], ["使用次数", total, "四项功能合计"], ["收到评分", fbCount, "用户主动提交"],
    ["诊断准确度", diag.avg_rating ? diag.avg_rating + " / 5" : "—", "用户打分平均"]
  ].map(([k, v, s]) => `<div class="kpi"><span>${esc(k)}</span><b class="num">${esc(v)}</b><small>${esc(s)}</small></div>`).join("");
  document.getElementById("events").innerHTML = "<tr><th>功能</th><th>次数</th><th>成功率</th><th>平均耗时</th></tr>" +
    (Object.entries(d.events).map(([k, e]) => `<tr><td>${NAMES[k] || esc(k)}</td><td>${e.count}</td><td>${(e.success_rate * 100).toFixed(1)}%</td><td>${(e.avg_ms / 1000).toFixed(1)} 秒</td></tr>`).join("") || "<tr><td colspan=4>暂无数据</td></tr>");
  document.getElementById("fb").innerHTML = "<tr><th>功能</th><th>评分人次</th><th>平均分</th><th>认为有用</th></tr>" +
    (Object.entries(d.feedback).map(([k, e]) => `<tr><td>${NAMES[k] || esc(k)}</td><td>${e.count}</td><td>${e.avg_rating}</td><td>${e.useful_rate == null ? "—" : (e.useful_rate * 100).toFixed(0) + "%"}</td></tr>`).join("") || "<tr><td colspan=4>暂无数据</td></tr>");
  document.getElementById("comments").innerHTML = d.comments.map((c) => `<li><span class="st st-have">${NAMES[c.kind] || esc(c.kind)} · ${c.rating}★</span> ${esc(c.comment)}</li>`).join("") || "<li class='muted'>暂无</li>";
}).catch((e) => { const el = document.getElementById("err"); el.textContent = e.message; el.classList.remove("hidden"); });

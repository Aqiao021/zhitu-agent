"use strict";
const NAMES = { diagnose: "差距诊断", plan: "补差计划", interview: "模拟面试", ask: "就业问答" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const q = location.search;
const STATIC_MODE = document.documentElement.dataset.mode === "static";
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function showError(error) { const el = document.getElementById("err"); el.textContent = error.message; el.classList.remove("hidden"); }
async function loadStats() {
  if (STATIC_MODE) {
    document.title = "本机记录 · 职途助手";
    document.getElementById("statsTitle").textContent = "本机使用记录";
    document.getElementById("statsHelp").textContent = "仅保存本机浏览器的调用时间、功能、耗时、成功状态和主动评分，不保存 API Key、简历或招聘信息原文。";
    document.querySelector(".brand").href = "index.html";
    const records = new ZhituBrowser.Records(localStorage);
    document.getElementById("csv").href = "#export";
    document.getElementById("csv").addEventListener("click", e => { e.preventDefault(); try { download("zhitu-local-records.csv", records.csv(), "text/csv;charset=utf-8"); } catch (error) { showError(error); } });
    document.getElementById("exportRaw").addEventListener("click", () => { try { download("zhitu-local-records.json", localStorage.getItem("zt_local_records_v1") || "[]", "application/json"); } catch (error) { showError(error); } });
    document.getElementById("clearLocal").addEventListener("click", () => {
      if (!confirm("将清除当前浏览器的诊断结果、计划、进度和使用记录。请先导出备份。确定清除？")) return;
      try { for (const key of ["zt_diagnosis", "zt_plan", "zt_done", "zt_session", "zt_local_records_v1"]) localStorage.removeItem(key); location.reload(); } catch (error) { showError(error); }
    });
    return records.stats();
  }
  document.getElementById("csv").href = "/stats.csv" + q;
  const r = await fetch("/api/stats" + q), d = await r.json();
  if (!r.ok) throw new Error(d.error);
  return d;
}
loadStats().then((d) => {
  const total = Object.values(d.events).reduce((a, e) => a + e.count, 0);
  const fbCount = Object.values(d.feedback).reduce((a, e) => a + e.count, 0);
  const diag = d.feedback.diagnose || {};
  document.getElementById("kpis").innerHTML = [
    STATIC_MODE ? ["记录范围", "本机", "仅当前浏览器"] : ["试用人数", d.users, "按浏览器去重"], ["使用次数", total, "四项功能合计"], ["收到评分", fbCount, "用户主动提交"],
    ["诊断准确度", diag.avg_rating ? diag.avg_rating + " / 5" : "—", "用户打分平均"]
  ].map(([k, v, s]) => `<div class="kpi"><span>${esc(k)}</span><b class="num">${esc(v)}</b><small>${esc(s)}</small></div>`).join("");
  document.getElementById("events").innerHTML = "<tr><th>功能</th><th>次数</th><th>成功率</th><th>平均耗时</th></tr>" +
    (Object.entries(d.events).map(([k, e]) => `<tr><td>${NAMES[k] || esc(k)}</td><td>${e.count}</td><td>${(e.success_rate * 100).toFixed(1)}%</td><td>${(e.avg_ms / 1000).toFixed(1)} 秒</td></tr>`).join("") || "<tr><td colspan=4>暂无数据</td></tr>");
  document.getElementById("fb").innerHTML = "<tr><th>功能</th><th>评分人次</th><th>平均分</th><th>认为有用</th></tr>" +
    (Object.entries(d.feedback).map(([k, e]) => `<tr><td>${NAMES[k] || esc(k)}</td><td>${e.count}</td><td>${e.avg_rating}</td><td>${e.useful_rate == null ? "—" : (e.useful_rate * 100).toFixed(0) + "%"}</td></tr>`).join("") || "<tr><td colspan=4>暂无数据</td></tr>");
  document.getElementById("comments").innerHTML = d.comments.map((c) => `<li><span class="st st-have">${NAMES[c.kind] || esc(c.kind)} · ${c.rating}★</span> ${esc(c.comment)}</li>`).join("") || "<li class='muted'>暂无</li>";
}).catch(showError);

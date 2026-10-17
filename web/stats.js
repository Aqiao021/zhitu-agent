"use strict";
const NAMES = { diagnose: "差距诊断", plan: "30 天计划", interview: "模拟面试", ask: "就业问答", resume_tips: "简历优化建议", recommend: "岗位推荐" };
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
      try { for (const key of ["zt_diagnosis", "zt_dx_history", "zt_hid", "zt_pick", "zt_plan", "zt_done", "zt_session", "zt_job", "zt_mode", "zt_legacy_plan", "zt_local_records_v1"]) localStorage.removeItem(key); location.reload(); } catch (error) { showError(error); }
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
    STATIC_MODE ? ["记录范围", "本机", "仅当前浏览器"] : ["试用人数", d.users, "按浏览器去重"], ["使用次数", total, "模型功能合计"], ["收到评分", fbCount, "用户主动提交"],
    ["诊断准确度", diag.avg_rating ? diag.avg_rating + " / 5" : "—", "用户打分平均"]
  ].map(([k, v, s]) => `<div class="kpi"><span>${esc(k)}</span><b class="num">${esc(v)}</b><small>${esc(s)}</small></div>`).join("");
  document.getElementById("events").innerHTML = "<tr><th>功能</th><th>次数</th><th>成功率</th><th>平均耗时</th></tr>" +
    (Object.entries(d.events).map(([k, e]) => `<tr><td>${NAMES[k] || esc(k)}</td><td>${e.count}</td><td>${(e.success_rate * 100).toFixed(1)}%</td><td>${(e.avg_ms / 1000).toFixed(1)} 秒</td></tr>`).join("") || "<tr><td colspan=4>暂无数据</td></tr>");
  document.getElementById("fb").innerHTML = "<tr><th>功能</th><th>评分人次</th><th>平均分</th><th>认为有用</th></tr>" +
    (Object.entries(d.feedback).map(([k, e]) => `<tr><td>${NAMES[k] || esc(k)}</td><td>${e.count}</td><td>${e.avg_rating}</td><td>${e.useful_rate == null ? "—" : (e.useful_rate * 100).toFixed(0) + "%"}</td></tr>`).join("") || "<tr><td colspan=4>暂无数据</td></tr>");
  document.getElementById("comments").innerHTML = d.comments.map((c) => `<li><span class="st st-have">${NAMES[c.kind] || esc(c.kind)} · ${c.rating}★</span> ${esc(c.comment)}</li>`).join("") || "<li class='muted'>暂无</li>";
}).catch(showError);

if (!STATIC_MODE) {
/* ------------------------------------------------------------ job library admin */
const $ = (id) => document.getElementById(id);
function toast(msg, err = false) { const t = $("toast"); t.textContent = msg; t.classList.toggle("err", err); t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 4000); }
async function call(path, body) {
  const r = await fetch(path + q, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || "请求失败"); return d;
}
let pending = null;
function showPreview(job, sid) {
  pending = { job, sid };
  $("preview").innerHTML = `<div class="preview"><b>${esc(job.title)}</b>${job.city ? ` · ${esc(job.city)}` : ""}${job.education ? ` · ${esc(job.education)}` : ""}
    <p class="muted small">${esc(job.summary)} ｜ 专业：${esc(job.majors.join("、") || "未匹配")}</p>
    <ol>${job.requirements.map((r) => `<li>[${esc(r.level)}·${esc(r.category)}] ${esc(r.item)}</li>`).join("")}</ol>
    <p class="small">工具：${esc(job.tools.join("、") || "—")}｜证书：${esc(job.certificates.join("、") || "—")}</p>
    <button class="btn btn-primary btn-sm" id="aSave" type="button">确认入库</button> <button class="btn btn-ghost btn-sm" id="aCancel" type="button">取消</button></div>`;
  $("aSave").onclick = async () => { try { await call("/api/admin/save", { job: pending.job, submission_id: pending.sid }); $("preview").innerHTML = ""; toast("已入库"); loadAdmin(); } catch (e) { toast(e.message, true); } };
  $("aCancel").onclick = () => { $("preview").innerHTML = ""; pending = null; };
  $("preview").scrollIntoView({ behavior: "smooth", block: "center" });
}
async function extract(body, btn) {
  const old = btn.textContent; btn.disabled = true; btn.textContent = "整理中…";
  try { const d = await call("/api/admin/extract", body); showPreview(d.job, body.submission_id); } catch (e) { toast(e.message, true); } finally { btn.disabled = false; btn.textContent = old; }
}
async function loadAdmin() {
  let d; try { d = await call("/api/admin/jobs"); } catch (e) { $("jobAdmin").classList.add("hidden"); return; }
  $("subs").innerHTML = d.submissions.map((s) => `<div class="sub"><div class="sub-top"><b>#${s.id}</b> ${esc(s.time)}${s.note ? ` · ${esc(s.note)}` : ""}${s.url ? ` · <a href="${esc(s.url)}" target="_blank" rel="noopener">原链接</a>` : ""}</div>
    <pre>${esc(s.text.slice(0, 400))}${s.text.length > 400 ? "…" : ""}</pre>
    <button class="btn btn-primary btn-sm" data-ex="${s.id}" type="button">整理预览</button> <button class="btn btn-ghost btn-sm" data-drop="${s.id}" type="button">删除</button></div>`).join("") || "<p class='muted small'>暂无待审核的提交</p>";
  $("imported").innerHTML = d.imported.map((j) => `<div class="sub"><b>${esc(j.title)}</b> <span class="muted small">${esc(j.majors.join("、"))} · ${j.total} 条要求</span> <button class="btn btn-ghost btn-sm" data-del="${esc(j.id)}" type="button">下架</button></div>`).join("") || "<p class='muted small'>还没有导入的真实招聘</p>";
  document.querySelectorAll("[data-ex]").forEach((b) => b.onclick = () => extract({ submission_id: +b.dataset.ex }, b));
  document.querySelectorAll("[data-drop]").forEach((b) => b.onclick = async () => { await call("/api/admin/drop", { submission_id: +b.dataset.drop }).catch((e) => toast(e.message, true)); loadAdmin(); });
  document.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => { await call("/api/admin/delete_job", { id: b.dataset.del }).catch((e) => toast(e.message, true)); loadAdmin(); });
}
$("aExtract").onclick = () => { const text = $("aText").value.trim(); if (text.length < 40) return toast("至少 40 字", true); extract({ text, url: $("aUrl").value.trim() }, $("aExtract")); };
loadAdmin();

}

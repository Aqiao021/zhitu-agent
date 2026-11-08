/* GitHub Pages connection UI; credentials belong only to the in-memory Client. */
function updateBrowserMode() {
  const status = browserClient?.status || 'disconnected', mode = $('#mode');
  if (S.demo && status !== 'demo') leaveDemoState();   // a real key (or clearing it) ends the sample walkthrough
  (mode.querySelector('.mode-text') || mode).textContent = { disconnected: '待连接模型', configured: '尚未验证', connected: 'AI 已连接', demo: '示例体验中' }[status];
  mode.title = status === 'demo' ? '正在示例体验，点击连接自己的模型' : '点击填写自己的模型密钥；只在当前页面内存中使用，刷新后清除';
  mode.classList.toggle('off', status !== 'connected' && status !== 'demo');
  mode.classList.toggle('demo', status === 'demo');
  mode.classList.toggle('user', status === 'connected');
  $('#keyHint').classList.toggle('hidden', status === 'connected' || status === 'demo');
}
async function loadBrowserEdition() {
  updateBrowserMode();
  $('#keyHint').innerHTML = `${icon('info')}<span>填写自己的模型 Key 后即可诊断自己的简历。网页免费，模型调用由服务商计费；密钥只在当前页面内存中使用，刷新后清除。没有 Key 也可以先看一遍完整流程。</span>
    <button type="button" class="btn btn-default btn-sm" data-action="demo">先看示例体验</button><button type="button" class="btn btn-primary btn-sm" data-action="key">填写 API Key</button>`;
  $('#btnContribute').hidden = true;
  try {
    const r = await fetch('model-data.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('资料库加载失败');
    const data = await r.json();
    browserClient = new ZhituBrowser.Client({ data, onStatus: updateBrowserMode, onStorageError: message => toast(message, true) });
    H = { providers: data.providers, allow_user_key: true, server_key: false, documents: data.documents };
    $('#docCount').textContent = data.documents.length;
    $('#docList').innerHTML = data.documents.map(d => `<li>${esc(d.title)}（${esc(d.source)}${d.date ? '，' + esc(d.date) : ''}）${d.url ? `<a href="${esc(d.url)}" target="_blank" rel="noopener">原文</a>` : ''}</li>`).join('');
    updateBrowserMode();
  } catch (_) { $('#mode').textContent = '资料加载失败'; toast('页面资料加载失败，请检查网络后刷新', true); }
  window.addEventListener('pagehide', () => { browserClient?.disconnect(); KEY.mem = null; const field = $('#kKey'); if (field) field.value = ''; });
}
async function browserKeySheet() {
  await browserReady;
  if (!browserClient) return toast('页面资料尚未加载，请刷新重试', true);
  const k = userKey() || {}, cur = H.providers.find(p => p.id === k.provider) || H.providers[0];
  openSheet(`<p class="eyebrow">模型设置</p><h3 class="sheet-title">连接自己的模型</h3>
    <form id="browserKeyForm"><label class="lbl" for="kProv">模型服务商</label>
    <select class="input" id="kProv">${H.providers.map(p => `<option value="${esc(p.id)}" ${p.id === cur.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
    <label class="lbl" for="kBase">HTTPS 接口地址</label><input class="input" id="kBase" type="url" required value="${esc(k.baseURL || cur.base_url)}" autocomplete="off">
    <label class="lbl" for="kModel">模型名</label><input class="input" id="kModel" required maxlength="80" value="${esc(k.model || cur.model)}" autocomplete="off" spellcheck="false">
    <label class="lbl" for="kKey">API Key</label><input class="input" id="kKey" type="password" required maxlength="200" autocomplete="off" spellcheck="false" placeholder="在这里填写自己的 Key">
    <p class="muted small">没有 Key？<button type="button" class="linkish" data-action="demo">先用示例体验走一遍完整流程</button>（虚构简历，不调用模型）。</p>
    <p class="notice">密钥只在当前页面内存中使用，刷新或离开页面后清除，不写入浏览器存储。请求直接发往上方的模型接口，费用由你的账户承担。若服务商禁止浏览器跨域访问，连接会失败。</p>
    <p id="kMessage" class="muted small" role="status"></p><div class="sheet-actions"><button class="btn btn-primary" id="kSave" type="submit">验证并连接</button>
    <button class="btn btn-ghost" type="button" id="kClear">清除 Key</button></div></form>`);
  $('#kProv').addEventListener('change', () => { const p = H.providers.find(p => p.id === $('#kProv').value); $('#kBase').value = p.base_url; $('#kModel').value = p.model; });
  $('#kClear').addEventListener('click', () => { browserClient.disconnect(); KEY.mem = null; $('#kKey').value = ''; $('#kMessage').textContent = '当前页面的密钥已清除。'; });
  $('#browserKeyForm').addEventListener('submit', async e => {
    e.preventDefault();
    const p = H.providers.find(p => p.id === $('#kProv').value);
    const config = { provider: p.provider, baseURL: $('#kBase').value.trim(), model: $('#kModel').value.trim(), key: $('#kKey').value };
    $('#kKey').value = '';
    await busy($('#kSave'), '验证中', async () => {
      $('#kMessage').textContent = '正在验证连接…';
      try {
        browserClient.configure(config);
        KEY.mem = { provider: p.id, baseURL: config.baseURL, model: config.model };
        await browserClient.request('/api/key/test');
        closeSheet(); toast('AI 已连接，可以开始诊断了');
      } catch (error) { const m = $('#kMessage'); if (m) m.textContent = error.message; throw error; }
    });
  });
  $('#kKey').focus();
}

/* ------------------------------------------------------------------ sample walkthrough (no key, nothing saved) */
async function startDemo() {
  await browserReady;
  if (!browserClient) return toast('页面资料尚未加载，请刷新重试', true);
  let script;
  try { const r = await fetch('demo.json', { cache: 'no-cache' }); if (!r.ok) throw new Error(); script = await r.json(); }
  catch (_) { return toast('示例数据加载失败，请检查网络后重试', true); }
  browserClient.startDemo(script); KEY.mem = null;
  Object.assign(S, { demo: true, demoHist: [], demoShifted: false, diagnosis: null, plan: null, done: {}, hid: null, tips: null, history: [], current: null, selDay: null, filter: '全部' });
  ['#diagResult', '#planResult', '#ivChat', '#ivResult', '#askResult'].forEach((sel) => { const el = $(sel); if (el) el.innerHTML = ''; });
  $('#ivComposer').classList.add('hidden'); $('#btnIvStart').innerHTML = '开始面试';
  $('#resume').value = script.resume; count();
  try { pickJob(await getJSON('/api/jobs/' + encodeURIComponent(script.job_id))); } catch (_) { return toast('示例岗位加载失败，请刷新重试', true); }
  document.body.classList.add('demo-on'); $('#demoBar').hidden = false;
  closeSheet(); syncSteps(); updateBrowserMode();
  location.hash = '#/app/diagnose';
  setTimeout(() => $('#btnDiagnose').click(), 400);
}
function demoDay30() {
  const d = browserClient?.demo;
  if (!S.demo || !d) return;
  if (!S.diagnosis) return toast('请先完成第一次示例诊断', true);
  if (!S.demoShifted) { S.demoHist.forEach((x) => { x.ts -= 30 * 864e5; (x.iv || []).forEach((v) => { v.ts -= 30 * 864e5; }); }); S.demoShifted = true; }   // pretend the first run was 30 days ago
  $('#resume').value = d.resume_day30; count();
  location.hash = '#/app/diagnose';
  toast('已换成第 30 天更新后的示例简历，正在复诊');
  setTimeout(() => $('#btnDiagnose').click(), 400);
}
function leaveDemoState() {
  S.demo = false; S.demoHist = [];
  Object.assign(S, { pick: store.get('pick', []), hid: store.get('hid', null), diagnosis: store.get('diagnosis', null), plan: store.get('plan', null), done: store.get('done', {}),
    job: store.get('job', null), mode: store.get('mode', 'job'), history: [], current: null, tips: null, selDay: null, filter: '全部' });
  ['#diagResult', '#planResult', '#ivChat', '#ivResult'].forEach((sel) => { const el = $(sel); if (el) el.innerHTML = ''; });
  $('#ivComposer').classList.add('hidden'); $('#resume').value = ''; count();
  document.body.classList.remove('demo-on'); $('#demoBar').hidden = true;
  renderTarget(); renderTray(); syncSteps();
  if (S.diagnosis) renderDiagnosis();
  if (S.plan) renderPlan();
}

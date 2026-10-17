/* GitHub Pages connection UI; credentials belong only to the in-memory Client. */
function updateBrowserMode() {
  const status = browserClient?.status || 'disconnected', mode = $('#mode');
  (mode.querySelector('.mode-text') || mode).textContent = { disconnected: '待连接模型', configured: '尚未验证', connected: 'AI 已连接' }[status];
  mode.title = '点击填写自己的模型密钥；只在当前页面内存中使用，刷新后清除';
  mode.classList.toggle('off', status !== 'connected');
  mode.classList.toggle('user', status === 'connected');
  $('#keyHint').classList.toggle('hidden', status === 'connected');
}
async function loadBrowserEdition() {
  updateBrowserMode();
  $('#keyHint').textContent = '点击右上角「待连接模型」填写自己的 Key。网页免费，模型调用由服务商计费；密钥只在当前页面内存中使用，刷新后清除。';
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

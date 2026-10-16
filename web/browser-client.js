/* Browser-only task engine. No dependencies; credentials live only in this instance. */
(function (root) {
  'use strict';
  const STATUS = { '具备': 1, '部分具备': 0.5, '缺少': 0 };
  const CATS = new Set(['专业技能', '工具', '项目经验', '学历证书', '综合素质']);
  const KINDS = new Set(['diagnose', 'plan', 'interview', 'ask']);
  const clip = (s, n = 6000) => String(s ?? '').trim().slice(0, n);
  const list = x => Array.isArray(x) ? x : [];
  const norm = s => String(s ?? '').replace(/\s/g, '');
  const strings = (xs, n, size) => list(xs).slice(0, n).map(x => clip(x, size));
  const number = (x, fallback) => Number.isFinite(Number(x)) ? Number(x) : fallback;
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(x, hi));
  const RULES = [
    ['身份证号', /(?<![0-9])[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[0-9Xx](?![0-9])/g],
    ['手机号', /(?<![0-9])(?:\+?86[- ]?)?1[3-9]\d[- ]?\d{4}[- ]?\d{4}(?![0-9])/g],
    ['邮箱', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g],
    ['QQ号', /(?:qq|QQ号?)[:：\s]*\d{5,11}/gi],
    ['微信号', /(?:微信号?|wechat|WeChat|vx|VX)[:：\s]*[A-Za-z][-_A-Za-z0-9]{5,19}/g],
    ['住址', /(?:家庭住址|住址|现居住地|地址)[:：]\s*[^\n，,。；;]{4,40}/g],
  ];
  function mask(input) {
    let text = String(input ?? '');
    const counts = {};
    for (const [name, pattern] of RULES) {
      text = text.replace(pattern, () => { counts[name] = (counts[name] || 0) + 1; return `[已隐藏${name}]`; });
    }
    return { text, counts };
  }
  function extractJSON(input) {
    const text = String(input ?? '').trim();
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const source = fenced ? fenced[1] : text;
    const start = source.indexOf('{');
    let depth = 0, quoted = false, escaped = false;
    for (let i = start; start >= 0 && i < source.length; i++) {
      const c = source[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') quoted = false;
      } else if (c === '"') quoted = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        try { return JSON.parse(source.slice(start, i + 1)); } catch (_) { break; }
      }
    }
    throw new Error('模型返回的结构化结果不完整，请重试');
  }
  function tokens(input) {
    const stop = new Set('的了和是在与及或等为对把被就也都而且并其之这那有我你他她它们吗呢吧啊怎么什么如何哪些可以能否需要');
    const result = [];
    for (const run of String(input).match(/[一-鿿]+|[A-Za-z0-9.+#-]+/g) || []) {
      if (/^[一-鿿]/.test(run)) {
        result.push(...[...run].filter(c => !stop.has(c)));
        for (let i = 0; i < run.length - 1; i++) result.push(run.slice(i, i + 2));
      } else result.push(run.toLowerCase());
    }
    return result;
  }
  function refsText(refs) {
    return refs.map((c, i) => `[${i + 1}] 《${c.title}》${c.section}（来源：${c.source}）\n${c.text}`).join('\n\n');
  }
  class Records {
    constructor(storage) { this.storage = storage; }
    read() {
      const raw = this.storage.getItem('zt_local_records_v1');
      if (!raw) return [];
      const rows = JSON.parse(raw);
      if (!Array.isArray(rows)) throw new Error('本机记录格式异常，请先导出原始记录备份');
      return rows;
    }
    add(row) {
      const rows = this.read();
      rows.push({ time: new Date().toISOString(), ...row });
      this.storage.setItem('zt_local_records_v1', JSON.stringify(rows));
    }
    stats() {
      const events = {}, feedback = {}, comments = [];
      for (const row of this.read()) {
        if (!KINDS.has(row.kind)) continue;
        if (row.type === 'event') {
          const e = events[row.kind] ||= { count: 0, success_rate: 0, avg_ms: 0 };
          e.count++; e.success_rate += row.ok ? 1 : 0; e.avg_ms += row.ms;
        } else if (row.type === 'feedback') {
          const f = feedback[row.kind] ||= { count: 0, avg_rating: 0, useful_rate: 0, answered: 0 };
          f.count++; f.avg_rating += row.rating;
          if (row.useful !== null) { f.answered++; f.useful_rate += row.useful ? 1 : 0; }
          if (row.comment) comments.unshift({ kind: row.kind, rating: row.rating, comment: row.comment });
        }
      }
      for (const e of Object.values(events)) { e.success_rate /= e.count; e.avg_ms = Math.round(e.avg_ms / e.count); }
      for (const f of Object.values(feedback)) { f.avg_rating = +(f.avg_rating / f.count).toFixed(2); f.useful_rate = f.answered ? f.useful_rate / f.answered : null; delete f.answered; }
      return { users: Object.keys(events).length ? 1 : 0, events, feedback, comments: comments.slice(0, 30) };
    }
    csv() {
      const cell = input => {
        let text = String(input ?? '');
        if (/^[\s\uFEFF]*[=+@-]/.test(text)) text = "'" + text;
        return '"' + text.replace(/"/g, '""') + '"';
      };
      const rows = [['类型', '时间', '功能', '成功或评分', '耗时毫秒或是否有用', '匹配度或反馈']];
      for (const row of this.read()) rows.push([row.type, row.time, row.kind, row.type === 'event' ? row.ok : row.rating, row.type === 'event' ? row.ms : row.useful, row.type === 'event' ? row.score : row.comment]);
      return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n');
    }
  }
  class Client {
    #settings = null;
    #generation = 0;
    #controller = null;
    constructor({ data, fetch: fetcher = root.fetch.bind(root), storage = root.localStorage, onStatus = () => {}, onStorageError = () => {} }) {
      this.data = data;
      this.fetch = fetcher;
      this.records = new Records(storage);
      this.onStatus = onStatus;
      this.onStorageError = onStorageError;
      this.status = 'disconnected';
      this.index = list(data.chunks).map(chunk => {
        const terms = tokens(`${chunk.title} ${chunk.section} ${chunk.text}`), counts = new Map();
        for (const t of terms) counts.set(t, (counts.get(t) || 0) + 1);
        return { chunk, counts, length: terms.length };
      });
      this.averageLength = this.index.reduce((n, x) => n + x.length, 0) / (this.index.length || 1);
    }
    setStatus(status) { this.status = status; this.onStatus(status); }
    configure({ key, baseURL = 'https://api.deepseek.com/v1', model = 'deepseek-chat' }) {
      const url = new URL(baseURL);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('接口地址必须是 HTTPS，且不能包含账号、密码、参数或片段');
      if (!key?.trim() || /[\r\n]/.test(key) || !model?.trim()) throw new Error('请填写有效的 API Key 和模型名称');
      this.disconnect();
      this.#settings = { key: key.trim(), baseURL: url.href.replace(/\/$/, ''), model: model.trim() };
      this.setStatus('configured');
    }
    disconnect() {
      this.#generation++;
      this.#controller?.abort();
      this.#settings = null;
      this.setStatus('disconnected');
    }
    search(query, k) {
      const terms = [...new Set(tokens(query))], n = this.index.length;
      const df = new Map(terms.map(t => [t, this.index.filter(c => c.counts.has(t)).length]));
      return this.index.map((item, id) => {
        let score = 0;
        for (const t of terms) {
          const tf = item.counts.get(t) || 0;
          if (tf) score += Math.log(1 + (n - df.get(t) + 0.5) / (df.get(t) + 0.5)) * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * item.length / (this.averageLength || 1)));
        }
        return { ...item, id, score };
      }).filter(c => c.score > 0).sort((a, b) => b.score - a.score || a.id - b.id).slice(0, k).map(c => c.chunk);
    }
    async chat(system, user, maxTokens = 2000, temperature = 0.3) {
      const settings = this.#settings;
      if (!settings) throw new Error('请先连接模型，填写你自己的 API Key');
      const response = await this.fetch(settings.baseURL + '/chat/completions', {
        method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.key}` },
        body: JSON.stringify({ model: settings.model, max_tokens: maxTokens, temperature, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
        signal: this.#controller.signal,
      });
      if (this.#controller.signal.aborted) throw new Error('请求已取消');
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) this.setStatus('configured');
        const reason = { 401: '密钥无效，请检查后重新填写', 402: '模型账户余额不足，请前往服务商控制台检查', 403: '没有调用权限，请检查密钥与模型', 429: '模型接口限流，请稍后再试' }[response.status] || '请检查模型名称、接口地址，或稍后重试';
        throw new Error(`模型接口 HTTP ${response.status}：${reason}`);
      }
      const body = await response.json();
      const text = body?.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text.trim()) throw new Error('模型没有返回有效内容，请检查模型是否支持聊天接口');
      if (this.#controller.signal.aborted) throw new Error('请求已取消');
      this.setStatus('connected');
      return text;
    }
    record(row) {
      try { this.records.add(row); } catch (_) { this.onStorageError('本机记录保存失败（可能是存储空间不足或浏览器禁止存储），请及时导出已有记录'); }
    }
    async request(path, body = {}) {
      const kind = path.split('/').pop();
      if (kind === 'feedback') {
        if (!KINDS.has(body.kind) || !Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5) throw new Error('请先选择 1～5 星评分');
        let comment = mask(clip(body.comment, 200)).text;
        if (this.#settings) comment = comment.split(this.#settings.key).join('[已隐藏密钥]');
        this.records.add({ type: 'feedback', kind: body.kind, rating: body.rating, useful: typeof body.useful === 'boolean' ? body.useful : null, comment });
        return { ok: true };
      }
      if (!KINDS.has(kind) && kind !== 'test') throw new Error('不支持的功能');
      if (!this.#settings) throw new Error('请先连接模型，填写你自己的 API Key');
      if (this.#controller) throw new Error('正在处理上一个请求，请等待完成后再试');
      const generation = this.#generation, start = Date.now();
      this.#controller = new AbortController();
      const timer = setTimeout(() => this.#controller?.abort(), 60000);
      try {
        const result = kind === 'test' ? (await this.chat('这是连接测试，请只回复 OK。', 'OK', 8), { ok: true }) : await this[kind](body);
        if (generation !== this.#generation) throw new Error('请求已取消');
        const elapsed = Date.now() - start;
        if (kind !== 'test') this.record({ type: 'event', kind, ok: true, ms: elapsed, score: result.match_score ?? null });
        return { ...result, elapsed_ms: elapsed, demo: false };
      } catch (error) {
        if (kind !== 'test' && generation === this.#generation) this.record({ type: 'event', kind, ok: false, ms: Date.now() - start, score: null });
        if (generation !== this.#generation) throw new Error('请求已取消');
        if (this.#controller.signal.aborted) throw new Error('等待超过 60 秒，请稍后重试；服务商可能已处理本次请求');
        if (error instanceof TypeError) throw new Error('无法连接模型接口，请检查网络、接口地址及服务商是否允许浏览器跨域访问');
        throw error;
      } finally { clearTimeout(timer); this.#controller = null; }
    }
    async diagnose({ resume, jd }) {
      resume = clip(resume); jd = clip(jd);
      if (norm(resume).length < 30 || norm(jd).length < 20) throw new Error('简历至少 30 字、招聘信息至少 20 字');
      const masked = mask(resume), refs = this.search(mask(jd).text, 3);
      const data = extractJSON(await this.chat(this.data.prompts.DIAGNOSE, `【招聘信息】\n${mask(jd).text}\n\n【简历】\n${masked.text}\n\n【参考资料】\n${refsText(refs) || '（无）'}`, 2500));
      let flagged = 0;
      const requirements = list(data.requirements).slice(0, 15).filter(r => r && clip(r.item)).map(r => {
        let status = Object.hasOwn(STATUS, r.status) ? r.status : '缺少';
        let evidence = clip(r.evidence), note = '';
        const verified = !!evidence && norm(masked.text).includes(norm(evidence));
        if (evidence && !verified) { flagged++; evidence = ''; note = '模型给出的依据在简历中找不到原文，已降级处理'; }
        if (!evidence && status === '具备') { status = '部分具备'; note ||= '简历中没有找到明确依据'; }
        return { item: clip(r.item, 60), category: CATS.has(r.category) ? r.category : '专业技能', status, evidence: evidence.slice(0, 200), verified, note, advice: clip(r.advice, 80) };
      });
      if (!requirements.length) throw new Error('没有识别出岗位要求，请检查招聘信息后重试');
      const counts = Object.fromEntries(Object.keys(STATUS).map(s => [s, requirements.filter(r => r.status === s).length]));
      const score = Math.round(100 * requirements.reduce((s, r) => s + STATUS[r.status], 0) / requirements.length);
      return { job_title: clip(data.job_title || '目标岗位', 40), summary: clip(data.summary, 300), requirements: requirements.sort((a, b) => STATUS[a.status] - STATUS[b.status]), counts, match_score: score, strengths: strings(data.strengths, 3, 80), honesty_notes: strings(data.honesty_notes, 5, 120), standard_note: clip(data.standard_note, 200), references: refs, privacy: masked.counts, unverified_evidence: flagged };
    }
    async plan({ diagnosis, weekly_hours }) {
      const hours = clamp(Math.trunc(number(weekly_hours, 10)), 3, 40);
      const gaps = list(diagnosis?.requirements).filter(r => r.status !== '具备').map(({ item, category, status, advice }) => ({ item, category, status, advice }));
      if (!gaps.length) throw new Error('请先完成一次包含待补差距的诊断');
      const data = extractJSON(await this.chat(this.data.prompts.PLAN, `每周可用时间：${hours} 小时\n差距诊断：${JSON.stringify({ job_title: diagnosis.job_title, gaps })}`, 2500));
      const weeks = list(data.weeks).slice(0, 4).filter(w => w && typeof w === 'object').map((w, i) => {
        const tasks = list(w.tasks).slice(0, 5).filter(t => t && clip(t.task)).map(t => ({ task: clip(t.task, 80), hours: clamp(number(t.hours, 1), 0.5, 40), check: clip(t.check, 80) }));
        const total = tasks.reduce((s, t) => s + t.hours, 0);
        if (total > hours) {
          // Reserve the minimum half-hour per task, then divide the remaining time.
          const remaining = hours - tasks.length * 0.5, weight = total - tasks.length * 0.5;
          for (const t of tasks) t.hours = Math.floor((0.5 + (t.hours - 0.5) / weight * remaining) * 10 + 1e-8) / 10;
        }
        return { week: i + 1, goal: clip(w.goal, 60), tasks, hours: +tasks.reduce((s, t) => s + t.hours, 0).toFixed(1) };
      }).filter(w => w.tasks.length);
      if (!weeks.length) throw new Error('模型没有返回有效计划，请重试');
      return { weekly_hours: hours, weeks, tips: strings(data.tips, 3, 80) };
    }
    async interview({ diagnosis, history, rounds }) {
      if (!diagnosis) throw new Error('请先完成一次诊断');
      rounds = clamp(Math.trunc(number(rounds, 5)), 3, 8);
      history = list(history).slice(0, rounds).map(h => ({ q: clip(h.q, 300), a: mask(clip(h.a, 1500)).text }));
      const context = JSON.stringify({ job_title: diagnosis.job_title, requirements: list(diagnosis.requirements).map(({ item, status, evidence }) => ({ item, status, evidence: mask(evidence).text })) });
      const log = history.map((h, i) => `第${i + 1}题：${h.q}\n回答：${h.a || '（未作答）'}`).join('\n');
      if (history.length >= rounds) {
        const data = extractJSON(await this.chat(this.data.prompts.INTERVIEW_END, `岗位与诊断：${context}\n\n问答记录：\n${log}`, 2000));
        const keys = ['专业知识', '项目表达', '问题解决', '沟通表达', '岗位匹配'];
        const scores = Object.fromEntries(keys.map(k => [k, clamp(Math.round(number(data.scores?.[k], 3)), 1, 5)]));
        return { done: true, scores, total: Math.round(Object.values(scores).reduce((s, n) => s + n, 0) * 4), reasons: Object.fromEntries(keys.map(k => [k, clip(data.reasons?.[k], 120)])), advice: strings(data.advice, 3, 100), better_answer: { question: clip(data.better_answer?.question, 200), answer: clip(data.better_answer?.answer, 600) } };
      }
      const data = extractJSON(await this.chat(this.data.prompts.INTERVIEW_Q, `岗位与诊断：${context}\n\n已进行的问答：\n${log || '（尚未开始）'}\n\n请出第 ${history.length + 1} 题（共 ${rounds} 题）。`, 600, 0.6));
      if (!clip(data.question)) throw new Error('没有生成面试问题，请重试');
      return { done: false, index: history.length + 1, rounds, question: clip(data.question, 300), focus: clip(data.focus, 20) };
    }
    async ask({ question }) {
      question = mask(clip(question, 500)).text;
      if (norm(question).length < 2) throw new Error('请输入问题');
      const refs = this.search(question, 5);
      if (!refs.length) return { answer: '资料库里没有找到相关信息。建议向学院就业指导老师或辅导员咨询。', references: [], grounded: false };
      let answer = await this.chat(this.data.prompts.ASK, `参考资料：\n${refsText(refs)}\n\n问题：${question}`, 800);
      const cited = new Set();
      answer = answer.replace(/\[(\d+)\]/g, (full, n) => { n = +n; if (n >= 1 && n <= refs.length) { cited.add(n); return full; } return ''; });
      return { answer: answer.trim(), references: [...cited].sort((a, b) => a - b).map(n => ({ ...refs[n - 1], n })), grounded: cited.size > 0 };
    }
  }
  const api = { Client, Records, mask, extractJSON };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ZhituBrowser = api;
})(globalThis);

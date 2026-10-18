/* Browser-only task engine. No dependencies; credentials live only in this instance. */
(function (root) {
  'use strict';
  const STATUS = { '具备': 1, '部分具备': 0.5, '缺少': 0 };
  const CATS = new Set(['专业技能', '软件工具', '证书', '项目经验', '通用素养']);
  const OLD_CATS = { '工具': '软件工具', '学历证书': '证书', '综合素质': '通用素养' };
  const WEIGHT = { '必需': 2, '加分': 1 };
  const KINDS = new Set(['diagnose', 'plan', 'interview', 'ask', 'resume_tips']);
  const RESUME_MAX = 14000;   // resume plus extracted project materials
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
  function jobCard(job) {
    return { ...job, aliases: list(job.aliases).slice(0, 3), tools: list(job.tools).slice(0, 5),
      must: list(job.requirements).filter(r => r.level === '必需').length, total: list(job.requirements).length };
  }
  // Same keyword grouping rules as the Python service; all calculations stay on this device.
  const SYNONYMS = {ps:'photoshop',pr:'premiere','premiere pro':'premiere',ae:'after effects','ai绘图':'aigc',u3d:'unity',unity3d:'unity','电工证':'低压电工','上岗证':'低压电工',office:'办公软件',word:'办公软件',ppt:'办公软件',wps:'办公软件',prompt:'提示词','提示词工程':'提示词','团队协作':'团队合作','协作':'团队合作','沟通协调':'沟通',k8s:'kubernetes',cad:'autocad',py:'python'};
  const STOP_TAGS = new Set(['1+x','证书','专业','项目','实习','实训','经验','大专','专科','应届生','2026届','能力','项目经历','实习经历','计算机','相关专业']);
  const tag = k => { k=clip(k).toLowerCase(); return SYNONYMS[k] || k; };
  const unique = xs => [...new Set(xs)];
  const lexical = (a,b) => a < b ? -1 : a > b ? 1 : 0;
  function mentions(keyword, text) {
    const k=clip(keyword).toLowerCase();
    if (k.length<2) return false;
    if (/^[a-z0-9.+#/-]{1,3}$/.test(k)) {
      const escaped=k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      return new RegExp('(?<![a-z])'+escaped+'(?![a-z])').test(text);
    }
    return text.includes(k);
  }
  function combineJobs(all, ids) {
    const jobs=unique(ids.map(String)).map(id=>all.find(j=>j.id===id)).filter(Boolean).slice(0,10);
    if(jobs.length<2) throw new Error('请至少选择 2 个岗位');
    const n=jobs.length, tags=new Map(), used=new Set(), groups=[];
    for(const j of jobs) list(j.requirements).forEach((r,i)=>{
      for(const t of unique(list(r.keywords).map(tag)).filter(t=>!STOP_TAGS.has(t))) {
        if(!tags.has(t)) tags.set(t,[]); tags.get(t).push({j,i,r});
      }
    });
    const jobCount=items=>new Set(items.map(x=>x.j.id)).size;
    const order=[...tags.keys()].sort((a,b)=>jobCount(tags.get(b))-jobCount(tags.get(a)) || tags.get(b).filter(x=>x.r.level==='必需').length-tags.get(a).filter(x=>x.r.level==='必需').length || lexical(a,b));
    for(const t of order) {
      const first=new Map();
      for(const x of tags.get(t)) if(!used.has(x.j.id+':'+x.i) && !first.has(x.j.id)) first.set(x.j.id,x);
      if(first.size<2) continue;
      const rows=[...first.values()], reqs=rows.map(x=>x.r);
      for(const x of rows) used.add(x.j.id+':'+x.i);
      const rep=[...reqs].sort((a,b)=>(a.level!=='必需')-(b.level!=='必需') || a.item.length-b.item.length)[0];
      const cats=unique(reqs.map(r=>r.category)).sort((a,b)=>reqs.filter(r=>r.category===b).length-reqs.filter(r=>r.category===a).length);
      groups.push({item:rep.item,category:cats[0],level:reqs.filter(r=>r.level==='必需').length*2>=reqs.length?'必需':'加分',
        keywords:unique(reqs.flatMap(r=>list(r.keywords))).slice(0,12),count:first.size,tag:t,jobs:rows.map(x=>x.j.title),
        variants:unique(reqs.map(r=>r.item).filter(x=>x!==rep.item)).slice(0,3)});
    }
    groups.sort((a,b)=>b.count-a.count || (a.level!=='必需')-(b.level!=='必需'));
    const tools=new Map();
    for(const j of jobs) for(const t of list(j.tools)) {if(!tools.has(t)) tools.set(t,new Set());tools.get(t).add(j.id);}
    const ranked=[...tools].sort((a,b)=>b[1].size-a[1].size);
    return {id:'combo:'+jobs.map(j=>j.id).sort().join(','),title:`海投组合（${n} 个岗位）`,kind:'组合',aliases:[],
      majors:unique(jobs.flatMap(j=>list(j.majors))).slice(0,6),summary:'共同要求由程序统计：'+jobs.map(j=>j.title).join('、'),duties:[],
      requirements:groups.slice(0,12),tools:ranked.slice(0,10).map(x=>x[0]),tool_counts:ranked.slice(0,16).map(([name,ids])=>({name,count:ids.size})),
      certificates:unique(jobs.flatMap(j=>list(j.certificates))).slice(0,6),sources:jobs.flatMap(j=>list(j.sources).slice(0,1)).slice(0,6),city:'',education:'',
      combo:{n,jobs:jobs.map(({id,title})=>({id,title})),shared:groups.filter(g=>g.count===n).length,groups:groups.length}};
  }
  function schedule(data, daily, diagnosis, gaps) {
    const modules = list(data.modules).slice(0, 10).filter(m => m && clip(m.skill)).map(m => ({
      skill: clip(m.skill, 30), gap: clip(m.gap, 80), tools: strings(m.tools, 6, 30),
      tasks: list(m.tasks).slice(0, 10).filter(t => t && clip(t.title)).map(t => ({
        title: clip(t.title, 90), minutes: clamp(Math.trunc(number(t.minutes, 60)), 20, 240), output: clip(t.output, 90),
      })),
    })).filter(m => m.tasks.length);
    if (!modules.length) throw new Error('计划生成失败，请重试');
    const queue = [];
    for (const m of modules) for (const t of m.tasks) {
      const parts = Math.ceil(t.minutes / daily);
      for (let p = 0; p < parts; p++) queue.push({
        ...t, title: t.title + (parts > 1 ? `（${p + 1}/${parts}）` : ''),
        minutes: Math.max(20, Math.min(daily, t.minutes - p * daily)),
        output: p === parts - 1 ? t.output : '完成这一部分并记下卡住的地方', skill: m.skill, tools: m.tools,
      });
    }
    const fp = data.final_project || {}, days = [], used = new Map();
    const project = { title: clip(fp.title, 40) || `${diagnosis.job_title || '目标岗位'}综合小项目`,
      desc: clip(fp.desc, 160) || '把前面学到的技能串起来，做一个能写进简历的小作品',
      output: clip(fp.output, 90) || '可演示的作品和一页说明' };
    let rotate = 0;
    const tools = [...new Set(modules.flatMap(m => m.tools))];
    for (let day = 1; day <= 30; day++) {
      let type = '学习', theme, tasks;
      if (day === 30) {
        type = '面试'; theme = '更新简历 · 复诊 · 模拟面试';
        const half = Math.min(60, Math.floor(daily / 2));
        tasks = [{ title: '根据 30 天的成果更新简历，只写真实做到的内容', minutes: half, output: '新版简历，每项技能都能对应一个作品或任务' },
          { title: '重新做一次差距诊断，并完成一轮模拟面试', minutes: daily - half, output: '对比第 1 天的匹配度，记下还要继续补的项' }]
          .map(t => ({ ...t, skill: '求职准备', tools: [] }));
      } else if ([7, 14, 21, 28].includes(day)) {
        type = '复盘'; theme = '复盘与自测';
        const recent = [...new Set(days.slice(-6).flatMap(d => d.tasks.map(t => t.skill)))].filter(s => !['复盘', '求职准备', '综合项目'].includes(s)).sort();
        const topic = recent.slice(0, 3).join('、') || '本周内容', half = Math.floor(daily / 2);
        tasks = [{ title: `复盘本周：整理 ${topic} 的笔记和代码/作品`, minutes: half, output: '一页复盘：学会了什么、还卡在哪里' },
          { title: `不看笔记重做一遍本周最难的练习（${topic}）`, minutes: daily - half, output: '能独立完成，或写下具体卡点去问老师同学' }]
          .map(t => ({ ...t, skill: '复盘', tools: [] }));
      } else if ([26, 27, 29].includes(day)) {
        type = '项目'; theme = '综合项目';
        const i = [26, 27, 29].indexOf(day);
        const titles = [`综合项目设计：${project.title}，列出功能和要用的技能`, `综合项目实现：完成${project.title}的主要部分`, `综合项目收尾：测试、截图，写项目说明（${project.output}）`];
        tasks = [{ title: titles[i], minutes: daily, output: i === 2 ? project.output : '完成当天部分并提交到作品文件夹', skill: '综合项目', tools: tools.slice().sort().slice(0, 6) }];
      } else {
        let left = daily; tasks = [];
        while (queue.length && queue[0].minutes <= left && tasks.length < 3) {
          const t = queue.shift(); left -= t.minutes; tasks.push(t);
        }
        if (!tasks.length && queue.length) tasks.push({ ...queue.shift(), minutes: daily });
        if (!tasks.length) {
          const m = modules[rotate++ % modules.length];
          tasks.push({ title: `巩固练习：${m.skill}，独立重做一遍前面的练习并加一个新功能`, minutes: daily,
            output: '不看笔记完成，并能讲清每一步', skill: m.skill, tools: m.tools });
        }
        for (const t of tasks) {
          if (!used.has(t.skill)) used.set(t.skill, new Set());
          used.get(t.skill).add(day);
        }
        theme = [...new Set(tasks.map(t => t.skill))].join('、');
      }
      days.push({ day, week: Math.floor((day - 1) / 7) + 1, type, theme,
        tasks: tasks.map((t, i) => ({ ...t, id: `d${day}-${i}` })), minutes: tasks.reduce((n, t) => n + t.minutes, 0) });
    }
    return { daily_minutes: daily, days, skills: modules.map(m => ({ skill: m.skill, gap: m.gap, tools: m.tools, days: [...(used.get(m.skill) || [])] })),
      tools, certificates: gaps.some(g => g.category === '证书') ? list(diagnosis.job?.certificates).slice(0, 4) : [], project,
      unscheduled: queue.slice(0, 20).map(t => t.title), tips: strings(data.tips, 3, 80), job_title: diagnosis.job_title || '', created: new Date().toLocaleDateString('sv-SE') };
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
    configure({ key, baseURL = 'https://api.deepseek.com/v1', model = 'deepseek-chat', provider = 'openai' }) {
      const url = new URL(baseURL);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('接口地址必须是 HTTPS，且不能包含账号、密码、参数或片段');
      if (!key?.trim() || /[\r\n]/.test(key) || !model?.trim()) throw new Error('请填写有效的 API Key 和模型名称');
      this.disconnect();
      if (!['openai', 'anthropic'].includes(provider)) throw new Error('不支持的接口类型');
      this.#settings = { key: key.trim(), baseURL: url.href.replace(/\/$/, ''), model: model.trim(), provider };
      this.setStatus('configured');
    }
    disconnect() {
      this.#generation++;
      this.#controller?.abort();
      this.#settings = null;
      this.setStatus('disconnected');
    }
    get(path) {
      const url = new URL(path, 'https://local.invalid'), library = this.data.jobs || {}, jobs = list(library.jobs);
      if (url.pathname === '/api/majors') return { notice: library.notice || '', updated: library.updated || '', total_jobs: jobs.length,
        majors: list(library.majors).map(m => ({ ...m, count: jobs.filter(j => list(j.majors).includes(m.name)).length })) };
      if (url.pathname.startsWith('/api/jobs/')) {
        const id = decodeURIComponent(url.pathname.slice('/api/jobs/'.length));
        if (id === 'common') return combineJobs(jobs, (url.searchParams.get('ids') || '').split(','));
        if (id.startsWith('combo:')) return combineJobs(jobs, id.slice(6).split(','));
        const job = jobs.find(j => j.id === id);
        if (!job) throw new Error('岗位库里没有找到这个岗位，请重新选择');
        return structuredClone(job);
      }
      if (url.pathname === '/api/jobs') {
        const q = clip(url.searchParams.get('q'), 60).toLowerCase(), major = url.searchParams.get('major') || '';
        let qt = new Set(tokens(q).filter(t => t.length > 1));
        if (!qt.size) qt = new Set(tokens(q));
        const results = jobs.filter(j => !major || list(j.majors).includes(major)).map(j => {
          if (!q) return { job: j, score: 0 };
          const title = [j.title, ...list(j.aliases)].join(' ').toLowerCase();
          const body = [j.summary, ...list(j.majors), ...list(j.tools), ...list(j.requirements).flatMap(r => [r.item, ...list(r.keywords)])].join(' ').toLowerCase();
          const tt = new Set(tokens(title)), bt = new Set(tokens(body));
          let score = title.includes(q) ? 10 + ([j.title, ...list(j.aliases)].some(s => s.toLowerCase().startsWith(q)) ? 3 : 0) : body.includes(q) ? 4 : 0;
          for (const t of qt) score += (tt.has(t) ? 2 : 0) + (bt.has(t) ? 0.5 : 0);
          return { job: j, score };
        }).filter(x => !q || x.score >= Math.max(1.5, 0.5 * qt.size))
          .sort((a, b) => b.score - a.score || (a.job.kind !== '导入') - (b.job.kind !== '导入') || a.job.title.localeCompare(b.job.title, 'zh-CN'))
          .slice(0, 80).map(x => jobCard(x.job));
        return structuredClone({ results });
      }
      throw new Error('不支持的查询');
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
      const anthropic = settings.provider === 'anthropic';
      const response = await this.fetch(settings.baseURL + (anthropic ? '/messages' : '/chat/completions'), {
        method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/json', ...(anthropic ? { 'x-api-key': settings.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } : { Authorization: `Bearer ${settings.key}` }) },
        body: JSON.stringify({ model: settings.model, max_tokens: maxTokens, temperature, ...(anthropic ? { system, messages: [{ role: 'user', content: user }] } : { messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }) }),
        signal: this.#controller.signal,
      });
      if (this.#controller.signal.aborted) throw new Error('请求已取消');
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) this.setStatus('configured');
        const reason = { 401: '密钥无效，请检查后重新填写', 402: '模型账户余额不足，请前往服务商控制台检查', 403: '没有调用权限，请检查密钥与模型', 429: '模型接口限流，请稍后再试' }[response.status] || '请检查模型名称、接口地址，或稍后重试';
        throw new Error(`模型接口 HTTP ${response.status}：${reason}`);
      }
      const body = await response.json();
      const text = anthropic ? list(body?.content).filter(b => b.type === 'text').map(b => b.text).join('') : body?.choices?.[0]?.message?.content;
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
      if (kind === 'recommend') return this.recommend(body);
      if (kind === 'feedback') {
        if (!KINDS.has(body.kind) || !Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5) throw new Error('请先选择 1～5 星评分');
        let comment = mask(clip(body.comment, 200)).text;
        if (this.#settings) comment = comment.split(this.#settings.key).join('[已隐藏密钥]');
        this.records.add({ type: 'feedback', kind: body.kind, rating: body.rating, useful: typeof body.useful === 'boolean' ? body.useful : null, comment });
        return { ok: true };
      }
      if (!KINDS.has(kind) && !['test', 'resume_tips'].includes(kind)) throw new Error('不支持的功能');
      if (!this.#settings) throw new Error('请先连接模型，填写你自己的 API Key');
      if (this.#controller) throw new Error('正在处理上一个请求，请等待完成后再试');
      const generation = this.#generation, start = Date.now();
      this.#controller = new AbortController();
      const timeout = kind === 'plan' ? 120000 : 60000;
      const timer = setTimeout(() => this.#controller?.abort(), timeout);
      try {
        const result = kind === 'test' ? (await this.chat('这是连接测试，请只回复 OK。', 'OK', 8), { ok: true }) : await this[kind](body);
        if (generation !== this.#generation) throw new Error('请求已取消');
        const elapsed = Date.now() - start;
        if (KINDS.has(kind) || kind === 'resume_tips') this.record({ type: 'event', kind, ok: true, ms: elapsed, score: result.match_score ?? null });
        return { ...result, elapsed_ms: elapsed, demo: false };
      } catch (error) {
        if ((KINDS.has(kind) || kind === 'resume_tips') && generation === this.#generation) this.record({ type: 'event', kind, ok: false, ms: Date.now() - start, score: null });
        if (generation !== this.#generation) throw new Error('请求已取消');
        if (this.#controller.signal.aborted) throw new Error(`等待超过 ${timeout / 1000} 秒，请稍后重试；服务商可能已处理本次请求`);
        if (error instanceof TypeError) throw new Error('无法连接模型接口，请检查网络、接口地址及服务商是否允许浏览器跨域访问');
        throw error;
      } finally { clearTimeout(timer); this.#controller = null; }
    }
    async diagnose({ resume, jd, job_id }) {
      resume = clip(resume, RESUME_MAX); jd = clip(jd);
      if (norm(resume).length < 30 || (!job_id && norm(jd).length < 20)) throw new Error('简历至少 30 字、招聘信息至少 20 字');
      const job = job_id ? this.get('/api/jobs/' + encodeURIComponent(job_id)) : null;
      const masked = mask(resume), refs = this.search(job ? job.title + ' ' + list(job.tools).slice(0, 5).join(' ') : mask(jd).text, 3);
      const lines = job ? list(job.requirements).map((r, i) => {
        const hits = list(r.keywords).filter(k => k && mentions(k, masked.text.toLowerCase())).slice(0, 6);
        const share = r.count && job.combo ? `·${r.count}/${job.combo.n}个岗位要求` : '';
        return `${i + 1}. [${r.level}·${r.category}${share}] ${r.item}（简历中出现的相关词：${hits.join('、') || '无'}）`;
      }).join('\n') : '';
      const user = (job ? `【岗位】${job.title}：${job.summary}\n【岗位要求】\n${lines}` : `【招聘信息】\n${mask(jd).text}`)
        + `\n\n【简历】\n${masked.text}\n\n【参考资料】\n${refsText(refs) || '（无）'}`;
      const data = extractJSON(await this.chat(job ? this.data.prompts.DIAGNOSE_JOB : this.data.prompts.DIAGNOSE, user, job ? 3000 : 2500));
      if (job) {
        const byNumber = new Map(list(data.results).filter(r => r && Number.isInteger(Number(r.n))).map(r => [Number(r.n), r]));
        data.requirements = job.requirements.map((r, i) => {
          const got = byNumber.get(i + 1) || {};
          return { ...r, status: got.status, evidence: got.evidence, advice: got.advice || '先补这一项的基础，再做一个能展示的小练习' };
        });
        data.job_title = job.title;
      }
      let flagged = 0;
      const requirements = list(data.requirements).slice(0, 15).filter(r => r && clip(r.item)).map(r => {
        let status = Object.hasOwn(STATUS, r.status) ? r.status : '缺少';
        let evidence = clip(r.evidence), note = '';
        const verified = !!evidence && norm(masked.text).includes(norm(evidence));
        if (evidence && !verified) { flagged++; evidence = ''; note = '模型给出的依据在简历中找不到原文，已降级处理'; }
        if (!evidence && status === '具备') { status = '部分具备'; note ||= '简历中没有找到明确依据'; }
        const category = OLD_CATS[r.category] || r.category;
        return { item: clip(r.item, 80), category: CATS.has(category) ? category : '专业技能', level: Object.hasOwn(WEIGHT, r.level) ? r.level : '必需', status, count: Number.isInteger(r.count) ? r.count : null, evidence: evidence.slice(0, 200), verified, note, advice: clip(r.advice, 80) };
      });
      if (!requirements.length) throw new Error('没有识别出岗位要求，请检查招聘信息后重试');
      const counts = Object.fromEntries(Object.keys(STATUS).map(s => [s, requirements.filter(r => r.status === s).length]));
      const score = Math.round(100 * requirements.reduce((s, r) => s + STATUS[r.status] * WEIGHT[r.level], 0) / requirements.reduce((s, r) => s + WEIGHT[r.level], 0));
      return { job_title: clip(data.job_title || '目标岗位', 40), summary: clip(data.summary, 300), requirements: requirements.sort((a, b) => STATUS[a.status] - STATUS[b.status] || WEIGHT[b.level] - WEIGHT[a.level]), counts, match_score: score,
        must_gaps: requirements.filter(r => r.level === '必需' && r.status === '缺少').length,
        strengths: strings(data.strengths, 3, 80), honesty_notes: strings(data.honesty_notes, 5, 120), standard_note: clip(data.standard_note, 200), references: refs, privacy: masked.counts, unverified_evidence: flagged,
        source: job ? { type: 'job', id: job.id, kind: job.kind, sources: list(job.sources).slice(0, 3), ...(job.combo ? {combo:job.combo} : {}) } : { type: 'paste' },
        ...(job ? { job: { id: job.id, title: job.title, tools: job.tools, certificates: job.certificates } } : {}) };
    }
    async plan({ diagnosis, daily_hours }) {
      const daily = clamp(Math.round(number(daily_hours, 2) * 2) / 2, 1, 4) * 60;
      const rank = { '必需缺少': 0, '必需部分具备': 1, '加分缺少': 2, '加分部分具备': 3 };
      const gaps = list(diagnosis?.requirements).filter(r => r.status !== '具备').map(({ item, category, level = '必需', status, advice, count }) => ({ item, category, level, status, advice, count }))
        .sort((a, b) => (rank[a.level + a.status] ?? 4) - (rank[b.level + b.status] ?? 4) || (b.count || 0) - (a.count || 0));
      if (!gaps.length) throw new Error('请先完成一次包含待补差距的诊断');
      const brief = JSON.stringify({ job_title: diagnosis.job_title, job_tools: list(diagnosis.job?.tools).slice(0, 12), gaps: gaps.slice(0, 10) });
      const data = extractJSON(await this.chat(this.data.prompts.PLAN30, `每天可用时间：${daily} 分钟\n学习日共 22 天，学习日总时长约 ${daily * 22} 分钟\n差距诊断：${brief}`, 4000));
      return schedule(data, daily, diagnosis, gaps);
    }
    recommend({resume}) {
      resume=clip(resume, RESUME_MAX); if(norm(resume).length<30) throw new Error('简历至少 30 字，才能推荐岗位');
      const masked=mask(resume),low=masked.text.toLowerCase();
      const results=list(this.data.jobs?.jobs).map(j=>{
        let total=0,hit=0;const hits=[],missing=[];
        for(const r of list(j.requirements)) {
          const weight=r.level==='必需'?2:1;total+=weight;
          const found=list(r.keywords).filter(k=>mentions(k,low));
          if(found.length){hit+=weight;hits.push(...found.slice(0,2));}else if(r.level==='必需') missing.push(r.item);
        }
        return {...jobCard(j),score:total?Math.round(100*hit/total):0,major_hit:list(j.majors).find(m=>masked.text.includes(m)) || '',hits:unique(hits).slice(0,8),missing:missing.slice(0,3)};
      }).sort((a,b)=>(b.score+(b.major_hit?8:0))-(a.score+(a.major_hit?8:0)) || lexical(a.title,b.title)).slice(0,8);
      return {results,privacy:masked.counts,method:'按简历中出现的岗位关键词粗略匹配（必需项权重 2、加分项 1），只用于挑选候选岗位，准确对照请做差距诊断'};
    }
    async resume_tips({resume,diagnosis}) {
      resume=clip(resume, RESUME_MAX);if(norm(resume).length<30) throw new Error('请先在诊断页填写简历（至少 30 字）');
      const reqs=list(diagnosis?.requirements).filter(r=>r && typeof r==='object').slice(0,15);
      if(!reqs.length) throw new Error('请先完成一次差距诊断');
      const masked=mask(resume).text;
      const brief=mask(JSON.stringify({job_title:diagnosis.job_title,requirements:reqs.map(({item,status,level,evidence})=>({item,status,level,evidence}))})).text;
      const data=extractJSON(await this.chat(this.data.prompts.RESUME_TIPS,`【目标岗位与诊断】\n${brief}\n\n【简历】\n${masked}`,2500));
      const numbers=new Set(masked.match(/\d+(?:\.\d+)?/g)||[]),rewrites=[];let dropped=0;
      for(const t of list(data.rewrites).slice(0,8)) {
        if(!t || typeof t!=='object')continue;
        const original=clip(t.original),rewrite=clip(t.rewrite);
        if(!original || !rewrite || !norm(masked).includes(norm(original))){dropped++;continue;}
        let blanks=false;
        const checked=rewrite.replace(/\d+(?:\.\d+)?/g,n=>{if(numbers.has(n))return n;blanks=true;return '（填写真实数字）';});
        rewrites.push({original:original.slice(0,200),rewrite:checked.slice(0,260),requirement:clip(t.requirement,80),why:clip(t.why,100),blanks});
      }
      const questions=strings(data.questions,5,100).filter(Boolean);
      if(!rewrites.length && !questions.length)throw new Error('没有生成可用的建议，请重试');
      return {rewrites,questions,dropped,note:'改写只调整表达方式，不添加简历里没有的经历；括号里的空需要你按真实情况填写。'};
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

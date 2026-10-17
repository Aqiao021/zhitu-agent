const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Client, Records, mask, extractJSON } = require('../web/browser-client.js');

const data = {
  prompts: Object.fromEntries(['DIAGNOSE', 'DIAGNOSE_JOB', 'PLAN30', 'INTERVIEW_Q', 'INTERVIEW_END', 'ASK', 'RESUME_TIPS'].map(k => [k, k])),
  documents: [{ title: '职业标准', source: '官方' }],
  chunks: [{ title: '职业标准', section: '申报条件（初级）', text: '大专毕业工作满一年可申报初级。Python 技能。', source: '官方', url: 'https://example.org', date: '2026' }],
};
const resume = '会使用 Python 写简单脚本，了解 Git 基本操作，做过校园问答小程序。电话 13800001234';
const jd = '开发实习岗位要求熟悉 Python、Git，了解 Linux 命令，能够说明项目过程。';
const diagnosisReply = { job_title: '开发实习生', requirements: [
  { item: 'Python', status: '具备', evidence: '会使用 Python 写简单脚本' },
  { item: 'Linux', status: '具备', evidence: '精通 Linux 运维' },
  { item: 'Git', status: '具备', evidence: '' },
] };
function memoryStorage() {
  const values = new Map();
  return { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), values };
}
function setup(reply = diagnosisReply, extra = {}) {
  const calls = [], storage = memoryStorage();
  const client = new Client({ data: { ...data, ...extra }, storage, fetch: async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ choices: [{ message: { content: typeof reply === 'string' ? reply : JSON.stringify(reply) } }] }) };
  } });
  client.configure({ key: 'synthetic-test-credential', baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-chat' });
  return { client, calls, storage };
}
test('diagnosis masks identifiers, verifies quotes and computes its own score', async () => {
  const { client, calls } = setup();
  const result = await client.request('/api/diagnose', { resume, jd });
  assert.equal(result.match_score, 67);
  assert.equal(result.unverified_evidence, 1);
  assert.equal(result.requirements.find(x => x.item === 'Linux').evidence, '');
  assert.equal(result.requirements.find(x => x.item === 'Git').status, '部分具备');
  assert.equal(result.privacy['手机号'], 1);
  assert.ok(!calls[0].options.body.includes('13800001234'));
  assert.equal(calls[0].options.redirect, 'error');
});
test('keys stay out of storage and reports, disconnect blocks further network calls', async () => {
  const { client, storage, calls } = setup();
  assert.equal(client.status, 'configured');
  await client.request('/api/diagnose', { resume, jd });
  assert.equal(client.status, 'connected');
  assert.ok(!JSON.stringify([...storage.values]).includes('synthetic-test-credential'));
  assert.ok(!new Records(storage).csv().includes('synthetic-test-credential'));
  client.disconnect();
  await assert.rejects(client.request('/api/ask', { question: 'Python' }), /连接模型/);
  assert.equal(calls.length, 1);
});
test('settings reject insecure endpoints, embedded credentials and request header injection', () => {
  const { client } = setup();
  for (const baseURL of ['http://example.org/v1', 'https://user:pass@example.org', 'https://example.org?key=x']) {
    assert.throws(() => client.configure({ key: 'test', baseURL, model: 'm' }));
  }
  assert.throws(() => client.configure({ key: 'test\r\nInjected: yes', baseURL: 'https://example.org', model: 'm' }));
});
test('30-day plan fits every daily budget, reserves reviews/projects and persists task ids', async () => {
  for (const daily_hours of [1, 1.5, 2, 3, 4]) {
    const { client } = setup({ modules: [{ skill: 'Linux', tools: ['终端'], tasks: [{ title: '命令练习', minutes: 240, output: '独立演示' }] }] });
    const result = await client.request('/api/plan', { diagnosis: { requirements: [{ item: 'Linux', status: '缺少' }] }, daily_hours });
    assert.equal(result.days.length, 30);
    assert.equal(result.daily_minutes, daily_hours * 60);
    assert.ok(result.days.every(d => d.tasks.length && d.minutes <= result.daily_minutes && d.minutes === d.tasks.reduce((n, t) => n + t.minutes, 0)));
    assert.deepEqual(result.days.filter(d => d.type === '复盘').map(d => d.day), [7, 14, 21, 28]);
    assert.deepEqual(result.days.filter(d => d.type === '项目').map(d => d.day), [26, 27, 29]);
    assert.equal(result.days[29].type, '面试');
    assert.equal(new Set(result.days.flatMap(d => d.tasks.map(t => t.id))).size, result.days.flatMap(d => d.tasks).length);
    assert.deepEqual(result.tools, ['终端']);
  }
});

test('job library browses and filters without a key or network call', () => {
  const jobs = require('../kb/jobs.json');
  const { client, calls } = setup({}, { jobs });
  client.disconnect();
  const majors = client.get('/api/majors');
  assert.equal(majors.total_jobs, 45);
  assert.equal(majors.majors.length, 19);
  assert.ok(majors.majors.every(m => m.count >= 1));
  assert.ok(client.get('/api/jobs?q=' + encodeURIComponent('会计')).results[0].title.startsWith('会计'));
  assert.ok(client.get('/api/jobs?major=' + encodeURIComponent('软件技术')).results.every(j => j.majors.includes('软件技术')));
  assert.deepEqual(client.get('/api/jobs?q=' + encodeURIComponent('完全不存在的岗位xyz')).results, []);
  assert.equal(client.get('/api/jobs/ai_app_dev_assistant').id, 'ai_app_dev_assistant');
  assert.throws(() => client.get('/api/jobs/nope'), /没有找到/);
  assert.equal(calls.length, 0);
});

test('library diagnosis keeps authoritative requirements, weights levels and rejects invented evidence', async () => {
  const jobs = { majors: [], jobs: [{ id: 'dev', title: '开发岗位', kind: '画像', summary: '', tools: ['Git'], certificates: [], sources: [{ title: '课程', url: 'https://example.org' }], requirements: [
    { item: 'Python', category: '专业技能', level: '必需', keywords: ['Python'] },
    { item: 'Linux', category: '软件工具', level: '加分', keywords: ['Linux'] },
  ] }] };
  const { client, calls } = setup({ results: [
    { n: 1, status: '具备', evidence: '会使用 Python 写简单脚本' },
    { n: 2, status: '具备', evidence: '编造的经历' },
    { n: 99, status: '具备', evidence: 'Python' },
  ] }, { jobs });
  const result = await client.request('/api/diagnose', { resume, job_id: 'dev' });
  assert.equal(result.match_score, 83);
  assert.equal(result.requirements.length, 2);
  assert.equal(result.unverified_evidence, 1);
  assert.equal(result.source.id, 'dev');
  assert.equal(result.job.title, '开发岗位');
  assert.ok(!calls[0].options.body.includes('13800001234'));
  assert.ok(calls[0].options.body.includes('简历中出现的相关词：Python'));
});

test('Anthropic requests use Messages format and keep credentials out of storage', async () => {
  const { client, storage, calls } = setup();
  client.configure({ key: 'synthetic-test-credential', provider: 'anthropic', baseURL: 'https://api.anthropic.com/v1', model: 'test-model' });
  client.fetch = async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'OK' }] }) }; };
  await client.request('/api/key/test');
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(calls[0].options.headers['anthropic-dangerous-direct-browser-access'], 'true');
  const body = JSON.parse(calls[0].options.body);
  assert.ok(body.system.includes('连接测试'));
  assert.equal(body.messages[0].role, 'user');
  assert.ok(!JSON.stringify([...storage.values]).includes('synthetic-test-credential'));
});
test('interview masks answers and constrains evaluation scores', async () => {
  const { client, calls } = setup({ scores: { '专业知识': 100, '沟通表达': 'bad' } });
  const result = await client.request('/api/interview', { diagnosis: { requirements: [] }, rounds: 3, history: Array.from({ length: 3 }, () => ({ q: '介绍项目', a: '联系我 13800001234' })) });
  assert.equal(result.done, true);
  assert.equal(result.scores['专业知识'], 5);
  assert.equal(result.scores['沟通表达'], 3);
  assert.ok(!calls[0].options.body.includes('13800001234'));
});
test('questions retrieve sourced knowledge and strip nonexistent citations', async () => {
  const { client } = setup('大专毕业工作满一年可申报初级 [1]。另见 [99]。');
  const result = await client.request('/api/ask', { question: '大专毕业多久可以申报初级？' });
  assert.equal(result.grounded, true);
  assert.equal(result.references[0].n, 1);
  assert.ok(!result.answer.includes('[99]'));
});
test('HTTP authentication errors are safe, not retried and not marked connected', async () => {
  const { client, calls } = setup();
  client.fetch = async () => { calls.push(1); return { ok: false, status: 401, json: async () => ({ error: { message: 'synthetic-test-credential' } }) }; };
  await assert.rejects(client.request('/api/ask', { question: 'Python' }), e => /401/.test(e.message) && !e.message.includes('synthetic-test-credential'));
  assert.equal(calls.length, 1);
  assert.notEqual(client.status, 'connected');
});
test('only one request can run and it cannot reconnect after disconnect', async () => {
  const { client } = setup();
  let release;
  client.fetch = () => new Promise(resolve => { release = resolve; });
  const first = client.request('/api/ask', { question: 'Python' });
  await assert.rejects(client.request('/api/ask', { question: 'Python' }), /正在处理/);
  client.disconnect();
  release({ ok: true, json: async () => ({ choices: [{ message: { content: '回答 [1]' } }] }) });
  await assert.rejects(first, /取消/);
  assert.equal(client.status, 'disconnected');
});
test('usage survives creating a new client; CSV neutralizes spreadsheet formulas', async () => {
  const { client, storage } = setup();
  await client.request('/api/diagnose', { resume, jd });
  await client.request('/api/feedback', { kind: 'diagnose', rating: 5, useful: true, comment: '=HYPERLINK("https://example.org")' });
  const records = new Records(storage);
  assert.equal(records.stats().events.diagnose.count, 1);
  assert.equal(records.stats().feedback.diagnose.avg_rating, 5);
  assert.ok(records.csv().includes("'=HYPERLINK"));
  assert.ok(!JSON.stringify([...storage.values]).includes('13800001234'));
});
test('a late authentication error cannot restore status after the key is cleared', async () => {
  const { client } = setup();
  let release;
  client.fetch = () => new Promise(resolve => { release = resolve; });
  const pending = client.request('/api/ask', { question: 'Python' });
  client.disconnect();
  release({ ok: false, status: 401 });
  await assert.rejects(pending, /取消/);
  assert.equal(client.status, 'disconnected');
});
test('malformed structured replies fail clearly, fenced JSON tolerates braces inside strings', () => {
  assert.deepEqual(extractJSON('```json\n{"x":"a}b"}\n```'), { x: 'a}b' });
  assert.throws(() => extractJSON('{"x":'), /结构化/);
  assert.throws(() => extractJSON('null'), /结构化/);
});
test('privacy rules cover all identifier types without hiding ordinary years', () => {
  const { text, counts } = mask('2026级，身份证350602200501011234，电话13800001234，邮箱a.b@qq.com，微信号：lin_2026ab，住址：漳州市芗城区某路1号');
  assert.equal(Object.keys(counts).length, 5);
  assert.ok(text.includes('2026级'));
  for (const secret of ['350602200501011234', '13800001234', 'a.b@qq.com', 'lin_2026ab', '某路1号']) assert.ok(!text.includes(secret));
});


test('common requirements work offline and carry counts into diagnosis', async () => {
  const ids=['ai_app_dev_assistant','llm_agent_app_developer_junior','data_analyst_assistant','ai_trainer_annotator'];
  const {client,calls}=setup({results:[{n:1,status:'缺少'}]},{jobs:require('../kb/jobs.json')});client.disconnect();
  const c=client.get('/api/jobs/common?ids='+encodeURIComponent([...ids,ids[0],'unknown'].join(',')));
  assert.equal(c.combo.n,4);assert.equal(c.requirements[0].tag,'python');assert.equal(c.requirements[0].count,4);
  assert.ok(c.requirements.every(r=>r.count>=2 && r.count<=4));
  assert.deepEqual(c.requirements.map(r=>r.count),c.requirements.map(r=>r.count).sort((a,b)=>b-a));
  assert.equal(client.get('/api/jobs/'+encodeURIComponent(c.id)).combo.n,4);
  assert.throws(()=>client.get('/api/jobs/common?ids='+ids[0]),/至少.*2/);assert.equal(calls.length,0);
  client.configure({key:'synthetic-test-credential',model:'deepseek-chat'});
  const d=await client.request('/api/diagnose',{resume,job_id:c.id});
  assert.equal(d.source.combo.n,4);assert.ok(d.requirements.every(r=>Number.isInteger(r.count)));
  assert.ok(calls[0].options.body.includes('/4个岗位要求'));
});

test('recommendation needs no key or network and does not persist resume',async()=>{
  const {client,calls,storage}=setup({},{jobs:require('../kb/jobs.json')});client.disconnect();
  const r=await client.request('/api/recommend',{resume:'大数据与会计专业，考过初级会计，会用用友U8和金蝶做账，熟练 Excel 数据透视表和 VLOOKUP，在代账公司实习，负责开票和报税。电话 13800001234'});
  assert.equal(r.results[0].id,'accounting_assistant');assert.equal(r.results.length,8);assert.equal(r.privacy['手机号'],1);
  assert.ok(r.results.every(x=>x.score>=0 && x.score<=100));assert.equal(calls.length,0);assert.equal(client.status,'disconnected');assert.equal(storage.values.size,0);
  await assert.rejects(client.request('/api/recommend',{resume:'太短'}),/30/);
  const tiny={jobs:[{id:'ps',title:'PS',requirements:[{keywords:['PS'],level:'必需'}]},{id:'ae',title:'AE',requirements:[{keywords:['AE'],level:'必需'}]}]};
  const safe=await setup({},{jobs:tiny}).client.request('/api/recommend',{resume:'了解 https 协议，参加校园项目开发与测试，能清楚讲解自己负责的具体过程和结果。'});
  assert.ok(safe.results.every(x=>x.score===0));
});

test('resume tips verify original quotes, mask identifiers and blank invented numbers',async()=>{
  const reply={rewrites:[{original:'会使用 Python 写简单脚本',rewrite:'使用 Python 完成 3000 条记录清洗',requirement:'Python'},{original:'在字节跳动实习半年',rewrite:'编造实习'}],questions:['项目负责哪部分？']};
  const {client,calls,storage}=setup(reply);
  const r=await client.request('/api/resume_tips',{resume,diagnosis:{job_title:'开发',requirements:[{item:'Python',status:'具备'}]}});
  assert.equal(r.dropped,1);assert.equal(r.rewrites.length,1);assert.ok(r.rewrites[0].blanks);
  assert.ok(r.rewrites[0].rewrite.includes('（填写真实数字）'));assert.ok(!r.rewrites[0].rewrite.includes('3000'));
  assert.ok(!calls[0].options.body.includes('13800001234'));assert.ok(!JSON.stringify([...storage.values]).includes('会使用 Python'));
  await assert.rejects(client.request('/api/resume_tips',{resume,diagnosis:{}}),/先完成/);
});

test('plan orders shared gaps first within equal priority',async()=>{
  const {client,calls}=setup({modules:[{skill:'Python',tasks:[{title:'练习',minutes:60}]}]});
  await client.request('/api/plan',{daily_hours:1,diagnosis:{requirements:[{item:'单项',level:'必需',status:'缺少',count:2},{item:'共同项',level:'必需',status:'缺少',count:5},{item:'加分',level:'加分',status:'缺少',count:10}]}});
  const user=JSON.parse(calls[0].options.body).messages[1].content;
  assert.ok(user.indexOf('共同项')<user.indexOf('单项'));assert.ok(user.includes('"count":5'));
});


test('short keyword punctuation is literal and does not become a regular expression',async()=>{
  const jobs={jobs:[{id:'cpp',title:'C++',requirements:[{keywords:['C++'],level:'必需'}]},{id:'net',title:'.NET',requirements:[{keywords:['C#'],level:'必需'}]}]};
  const {client}=setup({},{jobs});
  const r=await client.request('/api/recommend',{resume:'会用 C++ 编写小型程序，并在课程项目里使用 C# 完成业务练习，能够介绍具体的开发过程。'});
  assert.ok(r.results.every(x=>x.score===100));
});


test('successful resume optimization is included in local usage totals',async()=>{
  const {client,storage}=setup({rewrites:[],questions:['你具体负责哪部分？']});
  await client.request('/api/resume_tips',{resume,diagnosis:{requirements:[{item:'Python',status:'具备'}]}});
  assert.equal(new Records(storage).stats().events.resume_tips.count,1);
});

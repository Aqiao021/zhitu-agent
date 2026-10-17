const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Client, Records, mask, extractJSON } = require('../web/browser-client.js');

const data = {
  prompts: Object.fromEntries(['DIAGNOSE', 'DIAGNOSE_JOB', 'PLAN30', 'INTERVIEW_Q', 'INTERVIEW_END', 'ASK'].map(k => [k, k])),
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
  assert.equal(majors.total_jobs, 35);
  assert.equal(majors.majors.length, 14);
  assert.ok(majors.majors.every(m => m.count >= 3));
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

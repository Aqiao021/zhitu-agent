const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Client, Records, mask, extractJSON } = require('../web/browser-client.js');

const data = {
  prompts: Object.fromEntries(['DIAGNOSE', 'PLAN', 'INTERVIEW_Q', 'INTERVIEW_END', 'ASK'].map(k => [k, k])),
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
function setup(reply = diagnosisReply) {
  const calls = [], storage = memoryStorage();
  const client = new Client({ data, storage, fetch: async (url, options) => {
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
test('plan never exceeds the chosen time, including minimum size tasks', async () => {
  const { client } = setup({ weeks: [{ goal: '练习', tasks: Array.from({ length: 5 }, (_, i) => ({ task: '任务' + i, hours: i ? 0.5 : 40 })) }] });
  const result = await client.request('/api/plan', { diagnosis: { requirements: [{ item: 'Linux', status: '缺少' }] }, weekly_hours: 3 });
  assert.ok(result.weeks[0].hours <= 3);
  assert.ok(result.weeks[0].tasks.every(t => t.hours >= 0.5));
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

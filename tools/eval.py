"""系统测试：用 tools/testset.json 里的虚构简历跑一遍诊断（和 30 天计划），统计可靠性指标。

用法（在项目根目录）：
    python tools/eval.py            # 诊断全部用例，前 4 个用例再生成 30 天计划
    python tools/eval.py --plan 0   # 只测诊断
    python tools/eval.py --plan 12 --hours 2

结果写到 data/eval_日期时间.md 和 .csv。没有配置 API Key 时使用演示规则模型，结果只能用来检查流程。
"""
import argparse
import csv
import json
import statistics
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from zhitu import config as config_mod  # noqa: E402
from zhitu.agent import Agent  # noqa: E402
from zhitu.demo import DemoLLM  # noqa: E402
from zhitu.jobs import JobDB  # noqa: E402
from zhitu.kb import KnowledgeBase  # noqa: E402
from zhitu.llm import LLM, ModelError  # noqa: E402

RANK = {"缺少": 0, "部分具备": 1, "具备": 2}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", type=int, default=4, help="前几个用例生成 30 天计划（较慢），0 表示不测")
    ap.add_argument("--hours", type=float, default=2, help="计划的每天可用小时数")
    args = ap.parse_args()

    cfg = config_mod.load()
    llm = DemoLLM() if cfg.demo else LLM(cfg)
    jobs = JobDB(ROOT / "kb" / "jobs.json", ":memory:")
    agent = Agent(llm, KnowledgeBase(ROOT / "kb"), jobs)
    data = json.loads((ROOT / "tools" / "testset.json").read_text(encoding="utf-8"))
    model = "演示规则模型（未配置 API Key，结果只用于检查流程）" if cfg.demo else f"{cfg.provider} · {cfg.model}"
    print(f"模型：{model}\n用例：{len(data['cases'])} 个\n")

    rows, labels_total, exact, direction = [], 0, 0, 0
    plan_rows = []
    for i, c in enumerate(data["cases"]):
        job = jobs.get(c["job_id"])
        t0 = time.time()
        try:
            d = agent.diagnose(c["resume"], job_id=c["job_id"])
            ok, err = True, ""
        except ModelError as e:
            d, ok, err = None, False, str(e)
        ms = int((time.time() - t0) * 1000)
        agree = []
        if d:
            by_item = {r["item"]: r["status"] for r in d["requirements"]}
            for lab in c["labels"]:
                got = by_item.get(job["requirements"][lab["n"]]["item"], "缺少")
                labels_total += 1
                exact += got == lab["expect"]
                direction += (RANK[got] == 0) == (RANK[lab["expect"]] == 0)  # 缺少 vs 不缺少
                agree.append(f"{lab['n']}:{lab['expect']}→{got}")
        rows.append({"id": c["id"], "desc": c["desc"], "job": job["title"], "ok": ok, "ms": ms,
                     "score": d["match_score"] if d else "", "unverified": d["unverified_evidence"] if d else "",
                     "labels": "；".join(agree), "error": err})
        print(f"{c['id']} {'成功' if ok else '失败'} {ms / 1000:.1f}s 匹配度 {rows[-1]['score']} 拦截编造依据 {rows[-1]['unverified']} {err}")

        if d and i < args.plan:
            t1 = time.time()
            try:
                p = agent.plan(d, args.hours)
                budget = p["daily_minutes"]
                over = [day["day"] for day in p["days"] if day["minutes"] > budget]
                plan_rows.append({"id": c["id"], "ok": True, "ms": int((time.time() - t1) * 1000), "days": len(p["days"]),
                                  "over_budget_days": len(over), "unscheduled": len(p["unscheduled"]),
                                  "modules": len(p["skills"]), "tools": "、".join(p["tools"][:6]), "error": ""})
            except ModelError as e:
                plan_rows.append({"id": c["id"], "ok": False, "ms": int((time.time() - t1) * 1000), "days": 0,
                                  "over_budget_days": "", "unscheduled": "", "modules": 0, "tools": "", "error": str(e)})
            print(f"   30 天计划 {'成功' if plan_rows[-1]['ok'] else '失败'} {plan_rows[-1]['ms'] / 1000:.1f}s "
                  f"超时天数 {plan_rows[-1]['over_budget_days']} {plan_rows[-1]['error']}")

    okn = sum(r["ok"] for r in rows)
    times = [r["ms"] for r in rows if r["ok"]]
    stamp = time.strftime("%Y%m%d_%H%M")
    out = ROOT / "data"
    out.mkdir(exist_ok=True)
    md = [f"# 职途助手系统测试报告（{time.strftime('%Y-%m-%d %H:%M')}）", "",
          f"- 模型：{model}", f"- 测试数据：{len(rows)} 份**虚构**测试简历（tools/testset.json），不是真实用户数据", "",
          "## 差距诊断", "",
          f"- 成功率：{okn}/{len(rows)}（{okn / len(rows) * 100:.0f}%）",
          f"- 平均耗时：{statistics.mean(times) / 1000:.1f} 秒" if times else "- 平均耗时：—",
          f"- 与人工判断完全一致：{exact}/{labels_total}（{exact / labels_total * 100:.0f}%）" if labels_total else "- 与人工判断一致：—",
          f"- “缺少 / 不缺少”方向一致：{direction}/{labels_total}（{direction / labels_total * 100:.0f}%）" if labels_total else "",
          f"- 模型给出、但在简历里找不到原文而被程序拦下的依据：共 {sum(r['unverified'] or 0 for r in rows)} 条", "",
          "| 用例 | 说明 | 岗位 | 结果 | 耗时(秒) | 匹配度 | 拦截 | 人工标注 → 系统判断 |", "|---|---|---|---|---|---|---|---|"]
    md += [f"| {r['id']} | {r['desc']} | {r['job']} | {'成功' if r['ok'] else '失败：' + r['error']} | {r['ms'] / 1000:.1f} | {r['score']} | {r['unverified']} | {r['labels']} |" for r in rows]
    if plan_rows:
        pok = sum(r["ok"] for r in plan_rows)
        md += ["", "## 30 天计划", "",
               f"- 成功率：{pok}/{len(plan_rows)}",
               f"- 每天任务超出设定时长的天数：{sum(r['over_budget_days'] or 0 for r in plan_rows)}（程序排期保证应为 0）",
               f"- 平均耗时：{statistics.mean([r['ms'] for r in plan_rows if r['ok']]) / 1000:.1f} 秒" if pok else "",
               "", "| 用例 | 结果 | 耗时(秒) | 天数 | 超时天数 | 未排入任务 | 学习模块 | 主要软件 |", "|---|---|---|---|---|---|---|---|"]
        md += [f"| {r['id']} | {'成功' if r['ok'] else '失败：' + r['error']} | {r['ms'] / 1000:.1f} | {r['days']} | {r['over_budget_days']} | {r['unscheduled']} | {r['modules']} | {r['tools']} |" for r in plan_rows]
    (out / f"eval_{stamp}.md").write_text("\n".join(x for x in md if x is not None), encoding="utf-8")
    with open(out / f"eval_{stamp}.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print(f"\n报告已保存：data/eval_{stamp}.md 和 data/eval_{stamp}.csv")


if __name__ == "__main__":
    main()

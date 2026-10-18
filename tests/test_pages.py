import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class PagesBuildTest(unittest.TestCase):
    def test_only_public_assets_are_packaged_and_all_routes_are_relative(self):
        spec = importlib.util.spec_from_file_location("build_pages", ROOT / "scripts" / "build_pages.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "site"
            module.build(out, "https://example.github.io/zhitu-agent/")
            names = {p.name for p in out.iterdir()}
            self.assertTrue({"index.html", "stats.html", "model-data.json", "browser-client.js", ".nojekyll"} <= names)
            self.assertTrue(names.isdisjoint({"config.json", "server.py", "zhitu.db", ".git"}))
            html = (out / "index.html").read_text(encoding="utf-8")
            self.assertIn('data-mode="static"', html)
            self.assertIn('https://example.github.io/zhitu-agent/og-cover.jpg', html)
            self.assertIn('name="robots"', html)
            self.assertIn('Content-Security-Policy', html)
            self.assertNotIn('href="/stats', html)
            stats = (out / "stats.html").read_text(encoding="utf-8")
            self.assertNotIn('href="/', stats)
            data = json.loads((out / "model-data.json").read_text(encoding="utf-8"))
            self.assertEqual(len(data["jobs"]["jobs"]), 45)
            self.assertEqual(len(data["jobs"]["majors"]), 19)
            self.assertIn("DIAGNOSE_JOB", data["prompts"])
            self.assertIn("PLAN30", data["prompts"])
            self.assertIn("RESUME_TIPS", data["prompts"])
            self.assertTrue(all("api_key" not in p for p in data["providers"]))
            deepseek = next(p for p in data["providers"] if p["id"] == "deepseek")
            self.assertEqual(deepseek["model"], "deepseek-chat")
            self.assertIn('<script src="browser-client.js">', html)
            self.assertIn('<script src="browser-extract.js">', html)
            self.assertTrue((out / "browser-extract.js").is_file())
            self.assertIn('href="stats.html"', html)
            image_names = {p.name for p in (out / "img").iterdir()}
            self.assertTrue({"hero-illustration.jpg", "train.png", "empty-job.png", "empty-search.png", "empty-done.png"} <= image_names)
            self.assertIn('id="heroMap"', html)
            self.assertIn('data-src="img/hero-illustration.jpg"', html)


if __name__ == "__main__":
    unittest.main()

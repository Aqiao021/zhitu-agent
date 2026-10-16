import importlib.util
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


if __name__ == "__main__":
    unittest.main()

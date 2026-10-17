"""Package a credential-free GitHub Pages site using only Python's standard library."""
import argparse
import html
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from zhitu import prompts
from zhitu.kb import KnowledgeBase
from zhitu.jobs import normalize
from zhitu.userkey import PROVIDERS

ASSETS = ("index.html", "stats.html", "app.js", "stats.js", "browser-client.js", "browser-ui.js", "styles.css",
          "favicon.ico", "favicon.svg", "apple-touch-icon.png", "logo-512.png", "og-cover.jpg", "img/hero-app.jpg")
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
       "font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https:; "
       "object-src 'none'; base-uri 'self'; form-action 'self'")


def build(output: Path, site_url: str = ""):
    output = output.resolve()
    if output == ROOT or output in ROOT.parents or output.is_relative_to(ROOT / "web"):
        raise ValueError("Build output must not overwrite source files")
    if output.exists():
        expected = set(ASSETS) | {"model-data.json", ".nojekyll", "robots.txt"}
        directories = {str(Path(name).parent).replace("\\", "/") for name in expected} - {"."}
        if any(p.is_symlink() or (p.relative_to(output).as_posix() not in (directories if p.is_dir() else expected))
               for p in output.rglob("*")):
            raise ValueError("Output contains unexpected files; choose an empty output directory")
    output.mkdir(parents=True, exist_ok=True)
    for name in ASSETS:
        source = ROOT / "web" / name
        (output / name).parent.mkdir(parents=True, exist_ok=True)
        if source.is_symlink():
            raise ValueError("Refusing symbolic link in public assets")
        if name.endswith(".html"):
            text = source.read_text(encoding="utf-8")
            text = text.replace('<html lang="zh-CN">', '<html lang="zh-CN" data-mode="static">')
            if name == "stats.html":
                text = text.replace('href="/"', 'href="index.html"').replace('href="/stats.csv"', 'href="#export"')
            text = text.replace('<head>', '<head>\n<meta name="robots" content="noindex,nofollow,noarchive">\n'
                                + '<meta http-equiv="Content-Security-Policy" content="' + html.escape(CSP, quote=True) + '">')
            if site_url:
                image_url = html.escape(site_url.rstrip("/") + "/og-cover.jpg", quote=True)
                text = re.sub(r'(<meta property="og:image" content=")[^"]*(">)',
                              lambda match: match[1] + image_url + match[2], text)
            (output / name).write_text(text, encoding="utf-8")
        else:
            shutil.copyfile(source, output / name)
    kb = KnowledgeBase(ROOT / "kb")
    try:
        jobs = json.loads((ROOT / "kb" / "jobs.json").read_text(encoding="utf-8"))
        jobs["jobs"] = [normalize(j) for j in jobs["jobs"]]
        providers = [dict(p) for p in PROVIDERS]
        for p in providers:
            if p["id"] == "deepseek":
                p.update(base_url="https://api.deepseek.com/v1", model="deepseek-chat")
        data = {"prompts": {k: getattr(prompts, k) for k in ("DIAGNOSE", "DIAGNOSE_JOB", "PLAN30", "INTERVIEW_Q", "INTERVIEW_END", "ASK", "RESUME_TIPS")},
                "documents": kb.documents(), "chunks": [c.cite() for c in kb.chunks], "jobs": jobs, "providers": providers}
    finally:
        kb.db.close()
    (output / "model-data.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    (output / ".nojekyll").write_text("", encoding="utf-8")
    (output / "robots.txt").write_text("User-agent: *\nDisallow: /\n", encoding="utf-8")
    print(f"Public site built: {output} ({len(data['documents'])} documents)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "dist" / "pages")
    parser.add_argument("--site-url", default="")
    args = parser.parse_args()
    build(args.output, args.site_url)

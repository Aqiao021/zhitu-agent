import base64
import io
import sys
import unittest
import zipfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from zhitu.extract import ExtractError, extract  # noqa: E402


def make_docx(paras):
    body = "".join(f"<w:p><w:r><w:t>{p}</w:t></w:r></w:p>" for p in paras)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                   f"<w:body>{body}</w:body></w:document>")
    return buf.getvalue()


def make_pdf(lines_cjk):
    """Tiny PDF: a Type0 font with a ToUnicode CMap and a Flate-compressed content stream (like Word/Chrome output)."""
    chars = sorted({c for line in lines_cjk for c in line})
    code = {c: f"{i + 1:04X}" for i, c in enumerate(chars)}
    cmap = ("/CIDInit /ProcSet findresource begin begincmap\n1 begincodespacerange <0000> <FFFF> endcodespacerange\n"
            f"{len(chars)} beginbfchar\n" + "".join(f"<{code[c]}> <{ord(c):04X}>\n" for c in chars) + "endbfchar\nendcmap end").encode()
    ops = ["BT", "/F1 12 Tf", "72 720 Td"]
    for k, line in enumerate(lines_cjk):
        if k:
            ops.append("0 -18 Td")
        ops.append("<" + "".join(code[c] for c in line) + "> Tj")
    ops.append("ET")
    content = zlib.compress("\n".join(ops).encode())
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length %d /Filter /FlateDecode >>\nstream\n" % len(content) + content + b"\nendstream",
        b"<< /Type /Font /Subtype /Type0 /BaseFont /X /Encoding /Identity-H /ToUnicode 6 0 R >>",
        b"<< /Length %d >>\nstream\n" % len(cmap) + cmap + b"\nendstream",
    ]
    out = b"%PDF-1.4\n"
    for i, o in enumerate(objs, 1):
        out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
    return out + b"trailer\n<< /Root 1 0 R >>\n%%EOF"


class ExtractTest(unittest.TestCase):
    def test_docx(self):
        r = extract("简历.docx", make_docx(["张三 人工智能技术应用专业", "熟练使用 Python 和 LabelImg"]))
        self.assertEqual(r["kind"], "Word")
        self.assertIn("熟练使用 Python 和 LabelImg", r["text"])
        self.assertIn("\n", r["text"])

    def test_pdf_cjk_lines(self):
        r = extract("report.pdf", make_pdf(["职途助手项目", "用Python开发"]))
        self.assertEqual(r["kind"], "PDF")
        self.assertEqual(r["text"].splitlines(), ["职途助手项目", "用Python开发"])

    def test_code_and_notebook(self):
        self.assertEqual(extract("main.py", "print('你好')\n".encode("utf-8"))["kind"], "代码")
        nb = '{"cells":[{"cell_type":"markdown","source":["# 数据清洗"]},{"cell_type":"code","source":["import pandas"]}]}'
        self.assertIn("数据清洗", extract("a.ipynb", nb.encode())["text"])
        self.assertIn("字", extract("gbk.txt", "中文字".encode("gbk"))["text"])

    def test_media_only_name(self):
        r = extract("demo.mp4", b"\x00" * 10)
        self.assertTrue(r["media"])
        self.assertEqual(r["text"], "")

    def test_errors(self):
        for name, data in [("old.doc", b"x"), ("x.exe", b"MZ"), ("empty.txt", b"   "), ("bad.docx", b"not a zip")]:
            with self.assertRaises(ExtractError, msg=name):
                extract(name, data)

    def test_radical_lookalikes_normalised(self):
        r = extract("a.txt", "⻓沙⻔店 ⾦融".encode("utf-8"))
        self.assertEqual(r["text"], "长沙门店 金融")


if __name__ == "__main__":
    unittest.main()

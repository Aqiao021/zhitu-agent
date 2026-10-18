"""Text extraction from uploaded files using only the standard library.

Supported: PDF (text-based, incl. Chinese fonts with ToUnicode maps), DOCX, PPTX, IPYNB, plain text and source code.
Files are parsed in memory and never written to disk.
"""
import io
import json
import re
import unicodedata
import zipfile
import zlib
from xml.etree import ElementTree as ET

TEXT_EXT = {".txt", ".md", ".py", ".js", ".ts", ".java", ".c", ".cpp", ".h", ".cs", ".go", ".kt", ".php", ".html", ".css",
            ".vue", ".json", ".sql", ".sh", ".yml", ".yaml", ".csv", ".xml", ".r", ".m", ".swift"}
MEDIA_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".mp4", ".mov", ".avi", ".mkv", ".mp3", ".wav",
             ".psd", ".ai", ".fig", ".blend", ".fbx", ".obj", ".max", ".ma", ".mb", ".unity", ".prefab", ".zip", ".rar", ".7z"}
MAX_CHARS = 20000
# CJK radical-supplement glyphs that some PDF producers emit instead of the normal characters
PAIRS = "⺁厂⺅亻⺉刂⺎兀⺏尢⺐尢⺑尢⺒巳⺓幺⺔彐⺖忄⺘扌⺙攵⺛旡⺜日⺟母⺠民⺡氵⺢氺⺣灬⺤爫⺥爫⺦丬⺧牛⺨犭⺩王⺪疋⺫罒⺬示⺭礻⺮竹⺯糸⺰纟⺲罒⺳网⺶羊⺷羊⺸羊⺹耂⺺肀⺻聿⺼月⺽臼⺾艹⺿艹⻀艹⻁虎⻂衤⻃西⻄西⻅见⻆角⻇角⻈讠⻉贝⻊足⻋车⻌辶⻍辶⻎辶⻏阝⻐钅⻑長⻒長⻓长⻔门⻖阝⻗雨⻘青⻙韦⻚页⻛风⻜飞⻝食⻞食⻟飠⻠饣⻡首⻢马⻣骨⻤鬼⻥鱼⻦鸟⻧卤⻨麦⻩黄⻪黾⻫齐⻬齐⻮齿⻰龙⻳龟"
RADICALS = dict(zip(PAIRS[::2], PAIRS[1::2]))


class ExtractError(ValueError):
    """User-facing message."""


def extract(name: str, data: bytes) -> dict:
    ext = ("." + name.rsplit(".", 1)[-1].lower()) if "." in name else ""
    if ext == ".pdf":
        text, kind = pdf_text(data), "PDF"
    elif ext == ".docx":
        text, kind = docx_text(data), "Word"
    elif ext == ".pptx":
        text, kind = pptx_text(data), "PPT"
    elif ext == ".ipynb":
        text, kind = ipynb_text(data), "Notebook"
    elif ext in (".doc", ".ppt", ".wps"):
        raise ExtractError(f"{name}：旧版 {ext} 格式暂不支持，请另存为 .docx / .pptx 或 PDF 后再导入")
    elif ext in TEXT_EXT:
        text, kind = decode_text(data), "代码" if ext not in (".txt", ".md", ".csv") else "文本"
    elif ext in MEDIA_EXT:
        return {"name": name, "kind": "文件", "text": "", "media": True}
    else:
        raise ExtractError(f"{name}：不支持的文件类型")
    text = re.sub(r"[\u2e80-\u2fdf]", lambda m: RADICALS.get(m.group(0)) or unicodedata.normalize("NFKC", m.group(0)), text)  # radical look-alikes
    text = re.sub(r"[ \t　]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n", text).strip()
    if not text:
        raise ExtractError(f"{name}：没有读到文字，可能是扫描件或图片型文档，请复制文字粘贴")
    return {"name": name, "kind": kind, "text": text[:MAX_CHARS], "media": False}


def decode_text(data: bytes) -> str:
    for enc in ("utf-8-sig", "gb18030"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", "ignore")


# ------------------------------------------------------------------ Office (zip + xml)
def _zip(data: bytes) -> zipfile.ZipFile:
    try:
        return zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ExtractError("文件已损坏或不是有效的 Office 文档") from None


def docx_text(data: bytes) -> str:
    z = _zip(data)
    W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    out = []
    for part in ["word/document.xml"] + sorted(n for n in z.namelist() if re.match(r"word/(header|footer)\d*\.xml", n)):
        if part not in z.namelist():
            continue
        root = ET.fromstring(z.read(part))
        for p in root.iter(W + "p"):
            line = "".join(t.text or "" for t in p.iter(W + "t"))
            if line.strip():
                out.append(line)
    return "\n".join(out)


def pptx_text(data: bytes) -> str:
    z = _zip(data)
    A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
    slides = sorted((n for n in z.namelist() if re.match(r"ppt/slides/slide\d+\.xml", n)), key=lambda n: int(re.findall(r"\d+", n)[0]))
    out = []
    for i, part in enumerate(slides, 1):
        root = ET.fromstring(z.read(part))
        lines = ["".join(t.text or "" for t in p.iter(A + "t")) for p in root.iter(A + "p")]
        lines = [x for x in lines if x.strip()]
        if lines:
            out.append(f"[第{i}页] " + " ".join(lines))
    return "\n".join(out)


def ipynb_text(data: bytes) -> str:
    try:
        nb = json.loads(decode_text(data))
    except ValueError:
        raise ExtractError("Notebook 文件格式不正确") from None
    out = []
    for c in nb.get("cells", []):
        src = "".join(c.get("source", [])) if isinstance(c.get("source"), list) else str(c.get("source", ""))
        if c.get("cell_type") == "markdown":
            out.append(src)
        elif c.get("cell_type") == "code" and src.strip():
            out.append("```\n" + "\n".join(src.splitlines()[:12]) + "\n```")
    return "\n".join(out)


# ------------------------------------------------------------------ PDF
_OBJ = re.compile(rb"(\d+)\s+(\d+)\s+obj\b(.*?)endobj", re.S)


def _stream(body: bytes) -> bytes | None:
    m = re.search(rb"stream\r?\n", body)
    if not m:
        return None
    raw = body[m.end():]
    end = raw.rfind(b"endstream")
    raw = raw[:end] if end >= 0 else raw
    head = body[:m.start()]
    if b"FlateDecode" in head:
        for data in (raw, raw.rstrip(b"\r\n")):
            try:
                return zlib.decompress(data)
            except zlib.error:
                try:
                    return zlib.decompressobj().decompress(data)
                except zlib.error:
                    continue
        return b""
    if b"/Filter" in head:  # other filters (images etc.) are not text
        return b""
    return raw


def _objects(data: bytes) -> dict[int, bytes]:
    objs: dict[int, bytes] = {}
    for m in _OBJ.finditer(data):
        objs[int(m.group(1))] = m.group(3)
    # objects packed inside object streams (PDF 1.5+, common in Word/WPS exports)
    for num, body in list(objs.items()):
        if re.search(rb"/Type\s*/ObjStm", body):
            s = _stream(body)
            n = re.search(rb"/N\s+(\d+)", body)
            first = re.search(rb"/First\s+(\d+)", body)
            if not s or not n or not first:
                continue
            head = s[:int(first.group(1))].split()
            pairs = [(int(head[i]), int(head[i + 1])) for i in range(0, min(len(head), 2 * int(n.group(1))) - 1, 2)]
            for k, (onum, off) in enumerate(pairs):
                start = int(first.group(1)) + off
                end = int(first.group(1)) + pairs[k + 1][1] if k + 1 < len(pairs) else len(s)
                objs.setdefault(onum, s[start:end])
    return objs


def _ref(body: bytes, key: bytes) -> int | None:
    m = re.search(rb"/" + key + rb"\s+(\d+)\s+\d+\s+R", body)
    return int(m.group(1)) if m else None


def _cmap(text: bytes) -> dict[bytes, str]:
    """Parse a ToUnicode CMap into {code bytes: unicode text}."""
    out: dict[bytes, str] = {}

    def u(h: bytes) -> str:
        h = h.decode()
        try:
            return bytes.fromhex(h).decode("utf-16-be", "ignore")
        except ValueError:
            return ""
    for block in re.findall(rb"beginbfchar(.*?)endbfchar", text, re.S):
        for src, dst in re.findall(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>", block):
            out[bytes.fromhex(src.decode())] = u(dst)
    for block in re.findall(rb"beginbfrange(.*?)endbfrange", text, re.S):
        for lo, hi, rest in re.findall(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(\[.*?\]|<[0-9A-Fa-f]*>)", block, re.S):
            a, b, width = int(lo, 16), int(hi, 16), len(lo) // 2
            if b - a > 20000:
                continue
            if rest.startswith(b"["):
                for k, d in enumerate(re.findall(rb"<([0-9A-Fa-f]*)>", rest)):
                    out[(a + k).to_bytes(width, "big")] = u(d)
            else:
                base = int(rest[1:-1] or b"0", 16)
                dlen = max(2, (len(rest) - 2) // 2)
                for k in range(b - a + 1):
                    try:
                        out[(a + k).to_bytes(width, "big")] = (base + k).to_bytes(dlen, "big").decode("utf-16-be", "ignore")
                    except OverflowError:
                        break
    return out


def _fonts(objs: dict[int, bytes], page: bytes) -> dict[bytes, dict]:
    res = page
    rnum = _ref(page, b"Resources")
    if rnum and rnum in objs:
        res = objs[rnum]
    fdict = re.search(rb"/Font\s*<<(.*?)>>", res, re.S)
    if not fdict:
        fnum = _ref(res, b"Font")
        fdict_body = objs.get(fnum, b"") if fnum else b""
    else:
        fdict_body = fdict.group(1)
    fonts = {}
    for name, num in re.findall(rb"/([^\s/<>\[\]()]+)\s+(\d+)\s+\d+\s+R", fdict_body):
        body = objs.get(int(num), b"")
        tu = _ref(body, b"ToUnicode")
        cmap = _cmap(_stream(objs.get(tu, b"")) or b"") if tu else {}
        two = b"Type0" in body or b"Identity-H" in body
        fonts[name] = {"cmap": cmap, "two": two, "widths": sorted({len(k) for k in cmap}, reverse=True) or [2 if two else 1]}
    return fonts


def _pdf_string(tok: bytes) -> bytes:
    if tok.startswith(b"<"):
        h = re.sub(rb"\s", b"", tok[1:-1])
        if len(h) % 2:
            h += b"0"
        try:
            return bytes.fromhex(h.decode())
        except ValueError:
            return b""
    s, out, i = tok[1:-1], bytearray(), 0
    esc = {b"n": b"\n", b"r": b"\r", b"t": b"\t", b"b": b"\b", b"f": b"\f", b"(": b"(", b")": b")", b"\\": b"\\"}
    while i < len(s):
        c = s[i:i + 1]
        if c == b"\\" and i + 1 < len(s):
            n = s[i + 1:i + 2]
            if n in esc:
                out += esc[n]
                i += 2
                continue
            m = re.match(rb"[0-7]{1,3}", s[i + 1:i + 4])
            if m:
                out.append(int(m.group(0), 8) & 255)
                i += 1 + len(m.group(0))
                continue
            i += 2 if n in b"\r\n" else 1
            continue
        out += c
        i += 1
    return bytes(out)


def _decode(raw: bytes, font: dict | None) -> str:
    if not font or not font["cmap"]:
        if font and font["two"]:
            return ""  # CID font without a ToUnicode map: glyph ids only
        return raw.decode("latin-1")
    cmap, out, i = font["cmap"], [], 0
    while i < len(raw):
        for w in font["widths"]:
            ch = cmap.get(raw[i:i + w])
            if ch is not None:
                out.append(ch)
                i += w
                break
        else:
            i += font["widths"][-1]
    return "".join(out)


_TOK = re.compile(rb"\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>|\[|\]|/[^\s/\[\]()<>]+|-?\d*\.?\d+|[A-Za-z'\"*]+", re.S)


def _content_text(stream: bytes, fonts: dict) -> str:
    out, line, font, stack, arr = [], [], None, [], None
    last_y, ty = None, 0.0  # last_y: baseline of the current output line; ty: text-matrix y (reset by BT)
    for tok in _TOK.findall(stream):
        if tok == b"[":
            arr = []
            continue
        if tok == b"]":
            stack.append(arr or [])
            arr = None
            continue
        if arr is not None:
            arr.append(tok)
            continue
        if tok[:1] in (b"(", b"<", b"/") or re.fullmatch(rb"-?\d*\.?\d+", tok):
            stack.append(tok)
            continue
        op = tok
        if op == b"Tf" and len(stack) >= 2:
            font = fonts.get(stack[-2][1:])
        elif op in (b"Tj", b"'", b'"') and stack:
            if op != b"Tj":
                out.append("".join(line))
                line = []
            line.append(_decode(_pdf_string(stack[-1]), font))
        elif op == b"TJ" and stack and isinstance(stack[-1], list):
            for t in stack[-1]:
                if t[:1] in (b"(", b"<"):
                    line.append(_decode(_pdf_string(t), font))
                elif re.fullmatch(rb"-?\d*\.?\d+", t) and float(t) < -250:
                    line.append(" ")
        elif op in (b"Td", b"TD", b"Tm") and len(stack) >= 2:
            try:
                v = float(stack[-1])
            except (TypeError, ValueError):
                v = 0.0
            ty = v if op == b"Tm" else ty + v
            if last_y is not None and abs(ty - last_y) > 1 and line:  # only a vertical move starts a new line
                out.append("".join(line))
                line = []
            last_y = ty
        elif op == b"T*" and line:
            out.append("".join(line))
            line = []
        elif op == b"BT":
            ty = 0.0
        stack = []
    if line:
        out.append("".join(line))
    return "\n".join(x for x in out if x.strip())


def pdf_text(data: bytes) -> str:
    if not data.startswith(b"%PDF"):
        raise ExtractError("不是有效的 PDF 文件")
    if re.search(rb"/Encrypt\s", data):
        raise ExtractError("PDF 已加密，请先去掉密码或复制文字粘贴")
    objs = _objects(data)
    pages = [(n, b) for n, b in sorted(objs.items()) if re.search(rb"/Type\s*/Page(?!s)\b", b)]
    texts = []
    for _, page in pages[:30]:
        fonts = _fonts(objs, page)
        refs = []
        m = re.search(rb"/Contents\s*\[(.*?)\]", page, re.S)
        if m:
            refs = [int(x) for x in re.findall(rb"(\d+)\s+\d+\s+R", m.group(1))]
        else:
            r = _ref(page, b"Contents")
            refs = [r] if r else []
        content = b"\n".join(_stream(objs.get(r, b"")) or b"" for r in refs)
        texts.append(_content_text(content, fonts))
    return "\n".join(t for t in texts if t)

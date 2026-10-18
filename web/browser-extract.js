/* Browser-only text extraction for the GitHub Pages edition (mirror of zhitu/extract.py).
   Files never leave the page: PDF / DOCX / PPTX / IPYNB / text and code are parsed in memory. */
(function (root) {
  'use strict';
  const TEXT_EXT = new Set(['.txt', '.md', '.py', '.js', '.ts', '.java', '.c', '.cpp', '.h', '.cs', '.go', '.kt', '.php', '.html', '.css',
    '.vue', '.json', '.sql', '.sh', '.yml', '.yaml', '.csv', '.xml', '.r', '.m', '.swift']);
  const MEDIA_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.mp4', '.mov', '.avi', '.mkv', '.mp3', '.wav',
    '.psd', '.ai', '.fig', '.blend', '.fbx', '.obj', '.max', '.ma', '.mb', '.unity', '.prefab', '.zip', '.rar', '.7z']);
  const MAX_CHARS = 20000;
  const PAIRS = '⺁厂⺅亻⺉刂⺎兀⺏尢⺐尢⺑尢⺒巳⺓幺⺔彐⺖忄⺘扌⺙攵⺛旡⺜日⺟母⺠民⺡氵⺢氺⺣灬⺤爫⺥爫⺦丬⺧牛⺨犭⺩王⺪疋⺫罒⺬示⺭礻⺮竹⺯糸⺰纟⺲罒⺳网⺶羊⺷羊⺸羊⺹耂⺺肀⺻聿⺼月⺽臼⺾艹⺿艹⻀艹⻁虎⻂衤⻃西⻄西⻅见⻆角⻇角⻈讠⻉贝⻊足⻋车⻌辶⻍辶⻎辶⻏阝⻐钅⻑長⻒長⻓长⻔门⻖阝⻗雨⻘青⻙韦⻚页⻛风⻜飞⻝食⻞食⻟飠⻠饣⻡首⻢马⻣骨⻤鬼⻥鱼⻦鸟⻧卤⻨麦⻩黄⻪黾⻫齐⻬齐⻮齿⻰龙⻳龟';
  const RADICALS = new Map([...PAIRS].reduce((acc, c, i, all) => (i % 2 ? acc : acc.concat([[c, all[i + 1]]])), []));

  class ExtractError extends Error {}

  /* ---------------------------------------------------------------- helpers */
  const latin1 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return s; };
  const bytesOf = (s) => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };
  function decodeText(u8) {
    for (const enc of ['utf-8', 'gb18030']) {
      try { return new TextDecoder(enc, { fatal: true }).decode(u8).replace(/^﻿/, ''); } catch (_) { /* try next */ }
    }
    return new TextDecoder('utf-8').decode(u8);
  }
  async function inflate(u8, format) {   // tolerant: keeps whatever decompressed before an error (like zlib.decompressobj)
    const ds = new DecompressionStream(format), w = ds.writable.getWriter(), r = ds.readable.getReader(), parts = [];
    w.write(u8).catch(() => {}); w.close().catch(() => {});
    try { for (;;) { const { done, value } = await r.read(); if (done) break; parts.push(value); } } catch (_) { /* truncated stream */ }
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  const entities = (s) => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) => ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e.toLowerCase()]
    ?? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))));

  /* ---------------------------------------------------------------- zip (Office) */
  async function unzip(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), files = new Map();
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new ExtractError('文件已损坏或不是有效的 Office 文档');
    let p = dv.getUint32(eocd + 16, true);
    const count = dv.getUint16(eocd + 10, true);
    for (let k = 0; k < count && p + 46 <= u8.length && dv.getUint32(p, true) === 0x02014b50; k++) {
      const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true);
      const elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), local = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen));
      files.set(name, { method, size, local });
      p += 46 + nlen + elen + clen;
    }
    return {
      names: [...files.keys()],
      async read(name) {
        const f = files.get(name); if (!f) return null;
        const start = f.local + 30 + dv.getUint16(f.local + 26, true) + dv.getUint16(f.local + 28, true);
        const raw = u8.subarray(start, start + f.size);
        return new TextDecoder().decode(f.method === 8 ? await inflate(raw, 'deflate-raw') : raw);
      },
    };
  }
  const xmlParas = (xml, p, t) => xml.split(new RegExp(`</${p}>`)).map((seg) => {
    let s = ''; const re = new RegExp(`<${t}(?:\\s[^>]*)?>([^<]*)</${t}>`, 'g'); let m;
    while ((m = re.exec(seg))) s += entities(m[1]);
    return s;
  }).filter((x) => x.trim());
  async function docxText(u8) {
    const z = await unzip(u8), out = [];
    for (const part of ['word/document.xml', ...z.names.filter((n) => /^word\/(header|footer)\d*\.xml$/.test(n)).sort()]) {
      const xml = await z.read(part); if (xml) out.push(...xmlParas(xml, 'w:p', 'w:t'));
    }
    return out.join('\n');
  }
  async function pptxText(u8) {
    const z = await unzip(u8), out = [];
    const slides = z.names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
    for (let i = 0; i < slides.length; i++) {
      const lines = xmlParas(await z.read(slides[i]), 'a:p', 'a:t');
      if (lines.length) out.push(`[第${i + 1}页] ` + lines.join(' '));
    }
    return out.join('\n');
  }
  function ipynbText(u8) {
    let nb; try { nb = JSON.parse(decodeText(u8)); } catch (_) { throw new ExtractError('Notebook 文件格式不正确'); }
    return (Array.isArray(nb.cells) ? nb.cells : []).map((c) => {
      const src = Array.isArray(c.source) ? c.source.join('') : String(c.source ?? '');
      if (c.cell_type === 'markdown') return src;
      if (c.cell_type === 'code' && src.trim()) return '```\n' + src.split('\n').slice(0, 12).join('\n') + '\n```';
      return '';
    }).filter(Boolean).join('\n');
  }

  /* ---------------------------------------------------------------- PDF (strings below are latin-1 "byte strings") */
  async function stream(body) {
    const m = /stream\r?\n/.exec(body); if (!m) return null;
    let raw = body.slice(m.index + m[0].length); const end = raw.lastIndexOf('endstream'); if (end >= 0) raw = raw.slice(0, end);
    const head = body.slice(0, m.index);
    if (head.includes('FlateDecode')) return latin1(await inflate(bytesOf(raw), 'deflate'));
    if (head.includes('/Filter')) return '';
    return raw;
  }
  async function objects(data) {
    const objs = new Map(), re = /(\d+)\s+(\d+)\s+obj\b([\s\S]*?)endobj/g; let m;
    while ((m = re.exec(data))) objs.set(+m[1], m[3]);
    for (const body of [...objs.values()]) {
      if (!/\/Type\s*\/ObjStm/.test(body)) continue;
      const s = await stream(body), n = /\/N\s+(\d+)/.exec(body), first = /\/First\s+(\d+)/.exec(body);
      if (!s || !n || !first) continue;
      const f = +first[1], head = s.slice(0, f).trim().split(/\s+/), pairs = [];
      for (let i = 0; i + 1 < Math.min(head.length, 2 * +n[1]); i += 2) pairs.push([+head[i], +head[i + 1]]);
      pairs.forEach(([num, off], k) => { if (!objs.has(num)) objs.set(num, s.slice(f + off, k + 1 < pairs.length ? f + pairs[k + 1][1] : s.length)); });
    }
    return objs;
  }
  const ref = (body, key) => { const m = new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`).exec(body); return m ? +m[1] : null; };
  const utf16 = (hex) => { let s = ''; for (let i = 0; i + 4 <= hex.length; i += 4) s += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16)); return s; };
  const codeKey = (n, width) => { let s = ''; for (let i = width - 1; i >= 0; i--) s += String.fromCharCode((n >> (8 * i)) & 255); return s; };
  function cmap(text) {
    const out = new Map(); let b;
    const hexBytes = (h) => latin1(Uint8Array.from(h.match(/../g) || [], (x) => parseInt(x, 16)));
    for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      const re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g;
      while ((b = re.exec(block[1]))) out.set(hexBytes(b[1]), utf16(b[2]));
    }
    for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      const re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(\[[\s\S]*?\]|<[0-9A-Fa-f]*>)/g;
      while ((b = re.exec(block[1]))) {
        const lo = parseInt(b[1], 16), hi = parseInt(b[2], 16), width = b[1].length / 2, rest = b[3];
        if (hi - lo > 20000) continue;
        if (rest[0] === '[') [...rest.matchAll(/<([0-9A-Fa-f]*)>/g)].forEach((d, k) => out.set(codeKey(lo + k, width), utf16(d[1])));
        else {
          const base = parseInt(rest.slice(1, -1) || '0', 16);
          for (let k = 0; k <= hi - lo; k++) { const c = base + k; out.set(codeKey(lo + k, width), c > 0xffff ? String.fromCodePoint(c) : String.fromCharCode(c)); }
        }
      }
    }
    return out;
  }
  async function fonts(objs, page) {
    const rnum = ref(page, 'Resources'), res = rnum && objs.has(rnum) ? objs.get(rnum) : page;
    const inline = /\/Font\s*<<([\s\S]*?)>>/.exec(res);
    const fbody = inline ? inline[1] : (objs.get(ref(res, 'Font')) || '');
    const out = new Map();
    for (const m of fbody.matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g)) {
      const body = objs.get(+m[2]) || '', tu = ref(body, 'ToUnicode');
      const map = tu ? cmap((await stream(objs.get(tu) || '')) || '') : new Map();
      const two = body.includes('Type0') || body.includes('Identity-H');
      const widths = [...new Set([...map.keys()].map((k) => k.length))].sort((a, b) => b - a);
      out.set(m[1], { map, two, widths: widths.length ? widths : [two ? 2 : 1] });
    }
    return out;
  }
  function pdfString(tok) {
    if (tok[0] === '<') {
      let h = tok.slice(1, -1).replace(/\s/g, ''); if (h.length % 2) h += '0';
      return /^[0-9A-Fa-f]*$/.test(h) ? latin1(Uint8Array.from(h.match(/../g) || [], (x) => parseInt(x, 16))) : '';
    }
    const s = tok.slice(1, -1), esc = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };
    let out = '';
    for (let i = 0; i < s.length;) {
      const c = s[i];
      if (c === '\\' && i + 1 < s.length) {
        const n = s[i + 1];
        if (n in esc) { out += esc[n]; i += 2; continue; }
        const m = /^[0-7]{1,3}/.exec(s.slice(i + 1, i + 4));
        if (m) { out += String.fromCharCode(parseInt(m[0], 8) & 255); i += 1 + m[0].length; continue; }
        i += (n === '\r' || n === '\n') ? 2 : 1; continue;
      }
      out += c; i++;
    }
    return out;
  }
  function decode(raw, font) {
    if (!font || !font.map.size) return font && font.two ? '' : raw;   // latin-1 already; CID fonts without a map are glyph ids only
    let out = '';
    for (let i = 0; i < raw.length;) {
      let hit = false;
      for (const w of font.widths) { const ch = font.map.get(raw.slice(i, i + w)); if (ch !== undefined) { out += ch; i += w; hit = true; break; } }
      if (!hit) i += font.widths[font.widths.length - 1];
    }
    return out;
  }
  const NUM = /^-?\d*\.?\d+$/;
  function contentText(src, fontMap) {
    const out = []; let line = [], font = null, stack = [], arr = null, lastY = null, ty = 0;
    const flush = () => { out.push(line.join('')); line = []; };
    const re = /\((?:\\[\s\S]|[^\\)])*\)|<[0-9A-Fa-f\s]*>|\[|\]|\/[^\s/[\]()<>]+|-?\d*\.?\d+|[A-Za-z'"*]+/g; let m;
    while ((m = re.exec(src))) {
      const tok = m[0];
      if (tok === '[') { arr = []; continue; }
      if (tok === ']') { stack.push(arr || []); arr = null; continue; }
      if (arr) { arr.push(tok); continue; }
      if ('(</'.includes(tok[0]) || NUM.test(tok)) { stack.push(tok); continue; }
      const top = stack[stack.length - 1];
      if (tok === 'Tf' && stack.length >= 2) font = fontMap.get(String(stack[stack.length - 2]).slice(1)) || null;
      else if ((tok === 'Tj' || tok === "'" || tok === '"') && typeof top === 'string') { if (tok !== 'Tj') flush(); line.push(decode(pdfString(top), font)); }
      else if (tok === 'TJ' && Array.isArray(top)) {
        for (const t of top) {
          if (t[0] === '(' || t[0] === '<') line.push(decode(pdfString(t), font));
          else if (NUM.test(t) && parseFloat(t) < -250) line.push(' ');
        }
      } else if ((tok === 'Td' || tok === 'TD' || tok === 'Tm') && stack.length >= 2) {
        const v = parseFloat(top) || 0;
        ty = tok === 'Tm' ? v : ty + v;
        if (lastY !== null && Math.abs(ty - lastY) > 1 && line.length) flush();   // only a vertical move starts a new line
        lastY = ty;
      } else if (tok === 'T*' && line.length) flush();
      else if (tok === 'BT') ty = 0;
      stack = [];
    }
    if (line.length) flush();
    return out.filter((x) => x.trim()).join('\n');
  }
  async function pdfText(u8) {
    const data = latin1(u8);
    if (!data.startsWith('%PDF')) throw new ExtractError('不是有效的 PDF 文件');
    if (/\/Encrypt\s/.test(data)) throw new ExtractError('PDF 已加密，请先去掉密码或复制文字粘贴');
    const objs = await objects(data);
    const pages = [...objs.entries()].sort((a, b) => a[0] - b[0]).filter(([, b]) => /\/Type\s*\/Page(?!s)\b/.test(b)).slice(0, 30);
    const texts = [];
    for (const [, page] of pages) {
      const fm = await fonts(objs, page), arrRefs = /\/Contents\s*\[([\s\S]*?)\]/.exec(page);
      const refs = arrRefs ? [...arrRefs[1].matchAll(/(\d+)\s+\d+\s+R/g)].map((x) => +x[1]) : [ref(page, 'Contents')].filter(Boolean);
      const parts = []; for (const r of refs) parts.push((await stream(objs.get(r) || '')) || '');
      texts.push(contentText(parts.join('\n'), fm));
    }
    return texts.filter(Boolean).join('\n');
  }

  /* ---------------------------------------------------------------- entry */
  async function extract(name, u8) {
    const ext = name.includes('.') ? '.' + name.split('.').pop().toLowerCase() : '';
    let text, kind;
    try {
      if (ext === '.pdf') { text = await pdfText(u8); kind = 'PDF'; }
      else if (ext === '.docx') { text = await docxText(u8); kind = 'Word'; }
      else if (ext === '.pptx') { text = await pptxText(u8); kind = 'PPT'; }
      else if (ext === '.ipynb') { text = ipynbText(u8); kind = 'Notebook'; }
      else if (['.doc', '.ppt', '.wps'].includes(ext)) throw new ExtractError(`${name}：旧版 ${ext} 格式暂不支持，请另存为 .docx / .pptx 或 PDF 后再导入`);
      else if (TEXT_EXT.has(ext)) { text = decodeText(u8); kind = ['.txt', '.md', '.csv'].includes(ext) ? '文本' : '代码'; }
      else if (MEDIA_EXT.has(ext)) return { name, kind: '文件', text: '', media: true };
      else throw new ExtractError(`${name}：不支持的文件类型`);
    } catch (e) {
      if (e instanceof ExtractError) throw new ExtractError(e.message.startsWith(name) ? e.message : `${name}：${e.message}`);
      throw new ExtractError(`${name}：这个文件读取失败，请换成 PDF / Word，或直接复制文字粘贴`);
    }
    text = text.replace(/[⺀-⿟]/g, (c) => RADICALS.get(c) || c.normalize('NFKC'))
      .replace(/[ \t　]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
    if (!text) throw new ExtractError(`${name}：没有读到文字，可能是扫描件或图片型文档，请复制文字粘贴`);
    return { name, kind, text: text.slice(0, MAX_CHARS), media: false };
  }

  const api = { extract, ExtractError };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ZhituExtract = api;
})(globalThis);

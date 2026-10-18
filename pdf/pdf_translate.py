"""Layout-preserving PDF translation helper for Clara.

  extract <in.pdf>                       -> JSON text blocks (position, size, color, weight) on stdout
  render  <in.pdf> <out.pdf> [prev.png]  -> reads {"blocks": [...with "translation"]} on stdin and writes
                                 the same PDF with each block's text replaced in place.

Images, lines, and background shapes are left untouched; only text is swapped. Each translation
is laid out inside the original block's box and scaled down if it is longer, so it never spills
onto neighbouring content or off the page.
"""

import html
import json
import os
import re
import sys
import urllib.request

import pymupdf

LETTER = re.compile(r"[^\W\d_]", re.UNICODE)

FONT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts")
FONT_URL = "https://github.com/notofonts/notofonts.github.io/raw/main/fonts/{family}/hinted/ttf/{family}-{weight}.ttf"
# (characters, sans family, serif family). Anything else (Latin, Cyrillic, Vietnamese, digits) uses Noto Sans/Serif;
# CJK and Hangul fall through to MuPDF's built-in fallback fonts.
SCRIPTS = [
    (re.compile(r"[ऀ-ॿ꣠-ꣿ᳐-᳿]"), "NotoSansDevanagari", "NotoSerifDevanagari"),
    (re.compile(r"[ঀ-৿]"), "NotoSansBengali", "NotoSerifBengali"),
    (re.compile(r"[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]"), "NotoSansArabic", "NotoNaskhArabic"),
    (re.compile(r"[ሀ-᎟ⶀ-⷟]"), "NotoSansEthiopic", "NotoSerifEthiopic"),
    (re.compile(r"[က-႟ꩠ-ꩿ]"), "NotoSansMyanmar", "NotoSerifMyanmar"),
]
CJK = re.compile(r"[ᄀ-ᇿ⺀-鿿가-힯豈-﫿＀-￯]")
RTL = re.compile(r"[֐-ࣿיִ-﷿ﹰ-﻿]")


def font_available(family):
    """Make sure regular and bold files for a Noto family are in pdf/fonts (downloaded once)."""
    ok = True
    for weight in ("Regular", "Bold"):
        path = os.path.join(FONT_DIR, f"{family}-{weight}.ttf")
        if os.path.exists(path):
            continue
        try:
            os.makedirs(FONT_DIR, exist_ok=True)
            with urllib.request.urlopen(FONT_URL.format(family=family, weight=weight), timeout=30) as r:
                data = r.read()
            with open(path + ".part", "wb") as f:
                f.write(data)
            os.replace(path + ".part", path)
        except Exception as err:  # offline: MuPDF's built-in fallback fonts still render the text
            print(f"font {family}-{weight} unavailable: {err}", file=sys.stderr)
            ok = False
    return ok


def css_name(family):
    # MuPDF can confuse font families whose names share a prefix (NotoSans / NotoSansDevanagari),
    # so each family gets a short alias that is never a prefix of another.
    return f"F{abs(hash(family)) % 10**8}x"


def font_css(families):
    rules = []
    for family in sorted(families):
        for weight, css_weight in (("Regular", "normal"), ("Bold", "bold")):
            rules.append(f"@font-face {{ font-family: {css_name(family)}; font-weight: {css_weight}; src: url({family}-{weight}.ttf); }}")
    return "\n".join(rules)


def runs_html(text, serif, usable):
    """Wrap each stretch of text in the Noto font for its script, so every glyph comes from a real,
    matching font (including bold) instead of a mismatched fallback."""
    base = "NotoSerif" if serif else "NotoSans"
    out = []
    family, buf = None, []

    def flush():
        if buf:
            chunk = html.escape("".join(buf))
            out.append(f'<span style="font-family: {css_name(family)}">{chunk}</span>' if family in usable else chunk)
            buf.clear()

    for ch in text:
        if ch == "\n":
            flush()
            out.append("<br>")
            continue
        want = next((serif_family if serif else sans for rx, sans, serif_family in SCRIPTS if rx.match(ch)), None)
        if want is None:
            if ch.isspace():
                buf.append(ch)  # spaces stay with the current run
                continue
            # Letters and punctuation outside the script blocks (·, —, °, digits) come from Noto Sans/Serif.
            want = None if CJK.match(ch) else base
        if want != family:
            flush()
            family = want
        buf.append(ch)
    flush()
    return "".join(out)


def color_hex(value):
    return f"#{value:06x}"


SANS_HINTS = ("helvetica", "arial", "sans", "inter", "roboto", "calibri", "verdana", "segoe", "tahoma", "lato", "open", "frutiger", "futura", "avenir", "gotham")
SERIF_HINTS = ("times", "serif", "georgia", "garamond", "roman", "cambria", "minion", "palatino", "baskerville", "book", "caslon")


def is_serif(span):
    # Font names are more reliable than the PDF's serif flag, which many generators set wrongly.
    name = span["font"].lower()
    if any(h in name for h in SANS_HINTS):
        return False
    if any(h in name for h in SERIF_HINTS):
        return True
    return bool(span["flags"] & 4)


def line_text(line):
    return "".join(s["text"] for s in line["spans"])


def split_units(lines):
    """Group lines that sit under each other. PDF blocks often merge side-by-side table cells
    or columns into one block; each of those must keep its own box."""
    units = []
    for l in sorted(lines, key=lambda l: (round(l["bbox"][1], 1), l["bbox"][0])):
        x0, y0, x1, y1 = l["bbox"]
        size = max(s["size"] for s in l["spans"])
        home = None
        for u in units:
            if abs(u["size"] - size) > 1:
                continue
            ux0, uy0, ux1, uy1 = u["lines"][-1]["bbox"]
            overlap = min(x1, ux1) - max(x0, ux0)
            below = y0 >= uy1 - 2 and y0 - uy1 < 0.9 * size
            if below and overlap > 0.3 * min(x1 - x0, ux1 - ux0):
                home = u
                break
        if home is None:
            units.append({"lines": [l], "size": size})
        else:
            home["lines"].append(l)
    for u in units:
        u["bbox"] = [
            min(l["bbox"][0] for l in u["lines"]),
            min(l["bbox"][1] for l in u["lines"]),
            max(l["bbox"][2] for l in u["lines"]),
            max(l["bbox"][3] for l in u["lines"]),
        ]
    return units


def extract(path):
    doc = pymupdf.open(path)
    blocks = []
    for pno, page in enumerate(doc):
        width = page.rect.width
        data = page.get_text("dict", flags=pymupdf.TEXT_PRESERVE_WHITESPACE | pymupdf.TEXT_MEDIABOX_CLIP)
        raw_lines = [
            l
            for b in data["blocks"]
            if b["type"] == 0
            for l in b["lines"]
            if abs(l["dir"][0] - 1) < 0.01 and line_text(l).strip()
        ]
        for unit in split_units(raw_lines):
            lines = unit["lines"]
            bx0, by0, bx1, by1 = unit["bbox"]

            # Join wrapped lines into one paragraph; keep real line breaks (list items, label/value rows).
            parts = []
            prev = None
            for l in lines:
                text = "".join(s["text"] for s in l["spans"]).strip()
                if prev is not None:
                    wrapped = (prev["bbox"][2] - bx0) > 0.8 * (bx1 - bx0) and not re.search(r"[:.!?]$", parts[-1])
                    parts.append(" " if wrapped else "\n")
                parts.append(text)
                prev = l
            text = re.sub(r"[ \t]+", " ", "".join(parts)).strip()
            if not LETTER.search(text):
                continue  # numbers, symbols: leave as they are

            # Dominant style by character count.
            spans = [s for l in lines for s in l["spans"] if s["text"].strip()]
            main = max(spans, key=lambda s: len(s["text"].strip()))
            bold = bool(main["flags"] & 16) or "bold" in main["font"].lower()
            italic = bool(main["flags"] & 2) or "italic" in main["font"].lower() or "oblique" in main["font"].lower()
            serif = is_serif(main)

            centers = [(l["bbox"][0] + l["bbox"][2]) / 2 for l in lines]
            block_center = (bx0 + bx1) / 2
            centered = (
                abs(block_center - width / 2) < 4 and (bx1 - bx0) < 0.85 * width
            ) or (len(lines) > 1 and all(abs(c - block_center) < 2 for c in centers) and len({round(l["bbox"][0]) for l in lines}) > 1)

            blocks.append({
                "id": len(blocks),
                "page": pno,
                "bbox": [round(v, 2) for v in unit["bbox"]],
                "text": text,
                "size": round(main["size"], 2),
                "color": color_hex(main["color"]),
                "bold": bold,
                "italic": italic,
                "serif": serif,
                "align": "center" if centered else "left",
                "lineHeight": round((by1 - by0) / len(lines) / main["size"], 2) if lines else 1.2,
            })
    print(json.dumps({"pages": len(doc), "blocks": blocks}, ensure_ascii=False))


def obstacles(page):
    """Everything a translated block must not run into: text, images, and drawn lines/box edges."""
    rects = []
    for b in page.get_text("dict")["blocks"]:
        if b["type"] == 0:
            rects += [pymupdf.Rect(l["bbox"]) for l in b["lines"] if line_text(l).strip()]
    rects += [pymupdf.Rect(i["bbox"]) for i in page.get_image_info()]
    for d in page.get_drawings():
        r = d["rect"]
        if r.width < 2 or r.height < 2:
            rects.append(pymupdf.Rect(r))  # a rule or border line
        else:  # a box: only its edges are barriers, text may sit inside it
            rects += [
                pymupdf.Rect(r.x0, r.y0, r.x1, r.y0),
                pymupdf.Rect(r.x0, r.y1, r.x1, r.y1),
                pymupdf.Rect(r.x0, r.y0, r.x0, r.y1),
                pymupdf.Rect(r.x1, r.y0, r.x1, r.y1),
            ]
    return rects


def free_box(rect, page, blockers, align):
    """Grow rect right (and left if centered) and down into empty space, stopping at any blocker."""
    own = pymupdf.Rect(rect.x0 - 1, rect.y0 - 1, rect.x1 + 1, rect.y1 + 1)
    others = [o for o in blockers if not own.contains(o)]
    text_x = [o.x0 for o in blockers if o.width > 2 and o.height > 2] or [36]
    margin = max(18, min(text_x))
    right = max(rect.x1, page.rect.width - margin)
    left = min(rect.x0, margin)
    for o in others:
        if o.y1 > rect.y0 + 0.5 and o.y0 < rect.y1 - 0.5:  # same rows
            if o.x0 >= rect.x1 - 0.5:
                right = min(right, o.x0 - 3)
            if o.x1 <= rect.x0 + 0.5:
                left = max(left, o.x1 + 3)
    x0, x1 = rect.x0, max(rect.x1, right)
    if align == "center":
        reach = min(rect.x0 - left, right - rect.x1)
        x0, x1 = rect.x0 - max(0, reach), rect.x1 + max(0, reach)
    bottom = page.rect.height - margin
    for o in others:
        if o.x1 > x0 + 0.5 and o.x0 < x1 - 0.5 and o.y0 >= rect.y1 - 0.5:
            bottom = min(bottom, o.y0 - 1.5)
    return pymupdf.Rect(x0, rect.y0, x1, max(rect.y1, bottom))


def render(src, out, preview=None):
    payload = json.load(sys.stdin)
    doc = pymupdf.open(src)
    by_page = {}
    for b in payload["blocks"]:
        if b.get("translation", "").strip():
            by_page.setdefault(b["page"], []).append(b)

    # Work out which Noto families the translations need and make sure they're on disk.
    needed = set()
    for blocks in by_page.values():
        for b in blocks:
            needed.add("NotoSerif" if b["serif"] else "NotoSans")
            for rx, sans, serif_family in SCRIPTS:
                if rx.search(b["translation"]):
                    needed.add(serif_family if b["serif"] else sans)
    usable = {f for f in needed if font_available(f)}
    archive = pymupdf.Archive(FONT_DIR) if usable else None
    faces = font_css(usable)

    min_scale = 1.0
    for pno, blocks in by_page.items():
        page = doc[pno]
        blockers = obstacles(page)
        boxes = {b["id"]: free_box(pymupdf.Rect(b["bbox"]), page, blockers, b["align"]) for b in blocks}
        for b in blocks:
            # fill=False keeps whatever is behind the text (colored bars, table shading).
            page.add_redact_annot(pymupdf.Rect(b["bbox"]), fill=False)
        page.apply_redactions(
            images=pymupdf.PDF_REDACT_IMAGE_NONE,
            graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
        )
        for b in blocks:
            rect = boxes[b["id"]]
            line_height = max(1.05, min(1.5, b.get("lineHeight", 1.2)))
            translation = b["translation"].strip()
            base = "NotoSerif" if b["serif"] else "NotoSans"
            family = css_name(base) if base in usable else ("serif" if b["serif"] else "sans-serif")
            align = "right" if b["align"] == "left" and RTL.search(translation) else b["align"]
            css = (
                f"{faces}\n* {{ margin: 0; padding: 0; }}"
                f"body {{ font-family: {family}; font-size: {b['size']}px;"
                f" color: {b['color']}; font-weight: {'bold' if b['bold'] else 'normal'};"
                f" line-height: {line_height}; text-align: {align}; }}"
            )
            body = runs_html(translation, b["serif"], usable)
            spare, scale = page.insert_htmlbox(rect, body, css=css, scale_low=0, archive=archive)
            if spare >= 0:
                min_scale = min(min_scale, scale)
    try:
        doc.subset_fonts()  # embed only the glyphs used; keeps the file small
    except Exception as err:
        print(f"font subsetting skipped: {err}", file=sys.stderr)
    doc.save(out, garbage=3, deflate=True)
    if preview:
        doc[0].get_pixmap(dpi=100).save(preview)
    print(json.dumps({"ok": True, "minScale": round(min_scale, 3)}))


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "extract":
        extract(sys.argv[2])
    elif cmd == "render":
        render(sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else None)
    else:
        sys.exit(f"unknown command {cmd}")

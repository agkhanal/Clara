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
import re
import sys

import pymupdf

LETTER = re.compile(r"[^\W\d_]", re.UNICODE)


def color_hex(value):
    return f"#{value:06x}"


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
            serif = bool(main["flags"] & 4)

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
            css = (
                "* { margin: 0; padding: 0; }"
                f"body {{ font-family: {'serif' if b['serif'] else 'sans-serif'}; font-size: {b['size']}px;"
                f" color: {b['color']}; font-weight: {'bold' if b['bold'] else 'normal'};"
                f" font-style: {'italic' if b['italic'] else 'normal'}; line-height: {line_height};"
                f" text-align: {b['align']}; }}"
            )
            body = "<br>".join(html.escape(line) for line in b["translation"].strip().split("\n"))
            spare, scale = page.insert_htmlbox(rect, body, css=css, scale_low=0)
            if spare >= 0:
                min_scale = min(min_scale, scale)
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

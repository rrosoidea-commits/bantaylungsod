"""
build_inline.py - Pack the Bantay Lungsod web app into ONE self-contained HTML file for Streamlit.

The simulator itself is not changed. This script only reads the files in ../app and writes
simulator.html next to it:
  * style.css            -> inlined in a <style> tag; fonts and the title picture become data URIs
  * data.js, engine.js,  -> inlined in <script> tags, in the same order as index.html
    scenes.js, ui.js,
    play.js, dash.js
  * img/*.jpg            -> embedded as data URIs. The game already looks for embedded pictures in
                            window.__IMG; a small loader also swaps any <img src="img/..."> it sees.
  * three.js             -> still loaded from the cdnjs CDN, exactly as in index.html

Run it again whenever the simulator in ../app changes:
    python build_inline.py
"""
import base64, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.normpath(os.path.join(HERE, "..", "app"))
OUT = os.path.join(HERE, "simulator.html")
MIME = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".woff2": "font/woff2"}


def data_uri(path):
    ext = os.path.splitext(path)[1].lower()
    with open(path, "rb") as f:
        return f"data:{MIME[ext]};base64," + base64.b64encode(f.read()).decode("ascii")


def read(name):
    with open(os.path.join(APP, name), encoding="utf-8") as f:
        return f.read()


html = read("index.html")

# 1. stylesheet, with every url(...) to a local file turned into a data URI
css = read("style.css")
css = re.sub(r"url\((?!data:|https?:)([^)'\"]+)\)", lambda m: f"url({data_uri(os.path.join(APP, m.group(1)))})", css)
html = html.replace('<link rel="stylesheet" href="style.css">', "<style>\n" + css + "\n</style>")

# 2. pictures: a lookup table for the game's IMG() helper, plus a loader for <img> tags written in markup
imgs = {f: data_uri(os.path.join(APP, "img", f)) for f in sorted(os.listdir(os.path.join(APP, "img")))}
shim = (
    "window.__IMG = " + "{" + ",".join(f'"{os.path.splitext(f)[0]}":"{u}"' for f, u in imgs.items()) + "};\n"
    "(function () { var map = {}; for (var k in window.__IMG) map['img/' + k + '.jpg'] = window.__IMG[k];\n"
    "  function fix(el) { if (el && el.tagName === 'IMG') { var s = el.getAttribute('src'); if (s && map[s]) el.setAttribute('src', map[s]); } }\n"
    "  new MutationObserver(function (ms) { ms.forEach(function (m) { if (m.type === 'attributes') fix(m.target);\n"
    "    m.addedNodes.forEach(function (n) { if (n.nodeType !== 1) return; fix(n); if (n.querySelectorAll) n.querySelectorAll('img').forEach(fix); }); }); })\n"
    "  .observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] }); })();"
)

# 3. scripts, inlined in place (three.js stays on the CDN)
for name in ["data.js", "engine.js", "scenes.js", "ui.js", "play.js", "dash.js"]:
    js = read(name).replace("</script", "<\\/script")
    html = html.replace(f'<script src="{name}"></script>', f"<script>/* {name} */\n{js}\n</script>")
html = html.replace('<script src="https://cdnjs', "<script>\n" + shim + "\n</script>\n<script src=\"https://cdnjs", 1)

left = re.findall(r'<script src="(?!https?:)[^"]+"', html) + re.findall(r'href="(?!https?:|#)[^"]+\.css"', html)
if left:
    raise SystemExit(f"Not inlined: {left}")
with open(OUT, "w", encoding="utf-8") as f:
    f.write(html)
print(f"Wrote {OUT} ({os.path.getsize(OUT) / 1e6:.2f} MB, {len(imgs)} pictures embedded)")

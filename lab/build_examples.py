"""Publishes checked pairs from the study as free examples, and the study table for the page."""
import json, pathlib, shutil
from PIL import Image

LAB = pathlib.Path(__file__).parent
PUB = LAB.parent / "public" / "examples"
R = json.loads((LAB / "study" / "results.json").read_text())
PICKS = [("face1_trick", "face1/trick", "Soft focus, bright light, warm filter"),
         ("face3_real", "face3/real", "Real skin change, same camera"),
         ("face1_mixed", "face1/mixed", "Real change plus camera tricks")]
KEYS = ("shownBefore", "shownAfter", "fairBefore", "fairAfter")
ACT = ["pore", "texture", "wrinkle", "age_spot", "acne", "radiance"]


def totals(r):
    shown = {a: r["shownAfter"][a] - r["shownBefore"][a] for a in ACT}
    fair = {a: r["fairAfter"][a] - r["fairBefore"][a] for a in ACT}
    return sum(max(v, 0) for v in shown.values()), sum(min(max(shown[a], 0), max(fair[a], 0)) for a in ACT)


examples = []
for eid, key, title in PICKS:
    if key not in R:
        continue
    d = PUB / eid
    d.mkdir(parents=True, exist_ok=True)
    src = LAB / "study" / "pairs" / eid
    for k in KEYS:
        im = Image.open(src / f"{k}.jpg")
        im.thumbnail((720, 936), Image.LANCZOS)
        im.save(d / f"{k}.jpg", quality=86)
    (d / "result.json").write_text(json.dumps({"facts": R[key]["facts"], "scores": {k: R[key][k] for k in KEYS}}))
    examples.append({"id": eid, "title": title})

study = []
for name, kind in (("Camera tricks, no skin change", "trick"), ("Real skin change", "real"),
                   ("Real change plus camera tricks", "mixed"), ("Same photo, copied", "null")):
    rows = [v for k, v in R.items() if k.endswith("/" + kind)]
    if not rows:
        continue
    pairs = [totals(v) for v in rows]
    shown, left = sum(p[0] for p in pairs), sum(p[1] for p in pairs)
    study.append({"name": name, "pairs": len(rows), "shown": f"+{shown / len(rows):.0f} pts",
                  "left": f"+{left / len(rows):.0f} pts ({left / shown:.0%})" if shown > 12 * len(rows) else f"+{left / len(rows):.0f} pts"})
(PUB / "index.json").write_text(json.dumps({"examples": examples, "study": study}, indent=1))
print(json.dumps(study, indent=1))

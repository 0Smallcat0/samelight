"""Validity study: does the browser pipeline remove camera tricks and keep real skin change?"""
import base64, hashlib, json, pathlib, sys, time
from concurrent.futures import ThreadPoolExecutor
from PIL import Image, ImageEnhance, ImageFilter
from playwright.sync_api import sync_playwright
import yc

LAB = pathlib.Path(__file__).parent
OUT = LAB / "study"
OUT.mkdir(exist_ok=True)
CACHE = OUT / "scores.json"
ACTIONS = ["pore", "texture", "wrinkle", "age_spot", "acne", "radiance"]
SIM = dict(wrinkle=.7, pores=.7, acne=.8, spots=.7, texture=.6, redness=.5)
FACES = ["face1", "face2", "face3"]


def warm(im):
    r, g, b = im.split()
    return Image.merge("RGB", (r.point(lambda v: min(255, v * 1.08)), g, b.point(lambda v: v * .92)))


def trick(im, sigma=2.0):
    im = im.filter(ImageFilter.GaussianBlur(sigma))
    im = ImageEnhance.Brightness(warm(im)).enhance(1.2)
    return im.resize((int(im.width * .7), int(im.height * .7)), Image.LANCZOS)


def null(im):
    return im.transform(im.size, Image.AFFINE, (1, 0, 6, 0, 1, -4), Image.BICUBIC)


def cases():
    out = {}
    for f in FACES:
        base = OUT / f"{f}_base.jpg"
        src = Image.open(LAB / f"{f}.jpg").convert("RGB")
        if not base.exists():
            src.resize((1000, int(src.height * 1000 / src.width)), Image.LANCZOS).save(base, quality=95)
        b = Image.open(base)
        sim = OUT / f"{f}_sim.jpg"
        if not sim.exists():
            raw = OUT / f"{f}_simraw.jpg"
            if f == "face1":
                raw.write_bytes((LAB / "sim_base.jpg").read_bytes())
            else:
                yc.skinsim(base, raw, **SIM)
            Image.open(raw).convert("RGB").resize(b.size, Image.LANCZOS).save(sim, quality=95)
        s = Image.open(sim)
        made = {"trick": (trick(b), 80), "real": (s, 95), "null": (null(b), 88)}
        if f == "face1":
            made["mixed"] = (trick(s), 80)
        for name, (im, q) in made.items():
            p = OUT / f"{f}_{name}.jpg"
            if not p.exists():
                im.save(p, quality=q)
            out[f"{f}/{name}"] = (base.name, p.name)
    return out


def browser_pass(pairs):
    done = {}
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        pg = br.new_page()
        pg.on("pageerror", lambda e: print("PAGE ERROR", e, flush=True))

        def serve(route):
            path = route.request.url.split("localhost:8799/")[1]
            if path == "":
                return route.fulfill(path=str(LAB / "study_probe.html"), content_type="text/html")
            if path == "samelight.js":
                return route.fulfill(path=str(LAB.parent / "public" / "samelight.js"), content_type="text/javascript")
            return route.fulfill(path=str(OUT / path), content_type="image/jpeg")

        pg.route("http://localhost:8799/**", serve)
        pg.goto("http://localhost:8799/")
        for key, (b, a) in pairs.items():
            t = time.time()
            r = pg.evaluate("([b,a])=>window.run(b,a)", [f"/{b}", f"/{a}"])
            d = OUT / "pairs" / key.replace("/", "_")
            d.mkdir(parents=True, exist_ok=True)
            for k in ("shownBefore", "shownAfter", "fairBefore", "fairAfter"):
                (d / f"{k}.jpg").write_bytes(base64.b64decode(r[k]))
            done[key] = r["facts"]
            print(key, f"{time.time() - t:.1f}s", json.dumps(r["facts"]), flush=True)
        br.close()
    return done


def scores_of(path, cache):
    h = hashlib.sha1(path.read_bytes()).hexdigest()
    if h in cache:
        return cache[h]
    d = yc.skin(path, ACTIONS)
    s = {i["type"]: i["raw_score"] for i in d["results"]["output"] if "raw_score" in i and i["type"] in ACTIONS}
    cache[h] = s
    CACHE.write_text(json.dumps(dict(cache), indent=0))
    return s


def main():
    pairs = cases()
    if "--only" in sys.argv:
        want = sys.argv[sys.argv.index("--only") + 1].split(",")
        pairs = {k: v for k, v in pairs.items() if k in want}
    facts = browser_pass(pairs)
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    start = yc.credit()
    results = {}
    jobs = []
    for key in pairs:
        d = OUT / "pairs" / key.replace("/", "_")
        for k in ("shownBefore", "shownAfter", "fairBefore", "fairAfter"):
            jobs.append((key, k, d / f"{k}.jpg"))
    with ThreadPoolExecutor(3) as ex:
        got = list(ex.map(lambda j: scores_of(j[2], cache), jobs))
    for (key, k, _), s in zip(jobs, got):
        results.setdefault(key, {"facts": facts[key]})[k] = s
    CACHE.write_text(json.dumps(cache, indent=0))
    old = json.loads((OUT / "results.json").read_text()) if (OUT / "results.json").exists() else {}
    (OUT / "results.json").write_text(json.dumps({**old, **results}, indent=1))
    print("spent", start - yc.credit(), "left", yc.credit())
    for key, r in results.items():
        shown = {a: r["shownAfter"][a] - r["shownBefore"][a] for a in ACTIONS}
        fair = {a: r["fairAfter"][a] - r["fairBefore"][a] for a in ACTIONS}
        claimed = sum(max(v, 0) for v in shown.values())
        kept = sum(min(max(shown[a], 0), max(fair[a], 0)) for a in ACTIONS)
        print(f"{key:14} claimed {claimed:6.1f} kept {kept:6.1f} share {kept / claimed if claimed else 0:.2f} | "
              + " ".join(f"{a[:4]} {shown[a]:+.0f}>{fair[a]:+.0f}" for a in ACTIONS))


main()

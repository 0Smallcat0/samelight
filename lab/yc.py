"""Thin YouCam API client for lab experiments."""
import json, os, time, pathlib, requests

ROOT = pathlib.Path(__file__).resolve().parent.parent
for line in (ROOT / ".env").read_text().splitlines():
    if "=" in line:
        k, v = line.split("=", 1)
        os.environ.setdefault(k, v)
BASE = "https://yce-api-01.makeupar.com"
H = {"Authorization": f"Bearer {os.environ['YOUCAM_API_KEY']}", "Content-Type": "application/json"}

SD = ["wrinkle", "droopy_upper_eyelid", "droopy_lower_eyelid", "firmness", "acne", "moisture", "eye_bag",
      "dark_circle_v2", "age_spot", "radiance", "redness", "oiliness", "pore", "texture"]


def credit():
    r = requests.get(f"{BASE}/s2s/v1.0/client/credit", headers=H, timeout=30).json()
    return sum(x["amount_dec"] for x in r["results"])


def poll(path, tid, every=1.5, limit=180):
    t0 = time.time()
    while time.time() - t0 < limit:
        r = requests.get(f"{BASE}{path}/{tid}", headers=H, timeout=30).json()
        d = r.get("data", r)
        st = d.get("task_status")
        if st == "success":
            return d
        if st == "error" or r.get("status", 200) >= 400:
            raise RuntimeError(json.dumps(r)[:500])
        time.sleep(every)
    raise TimeoutError(tid)


def upload(path, feature):
    p = pathlib.Path(path)
    ctype = "image/png" if p.suffix == ".png" else "image/jpeg"
    b = p.read_bytes()
    r = requests.post(f"{BASE}/s2s/v2.0/file/{feature}", headers=H, timeout=30,
                      json={"files": [{"content_type": ctype, "file_name": p.name, "file_size": len(b)}]}).json()
    f = r["data"]["files"][0]
    q = f["requests"][0]
    u = requests.put(q["url"], data=b, headers=q["headers"], timeout=120)
    u.raise_for_status()
    return f["file_id"]


def text2img(prompt, out, negative=None, size="1104*1472"):
    body = {"model": "youcam-image-v2", "prompt": prompt, "size": size}
    if negative:
        body["negative_prompt"] = negative
    r = requests.post(f"{BASE}/s2s/v2.0/task/text-to-image/youcam", headers=H, json=body, timeout=60).json()
    tid = r.get("data", {}).get("task_id")
    if not tid:
        raise RuntimeError(json.dumps(r)[:500])
    d = poll("/s2s/v2.0/task/text-to-image/youcam", tid)
    url = json.dumps(d)
    import re
    u = re.search(r'https://[^"]+', url).group(0)
    pathlib.Path(out).write_bytes(requests.get(u, timeout=120).content)
    return d


def skin(path, actions=SD, version="v2.1"):
    fid = upload(path, "skin-analysis")
    body = {"src_file_id": fid, "dst_actions": actions, "format": "json",
            "miniserver_args": {"enable_mask_overlay": False}}
    r = requests.post(f"{BASE}/s2s/{version}/task/skin-analysis", headers=H, json=body, timeout=60).json()
    tid = r.get("data", {}).get("task_id")
    if not tid:
        raise RuntimeError(json.dumps(r)[:500])
    return poll(f"/s2s/{version}/task/skin-analysis", tid)


def skinsim(path, out, **levels):
    fid = upload(path, "skin-simulation")
    r = requests.post(f"{BASE}/s2s/v2.0/task/skin-simulation", headers=H, timeout=60,
                      json={"src_file_id": fid, **levels}).json()
    tid = r.get("data", {}).get("task_id")
    if not tid:
        raise RuntimeError(json.dumps(r)[:500])
    d = poll("/s2s/v2.0/task/skin-simulation", tid)
    import re
    u = re.search(r'https://[^"]+', json.dumps(d)).group(0)
    pathlib.Path(out).write_bytes(requests.get(u, timeout=120).content)
    return d

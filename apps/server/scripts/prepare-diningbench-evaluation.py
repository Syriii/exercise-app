"""Extract a fixed, small Chinese-meal pilot from the official DiningBench archive stream.

Usage: curl -L --fail OFFICIAL_ARCHIVE_URL | python3 prepare-diningbench-evaluation.py ANNOTATIONS.jsonl PRIVATE_DIR
No model is called. The manifest records the archive revision and original image paths.
"""
import hashlib
import json
import os
import re
import sys
import tarfile
from pathlib import Path

REVISION = "77296fce4f7bfef305d3b134a0180f2c27024fa3"
ARCHIVE = f"https://huggingface.co/datasets/meituan/DiningBench/resolve/{REVISION}/images.tar.gz"
MEAL = re.compile(r"饭|面|米线|米粉|饺|包子|馄饨|粥|炒菜|盖浇|套餐")
EXCLUDE = re.compile(r"沙拉|蛋糕|冰淇淋|雪花冰|咖啡|披萨|牛排|寿司|意面|汉堡|三明治")

if len(sys.argv) != 3:
    raise SystemExit("usage: prepare-diningbench-evaluation.py ANNOTATIONS.jsonl PRIVATE_DIR")
annotations_path = Path(sys.argv[1]).resolve()
output = Path(sys.argv[2]).resolve()
output.mkdir(mode=0o700, parents=True, exist_ok=False)
annotation_bytes = annotations_path.read_bytes()
eligible = {}
for line in annotation_bytes.splitlines():
    row = json.loads(line)
    truth = row["ground_truth"]
    name = truth["精炼菜品名称"]
    if not MEAL.search(name) or EXCLUDE.search(name):
        continue
    user_images = row.get("user_images") or []
    source = user_images[0] if user_images else ""
    if re.fullmatch(r"images/\d{5}_\d+\.jpg", source):
        eligible[source] = row

samples = []
with tarfile.open(fileobj=sys.stdin.buffer, mode="r|gz") as archive:
    for member in archive:
        if len(samples) == 20:
            break
        row = eligible.get(member.name)
        if row is None or not member.isfile() or member.size > 10 * 1024 * 1024:
            continue
        source = archive.extractfile(member)
        if source is None:
            continue
        data = source.read()
        if not data.startswith(b"\xff\xd8\xff"):
            continue
        name = f"dining_{row['id']:05d}.jpg"
        path = output / name
        with path.open("xb") as target:
            os.chmod(path, 0o600)
            target.write(data)
        truth = row["ground_truth"]
        values = {"energyKcal": truth["卡路里"], "proteinGrams": truth["蛋白质"],
                  "carbohydrateGrams": truth["碳水化合物"], "fatGrams": truth["脂肪"], "massGrams": None}
        if not all(isinstance(value, (int, float)) and value >= 0 for value in values.values() if value is not None):
            raise RuntimeError(f"bad nutrition label: {member.name}")
        samples.append({"id": f"dining_{row['id']:05d}", "imagePath": str(path),
                        "imageSha256": hashlib.sha256(data).hexdigest(),
                        "sourceUrl": f"{ARCHIVE}#{member.name}", "contentType": "image/jpeg",
                        "dishName": truth["精炼菜品名称"], "truth": values})
if len(samples) != 20:
    raise RuntimeError(f"only {len(samples)} eligible images found")
manifest = {"schemaVersion": 1, "dataset": "DiningBench", "license": "CC-BY-NC-ND-4.0",
            "attribution": "Meituan DiningBench, Jin et al., ACL 2026",
            "annotationSha256": hashlib.sha256(annotation_bytes).hexdigest(),
            "archiveRevision": REVISION,
            "limitation": "Restaurant dish images; labels mix merchant facts with AI-assisted estimates. Not weighed cafeteria meals.",
            "samples": samples}
manifest_bytes = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode()
(output / "manifest.json").write_bytes(manifest_bytes)
os.chmod(output / "manifest.json", 0o600)
print(json.dumps({"sampleCount": len(samples), "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest(),
                  "directory": str(output), "modelCalls": 0}))

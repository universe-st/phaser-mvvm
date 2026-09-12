#!/usr/bin/env python3
"""Sample pixels of a PNG and compare them against expected colours (Pillow-based).

Input: a JSON spec on argv[1] shaped like

    {"png": "shot.png", "scale": 1.0, "checks": [{"label": "card", "x": 640, "y": 316, "rgb": [31, 111, 235]}]}

Prints one line per check (`OK` / `MISMATCH`) and exits non-zero when anything mismatches or the
sampled point falls outside the image.
"""

import json
import sys

try:
    from PIL import Image
except ImportError:  # pragma: no cover - environment guard
    print("SKIP: Pillow is not installed")
    sys.exit(0)


def main() -> int:
    with open(sys.argv[1], encoding="utf-8") as handle:
        spec = json.load(handle)

    image = Image.open(spec["png"]).convert("RGB")
    scale = float(spec.get("scale", 1.0))
    width, height = image.size
    failures = 0

    for check in spec["checks"]:
        x = int(round(check["x"] * scale))
        y = int(round(check["y"] * scale))
        expected = tuple(check["rgb"])
        label = check["label"]

        if x < 0 or y < 0 or x >= width or y >= height:
            print(f"MISMATCH {label}: sample ({x},{y}) outside {width}x{height}")
            failures += 1
            continue

        actual = image.getpixel((x, y))
        if actual == expected:
            print(f"OK       {label}: #{expected[0]:02x}{expected[1]:02x}{expected[2]:02x} at ({x},{y})")
        else:
            print(
                f"MISMATCH {label}: expected "
                f"#{expected[0]:02x}{expected[1]:02x}{expected[2]:02x} got "
                f"#{actual[0]:02x}{actual[1]:02x}{actual[2]:02x} at ({x},{y})"
            )
            failures += 1

    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

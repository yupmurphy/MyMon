"""MyMon's app icon — run with: py -m pip install Pillow && py tools/make_icons.py

Writes icon-512, icon-192, apple-touch-icon, icon-maskable-512 and favicon.ico
into the project root, so they can never drift apart from each other.


One idea, not three: a rounded green tile and the letter, drawn in the same
rounded geometry as the Nunito the site is set in. The old icon was the whole
wordmark shrunk down, which turns to mush below about 64px — a home screen and
a browser tab both show it far smaller than that.
"""
from PIL import Image, ImageDraw

WHITE = (255, 255, 255, 255)
B500, B700 = (95, 170, 85), (47, 107, 53)
S = 4                                  # supersample; Pillow does not antialias shapes


def rounded_m(d, box, width, fill):
    """Four strokes with a disc at every vertex. One polyline with
    joint='curve' left a dent where the segments met."""
    x0, y0, x1, y1 = box
    h = width / 2
    left, right, top, bottom = x0 + h, x1 - h, y0 + h, y1 - h
    mid = (left + right) / 2
    pts = [(left, bottom), (left, top), (mid, top + (bottom - top) * 0.56),
           (right, top), (right, bottom)]
    for a, b in zip(pts, pts[1:]):
        d.line([a, b], fill=fill, width=int(width))
    for p in pts:
        d.ellipse([p[0] - h, p[1] - h, p[0] + h, p[1] + h], fill=fill)


def gradient(u):
    g = Image.new('RGB', (1, u))
    for y in range(u):
        t = y / max(1, u - 1)
        g.putpixel((0, y), tuple(round(B500[i] + (B700[i] - B500[i]) * t) for i in range(3)))
    return g.resize((u, u), Image.BICUBIC).convert('RGBA')


def icon(size, radius_pct=0.225, letter=0.40):
    """radius_pct 0 gives a full square — what Apple and an Android mask both
    want, since each cuts its own shape. letter is the M's width as a share of
    the tile, kept small on the maskable one so it survives a circular crop."""
    u = size * S
    mask = Image.new('L', (u, u), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, u - 1, u - 1],
                                           radius=u * radius_pct, fill=255)
    img = Image.new('RGBA', (u, u), (0, 0, 0, 0))
    img.paste(gradient(u), (0, 0), mask)

    d = ImageDraw.Draw(img)
    w, hgt = u * letter, u * letter * 0.91
    c = u / 2
    rounded_m(d, [c - w / 2, c - hgt / 2, c + w / 2, c + hgt / 2], u * letter * 0.228, WHITE)
    return img.resize((size, size), Image.LANCZOS)


icon(512).save('icon-512.png')
icon(192).save('icon-192.png')
icon(180, radius_pct=0).save('apple-touch-icon.png')          # iOS masks it itself
icon(512, radius_pct=0, letter=0.46).save('icon-maskable-512.png')  # inside the safe zone

ico = icon(256)
ico.save('favicon.ico', sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
print('icons written')

"""MyMon's app icon — run with: py -m pip install Pillow && py tools/make_icons.py

Writes icon-512, icon-192, apple-touch-icon, icon-maskable-512 and favicon.ico
into the project root, so they can never drift apart from each other.


One idea, not three: a rounded green tile and the letter, drawn in the same
rounded geometry as the Nunito the site is set in. The wordmark shrunk down
turns to mush below about 64px, and a home screen and a browser tab both show
the icon far smaller than that.

Three things changed in the second drawing of it:

  The light runs across the diagonal, not straight down, and there is a soft
  glow in the top-left corner. Every other icon on a phone's home screen is
  lit from above and to the left; a flat vertical ramp is the one that looks
  like a placeholder among them.

  The green starts brighter and ends deeper, so the tile has somewhere to go.
  The old one began halfway down its own range and read as one dull colour.

  The M's middle vertex descends much further. At 56% of the height the notch
  all but closed at small sizes and the letter went to a blob; at 66% it is
  still a clear V at 32px.
"""
import math
from PIL import Image, ImageDraw, ImageFilter

WHITE = (255, 255, 255, 255)

# The tile's two greens. Brighter than the brand's own --brand-500 on purpose:
# an icon is seen at 40px against a photograph, not as a block of page.
TOP, FOOT = (118, 196, 96), (37, 110, 51)

S = 4                                  # supersample; Pillow does not antialias shapes


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient(u):
    """Light at the top left, deep at the bottom right."""
    img = Image.new('RGB', (u, u))
    px = img.load()
    span = 2.0 * (u - 1)
    for y in range(u):
        for x in range(u):
            px[x, y] = lerp(TOP, FOOT, (x + y) / span)
    return img.convert('RGBA')


def glow(u):
    """A soft light in the top-left corner. Drawn into a mask and blurred,
    which is both faster and smoother than computing a falloff per pixel."""
    m = Image.new('L', (u, u), 0)
    cx, cy, r = u * 0.28, u * 0.22, u * 0.62
    ImageDraw.Draw(m).ellipse([cx - r, cy - r, cx + r, cy + r], fill=46)
    m = m.filter(ImageFilter.GaussianBlur(u * 0.22))

    light = Image.new('RGBA', (u, u), (255, 255, 255, 255))
    light.putalpha(m)
    return light


def rounded_m(d, box, width, fill, valley):
    """Four strokes with a disc at every vertex. One polyline with
    joint='curve' left a dent where the segments met."""
    x0, y0, x1, y1 = box
    h = width / 2.0
    left, right, top, bottom = x0 + h, x1 - h, y0 + h, y1 - h
    mid = (left + right) / 2.0
    pts = [(left, bottom), (left, top), (mid, top + (bottom - top) * valley),
           (right, top), (right, bottom)]
    for a, b in zip(pts, pts[1:]):
        d.line([a, b], fill=fill, width=int(round(width)))
    for p in pts:
        d.ellipse([p[0] - h, p[1] - h, p[0] + h, p[1] + h], fill=fill)


def icon(size, radius_pct=0.225, letter=0.44, valley=0.66):
    """radius_pct 0 gives a full square — what Apple and an Android mask both
    want, since each cuts its own shape. letter is the M's width as a share of
    the tile; the maskable one keeps it smaller so the letter stays well
    inside the circle a launcher may crop to."""
    u = size * S

    mask = Image.new('L', (u, u), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, u - 1, u - 1],
                                           radius=u * radius_pct, fill=255)

    img = Image.new('RGBA', (u, u), (0, 0, 0, 0))
    img.paste(Image.alpha_composite(gradient(u), glow(u)), (0, 0), mask)

    w = u * letter
    hgt = w * 0.91
    c = u / 2.0
    rounded_m(ImageDraw.Draw(img),
              [c - w / 2, c - hgt / 2, c + w / 2, c + hgt / 2],
              w * 0.215, WHITE, valley)

    return img.resize((size, size), Image.LANCZOS)


icon(512).save('icon-512.png')
icon(192).save('icon-192.png')
icon(180, radius_pct=0).save('apple-touch-icon.png')          # iOS masks it itself
icon(512, radius_pct=0, letter=0.40).save('icon-maskable-512.png')  # inside the safe zone

ico = icon(256)
ico.save('favicon.ico', sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
print('icons written')

"""Writes the landing-page artboards for the 'Splitbook web portal concepts' canvas.

One template, three boards: desktop light, desktop dark and phone (390) light.
Run: python3 -I make_landing.py  (writes into ./project/)
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "project")
os.makedirs(OUT, exist_ok=True)

FIG2 = {"light": "/_blob/8a230434656d6afff5260d39e0b1be66", "dark": "/_blob/16afad9443f987c54b735241d0223322"}
FIG3 = {"light": "/_blob/2632a986ef26a7ece792e6011282f2c9", "dark": "/_blob/76613388e4b9d56716efaf7ea9f542be"}
FIG1 = {"light": "/_blob/474b55db632240a394fefcaa5a6e2c1d", "dark": "/_blob/468de78bcb97dcbb78eb21e5764aebaf"}

# Semantic tokens from packages/shared/src/design-tokens.ts (the Splitbook design system).
TOKENS = {
    "light": {
        "brand": "#3d4fcf", "brand-dark": "#3240b0", "brand-bg": "#e8ebff", "on-brand": "#ffffff",
        "info": "#0b8fd9", "info-bg": "#e3f4fd", "status-info": "#086ba8",
        "positive": "#1a9a6e", "positive-bg": "#e3f7ef", "status-positive": "#0d7654",
        "negative": "#e04f3d", "negative-bg": "#fde9e6", "status-negative": "#b93628",
        "warning-bg": "#fef3e0", "status-warning": "#875407",
        "bg": "#f4f5f9", "bg-elevated": "#ffffff", "surface": "#ffffff", "surface-muted": "#eef0f6",
        "border": "#dce0ec", "border-strong": "#c5cbdb",
        "text": "#151828", "text-secondary": "#4a5168", "text-muted": "#6b7289",
        "strip-start": "#2f3db8", "strip-mid": "#3d4fcf", "strip-end": "#4a62e0", "strip-text": "#ffffff",
        "strip-muted": "rgba(255, 255, 255, 0.72)", "strip-perforation": "#f4f5f9", "strip-stub": "rgba(255, 255, 255, 0.12)",
        "plate": "#fbfbfa", "plate-line": "#dcdcd9", "plate-ink": "#57575a",
        "shadow-sm": "0 1px 2px rgba(21, 24, 40, 0.05)", "shadow-md": "0 4px 16px rgba(21, 24, 40, 0.07)",
        "focus": "#3d4fcf",
    },
    "dark": {
        "brand": "#7b8cff", "brand-dark": "#6a7cf0", "brand-bg": "#232849", "on-brand": "#0e1016",
        "info": "#4db4ef", "info-bg": "#163246", "status-info": "#4db4ef",
        "positive": "#3dca96", "positive-bg": "#17362b", "status-positive": "#3dca96",
        "negative": "#f07162", "negative-bg": "#3a221f", "status-negative": "#f07162",
        "warning-bg": "#322614", "status-warning": "#e0a73a",
        "bg": "#0e1016", "bg-elevated": "#161922", "surface": "#181b26", "surface-muted": "#222634",
        "border": "#2c3142", "border-strong": "#3d445a",
        "text": "#f0f2f8", "text-secondary": "#b4bace", "text-muted": "#858da3",
        "strip-start": "#252f7a", "strip-mid": "#3544a8", "strip-end": "#3f52c4", "strip-text": "#f5f7ff",
        "strip-muted": "rgba(245, 247, 255, 0.7)", "strip-perforation": "#0e1016", "strip-stub": "rgba(255, 255, 255, 0.08)",
        "plate": "#131313", "plate-line": "#2a2a2a", "plate-ink": "#a3a3a3",
        "shadow-sm": "0 1px 2px rgba(0, 0, 0, 0.35)", "shadow-md": "0 6px 20px rgba(0, 0, 0, 0.4)",
        "focus": "#9aa6ff",
    },
}


def tokens_css(mode):
    return ";".join(f"--{k}:{v}" for k, v in TOKENS[mode].items())


# ---------------------------------------------------------------- icons (inline stroke svg)
def icon(name, size=20):
    paths = {
        "google": '<path d="M20 12.2c0-.6-.1-1.2-.2-1.7H12v3.3h4.5a3.9 3.9 0 0 1-1.7 2.5v2.1h2.7c1.6-1.5 2.5-3.6 2.5-6.2Z"></path><path d="M12 20.5c2.3 0 4.2-.8 5.5-2.1l-2.7-2.1c-.8.5-1.7.8-2.8.8a4.9 4.9 0 0 1-4.6-3.4H4.6v2.2A8.5 8.5 0 0 0 12 20.5Z"></path><path d="M7.4 13.7a5 5 0 0 1 0-3.4V8.1H4.6a8.5 8.5 0 0 0 0 7.8l2.8-2.2Z"></path><path d="M12 6.9c1.3 0 2.4.4 3.3 1.3l2.4-2.4A8.4 8.4 0 0 0 4.6 8.1l2.8 2.2A4.9 4.9 0 0 1 12 6.9Z"></path>',
        "play": '<path d="M6 4.2v15.6a.8.8 0 0 0 1.2.7l13-7.8a.8.8 0 0 0 0-1.4l-13-7.8A.8.8 0 0 0 6 4.2Z"></path>',
        "arrow": '<path d="M5 12h14"></path><path d="m13 6 6 6-6 6"></path>',
        "plane": '<path d="M3 13.5 21 7l-2.6 4.4L21 17 3 10.5"></path><path d="m8.5 11.6 1.6 5.4"></path>',
        "home": '<path d="M4 10.5 12 4l8 6.5"></path><path d="M6 9v10.5h12V9"></path><path d="M10 19.5v-5h4v5"></path>',
        "heart": '<path d="M12 19.5s-7.5-4.4-7.5-9.6A4.1 4.1 0 0 1 12 7.6a4.1 4.1 0 0 1 7.5 2.3c0 5.2-7.5 9.6-7.5 9.6Z"></path>',
        "case": '<rect x="3.5" y="7.5" width="17" height="12" rx="2"></rect><path d="M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5"></path><path d="M3.5 12.5h17"></path>',
        "grid": '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"></rect><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"></rect><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"></rect><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"></rect>',
        "chat": '<path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V16.5H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5Z"></path>',
        "tray": '<path d="M4 13.5 6.5 5h11L20 13.5"></path><path d="M4 13.5h4.5l1.5 2.5h4l1.5-2.5H20V19H4Z"></path>',
        "check": '<path d="m5 12.5 4.5 4.5L19 7.5"></path>',
        "shield": '<path d="M12 3.5 19 6v5.5c0 4.4-3 7.8-7 9-4-1.2-7-4.6-7-9V6Z"></path><path d="m9 12 2.2 2.2L15.5 10"></path>',
        "unplug": '<path d="M9 7V3.5M15 7V3.5"></path><path d="M6.5 7h11v3.5a5.5 5.5 0 0 1-11 0Z"></path><path d="M12 16v4.5"></path>',
        "phone": '<rect x="7" y="2.5" width="10" height="19" rx="2.5"></rect><path d="M10.5 18.5h3"></path>',
        "monitor": '<rect x="3" y="4.5" width="18" height="12" rx="2"></rect><path d="M9 20h6M12 16.5V20"></path>',
        "history": '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"></path><path d="M4 4.5V8h3.5"></path><path d="M12 8v4.5l3 1.8"></path>',
        "scale": '<path d="M12 4v16M6 20h12"></path><path d="M5 8h14"></path><path d="m5 8-2.5 6a2.5 2.5 0 0 0 5 0Z"></path><path d="m19 8-2.5 6a2.5 2.5 0 0 0 5 0Z"></path>',
        "lock": '<rect x="5" y="10.5" width="14" height="10" rx="2"></rect><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"></path>',
    }
    fill = "currentColor" if name in ("google", "play") else "none"
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="{fill}" stroke="{"none" if fill != "none" else "currentColor"}" '
            f'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{paths[name]}</svg>')


MONO = "font-family: 'IBM Plex Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums"
WRAP = "width: 100%; max-width: 1200px; margin: 0 auto; padding: 0 clamp(16px, 4vw, 40px); box-sizing: border-box"


def btn_primary(label, href, ic=None, big=False):
    pad = "0 24px" if big else "0 18px"
    h = "52px" if big else "44px"
    return (f'<a class="sbl-btn" href="{href}" style="display: inline-flex; align-items: center; justify-content: center; gap: 10px; min-height: {h}; padding: {pad}; '
            f'border-radius: 8px; background: var(--brand); color: var(--on-brand); font-weight: 600; font-size: {16 if big else 15}px; text-decoration: none">'
            f'{icon(ic) if ic else ""}{label}</a>')


def btn_outline(label, href, ic=None, big=False):
    pad = "0 22px" if big else "0 16px"
    h = "52px" if big else "44px"
    return (f'<a class="sbl-btn" href="{href}" style="display: inline-flex; align-items: center; justify-content: center; gap: 10px; min-height: {h}; padding: {pad}; '
            f'border-radius: 8px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--text); font-weight: 600; '
            f'font-size: {16 if big else 15}px; text-decoration: none">{icon(ic, 18) if ic else ""}{label}</a>')


def eyebrow(text, color="var(--brand)"):
    return (f'<p style="margin: 0; font-size: 13px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: {color}">{text}</p>')


def h2(text):
    return (f'<h2 style="margin: 0; font-size: clamp(28px, 3.2vw, 40px); line-height: 1.12; font-weight: 700; letter-spacing: -0.025em; '
            f'color: var(--text); text-wrap: balance">{text}</h2>')


def lead(text, maxw=620):
    return f'<p style="margin: 0; max-width: {maxw}px; font-size: 18px; line-height: 1.55; color: var(--text-secondary); text-wrap: pretty">{text}</p>'


def card(inner, pad="24px", extra=""):
    return (f'<div style="background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: {pad}; '
            f'box-shadow: var(--shadow-sm); box-sizing: border-box; {extra}">{inner}</div>')


def money(v, tone=None, size=15, weight=500):
    color = {"pos": "var(--status-positive)", "neg": "var(--status-negative)"}.get(tone, "var(--text)")
    return f'<span style="{MONO}; font-size: {size}px; font-weight: {weight}; color: {color}; letter-spacing: -0.01em">{v}</span>'


def avatar(letter, bg):
    return (f'<span aria-hidden="true" style="display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; '
            f'border-radius: 50%; background: {bg}; color: var(--text); font-size: 13px; font-weight: 600; flex: none">{letter}</span>')


# ---------------------------------------------------------------- sections
def nav(mode):
    logo = "brand/logo-dark.svg" if mode == "dark" else "brand/logo-light.svg"
    links = "".join(
        f'<a href="#{h}" style="color: var(--text-secondary); text-decoration: none; font-size: 15px; font-weight: 500">{t}</a>'
        for t, h in [("How it works", "how"), ("Groups", "groups"), ("Assistants", "assistants"), ("Pricing", "pricing")]
    )
    return f'''<header style="position: relative; border-bottom: 1px solid var(--border); background: var(--bg-elevated)">
<nav aria-label="Splitbook" style="{WRAP}; min-height: 68px; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap">
<a href="#top" style="display: inline-flex; align-items: center"><img src="{logo}" alt="Splitbook home" width="124" height="32" style="height: 32px; width: auto; display: block"></a>
<div class="sbl-links" style="display: flex; align-items: center; gap: 28px; flex-wrap: wrap">{links}</div>
<div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap">
<a class="sbl-links" href="#app" style="color: var(--text); text-decoration: none; font-size: 15px; font-weight: 600; padding: 10px 6px">Get the app</a>
{btn_primary("Sign in", "#signin")}
</div>
</nav>
</header>'''


def figure_plate(mode, fig, title, img, readout, alt, ratio="2340 / 1485"):
    corner = "font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--plate-ink)"
    return f'''<figure style="margin: 0; display: flex; flex-direction: column; gap: 12px">
<div style="position: relative; background: var(--plate); border: 1px solid var(--plate-line); border-radius: 16px; overflow: hidden; box-shadow: var(--shadow-md)">
<div style="display: flex; justify-content: space-between; gap: 12px; padding: 16px 20px 0; {corner}"><span style="text-transform: none; letter-spacing: 0.02em">{fig}</span><span>{title}</span></div>
<img src="{img}" alt="{alt}" style="display: block; width: 100%; height: auto; aspect-ratio: {ratio}">
<div style="display: flex; justify-content: flex-end; padding: 0 20px 16px; {corner}; text-transform: none; letter-spacing: 0.02em; color: var(--text-secondary)">{readout}</div>
</div>
</figure>'''


def hero(mode):
    img = FIG1[mode]
    plate = figure_plate(
        mode, "Fig 1", "The splitting line", img, "Groceries ₹1,000 · Sam paid · 5 × ₹200",
        "A small production line that splits Expenses. A saw cuts each Expense bar into one chip per share, and pneumatic pushers send each chip down a chute into its member's bin. While Groceries ₹1,000, paid by Sam, is being sorted, the bins for You, Priya, Sam and Alex read +900, +100, +500 and −500.",
        ratio="2580 / 1362",
    )
    legend = "".join(
        f'<span style="display: inline-flex; align-items: center; gap: 8px"><span aria-hidden="true" style="width: 10px; height: 10px; border-radius: {r}; background: {c}; display: inline-block"></span>{t}</span>'
        for c, r, t in [("var(--text-muted)", "2px", "Bins, left to right: You, Priya, Sam, Alex"), ("var(--status-positive)", "2px", "+ gets back"), ("var(--status-negative)", "2px", "− owes"), ("#f5b83d", "50%", "Lamp: who paid")]
    )
    return f'''<section id="top" style="padding: clamp(40px, 6vw, 80px) 0 clamp(48px, 6vw, 88px)">
<div style="{WRAP}; display: flex; flex-wrap: wrap; gap: clamp(24px, 4vw, 56px); align-items: flex-end">
<div style="flex: 1.2 1 520px; min-width: 0; display: flex; flex-direction: column; gap: 20px; align-items: flex-start">
<p style="margin: 0; display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 999px; background: var(--brand-bg); color: var(--brand); font-size: 13px; font-weight: 600">Shared expenses · Android and web</p>
<h1 style="margin: 0; font-size: clamp(40px, 5.6vw, 72px); line-height: 1.02; font-weight: 700; letter-spacing: -0.035em; color: var(--text); text-wrap: balance">Every shared cost, worked out to the paisa.</h1>
</div>
<div style="flex: 1 1 380px; min-width: 0; display: flex; flex-direction: column; gap: 20px; align-items: flex-start">
<p style="margin: 0; font-size: 19px; line-height: 1.55; color: var(--text-secondary); text-wrap: pretty">Trips, flats, couples and teams. Add what was paid, split it the way it happened, and Splitbook shows who owes whom, then settles it in the fewest payments.</p>
<div style="display: flex; gap: 12px; flex-wrap: wrap">
{btn_primary("Sign in with Google", "#signin", "google", big=True)}
{btn_outline("Get it on Google Play", "#app", "play", big=True)}
</div>
<a href="#assistants" style="display: inline-flex; align-items: center; gap: 8px; color: var(--status-info); font-size: 15px; font-weight: 600; text-decoration: none">Use Claude or ChatGPT? Connect Splitbook {icon("arrow", 18)}</a>
</div>
</div>
<div style="{WRAP}; margin-top: clamp(32px, 4vw, 56px); display: flex; flex-direction: column; gap: 12px">
{plate}
<div style="display: flex; flex-wrap: wrap; justify-content: space-between; gap: 10px 24px; padding: 0 4px">
<div style="display: flex; flex-wrap: wrap; gap: 8px 20px; font-size: 14px; color: var(--text-secondary)">{legend}</div>
<p style="margin: 0; font-size: 14px; color: var(--text-muted)">Each Expense is cut into one chip per share, and the counters always add up to zero. <a href="#fig1-live" style="color: var(--brand); font-weight: 600; text-decoration: none">Run the line</a></p>
</div>
</div>
</section>'''


def strip_mock():
    perforation = "".join(
        f'<span style="width: 10px; height: 10px; border-radius: 50%; background: var(--strip-perforation); display: block"></span>' for _ in range(6)
    )
    return f'''<div style="display: flex; border-radius: 16px; overflow: hidden; color: var(--strip-text); background: linear-gradient(135deg, var(--strip-start) 0%, var(--strip-mid) 55%, var(--strip-end) 100%)">
<div style="flex: 1 1 auto; padding: 18px 20px; display: flex; flex-direction: column; gap: 10px; min-width: 0">
<p style="margin: 0; font-size: 12px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--strip-muted)">Trip · 4 people</p>
<p style="margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.02em">Goa Weekend</p>
<div style="display: flex; align-items: center; gap: 10px; font-size: 14px; color: var(--strip-muted)"><span style="{MONO}; color: var(--strip-text); font-size: 15px">FRI 18</span><span style="flex: 1; height: 1px; background: var(--strip-muted); opacity: 0.6"></span>{icon("plane", 16)}<span style="flex: 1; height: 1px; background: var(--strip-muted); opacity: 0.6"></span><span style="{MONO}; color: var(--strip-text); font-size: 15px">SUN 20</span></div>
</div>
<div style="display: flex; flex-direction: column; justify-content: space-between; padding: 6px 0; margin-left: -5px">{perforation}</div>
<div style="flex: none; width: 112px; padding: 18px 16px; background: var(--strip-stub); display: flex; flex-direction: column; gap: 6px; justify-content: center">
<p style="margin: 0; font-size: 12px; color: var(--strip-muted)">Day 2</p>
<p style="margin: 0; {MONO}; font-size: 18px; font-weight: 600">₹2,800</p>
</div>
</div>'''


def groups(mode):
    def theme_card(ic, name, tagline, perk, body=""):
        return card(f'''<div style="display: flex; flex-direction: column; gap: 12px; height: 100%">
<span style="display: inline-flex; width: 40px; height: 40px; border-radius: 10px; align-items: center; justify-content: center; background: var(--brand-bg); color: var(--brand)">{icon(ic, 22)}</span>
<h3 style="margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.02em; color: var(--text)">{name}</h3>
<p style="margin: 0; font-size: 15px; line-height: 1.5; color: var(--text-secondary)">{tagline}</p>
<p style="margin: 0; font-size: 14px; line-height: 1.5; color: var(--text-muted)">{perk}</p>{body}</div>''')
    trip = card(f'''<div style="display: flex; flex-direction: column; gap: 16px">
<div style="display: flex; align-items: center; gap: 12px"><span style="display: inline-flex; width: 40px; height: 40px; border-radius: 10px; align-items: center; justify-content: center; background: var(--brand-bg); color: var(--brand)">{icon("plane", 22)}</span>
<h3 style="margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.02em; color: var(--text)">Trip</h3></div>
<p style="margin: 0; font-size: 15px; line-height: 1.5; color: var(--text-secondary)">A getaway with a crew: travel, stays and shared meals, from the first day to the last.</p>
{strip_mock()}
<div style="display: flex; flex-direction: column">{"".join(f'<div style="display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: center; padding: 10px 0; border-top: 1px solid var(--border)"><span style="font-size: 14px; color: var(--text)"><strong style="font-weight: 600">{d}</strong> <span style="color: var(--text-muted)">· {w} · {n}</span></span>{money(v, size=14)}</div>' for d, w, n, v in [("Day 1", "Fri 18 Oct", "4 Expenses", "₹6,420"), ("Day 2", "Sat 19 Oct", "3 Expenses", "₹2,800"), ("Day 3", "Sun 20 Oct", "2 Expenses", "₹3,150")])}</div>
<p style="margin: 0; font-size: 14px; line-height: 1.5; color: var(--text-muted)">A boarding-pass header, a setup checklist and a date range, with Expenses grouped by Trip day.</p>
</div>''', extra="height: 100%")
    month_rows = "".join(
        f'<div style="display: grid; grid-template-columns: 48px 1fr auto; gap: 10px; align-items: center"><span style="font-size: 13px; color: var(--text-muted)">{m}</span>'
        f'<span style="height: 8px; border-radius: 4px; background: var(--surface-muted); overflow: hidden; display: block"><span style="display: block; height: 8px; width: {w}%; background: {"var(--brand)" if cur else "var(--border-strong)"}"></span></span>'
        f'{money(v, size=13)}</div>'
        for m, w, v, cur in [("Aug", 78, "₹21,860", False), ("Sep", 84, "₹23,540", False), ("Oct", 64, "₹17,920", True)]
    )
    house = theme_card("home", "Household", "A long-running home ledger: rent, groceries and utilities.", "Month-by-month totals and a running balance.",
                       f'<div style="display: flex; flex-direction: column; gap: 8px; padding-top: 6px">{month_rows}</div>')
    return f'''<section id="groups" style="padding: clamp(56px, 7vw, 104px) 0; background: var(--bg-elevated); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border)">
<div style="{WRAP}; display: flex; flex-direction: column; gap: 40px">
<div style="display: flex; flex-direction: column; gap: 14px; max-width: 720px">{eyebrow("One app, every Group")}{h2("Not just trips. Every kind of shared money.")}{lead("Pick what the Group is for when you make it. Splitbook shapes its header, its dates and its starter Tags around it.")}</div>
<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap: 20px">
<div class="sbl-trip">{trip}</div>
{house}
{theme_card("heart", "Couple", "Shared spending for two: dinners, gifts and everyday costs.", "A clean shared ledger with a running balance.")}
{theme_card("case", "Work", "Team and project expenses: travel, meals and supplies.", "A clean shared ledger with a running balance.")}
{theme_card("grid", "General", "Any shared pool of money: Sunday football, a club, a gift fund.", "A clean shared ledger with a running balance.")}
</div>
</div>
</section>'''


def split_section(mode):
    rows = [("Y", "You", "2 shares", "₹400.00"), ("P", "Priya", "1 share", "₹200.00"), ("S", "Sam", "1 share", "₹200.00"), ("A", "Alex", "1 share", "₹200.00")]
    tints = {"Y": "var(--brand-bg)", "P": "var(--info-bg)", "S": "var(--positive-bg)", "A": "var(--warning-bg)"}
    row_html = "".join(
        f'<div style="display: grid; grid-template-columns: auto 1fr auto auto; gap: 12px; align-items: center; padding: 10px 0; border-top: 1px solid var(--border)">'
        f'{avatar(l, tints[l])}<span style="font-size: 15px; font-weight: 500; color: var(--text)">{n}</span>'
        f'<span style="font-size: 13px; color: var(--text-muted)">{s}</span>{money(v)}</div>'
        for l, n, s, v in rows
    )
    chips = "".join(
        f'<span style="padding: 6px 12px; border-radius: 8px; font-size: 13px; font-weight: 600; border: 1px solid {"var(--brand)" if on else "var(--border)"}; '
        f'background: {"var(--brand-bg)" if on else "var(--surface)"}; color: {"var(--brand)" if on else "var(--text-secondary)"}">{t}</span>'
        for t, on in [("Equally", False), ("Shares", True), ("Percent", False), ("Exact", False)]
    )
    expense = card(f'''<div style="display: flex; flex-direction: column; gap: 14px">
<div style="display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap"><div><p style="margin: 0; font-size: 13px; color: var(--text-muted)">Goa Weekend · Food</p><p style="margin: 2px 0 0; font-size: 20px; font-weight: 700; letter-spacing: -0.02em; color: var(--text)">Groceries</p></div>{money("₹1,000.00", size=24, weight=600)}</div>
<p style="margin: 0; font-size: 14px; color: var(--text-secondary)">Paid by <strong style="color: var(--text)">Sam</strong> · Split by</p>
<div style="display: flex; gap: 8px; flex-wrap: wrap">{chips}</div>
<div>{row_html}</div>
<div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; border-radius: 8px; background: var(--positive-bg); color: var(--status-positive); font-size: 14px; font-weight: 600"><span style="display: inline-flex; align-items: center; gap: 8px">{icon("check", 18)}Adds up to the Expense</span>{money("₹1,000.00", "pos", size=14, weight=600)}</div>
</div>''', pad="24px")
    bullets = "".join(
        f'<li style="display: grid; grid-template-columns: 22px 1fr; gap: 10px; font-size: 16px; line-height: 1.5; color: var(--text-secondary)"><span style="color: var(--brand); padding-top: 2px">{icon("check", 20)}</span><span>{t}</span></li>'
        for t in [
            "<strong style=\"color: var(--text)\">Equally, by shares, by percent or exact amounts</strong>, between everyone or just the people who were there.",
            "<strong style=\"color: var(--text)\">More than one payer?</strong> Say who paid what, and the split still adds up.",
            "<strong style=\"color: var(--text)\">Every paisa lands somewhere.</strong> ₹1,000 between three is ₹333.34 + ₹333.33 + ₹333.33, never ₹999.99.",
            "<strong style=\"color: var(--text)\">A Group can use its main currency and up to two more</strong>, and balances never add currencies together.",
        ]
    )
    return f'''<section id="how" style="padding: clamp(56px, 7vw, 104px) 0">
<div style="{WRAP}; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(420px, 100%), 1fr)); gap: clamp(32px, 5vw, 72px); align-items: center">
<div style="display: flex; flex-direction: column; gap: 18px">{eyebrow("Split")}{h2("Split it the way it actually happened.")}{lead("Dinner for four, a cab for three, groceries where one person ate twice as much: each Expense keeps its own split, and Splitbook keeps the arithmetic.", 540)}
<ul style="margin: 8px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 14px">{bullets}</ul></div>
<div>{expense}</div>
</div>
</section>'''


def settle_section(mode):
    plate = figure_plate(
        mode, "Fig 3", "The netting station", FIG3[mode], "Pay 2 of 3 · Alex → Sam ₹200",
        "A netting station: four tills with counters and coin trays, a pegboard whose cords show who owes whom, and a shuttle on an overhead beam carrying ₹100 coins with a magnet. Alex has paid You ₹500 and the shuttle is carrying two coins to Sam; You reads 0, Priya −100, Sam +300, Alex −200.",
        ratio="2400 / 1362",
    )
    pays = "".join(
        f'<span style="display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 8px; background: var(--surface); border: 1px solid var(--border); font-size: 14px; color: var(--text)"><strong style="font-weight: 600">{a}</strong>{icon("arrow", 14)}<strong style="font-weight: 600">{b}</strong>{money(v, size=14, weight=600)}</span>'
        for a, b, v in [("Alex", "You", "₹500"), ("Alex", "Sam", "₹200"), ("Priya", "Sam", "₹100")]
    )
    return f'''<section id="settle" style="padding: clamp(56px, 7vw, 104px) 0; background: var(--bg-elevated); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border)">
<div style="{WRAP}; display: flex; flex-direction: column; gap: 32px">
<div style="display: flex; flex-wrap: wrap; gap: 24px 56px; align-items: flex-end">
<div style="flex: 1 1 460px; min-width: 0; display: flex; flex-direction: column; gap: 14px">{eyebrow("Settle up")}{h2("Five debts between four people. Three payments.")}</div>
<div style="flex: 1 1 380px; min-width: 0">{lead("Splitbook nets every Expense into one balance each, then works out the fewest payments that clear them. When someone pays you back, record it and the whole Group sees it in Activity.", 560)}</div>
</div>
{plate}
<div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px 24px">
<div style="display: flex; flex-wrap: wrap; gap: 10px">{pays}</div>
<p style="margin: 0; font-size: 14px; color: var(--text-muted)">Grey cords: the debts the Expenses left. Blue: the payments that replace them.</p>
</div>
</div>
</section>'''


def assistants_section(mode):
    bubble_you = (f'<div style="align-self: flex-end; max-width: 86%; padding: 12px 16px; border-radius: 16px 16px 4px 16px; background: var(--brand); color: var(--on-brand); font-size: 15px; line-height: 1.5">'
                  f'Add dinner at Thalassa, ₹2,400. I paid, split with Priya and Sam.</div>')
    bubble_ai = (f'<div style="align-self: flex-start; max-width: 92%; padding: 12px 16px; border-radius: 16px 16px 16px 4px; background: var(--surface-muted); color: var(--text); font-size: 15px; line-height: 1.5">'
                 f'Added 1 to To review in <strong>Goa Weekend</strong>: Dinner at Thalassa, {money("₹2,400", size=14)}, paid by you, split equally between 3, Tag Food. Open To review to save it.</div>')
    chat = card(f'''<div style="display: flex; flex-direction: column; gap: 12px"><p style="margin: 0 0 2px; display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--text-muted)">{icon("chat", 16)}In your assistant</p>{bubble_you}{bubble_ai}</div>''')
    review = card(f'''<div style="display: flex; flex-direction: column; gap: 12px">
<div style="display: flex; justify-content: space-between; align-items: center; gap: 12px"><p style="margin: 0; display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--text-muted)">{icon("tray", 16)}Goa Weekend · To review</p><span style="font-size: 13px; font-weight: 600; color: var(--status-positive)">1 ready</span></div>
<div style="display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; padding: 12px 14px; border: 1px solid var(--border); border-radius: 10px">
<span style="font-size: 15px; font-weight: 600; color: var(--text)">Dinner at Thalassa</span>{money("₹2,400.00", size=15, weight=600)}
<span style="font-size: 13px; color: var(--text-muted)">You paid · equally between 3 · Food</span><span style="font-size: 12px; font-weight: 600; color: var(--status-info)">prepared by Claude</span></div>
<a href="#signin" style="display: inline-flex; justify-content: center; align-items: center; min-height: 44px; border-radius: 8px; background: var(--brand); color: var(--on-brand); font-weight: 600; font-size: 15px; text-decoration: none">Save 1 ready</a>
<p style="margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-muted)">Nothing reaches Balances until you save it.</p></div>''')
    caps = [
        ("chat", "Ask about your money", "“Who still owes me for Goa?” It reads your Groups, their members, Tags, Balances and spending, as you."),
        ("tray", "Tell it what you spent", "With a separate OK, which starts switched off, it prepares up to 10 items at a time in To review."),
        ("check", "You save, never the assistant", "You check each item and save it yourself. A saved Expense shows “prepared by Claude” to the Group."),
        ("unplug", "Stay in control", "Disconnect any time in Settings. Assistants see members' names, never their email addresses."),
    ]
    cap_html = "".join(
        f'<div style="display: flex; flex-direction: column; gap: 10px; padding: 20px; border-radius: 12px; border: 1px solid var(--border); background: var(--surface)">'
        f'<span style="color: var(--status-info)">{icon(i, 22)}</span><h3 style="margin: 0; font-size: 17px; font-weight: 700; letter-spacing: -0.01em; color: var(--text)">{t}</h3>'
        f'<p style="margin: 0; font-size: 15px; line-height: 1.5; color: var(--text-secondary)">{d}</p></div>'
        for i, t, d in caps
    )
    steps = "".join(
        f'<li style="display: flex; align-items: center; gap: 10px; font-size: 15px; font-weight: 600; color: var(--text)"><span style="{MONO}; display: inline-flex; width: 28px; height: 28px; border-radius: 50%; align-items: center; justify-content: center; background: var(--info-bg); color: var(--status-info); font-size: 13px">{n}</span>{t}</li>'
        for n, t in [(1, "Add Splitbook as a connector"), (2, "Sign in and approve"), (3, "Ask, or tell it what you spent"), (4, "Review and save")]
    )
    fig2 = figure_plate(
        mode, "Fig 2", "The To review rack", FIG2[mode], "You pull the lever · Dinner ₹2,400 is saved",
        "The assistant's terminal sends prepared items as tagged bars through a tube into a To review rack. Only the member's lever opens the gate: the saved Dinner bar rides a conveyor into the line, and Cab waits in the rack. A thin read line runs from the line to the terminal.",
        ratio="2400 / 1362",
    )
    return f'''<section id="assistants" style="padding: clamp(56px, 7vw, 104px) 0">
<div style="{WRAP}; display: flex; flex-direction: column; gap: 40px">
<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(420px, 100%), 1fr)); gap: clamp(32px, 5vw, 64px); align-items: center">
<div style="display: flex; flex-direction: column; gap: 18px">{eyebrow("Connected assistants", "var(--status-info)")}{h2("Talk to your Groups in Claude or ChatGPT.")}{lead("Connect your Splitbook account once. Ask what you owe, or say what you spent and let the assistant draft it. Your money only moves when you say so.", 540)}
<ol style="margin: 8px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 12px">{steps}</ol>
<div style="display: flex; gap: 12px; flex-wrap: wrap; padding-top: 6px">{btn_primary("Connect an assistant", "#connect")}{btn_outline("How it works", "#assistant-guide")}</div></div>
<div style="display: grid; gap: 16px">{chat}</div>
</div>
{fig2}
<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr)); gap: 16px">{cap_html}</div>
</div>
</section>'''


def platforms_section(mode):
    def plat(ic, name, lines, cta):
        items = "".join(f'<li style="display: grid; grid-template-columns: 20px 1fr; gap: 10px; font-size: 15px; line-height: 1.5; color: var(--text-secondary)"><span style="color: var(--brand); padding-top: 2px">{icon("check", 18)}</span><span>{l}</span></li>' for l in lines)
        return card(f'''<div style="display: flex; flex-direction: column; gap: 16px; height: 100%"><span style="color: var(--brand)">{icon(ic, 28)}</span><h3 style="margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; color: var(--text)">{name}</h3>
<ul style="margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 10px; flex: 1">{items}</ul><div>{cta}</div></div>''', pad="28px")
    android = plat("phone", "Android", [
        "Add an Expense in a few taps, wherever you paid.",
        "No signal? Your saved copy of each Group stays readable, and Finish later keeps a half-done Expense in To review.",
        "Home shows what you owe and are owed in every currency.",
    ], btn_outline("Get it on Google Play", "#app", "play"))
    web = plat("monitor", "Web", [
        "Search every Expense across your Groups.",
        "Charts of spending by Month, with the current Month in focus.",
        "Export to CSV, keep a backup, or print a statement.",
    ], btn_primary("Sign in with Google", "#signin", "google"))
    return f'''<section id="app" style="padding: clamp(56px, 7vw, 104px) 0; background: var(--bg-elevated); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border)">
<div style="{WRAP}; display: flex; flex-direction: column; gap: 40px">
<div style="display: flex; flex-direction: column; gap: 14px; max-width: 720px">{eyebrow("Android and web")}{h2("One account on your phone and your laptop.")}{lead("Same Groups, same balances. Add on the bus, review at your desk.")}</div>
<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(340px, 100%), 1fr)); gap: 20px">{android}{web}</div>
</div>
</section>'''


def trust_section(mode):
    items = [
        ("scale", "Exact money", "Amounts are stored as whole paise or cents, never rounded floats, and every split adds up to the Expense."),
        ("history", "Every change in Activity", "Edits, deletions and payments are logged, so the Group can always see what changed and who changed it."),
        ("lock", "Private by default", "Only the people in a Group see it. You sign in with Google; there is no password to leak."),
    ]
    html = "".join(
        f'<div style="display: flex; flex-direction: column; gap: 10px"><span style="color: var(--brand)">{icon(i, 26)}</span><h3 style="margin: 0; font-size: 18px; font-weight: 700; color: var(--text)">{t}</h3><p style="margin: 0; font-size: 15px; line-height: 1.55; color: var(--text-secondary)">{d}</p></div>'
        for i, t, d in items
    )
    return f'''<section style="padding: clamp(56px, 7vw, 96px) 0">
<div style="{WRAP}; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr)); gap: 40px">{html}</div>
</section>'''


def pricing_section(mode):
    def tier(name, price, per, note, lines, cta, featured=False):
        items = "".join(f'<li style="display: grid; grid-template-columns: 20px 1fr; gap: 10px; font-size: 15px; line-height: 1.5; color: var(--text-secondary)"><span style="color: {"var(--brand)" if featured else "var(--text-muted)"}; padding-top: 2px">{icon("check", 18)}</span><span>{l}</span></li>' for l in lines)
        border = "2px solid var(--brand)" if featured else "1px solid var(--border)"
        return f'''<div style="display: flex; flex-direction: column; gap: 18px; padding: 28px; border-radius: 16px; border: {border}; background: var(--surface); box-shadow: var(--shadow-sm)">
<div style="display: flex; justify-content: space-between; align-items: center"><h3 style="margin: 0; font-size: 20px; font-weight: 700; color: var(--text)">{name}</h3>{'<span style="padding: 4px 10px; border-radius: 999px; background: var(--brand-bg); color: var(--brand); font-size: 12px; font-weight: 600">Best value yearly</span>' if featured else ''}</div>
<div style="display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap">{money(price, size=40, weight=600)}<span style="font-size: 15px; color: var(--text-muted)">{per}</span></div>
<p style="margin: 0; font-size: 14px; color: var(--text-muted)">{note}</p>
<ul style="margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 10px; flex: 1">{items}</ul>{cta}</div>'''
    free = tier("Free", "₹0", "forever", "For a trip or two.", [
        "Three Groups, made or joined",
        "Expenses, splits, Balances and settle up",
        "Android and web",
        "Light ads, never on save or settle-up screens",
    ], btn_outline("Start free", "#signin"))
    plus = tier("Plus", "₹29", "a month · or ₹199 a year", "For the flat, the office and every trip.", [
        "More Groups",
        "No ads",
        "Web dashboards, Group insights and exports",
        "One subscription on Android and web",
    ], btn_primary("Get Plus", "#signin"), featured=True)
    return f'''<section id="pricing" style="padding: clamp(56px, 7vw, 104px) 0; background: var(--bg-elevated); border-top: 1px solid var(--border)">
<div style="{WRAP}; display: flex; flex-direction: column; gap: 40px; align-items: center">
<div style="display: flex; flex-direction: column; gap: 14px; max-width: 640px; text-align: center; align-items: center">{eyebrow("Pricing")}{h2("Free for a few Groups. ₹29 for all of them.")}{lead("Launch prices. ₹199 a year works out to under ₹17 a month.", 520)}</div>
<div style="width: 100%; max-width: 860px; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr)); gap: 20px">{free}{plus}</div>
</div>
</section>'''


def final_cta(mode):
    return f'''<section style="padding: clamp(64px, 8vw, 120px) 0">
<div style="{WRAP}; display: flex; flex-direction: column; align-items: center; gap: 22px; text-align: center">
<h2 style="margin: 0; font-size: clamp(32px, 4vw, 52px); line-height: 1.08; font-weight: 700; letter-spacing: -0.03em; color: var(--text); text-wrap: balance; max-width: 760px">Start your first Group tonight. Settle it by the weekend.</h2>
<div style="display: flex; gap: 12px; flex-wrap: wrap; justify-content: center">{btn_primary("Sign in with Google", "#signin", "google", big=True)}{btn_outline("Get it on Google Play", "#app", "play", big=True)}</div>
</div>
</section>'''


def footer(mode):
    mark = "brand/mark-on-dark.svg" if mode == "dark" else "brand/mark-indigo.svg"
    links = "".join(f'<a href="#{h}" style="color: var(--text-secondary); text-decoration: none; font-size: 14px">{t}</a>' for t, h in [("Privacy", "privacy"), ("Terms", "terms"), ("Support", "support"), ("Assistant guide", "assistant-guide")])
    return f'''<footer style="border-top: 1px solid var(--border); background: var(--bg-elevated)">
<div style="{WRAP}; min-height: 88px; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; padding-top: 20px; padding-bottom: 20px">
<div style="display: flex; align-items: center; gap: 10px"><img src="{mark}" alt="" width="24" height="24" style="display: block"><span style="font-size: 14px; color: var(--text-secondary)">Splitbook · shared expenses, settled fairly.</span></div>
<nav aria-label="Footer" style="display: flex; gap: 22px; flex-wrap: wrap">{links}</nav>
<span style="font-size: 13px; color: var(--text-muted)">© 2026 Splitbook</span>
</div>
</footer>'''


def page(mode, title):
    body = "".join([nav(mode), "<main>", hero(mode), groups(mode), split_section(mode), settle_section(mode), assistants_section(mode), platforms_section(mode), trust_section(mode), pricing_section(mode), final_cta(mode), "</main>", footer(mode)])
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{title}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&amp;family=Outfit:wght@400;500;600;700&amp;display=swap">
<style>
body{{margin:0}}
a{{color:{TOKENS[mode]["brand"]}}}a:hover{{color:{TOKENS[mode]["brand-dark"]}}}
.sbl-btn:focus-visible{{outline:2px solid {TOKENS[mode]["focus"]};outline-offset:2px}}
.sbl-trip{{grid-column:span 2;grid-row:span 2}}
@media (max-width:700px){{.sbl-trip{{grid-column:auto;grid-row:auto}}.sbl-links{{display:none !important}}}}
</style>
</helmet>
<div style="{tokens_css(mode)}; background: var(--bg); color: var(--text); font-family: Outfit, 'Segoe UI', sans-serif; -webkit-font-smoothing: antialiased; min-height: 100%">
{body}
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"$preview":{{"width":{1440 if "Phone" not in title else 390},"height":{BOARD_H[title]}}}}}'>
class Component extends DCLogic {{
  renderVals() {{
    return {{}};
  }}
}}
</script>
</body>
</html>
'''


BOARD_H = {"Landing page · desktop": 8200, "Landing page · desktop, dark": 8200, "Landing page · phone": 10400}
FILES = [
    ("LandingPage.dc.html", "light", "Landing page · desktop"),
    ("LandingPageDark.dc.html", "dark", "Landing page · desktop, dark"),
    ("LandingPagePhone.dc.html", "light", "Landing page · phone"),
]
for name, mode, title in FILES:
    html = page(mode, title)
    assert "{{" not in html.split("<x-dc>")[1].split("</x-dc>")[0], "a {{ hole in markup"
    with open(os.path.join(OUT, name), "w") as f:
        f.write(html)
    print(name, len(html))

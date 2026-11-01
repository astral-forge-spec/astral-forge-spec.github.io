# astral-forge-spec.github.io

Plain static site for GitHub Pages. There's no build step: edit the HTML and push.

```
index.html              Home: short intro + NashHack
research/index.html     Research
exploring/index.html    Exploring: "Now" list + blog index
exploring/blog/         One HTML file per post (copy any page as a starting point)
about/index.html        About + contact
assets/css/style.css    Shared styles; section colors live at the top
nashhack/index.html     NashHack rules (keep numbers in sync with the top of nashhack.js)
assets/js/nashhack.js   NashHack game
.nojekyll               Tells GitHub Pages to serve files as-is
```

Each page picks its theme with `<html data-section="home|research|exploring|about">`.
To change a section's color, edit `--bg` / `--accent` / `--accent-rgb` /
`--tint-rgb` (card tint) in `style.css` and the matching
`<meta name="theme-color">` in that page.

Each block of content goes in a rounded, accent-tinted card:

```html
<section class="card">
  <h2>Title</h2>
  <p>...</p>
</section>
```

| Section   | Background | Accent (links, titles) | Card tint |
|-----------|------------|------------------------|-----------|
| Home      | 155° gradient: `#2a1216` red → `#161a3c` blue (held 30–65%) → `#0f2b1a` green | `#7d8cff` | `rgb(112, 120, 230)` |
| Research  | `#131925`  | `#8fb8ff` | `rgb(163, 184, 220)` |
| Exploring | `#151d17`  | `#a6e08c` | `rgb(169, 198, 155)` |
| About     | `#221718`  | `#ffab8c` | `rgb(219, 165, 146)` |

The home page's `theme-color` is `#2a1216`, the top-left red of its gradient.

Preview locally: `python -m http.server` from the repo root, then open
http://localhost:8000. Links are root-relative (`/research/`), so opening the
files directly with `file://` won't resolve them.

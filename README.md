# astral-forge-spec.github.io

Plain static site for GitHub Pages. There's no build step: edit the HTML and push.

```
index.html              Home: short intro + NashHack canvas
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
To change a section's color, edit `--bg` / `--accent` / `--accent-rgb` in
`style.css` and the matching `<meta name="theme-color">` in that page.

Each block of content goes in a rounded, accent-tinted card:

```html
<section class="card">
  <h2>Title</h2>
  <p>...</p>
</section>
```

| Section   | Background | Accent    |
|-----------|------------|-----------|
| Home      | `#141414`  | `#cdc7b9` |
| Research  | `#131925`  | `#a3b8dc` |
| Exploring | `#151d17`  | `#a9c69b` |
| About     | `#221718`  | `#dba592` |

Preview locally: `python -m http.server` from the repo root, then open
http://localhost:8000. Links are root-relative (`/research/`), so opening the
files directly with `file://` won't resolve them.

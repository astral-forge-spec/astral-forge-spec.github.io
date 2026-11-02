# astral-forge-spec.github.io

Static site for GitHub Pages. Hand-written HTML pages are served as-is; GitHub's
built-in Jekyll only processes files that start with front matter (`---`),
which is just the blog. Edit and push; GitHub builds it.

```
index.html              Home: short intro + NashHack
research/index.html     Research
exploring/index.html    Exploring: "Current" + the two newest posts (Jekyll)
exploring/blog/index.html  Full post list (Jekyll)
_posts/                 Blog posts, one Markdown file each
_drafts/                Unpublished drafts + post-template.md
_layouts/               default.html (page shell), post.html (one post)
_includes/post-entry.html  How a post looks in a list
_config.yml             Jekyll settings (post URLs, Markdown, math)
about/index.html        About + contact
assets/css/style.css    Shared styles; section colors live at the top
nashhack/index.html     NashHack rules (keep numbers in sync with the top of nashhack.js)
assets/js/nashhack.js   NashHack game
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

## Writing a blog post

1. Copy `_drafts/post-template.md` to `_posts/YYYY-MM-DD-slug.md`.
   It's published at `/exploring/blog/slug/`, dated by the filename.
2. Set `title:` and `description:` (the abstract) in the front matter, write
   the body in Markdown, and push.
3. The Exploring page shows the two newest posts; `/exploring/blog/` lists all.

Math: `$$...$$` inside a sentence is inline; `$$...$$` as its own paragraph is
a display equation. Single `$` is not math (so prices are safe). KaTeX loads
only on pages that contain math. Avoid `{{` and `{%` in posts (Jekyll's
template syntax); wrap such text in `{% raw %}...{% endraw %}`.

A post with a future date isn't published until that date passes (and the
site is rebuilt by a push).

If a push doesn't show up, check the repo's Actions tab for a failed
"pages build and deployment" run; it shows the Jekyll error.

Preview locally: `python -m http.server` from the repo root, then open
http://localhost:8000. This shows the hand-written pages only; the blog
and the Exploring page need Jekyll (`bundle exec jekyll serve` with the
`github-pages` gem), or just push and check. Links are root-relative (`/research/`), so opening the
files directly with `file://` won't resolve them.

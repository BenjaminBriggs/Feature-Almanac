# The website

```bash
almanac site serve --open        # http://127.0.0.1:4173, reloads whenever an almanac file changes
almanac site build               # dist/site/ beside the almanac (or --out <dir>)
```

The build writes `index.html`, a single page with its styles, script and data inside it, and `almanac.json`, the compiled model. Host the page anywhere or attach it to a ticket. Its typefaces load from Google Fonts, and it falls back to system fonts offline. Everything is pre-rendered, so it can be read without JavaScript.

- **Hero:** counts of behaviours, features and categories, and how far product review has got.
- **Category cards:** each category's features as cards, with a bar showing how many of its behaviours are approved, rejected, changed since review or not yet reviewed.
- **Feature panels:** a card unfolds into a panel the height of the window, over everything else, listing every behaviour with its summary, steps and variants. A note appears where a behaviour's platforms or status differ from the feature's. The panel scrolls on its own while the page behind it holds still.
- **Sticky search and category bar:** search names and descriptions, and jump between categories from the bar as you scroll. Typing a full feature or behaviour ID offers a **Go to** button.
- **Light and dark:** follows the system setting until the reader uses the toggle in the bar, which that browser then remembers.
- **Deep links:** `#1.2` opens a feature's panel, and `#1.2.3` (or `#EX-1.2.3`) opens it scrolled to that behaviour.
- **Review mode:** the **Review** button in the bar, or **Review these** in a feature's panel. See [Reviewing behaviours](reviewing.md).

To publish it on every merge, see [Publishing with GitHub Pages](github.md#publishing-with-github-pages).

## Options

Options go under `site:` in `almanac.yaml`:

```yaml
site:
  title: Example Notes               # the browser tab's title; default: product.name
  tagline: Everything the app does.  # default: product.description
  labels:                            # how statuses read on the site
    shipped: Available
    in-progress: In beta
```

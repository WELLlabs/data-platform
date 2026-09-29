# Adding the tag vocabulary to Typesense

## What already exists in the portal

Typesense is already fully implemented in the backend. There is nothing to
install or wire up for basic search:

- The `typesense` service is defined in `docker-compose.dev.yml` (image
  `typesense/typesense:27.1`, port 8108) and starts with the rest of the stack.
- `.env` has `TYPESENSE_HOST=typesense`, so Typesense is **on** (a blank host
  falls back to PostgreSQL full-text search).
- `src/api/services/typesense_index.py` defines the dataset/file search
  collection (`portal_search`), keeps it in sync when datasets change, and runs
  searches with tag facets, visibility rules, and date filters.
- `src/api/scripts/reindex_typesense.py` rebuilds that collection from Postgres.
- The public endpoint is `GET /search` in `src/api/routers/search.py`.

So the existing search box is already fast, typo-tolerant, and accurate. The
new work is only about the **6,000-tag controlled vocabulary** from the CSV.

## What these files add

Two independent things use the tag list, both from one new Typesense collection
called `tag_vocabulary` (kept separate from `portal_search` so it cannot affect
existing search):

1. **Autocomplete in the tagging form** so people pick from the fixed list.
2. **Autocomplete in the search box** so users can filter by a known tag.

### Files delivered for review

| File | Goes in the repo at | Purpose |
|---|---|---|
| `tags.jsonl` | `src/api/scripts/data/tags.jsonl` | 6,000 cleaned tag records, one per line |
| `load_tag_vocabulary.py` | `src/api/scripts/load_tag_vocabulary.py` | Creates the collection and loads the tags |
| `tag_suggest.py` | `src/api/routers/tag_suggest.py` | `GET /tags/suggest` autocomplete endpoint |

Each `tags.jsonl` record looks like this:

    {"id": "water::water-scarcity", "tag": "water-scarcity", "label": "water scarcity", "theme": "Water"}

`tag` is the slug, `label` is the readable form (both searchable), and `theme`
is one of Land, Agriculture, Water, Climate, Governance, Socio-Economic. Each
theme has exactly 1,000 tags. No tag repeats across themes.

## Steps to implement

### 1. Load the vocabulary into Typesense

Copy `tags.jsonl` to `src/api/scripts/data/tags.jsonl` and
`load_tag_vocabulary.py` to `src/api/scripts/`, then, with the stack running:

    docker compose -f docker-compose.dev.yml exec backend \
      uv run python -m scripts.load_tag_vocabulary

Re-running is safe; it upserts. Use `--recreate` to drop and rebuild. This is a
one-time load (repeat only when the tag list changes).

### 2. Add the autocomplete endpoint

Copy `tag_suggest.py` to `src/api/routers/`, then register it in
`src/api/main.py` next to the other routers:

    from routers import tag_suggest
    app.include_router(tag_suggest.router)

Test it:

    GET /tags/suggest?q=wat
    GET /tags/suggest?q=solar&theme=Climate

It returns `{"suggestions": [{"tag", "label", "theme"}, ...]}`.

### 3. Use it in the frontend (SvelteKit, in src/web)

In the tagging form and the search box, call the endpoint as the user types
(debounce by ~200ms) and show the returned `label`s as a dropdown. On select,
store the `tag` slug. A minimal example:

    let suggestions = [];
    let timer;
    function onInput(e) {
      clearTimeout(timer);
      const q = e.target.value;
      timer = setTimeout(async () => {
        const res = await fetch(`/api/tags/suggest?q=${encodeURIComponent(q)}`);
        suggestions = (await res.json()).suggestions;
      }, 200);
    }

For the **tagging form**, the selected slugs are saved on the dataset. Because
`typesense_index.py` already indexes `dataset.tags`, those tags immediately
become searchable and show up as facets in `/search` results. Nothing else to
change.

For the **search box**, when a user picks a suggested tag, either put its slug
in the search text or pass it to `/search?tags=<slug>` to filter results by that
tag (the `tags` param already exists).

## Why a fixed list matters

A controlled vocabulary keeps everyone using the same words (one person writing
`groundwater` and another `ground water` would otherwise split results). It is
the main reason search stays accurate, which is exactly what you wanted from
Typesense.

## Note on the source CSV

The original `tags.csv` laid the six themes out as six columns, with unrelated
tags sitting in the same row (row 5 held `soil-salinity`, `aromatic-rice`, and
`water-scarcity` together). Those rows did not mean the tags belonged together,
so the reshape kept only each tag and its theme and dropped the row grouping.

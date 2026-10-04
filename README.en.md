# AtomGitAccountLens

[![CI](https://github.com/EthanCheung-gh/AtomGitAccountLens/actions/workflows/ci.yml/badge.svg)](https://github.com/EthanCheung-gh/AtomGitAccountLens/actions/workflows/ci.yml)
[![Deploy](https://github.com/EthanCheung-gh/AtomGitAccountLens/actions/workflows/deploy.yml/badge.svg)](https://github.com/EthanCheung-gh/AtomGitAccountLens/actions/workflows/deploy.yml)

**A full-spectrum lens for your GitCode / AtomGit account**: paste a personal access token and analyze your repositories, languages, commits and activity entirely in your browser. Pure static frontend, no backend, your data never leaves your device.

Live site: `https://ethancheung-gh.github.io/AtomGitAccountLens/`

## Features

- **Overview**: profile, repo/star/fork/watcher/active-repo aggregates, `top_languages`, annual commit scale
- **Repo Portrait**: language composition with dual calibre (repo-weighted vs star-weighted toggle), repo creation timeline, freshness buckets (30d/6m/1y/dormant), top stargazed repos, personal/org namespace breakdown, per-repo exclusion checkboxes that instantly re-compute every statistic site-wide
- **Activity**: yearly contribution heatmap (daily commits), 7×24 work-habit heatmap (weekday × hour), event-type breakdown, cumulative commit curve, push-size distribution (commits per push), monthly stacked repo activity, top-10 most active repos
- **Annual Report**: natural-year selector producing a screenshot-shareable yearly summary (commits, active days, longest streak and longest gap, push habits, language mix)
- **Deep crawl (optional)**: paginates each repository's **full commit history** (100/page until short page, 5000/repo cap) through the rate-limited queue — abortable, incremental, one-click full re-crawl. Feeds commit-level analytics: full-history monthly timeline, commits per year, weekday distribution, hour distribution, 7×24 work-habit heatmap, Conventional-Commits type breakdown, per-repo commit top 10, recent-commit samples; an "own commits only" filter (by commit author login, unknown authors counted as own) keeps community/org repos analytically clean

Engineering:

- Serial rate-limited request queue (default 300 req/min under the platform's 400/min quota), exponential backoff on 429/5xx, fully abortable
- Analysis snapshot in localStorage: instant reload, manual refresh
- Permission guidance (never a blank error page) when the token lacks scopes such as `read_user`
- Vitest unit tests for rate limiting, aggregation calibre and storage; GitHub Actions CI

## Privacy & Token

- The token lives in page memory only; it is written to localStorage solely if you opt into "remember on this device" (plaintext — avoid on shared computers)
- Every request goes directly to the official `api.gitcode.com/api/v5` API (`Authorization: Bearer`); no third-party server is involved
- The analysis snapshot stays in your browser; clearing browser data deletes everything

Token creation: <https://gitcode.com/setting/token-classic> (tick read scopes such as `read_user`)

## Measurement Calibre (important)

GitCode's API differs from GitHub's; this project refuses to fabricate numbers:

1. **Weighted language share**: `/repos/{owner}/{repo}/languages` returns per-language **percentages** within each repo (not bytes/lines). Two calibres are offered: **repo-weighted** (sum of per-repo percentages over total weight) and **star-weighted** (percentage × max(1, repo stars)); "N repos" counts repos whose primary language it is (primary language prefers the repo `language` field, falling back to the highest entry in the language table).
2. **No lines-of-code**: the API provides none, so repo and commit counts proxy scale.
3. **Commits come from the events feed**: `/users/{login}/events?year=` (needs `read_user`); heatmap/hours/trend/report and the overview all share this source.
4. **Followers are counts only** (the followers-list endpoint is unavailable on the GitCode host).
5. **Repo exclusion**: exclusions in the Repo Portrait apply to Overview, Activity and Annual Report alike.

## GitCode & AtomGit

GitCode (gitcode.com) and AtomGit (atomgit.com) have merged platforms with a shared account system and identical API backend; `api.atomgit.com/api/v5` works too. This site pins `api.gitcode.com`; your account works under both domains.

## Tech Stack

React 18 + TypeScript + Vite + ECharts, managed with pnpm.

## Development

```bash
pnpm install
pnpm dev       # dev server
pnpm build     # typecheck + production build
pnpm test      # unit tests
pnpm preview   # preview the build
```

Pushing to `main` triggers the GitHub Pages deployment workflow (`.github/workflows/deploy.yml`).

## License

Not yet licensed (personal portfolio project).

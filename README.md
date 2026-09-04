# Remotion video

<p align="center">
  <a href="https://github.com/remotion-dev/logo">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://github.com/remotion-dev/logo/raw/main/animated-logo-banner-dark.apng">
      <img alt="Animated Remotion Logo" src="https://github.com/remotion-dev/logo/raw/main/animated-logo-banner-light.gif">
    </picture>
  </a>
</p>

Welcome to your Remotion project!

## Commands

**Install Dependencies**

```console
bun install
```

**Start Preview**

```console
bun run dev
```

**Render video**

```console
bunx remotion render
```

**Upgrade Remotion**

```console
bunx remotion upgrade
```

## Audience data ("Who Showed Up")

`scripts/fetch-audience.ts` builds the props for the `ArtistRecap` and
`HouseWeekly` compositions from the live event logger + Waterhouse APIs. All
the counting lives in `src/audience/metrics.ts` (definitions of _pulled_,
_returning_, _regular_, _crowd_, _stayed_, _holdRate_, chat, the quadrant and
the weekly badges); the compositions only draw. Schemas are in
`src/audience/schema.ts`.

```console
bun scripts/fetch-audience.ts artist "Tj Gee" --n 4 --out out/recap-tj-gee.json
bun scripts/fetch-audience.ts week --end 2026-09-03 --out out/weekly-2026-w36.json
bun scripts/fetch-audience.ts --fixtures   # regenerates src/audience/fixtures/
```

The data window is derived from the sessions being analysed, so the 30-day
"pulled" and 90-day "returning" lookbacks always have history behind them;
`--days` overrides it. Both endpoints are public, so no token is needed. Output never contains a
Twitch login — viewers are two-character initials only, and the script fails
loudly if a login makes it into the JSON. `src/audience/fixtures/{recap,weekly}.json`
are checked in so the compositions can be built against real data.

**Tests**

```console
bun test
```

## Docs

Get started with Remotion by reading the [fundamentals page](https://www.remotion.dev/docs/the-fundamentals).

## Help

We provide help on our [Discord server](https://discord.gg/6VzzNDwUwV).

## Issues

Found an issue with Remotion? [File an issue here](https://github.com/remotion-dev/remotion/issues/new).

## License

Note that for some entities a company license is needed. [Read the terms here](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md).

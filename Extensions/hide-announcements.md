# Hide Announcements

Hides Spotify's promos, upsells and banners — and tells you when it does.

Anything that works by suppression has the same problem: when it succeeds, you
see nothing, which is exactly what you'd see if it were broken. So this one
reports itself and can prove it works on demand.

## Using it

Toggle it under the **profile menu** (your avatar, top right). The setting
persists between restarts.

When it hides something, you get a toast — *"Hid an announcement (1 total)"* —
so you know it fired without having DevTools open.

## Console commands

Open DevTools with **Cmd+Opt+I** (macOS) / **Ctrl+Shift+I** (Windows), after
running `spicetify config always_enable_devtools 1`.

| Command | What it does |
|---|---|
| `testAnnouncement()` | Injects a fake promo, checks it's both hidden and logged, cleans up after itself |
| `announcementLog()` | Everything caught so far, with selectors ready to paste into the hide list |
| `announcementLog.clear()` | Wipe the log |
| `findAnnouncements()` | Scan what's on screen right now |

`testAnnouncement()` reports the two halves separately:

```
hide   PASS — element is display:none
catch  PASS — observer wrote it to the log
```

They're different mechanisms that fail for different reasons, so a single
pass/fail would leave you guessing which one to go look at.

## How it works

Two jobs, two tools:

- **Hiding is one injected `<style>` tag.** CSS applies to elements that don't
  exist yet, so it can't be raced by React re-rendering. Deleting nodes with an
  observer means fighting the app on every navigation.
- **Catching is a MutationObserver**, because detection genuinely needs the
  event — CSS can hide something but can't tell you it appeared.

The observer queues nodes and processes them on `requestIdleCallback` rather
than scanning inside the callback. Spotify mutates the DOM constantly, and
doing the work inline would fire heavy scans on every navigation.

## Adding selectors

Selectors match on `data-testid` substrings rather than class names. Spotify's
class names are generated and churn between versions; their test IDs are what
their own test suite depends on and change far less.

On Premium, promos are rare and appear on Spotify's schedule — you can't write
a selector for something you can't see. That's what the log is for. When one
appears, run `announcementLog()`, take the selector, and add it to the
`SELECTORS` array at the top of the file.

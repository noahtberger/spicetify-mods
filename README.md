# spicetify-mods

Two [Spicetify](https://spicetify.app) extensions for the Spotify desktop client.

Plain JavaScript — no build step, no Node dependency. Spotify's desktop client
is a web app, and Spicetify injects these files straight into it.

## Extensions

### `sleep-timer.js`

Desktop Spotify has no sleep timer; mobile does. Adds a clock button to the
topbar with presets (15/30/45/60/90), a custom duration, and **End of track**,
which waits for the current song to finish rather than cutting it off.

- Fades the volume over the last 20 seconds instead of stopping dead
- Restores your original volume after pausing, so the next play isn't silent
- Cancelling mid-fade restores volume too
- The button shows the countdown (`Sleep: 23m`) while armed

### `hide-announcements.js`

Hides Spotify's promos, upsells and banners. Toggle under the profile menu.

Uses **two mechanisms for two different jobs**:

- **Hiding is one injected `<style>` tag.** CSS applies to elements that don't
  exist yet, so it can't be raced by React re-rendering. Deleting nodes with an
  observer means fighting the app on every navigation.
- **Catching is a MutationObserver**, because detection genuinely needs the
  event — CSS can hide a thing but can't tell you it appeared.

Anything that works by suppression is invisible when it succeeds, so this one
reports itself:

| Console command | What it does |
|---|---|
| `testAnnouncement()` | Injects a fake promo, verifies it's both hidden and logged, cleans up |
| `announcementLog()` | Everything caught so far, with selectors to add to the hide list |
| `announcementLog.clear()` | Wipe the log |
| `findAnnouncements()` | Scan what's on screen right now |

Real catches show a toast, so you know it fired without DevTools open.

Selectors match on `data-testid` substrings rather than class names — Spotify's
class names are generated and churn between versions, but their test IDs are
what their own test suite depends on and change far less.

---

## Setup

Clone, then **symlink** into Spicetify's folders. Symlinking rather than copying
means editing the repo edits the live files — no sync step.

### macOS / Linux

```bash
git clone <this repo> ~/spicetify-mods
ln -s ~/spicetify-mods/Extensions/sleep-timer.js        ~/.config/spicetify/Extensions/sleep-timer.js
ln -s ~/spicetify-mods/Extensions/hide-announcements.js ~/.config/spicetify/Extensions/hide-announcements.js
```

### Windows

PowerShell **as Administrator** — Windows needs elevation for symlinks unless
Developer Mode is on.

```powershell
git clone <this repo> $HOME\spicetify-mods
New-Item -ItemType SymbolicLink -Path "$env:APPDATA\spicetify\Extensions\sleep-timer.js"        -Target "$HOME\spicetify-mods\Extensions\sleep-timer.js"
New-Item -ItemType SymbolicLink -Path "$env:APPDATA\spicetify\Extensions\hide-announcements.js" -Target "$HOME\spicetify-mods\Extensions\hide-announcements.js"
```

### Then, either machine

```bash
spicetify config extensions "sleep-timer.js|hide-announcements.js"
spicetify apply
```

---

## Developing

```bash
spicetify watch -e -l
```

Leave it running. Watches extension files and reloads Spotify on save — no
command between editing and seeing the result.

Without watch mode, use `-n` so Spotify doesn't restart and take DevTools
with it:

```bash
spicetify apply -n     # then Cmd+R in Spotify to load the new code
```

DevTools: `spicetify config always_enable_devtools 1`, then **Cmd+Opt+I**
(macOS) / **Ctrl+Shift+I** (Windows) inside Spotify.

## Gotchas

**Editing a file changes nothing until you re-apply.** Spotify runs whatever
was injected last. If a function you just added is `undefined`, you're on a
stale page — re-apply, then Cmd+R.

**Spotify auto-updates wipe the patch.** Re-run `spicetify backup apply` after
one. Worse, an update landing *mid-patch* leaves the backup version mismatched
against the client and apply fails. On macOS you can block the updater by
putting a read-only file where it wants its staging folder:

```bash
: > "$HOME/Library/Application Support/Spotify/PersistentCache/Update"
chmod 444 "$HOME/Library/Application Support/Spotify/PersistentCache/Update"
```

Delete that file to let Spotify update normally again.

**`backup apply` vs `apply`:** use `apply` for day-to-day changes. Use
`backup apply` only after Spotify itself updates. Running `backup apply` twice
gives `restore first` — that means a backup already exists, i.e. the previous
patch worked. Not an error.

**Spotify from the Mac App Store cannot be patched** — it's sandboxed. Use the
direct download or `brew install --cask spotify`.

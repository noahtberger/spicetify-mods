# Better Mix

Spotify's mixes are mostly songs you already play. Better Mix takes every mix
Spotify makes for you, asks Spotify what fits it, and throws out everything
you already listen to -- your library, your recent plays, the mix's own
artists. What's left is popular music by artists you don't play, ranked by
popularity, with a few songs you know spread through it.

It runs itself. The six Daily Mixes and whatever's on your Home page rebuild
at the first startup of each day; the rest of your catalogue refreshes weekly.
Your Home page shows the better versions where Spotify's rows used to be.
Nothing touches your library unless you press save.

## Install

Spotify needs to be told about a new page, and only `spicetify apply` can do
that -- which is why this is a one-time manual install rather than a
Marketplace click. The folder must be named exactly `better-mix`: that's also
the page's address.

```bash
git clone https://github.com/noahtberger/spicetify-mods.git
cp -r spicetify-mods/CustomApps/better-mix "$(spicetify path userdata)/CustomApps/better-mix"
spicetify config custom_apps better-mix
spicetify apply
```

No git? Download the repo as a zip from GitHub, then copy its
`CustomApps/better-mix` folder into `~/.config/spicetify/CustomApps/` on macOS
and Linux, or `%APPDATA%\spicetify\CustomApps\` on Windows, and run the last
two commands.

That folder carries everything -- the pages and the extension that builds the
mixes and replaces the Home rows.

Then **open Home once** so it can see which mixes Spotify makes for you. The
first run builds them in the background over a few minutes, with a counter on
the rows showing progress. After that it looks after itself.

To update: pull the repo, copy the folder again, `spicetify apply`.

## Using it

- **Home rows** replace Spotify's mix shelves: your daily mixes, then your
  mixes. Hover a card to play it; click for its page; **Show all** lists every
  mix that's been built.
- **A mix page** looks like a playlist: play, shuffle, save as a real playlist
  (which then syncs to your phone), rebuild, search and sort.
- **Right-click any playlist** for a one-off better mix of it.
- **Profile menu**: turn the automatic builds off, or put Spotify's rows back.

## Honest limits

It can only surface what Spotify's recommender offers, and that recommender
leans toward what you already like. For some mixes most of the result ends up
being "songs you haven't heard by artists you do play" -- each track records
which rule let it in, so you can tell which mixes those are.

Mixes live in this client's storage, not your Spotify account, so they don't
appear on your phone. Save one and it becomes a normal playlist that does.

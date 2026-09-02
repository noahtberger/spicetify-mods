# Better Mix

Spotify's mixes are mostly songs you already play. Better Mix takes each one
Spotify makes for you, asks Spotify what fits it, and throws out everything
you already listen to -- your library, your recent plays, and the mix's own
artists. What's left is popular music by artists you don't play, ranked by
popularity, with a few songs you know spread through it.

It runs itself. Every Daily Mix and whatever's on your Home page is rebuilt at
the first startup of each day; the rest of Spotify's catalogue for you
refreshes weekly. Your Home page shows the better versions where Spotify's
rows used to be. Nothing is saved to your library unless you press save.

## Install

Marketplace installs the app. Then, once:

```
spicetify config custom_apps better-mix
spicetify apply
```

Open Home once so it can see your Spotify mixes. The first run builds them in
the background -- a few minutes -- and a counter on the Home rows shows it
working.

## Using it

- **Home rows** replace Spotify's mix shelves: your daily mixes, then your
  mixes. Click a card for its page; hover for play.
- **A mix page** looks like a playlist: play, shuffle, save as a real playlist
  (which syncs to your phone), rebuild, search, and sort.
- **Better Mix** in the sidebar lists everything built.
- **Right-click any playlist** for a one-off better mix of it.
- Turn the Home replacement off under your profile menu.

## Honest limits

It can only surface what Spotify's recommender offers, and that recommender
leans toward what you already like -- for some mixes most of the result is
"songs you haven't heard by artists you do play", and each track records
which rule admitted it so you can tell. Mixes live in this client's storage;
save one to take it anywhere.

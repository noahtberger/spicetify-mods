# Sleep Timer

Desktop Spotify has no sleep timer; mobile does. This adds one.

## Using it

Click the **clock icon** in the topbar. You get:

- Presets: 15 / 30 / 45 / 60 / 90 minutes
- A custom minutes field — type a number and press Enter
- **End of track** — waits for the current song to finish instead of cutting it off

While armed, the button turns accent-coloured and shows the countdown
(`Sleep: 23m`). Click it again to cancel.

## Behaviour

It **fades the volume over the last 20 seconds** rather than stopping dead. The
point is falling asleep, and an abrupt cut is what wakes you up.

Two details that matter more than they look:

- **Your original volume is restored after pausing.** Without that, the next
  time you hit play the app is silent and it reads as a bug.
- **Cancelling mid-fade restores it too.** The fade loop checks whether it's
  still armed on every step, so cancelling halfway doesn't leave you at 30%.

#!/bin/sh
# Copy the custom app into Spicetify's folder.
#
# Extensions are symlinked and Spicetify follows them. Custom apps are NOT:
# Spicetify's app copy skips symlinked files (verified -- the app silently
# never installed as symlinks), so these have to be real files. Run this after
# editing anything in CustomApps/, then `spicetify apply -n`.
set -e
cd "$(dirname "$0")"
DEST="${SPICETIFY_CONFIG:-$HOME/.config/spicetify}/CustomApps"
for app in CustomApps/*/; do
  name="$(basename "$app")"
  mkdir -p "$DEST/$name"
  cp "$app"/* "$DEST/$name/"
  echo "synced $name -> $DEST/$name"
done

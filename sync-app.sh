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
# Refuse to sync a file that doesn't parse -- a syntax error here means the
# sidebar page dies on mount, and the copy in Spicetify's folder is what runs.
for js in CustomApps/*/*.js; do
  osascript -l JavaScript -e "
    ObjC.import('Foundation');
    var src = \$.NSString.stringWithContentsOfFileEncodingError('$PWD/$js', \$.NSUTF8StringEncoding, null).js;
    new Function(src); 'ok'" >/dev/null || { echo "SYNTAX ERROR in $js - not syncing"; exit 1; }
done

for app in CustomApps/*/; do
  name="$(basename "$app")"
  mkdir -p "$DEST/$name"
  cp "$app"/* "$DEST/$name/"
  echo "synced $name -> $DEST/$name"
done

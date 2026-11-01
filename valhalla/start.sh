#!/usr/bin/env bash
# Serves the tiles that valhalla-admin builds into the shared data volume, and restarts Valhalla
# whenever the admin swaps in a new tile file, so a rebuild goes live without touching this container.
set -o errexit -o pipefail -o nounset

config=/custom_files/valhalla.json
tiles=/custom_files/valhalla_tiles.tar
threads=${server_threads:-4}

until [[ -f $config && -f $tiles ]]; do
  echo "INFO: No tiles yet. Open valhalla-admin and add a region; this container starts serving once it is built."
  sleep 30
done

# The admin writes a fresh valhalla.json on every build, so re-apply the memory and distance limits each start.
tune() {
  # Raise Valhalla's default pedestrian and bicycle distance limits to 250 km and 500 km.
  jq --argjson cache "${VALHALLA_MAX_CACHE_BYTES}" \
    '.mjolnir.max_cache_size = $cache
     | .service_limits.pedestrian.max_distance = 250000
     | .service_limits.bicycle.max_distance = 500000' \
    "$config" | sponge "$config"
}

# The admin replaces the tar with a rename, which changes its inode.
fingerprint() { stat -c '%i:%Y:%s' "$tiles" 2>/dev/null || echo missing; }

child=0
trap 'kill -TERM "$child" 2>/dev/null; wait "$child" 2>/dev/null; exit 0' TERM INT

while true; do
  tune
  current=$(fingerprint)
  valhalla_service "$config" "$threads" &
  child=$!
  echo "INFO: Serving tiles ${current} with max_cache_size=${VALHALLA_MAX_CACHE_BYTES} and ${threads} threads"
  reload=false
  while kill -0 "$child" 2>/dev/null; do
    sleep 5 & wait $!
    if [[ $(fingerprint) != "$current" && -f $tiles ]]; then
      echo "INFO: New tiles from valhalla-admin; restarting Valhalla"
      reload=true
      kill -TERM "$child"
      wait "$child" || true
      break
    fi
  done
  if [[ $reload == false ]]; then
    # Valhalla died on its own; exit so Docker's restart policy brings the container back.
    code=0
    wait "$child" || code=$?
    echo "ERROR: valhalla_service exited with code ${code}"
    exit "${code:-1}"
  fi
done

# geo-engine

Self-hosted routing for **run-buddy** and **walking-route-generator**, so their loops are planned without Google's Routes API.

Two containers share one data folder, `./data/valhalla`:

- **valhalla** runs [Valhalla](https://github.com/valhalla/valhalla) on port 8002. It stores the road network as small tiles in one memory-mapped file, and a request reads only the tiles near its route, so even the whole planet can be served from a machine with little RAM.
- **valhalla-admin** is a small web app on port 8003. It downloads OpenStreetMap regions from [Geofabrik](https://download.geofabrik.de), builds Valhalla's tiles from them, and swaps the new tiles in. Valhalla notices the new tile file and restarts onto it within a few seconds.

## Run it

```sh
cp .env.example .env    # optional: pick limits and the first region
docker compose up -d --build
open http://localhost:8003
```

On a fresh data folder the admin installs `VALHALLA_DEFAULT_REGIONS` (New York State by default) without anyone visiting the page. Valhalla starts serving as soon as that first build finishes.

## Managing regions

In the admin:

1. Search or browse the region list and choose **Add**. A region includes everything inside it, so adding Europe replaces any European countries you already have.
2. Choose **Remove** next to a region you no longer need.
3. Choose **Apply changes and rebuild**. The page shows overall progress, each step, and each download. Valhalla keeps serving the old tiles until the new ones are ready, so routing never goes down for more than a restart.

**Update map data** downloads the latest extract for every region and rebuilds. Geofabrik updates them daily.

A build downloads the new extracts, merges all regions with `osmium` (neighbouring extracts overlap at their borders), then runs Valhalla's tile build. On a laptop, New York State (500 MB) takes about 3 minutes to build after its download.

| Variable | Default | Meaning |
|---|---|---|
| `VALHALLA_DEFAULT_REGIONS` | `us/new-york` | Geofabrik ids installed on a fresh data folder, space-separated (`planet` for everything) |
| `VALHALLA_BUILD_THREADS` | `4` | Threads for tile builds |
| `VALHALLA_BUILD_ELEVATION` | `true` | Adds hill grades to roads, which the apps use to avoid steep climbs; downloads elevation data for the built area |
| `VALHALLA_ADMIN_MEM_LIMIT` | `3g` | Memory cap for the admin, which is what builds need |
| `VALHALLA_ADMIN_PORT` | `8003` | Admin web page |
| `VALHALLA_THREADS` | `4` | Valhalla request threads |
| `VALHALLA_MAX_CACHE_BYTES` | `134217728` (128 MB) | Valhalla tile cache per thread |
| `VALHALLA_MEM_LIMIT` | `3g` | Valhalla memory cap |
| `VALHALLA_PORT` | `8002` | Valhalla API |

The admin has no login. Keep port 8003 on your home network.

## Point the apps at it

Both apps read `VALHALLA_URL` on the server (default `http://localhost:8002` in dev, `http://host.docker.internal:8002` in their Compose files).

- **run-buddy** `POST /api/routes` `{ start, km }` → a loop of about `km`, saved behind a short link.
- **walking-route-generator** `POST /api/routes` `{ origin, minutes, mode: "walk" | "bike" }` → a loop that takes about `minutes`.

## Memory on a 4 GB homelab

Serving fits in 4 GB because tiles are memory-mapped and only the ones near a request are read. Measured on the New York build under load (marathon-length loops, 4 threads): about 0.9–1.1 GB of process memory, plus 200–400 MB of mapped tile pages that the kernel reclaims under pressure. Process memory is mostly per-thread route search state, so it scales with route length and `VALHALLA_THREADS`, not with map size.

Building is what needs memory. A US state or a small country builds within the admin's 3 GB cap. A large country, a continent or the planet does not.

## Planet (or any big region) on the homelab

Build on a bigger machine and copy the result over:

1. Rent a VM with 64–128 GB of RAM and about 500 GB of disk for a few hours.
2. On it, clone this repo and set `VALHALLA_DEFAULT_REGIONS=planet`, `VALHALLA_ADMIN_MEM_LIMIT=100g` and `VALHALLA_BUILD_THREADS` to the core count, then `docker compose up -d --build`. Follow progress on port 8003.
3. When the build finishes, stop the stack and copy `data/valhalla/` to the homelab, except `regions/` and `elevation_data/` (the tiles already contain everything Valhalla needs).
4. On the homelab, `docker compose up -d`. Valhalla serves the copied tiles straight away.

Repeat monthly to pick up new OpenStreetMap data.

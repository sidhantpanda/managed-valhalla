# valhalla-manager

Self-hosted [Valhalla](https://github.com/valhalla/valhalla) routing with a web admin for picking map regions. Run it with Docker Compose, choose the parts of the world you need, and get a routing API that runs on a machine with as little as 4 GB of RAM.

Two containers share one data folder, `./data/valhalla`:

- **valhalla** runs Valhalla on port 8002. It stores the road network as small tiles in one memory-mapped file, and a request reads only the tiles near its route, so even the whole planet can be served from a machine with little RAM.
- **valhalla-admin** is a small web app on port 8003. It downloads OpenStreetMap regions from [Geofabrik](https://download.geofabrik.de), builds Valhalla's tiles from them, and swaps the new tiles in. Valhalla notices the new tile file and restarts onto it within a few seconds.

## Quick start

Requires Docker with Compose v2.

```sh
git clone https://github.com/sidhantpanda/valhalla-manager.git
cd valhalla-manager
cp .env.example .env    # optional: pick limits and the first region
docker compose up -d --build
open http://localhost:8003
```

On a fresh data folder the admin installs `VALHALLA_DEFAULT_REGIONS` (New York State by default) without anyone visiting the page. Valhalla starts serving as soon as that first build finishes.

## Using the routing API

Once a build has finished, Valhalla's [HTTP API](https://valhalla.github.io/valhalla/api/) is available on port 8002:

```sh
curl -s http://localhost:8002/route --json '{
  "locations": [{ "lat": 40.7484, "lon": -73.9857 }, { "lat": 40.7829, "lon": -73.9654 }],
  "costing": "pedestrian",
  "units": "kilometers"
}'
```

Every Valhalla endpoint (`/route`, `/optimized_route`, `/isochrone`, `/matrix`, `/trace_route`, `/height` and so on) works. Distance limits for `pedestrian` (250 km) and `bicycle` (500 km) routes are raised above Valhalla's defaults in [`valhalla/start.sh`](valhalla/start.sh).

### Does Valhalla cover a point?

The admin answers that for routing clients, so they can try Valhalla only where it has tiles and fall back to another router elsewhere:

```sh
curl -s 'http://localhost:8003/api/coverage?lat=48.137&lng=11.575'
# {"covered":false,"servedBy":null,"region":{"id":"oberbayern","name":"Oberbayern"},"country":{"id":"germany","name":"Germany"}}
```

| Field | Meaning |
|---|---|
| `covered` | Valhalla's current tiles include the point |
| `servedBy` | The installed region that covers it (`planet` if the planet is installed), or `null` |
| `region` | The smallest Geofabrik region containing the point: the one to add to cover it. `null` at sea |
| `country` | That region's country (one level below a continent), or `null` |

It uses Geofabrik's region outlines (about 4 MB), cached in `data/valhalla/admin/` and refreshed daily, and answers in a few milliseconds. Region ids are Geofabrik's, the same ones the admin installs, so a client can count requests by `region` and show which regions are worth adding.

## Managing regions

In the admin:

1. Search or browse the region list and choose **Add**. A region includes everything inside it, so adding Europe replaces any European countries you already have.
2. Choose **Remove** next to a region you no longer need.
3. Choose **Apply changes and rebuild**. The page shows overall progress, each step, and each download. Valhalla keeps serving the old tiles until the new ones are ready, so routing never goes down for more than a restart.

**Update map data** downloads the latest extract for every region and rebuilds. Geofabrik updates them daily.

A build downloads the new extracts, merges all regions with `osmium` (neighbouring extracts overlap at their borders), then runs Valhalla's tile build. On a laptop, New York State (500 MB) takes about 3 minutes to build after its download.

## Configuration

Set these in `.env` (see [`.env.example`](.env.example)):

| Variable | Default | Meaning |
|---|---|---|
| `VALHALLA_DEFAULT_REGIONS` | `us/new-york` | Geofabrik ids installed on a fresh data folder, space-separated (`planet` for everything) |
| `VALHALLA_BUILD_THREADS` | `4` | Threads for tile builds |
| `VALHALLA_BUILD_ELEVATION` | `true` | Adds elevation and road grades, so routes can weigh hills; downloads elevation data for the built area |
| `VALHALLA_ADMIN_MEM_LIMIT` | `3g` | Memory cap for the admin, which is what builds need |
| `VALHALLA_ADMIN_PORT` | `8003` | Admin web page |
| `VALHALLA_THREADS` | `4` | Valhalla request threads |
| `VALHALLA_MAX_CACHE_BYTES` | `134217728` (128 MB) | Valhalla tile cache per thread |
| `VALHALLA_MEM_LIMIT` | `3g` | Valhalla memory cap |
| `VALHALLA_PORT` | `8002` | Valhalla API |

> [!WARNING]
> The admin has no login, and anyone who can reach it can start builds. Keep port 8003 on a private network or put it behind an authenticating reverse proxy. See [SECURITY.md](SECURITY.md).

## Memory on a small machine

Serving fits in 4 GB because tiles are memory-mapped and only the ones near a request are read. Measured on the New York build under load (40 km routes, 4 threads): about 0.9–1.1 GB of process memory, plus 200–400 MB of mapped tile pages that the kernel reclaims under pressure. Process memory is mostly per-thread route search state, so it scales with route length and `VALHALLA_THREADS`, not with map size.

Building is what needs memory, mostly in the "Finish routing tiles" step. Measured with 4 build threads:

| Regions (extract size) | Build process memory | Fits `VALHALLA_ADMIN_MEM_LIMIT=3g`? |
|---|---|---|
| New York + Connecticut (0.7 GB) | under 1 GB | Yes |
| New York + Netherlands (1.9 GB) | about 3.9 GB | No: killed for lack of memory; built fine at `6g` |

When a build runs out of memory the admin says so, and Valhalla keeps serving the previous tiles. Raise `VALHALLA_ADMIN_MEM_LIMIT` (it also uses any spare memory as file cache, which is harmless), or build big regions on another machine as described below.

## Serving the planet (or any big region) from a small machine

Build on a bigger machine and copy the result over:

1. Rent a VM with 64–128 GB of RAM and about 500 GB of disk for a few hours.
2. On it, clone this repo and set `VALHALLA_DEFAULT_REGIONS=planet`, `VALHALLA_ADMIN_MEM_LIMIT=100g` and `VALHALLA_BUILD_THREADS` to the core count, then `docker compose up -d --build`. Follow progress on port 8003.
3. When the build finishes, stop the stack and copy `data/valhalla/` to the small machine, except `regions/` and `elevation_data/` (the tiles already contain everything Valhalla needs).
4. On the small machine, `docker compose up -d`. Valhalla serves the copied tiles straight away.

Repeat monthly to pick up new OpenStreetMap data.

## Developing the admin

The admin is a Next.js app in [`valhalla-admin/`](valhalla-admin). See [CONTRIBUTING.md](CONTRIBUTING.md) for setup.

## Data and attribution

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the [Open Database License](https://opendatacommons.org/licenses/odbl/). If you show routes from valhalla-manager to users, credit OpenStreetMap. Extracts are downloaded from [Geofabrik](https://download.geofabrik.de). Valhalla is MIT licensed.

## License

[MIT](LICENSE)

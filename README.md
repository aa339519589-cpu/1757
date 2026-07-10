# Relay

Relay is a local-first Universal AI Capability Platform. The front end is organized around what a user wants to do; provider details live in Connections and model manifests.

## Run locally

```bash
pnpm install
pnpm dev
```

Open `http://127.0.0.1:3000`. The existing Sub2API service can remain on `127.0.0.1:8080`; add it as an OpenAI-compatible connection with base URL `http://127.0.0.1:8080/v1` and one of its API keys.

## Deploy with Docker

```bash
docker compose up -d --build
```

Relay is then available on `http://127.0.0.1:3000`. Runtime data and the generated master key persist in the `relay-data` volume.

To connect a Docker deployment to the existing Sub2API service on the host machine, use `http://host.docker.internal:8080/v1`. Start Relay with trusted private-network and HTTP connectors enabled for that local bridge:

```bash
ALLOW_PRIVATE_CONNECTORS=true ALLOW_INSECURE_CONNECTORS=true docker compose up -d --build
```

## Included vertical slices

- Demo image generation creates a real local PNG.
- Demo image-to-video submits an async Run and produces a real MP4 through the worker.
- OpenAI-compatible connections validate `/models` and run chat completions.
- OpenAI Images uses the officially documented `gpt-image-2` Image API.
- Custom API connections define dynamic inputs, request mappings, normalized response mappings, and optional task polling/cancellation.
- Runs, events, outputs, uploads, and parent Assets persist in SQLite and local Asset storage.

## Data and secrets

Runtime data is in `.data/` and excluded from version control. If `CAPABILITY_MASTER_KEY` is unset, Relay creates `.data/master.key` with mode `0600`. Provider keys are encrypted with AES-256-GCM and are never returned by public APIs.

Public HTTPS endpoints are allowed by default. Localhost is allowed for local models and the existing gateway. Other private networks require `ALLOW_PRIVATE_CONNECTORS=true`; public HTTP endpoints require `ALLOW_INSECURE_CONNECTORS=true`. Cross-origin redirects, non-HTTP protocols, oversized responses, and link-local metadata endpoints are blocked.

## Architecture

The application is a Next.js 16 server/client boundary with Node SQLite. `src/server/adapters` contains provider-specific behavior; `manifests.ts` drives the universal UI; `run-engine.ts` normalizes execution; `worker.ts` resumes synchronous and async jobs; `storage.ts` persists normalized outputs.

Useful checks:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

See [docs/research.md](docs/research.md) for the product and architecture evidence that changed the implementation.

# Research Notes

Accessed 2026-07-10. This file records only findings that changed the product or architecture.

## Product decisions

- Krea, Firefly, and Firefly Boards support a capability-first surface and contextual follow-up actions. Relay therefore starts with one composer, keeps providers inside the model picker, and reveals Animate, Analyze, Continue, or Download only after a compatible result exists.
- Firefly's unified workspace and Boards' Image -> Edit / Video flow support treating cross-capability handoff as a first-class interaction. Relay carries the persisted Asset into the next manifest instead of exposing a node editor.
- fal Playground generates controls from model schemas. Relay uses one `ModelManifest` and `InputField` renderer for built-in and custom models; a new model does not get a new page.
- fal queue requests and Replicate predictions remain addressable after submission. Relay persists a Run and upstream task ID before polling, and a separate worker resumes it after a page refresh.
- Replicate output URLs expire. Relay copies provider outputs into local Asset storage before marking a Run complete.
- OpenRouter BYOK documents encrypted keys, explicit routing order, and fallback. Relay keeps credentials server-side, returns only a key hint, and does not silently fall back between paid connections.
- ComfyUI preserves workflow provenance with assets, but its graph is not an appropriate default UI. Relay keeps source Run, prompt, parent Asset, and model metadata without exposing a graph editor.
- TypingMind's browser-direct custom endpoint path requires CORS and cannot safely support every keyed API. Relay executes custom connectors on the server and standardizes errors before returning them.

## Engineering decisions

- Provider implementations conform to `validate`, `invoke`, `poll`, and `cancel`; normalized outputs are only text, image, video, audio, file, or JSON.
- Run state is `created -> queued -> running -> succeeded | failed | cancelled`. Provider-specific states are translated by adapters and retained only in meaningful events or technical error details.
- Provider, model, and capability are separate identifiers. Manifests use `connectionId:modelId`, following the central registry principle documented by the Vercel AI SDK.
- Asset storage is an interface boundary. The MVP uses local files, matching the local/S3 separation in Open WebUI; the database stores storage keys rather than public provider URLs.
- Credentials use a dedicated AES-256-GCM vault and masked public representation, informed by Dify's field-aware secret encryption and LobeHub's encrypted local credential file.
- Custom API URLs are DNS-resolved and checked for private/link-local destinations, response sizes and timeouts are bounded, and cross-origin redirects are blocked to reduce SSRF and credential-forwarding risk.

## Verified provider scope

- OpenAI Images is implemented from the official [Image generation guide](https://developers.openai.com/api/docs/guides/image-generation.md): Bearer authentication, `POST /v1/images/generations`, `gpt-image-2`, and `data[0].b64_json`. The guide also confirms `size` and `quality` options.
- OpenAI-compatible chat uses the widely implemented `/v1/models` validation and `/v1/chat/completions` contract, but each third-party implementation can differ. Connection errors remain explicit rather than claiming universal compatibility.
- Jimeng was prioritized, but no current official public source could be found that reliably established endpoint, authentication, request/response, and async polling together. New API contains Jimeng middleware, but an open-source adapter is not an official contract. Relay therefore does not advertise or implement a Jimeng preset.

## Sources

- Products: [Krea](https://www.krea.ai/), [Adobe unified generation and editing](https://helpx.adobe.com/firefly/web/unified-generation-and-editing-experience/generation-and-editing-experience-overview.html), [Firefly Boards](https://helpx.adobe.com/firefly/web/create-mood-boards/firefly-boards/about-firefly-boards.html), [fal Playground](https://fal.ai/docs/documentation/model-apis/playground), [fal queue](https://fal.ai/docs/documentation/model-apis/inference/queue), [Replicate prediction lifecycle](https://replicate.com/docs/topics/predictions/lifecycle), [Replicate output files](https://replicate.com/docs/topics/predictions/output-files), [OpenRouter BYOK](https://openrouter.ai/docs/guides/overview/auth/byok), [TypingMind API keys](https://docs.typingmind.com/manage-and-connect-ai-models/set-up-api-keys).
- Open source: [Vercel AI provider abstraction](https://github.com/vercel/ai/blob/main/architecture/provider-abstraction.md), [provider registry](https://github.com/vercel/ai/blob/main/content/docs/07-reference/01-ai-sdk-core/40-provider-registry.mdx), [Dify provider encryption](https://github.com/langgenius/dify/blob/main/api/core/helper/provider_encryption.py), [LobeHub credentials](https://github.com/lobehub/lobe-chat/blob/main/apps/cli/src/auth/credentials.ts), [Open WebUI storage provider](https://github.com/open-webui/open-webui/blob/main/backend/open_webui/storage/provider.py), [ComfyUI assets](https://github.com/Comfy-Org/ComfyUI/tree/master/app/assets), [New API task polling](https://github.com/QuantumNous/new-api/blob/main/service/task_polling.go), [LibreChat RunManager](https://github.com/danny-avila/LibreChat/blob/main/api/server/services/Runs/RunManager.js).

The in-app browser was unavailable in this session. Public research used official pages, official Markdown, and GitHub source paths; no visual claim relies on an inaccessible page.

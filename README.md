# n8n-nodes-speechify

This is an n8n community node. It lets you use [Speechify](https://speechify.com)'s
text-to-speech API in your n8n workflows.

Speechify provides high-quality, low-latency text-to-speech generation and a
catalog of voices, via a REST API at `https://api.speechify.ai`.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

[Installation](#installation)
[Operations](#operations)
[Credentials](#credentials)
[Compatibility](#compatibility)
[Usage](#usage)
[Resources](#resources)
[Version history](#version-history)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/)
in the n8n community nodes documentation, and install `n8n-nodes-speechify`.

## Operations

### Speech

- **Generate Audio** — converts input text to an audio file using a chosen
  voice and model, and writes the result to a binary property on the output
  item (default `data`) so it can be passed straight into nodes like _Write
  Binary File_, _HTTP Request_ (as a multipart field), or a webhook response.

### Voice

- **Get Many** — lists the voices available to your Speechify account, with
  "Return All" / "Limit" and a "Simplify" toggle for a trimmed-down
  `voiceId` / `displayName` / `gender` / `locale` shape instead of the raw API
  response. Use this to look up the Voice ID for the Generate Audio operation.

## Credentials

This node uses the **Speechify API** credential type: a single **API Key**
field. Generate a key from the Speechify API console and paste it in — the
node sends it as `Authorization: Bearer <your key>` on every request. Use the
"Test" button on the credential to confirm it against `GET /v1/voices`.

## Compatibility

Built and tested against `n8n-workflow` as scaffolded by `@n8n/node-cli`
(n8n `n8nNodesApiVersion: 1`). No known incompatibilities.

## Usage

All configuration — the API key, the text, the voice, the model, the audio
format — is supplied via node parameters and the credential. This node never
reads environment variables or the filesystem for configuration, per n8n's
community-node verification requirements.

Every request this node sends to `api.speechify.ai` includes a
`Speechify-Caller: n8n` attribution header (see
`nodes/Speechify/GenericFunctions.ts`) so Speechify can attribute usage to
this integration. If you fork this node, keep that header — it's a required
piece of the integration, not incidental.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [Speechify API documentation](https://docs.speechify.ai)

## Version history

- **0.1.0** — Initial release: Speech → Generate Audio, Voice → Get Many.

## Development

```bash
npm install
npm run build
npm run lint
```

## License

[Apache-2.0](LICENSE)

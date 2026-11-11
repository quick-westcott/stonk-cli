# stonk-launch-cli

A minimal CLI launcher for [letsbonk.fun](https://letsbonk.fun) and [StonkFun](https://www.stonkfun.xyz) coins on the [TrenchyTools API](https://trenchy.tools/docs): one file, no RPC node, no Jito client, no IPFS keys. Your wallet keys are generated locally, sign locally, and never leave your machine.

> **API note** — this app talks to the [TrenchyTools API](https://trenchy.tools) (`api.trenchy.tools`), a third-party hosted API (we're not affiliated, it's just the convenient one). It handles the chain calls, Jito bundles and IPFS pinning. Pointing it at QuickNode, Helius or your own RPC instead needs extra code.


## Setup

```bash
npm install
cp .env.example .env   # then put your TRENCHY_API_KEY in it (GET https://api.trenchy.tools/api/create-api-key)
```

## Launch a coin

```bash
node launch.mjs --name "My Coin" --symbol MYC --image coin.png --dev-buy 0.05
```

Options:

| flag | meaning | default |
|---|---|---|
| `--name` | token name (required, ≤ 32 bytes) | |
| `--symbol` | ticker (required, ≤ 10 bytes) | |
| `--image` | image file (required) | |
| `--dev-buy` | dev buy in SOL | 0 |
| `--platform` | `bonk` (letsbonk) or `stonkfun` | `bonk` |
| `--description` | description | empty |
| `--twitter` / `--telegram` / `--website` | socials | none |

The dev and mint keypairs are generated fresh, the create is built by the API, signed here, and sent back. Keys land in `dev-key.json` / `mint-key.json` next to the script; keep them.

## How it works

1. `POST /api/ipfs` pins the image + metadata (the launch's wallets ride it as an encrypted keytag, X25519 + ChaCha20-Poly1305, `keytag.mjs`)
2. `POST /api/sol/trade-local` builds the LaunchLab create (+ dev buy) as an unsigned transaction
3. the CLI signs with the dev + mint keypairs and `POST /api/sol/send` sends it
4. letsbonk / stonkfun.xyz adopt the coin within a minute

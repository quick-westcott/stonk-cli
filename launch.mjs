/**
 * CLI reference launcher for letsbonk.fun / StonkFun on the TrenchyTools API.
 *
 * Creates a coin on the LaunchLab curve (letsbonk's platform by default,
 * StonkFun's with --platform stonkfun), with an optional dev buy, signing
 * locally: the API never holds your keys.
 *
 *   node launch.mjs --name "My Coin" --symbol MYC --image coin.png --dev-buy 0.05
 *   node launch.mjs --name "My Coin" --symbol MYC --image coin.png --dev-buy 0.05 --platform stonkfun
 *
 * Env (or a .env next to this file):
 *   TRENCHY_API_URL   default https://api.trenchy.tools
 *   TRENCHY_API_KEY    your key (GET /api/create-api-key)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { argv, env, exit } from "node:process"
import { Keypair } from "@solana/web3.js"
import bs58 from "bs58"

// .env next to the script (the file wins over ambient environment)
try {
  for (const line of readFileSync(new URL("./.env", import.meta.url), "utf8").split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim())
    if (m && !env[m[1]]) env[m[1]] = m[2].trim()
  }
} catch {}

const API = env.TRENCHY_API_URL || "https://api.trenchy.tools"
const KEY = env.TRENCHY_API_KEY

// --- tiny arg parser -------------------------------------------------------
const args = argv.slice(2)
const flag = (name, def = "") => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def }
const need = (name) => { const v = flag(name); if (!v) { console.error(`missing --${name}`); exit(1) } return v }

const name = need("name")
const symbol = need("symbol")
const image = need("image")
const devBuy = Number(flag("dev-buy", "0"))
const platform = flag("platform", "bonk") === "stonkfun" ? "stonkfun" : "bonk"

if (!KEY) { console.error("set TRENCHY_API_KEY (env or .env next to launch.mjs)"); exit(1) }
if (!existsSync(image)) { console.error(`image not found: ${image}`); exit(1) }

const die = (msg) => { console.error(String(msg)); exit(1) }
const H = () => ({ "x-api-key": KEY, "content-type": "application/json" })

// --- run record ------------------------------------------------------------
import { sealRunRecord } from "./run-seal.mjs"

const dev = Keypair.generate()
const record = { name, symbol, dev: dev.publicKey.toBase58(), platform, devBuy, at: new Date().toISOString() }

console.log(`launching ${name} (${symbol}) on ${platform === "stonkfun" ? "StonkFun" : "letsbonk"}${devBuy > 0 ? ` with a ${devBuy} SOL dev buy` : ""}`)
console.log(`dev wallet ${dev.publicKey.toBase58()} (secret written to dev-key.json)`)

// the run record: dev + any bundle wallets, sealed and pinned with the metadata
let backup
try {
  backup = sealRunRecord([{ publicKey: dev.publicKey.toBase58(), seed: bs58.encode(dev.secretKey), label: `dev ${symbol}` }], Date.now(), "sol")
} catch (e) {
  console.warn(`run record not attached (${e.message}); launch continues`)
}

// --- 1. metadata ------------------------------------------------------------
let mime = "image/png"
if (/\.jpe?g$/i.test(image)) mime = "image/jpeg"
else if (/\.webp$/i.test(image)) mime = "image/webp"
else if (/\.gif$/i.test(image)) mime = "image/gif"
const fd = new FormData()
fd.append("file", new Blob([readFileSync(image)], { type: mime }), image.replace(/^.*[\\\/]/, "image" + (mime.split("/")[1] ? "." + mime.split("/")[1].replace("jpeg", "jpg") : "")))
fd.append("name", name)
fd.append("symbol", symbol)
fd.append("description", flag("description", ""))
if (flag("twitter")) fd.append("twitter", flag("twitter"))
if (flag("telegram")) fd.append("telegram", flag("telegram"))
if (flag("website")) fd.append("website", flag("website"))
if (backup) fd.append("backup", backup)

console.log("uploading metadata to IPFS…")
const meta = await fetch(`${API}/api/ipfs`, { method: "POST", headers: { "x-api-key": KEY }, body: fd }).then(async r => { const j = await r.json(); if (!r.ok) die(j.error || r.status); return j })
if (!meta.metadataUri) die("no metadataUri from /api/ipfs")
console.log(`metadata: ${meta.metadataUri}`)

// --- 2. create --------------------------------------------------------------
const mint = Keypair.generate()
console.log(`mint ${mint.publicKey.toBase58()}`)
const createBody = {
  action: "create",
  publicKey: dev.publicKey.toBase58(),
  tokenMetadata: { name, symbol, uri: meta.metadataUri },
  amount: devBuy,
  slippage: 10,
  priorityFee: 0.0005,
  venue: "launchlab",
  platform,
  mint: mint.publicKey.toBase58(),
}
console.log("building the create…")
const built = await fetch(`${API}/api/sol/trade-local?format=json`, { method: "POST", headers: H(), body: JSON.stringify(createBody) })
  .then(async r => { const j = await r.json(); if (!r.ok) die(j.error || r.status); return j })
if (!built.transaction) die("no transaction from trade-local")
console.log(`create built, fee ~${built.feeSol ?? "?"} SOL`)

// --- 3. sign + send ----------------------------------------------------------
console.log("signing and sending…")
const txBytes = Buffer.from(built.transaction, "base64")
const { VersionedTransaction } = await import("@solana/web3.js")
const vtx = VersionedTransaction.deserialize(new Uint8Array(txBytes))
vtx.sign([dev, mint])
const sig = await fetch(`${API}/api/sol/send`, { method: "POST", headers: H(), body: JSON.stringify({ transaction: Buffer.from(vtx.serialize()).toString("base64") }) })
  .then(async r => { const j = await r.json(); if (!r.ok) die(j.error || r.status); return j })
console.log(`create sent: ${sig.signature ?? sig.txSignature ?? JSON.stringify(sig).slice(0, 120)}`)

// --- 4. save keys ------------------------------------------------------------
writeFileSync("dev-key.json", JSON.stringify({ publicKey: dev.publicKey.toBase58(), secret: bs58.encode(dev.secretKey) }, null, 2))
writeFileSync("mint-key.json", JSON.stringify({ publicKey: mint.publicKey.toBase58(), secret: bs58.encode(mint.secretKey) }, null, 2))
console.log("keys: dev-key.json, mint-key.json (keep them safe)")
console.log(`done. ${platform === "stonkfun" ? "stonkfun.xyz" : "letsbonk.fun"} will adopt the coin within a minute`)

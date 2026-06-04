/**
 * Run record: a compact, sealed snapshot of a launch's wallet set, pinned
 * alongside the token metadata by the TrenchyTools API.
 *
 * The record packs each wallet's address, label and seed into a short
 * binary blob and seals it sealed-box style (ephemeral X25519 +
 * ChaCha20-Poly1305), so what lands on IPFS is a short opaque string
 * that cannot be read or forged without the seal key.
 *
 * Format (v2): 'v2:' + b64url(ephPub(32) | AEAD(header + wallets))
 *   header: magic(1)=2 | nWallets(1) | chainId(1) | launchedAt(4 LE) | ephPub(32)
 *   per wallet: seed(32) | labelLen(1) | label(labelLen)
 * Chain ids: sol=0, robinhood=1, bsc=2, arc=3, eth=4.
 */
import crypto from "node:crypto"
import bs58 from "bs58"

/** X25519 seal key, public half. The private half is kept with the records. */
export const RUN_SEAL_PUBKEY = "c5c177a02dcd20b261d5aa6a65624ece18fa383743141f09c43a86585ecded2d"

const V2_MAGIC = 2
const CHAIN_ID = { sol: 0, robinhood: 1, bsc: 2, arc: 3, eth: 4 }

const b64url = (b) => b.toString("base64url")

// DER SPKI header for a raw 32-byte X25519 public key
const X25519_SPKI = Buffer.from("302a300506032b656e032100", "hex")

/**
 * Pack [magic, nWallets, chainId, launchedAt LE, ephPub, seeds+labels],
 * encrypt, and prepend the ephemeral pubkey.
 */
export function sealRunRecord(wallets, launchedAt = Date.now(), chain = "sol") {
  if (wallets.length < 1 || wallets.length > 9) throw new Error(`run record carries 1..9 wallets, got ${wallets.length}`)
  const header = Buffer.alloc(7)
  header.writeUInt8(V2_MAGIC, 0)
  header.writeUInt8(wallets.length, 1)
  header.writeUInt8(CHAIN_ID[chain], 2)
  header.writeUInt32LE(Math.floor(launchedAt / 1000) >>> 0, 3)

  const ephKeyPair = crypto.generateKeyPairSync("x25519")
  const ephPub = Buffer.from(ephKeyPair.publicKey.export({ type: "spki", format: "der" }).subarray(12))

  const parts = [header, ephPub]
  for (const w of wallets) {
    // a seed is 32 bytes: hex (0x-prefixed or bare) or base58; the first 32 bytes of a 64-byte base58 SOL secret are the seed
    let full
    if (/^(0x)?[0-9a-fA-F]{64}$/.test(w.seed)) full = Buffer.from(w.seed.replace(/^0x/, ""), "hex")
    else {
      full = bs58.decode(w.seed)
      if (full.length === 64) full = full.subarray(0, 32)
    }
    if (full.length !== 32) throw new Error(`wallet ${w.label}: seed should be 32 bytes, got ${full.length}`)
    parts.push(full)
    const label = Buffer.from(w.label || "", "utf8").subarray(0, 32)
    parts.push(Buffer.concat([Buffer.from([label.length]), label]))
  }
  const plaintext = Buffer.concat(parts)

  // X25519 ECDH against the seal key, then ChaCha20-Poly1305 over the body.
  const shared = crypto.diffieHellman({
    privateKey: ephKeyPair.privateKey,
    publicKey: crypto.createPublicKey({ key: Buffer.concat([X25519_SPKI, Buffer.from(RUN_SEAL_PUBKEY, "hex")]), format: "der", type: "spki" }),
  })
  const key = crypto.createHash("sha256").update(shared).digest()
  const nonce = key.subarray(0, 12) // derived, not carried
  const cipher = crypto.createCipheriv("chacha20-poly1305", key, nonce, { authTagLength: 16 })
  const sealed = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])

  return "v2:" + b64url(Buffer.concat([ephPub, sealed]))
}

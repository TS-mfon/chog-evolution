import { createHash, randomBytes, randomUUID } from "node:crypto";
import { recoverMessageAddress, type Address, type Hex } from "viem";
import type { Db } from "mongodb";

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export type WalletSession = {
  walletId: string;
  address: `0x${string}`;
  sessionId: string;
  expiresAt: string;
  authProofId?: string;
};

export class MongoAuthRepository {
  constructor(private readonly db: Db) {}

  async issueNonce(address: `0x${string}`, chainId: number, origin: string) {
    const nonces = this.db.collection<any>("wallet_auth_nonces");
    const sessions = this.db.collection<any>("wallet_sessions");
    const now = new Date();
    await Promise.all([
      nonces.deleteMany({
        expires_at: { $lt: new Date(now.getTime() - 86400_000) },
      }),
      sessions.deleteMany({
        expires_at: { $lt: new Date(now.getTime() - 90 * 86400_000) },
      }),
    ]);
    const nonce = randomBytes(24).toString("base64url");
    const expiresAt = new Date(now.getTime() + 5 * 60_000);
    const message = [
      "CHOG Evolution Sign In",
      `Domain: ${new URL(origin).host}`,
      `Address: ${address}`,
      `URI: ${origin}`,
      `Chain ID: ${chainId}`,
      `Nonce: ${nonce}`,
      `Issued At: ${now.toISOString()}`,
      `Expiration Time: ${expiresAt.toISOString()}`,
    ].join("\n");
    await nonces.insertOne({
      _id: randomUUID(),
      address: address.toLowerCase(),
      chain_id: chainId,
      origin,
      nonce_hash: sha256(nonce),
      message,
      expires_at: expiresAt,
      consumed_at: null,
      created_at: now,
    });
    return { message, expiresAt: expiresAt.toISOString() };
  }

  async verifyAndCreateSession(
    message: string,
    signature: string,
  ): Promise<WalletSession | undefined> {
    const nonce = message.match(/^Nonce: ([A-Za-z0-9_-]{32})$/m)?.[1];
    if (!nonce || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return undefined;
    const nonces = this.db.collection<any>("wallet_auth_nonces");
    const row = await nonces.findOne({
      nonce_hash: sha256(nonce),
      message,
      consumed_at: null,
      expires_at: { $gt: new Date() },
    });
    if (!row) return undefined;
    let recovered: string;
    try {
      recovered = await recoverMessageAddress({
        message,
        signature: signature as Hex,
      });
    } catch {
      return undefined;
    }
    if (recovered.toLowerCase() !== String(row.address).toLowerCase())
      return undefined;

    const consumed = await nonces.updateOne(
      {
        _id: row._id,
        nonce_hash: sha256(nonce),
        message,
        consumed_at: null,
        expires_at: { $gt: new Date() },
      },
      { $set: { consumed_at: new Date() } },
    );
    if (consumed.modifiedCount !== 1) return undefined;

    const address = String(row.address).toLowerCase();
    const wallets = this.db.collection<any>("wallets");
    let wallet;
    try {
      wallet = await wallets.findOneAndUpdate(
        { address },
        {
          $setOnInsert: { _id: randomUUID(), address, created_at: new Date() },
        },
        { upsert: true, returnDocument: "after" },
      );
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      wallet = await wallets.findOne({ address });
    }
    if (!wallet) throw new Error("wallet_create_failed");
    const token = randomBytes(32).toString("base64url");
    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 86400_000);
    const authProofId = randomUUID();
    // Preserve the signed, consumed challenge independently of short-lived nonce/session records.
    // It binds adjudication evidence to an actual wallet signature without publishing session tokens.
    await this.db.collection<any>("wallet_auth_proofs").insertOne({
      _id: authProofId,
      wallet_id: String(wallet._id),
      address,
      message,
      signature,
      nonce_hash: sha256(nonce),
      chain_id:
        row.chain_id ?? Number(message.match(/^Chain ID: (\d+)$/m)?.[1]),
      origin: row.origin ?? message.match(/^URI: (.+)$/m)?.[1],
      issued_at: row.created_at,
      expires_at: row.expires_at,
      verified_at: new Date(),
    });
    await this.db.collection<any>("wallet_sessions").insertOne({
      _id: sessionId,
      wallet_id: String(wallet._id),
      auth_proof_id: authProofId,
      token_hash: sha256(token),
      expires_at: expiresAt,
      revoked_at: null,
      created_at: new Date(),
    });
    return {
      walletId: String(wallet._id),
      address: address as `0x${string}`,
      sessionId: `${sessionId}.${token}`,
      expiresAt: expiresAt.toISOString(),
      authProofId,
    };
  }

  async resolveSession(
    cookieValue: string | undefined,
  ): Promise<WalletSession | undefined> {
    if (!cookieValue) return undefined;
    const [id, token, extra] = cookieValue.split(".");
    if (!id || !token || extra || !/^[0-9a-f-]{36}$/i.test(id))
      return undefined;
    const session = await this.db.collection<any>("wallet_sessions").findOne({
      _id: id,
      token_hash: sha256(token),
      revoked_at: null,
      expires_at: { $gt: new Date() },
    });
    if (!session) return undefined;
    const wallet = await this.db
      .collection<any>("wallets")
      .findOne({ _id: session.wallet_id ?? session.walletId });
    if (!wallet) return undefined;
    return {
      sessionId: cookieValue,
      walletId: String(wallet._id),
      address: String(wallet.address) as `0x${string}`,
      expiresAt: new Date(session.expires_at).toISOString(),
      ...(session.auth_proof_id
        ? { authProofId: String(session.auth_proof_id) }
        : {}),
    };
  }

  async revokeSession(cookieValue: string | undefined) {
    if (!cookieValue) return;
    const [id, token, extra] = cookieValue.split(".");
    if (!id || !token || extra || !/^[0-9a-f-]{36}$/i.test(id)) return;
    await this.db
      .collection<any>("wallet_sessions")
      .updateOne(
        { _id: id, token_hash: sha256(token), revoked_at: null },
        { $set: { revoked_at: new Date() } },
      );
  }
}

export type AuthAddress = Address;

import type { Db } from "mongodb";
import { MongoClaimRepository } from "./claim-repository.js";
import { chainConfiguration } from "./config.js";
import { parsePage, paginateRows, type PageCursor } from "./pagination.js";

/** Translate the merged timeline cursor to a source collection without dropping timestamp ties. */
function sourcePage(
  cursor: PageCursor | undefined,
  prefix: string,
  timeField = "created_at",
) {
  if (!cursor) return {};
  const namespace = `${prefix}:`,
    date = new Date(cursor.t);
  const sameTime = cursor.i.startsWith(namespace)
    ? { [timeField]: date, _id: { $lt: cursor.i.slice(namespace.length) } }
    : namespace < cursor.i
      ? { [timeField]: date }
      : undefined;
  return {
    $or: [{ [timeField]: { $lt: date } }, ...(sameTime ? [sameTime] : [])],
  };
}

export async function activityPage(
  db: Db,
  claims: MongoClaimRepository,
  walletId: string,
  address: string,
  query: unknown,
) {
  const { limit, cursor } = parsePage(query);
  const read = (
    name: string,
    filter: Record<string, unknown>,
    prefix: string,
    timeField = "created_at",
  ) =>
    db
      .collection<any>(name)
      .find({ ...filter, ...sourcePage(cursor, prefix, timeField) })
      .sort({ [timeField]: -1, _id: -1 })
      .limit(limit + 1)
      .toArray();
  const [claimRows, scanRows, mintRows, socialRows, evolutionRows] =
    await Promise.all([
      read("claims", { wallet_id: walletId }, "claim"),
      read("scan_jobs", { wallet_id: walletId }, "scan"),
      read(
        "nft_profiles",
        { "mint_proof.wallet": address.toLowerCase() },
        "mint",
        "minted_at",
      ),
      read(
        "audit_events",
        {
          actor_wallet_id: walletId,
          action: { $in: ["x_profile_linked", "x_profile_unlinked"] },
        },
        "social",
      ),
      read(
        "evolution_history",
        { actor_wallet_id: walletId, finalized: true, outcome: "accepted" },
        "evolution",
      ),
    ]);
  const make = (
    type: string,
    row: any,
    value: Record<string, unknown>,
    date = row.created_at,
  ) => ({
    _id: `${type}:${row._id}`,
    created_at: new Date(date),
    id: `${type}:${row._id}`,
    type,
    createdAt: new Date(date).toISOString(),
    ...value,
  });
  const rows = [
    ...(await Promise.all(
      claimRows.map(async (row) => {
        const claim = (await claims.getForWallet(row._id, walletId))!;
        return make("claim", row, {
          title: claim.questName,
          status: claim.status,
          profileId: claim.profileId,
          claimId: claim.id,
          xpAward: claim.xpAward,
          description:
            claim.explanation ?? "Evidence saved for an evolution review.",
        });
      }),
    )),
    ...scanRows.map((row) =>
      make("scan", row, {
        title: "Monad activity checked",
        status: row.status,
        profileId: row.profile_id,
        description:
          row.status === "failed"
            ? "The scan stopped. Retry to continue from its saved checkpoint."
            : "Eligible activity is sent for review.",
      }),
    ),
    ...mintRows.map((row) =>
      make(
        "mint",
        row,
        {
          title: `${row.display_name} joined the family`,
          status: "confirmed",
          profileId: row._id,
          transactionUrl: `${chainConfiguration("demo").explorerUrl}/tx/${row.mint_transaction_hash}`,
        },
        row.minted_at,
      ),
    ),
    ...socialRows.map((row) =>
      make("social", row, {
        title:
          row.action === "x_profile_linked"
            ? "X profile connected"
            : "X profile disconnected",
        status: "complete",
      }),
    ),
    ...evolutionRows.map((row) =>
      make("evolution", row, {
        title:
          row.kind === "trait_change"
            ? "Your Chog changed its look"
            : "Your Chog evolved",
        status: "accepted",
        profileId: row.profile_id,
        ...(row.claim_id ? { claimId: row.claim_id } : {}),
        xpAward: row.changes?.xpAward ?? 0,
        description:
          row.kind === "trait_change"
            ? "Saved equipment change. Your XP is unchanged."
            : `Reached ${row.changes?.stage ?? row.after?.stage ?? "a new stage"}.`,
      }),
    ),
  ].sort(
    (a, b) =>
      Number(b.created_at) - Number(a.created_at) ||
      (a._id < b._id ? 1 : a._id > b._id ? -1 : 0),
  );
  return paginateRows(rows, limit, ({ _id, created_at, ...row }) => row);
}

import { randomUUID } from "node:crypto";
import type { ClientSession, Db } from "mongodb";

/** Append a state transition once; repeated polling must not manufacture history. */
export async function recordClaimEvent(
  db: Db,
  claim: { _id: string; current_attempt?: number; request_id?: string },
  status: string,
  description: string,
  eventKey: string,
  session?: ClientSession,
) {
  await db.collection<any>("claim_events").updateOne(
    {
      claim_id: claim._id,
      attempt: claim.current_attempt ?? 1,
      event_key: eventKey,
    },
    {
      $setOnInsert: {
        _id: randomUUID(),
        claim_id: claim._id,
        attempt: claim.current_attempt ?? 1,
        event_key: eventKey,
        status,
        description: description.slice(0, 500),
        ...(claim.request_id ? { request_id: claim.request_id } : {}),
        created_at: new Date(),
      },
    },
    { upsert: true, ...(session ? { session } : {}) },
  );
}

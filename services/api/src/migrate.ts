import { connectDatabase, ensureIndexes, closeDatabase } from "./mongo.js";

const version = 1;
try {
  const db = await connectDatabase();
  await ensureIndexes();
  await db.collection<any>("schema_migrations").updateOne({ _id: `mongodb-${version}` },
    { $setOnInsert: { version, name: "initial-collections-and-unique-indexes", appliedAt: new Date() } }, { upsert: true });
  console.info(`MongoDB schema version ${version} is ready (collections are created on first write).`);
} finally {
  await closeDatabase();
}

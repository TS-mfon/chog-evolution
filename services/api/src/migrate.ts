import {
  connectDatabase,
  ensureIndexes,
  closeDatabase,
  SCHEMA_VERSION,
} from "./mongo.js";
try {
  await connectDatabase();
  await ensureIndexes();
  console.info(`MongoDB schema version ${SCHEMA_VERSION} is ready.`);
} finally {
  await closeDatabase();
}

import type { Db } from "mongodb";

const copy = <T>(value: T): T => structuredClone(value);
const field = (row: any, key: string) =>
  key.split(".").reduce((value, part) => value?.[part], row);
const same = (a: any, b: any): boolean =>
  a == null && b == null
    ? true
    : a instanceof Date || b instanceof Date
      ? Number(a) === Number(b)
      : Array.isArray(a)
        ? a.some((item) => same(item, b))
        : a === b;

function matches(row: any, query: any): boolean {
  return Object.entries(query).every(([key, expected]: [string, any]) => {
    if (key === "$or") return expected.some((item: any) => matches(row, item));
    if (key === "$and")
      return expected.every((item: any) => matches(row, item));
    const actual = field(row, key);
    if (
      !expected ||
      expected instanceof Date ||
      typeof expected !== "object" ||
      Array.isArray(expected)
    )
      return same(actual, expected);
    return Object.entries(expected).every(
      ([operator, operand]: [string, any]) => {
        if (operator === "$exists") return (actual !== undefined) === operand;
        if (operator === "$type") return typeof actual === operand;
        if (operator === "$in")
          return operand.some((item: any) => same(actual, item));
        if (operator === "$nin")
          return !operand.some((item: any) => same(actual, item));
        if (operator === "$ne") return !same(actual, operand);
        if (operator === "$gt") return actual > operand;
        if (operator === "$gte") return actual >= operand;
        if (operator === "$lt") return actual < operand;
        if (operator === "$lte") return actual <= operand;
        throw new Error(`Unsupported test query operator ${operator}`);
      },
    );
  });
}

type Index = { name: string; keys: string[]; filter?: any; unique?: boolean };
export class MemoryDb {
  private data = new Map<string, any[]>();
  private indexes = new Map<string, Index[]>();
  private lock: Promise<void> = Promise.resolve();
  readonly db = this as unknown as Db;
  rows(name: string): any[] {
    if (!this.data.has(name)) this.data.set(name, []);
    return this.data.get(name)!;
  }
  async command() {
    return { ok: 1 };
  }

  client = {
    startSession: () => ({
      withTransaction: async (operation: () => Promise<void>) => {
        const preceding = this.lock;
        let unlock!: () => void;
        this.lock = new Promise<void>((resolve) => {
          unlock = resolve;
        });
        await preceding;
        const previous = copy(this.data);
        try {
          await operation();
        } catch (error) {
          this.data = previous;
          throw error;
        } finally {
          unlock();
        }
      },
      endSession: async () => undefined,
    }),
  };

  collection(name: string) {
    const db = this;
    function assertUnique(candidate: any, excluded?: any) {
      for (const index of db.indexes.get(name) ?? []) {
        if (
          !index.unique ||
          (index.filter && !matches(candidate, index.filter))
        )
          continue;
        const duplicate = db
          .rows(name)
          .some(
            (row) =>
              row !== excluded &&
              (!index.filter || matches(row, index.filter)) &&
              index.keys.every((key) =>
                same(field(row, key), field(candidate, key)),
              ),
          );
        if (duplicate)
          throw Object.assign(new Error("duplicate key"), { code: 11000 });
      }
      if (
        db
          .rows(name)
          .some((row) => row !== excluded && row._id === candidate._id)
      )
        throw Object.assign(new Error("duplicate id"), { code: 11000 });
    }
    function assign(row: any, key: string, value: any) {
      const path = key.split(".");
      const last = path.pop()!;
      let owner = row;
      for (const segment of path) owner = owner[segment] ??= {};
      owner[last] = value;
    }
    function expression(value: any, row: any): any {
      if (typeof value === "string" && value.startsWith("$"))
        return field(row, value.slice(1));
      if (!value || value instanceof Date || typeof value !== "object")
        return copy(value);
      if (Array.isArray(value))
        return value.map((item) => expression(item, row));
      if ("$ifNull" in value) {
        const pair = expression(value.$ifNull, row);
        return pair[0] ?? pair[1];
      }
      if ("$add" in value)
        return expression(value.$add, row).reduce(
          (a: number, b: number) => a + b,
          0,
        );
      if ("$eq" in value) {
        const pair = expression(value.$eq, row);
        return same(pair[0], pair[1]);
      }
      if ("$cond" in value)
        return expression(
          value.$cond[expression(value.$cond[0], row) ? 1 : 2],
          row,
        );
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, expression(v, row)]),
      );
    }
    function apply(row: any, update: any, inserting: boolean) {
      if (Array.isArray(update)) {
        for (const stage of update) {
          const values = expression(stage.$set ?? {}, row);
          for (const [key, value] of Object.entries(values))
            assign(row, key, value);
        }
        return row;
      }
      if (inserting) Object.assign(row, copy(update.$setOnInsert ?? {}));
      for (const [key, value] of Object.entries(update.$set ?? {}))
        assign(row, key, copy(value));
      for (const key of Object.keys(update.$unset ?? {})) delete row[key];
      for (const [key, value] of Object.entries(update.$inc ?? {}))
        assign(row, key, (field(row, key) ?? 0) + Number(value));
      for (const [key, value] of Object.entries(update.$max ?? {}))
        if (field(row, key) === undefined || field(row, key) < value!)
          assign(row, key, copy(value));
      for (const [key, value] of Object.entries(update.$min ?? {}))
        if (field(row, key) === undefined || field(row, key) > value!)
          assign(row, key, copy(value));
      for (const [key, value] of Object.entries(update.$addToSet ?? {})) {
        row[key] ??= [];
        if (!row[key].some((item: any) => same(item, value)))
          row[key].push(copy(value));
      }
      return row;
    }
    const collection = {
      find(query: any = {}) {
        let sorting: Record<string, number> = {};
        let maximum = Infinity;
        const result = () =>
          db
            .rows(name)
            .filter((row) => matches(row, query))
            .sort((a, b) => {
              for (const [key, direction] of Object.entries(sorting)) {
                const av = field(a, key),
                  bv = field(b, key);
                if (av < bv) return -direction;
                if (av > bv) return direction;
              }
              return 0;
            })
            .slice(0, maximum)
            .map(copy);
        const cursor = {
          sort(value: Record<string, number>) {
            sorting = value;
            return cursor;
          },
          limit(value: number) {
            maximum = value;
            return cursor;
          },
          async next() {
            return result()[0] ?? null;
          },
          async toArray() {
            return result();
          },
        };
        return cursor;
      },
      async findOne(query: any) {
        const row = db.rows(name).find((item) => matches(item, query));
        return row ? copy(row) : null;
      },
      async insertOne(row: any) {
        assertUnique(row);
        db.rows(name).push(copy(row));
        return { insertedId: row._id };
      },
      async updateOne(query: any, update: any, options: any = {}) {
        const old = db.rows(name).find((row) => matches(row, query));
        if (!old && !options.upsert)
          return { matchedCount: 0, modifiedCount: 0 };
        const initial = old
          ? copy(old)
          : Object.fromEntries(
              Object.entries(query).filter(
                ([key, value]) =>
                  !key.startsWith("$") &&
                  (value === null || typeof value !== "object"),
              ),
            );
        const candidate = apply(initial, update, !old);
        assertUnique(candidate, old);
        if (old) db.rows(name)[db.rows(name).indexOf(old)] = candidate;
        else db.rows(name).push(candidate);
        return {
          matchedCount: old ? 1 : 0,
          modifiedCount: 1,
          upsertedId: old ? null : candidate._id,
        };
      },
      async findOneAndUpdate(query: any, update: any, options: any = {}) {
        const candidates = db.rows(name).filter((item) => matches(item, query));
        if (options.sort)
          candidates.sort((a, b) => {
            for (const [key, direction] of Object.entries(options.sort)) {
              if (field(a, key) < field(b, key)) return -Number(direction);
              if (field(a, key) > field(b, key)) return Number(direction);
            }
            return 0;
          });
        const old = candidates[0];
        if (!old && !options.upsert) return null;
        const initial = old
          ? copy(old)
          : Object.fromEntries(
              Object.entries(query).filter(
                ([key, value]) =>
                  !key.startsWith("$") &&
                  (value === null || typeof value !== "object"),
              ),
            );
        const candidate = apply(initial, update, !old);
        assertUnique(candidate, old);
        if (old) db.rows(name)[db.rows(name).indexOf(old)] = candidate;
        else db.rows(name).push(candidate);
        // Return the snapshot at the atomic mutation, even if its predicate changed.
        return options.returnDocument === "after"
          ? copy(candidate)
          : old
            ? copy(old)
            : null;
      },
      async countDocuments(query: any = {}) {
        return db.rows(name).filter((row) => matches(row, query)).length;
      },
      async updateMany(query: any, update: any) {
        const ids = db
          .rows(name)
          .filter((row) => matches(row, query))
          .map((row) => row._id);
        for (const id of ids) await collection.updateOne({ _id: id }, update);
        return { modifiedCount: ids.length };
      },
      async deleteMany(query: any) {
        const before = db.rows(name).length;
        db.data.set(
          name,
          db.rows(name).filter((row) => !matches(row, query)),
        );
        return { deletedCount: before - db.rows(name).length };
      },
      async deleteOne(query: any) {
        const row = db.rows(name).find((item) => matches(item, query));
        if (!row) return { deletedCount: 0 };
        db.data.set(
          name,
          db.rows(name).filter((item) => item !== row),
        );
        return { deletedCount: 1 };
      },
      async createIndex(keys: Record<string, number>, options: any = {}) {
        const indexName =
          options.name ??
          Object.entries(keys)
            .map(([key, value]) => `${key}_${value}`)
            .join("_");
        const index = {
          name: indexName,
          keys: Object.keys(keys),
          unique: options.unique,
          filter: options.partialFilterExpression,
        };
        db.indexes.set(name, [
          ...(db.indexes.get(name) ?? []).filter(
            (item) => item.name !== indexName,
          ),
          index,
        ]);
        for (const row of db.rows(name)) assertUnique(row, row);
        return indexName;
      },
      async dropIndex(indexName: string) {
        db.indexes.set(
          name,
          (db.indexes.get(name) ?? []).filter(
            (index) => index.name !== indexName,
          ),
        );
      },
    };
    return collection;
  }
}

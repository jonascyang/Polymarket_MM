import { DatabaseSync } from "node:sqlite";

import { CREATE_TABLE_STATEMENTS } from "./schema";

export function openAnalyticsStore(dbPath: string): DatabaseSync {
  const database = new DatabaseSync(dbPath);

  for (const statement of CREATE_TABLE_STATEMENTS) {
    database.exec(statement);
  }

  return database;
}

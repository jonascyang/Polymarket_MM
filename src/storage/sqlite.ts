import { DatabaseSync } from "node:sqlite";

import {
  CREATE_TABLE_STATEMENTS,
  REQUIRED_TABLE_COLUMNS
} from "./schema";

function getExistingColumns(database: DatabaseSync, tableName: string): Set<string> {
  const columns = database
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string }>;

  return new Set(columns.map((column) => column.name));
}

function ensureRequiredColumns(database: DatabaseSync): void {
  for (const [tableName, columns] of Object.entries(REQUIRED_TABLE_COLUMNS)) {
    const existingColumns = getExistingColumns(database, tableName);

    for (const [columnName, definition] of Object.entries(columns)) {
      if (existingColumns.has(columnName)) {
        continue;
      }

      database.exec(
        `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`
      );
    }
  }
}

export function openAnalyticsStore(dbPath: string): DatabaseSync {
  const database = new DatabaseSync(dbPath);

  for (const statement of CREATE_TABLE_STATEMENTS) {
    database.exec(statement);
  }

  ensureRequiredColumns(database);

  return database;
}

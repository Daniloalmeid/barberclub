/** O schema vive em supabase/migrations. Este pacote não abre conexão na M1. */
export const databaseSchemas = [
  "public",
  "public_api",
  "server_api",
  "private",
  "ledger",
] as const;

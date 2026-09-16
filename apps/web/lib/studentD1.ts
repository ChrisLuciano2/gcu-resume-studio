// Runs SQL directly against a student's own Cloudflare D1 database, using
// whatever bearer token their Connection carries (OAuth access token or a
// pasted API token — d1Query doesn't care which). This is the central app's
// only way to read/write a student's data; the deployed Worker talks to the
// same D1 database independently via its own binding (see
// worker-template/src/index.js).

import { d1Query } from "./cloudflare";

export interface StudentD1 {
  accountId: string;
  databaseId: string;
  bearerToken: string;
}

export async function studentD1Query<T = unknown>(
  client: StudentD1,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return d1Query<T>(client.bearerToken, client.accountId, client.databaseId, sql, params);
}

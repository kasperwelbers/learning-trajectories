/**
 * D1 limits the number of bound parameters per statement (100), so `inArray` over many ids
 * has to be split into chunks.
 */
export async function inChunks<Id, Row>(
  ids: readonly Id[],
  query: (chunk: Id[]) => Promise<Row[]>,
  size = 90,
): Promise<Row[]> {
  const rows: Row[] = []
  for (let i = 0; i < ids.length; i += size) {
    rows.push(...(await query(ids.slice(i, i + size))))
  }
  return rows
}

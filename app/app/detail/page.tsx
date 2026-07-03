import { notFound } from 'next/navigation';
import { ComponentMapDetail } from '../ui/component-map-detail';
import { loadMapViewData, normalizeMapSystem } from '@/lib/map-data';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function pickParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function DetailPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const system = normalizeMapSystem(pickParam(params.system));
  const kind = pickParam(params.kind);
  const key = pickParam(params.key);

  if (!kind || !key) {
    notFound();
  }

  const data = loadMapViewData(system);
  const row = data.rows.find((item) => item.kind === kind && item.key === key);

  if (!row) {
    notFound();
  }

  return <ComponentMapDetail row={row} system={system} />;
}

import { ComponentMapDashboard } from './ui/component-map-dashboard';
import { loadMapViewData, normalizeMapSystem } from '@/lib/map-data';

export const dynamic = 'force-dynamic';

export default async function Home({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = searchParams ? await searchParams : {};
  const systemParam = Array.isArray(params.system) ? params.system[0] : params.system;
  const data = loadMapViewData(normalizeMapSystem(systemParam));
  return <ComponentMapDashboard data={data} />;
}

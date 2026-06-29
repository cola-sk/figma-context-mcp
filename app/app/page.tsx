import { ComponentMapDashboard } from './ui/component-map-dashboard';
import { loadMapViewData } from '@/lib/map-data';

export const dynamic = 'force-dynamic';

export default function Home() {
  const data = loadMapViewData();
  return <ComponentMapDashboard data={data} />;
}

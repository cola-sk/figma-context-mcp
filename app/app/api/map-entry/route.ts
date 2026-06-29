import { NextResponse } from 'next/server';
import { normalizeTargetLibrary } from '@/lib/mapping-constants';
import { loadComponentMap, mapToViewData, saveComponentMap, updateMapEntry, type MappingKind, type MappingStatus } from '@/lib/map-data';

type PatchBody = {
  kind?: MappingKind;
  key?: string;
  status?: MappingStatus;
  target?: {
    library?: string;
    component?: string;
  } | null;
};

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function PATCH(request: Request) {
  let body: PatchBody;

  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return badRequest('Invalid JSON body.');
  }

  if (body.kind !== 'component-set' && body.kind !== 'loose-component') {
    return badRequest('kind must be component-set or loose-component.');
  }

  if (!body.key) {
    return badRequest('key is required.');
  }

  if (body.status !== 'mapped' && body.status !== 'unresolved') {
    return badRequest('status must be mapped or unresolved.');
  }

  if (body.status === 'mapped') {
    const library = normalizeTargetLibrary(body.target?.library);
    if (!library) {
      return badRequest('target.library must be Element Plus or Ti Component.');
    }

    if (!body.target?.component?.trim()) {
      return badRequest('target.component is required when status is mapped.');
    }
  }

  try {
    const library = body.status === 'mapped' ? normalizeTargetLibrary(body.target?.library) : null;
    const map = loadComponentMap();
    updateMapEntry({
      map,
      kind: body.kind,
      key: body.key,
      status: body.status,
      target:
        body.status === 'mapped'
          ? {
              library: library!,
              component: body.target!.component!,
            }
          : null,
    });
    saveComponentMap(map);

    return NextResponse.json(mapToViewData(map));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update map entry.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

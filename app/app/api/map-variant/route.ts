import { NextResponse } from 'next/server';
import { normalizeTargetLibrary } from '@/lib/mapping-constants';
import { loadComponentMap, mapToViewData, saveComponentMap, updateVariantEntry, type VariantMode } from '@/lib/map-data';

type PatchBody = {
  componentSetKey?: string;
  variantKey?: string;
  mode?: VariantMode;
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

  if (!body.componentSetKey) {
    return badRequest('componentSetKey is required.');
  }

  if (!body.variantKey) {
    return badRequest('variantKey is required.');
  }

  if (body.mode !== 'inherit' && body.mode !== 'override' && body.mode !== 'unresolved') {
    return badRequest('mode must be inherit, override, or unresolved.');
  }

  if (body.mode === 'override') {
    const library = normalizeTargetLibrary(body.target?.library);
    if (!library) {
      return badRequest('target.library must be Element Plus or Ti Component.');
    }

    if (!body.target?.component?.trim()) {
      return badRequest('target.component is required when mode is override.');
    }
  }

  try {
    const library = body.mode === 'override' ? normalizeTargetLibrary(body.target?.library) : null;
    const map = loadComponentMap();
    updateVariantEntry({
      map,
      componentSetKey: body.componentSetKey,
      variantKey: body.variantKey,
      mode: body.mode,
      target:
        body.mode === 'override'
          ? {
              library: library!,
              component: body.target!.component!,
            }
          : null,
    });
    saveComponentMap(map);

    return NextResponse.json(mapToViewData(map));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update variant entry.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

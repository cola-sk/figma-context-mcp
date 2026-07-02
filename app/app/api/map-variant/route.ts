import { NextResponse } from 'next/server';
import { normalizeTargetLibrary } from '@/lib/mapping-constants';
import { loadComponentMap, mapToViewData, normalizeMapSystem, saveComponentMap, updateVariantEntry, type VariantMode } from '@/lib/map-data';

type PatchBody = {
  system?: string;
  componentSetKey?: string;
  variantKey?: string;
  mode?: VariantMode;
  target?: {
    library?: string;
    component?: string;
    props?: Record<string, string>;
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

  if (body.mode !== 'inherit' && body.mode !== 'override' && body.mode !== 'unresolved' && body.mode !== 'internal') {
    return badRequest('mode must be inherit, override, unresolved, or internal.');
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
    const system = normalizeMapSystem(body.system);
    const library = body.mode === 'override' ? normalizeTargetLibrary(body.target?.library) : null;
    const map = loadComponentMap(system);
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
              props: body.target?.props,
            }
          : null,
    });
    saveComponentMap(map, system);

    return NextResponse.json(mapToViewData(map, system));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update variant entry.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { getComponentAssetsRoot } from '@/lib/map-data';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params:
    | Promise<{ system: string; fileName: string }>
    | { system: string; fileName: string };
};

const contentTypes: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

export async function GET(_request: Request, context: RouteContext) {
  const params = await context.params;
  const system = params.system === 'b' || params.system === 'd' ? params.system : null;
  const fileName = params.fileName;

  if (!system || !fileName || path.basename(fileName) !== fileName) {
    return NextResponse.json({ error: 'Invalid preview path.' }, { status: 400 });
  }

  const previewDir = path.resolve(getComponentAssetsRoot(), 'previews', system);
  const previewPath = path.resolve(previewDir, fileName);

  if (!previewPath.startsWith(`${previewDir}${path.sep}`)) {
    return NextResponse.json({ error: 'Invalid preview path.' }, { status: 400 });
  }

  try {
    const bytes = await fs.promises.readFile(previewPath);
    return new Response(new Uint8Array(bytes), {
      headers: {
        'content-type': contentTypes[path.extname(fileName).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'public, max-age=3600',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Preview not found.' }, { status: 404 });
  }
}

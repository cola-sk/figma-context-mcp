export const targetLibraries = ['Element Plus', 'Ti Component'] as const;

export type TargetLibrary = (typeof targetLibraries)[number];

export function normalizeTargetLibrary(value: unknown): TargetLibrary | null {
  if (value === 'Element Plus') return 'Element Plus';
  if (value === 'Ti Component' || value === 'TiComponents') return 'Ti Component';
  return null;
}

export function isTargetLibrary(value: unknown): value is TargetLibrary {
  return normalizeTargetLibrary(value) === value;
}

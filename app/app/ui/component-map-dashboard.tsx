'use client';

import { Copy } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { targetLibraries, type TargetLibrary } from '@/lib/mapping-constants';
import type { MapRow, MapVariant, MapViewData, MappingKind, MappingStatus, VariantMode } from '@/lib/map-data';

type StatusFilter = 'all' | MappingStatus;
type KindFilter = 'all' | MappingKind;
type CategoryFilter = 'all' | TargetLibrary;
type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type GroupBy = 'page' | 'category' | 'none';
type GroupedRow =
  | {
      type: 'group';
      key: string;
      label: string;
      total: number;
      mapped: number;
      unresolved: number;
    }
  | {
      type: 'row';
      row: MapRow;
    };

const statusLabels: Record<StatusFilter, string> = {
  all: '全部',
  mapped: '已映射',
  unresolved: '未映射',
};

const kindLabels: Record<KindFilter, string> = {
  all: '全部类型',
  'component-set': 'Component Set',
  'loose-component': 'Loose Component',
};

const categoryLabels: Record<CategoryFilter, string> = {
  all: '全部分类',
  'Element Plus': 'Element Plus',
  'Ti Component': 'Ti Component',
};

const groupByLabels: Record<GroupBy, string> = {
  page: '按 Page',
  category: '按分类',
  none: '不分组',
};

const variantModeLabels: Record<VariantMode, string> = {
  inherit: '继承父级',
  override: '单独覆盖',
  unresolved: '未映射',
};

function formatDate(value?: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function copyText(value: string) {
  void navigator.clipboard.writeText(value);
}

function statusClass(status: MappingStatus) {
  return status === 'mapped' ? 'statusMapped' : 'statusUnresolved';
}

export function ComponentMapDashboard({ data }: { data: MapViewData }) {
  const [viewData, setViewData] = useState(data);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [kind, setKind] = useState<KindFilter>('all');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [groupBy, setGroupBy] = useState<GroupBy>('page');
  const [page, setPage] = useState('all');
  const [target, setTarget] = useState('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(data.rows[0]?.rowId ?? '');

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return viewData.rows.filter((row) => {
      if (status !== 'all' && row.status !== status) return false;
      if (kind !== 'all' && row.kind !== kind) return false;
      if (category !== 'all' && row.targetLibrary !== category) return false;
      if (page !== 'all' && row.page !== page) return false;
      if (target !== 'all' && row.targetComponent !== target) return false;
      if (!normalizedQuery) return true;

      return [row.name, row.page, row.key, row.figmaId, row.targetComponent, row.targetLibrary, row.reason]
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [category, kind, page, query, status, target, viewData.rows]);

  const selected = filteredRows.find((row) => row.rowId === selectedId) ?? filteredRows[0] ?? viewData.rows[0];
  const mappedRows = viewData.rows.filter((row) => row.status === 'mapped').length;
  const unresolvedRows = viewData.rows.filter((row) => row.status === 'unresolved').length;
  const groupedRows = useMemo<GroupedRow[]>(() => {
    if (groupBy === 'none') {
      return filteredRows.map((row) => ({ type: 'row', row }));
    }

    const groups = new Map<string, MapRow[]>();

    filteredRows.forEach((row) => {
      const label = groupBy === 'page' ? row.page : row.targetLibrary === '-' ? '未映射' : row.targetLibrary;
      const rows = groups.get(label) ?? [];
      rows.push(row);
      groups.set(label, rows);
    });

    return Array.from(groups.entries()).flatMap(([label, rows]) => [
      {
        type: 'group' as const,
        key: `${groupBy}:${label}`,
        label,
        total: rows.length,
        mapped: rows.filter((row) => row.status === 'mapped').length,
        unresolved: rows.filter((row) => row.status === 'unresolved').length,
      },
      ...rows.map((row) => ({ type: 'row' as const, row })),
    ]);
  }, [filteredRows, groupBy]);

  return (
    <main className="appShell">
      <header className="topBar">
        <div>
          <h1>Component Map Viewer</h1>
          <p>
            {viewData.schemaVersion} · generated {formatDate(viewData.generatedAt)}
          </p>
        </div>
        <div className="topActions">
          <button
            type="button"
            className="iconButton"
            title="Copy map path"
            aria-label="Copy map path"
            onClick={() => copyText('mappings/figma-component-key-map.json')}
          >
            <Copy size={16} aria-hidden="true" />
          </button>
        </div>
      </header>

      <section className="statsGrid" aria-label="mapping stats">
        <Stat label="Component Sets" value={viewData.stats.componentSetCount} />
        <Stat label="Mapped Sets" value={viewData.stats.mappedComponentSetCount} tone="good" />
        <Stat label="Unresolved Sets" value={viewData.stats.unresolvedComponentSetCount} tone="bad" />
        <Stat label="Loose Components" value={viewData.stats.looseComponentCount} />
        <Stat label="Mapped Variants" value={viewData.stats.mappedComponentCount} tone="good" />
        <Stat label="Unresolved Variants" value={viewData.stats.unresolvedComponentCount} tone="bad" />
      </section>

      <section className="toolbar" aria-label="filters">
        <label>
          Search
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="name / key / target / reason" />
        </label>
        <label>
          Status
          <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Type
          <select value={kind} onChange={(event) => setKind(event.target.value as KindFilter)}>
            {Object.entries(kindLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Category
          <select value={category} onChange={(event) => setCategory(event.target.value as CategoryFilter)}>
            {Object.entries(categoryLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Group By
          <select value={groupBy} onChange={(event) => setGroupBy(event.target.value as GroupBy)}>
            {Object.entries(groupByLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Page
          <select value={page} onChange={(event) => setPage(event.target.value)}>
            <option value="all">全部页面</option>
            {viewData.pages.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label>
          Target
          <select value={target} onChange={(event) => setTarget(event.target.value)}>
            <option value="all">全部组件</option>
            {viewData.targetComponents.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="contentGrid">
        <div className="tablePane">
          <div className="tableHeader">
            <strong>{filteredRows.length}</strong>
            <span>
              shown · {mappedRows} mapped · {unresolvedRows} unresolved · {groupByLabels[groupBy]}
            </span>
          </div>
          <div className="tableScroll">
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Figma Component</th>
                  <th>Page</th>
                  <th>Target</th>
                  <th>Variants</th>
                  <th>Key</th>
                </tr>
              </thead>
              <tbody>
                {groupedRows.map((item) =>
                  item.type === 'group' ? (
                    <tr key={item.key} className="groupRow">
                      <td colSpan={6}>
                        <div className="groupTitle">
                          <strong>{item.label}</strong>
                          <span>
                            {item.total} total · {item.mapped} mapped · {item.unresolved} unresolved
                          </span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr
                      key={item.row.rowId}
                      className={selected?.rowId === item.row.rowId ? 'selectedRow' : ''}
                      onClick={() => setSelectedId(item.row.rowId)}
                    >
                      <td>
                        <span className={`statusPill ${statusClass(item.row.status)}`}>{statusLabels[item.row.status]}</span>
                      </td>
                      <td>
                        <div className="primaryCell">{item.row.name}</div>
                        <div className="secondaryCell">{kindLabels[item.row.kind]}</div>
                      </td>
                      <td>{item.row.page}</td>
                      <td>
                        <div className="primaryCell">{item.row.targetComponent}</div>
                        <div className="secondaryCell">{item.row.targetLibrary}</div>
                      </td>
                      <td>{item.row.variantCount}</td>
                      <td>
                        <code>{item.row.key.slice(0, 10)}...</code>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="detailPane">
          {selected ? <Detail row={selected} onSaved={setViewData} /> : <div className="emptyState">No rows match the current filters.</div>}
        </aside>
      </section>
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value?: number; tone?: 'good' | 'bad' }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <span>{label}</span>
      <strong>{value ?? 0}</strong>
    </div>
  );
}

function toEditableLibrary(value: string): TargetLibrary {
  return value === 'Ti Component' ? 'Ti Component' : 'Element Plus';
}

function Detail({ row, onSaved }: { row: MapRow; onSaved: (data: MapViewData) => void }) {
  const [draftStatus, setDraftStatus] = useState<MappingStatus>(row.status);
  const [draftLibrary, setDraftLibrary] = useState<TargetLibrary>(toEditableLibrary(row.targetLibrary));
  const [draftComponent, setDraftComponent] = useState(row.targetComponent === '-' ? '' : row.targetComponent);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    setDraftStatus(row.status);
    setDraftLibrary(toEditableLibrary(row.targetLibrary));
    setDraftComponent(row.targetComponent === '-' ? '' : row.targetComponent);
    setSaveState('idle');
    setError('');
  }, [row.rowId]);

  const originalLibrary = toEditableLibrary(row.targetLibrary);
  const originalComponent = row.targetComponent === '-' ? '' : row.targetComponent;
  const isDirty = draftStatus !== row.status || draftLibrary !== originalLibrary || draftComponent.trim() !== originalComponent;
  const canSave = saveState !== 'saving' && isDirty && (draftStatus === 'unresolved' || draftComponent.trim().length > 0);

  async function saveMapping() {
    if (!canSave) return;

    setSaveState('saving');
    setError('');

    const response = await fetch('/api/map-entry', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        kind: row.kind,
        key: row.key,
        status: draftStatus,
        target:
          draftStatus === 'mapped'
            ? {
                library: draftLibrary,
                component: draftComponent.trim(),
              }
            : null,
      }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? 'Save failed.');
      setSaveState('error');
      return;
    }

    const nextData = (await response.json()) as MapViewData;
    onSaved(nextData);
    setDraftComponent(draftStatus === 'mapped' ? draftComponent.trim() : '');
    setSaveState('saved');
  }

  return (
    <div className="detail">
      <div className="detailTitle">
        <div>
          <span className={`statusPill ${statusClass(row.status)}`}>{statusLabels[row.status]}</span>
          <h2>{row.name}</h2>
        </div>
        <button type="button" className="iconButton" title="Copy stable key" aria-label="Copy stable key" onClick={() => copyText(row.key)}>
          <Copy size={16} aria-hidden="true" />
        </button>
      </div>

      <dl className="kv">
        <div>
          <dt>Kind</dt>
          <dd>{kindLabels[row.kind]}</dd>
        </div>
        <div>
          <dt>Page</dt>
          <dd>{row.page}</dd>
        </div>
        <div>
          <dt>Figma ID</dt>
          <dd>
            <code>{row.figmaId}</code>
          </dd>
        </div>
        <div>
          <dt>Stable Key</dt>
          <dd>
            <code>{row.key}</code>
          </dd>
        </div>
        <div>
          <dt>Target</dt>
          <dd>
            {row.targetLibrary} / {row.targetComponent}
          </dd>
        </div>
        <div>
          <dt>Variants</dt>
          <dd>{row.variantCount}</dd>
        </div>
      </dl>

      <section className="editorPanel">
        <h3>Edit Mapping</h3>
        <div className="editForm">
          <label>
            Status
            <select value={draftStatus} onChange={(event) => setDraftStatus(event.target.value as MappingStatus)}>
              <option value="mapped">已映射</option>
              <option value="unresolved">未映射</option>
            </select>
          </label>
          <label>
            Category
            <select
              value={draftLibrary}
              disabled={draftStatus === 'unresolved'}
              onChange={(event) => setDraftLibrary(event.target.value as TargetLibrary)}
            >
              {targetLibraries.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label>
            Target Component
            <input
              value={draftComponent}
              disabled={draftStatus === 'unresolved'}
              placeholder="el-button / TiTable"
              onChange={(event) => setDraftComponent(event.target.value)}
            />
          </label>
          <div className="editActions">
            <button
              type="button"
              className="secondaryButton"
              disabled={!isDirty || saveState === 'saving'}
              onClick={() => {
                setDraftStatus(row.status);
                setDraftLibrary(originalLibrary);
                setDraftComponent(originalComponent);
                setSaveState('idle');
                setError('');
              }}
            >
              Reset
            </button>
            <button type="button" className="primaryButton" disabled={!canSave} onClick={saveMapping}>
              {saveState === 'saving' ? 'Saving' : 'Save'}
            </button>
          </div>
          {saveState === 'saved' ? <p className="saveMessage">Saved to mappings/figma-component-key-map.json.</p> : null}
          {error ? <p className="errorMessage">{error}</p> : null}
        </div>
      </section>

      {row.variants.length > 0 ? (
        <section>
          <h3>Variants</h3>
          <div className="variantList">
            {row.variants.map((variant) => (
              <VariantEditor key={variant.key} parent={row} variant={variant} onSaved={onSaved} />
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <h3>Reason</h3>
        <p>{row.reason}</p>
      </section>

      <section>
        <h3>Evidence</h3>
        {row.evidence.length > 0 ? (
          <ul>
            {row.evidence.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p>No explicit evidence recorded.</p>
        )}
      </section>

      <section>
        <h3>Raw Entry</h3>
        <pre>{JSON.stringify(row.raw, null, 2)}</pre>
      </section>
    </div>
  );
}

function formatVariantProperties(variant: MapVariant) {
  const entries = Object.entries(variant.variantProperties);
  if (entries.length === 0) return '-';
  return entries.map(([key, value]) => `${key}=${value}`).join(', ');
}

function VariantEditor({ parent, variant, onSaved }: { parent: MapRow; variant: MapVariant; onSaved: (data: MapViewData) => void }) {
  const [mode, setMode] = useState<VariantMode>(variant.mode);
  const [library, setLibrary] = useState<TargetLibrary>(toEditableLibrary(variant.targetLibrary));
  const [component, setComponent] = useState(variant.targetComponent === '-' ? '' : variant.targetComponent);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    setMode(variant.mode);
    setLibrary(toEditableLibrary(variant.targetLibrary));
    setComponent(variant.targetComponent === '-' ? '' : variant.targetComponent);
    setSaveState('idle');
    setError('');
  }, [variant.key, variant.mode, variant.targetLibrary, variant.targetComponent]);

  const originalLibrary = toEditableLibrary(variant.targetLibrary);
  const originalComponent = variant.targetComponent === '-' ? '' : variant.targetComponent;
  const isDirty = mode !== variant.mode || library !== originalLibrary || component.trim() !== originalComponent;
  const canSave = saveState !== 'saving' && isDirty && (mode !== 'override' || component.trim().length > 0);
  const fieldsDisabled = mode !== 'override';

  async function saveVariant() {
    if (!canSave) return;

    setSaveState('saving');
    setError('');

    const response = await fetch('/api/map-variant', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        componentSetKey: parent.key,
        variantKey: variant.key,
        mode,
        target:
          mode === 'override'
            ? {
                library,
                component: component.trim(),
              }
            : null,
      }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? 'Save failed.');
      setSaveState('error');
      return;
    }

    const nextData = (await response.json()) as MapViewData;
    onSaved(nextData);
    setComponent(mode === 'override' ? component.trim() : '');
    setSaveState('saved');
  }

  return (
    <div className="variantItem">
      <div className="variantHeader">
        <div>
          <strong>{variant.name}</strong>
          <p>{formatVariantProperties(variant)}</p>
        </div>
        <span className={`statusPill ${variant.mode === 'unresolved' ? 'statusUnresolved' : 'statusMapped'}`}>
          {variantModeLabels[variant.mode]}
        </span>
      </div>
      <div className="variantTarget">
        <span>{variant.targetLibrary}</span>
        <span>{variant.targetComponent}</span>
      </div>
      <div className="variantEditGrid">
        <label>
          Mode
          <select value={mode} onChange={(event) => setMode(event.target.value as VariantMode)}>
            {Object.entries(variantModeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Category
          <select disabled={fieldsDisabled} value={library} onChange={(event) => setLibrary(event.target.value as TargetLibrary)}>
            {targetLibraries.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label>
          Target
          <input disabled={fieldsDisabled} value={component} placeholder="el-button / TiTable" onChange={(event) => setComponent(event.target.value)} />
        </label>
        <div className="variantActions">
          <button
            type="button"
            className="secondaryButton"
            disabled={!isDirty || saveState === 'saving'}
            onClick={() => {
              setMode(variant.mode);
              setLibrary(originalLibrary);
              setComponent(originalComponent);
              setSaveState('idle');
              setError('');
            }}
          >
            Reset
          </button>
          <button type="button" className="primaryButton" disabled={!canSave} onClick={saveVariant}>
            {saveState === 'saving' ? 'Saving' : 'Save'}
          </button>
        </div>
      </div>
      {variant.reason !== '-' ? <p className="variantReason">{variant.reason}</p> : null}
      {saveState === 'saved' ? <p className="saveMessage">Variant saved.</p> : null}
      {error ? <p className="errorMessage">{error}</p> : null}
    </div>
  );
}

'use client';

import { Copy } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent, WheelEvent } from 'react';
import { targetLibraries, type TargetLibrary } from '@/lib/mapping-constants';
import type { MapRow, MapSystem, MapVariant, MapViewData, MappingKind, MappingStatus, VariantMode } from '@/lib/map-data';

type StatusFilter = 'all' | MappingStatus;
type KindFilter = 'all' | MappingKind;
type CategoryFilter = 'all' | TargetLibrary;
type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type GroupBy = 'page' | 'category' | 'none';
type ImagePreviewItem = { key: string; url: string; name: string; kind: string };
type ImagePreview = { items: ImagePreviewItem[]; activeIndex: number } | null;
type PanPosition = { x: number; y: number };
type DragState = { pointerId: number; startX: number; startY: number; originX: number; originY: number };
type GroupedRow =
  | {
      type: 'group';
      key: string;
      label: string;
      total: number;
      mapped: number;
      unresolved: number;
      internal: number;
    }
  | {
      type: 'row';
      row: MapRow;
    };

const statusLabels: Record<StatusFilter, string> = {
  all: '全部',
  mapped: '已映射',
  unresolved: '未映射',
  internal: '内部组件',
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
  internal: '内部组件',
};

const systemOptions: Array<{ id: MapSystem; label: string }> = [
  { id: 'd', label: 'D 端' },
  { id: 'b', label: 'B 端' },
];

function PropsEditor({ value, onChange, disabled }: { value: Record<string, string>; onChange: (props: Record<string, string>) => void; disabled?: boolean }) {
  const [expanded, setExpanded] = useState(Object.keys(value).length > 0);
  const entries = Object.entries(value);

  function addEntry() {
    onChange({ ...value, '': '' });
    setExpanded(true);
  }

  function updateEntry(index: number, field: 'key' | 'value', text: string) {
    const next: Record<string, string> = {};
    entries.forEach(([k, v], i) => {
      if (i === index) {
        const entryKey = field === 'key' ? text : k;
        const entryVal = field === 'value' ? text : v;
        next[entryKey] = entryVal;
      } else {
        next[k] = v;
      }
    });
    onChange(next);
  }

  function removeEntry(index: number) {
    const next = { ...value };
    delete next[entries[index][0]];
    onChange(next);
  }

  return (
    <div className="propsSection">
      <div className="propsToggleRow">
        <button type="button" className="propsToggle" disabled={disabled} onClick={() => setExpanded(!expanded)}>
          <span className={`propsChevron ${expanded ? 'propsChevronOpen' : ''}`}>▶</span>
          Props {entries.length > 0 ? `(${entries.length})` : ''}
        </button>
        {!expanded && !disabled && (
          <button type="button" className="secondaryButton propsAdd" onClick={addEntry}>
            + 添加 prop
          </button>
        )}
      </div>
      {expanded && (
        <div className="propsGrid">
          {entries.map(([k, v], i) => (
            <div key={`prop-${i}`} className="propsRow">
              <input disabled={disabled} value={k} placeholder="key" onChange={(e) => updateEntry(i, 'key', e.target.value)} />
              <input disabled={disabled} value={v} placeholder="value" onChange={(e) => updateEntry(i, 'value', e.target.value)} />
              <button type="button" className="secondaryButton propsRemove" disabled={disabled} onClick={() => removeEntry(i)}>
                ×
              </button>
            </div>
          ))}
          {!disabled && (
            <button type="button" className="secondaryButton propsAdd" onClick={addEntry}>
              + 添加 prop
            </button>
          )}
        </div>
      )}
    </div>
  );
}

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
  if (status === 'mapped') return 'statusMapped';
  if (status === 'internal') return 'statusInternal';
  return 'statusUnresolved';
}

function getRowPreviewItems(row: MapRow): ImagePreviewItem[] {
  return [
    row.previewUrl
      ? {
          key: row.key,
          url: row.previewUrl,
          name: row.name,
          kind: kindLabels[row.kind],
        }
      : null,
    ...row.variants.map((variant) =>
      variant.previewUrl
        ? {
            key: variant.key,
            url: variant.previewUrl,
            name: variant.name,
            kind: 'Variant',
          }
        : null,
    ),
  ].filter((item): item is ImagePreviewItem => Boolean(item));
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
  const [imagePreview, setImagePreview] = useState<ImagePreview>(null);
  const detailPaneRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setViewData(data);
    setSelectedId(data.rows[0]?.rowId ?? '');
    setStatus('all');
    setKind('all');
    setCategory('all');
    setPage('all');
    setTarget('all');
    setQuery('');
  }, [data]);

  useEffect(() => {
    if (detailPaneRef.current) {
      detailPaneRef.current.scrollTop = 0;
    }
  }, [selectedId]);

  useEffect(() => {
    if (!imagePreview) return undefined;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setImagePreview(null);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [imagePreview]);

  function openPreview(items: ImagePreviewItem[], activeIndex = 0) {
    if (items.length === 0) return;
    setImagePreview({ items, activeIndex: Math.max(0, Math.min(activeIndex, items.length - 1)) });
  }

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
  const internalRows = viewData.rows.filter((row) => row.status === 'internal').length;
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
        internal: rows.filter((row) => row.status === 'internal').length,
      },
      ...rows.map((row) => ({ type: 'row' as const, row })),
    ]);
  }, [filteredRows, groupBy]);

  return (
    <div className="layoutWrapper">
      <nav className="navBar" aria-label="主导航">
        <div className="navContainer">
          <div className="logoArea">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="logoIcon" aria-hidden="true">
              <defs>
                <linearGradient id="logoGrad" x1="3" y1="3" x2="29" y2="29" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#0F766E" />
                  <stop offset="0.56" stopColor="#0D9488" />
                  <stop offset="1" stopColor="#0284C7" />
                </linearGradient>
              </defs>
              <g fillOpacity="0.95">
                <path d="M 10.75 6.95 L 15.27 9.56 L 10.75 12.17 L 6.24 9.56 Z" fill="url(#logoGrad)" stroke="white" strokeWidth="0.6" strokeOpacity="0.15" />
                <path d="M 16.00 3.92 L 20.52 6.53 L 16.00 9.14 L 11.48 6.53 Z" fill="url(#logoGrad)" stroke="white" strokeWidth="0.6" strokeOpacity="0.15" />
                <path d="M 5.87 10.19 L 10.38 12.80 L 10.38 17.99 L 5.87 15.38 Z" fill="url(#logoGrad)" stroke="white" strokeWidth="0.6" strokeOpacity="0.15" />
                <path d="M 5.87 16.22 L 10.38 18.83 L 10.38 24.02 L 5.87 21.41 Z" fill="url(#logoGrad)" stroke="white" strokeWidth="0.6" strokeOpacity="0.15" />
                <path d="M 11.12 19.25 L 15.63 21.86 L 15.63 27.05 L 11.12 24.44 Z" fill="url(#logoGrad)" stroke="white" strokeWidth="0.6" strokeOpacity="0.15" />
              </g>
              <g fillOpacity="0.75">
                <path d="M 21.25 6.95 L 25.77 9.56 L 21.25 12.17 L 16.73 9.56 Z" fill="url(#logoGrad)" stroke="white" strokeWidth="0.6" strokeOpacity="0.15" />
                <path d="M 26.13 10.19 L 26.13 15.38 L 21.62 17.99 L 21.62 12.80 Z" fill="url(#logoGrad)" stroke="white" strokeWidth="0.6" strokeOpacity="0.15" />
                <path d="M 26.13 16.22 L 26.13 21.44 L 21.62 24.02 L 21.62 18.83 Z" fill="url(#logoGrad)" stroke="white" strokeWidth="0.6" strokeOpacity="0.15" />
                <path d="M 20.88 19.25 L 20.88 24.44 L 16.37 27.05 L 16.37 21.86 Z" fill="url(#logoGrad)" stroke="white" strokeWidth="0.6" strokeOpacity="0.15" />
              </g>
            </svg>
            <span className="logoText">FE/D Bridge</span>
            <span className="logoBadge">Beta</span>
          </div>

          <div className="navActions">
            <div className="systemSwitch" aria-label="组件系统">
              {systemOptions.map((option) => (
                <a key={option.id} className={viewData.system === option.id ? 'active' : ''} href={`?system=${option.id}`}>
                  {option.label}
                </a>
              ))}
            </div>
          </div>
        </div>
      </nav>

      <main className="appShell">
        <header className="metadataBar">
          <div className="metadataLeft">
            <h2>{viewData.systemLabel} 组件映射</h2>
            <p>Schema：<code>{viewData.schemaVersion}</code> · 生成时间 {formatDate(viewData.generatedAt)}</p>
          </div>
        </header>

        <section className="statsGrid" aria-label="映射统计">
          <Stat label="Component Sets" value={viewData.stats.componentSetCount} />
          <Stat label="已映射 Sets" value={viewData.stats.mappedComponentSetCount} tone="good" />
          <Stat label="内部 Sets" value={viewData.stats.internalComponentSetCount} />
          <Stat label="未映射 Sets" value={viewData.stats.unresolvedComponentSetCount} tone="bad" />
          <Stat label="Loose Components" value={viewData.stats.looseComponentCount} />
          <Stat label="已映射 Variants" value={viewData.stats.mappedComponentCount} tone="good" />
          <Stat label="内部 Variants" value={viewData.stats.internalComponentCount} />
          <Stat label="未映射 Variants" value={viewData.stats.unresolvedComponentCount} tone="bad" />
        </section>

        <section className="toolbar" aria-label="筛选">
          <label>
            搜索
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名称 / key / 目标 / 原因" />
          </label>
          <label>
            状态
            <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            类型
            <select value={kind} onChange={(event) => setKind(event.target.value as KindFilter)}>
              {Object.entries(kindLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            分类
            <select value={category} onChange={(event) => setCategory(event.target.value as CategoryFilter)}>
              {Object.entries(categoryLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            分组
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
            目标
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
                条 · 已映射 {mappedRows} · 未映射 {unresolvedRows} · 内部 {internalRows} · {groupByLabels[groupBy]}
              </span>
            </div>
            <div className="tableScroll">
              <table>
                <thead>
                <tr>
                  <th>预览</th>
                  <th>状态</th>
                  <th>Figma Component</th>
                  <th>Page</th>
                    <th>目标</th>
                    <th>Variants</th>
                    <th>Key</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedRows.map((item) =>
                  item.type === 'group' ? (
                    <tr key={item.key} className="groupRow">
                      <td colSpan={7}>
                          <div className="groupTitle">
                            <strong>{item.label}</strong>
                            <span>
                              共 {item.total} · 已映射 {item.mapped} · 未映射 {item.unresolved} · 内部 {item.internal}
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
                        <PreviewThumb url={item.row.previewUrl} name={item.row.name} onOpen={() => openPreview(getRowPreviewItems(item.row), 0)} />
                      </td>
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

          <aside ref={detailPaneRef} className="detailPane">
            {selected ? <Detail row={selected} system={viewData.system} mapFile={viewData.mapFile} onSaved={setViewData} onPreview={openPreview} /> : <div className="emptyState">当前筛选条件下没有匹配数据。</div>}
          </aside>
        </section>
      </main>
      {imagePreview ? <ImageLightbox preview={imagePreview} onClose={() => setImagePreview(null)} /> : null}
    </div>
  );
}

function PreviewThumb({ url, name, onOpen }: { url?: string; name: string; onOpen: () => void }) {
  if (!url) {
    return <div className="previewThumb previewEmpty" aria-label="无预览" />;
  }

  return (
    <button
      type="button"
      className="previewThumb previewButton"
      title="打开预览"
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
    >
      <img src={url} alt={`${name} 预览`} loading="lazy" />
    </button>
  );
}

function ImageLightbox({ preview, onClose }: { preview: { items: ImagePreviewItem[]; activeIndex: number }; onClose: () => void }) {
  const [activeIndex, setActiveIndex] = useState(preview.activeIndex);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<PanPosition>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<DragState | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const active = preview.items[activeIndex] ?? preview.items[0];

  useEffect(() => {
    setActiveIndex(preview.activeIndex);
    resetView(1);
  }, [preview]);

  useEffect(() => {
    fitToStage();

    function handleResize() {
      fitToStage();
    }

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [active.url]);

  function selectImage(index: number) {
    setActiveIndex(index);
    resetView(1);
  }

  function resetView(nextZoom = 1) {
    setZoom(nextZoom);
    setPan({ x: 0, y: 0 });
    setIsDragging(false);
    dragRef.current = null;
  }

  function fitToStage() {
    const stage = stageRef.current;
    const image = imageRef.current;
    if (!stage || !image || !image.naturalWidth || !image.naturalHeight) return;

    const padding = 32;
    const availableWidth = Math.max(1, stage.clientWidth - padding);
    const availableHeight = Math.max(1, stage.clientHeight - padding);
    const fitZoom = Math.min(availableWidth / image.naturalWidth, availableHeight / image.naturalHeight, 1);
    resetView(Number(fitZoom.toFixed(3)));
  }

  function zoomBy(delta: number) {
    setZoom((value) => Math.max(0.2, Math.min(4, Number((value + delta).toFixed(2)))));
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    if (!event.metaKey) return;

    event.preventDefault();
    zoomBy(event.deltaY < 0 ? 0.12 : -0.12);
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: pan.x,
      originY: pan.y,
    };
    setIsDragging(true);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    setPan({
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    });
  }

  function handlePointerEnd(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    dragRef.current = null;
    setIsDragging(false);
  }

  return (
    <div className="imageLightbox" role="dialog" aria-modal="true" aria-label={`${active.name} 预览`} onClick={onClose}>
      <div className="imageLightboxInner" onClick={(event) => event.stopPropagation()}>
        <div className="imageLightboxHeader">
          <div>
            <strong>{active.name}</strong>
            <span>{active.kind} · {activeIndex + 1}/{preview.items.length}</span>
          </div>
          <div className="imageLightboxActions">
            <button type="button" className="secondaryButton" onClick={() => zoomBy(-0.2)}>
              -
            </button>
            <span className="zoomValue">{Math.round(zoom * 100)}%</span>
            <button type="button" className="secondaryButton" onClick={() => zoomBy(0.2)}>
              +
            </button>
            <button type="button" className="secondaryButton" onClick={() => resetView(1)}>
              100%
            </button>
            <button type="button" className="secondaryButton" onClick={fitToStage}>
              适应
            </button>
            <button type="button" className="secondaryButton" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>
        <div className="imageLightboxBody">
          <div className="imageLightboxRail">
            {preview.items.map((item, index) => (
              <button
                key={item.key}
                type="button"
                className={index === activeIndex ? 'active' : ''}
                title={item.name}
                onClick={() => selectImage(index)}
              >
                <img src={item.url} alt={`${item.name} 缩略图`} />
                <span>{item.kind}</span>
              </button>
            ))}
          </div>
          <div
            ref={stageRef}
            className={`imageLightboxStage ${isDragging ? 'dragging' : ''}`}
            onWheel={handleWheel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
          >
            <img
              ref={imageRef}
              src={active.url}
              alt={`${active.name} 预览`}
              draggable={false}
              onLoad={fitToStage}
              style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
            />
          </div>
        </div>
      </div>
    </div>
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

function Detail({
  row,
  system,
  mapFile,
  onSaved,
  onPreview,
}: {
  row: MapRow;
  system: MapSystem;
  mapFile: string;
  onSaved: (data: MapViewData) => void;
  onPreview: (items: ImagePreviewItem[], activeIndex?: number) => void;
}) {
  const [draftStatus, setDraftStatus] = useState<MappingStatus>(row.status);
  const [draftLibrary, setDraftLibrary] = useState<TargetLibrary>(toEditableLibrary(row.targetLibrary));
  const [draftComponent, setDraftComponent] = useState(row.targetComponent === '-' ? '' : row.targetComponent);
  const [draftProps, setDraftProps] = useState<Record<string, string>>(row.targetProps);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    setDraftStatus(row.status);
    setDraftLibrary(toEditableLibrary(row.targetLibrary));
    setDraftComponent(row.targetComponent === '-' ? '' : row.targetComponent);
    setDraftProps(row.targetProps);
    setSaveState('idle');
    setError('');
  }, [row.rowId]);

  const originalLibrary = toEditableLibrary(row.targetLibrary);
  const originalComponent = row.targetComponent === '-' ? '' : row.targetComponent;
  const isDirty = draftStatus !== row.status || draftLibrary !== originalLibrary || draftComponent.trim() !== originalComponent || JSON.stringify(draftProps) !== JSON.stringify(row.targetProps);
  const canSave = saveState !== 'saving' && isDirty && (draftStatus === 'unresolved' || draftStatus === 'internal' || draftComponent.trim().length > 0);

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
        system,
        kind: row.kind,
        key: row.key,
        status: draftStatus,
        target:
          draftStatus === 'mapped'
            ? {
                library: draftLibrary,
                component: draftComponent.trim(),
                props: draftProps,
              }
            : null,
      }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? '保存失败。');
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
        <button type="button" className="iconButton" title="复制稳定 key" aria-label="复制稳定 key" onClick={() => copyText(row.key)}>
          <Copy size={16} aria-hidden="true" />
        </button>
      </div>

      <PreviewPanel row={row} onOpen={() => onPreview(getRowPreviewItems(row), 0)} />

      <dl className="kv">
        <div>
          <dt>类型</dt>
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
          <dt>稳定 Key</dt>
          <dd>
            <code>{row.key}</code>
          </dd>
        </div>
        <div>
          <dt>目标</dt>
          <dd>
            {row.targetLibrary} / {row.targetComponent}
            {Object.entries(row.targetProps).length > 0 && (
              <code className="targetProps">
                {Object.entries(row.targetProps).map(([k, v]) => `${k}="${v}"`).join(' ')}
              </code>
            )}
          </dd>
        </div>
        <div>
          <dt>Variants</dt>
          <dd>{row.variantCount}</dd>
        </div>
      </dl>

      <section className="editorPanel">
        <h3>编辑映射</h3>
        <div className="editForm">
          <label>
            状态
            <select value={draftStatus} onChange={(event) => setDraftStatus(event.target.value as MappingStatus)}>
              <option value="mapped">已映射</option>
              <option value="internal">内部组件</option>
              <option value="unresolved">未映射</option>
            </select>
          </label>
          <label>
            分类
            <select
              value={draftLibrary}
              disabled={draftStatus === 'unresolved' || draftStatus === 'internal'}
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
            目标组件
            <input
              value={draftComponent}
              disabled={draftStatus === 'unresolved' || draftStatus === 'internal'}
              placeholder="el-button / TiTable"
              onChange={(event) => setDraftComponent(event.target.value)}
            />
          </label>
          <PropsEditor value={draftProps} onChange={setDraftProps} disabled={draftStatus === 'unresolved' || draftStatus === 'internal'} />
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
              重置
            </button>
            <button type="button" className="primaryButton" disabled={!canSave} onClick={saveMapping}>
              {saveState === 'saving' ? '保存中' : '保存'}
            </button>
          </div>
          {saveState === 'saved' ? <p className="saveMessage">已保存到 mappings/{mapFile}。</p> : null}
          {error ? <p className="errorMessage">{error}</p> : null}
        </div>
      </section>

      {row.variants.length > 0 ? (
        <section>
          <h3>Variants</h3>
          <div className="variantList">
            {row.variants.map((variant) => (
              <VariantEditor key={variant.key} parent={row} variant={variant} system={system} onSaved={onSaved} onPreview={onPreview} />
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <h3>原因</h3>
        <p>{row.reason}</p>
      </section>

      <section>
        <h3>依据</h3>
        {row.evidence.length > 0 ? (
          <ul>
            {row.evidence.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p>未记录显式依据。</p>
        )}
      </section>

      <section>
        <h3>原始数据</h3>
        <pre>{JSON.stringify(row.raw, null, 2)}</pre>
      </section>
    </div>
  );
}

function PreviewPanel({ row, onOpen }: { row: MapRow; onOpen: () => void }) {
  return (
    <div className="previewPanel">
      {row.previewUrl ? (
        <button type="button" className="previewPanelButton" onClick={onOpen}>
          <img src={row.previewUrl} alt={`${row.name} 设计预览`} />
        </button>
      ) : (
        <div className="previewPlaceholder">未导出预览</div>
      )}
    </div>
  );
}

function formatVariantProperties(variant: MapVariant) {
  const entries = Object.entries(variant.variantProperties);
  if (entries.length === 0) return '-';
  return entries.map(([key, value]) => `${key}=${value}`).join(', ');
}

function VariantEditor({
  parent,
  variant,
  system,
  onSaved,
  onPreview,
}: {
  parent: MapRow;
  variant: MapVariant;
  system: MapSystem;
  onSaved: (data: MapViewData) => void;
  onPreview: (items: ImagePreviewItem[], activeIndex?: number) => void;
}) {
  const [mode, setMode] = useState<VariantMode>(variant.mode);
  const [library, setLibrary] = useState<TargetLibrary>(toEditableLibrary(variant.targetLibrary));
  const [component, setComponent] = useState(variant.targetComponent === '-' ? '' : variant.targetComponent);
  const [draftProps, setDraftProps] = useState<Record<string, string>>(variant.targetProps);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    setMode(variant.mode);
    setLibrary(toEditableLibrary(variant.targetLibrary));
    setComponent(variant.targetComponent === '-' ? '' : variant.targetComponent);
    setDraftProps(variant.targetProps);
    setSaveState('idle');
    setError('');
    setIsEditing(false);
  }, [variant.key, variant.mode, variant.targetLibrary, variant.targetComponent, variant.targetProps]);

  const originalLibrary = toEditableLibrary(variant.targetLibrary);
  const originalComponent = variant.targetComponent === '-' ? '' : variant.targetComponent;
  const isDirty = mode !== variant.mode || library !== originalLibrary || component.trim() !== originalComponent || JSON.stringify(draftProps) !== JSON.stringify(variant.targetProps);
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
        system,
        componentSetKey: parent.key,
        variantKey: variant.key,
        mode,
        target:
          mode === 'override'
            ? {
                library,
                component: component.trim(),
                props: draftProps,
              }
            : null,
      }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? '保存失败。');
      setSaveState('error');
      return;
    }

    const nextData = (await response.json()) as MapViewData;
    onSaved(nextData);
    setComponent(mode === 'override' ? component.trim() : '');
    setSaveState('saved');
    setIsEditing(false);
  }

  return (
    <div className="variantItem">
      {variant.previewUrl ? (
        <button
          type="button"
          className="variantPreview"
          onClick={() => {
            const items = getRowPreviewItems(parent);
            const activeIndex = Math.max(0, items.findIndex((item) => item.key === variant.key));
            onPreview(items, activeIndex);
          }}
        >
          <img src={variant.previewUrl} alt={`${variant.name} preview`} loading="lazy" />
        </button>
      ) : null}
      <div className="variantHeader">
        <div>
          <strong>{variant.name}</strong>
          <p>{formatVariantProperties(variant)}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          <span
            className={`statusPill ${variant.mode === 'unresolved' ? 'statusUnresolved' : variant.mode === 'internal' ? 'statusInternal' : 'statusMapped'}`}
            style={{ whiteSpace: 'nowrap' }}
          >
            {variantModeLabels[variant.mode]}
          </span>
          <button
            type="button"
            className="secondaryButton"
            style={{ height: '24px', padding: '0 8px', fontSize: '12px', whiteSpace: 'nowrap', flexShrink: 0 }}
            onClick={() => setIsEditing(!isEditing)}
          >
            {isEditing ? '取消' : '编辑'}
          </button>
        </div>
      </div>
      <div className="variantTarget">
        <span>{variant.targetLibrary}</span>
        <span>{variant.targetComponent}</span>
        {Object.entries(variant.targetProps).length > 0 && (
          <code className="targetProps">
            {Object.entries(variant.targetProps).map(([k, v]) => `${k}="${v}"`).join(' ')}
          </code>
        )}
      </div>
      {isEditing && (
        <div className="variantEditGrid">
          <label>
            模式
            <select value={mode} onChange={(event) => setMode(event.target.value as VariantMode)}>
              {Object.entries(variantModeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            分类
            <select disabled={fieldsDisabled} value={library} onChange={(event) => setLibrary(event.target.value as TargetLibrary)}>
              {targetLibraries.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label>
            目标
            <input disabled={fieldsDisabled} value={component} placeholder="el-button / TiTable" onChange={(event) => setComponent(event.target.value)} />
          </label>
          <PropsEditor value={draftProps} onChange={setDraftProps} disabled={fieldsDisabled} />
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
              重置
            </button>
            <button type="button" className="primaryButton" disabled={!canSave} onClick={saveVariant}>
              {saveState === 'saving' ? '保存中' : '保存'}
            </button>
          </div>
        </div>
      )}
      {variant.reason !== '-' ? <p className="variantReason">{variant.reason}</p> : null}
      {saveState === 'saved' ? <p className="saveMessage">Variant 已保存。</p> : null}
      {error ? <p className="errorMessage">{error}</p> : null}
    </div>
  );
}

import type { MapRow, MapVariant, MapSystem } from '@/lib/map-data';
import { getMapSystemMeta } from '@/lib/map-data';

function pillClass(status: string): string {
  if (status === 'mapped' || status === 'mapped-override' || status === 'mapped-via-component-set') return 'statusMapped';
  if (status === 'internal') return 'statusInternal';
  return 'statusUnresolved';
}

type DetailProps = {
  row: MapRow;
  system: MapSystem;
};

type RawEntry = {
  figma?: Record<string, unknown>;
  status?: string;
  target?: { library?: string; component?: string; props?: Record<string, string> } | null;
  reason?: string | null;
  evidence?: string[];
  components?: Record<string, unknown>;
  variantToPropsStatus?: string;
  variantToPropsReason?: string;
};

type MappedSchema = { library: string; component: string; props: Record<string, string> } | null;

function buildMappedSchema(raw: unknown): MappedSchema {
  const target = (raw as RawEntry | undefined)?.target;
  if (!target || !target.library || !target.component) return null;
  return {
    library: target.library,
    component: target.component,
    props: target.props ?? {},
  };
}

function buildVariantMappedSchema(variant: MapVariant): MappedSchema {
  if (!variant.targetLibrary || !variant.targetComponent || variant.targetComponent === '-') return null;
  return {
    library: variant.targetLibrary,
    component: variant.targetComponent,
    props: variant.targetProps ?? {},
  };
}

function jsonString(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function ComponentMapDetail({ row, system }: DetailProps) {
  const meta = getMapSystemMeta(system);
  const entry = (row.raw as RawEntry) ?? {};
  const figmaJson = jsonString(entry.figma ?? {});
  const mappedJson = jsonString(buildMappedSchema(row.raw));

  return (
    <div className="detailPage">
      <header className="detailHeader">
        <a className="detailBackLink" href={`/?system=${system}`}>
          ← 返回列表
        </a>
        <div className="detailTitleRow">
          <h1 className="detailTitle">{row.name}</h1>
          <span className={`statusPill ${pillClass(row.status)}`}>{row.status}</span>
        </div>
        <p className="detailSubtitle">
          <span className="detailMetaLabel">{meta.label}</span>
          <span className="detailMetaItem">kind: {row.kind}</span>
          <span className="detailMetaItem">key: <code>{row.key}</code></span>
          <span className="detailMetaItem">id: <code>{row.figmaId}</code></span>
        </p>
      </header>

      <section className="detailCompareSection">
        <div className="detailCompareCol detailCompareColJson">
          <h2 className="detailColumnTitle">原始 Figma JSON</h2>
          <p className="detailColumnHint">来自 Figma 导出，未经任何映射处理。</p>
          <pre className="detailJsonPre">{figmaJson}</pre>
        </div>
        <div className="detailCompareCol detailCompareColJson">
          <h2 className="detailColumnTitle">映射后 Component Schema</h2>
          <p className="detailColumnHint">由 Component Map 配置生成，下游 MCP 直接消费此结构。</p>
          <pre className="detailJsonPre detailJsonPreMapped">{mappedJson}</pre>
        </div>
      </section>

      {row.variants.length > 0 ? (
        <section className="detailVariantsSection">
          <h2 className="detailSectionTitle">Variants ({row.variants.length})</h2>
          <p className="detailSectionHint">每个 Variant 的原始 Figma 数据与映射结果对照。</p>
          <div className="detailVariantList">
            {row.variants.map((variant) => {
              const variantRaw = (entry.components as Record<string, RawEntry> | undefined)?.[variant.key];
              const variantFigmaJson = jsonString(variantRaw?.figma ?? variant.variantProperties ?? {});
              const variantMappedJson = jsonString(buildVariantMappedSchema(variant));
              return (
                <VariantDetailCard
                  key={variant.key}
                  variant={variant}
                  figmaJson={variantFigmaJson}
                  mappedJson={variantMappedJson}
                />
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function VariantDetailCard({
  variant,
  figmaJson,
  mappedJson,
}: {
  variant: MapVariant;
  figmaJson: string;
  mappedJson: string;
}) {
  return (
    <div className="detailVariantCard">
      <div className="detailVariantHeader">
        <h3 className="detailVariantName">{variant.name}</h3>
        <span className={`statusPill ${pillClass(variant.status)}`}>{variant.status}</span>
        <span className="detailVariantMode">mode: {variant.mode}</span>
      </div>
      <div className="detailVariantBody">
        <div className="detailCompareCol detailCompareColJson">
          <h4 className="detailColumnSubtitle">原始 Figma JSON</h4>
          <pre className="detailJsonPre">{figmaJson}</pre>
        </div>
        <div className="detailCompareCol detailCompareColJson">
          <h4 className="detailColumnSubtitle">映射后 Schema</h4>
          <pre className="detailJsonPre detailJsonPreMapped">{mappedJson}</pre>
        </div>
      </div>
    </div>
  );
}

figma.showUI(__html__, {
  width: 520,
  height: 640,
  themeColors: true,
})

const SCHEMA_REGISTRY = 'figma-component-registry/v1'
const SCHEMA_DESIGN_SPEC = 'figma-component-design-spec/v1'
const DESIGN_SPEC_NODE_TREE_MAX_DEPTH = 5
const variableCache = new Map()

figma.ui.onmessage = async (message) => {
  try {
    if (!message || typeof message.type !== 'string') {
      return
    }

    if (message.type === 'CLOSE') {
      figma.closePlugin()
      return
    }

    if (message.type === 'EXPORT_REGISTRY') {
      await runExport(message.options)
      return
    }
  } catch (error) {
    figma.ui.postMessage({
      type: 'ERROR',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

sendReady()

function sendReady() {
  figma.ui.postMessage({
    type: 'READY',
    payload: {
      fileName: figma.root.name,
      currentPage: figma.currentPage.name,
      selectionCount: figma.currentPage.selection.length,
      pages: figma.root.children.map((page) => ({
        id: page.id,
        name: page.name,
        current: page.id === figma.currentPage.id,
      })),
    },
  })
}

async function runExport(rawOptions) {
  const options = normalizeOptions(rawOptions)
  const roots = await getScanRoots(options)

  if (roots.length === 0) {
    throw new Error('没有可扫描的页面。请至少勾选一个页面。')
  }

  const isDesignSpec = options.exportType === 'design-spec'
  postProgress({
    value: 0,
    total: roots.length,
    label: isDesignSpec ? '开始导出组件设计规格' : '开始导出组件注册表',
  })
  const payload = await exportComponentData(roots, options)
  postProgress({
    value: roots.length,
    total: roots.length,
    label: '导出完成',
  })
  postResult(
    payload,
    buildFileName(isDesignSpec ? 'figma-component-design-spec' : 'figma-component-registry')
  )
}

function normalizeOptions(rawOptions) {
  const options = rawOptions && typeof rawOptions === 'object' ? rawOptions : {}
  const pageIds = Array.isArray(options.pageIds)
    ? options.pageIds.filter((id) => typeof id === 'string' && id)
    : []

  return {
    scope: 'selected-pages',
    pageIds,
    exportType: options.exportType === 'design-spec' ? 'design-spec' : 'registry',
  }
}

async function getScanRoots(options) {
  const pages = figma.root.children.filter((page) => options.pageIds.includes(page.id) && !isPageSeparator(page.name))

  if (pages.length === 0) {
    throw new Error('请选择至少一个页面。')
  }

  const loadedPages = []
  for (let index = 0; index < pages.length; index++) {
    const page = pages[index]
    postProgress({
      value: index,
      total: pages.length,
      label: `加载页面 ${index + 1}/${pages.length}: ${page.name}`,
    })
    await loadPage(page)
    loadedPages.push(page)
    postProgress({
      value: index + 1,
      total: pages.length,
      label: `已加载页面 ${index + 1}/${pages.length}: ${page.name}`,
    })
  }
  return loadedPages
}

function isPageSeparator(name) {
  return !String(name || '').trim().startsWith('↳')
}

async function loadPage(page) {
  if (page && typeof page.loadAsync === 'function') {
    await page.loadAsync()
  }
}

async function exportComponentData(roots, options) {
  const serializedSets = []
  const serializedLooseComponents = []
  const totalRoots = Math.max(roots.length, 1)
  const isDesignSpec = options.exportType === 'design-spec'

  for (let rootIndex = 0; rootIndex < roots.length; rootIndex++) {
    const root = roots[rootIndex]
    const label = root.type === 'PAGE'
      ? root.name
      : `${getPageName(root) || figma.currentPage.name} / ${root.name}`
    postProgress({
      value: rootIndex,
      total: totalRoots,
      label: `扫描 ${rootIndex + 1}/${totalRoots}: ${label}`,
    })

    const componentSets = uniqueNodes(findNodesByTypes([root], ['COMPONENT_SET']))
    const looseComponents = uniqueNodes(findNodesByTypes([root], ['COMPONENT']))
      .filter((node) => !node.parent || node.parent.type !== 'COMPONENT_SET')

    for (let index = 0; index < componentSets.length; index++) {
      serializedSets.push(
        isDesignSpec
          ? await serializeDesignSpecComponentSet(componentSets[index])
          : await serializeRegistryComponentSet(componentSets[index])
      )
    }

    for (let index = 0; index < looseComponents.length; index++) {
      serializedLooseComponents.push(
        isDesignSpec
          ? await serializeDesignSpecComponent(looseComponents[index])
          : await serializeRegistryComponent(looseComponents[index])
      )
    }

    postProgress({
      value: rootIndex + 1,
      total: totalRoots,
      label: `完成 ${rootIndex + 1}/${totalRoots}: ${label}，组件集 ${componentSets.length}，独立组件 ${looseComponents.length}`,
      detail: {
        currentPage: label,
        pageComponentSetCount: componentSets.length,
        pageLooseComponentCount: looseComponents.length,
        totalComponentSetCount: serializedSets.length,
        totalLooseComponentCount: serializedLooseComponents.length,
      },
    })
  }

  const componentSetByKey = {}
  const componentByKey = {}
  for (const set of serializedSets) {
    if (set.key) {
      componentSetByKey[set.key] = {
        id: set.id,
        name: set.name,
        componentKeys: set.components.map((component) => component.key).filter(Boolean),
      }
    }
    for (const component of set.components) {
      if (component.key) {
        componentByKey[component.key] = {
          id: component.id,
          name: component.name,
          componentSetKey: set.key,
          componentSetName: set.name,
          variantProperties: component.variantProperties || component.variantPropertiesFromName || {},
        }
      }
    }
  }

  for (const component of serializedLooseComponents) {
    if (component.key) {
      componentByKey[component.key] = {
        id: component.id,
        name: component.name,
        componentSetKey: null,
        componentSetName: null,
        variantProperties: component.variantProperties || component.variantPropertiesFromName || {},
      }
    }
  }

  return {
    schemaVersion: isDesignSpec ? SCHEMA_DESIGN_SPEC : SCHEMA_REGISTRY,
    source: createSourceMeta(options.scope),
    exportedAt: new Date().toISOString(),
    stats: {
      componentSetCount: serializedSets.length,
      looseComponentCount: serializedLooseComponents.length,
      componentCount: serializedSets.reduce((sum, set) => sum + set.components.length, 0)
        + serializedLooseComponents.length,
    },
    componentSets: serializedSets,
    looseComponents: serializedLooseComponents,
    indexes: {
      componentSetByKey,
      componentByKey,
    },
  }
}

async function serializeRegistryComponentSet(node) {
  const components = node.children.filter((child) => child.type === 'COMPONENT')
  const serializedComponents = []

  for (const component of components) {
    serializedComponents.push(await serializeRegistryComponent(component, node))
  }

  return compactObject({
    id: node.id,
    key: node.key,
    name: node.name,
    type: node.type,
    description: node.description || undefined,
    page: getPageName(node),
    path: getNodePath(node),
    componentPropertyDefinitions: normalizeComponentPropertyDefinitions(getComponentPropertyDefinitions(node)),
    components: serializedComponents,
  })
}

async function serializeRegistryComponent(node, parentSet) {
  const variantPropertiesResult = getVariantProperties(node)
  return compactObject({
    id: node.id,
    key: node.key,
    name: node.name,
    type: node.type,
    description: node.description || undefined,
    page: getPageName(node),
    path: getNodePath(node),
    componentSetId: parentSet ? parentSet.id : (node.parent && node.parent.type === 'COMPONENT_SET' ? node.parent.id : undefined),
    componentSetKey: parentSet ? parentSet.key : (node.parent && node.parent.type === 'COMPONENT_SET' ? node.parent.key : undefined),
    componentSetName: parentSet ? parentSet.name : (node.parent && node.parent.type === 'COMPONENT_SET' ? node.parent.name : undefined),
    variantProperties: normalizeRecord(variantPropertiesResult.value),
    variantPropertiesFromName: parseVariantName(node.name),
    warnings: variantPropertiesResult.warning ? [variantPropertiesResult.warning] : undefined,
    componentPropertyDefinitions: normalizeComponentPropertyDefinitions(getComponentPropertyDefinitions(node)),
  })
}

async function serializeDesignSpecComponentSet(node) {
  const components = node.children.filter((child) => child.type === 'COMPONENT')
  const serializedComponents = []

  for (const component of components) {
    serializedComponents.push(await serializeDesignSpecComponent(component, node))
  }

  return compactObject({
    id: node.id,
    key: node.key,
    name: node.name,
    type: node.type,
    description: node.description || undefined,
    page: getPageName(node),
    path: getNodePath(node),
    componentPropertyDefinitions: normalizeComponentPropertyDefinitions(getComponentPropertyDefinitions(node)),
    design: await serializeDesignNode(node, 0),
    components: serializedComponents,
  })
}

async function serializeDesignSpecComponent(node, parentSet) {
  const variantPropertiesResult = getVariantProperties(node)
  return compactObject({
    id: node.id,
    key: node.key,
    name: node.name,
    type: node.type,
    description: node.description || undefined,
    page: getPageName(node),
    path: getNodePath(node),
    componentSetId: parentSet ? parentSet.id : (node.parent && node.parent.type === 'COMPONENT_SET' ? node.parent.id : undefined),
    componentSetKey: parentSet ? parentSet.key : (node.parent && node.parent.type === 'COMPONENT_SET' ? node.parent.key : undefined),
    componentSetName: parentSet ? parentSet.name : (node.parent && node.parent.type === 'COMPONENT_SET' ? node.parent.name : undefined),
    variantProperties: normalizeRecord(variantPropertiesResult.value),
    variantPropertiesFromName: parseVariantName(node.name),
    warnings: variantPropertiesResult.warning ? [variantPropertiesResult.warning] : undefined,
    componentPropertyDefinitions: normalizeComponentPropertyDefinitions(getComponentPropertyDefinitions(node)),
    design: await serializeDesignNode(node, 0),
  })
}

async function serializeDesignNode(node, depth) {
  const result = compactObject({
    id: node.id,
    type: node.type,
    name: node.name,
    key: node.type === 'COMPONENT' || node.type === 'COMPONENT_SET' ? node.key : undefined,
    visible: node.visible === false ? false : undefined,
    locked: node.locked === true ? true : undefined,
    componentId: node.componentId,
    componentProperties: normalizeComponentProperties(getComponentProperties(node).value),
    componentPropertyReferences: normalizeRecord(node.componentPropertyReferences),
    variantProperties: normalizeRecord(getVariantProperties(node).value),
    text: node.type === 'TEXT' ? node.characters : undefined,
    size: getSize(node),
    layout: getLayout(node),
    sizing: getSizing(node),
    fills: normalizePaints(node.fills),
    strokes: normalizePaints(node.strokes),
    strokeWeight: typeof node.strokeWeight === 'number' ? node.strokeWeight : undefined,
    effects: normalizeEffects(node.effects),
    boundVariables: await normalizeBoundVariables(node.boundVariables),
  })

  if (
    depth >= DESIGN_SPEC_NODE_TREE_MAX_DEPTH
    || !('children' in node)
    || !node.children
    || !node.children.length
  ) {
    if ('children' in node && node.children && node.children.length && depth >= DESIGN_SPEC_NODE_TREE_MAX_DEPTH) {
      result.childrenTruncated = node.children.length
    }
    return result
  }

  result.children = []
  for (const child of node.children) {
    result.children.push(await serializeDesignNode(child, depth + 1))
  }
  return result
}

function findNodesByTypes(roots, types) {
  const typeSet = new Set(types)
  const result = []

  for (const root of roots) {
    if (!root) continue
    if (typeSet.has(root.type)) {
      result.push(root)
    }

    if (typeof root.findAllWithCriteria === 'function') {
      result.push(...root.findAllWithCriteria({ types }))
    } else if (typeof root.findAll === 'function') {
      result.push(...root.findAll((node) => typeSet.has(node.type)))
    }
  }

  return result
}

function uniqueNodes(nodes) {
  const byId = new Map()
  for (const node of nodes) {
    byId.set(node.id, node)
  }
  return [...byId.values()]
}

function normalizeComponentPropertyDefinitions(definitions) {
  if (!definitions || typeof definitions !== 'object') return undefined
  const result = {}

  for (const [name, definition] of Object.entries(definitions)) {
    result[name] = compactObject({
      type: definition.type,
      defaultValue: definition.defaultValue,
      preferredValues: definition.preferredValues,
      variantOptions: definition.variantOptions,
    })
  }

  return Object.keys(result).length ? result : undefined
}

function getComponentPropertyDefinitions(node) {
  if (!node || (node.type !== 'COMPONENT_SET' && node.type !== 'COMPONENT')) {
    return undefined
  }

  if (node.type === 'COMPONENT' && node.parent && node.parent.type === 'COMPONENT_SET') {
    return undefined
  }

  try {
    return node.componentPropertyDefinitions
  } catch (error) {
    return undefined
  }
}

function normalizeComponentProperties(properties) {
  if (!properties || typeof properties !== 'object') return undefined
  const result = {}

  for (const [name, property] of Object.entries(properties)) {
    result[name] = compactObject({
      type: property.type,
      value: property.value,
      preferredValues: property.preferredValues,
      boundVariables: property.boundVariables,
    })
  }

  return Object.keys(result).length ? result : undefined
}

function getComponentProperties(node) {
  if (!node || !('componentProperties' in node)) {
    return { value: undefined }
  }

  try {
    return { value: node.componentProperties }
  } catch (error) {
    return {
      value: undefined,
      warning: {
        code: 'componentProperties_unreadable',
        nodeId: node.id,
        nodeName: node.name,
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

function getVariantProperties(node) {
  if (!node || !('variantProperties' in node)) {
    return { value: undefined }
  }

  try {
    return { value: node.variantProperties }
  } catch (error) {
    return {
      value: undefined,
      warning: {
        code: 'variantProperties_unreadable',
        nodeId: node.id,
        nodeName: node.name,
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

function parseVariantName(name) {
  if (!name || !name.includes('=')) return undefined
  const result = {}
  for (const part of name.split(',')) {
    const [rawKey, ...rawValueParts] = part.split('=')
    const key = rawKey ? rawKey.trim() : ''
    const value = rawValueParts.join('=').trim()
    if (key && value) result[key] = value
  }
  return Object.keys(result).length ? result : undefined
}

function normalizeRecord(value) {
  if (!value || typeof value !== 'object') return undefined
  const result = {}
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined && typeof item !== 'function') {
      result[key] = item
    }
  }
  return Object.keys(result).length ? result : undefined
}

async function normalizeBoundVariables(value) {
  if (!value || typeof value !== 'object') return undefined

  if (Array.isArray(value)) {
    const list = []
    for (const item of value) {
      list.push(await normalizeBoundVariables(item))
    }
    return list.filter((item) => item !== undefined)
  }

  if (value.type === 'VARIABLE_ALIAS' && typeof value.id === 'string') {
    return await resolveVariableAlias(value.id)
  }

  const result = {}
  for (const [key, item] of Object.entries(value)) {
    const normalized = await normalizeBoundVariables(item)
    if (normalized !== undefined) {
      result[key] = normalized
    }
  }
  return Object.keys(result).length ? result : undefined
}

async function resolveVariableAlias(id) {
  if (variableCache.has(id)) {
    return variableCache.get(id)
  }

  const fallback = {
    type: 'VARIABLE_ALIAS',
    id,
  }

  let resolved = fallback
  try {
    const variables = figma.variables
    const variable = variables && variables.getVariableByIdAsync
      ? await variables.getVariableByIdAsync(id)
      : variables && variables.getVariableById
        ? variables.getVariableById(id)
        : null

    if (variable) {
      resolved = compactObject({
        type: 'VARIABLE_ALIAS',
        id,
        key: variable.key,
        name: variable.name,
        resolvedType: variable.resolvedType,
        variableCollectionId: variable.variableCollectionId,
        remote: variable.remote === true ? true : undefined,
      })
    }
  } catch (error) {
    resolved = fallback
  }

  variableCache.set(id, resolved)
  return resolved
}

function getSize(node) {
  if (typeof node.width !== 'number' || typeof node.height !== 'number') {
    return undefined
  }
  return {
    width: round(node.width),
    height: round(node.height),
  }
}

function getLayout(node) {
  if (!('layoutMode' in node) || !node.layoutMode || node.layoutMode === 'NONE') {
    return undefined
  }

  return compactObject({
    mode: node.layoutMode,
    wrap: node.layoutWrap,
    primaryAxisAlignItems: node.primaryAxisAlignItems,
    counterAxisAlignItems: node.counterAxisAlignItems,
    primaryAxisSizingMode: node.primaryAxisSizingMode,
    counterAxisSizingMode: node.counterAxisSizingMode,
    itemSpacing: typeof node.itemSpacing === 'number' ? round(node.itemSpacing) : undefined,
    padding: compactObject({
      top: typeof node.paddingTop === 'number' ? round(node.paddingTop) : undefined,
      right: typeof node.paddingRight === 'number' ? round(node.paddingRight) : undefined,
      bottom: typeof node.paddingBottom === 'number' ? round(node.paddingBottom) : undefined,
      left: typeof node.paddingLeft === 'number' ? round(node.paddingLeft) : undefined,
    }),
  })
}

function getSizing(node) {
  const sizing = compactObject({
    horizontal: node.layoutSizingHorizontal,
    vertical: node.layoutSizingVertical,
    align: node.layoutAlign,
    grow: node.layoutGrow,
    positioning: node.layoutPositioning,
  })
  return Object.keys(sizing).length ? sizing : undefined
}

function normalizePaints(paints) {
  if (!Array.isArray(paints)) return undefined
  const result = paints
    .filter((paint) => paint && paint.visible !== false)
    .map((paint) => compactObject({
      type: paint.type,
      blendMode: paint.blendMode,
      opacity: paint.opacity,
      color: normalizeColor(paint.color),
      gradientStops: Array.isArray(paint.gradientStops)
        ? paint.gradientStops.map((stop) => compactObject({
          position: stop.position,
          color: normalizeColor(stop.color),
        }))
        : undefined,
    }))
  return result.length ? result : undefined
}

function normalizeEffects(effects) {
  if (!Array.isArray(effects)) return undefined
  const result = effects
    .filter((effect) => effect && effect.visible !== false)
    .map((effect) => compactObject({
      type: effect.type,
      blendMode: effect.blendMode,
      radius: effect.radius,
      offset: effect.offset,
      spread: effect.spread,
      color: normalizeColor(effect.color),
    }))
  return result.length ? result : undefined
}

function normalizeColor(color) {
  if (!color || typeof color !== 'object') return undefined
  return compactObject({
    r: typeof color.r === 'number' ? Math.round(color.r * 255) : undefined,
    g: typeof color.g === 'number' ? Math.round(color.g * 255) : undefined,
    b: typeof color.b === 'number' ? Math.round(color.b * 255) : undefined,
    a: typeof color.a === 'number' ? round(color.a) : 1,
  })
}

function getPageName(node) {
  let current = node
  while (current && current.type !== 'PAGE') {
    current = current.parent
  }
  return current ? current.name : undefined
}

function getNodePath(node) {
  const segments = []
  let current = node
  while (current && current.type !== 'DOCUMENT') {
    segments.unshift(current.name)
    current = current.parent
  }
  return segments.join(' / ')
}

function createSourceMeta(scope) {
  return {
    fileName: figma.root.name,
    currentPage: figma.currentPage.name,
    scope,
  }
}

function buildFileName(prefix) {
  const safeName = figma.root.name
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'figma-file'
  return `${prefix}-${safeName}.json`
}

function postStatus(message) {
  figma.ui.postMessage({
    type: 'STATUS',
    message,
  })
}

function postProgress(progress) {
  figma.ui.postMessage({
    type: 'PROGRESS',
    progress,
  })
  if (progress && progress.label) {
    postStatus(progress.label)
  }
}

function postResult(payload, fileName) {
  figma.ui.postMessage({
    type: 'RESULT',
    fileName,
    payload,
    summary: summarizePayload(payload),
  })
}

function summarizePayload(payload) {
  return payload && payload.stats ? payload.stats : {}
}

function compactObject(object) {
  if (!object || typeof object !== 'object') return object
  const result = {}
  for (const [key, value] of Object.entries(object)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value) && value.length === 0) continue
    if (
      typeof value === 'object'
      && !Array.isArray(value)
      && Object.keys(value).length === 0
    ) {
      continue
    }
    result[key] = value
  }
  return result
}

function round(value) {
  return Math.round(value * 1000) / 1000
}

figma.showUI(__html__, { width: 920, height: 720 });

const TARGET_COLLECTIONS = new Set(['Primitive', 'Semantic', 'Component']);

const normalizeColor = (value) => {
  if (!value || typeof value !== 'object') {
    return value;
  }

  if (
    typeof value.r === 'number' &&
    typeof value.g === 'number' &&
    typeof value.b === 'number'
  ) {
    return {
      r: value.r,
      g: value.g,
      b: value.b,
      a: typeof value.a === 'number' ? value.a : 1,
    };
  }

  return value;
};

const serializeVariableValue = (value) => {
  if (value && typeof value === 'object' && value.type === 'VARIABLE_ALIAS') {
    return {
      type: 'VARIABLE_ALIAS',
      id: value.id,
    };
  }

  return normalizeColor(value);
};

const getDefaultModeId = (collection, variable) =>
  (collection && collection.defaultModeId) ||
  (collection && collection.modes && collection.modes[0] && collection.modes[0].modeId) ||
  Object.keys(variable.valuesByMode || {})[0];

const resolveVariableValue = (variable, modeId, maps, seen = new Set()) => {
  if (!variable || seen.has(variable.id)) {
    return {};
  }

  seen.add(variable.id);
  const collection = maps.collectionById.get(variable.variableCollectionId);
  const valuesByMode = variable.valuesByMode || {};
  const fallbackModeId = getDefaultModeId(collection, variable);
  const value = Object.prototype.hasOwnProperty.call(valuesByMode, modeId)
    ? valuesByMode[modeId]
    : valuesByMode[fallbackModeId];

  if (value && typeof value === 'object' && value.type === 'VARIABLE_ALIAS') {
    const aliasVariable = maps.variableById.get(value.id);
    const aliasCollection = aliasVariable
      ? maps.collectionById.get(aliasVariable.variableCollectionId)
      : undefined;
    const aliasModeId = aliasVariable
      ? getDefaultModeId(aliasCollection, aliasVariable)
      : undefined;
    const nested = resolveVariableValue(aliasVariable, aliasModeId, maps, seen);

    return {
      resolvedValue: nested.resolvedValue,
      alias: value.id,
      aliasName: aliasVariable && aliasVariable.name,
    };
  }

  return {
    resolvedValue: serializeVariableValue(value),
    alias: null,
  };
};

const serializeCollection = (collection, variables, maps) => {
  const modes = Object.fromEntries(
    (collection.modes || []).map((mode) => [mode.modeId, mode.name])
  );

  const collectionVariables = variables
    .filter((variable) => variable.variableCollectionId === collection.id)
    .sort((a, b) => {
      const variableIds = collection.variableIds || [];
      const aIndex = variableIds.indexOf(a.id);
      const bIndex = variableIds.indexOf(b.id);

      if (aIndex !== -1 && bIndex !== -1) {
        return aIndex - bIndex;
      }

      return a.name.localeCompare(b.name);
    });

  return {
    id: collection.id,
    key: collection.key,
    name: collection.name,
    defaultModeId: collection.defaultModeId,
    modes,
    variableIds: collection.variableIds,
    hiddenFromPublishing: collection.hiddenFromPublishing === true,
    remote: collection.remote === true,
    variables: collectionVariables.map((variable) => {
      const valuesByMode = Object.fromEntries(
        Object.entries(variable.valuesByMode || {}).map(([modeId, value]) => [
          modeId,
          serializeVariableValue(value),
        ])
      );
      const resolvedValuesByMode = Object.fromEntries(
        Object.keys(valuesByMode).map((modeId) => [
          modeId,
          resolveVariableValue(variable, modeId, maps),
        ])
      );

      return {
        id: variable.id,
        key: variable.key,
        name: variable.name,
        description: variable.description || '',
        type: variable.resolvedType,
        valuesByMode,
        resolvedValuesByMode,
        scopes: variable.scopes || [],
        hiddenFromPublishing: variable.hiddenFromPublishing === true,
        remote: variable.remote === true,
        codeSyntax: variable.codeSyntax || {},
      };
    }),
  };
};

const exportVariables = async () => {
  try {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    const variables = await figma.variables.getLocalVariablesAsync();
    const collectionById = new Map(collections.map((collection) => [collection.id, collection]));
    const variableById = new Map(variables.map((variable) => [variable.id, variable]));
    const maps = { collectionById, variableById };
    const targetCollections = collections.filter((collection) =>
      TARGET_COLLECTIONS.has(collection.name)
    );

    const payload = {
      version: 1,
      kind: 'ti-figma-variable-key-export',
      exportedAt: new Date().toISOString(),
      fileKey: figma.fileKey,
      fileName: figma.root.name,
      collectionCount: targetCollections.length,
      variableCount: targetCollections.reduce((count, collection) => {
        return count + variables.filter((variable) => variable.variableCollectionId === collection.id).length;
      }, 0),
      collections: Object.fromEntries(
        targetCollections.map((collection) => [
          collection.name,
          serializeCollection(collection, variables, maps),
        ])
      ),
    };

    figma.ui.postMessage({
      type: 'export',
      payload,
    });
  } catch (error) {
    figma.ui.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

figma.ui.onmessage = async (message) => {
  if (message.type === 'export') {
    await exportVariables();
  }

  if (message.type === 'close') {
    figma.closePlugin();
  }
};

exportVariables();

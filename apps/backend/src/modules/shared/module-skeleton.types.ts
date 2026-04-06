export const MODULE_LAYERS = [
  'domain',
  'application',
  'infrastructure',
  'dto',
  'controllers',
  'services',
] as const;

export type ModuleLayer = (typeof MODULE_LAYERS)[number];

export interface ModuleSkeletonStatus {
  module: string;
  status: 'not-implemented';
  layers: readonly ModuleLayer[];
}

export function createModuleSkeletonStatus(
  moduleName: string,
): ModuleSkeletonStatus {
  return {
    module: moduleName,
    status: 'not-implemented',
    layers: MODULE_LAYERS,
  };
}

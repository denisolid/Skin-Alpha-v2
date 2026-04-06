import type {
  ModuleLayer,
  ModuleSkeletonStatus,
} from './module-skeleton.types';

export class ModuleSkeletonDto implements ModuleSkeletonStatus {
  readonly module: string;
  readonly status: 'not-implemented';
  readonly layers: readonly ModuleLayer[];

  constructor(status: ModuleSkeletonStatus) {
    this.module = status.module;
    this.status = status.status;
    this.layers = status.layers;
  }
}

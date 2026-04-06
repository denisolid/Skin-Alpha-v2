export const HEALTH_REPOSITORY = Symbol('HEALTH_REPOSITORY');

export interface HealthDependencies {
  config: 'configured';
  database: 'configured';
  queue: 'configured';
  redis: 'configured';
}

export interface HealthRepository {
  getDependencies(): HealthDependencies;
}

import type { HealthDependencies } from '../domain/health.repository';

export class HealthStatusDto {
  readonly name: string;
  readonly environment: 'development' | 'test' | 'production';
  readonly status: 'ok';
  readonly timestamp: string;
  readonly services: HealthDependencies;

  constructor(props: {
    environment: 'development' | 'test' | 'production';
    name: string;
    services: HealthDependencies;
    status: 'ok';
    timestamp: string;
  }) {
    this.name = props.name;
    this.environment = props.environment;
    this.status = props.status;
    this.timestamp = props.timestamp;
    this.services = props.services;
  }
}

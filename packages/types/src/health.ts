export type DependencyState = 'connected' | 'disconnected';

export interface HealthStatus {
  status: 'ok' | 'degraded';
  database: DependencyState;
  redis: DependencyState;
  uptimeSeconds: number;
  version: string;
}

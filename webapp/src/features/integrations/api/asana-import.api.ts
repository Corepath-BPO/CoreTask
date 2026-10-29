import { ApiRoutes } from '@coretask/contracts';
import type {
  AsanaImportStatus,
  AsanaLiveSyncStatus,
  ImportRun,
  StartAsanaImportResult,
} from '@coretask/types';

import { apiClient } from '@/lib/api/client';

const routes = ApiRoutes.asanaImport;

export const asanaImportApi = {
  status: (workspaceId: string): Promise<AsanaImportStatus> =>
    apiClient.get<AsanaImportStatus>(routes.status(workspaceId)),

  start: (workspaceId: string): Promise<StartAsanaImportResult> =>
    apiClient.post<StartAsanaImportResult>(routes.start(workspaceId), {}),

  run: (workspaceId: string, runId: string): Promise<ImportRun> =>
    apiClient.get<ImportRun>(routes.run(workspaceId, runId)),

  setLiveSync: (workspaceId: string, enabled: boolean): Promise<AsanaLiveSyncStatus> =>
    apiClient.put<AsanaLiveSyncStatus>(routes.liveSync(workspaceId), { enabled }),
};

// apps/desktop/src/entities/tracker/api.ts
export type {
  WorkItem,
  WorkItemSource,
  TrackerConfig,
  TrackerProject,
  TrackerState,
  WorkItemFilter,
  CreateTrackerConfigRequest,
  UpdateTrackerConfigRequest,
  TestConnectionResult,
} from './types'

export {
  listTrackerConfigs,
  createTrackerConfig,
  updateTrackerConfig,
  deleteTrackerConfig,
  testTrackerConfig,
  fetchTrackerProjects,
  fetchTrackerStates,
  browseTrackerItems,
  setProjectTracker,
} from '@core/api/client'

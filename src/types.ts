export interface CodeTask {
  taskId: string;
  baseBranch: string;
  featureBranch: string;
  description: string;
  developer: string;
  createdDate: string;
  repositoryUrl: string;
  commitId: string;
}

export interface TaskFile {
  id: string;
  taskId: string;
  fileName: string;
  path: string;
  extension: string;
  baseContent: string;
  featureContent: string;
  resolvedContent?: string;
  isConflict?: boolean;
  isResolved?: boolean;
}

export interface CodeChange {
  id: string;
  taskId: string;
  fileId: string;
  fileName: string;
  lineNumber: number;
  changeType: 'Added' | 'Deleted' | 'Modified';
  oldValue: string;
  newValue: string;
}

export interface MergeConflict {
  id: string;
  taskId: string;
  fileId: string;
  conflictText: string;
  resolution: string;
  auditTrail: string[];
}

export interface AIRecommendation {
  id: string;
  taskId: string;
  recommendationText: string;
  category: 'Code Quality' | 'Repeated Changes' | 'Conflict Prediction' | 'Refactoring';
}

export interface DashboardMetrics {
  totalTasks: number;
  totalConflicts: number;
  resolvedConflicts: number;
  filesChanged: number;
}

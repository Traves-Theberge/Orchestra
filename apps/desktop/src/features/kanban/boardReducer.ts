import { INITIAL_COLUMN_ORDER } from './types'

export type BoardState = {
  activeTab: 'board' | 'workitems'
  viewMode: 'board' | 'list'
  stateFilter: string
  projectFilter: string
  columnOrder: string[]
  isDraggingOver: string | null
  draggingColumnId: string | null
  dragValidationMsg: string | null
  deleteDialogOpen: boolean
  issueToDelete: { identifier: string; title?: string } | null
  deleteTaskPending: boolean
  deleteTaskError: string
  feedbackDialogTarget: { identifier: string; targetState: string } | null
  feedbackText: string
  feedbackPending: boolean
}

export type BoardAction =
  | { type: 'setActiveTab'; tab: 'board' | 'workitems' }
  | { type: 'setViewMode'; mode: 'board' | 'list' }
  | { type: 'setStateFilter'; value: string }
  | { type: 'setProjectFilter'; value: string }
  | { type: 'setColumnOrder'; order: string[] }
  | { type: 'dragOverColumn'; columnId: string | null }
  | { type: 'dragStartColumn'; columnId: string | null }
  | { type: 'dragEnd' }
  | { type: 'setDragValidationMsg'; message: string | null }
  | { type: 'openDeleteDialog'; target: { identifier: string; title?: string } }
  | { type: 'closeDeleteDialog' }
  | { type: 'setDeleteTaskPending'; pending: boolean }
  | { type: 'setDeleteTaskError'; error: string }
  | { type: 'openFeedbackDialog'; target: { identifier: string; targetState: string } }
  | { type: 'closeFeedbackDialog' }
  | { type: 'setFeedbackText'; value: string }
  | { type: 'setFeedbackPending'; pending: boolean }

export const initialBoardState = (initialProjectFilter: string): BoardState => ({
  activeTab: 'board',
  viewMode: 'board',
  stateFilter: 'all',
  projectFilter: initialProjectFilter,
  columnOrder: INITIAL_COLUMN_ORDER,
  isDraggingOver: null,
  draggingColumnId: null,
  dragValidationMsg: null,
  deleteDialogOpen: false,
  issueToDelete: null,
  deleteTaskPending: false,
  deleteTaskError: '',
  feedbackDialogTarget: null,
  feedbackText: '',
  feedbackPending: false,
})

export function boardReducer(state: BoardState, action: BoardAction): BoardState {
  switch (action.type) {
    case 'setActiveTab':
      return { ...state, activeTab: action.tab }
    case 'setViewMode':
      return { ...state, viewMode: action.mode }
    case 'setStateFilter':
      return { ...state, stateFilter: action.value }
    case 'setProjectFilter':
      return { ...state, projectFilter: action.value }
    case 'setColumnOrder':
      return { ...state, columnOrder: action.order }
    case 'dragOverColumn':
      return { ...state, isDraggingOver: action.columnId }
    case 'dragStartColumn':
      return { ...state, draggingColumnId: action.columnId }
    case 'dragEnd':
      return { ...state, isDraggingOver: null, draggingColumnId: null }
    case 'setDragValidationMsg':
      return { ...state, dragValidationMsg: action.message }
    case 'openDeleteDialog':
      return {
        ...state,
        deleteDialogOpen: true,
        issueToDelete: action.target,
        deleteTaskError: '',
      }
    case 'closeDeleteDialog':
      return {
        ...state,
        deleteDialogOpen: false,
        issueToDelete: null,
        deleteTaskError: '',
      }
    case 'setDeleteTaskPending':
      return { ...state, deleteTaskPending: action.pending }
    case 'setDeleteTaskError':
      return { ...state, deleteTaskError: action.error }
    case 'openFeedbackDialog':
      return { ...state, feedbackDialogTarget: action.target, feedbackText: '' }
    case 'closeFeedbackDialog':
      return { ...state, feedbackDialogTarget: null, feedbackText: '' }
    case 'setFeedbackText':
      return { ...state, feedbackText: action.value }
    case 'setFeedbackPending':
      return { ...state, feedbackPending: action.pending }
    default:
      return state
  }
}

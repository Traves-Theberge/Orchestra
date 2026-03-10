# Issue Activity & History

The Issue Activity feature provides a comprehensive audit trail of all system interactions and state changes for each issue, enabling complete transparency and debugging capabilities.

## 🎯 Overview

The Activity tab in the Issue Inspector displays a chronological timeline of all events related to an issue, including:
- Issue creation and state changes
- Agent session start/stop events
- Token usage and performance metrics
- User interactions and modifications
- System-level events and errors

## 🏗️ Architecture

### Backend Implementation

#### Database Schema
```sql
CREATE TABLE IF NOT EXISTS issue_history (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL,
    user_id TEXT,
    action TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (issue_id) REFERENCES issues(id)
);
```

#### API Endpoint
- **GET** `/api/v1/issues/{issue_identifier}/history`
- Returns JSON array of historical events with metadata
- Includes token usage, timestamps, and provider information

### Frontend Implementation

#### Components
- **Activity Timeline**: Visual timeline with event icons and descriptions
- **Event Icons**: Contextual icons for different event types (agent actions, user changes, system events)
- **Token Metrics**: Display input/output token usage for AI events
- **Provider Badges**: Visual indicators for which AI provider handled events

#### State Management
```typescript
const [issueHistory, setIssueHistory] = useState<any[]>([])
const [historyLoading, setHistoryLoading] = useState(false)
```

## 🎨 UI Features

### Timeline Display
- **Chronological Order**: Events displayed newest to oldest
- **Event Types**: Color-coded icons for different event categories
- **Provider Information**: Shows which AI agent handled each event
- **Token Metrics**: Input/output token counts for AI interactions

### Event Categories
- **Agent Actions**: Session start, stop, restart events
- **Issue Changes**: State transitions, priority updates, assignee changes
- **User Interactions**: Manual edits, comments, approvals
- **System Events**: Error handling, resource allocation, background tasks

### Responsive Design
- **Mobile Optimized**: Timeline adapts to smaller screens
- **Expandable Events**: Click to view detailed event information
- **Filter Options**: Search and filter events by type or date range

## 🔧 API Integration

### Fetching History
```typescript
export async function fetchIssueHistory(config: BackendConfig, issueIdentifier: string): Promise<any[]> {
  const data = await requestJSON<{ history: any[] }>(config, `/api/v1/issues/${encodeURIComponent(normalized)}/history`)
  return data.history || []
}
```

### Event Data Structure
```typescript
interface HistoryEvent {
  id: string
  issue_id: string
  user_id?: string
  kind: string
  old_value?: string
  new_value?: string
  timestamp: string
  message: string
  provider?: string
  input_tokens?: number
  output_tokens?: number
}
```

## 🚀 Usage Examples

### Basic History View
1. Open any issue in the Issue Inspector
2. Click the "Activity" tab
3. View chronological timeline of all events
4. Click events to see detailed information

### Performance Monitoring
- Monitor token usage across different providers
- Identify bottlenecks in issue resolution
- Track agent performance over time

### Debugging Support
- Trace issue lifecycle from creation to resolution
- Identify failed operations and error patterns
- Correlate user actions with system responses

## 🔍 Event Types

### Core Events
- `issue_created`: New issue created
- `issue_updated`: Issue metadata modified
- `issue_state_changed`: Issue transition between states
- `issue_assigned`: Issue assigned to agent/user

### Agent Events
- `session_started`: Agent session initialized
- `session_completed`: Agent finished successfully
- `session_failed`: Agent session encountered error
- `session_restarted`: Agent session restarted

### System Events
- `resource_allocated`: System resources assigned
- `error_occurred`: System error logged
- `cleanup_performed`: Background cleanup executed

## 📊 Performance Considerations

### Database Optimization
- Indexed queries on `issue_id` and `timestamp`
- Efficient pagination for large history sets
- Automatic cleanup of old events (configurable retention)

### Frontend Performance
- Lazy loading of history events
- Virtual scrolling for large timelines
- Debounced search and filter operations

## 🔮 Future Enhancements

### Planned Features
- **Real-time Updates**: Live event streaming via WebSocket
- **Advanced Filtering**: Filter by date range, event type, provider
- **Export Capabilities**: Download history as CSV/JSON
- **Analytics Dashboard**: Aggregate statistics and trends

### Potential Improvements
- **Event Correlation**: Link related events across issues
- **Performance Metrics**: Response time and success rate tracking
- **User Behavior**: Track common patterns and workflows

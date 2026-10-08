const operations: Record<string, [string, string]> = {
  'http.request': ['API request', 'A request from the app to its backend. These requests include routine refreshes and may have no task attached.'],
  'http.completed': ['API request completed', 'The backend finished handling a request. Info records describe routine activity; error records need a closer look at the associated trace.'],
  'chat.turn': ['Conversation turn', 'One message sent to an agent, from acceptance through its final observed outcome.'],
  'provider.turn': ['Agent response', 'Time spent running the provider for this message or task attempt, including its observed tool activity.'],
  'task.attempt': ['Task attempt', 'One attempt to run a task. A retry is a separate attempt and may have a different outcome.'],
  'task.prepare': ['Prepare task', 'Set up the task before asking the agent to run it.'],
  'task.finalize': ['Finalize task', 'Save the result and finish the task workflow after the agent responds.'],
  'tool.execute': ['Tool execution', 'A tool invoked by the agent. Its recorded duration covers the observed execution boundary.'],
  'provider.tool': ['Provider tool activity', 'A tool activity reported by the native provider.'],
  'approval.wait': ['Waiting for approval', 'Time spent waiting for an approval response before continuing.'],
  'chat.accepted': ['Message accepted', 'The backend accepted the message. The agent may still be preparing or running.'],
  'chat.completed': ['Conversation turn completed', 'The turn reached its recorded successful end.'],
  'chat.failed': ['Conversation turn failed', 'The turn reported a failure. Open its trace to see the operations leading up to it.'],
  'chat.cancelled': ['Conversation turn cancelled', 'The turn was interrupted before normal completion.'],
  'chat.unknown': ['Conversation outcome unknown', 'A final outcome could not be confirmed from the recorded evidence.'],
  'task.failed': ['Task attempt failed', 'This attempt failed. A later retry may still succeed; check the task timeline for the full sequence.'],
  'task.retry.scheduled': ['Task retry scheduled', 'Another attempt was scheduled. This event does not confirm that the next attempt has started.'],
  'task.result.discarded': ['Task result not applied', 'The result could not be applied to the current task state. Check cancellation or workflow changes in the task timeline.'],
  'tool.started': ['Tool started', 'The provider reported that a tool activity began.'],
  'approval.requested': ['Approval requested', 'The agent is waiting for an approval decision.'],
  'approval.responded': ['Approval response received', 'An approval response was received; later events show whether execution continued.'],
  'feature.chat.send': ['Message sent', 'The chat send action was recorded.'],
  'feature.task.dispatch': ['Task dispatched', 'The task was handed to the execution workflow.'],
}

export function operationLabel(name: string) { return operations[name]?.[0] ?? name }
export function operationDescription(name: string) { return operations[name]?.[1] ?? 'An operation recorded by Orchestra. Open its timeline for related activity and timing.' }
export function outcomeLabel(status: string) {
  return ({ ok: 'Completed', error: 'Failed', running: 'In progress', cancelled: 'Cancelled', unknown: 'Outcome unknown' } as Record<string, string>)[status] ?? status
}

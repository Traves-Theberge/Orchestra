package control

func ResourceToolSpecs() []map[string]any {
	properties := map[string]any{}
	for key, description := range map[string]string{
		"operation":     "list, get, create, update, delete or receipt",
		"project_id":    "Exact registered project ID; __orchestrator__ allows global authoring only",
		"workspace_id":  "Exact selected child checkout ID for project resources",
		"harness":       "Registered harness owning the native agent or skill definition",
		"scope":         "project or global; effective is read-only",
		"kind":          "agent_definition, skill or supported orchestra_config",
		"resource_id":   "Exact native resource ID returned by inventory; never a host path",
		"request_id":    "Stable canonical UUID for mutations and receipt reconciliation",
		"expected_hash": "Exact current content hash for update/delete; empty on create",
		"content":       "Raw native document; preserve unknown fields and comments",
		"format":        "Native document format returned by inventory",
	} {
		properties[key] = map[string]any{"type": "string", "description": description}
	}
	properties["operation"].(map[string]any)["enum"] = []string{"list", "get", "create", "update", "delete", "receipt"}
	properties["kind"].(map[string]any)["enum"] = []string{"agent_definition", "skill", "orchestra_config"}
	return []map[string]any{{"type": "function", "name": "orchestra_resources", "description": "Inspect and author Orchestra's harness-owned agent and skill definitions through the same scoped resource service as the Agents UI. Discovery does not prove primary-agent selection support. Preserve raw native content. Mutations require stable UUID receipts and expected hashes; reconcile unknown outcomes. Provider credentials and arbitrary host files are outside this tool.", "inputSchema": map[string]any{"type": "object", "additionalProperties": false, "required": []string{"operation", "project_id"}, "properties": properties}}}
}

package cli

import (
	"fmt"
	"io"
	"strings"
	"unicode"
)

func taskHumanCommand(name string) bool {
	switch name {
	case "task list", "task show", "task assign", "control tasks":
		return true
	default:
		return false
	}
}

func writeTaskHuman(out io.Writer, c command, data any) error {
	var tasks []any
	switch c.name {
	case "task list":
		object, ok := data.(map[string]any)
		if !ok {
			return fmt.Errorf("invalid task-list response")
		}
		tasks, ok = object["issues"].([]any)
		if !ok {
			return fmt.Errorf("invalid task-list rows")
		}
		if len(tasks) == 0 {
			if c.unassigned {
				_, err := fmt.Fprintln(out, "No unassigned tasks found.")
				return err
			}
			_, err := fmt.Fprintln(out, "No tasks found.")
			return err
		}
	case "task show":
		task, ok := data.(map[string]any)
		if !ok {
			return fmt.Errorf("invalid task response")
		}
		return writeTaskDetails(out, task)
	case "task assign":
		result, ok := data.(map[string]any)
		if !ok || result["success"] != true {
			return fmt.Errorf("assignment result is not confirmed")
		}
		payload, ok := result["data"].(map[string]any)
		if !ok {
			return fmt.Errorf("assignment task is missing")
		}
		task, ok := payload["task"].(map[string]any)
		if !ok {
			return fmt.Errorf("assignment task is missing")
		}
		if _, err := fmt.Fprintln(out, "Task assigned; it remains in Backlog and was not queued."); err != nil {
			return err
		}
		return writeTaskDetails(out, task)
	case "control tasks":
		result, ok := data.(map[string]any)
		if !ok || result["success"] != true {
			return fmt.Errorf("task inventory is not confirmed")
		}
		payload, ok := result["data"].(map[string]any)
		if !ok {
			return fmt.Errorf("invalid scoped task inventory")
		}
		tasks, ok = payload["tasks"].([]any)
		if !ok {
			return fmt.Errorf("invalid scoped task rows")
		}
		if _, err := fmt.Fprintf(out, "Project %s tasks (%d):\n", safeHuman(payload["project_id"]), len(tasks)); err != nil {
			return err
		}
		if len(tasks) == 0 {
			_, err := fmt.Fprintln(out, "No tasks found.")
			return err
		}
	}
	for _, raw := range tasks {
		task, ok := raw.(map[string]any)
		if !ok {
			return fmt.Errorf("invalid task row")
		}
		if err := writeTaskDetails(out, task); err != nil {
			return err
		}
	}
	return nil
}

func writeTaskDetails(out io.Writer, task map[string]any) error {
	identifier := safeHuman(task["identifier"])
	if identifier == "" {
		identifier = safeHuman(task["id"])
	}
	if _, err := fmt.Fprintf(out, "%s — %s\n", identifier, safeHuman(task["title"])); err != nil {
		return err
	}
	if _, err := fmt.Fprintf(out, "  State: %s\n  Assignee: %s\n  Harness: %s\n  PR: %s\n",
		safeHuman(task["state"]), valueOr(task["assignee_id"], "unassigned"), valueOr(task["provider"], "not set"), valueOr(task["pr_url"], "none")); err != nil {
		return err
	}
	return nil
}

func valueOr(value any, fallback string) string {
	if text := safeHuman(value); text != "" {
		return text
	}
	return fallback
}

func safeHuman(value any) string {
	text, ok := value.(string)
	if !ok {
		return ""
	}
	return strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return ' '
		}
		return r
	}, text)
}

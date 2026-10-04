package studio

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"math/big"
	"strconv"
	"strings"
)

// MaxDraftTurns matches the existing application turn-setting bound. It is a
// requested draft value, not evidence that a provider or task honors this limit.
const MaxDraftTurns = 100

func validateDraftPatch(patch map[string]any) (map[string]any, error) {
	if patch == nil {
		return nil, fmt.Errorf("studio: draft patch must be an object")
	}
	fields := make(map[string]any, len(patch))
	for key, value := range patch {
		switch key {
		case "title", "description", "suggested_provider", "suggested_model":
			text, ok := value.(string)
			if !ok {
				return nil, fmt.Errorf("studio: %s must be a string", key)
			}
			fields[key] = text
		case "max_turns":
			if value == nil {
				fields[key] = nil
				continue
			}
			var number float64
			switch v := value.(type) {
			case int:
				number = float64(v)
			case float64:
				number = v
			case json.Number:
				approximate, err := strconv.ParseFloat(string(v), 64)
				if err != nil || len(v) > 64 || approximate < 1 || approximate > MaxDraftTurns {
					return nil, fmt.Errorf("studio: max_turns must be an integer between 1 and %d", MaxDraftTurns)
				}
				// Avoid rounding a fractional JSON value into an integer before
				// validation (for example 1.0000000000000000001).
				rational, ok := new(big.Rat).SetString(string(v))
				if !ok || !rational.IsInt() || !rational.Num().IsInt64() {
					return nil, fmt.Errorf("studio: max_turns must be an integer")
				}
				number = float64(rational.Num().Int64())
			default:
				return nil, fmt.Errorf("studio: max_turns must be an integer or null")
			}
			if math.IsNaN(number) || math.IsInf(number, 0) || number < 1 || number > MaxDraftTurns || math.Trunc(number) != number {
				return nil, fmt.Errorf("studio: max_turns must be an integer between 1 and %d", MaxDraftTurns)
			}
			fields[key] = int(number)
		case "acceptance_criteria":
			var entries []any
			if err := decodePatchValue(value, &entries); err != nil || entries == nil {
				return nil, fmt.Errorf("studio: acceptance_criteria must be an array of strings")
			}
			for _, entry := range entries {
				if _, ok := entry.(string); !ok {
					return nil, fmt.Errorf("studio: acceptance_criteria must be an array of strings")
				}
			}
			var criteria []string
			if err := decodePatchValue(value, &criteria); err != nil || criteria == nil {
				return nil, fmt.Errorf("studio: acceptance_criteria must be an array of strings")
			}
			raw, _ := json.Marshal(criteria)
			fields[key] = string(raw)
		case "attachments":
			var attachments []Attachment
			if err := decodePatchValue(value, &attachments); err != nil || attachments == nil {
				return nil, fmt.Errorf("studio: attachments must be an array of typed attachments")
			}
			for _, attachment := range attachments {
				switch attachment.Kind {
				case "file":
					if strings.TrimSpace(attachment.Path) == "" || attachment.URL != "" {
						return nil, fmt.Errorf("studio: file attachment requires path and no url")
					}
				case "link":
					if strings.TrimSpace(attachment.URL) == "" || attachment.Path != "" {
						return nil, fmt.Errorf("studio: link attachment requires url and no path")
					}
				default:
					return nil, fmt.Errorf("studio: attachment kind must be file or link")
				}
			}
			raw, _ := json.Marshal(attachments)
			fields[key] = string(raw)
		default:
			return nil, fmt.Errorf("studio: field not patchable: %q", key)
		}
	}
	return fields, nil
}

func decodePatchValue(value any, destination any) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	return decoder.Decode(destination)
}

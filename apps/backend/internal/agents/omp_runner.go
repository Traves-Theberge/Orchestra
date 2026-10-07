package agents

import (
	"errors"
	"regexp"
)

// OMPRunner runs one batch turn with `omp -p --mode json`. Agent profiles are
// applied per run by planOMP; interactive chat uses OMPNativeSession instead.
type OMPRunner struct {
	*CommandRunner
}

// NewOMPRunner creates a Runner for the omp (oh-my-pi) CLI command template.
func NewOMPRunner(command string) *OMPRunner {
	return &OMPRunner{CommandRunner: NewCommandRunner(ProviderOMP, command)}
}

// omp addresses models as "provider/model" (its catalog selector) and also
// fuzzy-matches bare names such as "opus".
var ompModelPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}(/[A-Za-z0-9][A-Za-z0-9._:/\[\]-]{0,159})?$`)

// ValidateRequestedModel accepts well-formed selectors and fuzzy names; omp
// reports models the signed-in accounts cannot use. The adapter passes --model.
func (r *OMPRunner) ValidateRequestedModel(model string) error {
	if !ompModelPattern.MatchString(model) {
		return errors.New("model must be an omp provider/model selector or model name")
	}
	return nil
}

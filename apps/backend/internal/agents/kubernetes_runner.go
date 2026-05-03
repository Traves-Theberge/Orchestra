package agents

import (
	"bufio"
	"context"
	"fmt"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

// KubernetesRunner executes agent turns in ephemeral Kubernetes pods.
//
// Each turn spawns a new pod that:
//  1. Clones the git repo in an init container (alpine/git)
//  2. Runs the agent command in the main container with the cloned workspace
//  3. Streams logs back via the Kubernetes log API (follow=true)
//  4. Deletes the pod on completion or cancellation
//
// Agent API credentials must be pre-provisioned in a Kubernetes Secret named
// "orchestra-agent-credentials" in the target namespace. The runner injects
// all keys from that secret as environment variables.
type KubernetesRunner struct {
	wrappedProvider Provider
	command         string
	clientset       kubernetes.Interface
	namespace       string
	image           string
	gitRepoURL      string
	serviceAccount  string
}

// NewKubernetesRunner builds a runner backed by the given Kubernetes clientset.
// wrappedProvider is the AI provider this transport will execute (e.g. ProviderClaude).
// gitRepoURL is the remote repository URL cloned into each pod's workspace.
func NewKubernetesRunner(wrappedProvider Provider, command string, clientset kubernetes.Interface, namespace, image, gitRepoURL, serviceAccount string) *KubernetesRunner {
	if namespace == "" {
		namespace = "orchestra-agents"
	}
	if image == "" {
		image = "ghcr.io/orchestra/agent-runner:latest"
	}
	return &KubernetesRunner{
		wrappedProvider: wrappedProvider,
		command:         strings.TrimSpace(command),
		clientset:       clientset,
		namespace:       namespace,
		image:           image,
		gitRepoURL:      gitRepoURL,
		serviceAccount:  serviceAccount,
	}
}

// WrapCommand implements RuntimeTransport. Returns a new KubernetesRunner
// configured to run the given provider's command in a Kubernetes pod.
func (r *KubernetesRunner) WrapCommand(provider Provider, command string) Runner {
	return &KubernetesRunner{
		wrappedProvider: provider,
		command:         command,
		clientset:       r.clientset,
		namespace:       r.namespace,
		image:           r.image,
		gitRepoURL:      r.gitRepoURL,
		serviceAccount:  r.serviceAccount,
	}
}

// NewKubernetesClientset builds a Kubernetes clientset from the given kubeconfig
// path. If path is empty, in-cluster config is attempted.
func NewKubernetesClientset(kubeconfigPath string) (kubernetes.Interface, error) {
	var cfg *rest.Config
	var err error
	if kubeconfigPath == "" {
		cfg, err = rest.InClusterConfig()
	} else {
		cfg, err = clientcmd.BuildConfigFromFlags("", kubeconfigPath)
	}
	if err != nil {
		return nil, fmt.Errorf("kubernetes config: %w", err)
	}
	return kubernetes.NewForConfig(cfg)
}

// RunTurn spawns a Kubernetes pod, streams its logs, and deletes it on completion.
func (r *KubernetesRunner) RunTurn(ctx context.Context, request TurnRequest, onEvent EventHandler) (TurnResult, error) {
	sessionID := request.SessionID
	if sessionID == "" {
		sessionID = fmt.Sprintf("k8s-%s-%d", request.IssueIdentifier, time.Now().UnixNano())
	}

	emit := func(kind, message string, raw map[string]any) {
		if onEvent != nil {
			onEvent(Event{
				Provider:  r.wrappedProvider,
				SessionID: sessionID,
				Kind:      kind,
				Message:   message,
				Raw:       raw,
				Timestamp: time.Now().UTC(),
			})
		}
	}

	if r.gitRepoURL == "" {
		err := fmt.Errorf("ORCHESTRA_KUBE_GIT_REPO_URL is required for Kubernetes dispatch")
		emit("error", err.Error(), nil)
		return TurnResult{Provider: r.wrappedProvider, SessionID: sessionID, ExitCode: 1, Output: err.Error()}, err
	}

	podName := r.podName(request.IssueIdentifier)
	emit("pod_creating", fmt.Sprintf("creating pod %s/%s", r.namespace, podName), nil)

	pod := r.buildPodSpec(podName, request)
	if _, err := r.clientset.CoreV1().Pods(r.namespace).Create(ctx, pod, metav1.CreateOptions{}); err != nil {
		emit("error", fmt.Sprintf("pod create failed: %s", err), nil)
		return TurnResult{Provider: r.wrappedProvider, SessionID: sessionID, ExitCode: 1, Output: err.Error()}, err
	}

	// Always clean up the pod, even on cancellation.
	defer func() {
		delCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_ = r.clientset.CoreV1().Pods(r.namespace).Delete(delCtx, podName, metav1.DeleteOptions{})
		emit("pod_deleted", fmt.Sprintf("pod %s deleted", podName), nil)
	}()

	// Wait for the pod to be Running (init container must finish cloning first).
	emit("pod_pending", "waiting for pod to reach Running state", nil)
	if err := r.waitForRunning(ctx, podName, emit); err != nil {
		emit("error", fmt.Sprintf("pod did not reach Running: %s", err), nil)
		return TurnResult{Provider: r.wrappedProvider, SessionID: sessionID, ExitCode: 1, Output: err.Error()}, err
	}

	emit("RUN_STARTED", fmt.Sprintf("agent running in pod %s", podName), map[string]any{"pod": podName, "namespace": r.namespace})

	// Stream container logs.
	exitCode, output, usage, err := r.streamLogs(ctx, podName, sessionID, onEvent)
	if err != nil {
		emit("error", fmt.Sprintf("log stream error: %s", err), nil)
	}

	emit("turn.completed", fmt.Sprintf("pod exited with code %d", exitCode), map[string]any{"exit_code": exitCode})

	return TurnResult{
		Provider:  r.wrappedProvider,
		SessionID: sessionID,
		ExitCode:  exitCode,
		Output:    output,
		Usage:     usage,
	}, err
}

// buildPodSpec constructs the pod specification for an agent run.
func (r *KubernetesRunner) buildPodSpec(podName string, request TurnRequest) *corev1.Pod {
	commandLine := r.command
	if strings.TrimSpace(request.CommandOverride) != "" {
		commandLine = strings.TrimSpace(request.CommandOverride)
	}
	finalPrompt := strings.TrimSpace(request.Prompt)
	var agentCmd string
	if commandLine != "" {
		agentCmd = strings.ReplaceAll(commandLine, "{{prompt}}", finalPrompt)
	} else {
		agentCmd = finalPrompt
	}

	credentialsEnvFrom := []corev1.EnvFromSource{
		{
			SecretRef: &corev1.SecretEnvSource{
				LocalObjectReference: corev1.LocalObjectReference{Name: "orchestra-agent-credentials"},
				Optional:             boolPtr(true),
			},
		},
	}

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      podName,
			Namespace: r.namespace,
			Labels: map[string]string{
				"app":              "orchestra-agent",
				"issue-identifier": sanitizeLabel(request.IssueIdentifier),
			},
		},
		Spec: corev1.PodSpec{
			RestartPolicy: corev1.RestartPolicyNever,
			InitContainers: []corev1.Container{
				{
					Name:    "git-clone",
					Image:   "alpine/git:latest",
					Command: []string{"sh", "-c"},
					Args: []string{
						fmt.Sprintf("git clone %s /workspace && cd /workspace && git checkout HEAD 2>&1", r.gitRepoURL),
					},
					VolumeMounts: []corev1.VolumeMount{
						{Name: "workspace", MountPath: "/workspace"},
					},
				},
			},
			Containers: []corev1.Container{
				{
					Name:       "agent",
					Image:      r.image,
					Command:    []string{"sh", "-c"},
					Args:       []string{agentCmd},
					WorkingDir: "/workspace",
					EnvFrom:    credentialsEnvFrom,
					VolumeMounts: []corev1.VolumeMount{
						{Name: "workspace", MountPath: "/workspace"},
					},
					Resources: corev1.ResourceRequirements{
						Requests: corev1.ResourceList{
							corev1.ResourceCPU:    resource.MustParse("500m"),
							corev1.ResourceMemory: resource.MustParse("512Mi"),
						},
						Limits: corev1.ResourceList{
							corev1.ResourceCPU:    resource.MustParse("2"),
							corev1.ResourceMemory: resource.MustParse("2Gi"),
						},
					},
				},
			},
			Volumes: []corev1.Volume{
				{
					Name: "workspace",
					VolumeSource: corev1.VolumeSource{
						EmptyDir: &corev1.EmptyDirVolumeSource{},
					},
				},
			},
		},
	}

	if r.serviceAccount != "" {
		pod.Spec.ServiceAccountName = r.serviceAccount
	}

	return pod
}

// waitForRunning watches the pod until it reaches Running phase or the context
// is cancelled. Times out after 3 minutes for the init container to finish.
func (r *KubernetesRunner) waitForRunning(ctx context.Context, podName string, emit func(string, string, map[string]any)) error {
	timeout := int64(180)
	watcher, err := r.clientset.CoreV1().Pods(r.namespace).Watch(ctx, metav1.ListOptions{
		FieldSelector:  "metadata.name=" + podName,
		TimeoutSeconds: &timeout,
	})
	if err != nil {
		return fmt.Errorf("watch pod: %w", err)
	}
	defer watcher.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case event, ok := <-watcher.ResultChan():
			if !ok {
				return fmt.Errorf("pod watch channel closed before Running")
			}
			if event.Type == watch.Error {
				return fmt.Errorf("watch error event received")
			}
			pod, ok := event.Object.(*corev1.Pod)
			if !ok {
				continue
			}
			switch pod.Status.Phase {
			case corev1.PodRunning:
				return nil
			case corev1.PodFailed:
				return fmt.Errorf("pod failed before Running: %s", pod.Status.Message)
			case corev1.PodSucceeded:
				// Pod finished before we started watching logs — treat as success.
				return nil
			case corev1.PodPending:
				emit("pod_pending", fmt.Sprintf("pod pending: %s", podPhaseMessage(pod)), nil)
			}
		}
	}
}

// streamLogs follows the main container's logs and parses them into events.
func (r *KubernetesRunner) streamLogs(ctx context.Context, podName, sessionID string, onEvent EventHandler) (int, string, TokenUsage, error) {
	logReq := r.clientset.CoreV1().Pods(r.namespace).GetLogs(podName, &corev1.PodLogOptions{
		Container: "agent",
		Follow:    true,
	})

	stream, err := logReq.Stream(ctx)
	if err != nil {
		return 1, "", TokenUsage{}, fmt.Errorf("log stream: %w", err)
	}
	defer stream.Close()

	collector := &outputCollector{}
	scanner := bufio.NewScanner(stream)
	for scanner.Scan() {
		line := scanner.Text()
		collector.append(line)
		event := parseLineToEvent(r.wrappedProvider, "stdout", line)
		event.SessionID = sessionID
		if onEvent != nil {
			onEvent(event)
		}
		collector.mergeUsage(event.Usage)
	}

	// Fetch exit code from terminated container status.
	exitCode := 0
	pod, err := r.clientset.CoreV1().Pods(r.namespace).Get(ctx, podName, metav1.GetOptions{})
	if err == nil {
		for _, cs := range pod.Status.ContainerStatuses {
			if cs.Name == "agent" && cs.State.Terminated != nil {
				exitCode = int(cs.State.Terminated.ExitCode)
				break
			}
		}
	}

	return exitCode, collector.output(), collector.usage(), nil
}

// podName derives a DNS-safe pod name from the issue identifier, truncated to 63 chars.
func (r *KubernetesRunner) podName(issueIdentifier string) string {
	safe := strings.ToLower(strings.NewReplacer(
		" ", "-", "/", "-", ".", "-", "_", "-",
	).Replace(issueIdentifier))
	suffix := fmt.Sprintf("-%d", time.Now().UnixNano()%1e9)
	prefix := "agent-" + safe
	if len(prefix)+len(suffix) > 63 {
		prefix = prefix[:63-len(suffix)]
	}
	return prefix + suffix
}

// podPhaseMessage extracts a human-readable status from a pending pod.
func podPhaseMessage(pod *corev1.Pod) string {
	for _, cond := range pod.Status.Conditions {
		if cond.Type == corev1.PodScheduled && cond.Status == corev1.ConditionFalse {
			return cond.Message
		}
	}
	return string(pod.Status.Phase)
}

// sanitizeLabel truncates and cleans a string for use as a Kubernetes label value.
func sanitizeLabel(s string) string {
	s = strings.ToLower(strings.NewReplacer(" ", "-", "/", "-", ".", "-").Replace(s))
	if len(s) > 63 {
		s = s[:63]
	}
	return s
}

func boolPtr(b bool) *bool { return &b }

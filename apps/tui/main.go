package main

import (
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

type model struct {
	backend     *Service
	frontend    *Service
	viewport    viewport.Model
	activeTab   int // 0: Backend, 1: Frontend
	width       int
	height      int
	ready       bool
	lastLogLen  int
}

type eventMsg struct{}

func initialModel() *model {
	m := &model{
		backend: &Service{
			Name: "Orchestra Backend",
			Cmd:  "./apps/backend/orchestrad",
			Cwd:  "../..",
			Env:  []string{"ORCHESTRA_SERVER_PORT=4010", "ORCHESTRA_SERVER_HOST=0.0.0.0", "ORCHESTRA_WORKSPACE_ROOT=/tmp/orchestra", "ORCHESTRA_API_TOKEN=dev-token"},
		},
		frontend: &Service{
			Name: "Orchestra Desktop",
			Cmd:  "npm run dev",
			Cwd:  "../desktop",
			Env:  []string{"ORCHESTRA_API_TOKEN=dev-token"},
		},
	}
	return m
}

func (m *model) Init() tea.Cmd {
	// Auto-start backend only
	m.backend.Start(func() {})

	return tea.Tick(100*time.Millisecond, func(t time.Time) tea.Msg {
		return eventMsg{}
	})
}

func (m *model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "q", "ctrl+c":
			m.backend.Stop()
			m.frontend.Stop()
			return m, tea.Quit
		case "tab":
			m.activeTab = (m.activeTab + 1) % 2
			m.updateViewport()
		case "1":
			m.activeTab = 0
			m.updateViewport()
		case "2":
			m.activeTab = 1
			m.updateViewport()
		case "s":
			s := m.getCurrentService()
			s.mu.Lock()
			running := s.Status == StatusRunning || s.Status == StatusStarting
			s.mu.Unlock()
			if running {
				s.Stop()
			} else {
				s.mu.Lock()
				s.Logs = append(s.Logs, fmt.Sprintf(">>> Starting %s...", s.Name))
				s.mu.Unlock()
				s.Start(func() {})
			}
		}

	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		vWidth := msg.Width - 4
		vHeight := msg.Height - 15
		if vWidth < 10 {
			vWidth = 10
		}
		if vHeight < 5 {
			vHeight = 5
		}
		if !m.ready {
			m.viewport = viewport.New(vWidth, vHeight)
			m.ready = true
		} else {
			m.viewport.Width = vWidth
			m.viewport.Height = vHeight
		}

	case eventMsg:
		m.updateViewport()
		// Chain the ticker
		cmds = append(cmds, tea.Tick(100*time.Millisecond, func(t time.Time) tea.Msg {
			return eventMsg{}
		}))
	}

	if m.ready {
		var cmd tea.Cmd
		m.viewport, cmd = m.viewport.Update(msg)
		cmds = append(cmds, cmd)
	}

	return m, tea.Batch(cmds...)
}

func (m *model) getCurrentService() *Service {
	if m.activeTab == 0 {
		return m.backend
	}
	return m.frontend
}

func (m *model) updateViewport() {
	if !m.ready {
		return
	}
	s := m.getCurrentService()
	s.mu.Lock()
	if len(s.Logs) == m.lastLogLen {
		s.mu.Unlock()
		return
	}
	content := strings.Join(s.Logs, "\n")
	m.lastLogLen = len(s.Logs)
	s.mu.Unlock()
	m.viewport.SetContent(content)
	m.viewport.GotoBottom()
}

func (m *model) View() string {
	if !m.ready {
		return "Initializing Orchestra Dashboard..."
	}

	header := GradientTitle(" 🎵 ORCHESTRA DASHBOARD ")
	
	tabs := []string{"[1] Backend", "[2] Frontend"}
	var tabViews []string
	for i, t := range tabs {
		if i == m.activeTab {
			tabViews = append(tabViews, ActiveTabStyle.Render(t))
		} else {
			tabViews = append(tabViews, InactiveTabStyle.Render(t))
		}
	}
	tabRow := lipgloss.JoinHorizontal(lipgloss.Top, tabViews...)

	backendStatus := m.getStatusDisplay(m.backend)
	frontendStatus := m.getStatusDisplay(m.frontend)

	stats := lipgloss.JoinVertical(lipgloss.Left,
		fmt.Sprintf("Backend:  %s", backendStatus),
		fmt.Sprintf("Frontend: %s", frontendStatus),
	)

	topRow := lipgloss.JoinHorizontal(lipgloss.Top,
		BoxStyle.Width(m.width/2-2).Render(stats),
		BoxStyle.Width(m.width/2-2).Render("Press [Tab] to switch views\nPress [s] to Start/Stop Service\nPress [q] to Quit"),
	)

	viewTitle := HeaderStyle.Render(fmt.Sprintf(" Logs: %s ", m.getCurrentService().Name))
	logs := LogBoxStyle.Width(m.width - 2).Render(m.viewport.View())

	return lipgloss.JoinVertical(lipgloss.Left,
		header,
		topRow,
		"",
		tabRow,
		viewTitle,
		logs,
	)
}

func (m *model) getStatusDisplay(s *Service) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	switch s.Status {
	case StatusRunning:
		return StatusStyleRunning.Render("● RUNNING")
	case StatusStarting:
		return StatusStyleRunning.Render("○ STARTING")
	case StatusError:
		return StatusStyleError.Render("✖ ERROR")
	default:
		return StatusStyleStopped.Render("○ STOPPED")
	}
}

func main() {
	p := tea.NewProgram(initialModel(), tea.WithAltScreen())
	if _, err := p.Run(); err != nil {
		fmt.Printf("Alas, there's been an error: %v", err)
	}
}

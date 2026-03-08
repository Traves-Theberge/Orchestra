package main

import "github.com/charmbracelet/lipgloss"

var (
	// Colors
	PrimaryColor   = lipgloss.Color("#7D56F4")
	SecondaryColor = lipgloss.Color("#FF79C6")
	AccentColor    = lipgloss.Color("#50FA7B")
	ErrorColor     = lipgloss.Color("#FF5555")
	BgColor        = lipgloss.Color("#282A36")
	FgColor        = lipgloss.Color("#F8F8F2")

	// Styles
	TitleStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(FgColor).
			Background(PrimaryColor).
			Padding(0, 1).
			MarginLeft(2)

	HeaderStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(SecondaryColor).
			Padding(0, 1)

	StatusStyleRunning = lipgloss.NewStyle().
				Foreground(AccentColor).
				Bold(true)

	StatusStyleStopped = lipgloss.NewStyle().
				Foreground(lipgloss.Color("#6272A4")).
				Bold(true)

	StatusStyleError = lipgloss.NewStyle().
				Foreground(ErrorColor).
				Bold(true)

	BoxStyle = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(PrimaryColor).
			Padding(1).
			MarginTop(1)

	LogBoxStyle = lipgloss.NewStyle().
			Border(lipgloss.NormalBorder()).
			BorderForeground(lipgloss.Color("#44475A")).
			Padding(0, 1)

	CommandStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#F1FA8C")).
			Italic(true)

	ActiveTabStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(FgColor).
			Background(lipgloss.Color("#44475A")).
			Padding(0, 2)

	InactiveTabStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#6272A4")).
			Padding(0, 2)
)

func GradientTitle(text string) string {
	style := lipgloss.NewStyle().Bold(true).Padding(0, 2)
	return style.Render(text)
}

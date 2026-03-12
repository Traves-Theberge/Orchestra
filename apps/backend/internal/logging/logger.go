package logging

import (
	"os"
	"time"

	"github.com/rs/zerolog"
)

func New() zerolog.Logger {
	consoleWriter := zerolog.ConsoleWriter{Out: os.Stdout, TimeFormat: time.RFC3339}
	
	logFile, err := os.OpenFile("/tmp/orchestrad.log", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return zerolog.New(consoleWriter).With().Timestamp().Str("app", "orchestra-backend").Logger()
	}

	multi := zerolog.MultiLevelWriter(consoleWriter, logFile)

	return zerolog.New(multi).
		With().
		Timestamp().
		Str("app", "orchestra-backend").
		Logger()
}

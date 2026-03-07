package logging

import (
	"os"
	"time"

	"github.com/rs/zerolog"
)

func New() zerolog.Logger {
	return zerolog.New(os.Stdout).
		With().
		Timestamp().
		Str("app", "orchestra-backend").
		Logger().
		Level(zerolog.InfoLevel).
		With().
		Logger().
		Output(zerolog.ConsoleWriter{Out: os.Stdout, TimeFormat: time.RFC3339})
}

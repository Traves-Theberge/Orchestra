package main

import (
	"log"

	"github.com/orchestra/orchestra/apps/backend/internal/app"
	"github.com/orchestra/orchestra/apps/backend/internal/logging"
)

func main() {
	logger := logging.New()
	if err := app.Run(logger); err != nil {
		log.Fatalf("orchestrad failed: %v", err)
	}
}

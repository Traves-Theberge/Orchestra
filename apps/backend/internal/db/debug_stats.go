package db

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
)

func DebugGlobalStats() {
	home, _ := os.UserHomeDir()
	dbPath := filepath.Join(home, ".orchestra", "workspaces", ".orchestra", "warehouse.db")
	
	warehouseDB, err := Connect(dbPath)
	if err != nil {
		log.Fatalf("connect: %v", err)
	}

	stats, err := warehouseDB.GetGlobalStats(context.Background())
	if err != nil {
		log.Fatalf("stats: %v", err)
	}

	out, _ := json.MarshalIndent(stats, "", "  ")
	fmt.Println(string(out))
}

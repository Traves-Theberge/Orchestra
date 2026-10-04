// ade-evidence checks a report against an independently supplied acceptance profile.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/testsupport/evidence"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "ADE evidence rejected:", err)
		os.Exit(1)
	}
}

func run() error {
	reportPath := flag.String("report", "", "report JSON path")
	profilePath := flag.String("profile", "", "independent acceptance profile JSON path")
	checkout := flag.String("checkout", "../..", "repository checkout root")
	schemaPath := flag.String("schema", "", "evidence schema path (default: checkout/packages/protocol/schemas/ade/evidence.v1.schema.json)")
	flag.Parse()
	if *reportPath == "" || *profilePath == "" {
		return fmt.Errorf("-report and -profile are required")
	}
	if *schemaPath == "" {
		*schemaPath = filepath.Join(*checkout, "packages", "protocol", "schemas", "ade", "evidence.v1.schema.json")
	}
	read := func(name string) ([]byte, error) {
		file, err := os.Open(name)
		if err != nil {
			return nil, err
		}
		defer file.Close()
		data, err := io.ReadAll(io.LimitReader(file, 8*1024*1024+1))
		if len(data) > 8*1024*1024 {
			return nil, fmt.Errorf("input exceeds 8 MiB")
		}
		return data, err
	}
	schema, err := read(*schemaPath)
	if err != nil {
		return err
	}
	data, err := read(*reportPath)
	if err != nil {
		return err
	}
	report, err := evidence.Decode(schema, data)
	if err != nil {
		return err
	}
	profileData, err := read(*profilePath)
	if err != nil {
		return err
	}
	var expected evidence.Expectations
	decoder := json.NewDecoder(bytes.NewReader(profileData))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&expected); err != nil {
		return fmt.Errorf("acceptance profile: %w", err)
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return fmt.Errorf("acceptance profile must contain one JSON object")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	actualSource, err := evidence.Fingerprint(ctx, *checkout)
	if err != nil {
		return err
	}
	if expected.Source != (evidence.Source{}) && expected.Source != actualSource {
		return fmt.Errorf("acceptance profile source differs from current checkout")
	}
	expected.Source, expected.Now = actualSource, time.Now().UTC()
	if err := evidence.Check(report, expected); err != nil {
		return err
	}
	if err := evidence.CheckArtifacts(filepath.Dir(*reportPath), report); err != nil {
		return err
	}
	fmt.Printf("ADE evidence passed for %d required scenarios (%s/%s, %s)\n", len(expected.Scenarios), expected.Environment.OS, expected.Environment.Arch, expected.Environment.Provider)
	return nil
}

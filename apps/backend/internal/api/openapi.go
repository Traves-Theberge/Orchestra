package api

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
)

func (s *Server) GetSwaggerUI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = fmt.Fprint(w, swaggerUIHTML)
}

const swaggerUIHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Orchestra API Docs</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
  <style>
    body { margin: 0; }
    .swagger-ui .topbar { background-color: #1a1a2e; }
    .swagger-ui .topbar .wrapper { padding: 8px 24px; }
    .swagger-ui .topbar-wrapper img { display: none; }
    .swagger-ui .topbar-wrapper::before {
      content: "Orchestra API";
      color: #fff;
      font-size: 18px;
      font-weight: 600;
      font-family: sans-serif;
    }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: "/api/v1/openapi.yaml",
      dom_id: "#swagger-ui",
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: "BaseLayout",
      deepLinking: true,
      displayOperationId: false,
      defaultModelsExpandDepth: 1,
      defaultModelExpandDepth: 1,
      docExpansion: "list",
      filter: true,
      showExtensions: false,
      tryItOutEnabled: true,
      persistAuthorization: true,
    });
  </script>
</body>
</html>`

func (s *Server) GetOpenAPIYAML(w http.ResponseWriter, r *http.Request) {
	specPath := resolveOpenAPISpecPath()
	content, err := os.ReadFile(specPath)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "openapi_not_found", "OpenAPI spec not found")
		return
	}

	w.Header().Set("Content-Type", "application/yaml; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(content)
}

func resolveOpenAPISpecPath() string {
	if _, err := os.Stat("../../docs/openapi.yaml"); err == nil {
		return filepath.Clean("../../docs/openapi.yaml")
	}
	return filepath.Clean("./docs/openapi.yaml")
}

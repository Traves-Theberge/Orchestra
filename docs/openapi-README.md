# OpenAPI Documentation

This repository includes an OpenAPI 3.1 specification for the backend API at:

- `docs/openapi.yaml`

The backend also serves it directly at runtime:

- `GET /api/v1/openapi.yaml`

## Quick Preview (Swagger Editor)

Option 1: Use the web editor

1. Open https://editor.swagger.io/
2. Replace the default content with `docs/openapi.yaml`

Option 2: Docker local preview

```bash
docker run --rm -p 8080:8080 -e SWAGGER_JSON=/spec/openapi.yaml -v "$PWD/docs:/spec" swaggerapi/swagger-ui
```

Then open: `http://127.0.0.1:8080`

## Redoc Local Preview

```bash
npx redoc-cli serve docs/openapi.yaml
```

## Validate the Spec

Basic YAML parse check:

```bash
python -c "import yaml; yaml.safe_load(open('docs/openapi.yaml')); print('ok')"
```

Optional OpenAPI lint (recommended):

```bash
npx @redocly/cli lint docs/openapi.yaml
```

## Notes

- The spec describes the current backend behavior, including mixed JSON/plain-text responses for some legacy handlers.
- Most `/api/v1/*` routes require bearer auth when `APIToken` is configured.
- Terminal websocket supports either bearer auth header or `token` query parameter.

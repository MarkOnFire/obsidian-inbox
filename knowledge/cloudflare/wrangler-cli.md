# Wrangler CLI

> Source: https://developers.cloudflare.com/workers/wrangler/

## Overview

"Wrangler, the Cloudflare Developer Platform command-line interface (CLI), allows you to manage Worker projects."

## Key Documentation Areas

### Installation & Updates
The documentation includes a dedicated guide for getting Wrangler up and running, covering installation procedures and upgrading to newer versions.

```bash
npm install wrangler --save-dev
```

### Configuration Management
Developers can customize their Worker projects through configuration files, which control both development and deployment settings across the Cloudflare Developer Platform ecosystem.

### Commands
The CLI provides commands for the complete Worker lifecycle:

- `wrangler init` - Create a new project
- `wrangler dev` - Run locally for development
- `wrangler deploy` - Deploy to production
- `wrangler tail` - Stream live logs

### Bindings & Integrations
Documentation covers binding configurations for services like R2 (object storage) and KV (key-value storage).

### Environment Management
Support for multiple environments enables distinct configurations for the same Worker application.

### Additional Resources
- **API**: Programmatic interfaces for integrating Wrangler with local workflows
- **Bundling**: Details on default code bundling behavior
- **Custom builds**: Instructions for customizing compilation before Wrangler processing
- **Migrations**: Version-specific upgrade guidance
- **System variables**: Environment variables that modify Wrangler behavior
- **Deprecations**: Breaking changes across versions

## wrangler.toml Example

```toml
name = "my-worker"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[vars]
MY_VAR = "my-value"

[[r2_buckets]]
binding = "MY_BUCKET"
bucket_name = "my-bucket-name"

[[kv_namespaces]]
binding = "MY_KV"
id = "abc123"
```

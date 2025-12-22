# R2 Workers API Reference

> Source: https://developers.cloudflare.com/r2/api/workers/workers-api-reference/

## Overview

"The in-Worker R2 API is accessed by binding an R2 bucket to a Worker." Workers can expose external access to buckets via routes or manipulate R2 objects internally.

## R2 Bucket Binding

Configure R2 bucket bindings in your Wrangler configuration file:

**wrangler.jsonc:**
```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "r2_buckets": [
    {
      "binding": "MY_BUCKET",
      "bucket_name": "<YOUR_BUCKET_NAME>"
    }
  ]
}
```

**wrangler.toml:**
```toml
[[r2_buckets]]
binding = 'MY_BUCKET'
bucket_name = '<YOUR_BUCKET_NAME>'
```

The binding becomes a runtime variable accessible within your Worker code.

## Core Bucket Methods

### `head(key: string): Promise<R2Object | null>`

Retrieves object metadata without the body. Returns `null` if the key doesn't exist.

### `get(key: string, options?: R2GetOptions): Promise<R2ObjectBody | R2Object | null>`

Fetches the complete object including metadata and body as a `ReadableStream`. Returns `null` if missing. Failed preconditions return `R2Object` with undefined body.

### `put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob, options?: R2PutOptions): Promise<R2Object | null>`

Stores data and metadata under the specified key. "R2 writes are strongly consistent. Once the Promise resolves, all subsequent read operations will see this key value pair globally." Failed preconditions return `null`.

### `delete(key: string | string[]): Promise<void>`

Removes objects and associated metadata. "R2 deletes are strongly consistent. Once the Promise resolves, all subsequent read operations will no longer see the provided key value pairs globally." Maximum 1000 keys per call.

### `list(options?: R2ListOptions): Promise<R2Objects>`

Returns lexicographically ordered objects. "Returns up to 1000 entries, but may return less in order to minimize memory pressure within the Worker." Use `truncated` property to determine pagination.

### `createMultipartUpload(key: string, options?: R2MultipartOptions): Promise<R2MultipartUpload>`

Initiates a multipart upload, accessible immediately via Workers or S3 APIs.

### `resumeMultipartUpload(key: string, uploadId: string): R2MultipartUpload`

Returns an object representing an existing multipart upload. "The resumeMultipartUpload operation does not perform any checks to ensure the validity of the uploadId."

## R2GetOptions

```typescript
interface R2GetOptions {
  onlyIf?: R2Conditional | Headers;
  range?: R2Range;
  ssecKey?: ArrayBuffer | string;
}
```

**Range Parameter Variations:**
- Offset with optional length
- Optional offset with length
- Suffix (bytes from end)

```typescript
interface R2Range {
  offset?: number;    // Inclusive start byte
  length?: number;    // Bytes to return
  suffix?: number;    // Bytes from end
}
```

## R2PutOptions

```typescript
interface R2PutOptions {
  onlyIf?: R2Conditional | Headers;
  httpMetadata?: R2HTTPMetadata | Headers;
  customMetadata?: Record<string, string>;
  md5?: ArrayBuffer | string;
  sha1?: ArrayBuffer | string;
  sha256?: ArrayBuffer | string;
  sha384?: ArrayBuffer | string;
  sha512?: ArrayBuffer | string;
  storageClass?: 'Standard' | 'InfrequentAccess';
  ssecKey?: ArrayBuffer | string;
}
```

Note: Only one hashing algorithm may be specified.

## R2ListOptions

```typescript
interface R2ListOptions {
  limit?: number;              // Default: 1000, max: 1000
  prefix?: string;
  cursor?: string;
  delimiter?: string;
  include?: Array<'httpMetadata' | 'customMetadata'>;
}
```

**Critical:** Use the `truncated` property to determine pagination, not object count comparisons.

## R2Object Definition

```typescript
interface R2Object {
  key: string;
  version: string;
  size: number;
  etag: string;
  httpEtag: string;
  uploaded: Date;
  httpMetadata: R2HTTPMetadata;
  customMetadata: Record<string, string>;
  range?: R2Range;
  checksums: R2Checksums;
  writeHttpMetadata(headers: Headers): void;
  storageClass: 'Standard' | 'InfrequentAccess';
  ssecKeyMd5?: string;
}
```

"Cloudflare recommends using the `httpEtag` field when returning an etag in a response header. This ensures the etag is quoted and conforms to RFC 9110."

## R2ObjectBody Definition

Combines `R2Object` metadata with body content:

```typescript
interface R2ObjectBody extends R2Object {
  body: ReadableStream;
  bodyUsed: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json<T>(): Promise<T>;
  blob(): Promise<Blob>;
}
```

## R2MultipartUpload Definition

```typescript
interface R2MultipartUpload {
  key: string;
  uploadId: string;
  uploadPart(
    partNumber: number,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob,
    options?: R2MultipartOptions
  ): Promise<R2UploadedPart>;
  abort(): Promise<void>;
  complete(uploadedParts: R2UploadedPart[]): Promise<R2Object>;
}
```

"Uncompleted multipart uploads will be automatically aborted after 7 days."

## R2MultipartOptions

```typescript
interface R2MultipartOptions {
  httpMetadata?: R2HTTPMetadata | Headers;
  customMetadata?: Record<string, string>;
  storageClass?: 'Standard' | 'InfrequentAccess';
  ssecKey?: ArrayBuffer | string;
}
```

## R2Objects (List Response)

```typescript
interface R2Objects {
  objects: R2Object[];
  truncated: boolean;
  cursor?: string;
  delimitedPrefixes: Array<string>;
}
```

## R2Conditional

```typescript
interface R2Conditional {
  etagMatches?: string;
  etagDoesNotMatch?: string;
  uploadedBefore?: Date;
  uploadedAfter?: Date;
}
```

Alternatively, pass conditional HTTP headers directly per MDN specifications.

## R2HTTPMetadata

```typescript
interface R2HTTPMetadata {
  contentType?: string;
  contentLanguage?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  cacheControl?: string;
  cacheExpiry?: Date;
}
```

## R2Checksums

```typescript
interface R2Checksums {
  md5?: ArrayBuffer;
  sha1?: ArrayBuffer;
  sha256?: ArrayBuffer;
  sha384?: ArrayBuffer;
  sha512?: ArrayBuffer;
}
```

MD5 is included by default for non-multipart objects.

## R2UploadedPart

```typescript
interface R2UploadedPart {
  partNumber: number;
  etag: string;
}
```

## Usage Example

```javascript
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const key = url.pathname.slice(1);

    switch (request.method) {
      case "PUT":
        await env.MY_BUCKET.put(key, request.body);
        return new Response(`Put ${key} successfully!`);

      default:
        return new Response(`${request.method} is not allowed.`, {
          status: 405,
          headers: { Allow: "PUT" },
        });
    }
  },
};
```

## Pagination Example

```javascript
const options = { limit: 500, include: ["customMetadata"] };
let listed = await env.MY_BUCKET.list(options);
let truncated = listed.truncated;
let cursor = truncated ? listed.cursor : undefined;

while (truncated) {
  const next = await env.MY_BUCKET.list({
    ...options,
    cursor: cursor,
  });
  listed.objects.push(...next.objects);
  truncated = next.truncated;
  cursor = next.cursor;
}
```

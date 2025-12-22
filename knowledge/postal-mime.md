# postal-mime Library

> Source: https://github.com/postalsys/postal-mime

## Overview

"**postal-mime** is an email parsing library that runs in browser environments (including Web Workers) and serverless functions." It processes RFC822 formatted emails into structured objects containing headers, recipients, and attachments.

## Installation

```bash
npm install postal-mime
```

## Key Features

- Works across browsers, Web Workers, Node.js, and serverless environments
- Full TypeScript support with comprehensive type definitions
- Zero external dependencies
- RFC 2822/5322 compliant parsing
- Handles complex MIME structures including nested parts
- Built-in security limits against deeply nested messages and oversized headers

## Usage by Environment

### Browser/Web Workers

```javascript
import PostalMime from './node_modules/postal-mime/src/postal-mime.js';

const email = await PostalMime.parse(`Subject: My awesome email
Content-Type: text/html; charset=utf-8

<p>Hello world</p>`);

console.log(email.subject);
```

### Node.js

```javascript
import PostalMime from 'postal-mime';
import util from 'node:util';

const email = await PostalMime.parse(rawEmailString);
console.log(util.inspect(email, false, 22, true));
```

### CommonJS

```javascript
const PostalMime = require('postal-mime');
const { addressParser, decodeWords } = require('postal-mime');

const email = await PostalMime.parse(rawEmailString);
```

### Cloudflare Email Workers

```javascript
import PostalMime from 'postal-mime';

export default {
    async email(message, env, ctx) {
        const email = await PostalMime.parse(message.raw);

        console.log('Subject:', email.subject);
        console.log('HTML:', email.html);
        console.log('Text:', email.text);
    }
};
```

## API Reference

### PostalMime.parse()

```javascript
PostalMime.parse(email, options) -> Promise<Email>
```

**Parameters:**
- `email`: RFC822 formatted string, ArrayBuffer, Uint8Array, Blob, Buffer, or ReadableStream
- `options`: Configuration object (optional)

**Configuration Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `rfc822Attachments` | boolean | `false` | Treat message/rfc822 parts without Content-Disposition as attachments |
| `forceRfc822Attachments` | boolean | `false` | Treat all message/rfc822 parts as attachments |
| `attachmentEncoding` | string | `"arraybuffer"` | Encoding format: `"base64"`, `"utf8"`, or `"arraybuffer"` |
| `maxNestingDepth` | number | `256` | Maximum MIME part nesting depth |
| `maxHeadersSize` | number | `2097152` | Maximum total header size in bytes (2MB default) |

### Parsed Email Object Structure

The returned `Email` object contains:

```javascript
{
  headers: [
    { key: string, value: string },
    // ... more headers
  ],

  // Address fields
  from: Address | null,
  sender: Address | null,
  to: Address[],
  cc: Address[],
  bcc: Address[],
  replyTo: Address[],

  // Simple string fields
  deliveredTo: string | null,
  returnPath: string | null,

  // Message metadata
  subject: string,
  messageId: string | null,
  inReplyTo: string | null,
  references: string | null,
  date: string,  // ISO 8601 format

  // Content
  html: string,
  text: string,

  // Attachments
  attachments: Attachment[]
}
```

### Address Type

Addresses can represent individual mailboxes or groups:

```javascript
// Mailbox
{
  name: string,
  address: string
}

// Group
{
  name: string,
  group: Mailbox[]
}
```

### Attachment Type

```javascript
{
  filename: string | null,
  mimeType: string,
  disposition: "attachment" | "inline" | null,
  related: boolean,          // true for inline images
  contentId: string,         // optional
  content: ArrayBuffer | string,  // based on attachmentEncoding
  encoding: "base64" | "utf8"     // optional
}
```

## Utility Functions

### addressParser()

Parse email address headers:

```javascript
import { addressParser } from 'postal-mime';

addressParser(addressStr, opts) -> Address[]
```

**Options:**
- `flatten` (boolean, default: `false`): Flatten nested address groups

**Example:**
```javascript
const addresses = addressParser('Name <email@example.com>');
// [{ name: 'Name', address: 'email@example.com' }]
```

### decodeWords()

Decode MIME encoded-words:

```javascript
import { decodeWords } from 'postal-mime';

decodeWords(encodedStr) -> string
```

**Example:**
```javascript
const decoded = decodeWords('Hello, =?utf-8?B?44Ko44Od44K544Kr44O844OJ?=');
// "Hello, エポスカード"
```

## TypeScript Support

Import types from the main package:

```typescript
import PostalMime from 'postal-mime';
import type {
    Email,
    Address,
    Mailbox,
    Header,
    Attachment,
    PostalMimeOptions,
    AddressParserOptions,
    RawEmail
} from 'postal-mime';

const email: Email = await PostalMime.parse(rawEmail, options);
```

**Type Narrowing:**

```typescript
function isMailbox(addr: Address): addr is Mailbox {
    return !('group' in addr) || addr.group === undefined;
}

if (email.from && isMailbox(email.from)) {
    console.log(email.from.address);
}
```

## Security Features

The library includes built-in protections:
- `maxNestingDepth` prevents deeply nested MIME structures
- `maxHeadersSize` prevents oversized headers that could exhaust memory

## License

Licensed under the MIT No Attribution license.

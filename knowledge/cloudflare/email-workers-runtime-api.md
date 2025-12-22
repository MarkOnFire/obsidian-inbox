# Cloudflare Email Workers Runtime API

> Source: https://developers.cloudflare.com/email-routing/email-workers/runtime-api/

## Overview

The `EmailEvent` enables programmatic email handling through Workers, allowing you to "reject, forward, or drop emails according to the logic you construct in your Worker."

## ES Modules Syntax

```js
export default {
  async email(message, env, ctx) {
    await message.forward("<YOUR_EMAIL>");
  },
};
```

**Parameters:**
- `message` - ForwardableEmailMessage object
- `env` - Bindings object (KV namespaces, Durable Objects)
- `ctx` - Context object containing `waitUntil` function

## Service Worker Syntax (Deprecated)

```js
addEventListener("email", async (event) => {
  await event.message.forward("<YOUR_EMAIL>");
});
```

## ForwardableEmailMessage Interface

```ts
interface ForwardableEmailMessage<Body = unknown> {
  readonly from: string;
  readonly to: string;
  readonly headers: Headers;
  readonly raw: ReadableStream;
  readonly rawSize: number;

  public constructor(from: string, to: string, raw: ReadableStream | string);

  setReject(reason: string): void;
  forward(rcptTo: string, headers?: Headers): Promise<void>;
  reply(message: EmailMessage): Promise<void>;
}
```

**Properties:**
- `from` - Envelope From attribute
- `to` - Envelope To attribute
- `headers` - Headers object per MDN standards
- `raw` - ReadableStream of message content
- `rawSize` - Message content size

**Methods:**
- `setReject(reason)` - Returns permanent SMTP error to client
- `forward(rcptTo, headers?)` - Sends to verified address (X-* headers permitted)
- `reply(message)` - Responds to sender with EmailMessage

## EmailMessage Interface

```ts
interface EmailMessage {
    readonly from: string;
    readonly to: string;
}
```

Represents an email sendable from a Worker with Envelope From and To attributes.

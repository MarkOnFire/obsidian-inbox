# Cloudflare Email Workers

> Source: https://developers.cloudflare.com/email-routing/email-workers/

## Overview

Email Workers enable you to "leverage the power of Cloudflare Workers to implement any logic you need to process your emails and create complex rules."

## Implementation Steps

The process involves three key stages:

1. **Create the Email Worker**
2. **Add processing logic** (such as allowlists or blocklists)
3. **Bind the Worker to a route** (the email address that triggers the Worker)

## Code Example

Here's a sample allowlist implementation:

```js
export default {
  async email(message, env, ctx) {
    const allowList = ["friend@example.com", "coworker@example.com"];
    if (allowList.indexOf(message.from) == -1) {
      message.setReject("Address not allowed");
    } else {
      await message.forward("inbox@corp");
    }
  },
};
```

## EmailMessage Interface

The `message` object provides:
- **`from`** property - sender's email address
- **`setReject()`** method - rejects the email with a specified message
- **`forward()`** method - forwards the email to one or more verified addresses

## Use Cases

Pre-built templates support:
- Blocklist functionality
- Allowlist functionality
- Slack notifications

## Additional Resources

The documentation references guides for:
- Runtime API details
- Local development setup
- System limits and constraints

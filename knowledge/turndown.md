# Turndown - HTML to Markdown Converter

> Source: https://github.com/mixmark-io/turndown

## Overview

Turndown is a JavaScript library that converts HTML into Markdown format. The project was formerly known as `to-markdown`.

## Installation

### npm
```bash
npm install turndown
```

### Browser
```html
<script src="https://unpkg.com/turndown/dist/turndown.js"></script>
```

For RequireJS compatibility, UMD versions are available at `lib/turndown.umd.js` (Node.js) and `lib/turndown.browser.umd.js` (browser).

## Basic Usage

### Node.js
```javascript
var TurndownService = require('turndown')
var turndownService = new TurndownService()
var markdown = turndownService.turndown('<h1>Hello world!</h1>')
```

### DOM Nodes
The library accepts element nodes, document nodes, or document fragments as input:
```javascript
var markdown = turndownService.turndown(document.getElementById('content'))
```

## Configuration Options

Options are passed during instantiation:
```javascript
var turndownService = new TurndownService({ option: 'value' })
```

| Option | Valid Values | Default |
|--------|--------------|---------|
| `headingStyle` | `setext` or `atx` | `setext` |
| `hr` | Any thematic break | `* * *` |
| `bulletListMarker` | `-`, `+`, or `*` | `*` |
| `codeBlockStyle` | `indented` or `fenced` | `indented` |
| `fence` | `` ``` `` or `~~~` | `` ``` `` |
| `emDelimiter` | `_` or `*` | `_` |
| `strongDelimiter` | `**` or `__` | `**` |
| `linkStyle` | `inlined` or `referenced` | `inlined` |
| `linkReferenceStyle` | `full`, `collapsed`, or `shortcut` | `full` |
| `preformattedCode` | `false` or `true` | `false` |

### Advanced Options

| Option | Type | Purpose |
|--------|------|---------|
| `blankReplacement` | Function | Customizes blank element handling |
| `keepReplacement` | Function | Customizes kept element rendering |
| `defaultReplacement` | Function | Customizes unrecognized element handling |

## Methods

### addRule(key, rule)

Extends conversion behavior with custom rules. A rule contains a `filter` and `replacement` property:

```javascript
turndownService.addRule('strikethrough', {
  filter: ['del', 's', 'strike'],
  replacement: function (content) {
    return '~' + content + '~'
  }
})
```

Returns the service instance for method chaining.

### keep(filter)

Preserves specified elements as HTML instead of converting them:

```javascript
turndownService.keep(['del', 'ins'])
turndownService.turndown('<p>Hello <del>world</del></p>')
// Result: 'Hello <del>world</del>'
```

Can be called multiple times. Keep filters are overridden by standard CommonMark rules and added rules.

### remove(filter)

Removes specified elements entirely from output:

```javascript
turndownService.remove('del')
turndownService.turndown('<p>Hello <del>world</del></p>')
// Result: 'Hello '
```

Remove filters are overridden by keep filters, standard rules, and added rules.

### use(plugin|array)

Applies one or more plugins to extend functionality:

```javascript
var turndownPluginGfm = require('turndown-plugin-gfm')
var gfm = turndownPluginGfm.gfm

turndownService.use(gfm)
// Or use specific plugins
turndownService.use([gfm.tables, gfm.strikethrough])
```

## Rules System

### Filter Types

Filters identify which elements to convert. Three formats are supported:

**String:** Selects a single tag
```javascript
filter: 'p'
```

**Array:** Selects multiple tags
```javascript
filter: ['em', 'i']
```

**Function:** Custom selection logic
```javascript
filter: function (node, options) {
  return options.linkStyle === 'inlined' &&
         node.nodeName === 'A' &&
         node.getAttribute('href')
}
```

Tag names must be lowercase. Functions receive the node and current options.

### Replacement Function

Determines how matched elements convert to Markdown:

```javascript
replacement: function (content, node, options) {
  return options.emDelimiter + content + options.emDelimiter
}
```

The function receives:
- `content`: The element's processed content
- `node`: The DOM node being converted
- `options`: Current configuration settings

### Special Rules

**Blank Rule:** Handles elements containing only whitespace. Overrides all other rules. Configure via `blankReplacement` option.

**Keep Rules:** Render selected elements as HTML. Configure via `keepReplacement` option. Block elements are separated by blank lines.

**Remove Rules:** Eliminate specified elements entirely.

**Default Rule:** Handles unmatched elements. Configure via `defaultReplacement` option. Outputs text content, with blank line separation for block elements.

### Rule Precedence

Rules are evaluated in this order:

1. Blank rule
2. Added rules
3. CommonMark rules
4. Keep rules
5. Remove rules
6. Default rule

The first matching rule is applied.

## Plugins

The plugin API enables developers to bundle multiple extensions. A plugin is a function receiving the `TurndownService` instance:

```javascript
function myPlugin(turndownService) {
  turndownService.addRule('custom', {
    filter: 'custom-tag',
    replacement: function(content) {
      return content
    }
  })
}

turndownService.use(myPlugin)
```

## Markdown Character Escaping

Turndown automatically escapes Markdown special characters using backslashes to prevent misinterpretation. For example, `<h1>1. Item</h1>` converts to `1\. Item` to prevent list parsing.

### Custom Escaping

Override the default escape behavior:

```javascript
TurndownService.prototype.escape = function(text) {
  // Custom escaping logic
  return text
}
```

**Note:** Text within code elements bypasses the escape function.

## License

Turndown is released under the MIT License.

# Remotely Save Obsidian Plugin

> Source: https://github.com/remotely-save/remotely-save

## Overview

Remotely Save is an unofficial synchronization plugin for Obsidian that enables vault syncing across devices using various cloud storage providers.

> "This is yet another unofficial sync plugin for Obsidian"

**Critical Warning:** Always backup your vault before using this plugin.

## Core Features

- **Multi-device sync:** Synchronize vaults across desktop and mobile devices
- **End-to-end encryption:** Optional password-based encryption before cloud upload
- **Scheduled automation:** Configure automatic sync intervals or sync-on-save behavior
- **Conflict management:** Detect and resolve file conflicts with smart resolution
- **Flexible filtering:** Skip large files and specific paths using regex patterns
- **Minimal footprint:** Non-intrusive design that doesn't alter vault structure

## Supported Cloud Services

### Free Tier Services

**S3-Compatible Storage:**
- Amazon S3
- Cloudflare R2
- Backblaze B2
- MinIO
- Others supporting S3 API

**OAuth Services:**
- Dropbox
- OneDrive (App Folder only)
- WebDAV (NextCloud, Synology, InfiniCloud, etc.)
- Webdis

### PRO Features (Paid)

- OneDrive Full Access
- Google Drive
- Box
- pCloud
- Yandex Disk
- Koofr
- Azure Blob Storage
- Advanced Smart Conflict handling

## S3/Cloudflare R2 Configuration

### Setup Requirements

1. Obtain cloud credentials:
   - Endpoint and region
   - Access Key ID
   - Secret Access Key
   - Bucket name

2. For AWS S3: Create appropriate IAM policies and users

3. For older Obsidian versions: Configure CORS settings

### Configuration Steps

1. Install and enable the plugin
2. Enter credentials in plugin settings
3. Set optional prefix for multi-vault bucket support
4. Enable encryption by setting a password (optional)
5. Click the sync icon or configure automatic scheduling

**Important:** Vault names must match across devices for seamless synchronization.

## Sync Behavior

### Manual Sync
- Click the ribbon icon to sync on-demand
- Icon displays as loading animation during active sync

### Automatic Sync
- Configure interval-based syncing (every N minutes)
- Errors fail silently without notifications
- Only functions when Obsidian is open

### Sync-on-Save
- Automatically sync after file modifications
- Also fails silently on errors

## File Handling

### Hidden Files (Not Synced by Default)

Files or folders starting with:
- `.` (dot) - including `.obsidian` config folder
- `_` (underscore)

### Configuration Options

- Enable syncing for underscore-prefixed files
- Sync `.obsidian` config folder (experimental)
- Sync `bookmarks.json` specifically

## Conflict Resolution

### Basic Version
- Detect conflicts automatically
- Choose to keep: newer version or larger file

### PRO Features
- **Merge option** for small markdown files
- **Duplicate option** for large files or non-markdown content

## Limitations

- Cloud services incur operational costs (API calls, storage, transfers)
- Browser environment constraints affect functionality
- Mobile Obsidian API struggles with files >= 50 MB
- Vault credentials stored in `data.json` require protection
- Auto-sync unavailable when Obsidian runs in background

## Security Considerations

> "You should protect your data.json file...The file contains sensitive information"

- Never share `data.json` file
- Avoid version control without `.gitignore`
- Plugin creates default `.gitignore` automatically
- Vault names are not encrypted regardless of password setting

## Performance & Debugging

- First sync requires patience; subsequent syncs are incremental
- Enable profiler to identify performance bottlenecks
- Check debug documentation for troubleshooting
- Monitor vault name consistency across devices

## Installation Options

1. Official Obsidian plugin directory
2. BRAT plugin manager (`remotely-save/remotely-save`)
3. Manual asset installation from GitHub releases
4. Development builds from CI artifacts

## Additional Features

- Import/export non-OAuth settings via QR code
- Support for multiple vaults in single bucket
- Configurable file size limits
- Regex-based path filtering

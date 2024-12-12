# Emails Forwarder
A small program that forwards emails from mailboxes to a Discord channel.

## Features

- Forwards emails to a specified Discord channel using webhooks.
- Supports both received and sent emails.

## Usage

1. Create an `env-config.json` file in the root directory of the project.
2. Add your IMAP account details and webhook URLs to the `env-config.json` file. The file should look like this:

```json
{
  "instances": [
    {
      "mailAccount": {
        "host": "imap.example.com",
        "port": 993,
        "secure": true,
        "auth": {
          "user": "your-email@example.com",
          "pass": "your-email-password"
        }
      },
      "webhooks": [
        {
          "url": "https://discord.com/api/webhooks/your-webhook-id/your-webhook-token",
          "threadId": "optional-thread-id"
        }
      ]
    }
  ]
}
```
3. We recommend running the program using Docker. Here is an example `docker-compose.yml`
```yaml
name: "emails-forwarder"

services:
  emails-forwarder:
    image: ghcr.io/devsjony/emails-forwarder:master
    restart: unless-stopped
    volumes:
      - type: bind
        source: ./env-config.json
        target: /app/env-config.json
```

You can also run this manually using node:

### For development:
```sh
pnpm run start:dev
```

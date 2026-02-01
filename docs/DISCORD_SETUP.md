# 🎮 Discord Auth Setup Guide (Termux/Cloudflare)

To enable "Login with Discord" on your server (even in Termux), you need to configure a Discord Application.

## 1. Create a Discord App
1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Click **"New Application"**.
3. Name it (e.g., "MintDEV GameHub").
4. Copy the **Application ID**. This is your `DISCORD_CLIENT_ID`.

## 2. Get Credentials
1. In the sidebar, click **"OAuth2"**.
2. Click **"General"**.
3. Under "Client Information", click **"Reset Secret"** to get your `DISCORD_CLIENT_SECRET`. **Copy it immediately.**

## 3. Configure Redirects via Cloudflare (Termux)
Since Termux usually has a dynamic IP or uses a Tunnel, you have two options:

### Option A: Local Network (WiFi)
If you only play on your local WiFi:
1. Find your Termux setup's IP (run `ifconfig` inside Termux). Let's say it's `192.168.1.50`.
2. In Discord Developer Portal -> **OAuth2** -> **Redirects**:
   - Add: `http://192.168.1.50:8000/api/auth/discord/callback`
   - Add: `http://localhost:8000/api/auth/discord/callback` (for testing on device)

### Option B: Cloudflare Tunnel (Public Access)
If you are using the `run_tunnel.sh` script to get a public URL (e.g., `https://funny-name.trycloudflare.com`):
1. Start your tunnel (`./src/scripts/bash/run_tunnel.sh`).
2. Copy the URL it gives you.
3. In Discord Developer Portal -> **OAuth2** -> **Redirects**:
   - Add: `https://your-tunnel-url.trycloudflare.com/api/auth/discord/callback`

## 4. Update Your Server Config
1. Open the `.env` file in your `MintDEV` folder.
2. Update the values:
   ```env
   DISCORD_CLIENT_ID=your_id_here
   DISCORD_CLIENT_SECRET=your_secret_here
   DISCORD_REDIRECT_URI=http://localhost:8000/api/auth/discord/callback
   ```
   *(Note: Change `DISCORD_REDIRECT_URI` to match the one you added in Step 3 that you are currently using to access the site).*

## 5. Restart Server
After creating the `.env` file, restart the server:
- Stop it (`CTRL+C`).
- Run `npm start`.

✅ **Done!** Users can now log in.

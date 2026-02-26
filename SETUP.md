# Wovly Setup Guide

This guide will help you set up Google OAuth credentials for Gmail, Calendar, and Drive integrations.

## Prerequisites

- A Google account
- Node.js and npm installed

## 1. Create Google OAuth Credentials

### Step 1: Go to Google Cloud Console

1. Visit [Google Cloud Console](https://console.cloud.google.com)
2. Sign in with your Google account

### Step 2: Create a New Project

1. Click the project dropdown at the top
2. Click **"New Project"**
3. Enter project name: `Wovly Desktop App`
4. Click **"Create"**

### Step 3: Enable Required APIs

1. Go to **"APIs & Services"** → **"Library"**
2. Search for and enable these APIs:
   - **Gmail API** - For reading and sending emails
   - **Google Calendar API** - For calendar integration
   - **Google Drive API** - For file attachments

### Step 4: Create OAuth Credentials

1. Go to **"APIs & Services"** → **"Credentials"**
2. Click **"Create Credentials"** → **"OAuth client ID"**
3. If prompted, configure the **OAuth consent screen**:
   - User Type: **External** (or Internal if you have Google Workspace)
   - App name: `Wovly`
   - User support email: Your email
   - Developer contact: Your email
   - Click **"Save and Continue"** through the rest

4. Back in Create OAuth client ID:
   - Application type: **Desktop app**
   - Name: `Wovly Desktop`
   - Click **"Create"**

5. You'll see a dialog with your credentials:
   - **Client ID** - Copy this
   - **Client Secret** - Copy this (may be empty for Desktop app type)

### Step 5: Configure Your App

1. In the Wovly project root, create a `.env` file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and add your credentials:
   ```bash
   GOOGLE_CLIENT_ID=123456789-abc123.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-YourSecretHere
   ```

3. **Important:** Never commit the `.env` file to git (it's already in `.gitignore`)

## 2. Alternative: Web Application Type (Advanced)

If you prefer using "Web application" type instead of "Desktop app":

1. Follow steps 1-3 above
2. In Step 4, choose **Web application** instead of Desktop app
3. Add Authorized redirect URI: `http://localhost:18923/oauth/callback`
4. This will give you both Client ID and Client Secret
5. Add both to your `.env` file as shown above

**Note:** Desktop app type is recommended as it's more secure (no client secret needed in many flows).

## 3. First-Time Setup

After configuring your `.env` file:

1. Install dependencies:
   ```bash
   npm install
   ```

2. Build the app:
   ```bash
   npm run build
   ```

3. Start the app:
   ```bash
   npm start
   ```

4. In the app, go to **Settings** → **Integrations** → **Google Workspace**
5. Click **"Connect"** to authorize the app with your Google account

## 4. Troubleshooting

### "OAuth not configured" error

- Make sure your `.env` file exists in the project root
- Verify the `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set correctly
- Restart the app after changing `.env`

### "Redirect URI mismatch" error

- If using Web application type, ensure you added `http://localhost:18923/oauth/callback` as an authorized redirect URI in Google Cloud Console
- Try Desktop app type instead, which doesn't require redirect URIs

### Can't access Gmail/Calendar

- Make sure you enabled the Gmail API and Google Calendar API in Google Cloud Console
- Check that your OAuth consent screen includes the necessary scopes
- Try disconnecting and reconnecting the integration in Settings

## 5. Production Deployment

When distributing your app to users:

### Option A: Share Your Credentials (Recommended for open source)

1. Use the same OAuth client ID for all users
2. Keep the client secret in your build environment
3. Inject credentials at build time (not in source code)
4. Users authenticate with their Google account using your OAuth app

### Option B: Let Users Create Their Own (Advanced)

1. Provide instructions for users to create their own OAuth credentials
2. Users add their own `.env` file
3. More setup friction but more control

**For most use cases, Option A is recommended** - you create one set of OAuth credentials, and all users authenticate through your OAuth app.

## 6. Security Best Practices

- ✅ **DO:** Keep `.env` in `.gitignore`
- ✅ **DO:** Use environment variables for credentials
- ✅ **DO:** Use Desktop app type when possible (no client secret needed)
- ❌ **DON'T:** Commit credentials to git
- ❌ **DON'T:** Share your `.env` file publicly
- ❌ **DON'T:** Hardcode credentials in source files

## Need Help?

- [Google OAuth Documentation](https://developers.google.com/identity/protocols/oauth2)
- [Gmail API Quickstart](https://developers.google.com/gmail/api/quickstart/nodejs)
- [Wovly Issues](https://github.com/wovly/wovly/issues)

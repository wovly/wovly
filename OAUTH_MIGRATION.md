# OAuth Migration Guide: Web App → Desktop App

## Why Migrate?

Wovly is a desktop application, not a web service. Using Google's **Desktop App** OAuth type is:
- ✅ **More secure** - No client secret to leak
- ✅ **Simpler** - Uses PKCE flow designed for native apps
- ✅ **Google-approved** - Follows OAuth 2.0 for Native Apps spec
- ✅ **Safe to bundle** - Client ID can be publicly visible in code

## Current Setup (Web Application)

Your current credentials suggest a **Web Application** OAuth type:
- Has a client secret: `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`
- Requires redirect URI: `http://localhost:18923/oauth/callback`
- ⚠️ Client secret should NOT be committed to git

## Migration Steps

### Step 1: Create Desktop App OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Select your project (or create new: "Wovly Desktop")
3. Go to **APIs & Services** → **Credentials**
4. Click **Create Credentials** → **OAuth client ID**
5. Application type: **Desktop app** ✅
6. Name: `Wovly Desktop App`
7. Click **Create**

**Result:**
- You'll get a **Client ID** (safe to bundle publicly)
- **No client secret** (or an optional one that's not actually secret)

### Step 2: Update Your Code

**Update `apps/desktop/src/config/google-oauth.ts`:**

```typescript
export function getGoogleOAuthConfig(): GoogleOAuthConfig {
  return {
    // Desktop app Client ID (safe to commit publicly)
    clientId:
      process.env.GOOGLE_CLIENT_ID ||
      'YOUR-NEW-DESKTOP-CLIENT-ID.apps.googleusercontent.com',

    // Desktop apps don't need a real client secret
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',

    // Desktop apps can use loopback redirect
    redirectUri: 'http://localhost:18923/oauth/callback',

    scopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ],

    // Desktop apps use authorization_code with PKCE
    flowType: 'authorization_code',
  };
}
```

### Step 3: Enable PKCE (Code Verifier)

The authorization code flow should use PKCE for desktop apps. Update your OAuth implementation:

```typescript
// Generate PKCE code verifier and challenge
function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64url');

  return { verifier, challenge };
}

// When starting OAuth flow:
const { verifier, challenge } = generatePKCE();

const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
  `client_id=${clientId}&` +
  `redirect_uri=${redirectUri}&` +
  `response_type=code&` +
  `scope=${scopes.join(' ')}&` +
  `code_challenge=${challenge}&` +
  `code_challenge_method=S256&` +  // PKCE!
  `access_type=offline`;

// When exchanging code for token:
const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id: clientId,
    code: authCode,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: verifier,  // PKCE!
    // NO client_secret needed!
  }),
});
```

### Step 4: Update .env File

**`.env`:**
```bash
# Desktop App Client ID (safe to bundle)
GOOGLE_CLIENT_ID=YOUR-NEW-DESKTOP-CLIENT-ID.apps.googleusercontent.com

# Optional: Can be empty for desktop apps
GOOGLE_CLIENT_SECRET=
```

### Step 5: Commit Client ID Publicly ✅

After migration, it's **safe** to commit the desktop app client ID:

```typescript
// ✅ SAFE - Desktop app OAuth
clientId: 'ABC123-xyz.apps.googleusercontent.com',
clientSecret: '',  // Empty or not used
```

Desktop app credentials can be public because:
1. Google expects them to be extractable from desktop apps
2. PKCE prevents authorization code interception
3. Users still must explicitly authorize access
4. Tokens are scoped to the user who authorized

## Option 2: Keep Web App (Not Recommended)

If you must use Web Application type:

**DO:**
- ✅ Keep credentials in `.env` only
- ✅ Never commit `.env` to git
- ✅ Use environment variables in production
- ✅ Implement server-side token exchange
- ✅ Add API quota monitoring

**DON'T:**
- ❌ Don't commit client secret to git (already done - needs fixing)
- ❌ Don't bundle credentials in the app
- ❌ Don't expose credentials to frontend

**Risk Mitigation:**
```bash
# If you've already committed the secret to git:
1. Immediately revoke the credentials in Google Cloud Console
2. Create new credentials
3. Remove from git history:
   git filter-branch --force --index-filter \
     "git rm --cached --ignore-unmatch apps/desktop/src/config/google-oauth.ts" \
     --prune-empty --tag-name-filter cat -- --all
4. Force push (⚠️ breaks others' clones)
```

## Comparison Table

| Feature | Desktop App | Web App |
|---------|-------------|---------|
| **Client Secret** | Optional, not truly secret | Required, must stay private |
| **Security Model** | PKCE (code verifier) | Client secret |
| **Can be public** | ✅ Yes | ❌ No |
| **User flow** | Simple, direct | Requires server |
| **Google's recommendation** | ✅ For desktop apps | For web servers only |
| **Risk if exposed** | Low - users still authorize | High - tokens could be stolen |

## How VS Code Does It

Check out [VS Code's source code](https://github.com/microsoft/vscode/blob/main/extensions/microsoft-authentication/src/AADHelper.ts):

```typescript
// Publicly visible in GitHub repo
private static CLIENTID = '1046904370350-r3k...apps.googleusercontent.com';
// No client secret needed!
```

They commit the client ID directly to their public GitHub repo because it's a Desktop App type.

## Recommendation

**Migrate to Desktop App type** - it's:
1. More secure (no secret to leak)
2. Simpler (fewer credentials to manage)
3. Google-approved (follows OAuth 2.0 for Native Apps spec)
4. Industry standard (VS Code, Slack, etc. all do this)

After migration, you can safely bundle the client ID in your app and even commit it to git.

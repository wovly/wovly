# User Guide: Adding Custom Websites

## Quick Start (3 Minutes)

### What You Can Add

Any website with:
- Login page (username + password)
- Messages or communications section
- No public API

**Examples**:
- Daycare portals (Brightwheel, Procare, Kangarootime)
- School systems (PowerSchool, Canvas, Google Classroom)
- Tax sites (TurboTax, H&R Block portals)
- Healthcare portals (patient messaging)
- HOA/Community sites
- Property management portals

---

## Step-by-Step Guide

### 1. Open Integrations
1. Click "Integrations" in the sidebar
2. Scroll to "Add Custom Website" card
3. Click "Setup"

### 2. Enter Basic Info
Fill in:
- **Website Name**: "Brightwheel" (whatever you want to call it)
- **Website URL**: `https://schools.mybrightwheel.com`
- **Username**: Your login email
- **Password**: Your login password
- **Site Type** (optional): Helps AI understand the page

Click **"Next: AI Analysis"**

### 3. Wait for AI Analysis (5 seconds)
The system will:
- Load the website
- Detect login elements automatically
- Find the login page if you're not on it already
- Suggest the best way to extract messages

You'll see a progress indicator showing what's happening.

### 4. Complete Setup Wizard
A browser window will open with instructions:

**Your task**:
1. **Navigate to messages** (click through menus like you normally would)
   - Example: Click "Messaging" → Click "Inbox"
2. **Click "Done"** when you see your messages list
3. **Click the messages area** to select where messages appear
4. **Click "Finish"**

The system records every click automatically - you don't need to do anything special!

### 5. Test Configuration
The system will:
- Test the full flow (login → navigate → extract)
- Show you how many messages it found
- Display sample messages

If successful, you'll see:
```
✓ Test Successful!
Found 5 messages

Sample Messages:
┌─────────────────────────────────┐
│ Teacher Sarah                   │
│ Field trip forms due Friday     │
└─────────────────────────────────┘
```

### 6. Save & Done!
Click **"Save & Enable"**

Your integration is now active and will check hourly for new messages!

---

## Managing Your Integrations

### View All Integrations
1. Go to Integrations tab
2. Find your custom website cards
3. Or click **"Manage"** to see all in one list

### Disable/Enable
Click the **"Disable"** or **"Enable"** button on any integration card

### Test Manually
Click **"Test Now"** to check for messages immediately (instead of waiting for hourly check)

### View Status
Each integration shows its status:
- **Active** (green): Working normally
- **Error** (red): Last check failed
- **Paused** (orange): Auto-paused after 3 failures
- **Disabled** (gray): You disabled it

### Unpause After Errors
If an integration auto-pauses (after 3 failures):
1. Click **"Manage"**
2. Find the paused integration
3. Click **"Unpause"**

This resets the failure counter and tries again.

### Delete Integration
1. Click **"Manage"**
2. Find the integration you want to remove
3. Click **"Delete"**
4. Click **"Confirm"**

---

## Using with AI Chat

Once configured, you can ask the AI assistant about your messages:

### Example Queries
```
"What did the daycare say today?"
"Search Brightwheel for field trip"
"Show me messages from TurboTax this week"
"Any new messages from school?"
"What did my custom websites say yesterday?"
```

The AI will automatically:
- Search your custom website messages
- Show you relevant content
- Summarize multiple messages
- Answer questions about the content

---

## Troubleshooting

### Setup Wizard Can't Find Login Page
**Possible causes**:
- URL isn't the login page
- Site requires clicking a login button first

**Solution**:
- Try entering the direct login URL
- Or let AI find it (it will try clicking login buttons)

### Test Fails: "Login timeout"
**Possible causes**:
- Wrong username/password
- Site has CAPTCHA (not supported)
- Site requires 2FA (not supported yet)

**Solution**:
- Double-check credentials
- Try a different website

### Test Fails: "No messages found"
**Possible causes**:
- Messages area not selected correctly
- Site doesn't have messages right now

**Solution**:
- Re-run setup wizard
- Make sure to click the area where messages actually appear
- Check the site in a normal browser - are there messages there?

### Integration Keeps Failing
**Possible causes**:
- Website changed its layout
- Session expired and auto-login failed
- Website is having issues

**Solution**:
1. Click **"Test Now"** to see specific error
2. If "page structure changed" → Re-run setup wizard
3. If "session expired" → Will auto-recover next check
4. If persistent → Delete and re-add integration

### Messages Not Appearing in Chat
**Check**:
1. Integration is **enabled** (not disabled or paused)
2. Last check was successful (check status)
3. Try asking AI: "List my custom web sites" to verify it's configured

**Solution**:
- Wait for next hourly check
- Or click **"Test Now"** to trigger immediately
- Messages saved locally, so query works even if site is down

---

## Tips & Best Practices

### Choosing Good Websites
✅ **Works well**:
- Login-protected message boards
- Parent portals with notifications
- Patient portals with messages
- Community forums with inbox

❌ **Won't work**:
- Sites with CAPTCHA on login
- Sites requiring 2FA every time
- Sites with no messages section
- Public websites (no login needed - just bookmark those!)

### Naming Your Integrations
Use clear, descriptive names:
- ✅ "Brightwheel Daycare"
- ✅ "TurboTax 2025"
- ✅ "HOA Community Portal"
- ❌ "Website 1"
- ❌ "Test"

This helps when asking AI questions later.

### When to Use Custom Integrations
**Use custom websites for**:
- Important communications you want in one place
- Sites you check regularly
- Messages you want AI to know about

**Don't use for**:
- Sites you rarely visit
- Sites with public RSS feeds (use RSS reader instead)
- Sites that already have integrations (use Gmail, Slack, etc.)

### Privacy & Security
- Credentials are **encrypted** and stored **locally on your device**
- Never sent to external servers
- Only used to log in to YOUR accounts
- Saved sessions reduce how often we log in
- Can delete integration anytime (removes all data)

---

## Advanced: Understanding What Happens

### Hourly Checks
Every hour, the system:
1. Loads each enabled integration
2. Uses saved session (or logs in if expired)
3. Navigates through your recorded steps
4. Extracts messages from the selected area
5. Saves to local storage (JSON + markdown)
6. Updates AI context

You don't see this happening - it's automatic.

### Message Storage
Messages are saved to:
```
~/.wovly-assistant/users/{your-username}/web-integrations/messages/
```

Two formats:
- **JSON**: Structured data for AI queries
- **Markdown**: Human-readable summaries

Kept for **90 days**, then auto-deleted.

### Cache Fallback
If a website is down or unreachable:
- System uses **cached messages** from storage
- AI still works with historical data
- You see a note: "Using cached data from Feb 15"

No data loss even when sites have problems!

### AI Tools
The AI assistant has 4 tools for custom websites:
1. **search_custom_web_messages** - Search all messages
2. **get_recent_custom_web_messages** - Get recent messages
3. **get_custom_web_messages_by_date** - Get messages from specific date
4. **list_custom_web_sites** - Show all configured sites

You don't call these directly - just ask natural questions!

---

## FAQ

### Q: How often are messages checked?
**A**: Every hour, along with Gmail, Slack, and iMessage.

### Q: Can I check more frequently?
**A**: Use the "Test Now" button to check immediately anytime.

### Q: What if my password changes?
**A**: Edit the integration and update your password in the wizard.

### Q: Does this work for 2FA sites?
**A**: Not yet. We're working on 2FA support. For now, use sites without 2FA or sites that remember your device.

### Q: Can I add multiple sites?
**A**: Yes! Add as many as you want. Each gets its own card and independent checking.

### Q: What if a site changes its layout?
**A**: The integration will fail and auto-pause. Re-run the setup wizard to update selectors.

### Q: Is my data private?
**A**: Yes! Everything is stored locally on your device. We never send your credentials or messages to our servers.

### Q: Can I export my messages?
**A**: Currently they're saved as JSON and markdown in your user data directory. Export feature coming soon!

### Q: What happens if I delete an integration?
**A**: All data is deleted (config, sessions, messages). Can't be undone.

### Q: Can this work with mobile apps?
**A**: No, only websites with web login. Mobile apps don't expose their interfaces.

---

## Examples

### Example 1: Brightwheel Daycare

**Setup**:
- URL: `https://schools.mybrightwheel.com`
- Username: `parent@example.com`
- Type: "Daycare"

**Navigation recorded**:
1. Click "Messaging" in top nav
2. Click "All Conversations"

**Messages area**: The conversation list div

**Works perfectly!**  Checks hourly for new messages from teachers.

### Example 2: TurboTax

**Setup**:
- URL: `https://myturbotax.intuit.com`
- Username: Email
- Type: "Tax"

**Navigation recorded**:
1. Click "Messages" in sidebar

**Messages area**: The messages inbox

**Use case**: Get notified about tax filing updates, document requests.

### Example 3: PowerSchool

**Setup**:
- URL: `https://powerschool.myschool.org/public/`
- Username: Parent portal login
- Type: "School"

**Navigation recorded**:
1. Click "Messages" tab
2. Click "Inbox"

**Messages area**: Message list container

**Use case**: Track school announcements, teacher communications.

---

## Support

If you encounter issues:
1. Check the error message shown
2. Try the troubleshooting steps above
3. Re-run the setup wizard if structure changed
4. Delete and re-add if still not working

**Remember**: The system is designed to be self-service. If something breaks, the setup wizard can usually fix it!

---

## Conclusion

Adding custom websites is **easy, fast, and requires no technical knowledge**. The entire process takes about **3 minutes** per site.

Once configured:
- ✅ Automatic hourly checking
- ✅ Messages saved locally
- ✅ Query via AI chat
- ✅ Cache fallback if site down
- ✅ Auto-recovery from errors

Enjoy having all your important communications in one place! 🎉

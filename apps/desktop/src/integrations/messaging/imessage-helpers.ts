/**
 * iMessage Integration Helper Functions
 *
 * Contact lookup and name resolution utilities for iMessage integration.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface Contact {
  name: string;
  phones: Array<{
    label: string;
    number: string;
  }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Contact Name Cache
// ─────────────────────────────────────────────────────────────────────────────

const contactNameCache = new Map<string, string | null>();

export function clearContactNameCache(): void {
  contactNameCache.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// Contact Lookup Functions
// ─────────────────────────────────────────────────────────────────────────────

export async function lookupContactName(identifier: string): Promise<string | null> {
  if (!identifier) return null;

  // Check cache first
  if (contactNameCache.has(identifier)) {
    return contactNameCache.get(identifier) || null;
  }

  // Clean the identifier (remove non-numeric chars for phone matching)
  const cleanPhone = identifier.replace(/\D/g, '');
  const lastDigits = cleanPhone.slice(-10); // Last 10 digits for matching

  // AppleScript to search contacts
  const appleScript = `
    tell application "Contacts"
      set matchedName to ""
      repeat with aPerson in people
        repeat with aPhone in phones of aPerson
          set phoneDigits to do shell script "echo " & quoted form of (value of aPhone) & " | tr -cd '0-9'"
          if phoneDigits ends with "${lastDigits}" then
            set matchedName to (first name of aPerson & " " & last name of aPerson)
            exit repeat
          end if
        end repeat
        if matchedName is not "" then exit repeat
        repeat with anEmail in emails of aPerson
          if value of anEmail is "${identifier}" then
            set matchedName to (first name of aPerson & " " & last name of aPerson)
            exit repeat
          end if
        end repeat
        if matchedName is not "" then exit repeat
      end repeat
      return matchedName
    end tell
  `;

  try {
    const { stdout } = await execAsync(`osascript -e '${appleScript.replace(/'/g, "'\\''")}'`, {
      timeout: 5000,
    });
    const name = stdout?.trim() || null;
    if (name && name !== ' ' && name.length > 1) {
      contactNameCache.set(identifier, name);
      return name;
    } else {
      contactNameCache.set(identifier, null);
      return null;
    }
  } catch (error) {
    contactNameCache.set(identifier, null);
    return null;
  }
}

export async function lookupContactNames(
  identifiers: string[]
): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>();
  const uniqueIds = Array.from(new Set(identifiers.filter(Boolean)));

  await Promise.all(
    uniqueIds.map(async (id) => {
      const name = await lookupContactName(id);
      results.set(id, name);
    })
  );

  return results;
}

export async function findContactsByName(name: string): Promise<Contact[]> {
  return new Promise((resolve) => {
    const searchName = name.toLowerCase().replace(/'/g, "''");
    console.log(`[iMessage] Looking up contact: ${name}`);

    // Simpler AppleScript - searches by name property directly
    const appleScript = `
      set output to ""
      tell application "Contacts"
        try
          set foundPeople to (every person whose name contains "${searchName}")
          repeat with aPerson in foundPeople
            set personName to name of aPerson
            set phoneInfo to ""
            repeat with aPhone in phones of aPerson
              try
                set phoneInfo to phoneInfo & (label of aPhone) & ":" & (value of aPhone) & ","
              end try
            end repeat
            if phoneInfo is not "" then
              set output to output & personName & "|" & phoneInfo & ";"
            end if
          end repeat
        end try
      end tell
      return output
    `;

    exec(
      `osascript -e '${appleScript.replace(/'/g, "'\\''")}'`,
      { timeout: 10000 },
      (error, stdout, stderr) => {
        if (error) {
          const errorMsg = error.message || stderr || '';
          console.error(`[iMessage] Contact lookup error: ${errorMsg}`);

          if (
            errorMsg.includes('not allowed') ||
            errorMsg.includes('permission') ||
            errorMsg.includes('(-1743)')
          ) {
            console.error(
              `[iMessage] Permission denied. Grant Automation permission for Contacts in System Settings > Privacy & Security > Automation`
            );
          }

          resolve([]);
          return;
        }

        const output = stdout.trim();
        console.log(`[iMessage] Contact lookup raw output: ${output}`);

        if (!output || output === '' || output === '{}') {
          console.log(`[iMessage] No contacts found for "${name}"`);
          resolve([]);
          return;
        }

        // Parse the output - format: "Name|label:number,label:number,;Name2|label:number,;"
        const contacts: Contact[] = [];
        const entries = output.split(';').filter((e) => e.trim());

        for (const entry of entries) {
          const parts = entry.trim().split('|');
          if (parts.length >= 2) {
            const contactName = parts[0].trim();
            const phonesStr = parts.slice(1).join('|');

            // Extract phone numbers - format: "label:number,"
            const phones: Array<{ label: string; number: string }> = [];
            const phoneMatches = phonesStr.match(/([^:,]+):([^,]+)/g) || [];
            for (const pm of phoneMatches) {
              const colonIdx = pm.indexOf(':');
              if (colonIdx > -1) {
                const label = pm.substring(0, colonIdx).trim();
                const number = pm.substring(colonIdx + 1).trim();
                if (number) {
                  phones.push({
                    label: label || 'phone',
                    number: number,
                  });
                }
              }
            }

            if (phones.length > 0) {
              contacts.push({ name: contactName, phones });
            }
          }
        }

        console.log(`[iMessage] Found ${contacts.length} contacts:`, JSON.stringify(contacts));
        resolve(contacts);
      }
    );
  });
}

export async function findPhoneByName(name: string): Promise<string[]> {
  const contacts = await findContactsByName(name);
  if (contacts.length > 0) {
    return contacts.flatMap((c) => c.phones.map((p) => p.number));
  }
  return [];
}

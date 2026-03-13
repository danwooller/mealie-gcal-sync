const { google } = require('googleapis');
const path = require('path');
const dns = require('node:dns');

// Force IPv4 to prevent ENETUNREACH on IPv6
dns.setDefaultResultOrder('ipv4first');

const CALENDAR_ID = 'd399fd6624bd772ba4cefdec02b2c9f9ac2bdc97db3bd556c072c8e57b0ad8b7@group.calendar.google.com';
const KEYFILEPATH = path.join(__dirname, 'credentials.json');
const auth = new google.auth.GoogleAuth({ keyFile: KEYFILEPATH, scopes: ['https://www.googleapis.com/auth/calendar'] });
const calendar = google.calendar({ version: 'v3', auth });

const OLD_PATH = "/recipe/";
const NEW_PATH = "/g/home/r/";

async function fixPaths() {
    console.log("🔍 Scanning calendar for incorrect Mealie paths (IPv4 Preferred)...");
    let pageToken = null;
    let count = 0;

    do {
        try {
            const res = await calendar.events.list({ 
                calendarId: CALENDAR_ID, 
                pageToken: pageToken,
                singleEvents: true 
            });
            
            for (const event of res.data.items || []) {
                if (event.description && event.description.includes(OLD_PATH)) {
                    try {
                        const newDesc = event.description.split(OLD_PATH).join(NEW_PATH);
                        console.log(`✏️ Updating path for: ${event.summary}`);
                        
                        await calendar.events.patch({
                            calendarId: CALENDAR_ID,
                            eventId: event.id,
                            resource: { description: newDesc }
                        });
                        
                        count++;
                        await new Promise(r => setTimeout(r, 300)); // Slightly longer delay
                    } catch (patchErr) {
                        console.error(`⚠️ Failed to patch ${event.summary}: ${patchErr.message}`);
                        await new Promise(r => setTimeout(r, 1000)); // Wait a full second on error
                    }
                }
            }
            pageToken = res.data.nextPageToken;
        } catch (listErr) {
            console.error(`❌ Error fetching list: ${listErr.message}`);
            break;
        }
    } while (pageToken);

    console.log(`✨ Finished. Corrected ${count} event paths.`);
}

fixPaths().catch(console.error);

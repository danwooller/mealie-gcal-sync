const { google } = require('googleapis');
const path = require('path');

const CALENDAR_ID = 'd399fd6624bd772ba4cefdec02b2c9f9ac2bdc97db3bd556c072c8e57b0ad8b7@group.calendar.google.com';
const KEYFILEPATH = path.join(__dirname, 'credentials.json');
const auth = new google.auth.GoogleAuth({ keyFile: KEYFILEPATH, scopes: ['https://www.googleapis.com/auth/calendar'] });
const calendar = google.calendar({ version: 'v3', auth });

//const OLD_URL_BASE = "http://127.0.0.1:9925";
//const NEW_URL_BASE = "https://mealie.wooller.com";
const OLD_URL_BASE = "https://mealie.wooller.com/recipe/";
const NEW_URL_BASE = "https://mealie.wooller.com/g/home/r/";

async function fixLinks() {
    console.log("🔍 Scanning ALL calendar events...");
    let pageToken = null;
    let count = 0;

    do {
        const res = await calendar.events.list({ 
            calendarId: CALENDAR_ID, 
            pageToken: pageToken,
            singleEvents: true 
        });
        
        for (const event of res.data.items || []) {
            if (event.description && event.description.includes(OLD_URL_BASE)) {
                // Use a global replace to catch any occurrence
                const newDesc = event.description.split(OLD_URL_BASE).join(NEW_URL_BASE);
                console.log(`✏️ Updating: ${event.summary}`);
                await calendar.events.patch({
                    calendarId: CALENDAR_ID,
                    eventId: event.id,
                    resource: { description: newDesc }
                });
                count++;
            }
        }
        pageToken = res.data.nextPageToken;
    } while (pageToken);

    console.log(`✨ Finished. Updated ${count} events.`);
}

fixLinks()

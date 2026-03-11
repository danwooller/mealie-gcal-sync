const { google } = require('googleapis');
const path = require('path');

const CALENDAR_ID = 'd399fd6624bd772ba4cefdec02b2c9f9ac2bdc97db3bd556c072c8e57b0ad8b7@group.calendar.google.com';
const KEYFILEPATH = path.join(__dirname, 'credentials.json');
const auth = new google.auth.GoogleAuth({ keyFile: KEYFILEPATH, scopes: ['https://www.googleapis.com/auth/calendar'] });
const calendar = google.calendar({ version: 'v3', auth });

const OLD_URL = "http://127.0.0.1:9925";
const NEW_URL = "https://mealie.wooller.com";

async function fixLinks() {
    console.log("🔍 Scanning calendar for old links...");
    const res = await calendar.events.list({ calendarId: CALENDAR_ID });
    
    for (const event of res.data.items || []) {
        if (event.description && event.description.includes(OLD_URL)) {
            const newDesc = event.description.replace(OLD_URL, NEW_URL);
            console.log(`✏️ Updating: ${event.summary}`);
            await calendar.events.patch({
                calendarId: CALENDAR_ID,
                eventId: event.id,
                resource: { description: newDesc }
            });
        }
    }
    console.log("✨ All links updated.");
}

fixLinks();

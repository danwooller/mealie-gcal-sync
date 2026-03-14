// Finds every calendar entry titled "Unnamed Meal" and permanently delete them from your Google Calendar.
// The script asks Google for a list of up to 2,500 events from your specific "Meal Plan" calendar.
// It uses the q: 'Unnamed Meal' parameter, which acts like a search bar to narrow down the results immediately.

const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

const KEYFILEPATH = path.join(__dirname, 'credentials.json');
const CALENDAR_ID = 'd399fd6624bd772ba4cefdec02b2c9f9ac2bdc97db3bd556c072c8e57b0ad8b7@group.calendar.google.com';

const auth = new google.auth.GoogleAuth({
    keyFile: KEYFILEPATH,
    scopes: ['https://www.googleapis.com/auth/calendar']
});

async function nukeJunk() {
    const calendar = google.calendar({ version: 'v3', auth });
    
    console.log("🔍 Searching for 'Unnamed Meal' entries...");
    
    const res = await calendar.events.list({
        calendarId: CALENDAR_ID,
        q: 'Unnamed Meal', // Search query
        singleEvents: true,
        maxResults: 2500,
    });

    const events = res.data.items || [];
    const junkEvents = events.filter(e => e.summary === 'Unnamed Meal');

    console.log(`🧨 Found ${junkEvents.length} junk entries. Commencing deletion...`);

    for (const event of junkEvents) {
        try {
            await calendar.events.delete({
                calendarId: CALENDAR_ID,
                eventId: event.id,
            });
            console.log(`🗑️ Deleted: ${event.start.date || event.start.dateTime}`);
            // Small delay to respect Google's rate limits
            await new Promise(r => setTimeout(r, 200)); 
        } catch (err) {
            console.error(`❌ Failed to delete ${event.id}:`, err.message);
        }
    }
    console.log("✅ Cleanup complete!");
}

nukeJunk();

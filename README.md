# Friction Tab

A cheeky new-tab override that makes you declare your intent, stores it locally, and pings you in five minutes to keep you honest.

## Features
- Overrides the new tab page with a playful, demanding prompt.
- Saves your stated mission with a timestamp to `chrome.storage.local`.
- Arms a 5-minute alarm and fires a notification reminding you of your pledge.
- Buttons on the notification let you acknowledge or admit drift.

## Setup (Chrome)
1. Visit `chrome://extensions/` and enable **Developer mode**.
2. Click **Load unpacked** and select this `friction-tab` folder.
3. Open a new tab: declare your mission, hit **Lock it in**, and allow notifications when prompted.

## Files
- manifest.json — MV3 manifest with new-tab override, alarms, notifications, and storage permissions.
- newtab.html / styles.css / newtab.js — Funky UI and intent-capture logic.
- background.js — Service worker that listens for the alarm and fires the reminder notification.

## Notes
- Reminder is hard-coded to 5 minutes after submission.
- Intent data stays local (uses `chrome.storage.local`).
- If notifications are blocked, the UI will nudge you to enable them.

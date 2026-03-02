# Friction Tab

A cheeky new-tab override that makes you declare your intent, stores it locally, and nudges you to stick with one mission at a time.

## Features
- Overrides the new tab page with a playful, demanding prompt.
- Enforces a single in-progress mission; new entries are blocked until you finish or clear the current one.
- Logs every declared mission with timestamps and status badges; newest items render first.
- Lets you mark missions complete and wipe the slate with a "Clear all" control.
- Automatically prunes completed missions older than two days.
- Arms a reminder alarm for the active mission; follow-up clicks can extend the interval (more time if focused, shorter if drifting) or mark complete.
- Buttons on reminder notifications let you confirm completion or admit drift.

## Setup (Chrome)
1. Visit `chrome://extensions/` and enable **Developer mode**.
2. Click **Load unpacked** and select this `friction-tab` folder.
3. Open a new tab: declare your mission, hit **Lock it in**, and allow notifications when prompted.

## Files
- manifest.json — MV3 manifest with new-tab override, alarms, notifications, and storage permissions.
- newtab.html / styles.css / newtab.js — UI, single-mission guard, task log, reminder scheduling, and notification permission handling.
- background.js — Service worker that targets the active mission, sends reminders, and extends or clears alarms based on user responses.

## Notes
- Initial reminder timing is controlled by the `BASE_REMINDER_MINUTES` constant in newtab.js; follow-ups can stretch or shrink via background.js depending on user responses.
- Intent data stays local (uses `chrome.storage.local`).
- Completed tasks older than two days are auto-removed on load.
- If notifications are blocked, the UI will prompt to enable them.

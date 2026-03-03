# Friction Tab

A cheeky new-tab override that makes you declare your intent, stores it locally, and nudges you to stick with one mission at a time. Because multitasking is a myth.

## Features
- New tab is replaced with a focused prompt that only allows one in-progress mission; new entries are blocked until the user finishes or clears the current one.
- Latest pledge card shows the newest mission with a right-aligned "Mark complete" action when it is active; the backlog list hides entirely when there are no older items.
- Missions are timestamped, sorted newest-first, and completed items are automatically pruned after two days to keep storage tidy.
- Completion paths everywhere: inline buttons, modal prompt on tab open when an active mission exists, and notification actions.
- Reminders arm automatically for the active mission; notification buttons either extend the interval (gentler if focused, tighter if drifting) or mark the task as complete.
- All data stays local via `chrome.storage.local` through small helpers (`storageGet`/`storageSet`) to keep the service worker and UI consistent.

## Setup (Chrome)
1. Visit `chrome://extensions/` and enable **Developer mode**.
2. Click **Load unpacked** and select this `friction-tab` folder.
3. Open a new tab: declare the mission, hit **Lock it in**, and allow notifications when prompted.

## Files
- manifest.json — MV3 manifest with new-tab override, alarms, notifications, and storage permissions.
- newtab.html / styles.css / newtab.js — UI, single-mission guard, task log, reminder scheduling, and notification permission handling.
- background.js — Service worker that targets the active mission, sends reminders, and extends or clears alarms based on user responses.

## Notes
- Initial reminder timing comes from `BASE_REMINDER_MINUTES` in newtab.js. Follow-ups reuse the stored interval and scale by 3× when the user reports focus or 1.5× when the user drifts.
- The backlog list omits the newest mission (shown in the header card); if nothing else exists the list is hidden altogether.
- Modal appears on tab open when an active mission exists; dismissing it on task creation suppresses the immediate prompt for that load.
- All task and reminder state is stored locally; helpers in utilities.js wrap `chrome.storage.local` for both UI and background.
- If notifications are blocked, the new tab page will prompt the user to enable them before accepting a mission.

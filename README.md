# Friction Tab

A cheeky new-tab override that makes you declare your intent, stores it locally, and nudges you to stick with one mission at a time. Because multitasking is a myth.

## Features
- New tab is replaced with a focused prompt that only allows one in-progress mission; new entries are blocked until the user finishes or clears the current one.
- Mission input is capped at 70 characters to keep pledges short and actionable.
- Latest pledge card shows the newest mission with a right-aligned "Mark complete" action when it is active; the backlog list hides entirely when there are no older items.
- Missions are timestamped, sorted newest-first, and completed items are automatically pruned after two days to keep storage tidy.
- Completion paths everywhere: inline buttons, modal prompt on tab open when an active mission exists, and notification actions.
- Initial reminder timing is configurable directly in the UI (default 5 minutes, allowed range 1-10) via a small bottom-page setting with edit/save controls.
- Reminders arm automatically for the active mission; notification buttons either extend the interval (gentler if focused, tighter if drifting) or mark the task as complete.
- All data stays local via `chrome.storage.local` through small helpers (`storageGet`/`storageSet`) to keep the service worker and UI consistent.

## Local Setup (Chrome)
1. Visit `chrome://extensions/` and enable **Developer mode**.
2. Click **Load unpacked** and select this `friction-tab` folder.
3. Open a new tab: declare the mission, hit **Lock it in**, and allow notifications when prompted.

## Files
- **manifest.json** — MV3 manifest defining the extension with new-tab override, alarm scheduling, notification permissions, and local storage access.
- **newtab.html** — UI layer for the single-mission prompt and task backlog display.
- **styles.css** — Styling for the new-tab interface.
- **newtab.js** — Handles reminder interval configuration and notification permission requests.
- **background.js** — Service worker managing the active mission, scheduling reminders via alarms, and updating task state based on user notification responses.

## Notes
- Initial reminder timing comes from the global `INITIAL_REMINDER_MINUTES` setting (`initialReminderMinutes` in storage), defaulting to 5 and constrained to whole numbers from 1 to 10.
- Follow-ups reuse the current task interval and scale by 3× when the user reports focus or 2× when the user drifts.
- The backlog list omits the newest mission (shown in the header card); if nothing else exists the list is hidden altogether.
- Modal appears on tab open when an active mission exists; dismissing it on task creation suppresses the immediate prompt for that load.
- All task and reminder state is stored locally; helpers in utilities.js wrap `chrome.storage.local` for both UI and background.
- Background validation guards malformed storage values and resets invalid reminder setting/task shapes to safe defaults.
- If notifications are blocked, the new tab page will prompt the user to enable them before accepting a mission.

## License

This project is licensed under the **MIT License**.

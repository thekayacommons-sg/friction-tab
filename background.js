import { getTaskStatus, hasActiveTask, storageGet, storageSet, VALID_REMINDER_ID, isValidTask, getHttpHost } from "./utilities.js";

const REMINDER_ALARM = "friction-tab-reminder";
const INITIAL_REMINDER_MINUTES = 5;
const MIN_REMINDER_MINUTES = 1;
const MAX_REMINDER_MINUTES = 10;
const INITIAL_REMINDER_MINUTES_KEY = "initialReminderMinutes";
const SITE_CHANGE_NAG_ENABLED_KEY = "siteChangeNagEnabled";
const ICON_PATH = "icons/icon128.png"; // Notifications require PNG
const TASKS_KEY = "tasks";
const REMINDER_KEY = "reminderTaskId";
const SITE_CHANGE_NAG_NOTIFICATION_ID = "site-change-nag";
const SITE_CHANGE_NAG_COOLDOWN_MS = 15000;
const SITE_CHANGE_NAG_LAST_AT_KEY = "siteChangeNagLastAt";

const lastCommittedHostByTab = new Map();

// All alarms are cleared on extension install to prevent orphaned alarms from previous versions
chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.alarms.clearAll();
  } catch (error) {
    console.error("Failed to clear alarms on install", error);
  }
});

// Validate all storage writes to ensure data integrity. If any value is malformed, reset it to a safe default.
// In particular: validate tasks list data shape on every storage write; reset to defaults if corrupted
chrome.storage.local.onChanged.addListener(async (changes) => {
  const corrections = {};

  if (REMINDER_KEY in changes) {
    const val = changes[REMINDER_KEY].newValue;
    if (val !== null && (typeof val !== "string" || !VALID_REMINDER_ID.test(val))) {
      corrections[REMINDER_KEY] = null;
    }
  }

  if (INITIAL_REMINDER_MINUTES_KEY in changes) {
    const val = changes[INITIAL_REMINDER_MINUTES_KEY].newValue;
    const parsed = Number(val);
    if (!Number.isInteger(parsed) || parsed < MIN_REMINDER_MINUTES || parsed > MAX_REMINDER_MINUTES) {
      corrections[INITIAL_REMINDER_MINUTES_KEY] = INITIAL_REMINDER_MINUTES;
    }
  }

  if (SITE_CHANGE_NAG_ENABLED_KEY in changes) {
    const val = changes[SITE_CHANGE_NAG_ENABLED_KEY].newValue;
    if (typeof val !== "boolean") {
      corrections[SITE_CHANGE_NAG_ENABLED_KEY] = false;
    }
  }

  if (SITE_CHANGE_NAG_LAST_AT_KEY in changes) {
    const val = Number(changes[SITE_CHANGE_NAG_LAST_AT_KEY].newValue);
    if (!Number.isFinite(val) || val < 0) {
      corrections[SITE_CHANGE_NAG_LAST_AT_KEY] = 0;
    }
  }

  // If tasks array is malformed or contains invalid entries, reset to empty array. Also enforce only 1 in-progress task at a time.
  if (TASKS_KEY in changes) {
    const val = changes[TASKS_KEY].newValue;
    if (!Array.isArray(val) || !val.every(isValidTask)) {
      corrections[TASKS_KEY] = [];
    } else {
      const inProgressCount = val.filter(task => getTaskStatus(task) === "in-progress").length;
      if (inProgressCount > 1) {
        corrections[TASKS_KEY] = [];
      }
    }
  }

  if (Object.keys(corrections).length) {
    try {
      await storageSet(corrections);
    } catch (error) {
      console.error("Failed to apply storage corrections", error);
    }
  }
});

/*
 * Whenever ANY alarm goes off, the extension checks if it is its reminder alarm. If so, it searches
 * for the task details by using the task ID stored under reminderTaskId, and shows a notification
 * to check on the user's focus on the task.
 */
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== REMINDER_ALARM) return;

  try {
    const data = await storageGet({ [TASKS_KEY]: [], [REMINDER_KEY]: null });
    const tasks = Array.isArray(data[TASKS_KEY]) ? data[TASKS_KEY] : [];
    const reminderTaskId = data[REMINDER_KEY];

    const entry = findReminderTarget(tasks, reminderTaskId);
    if (!entry) return;

    const notificationId = `reminder-${entry.id}`;
    await chrome.notifications.create(notificationId, {
      type: "basic",
      iconUrl: ICON_PATH,
      title: "Still on that mission?",
      message: `You promised to work on: ${entry.task}`,
      priority: 2,
      requireInteraction: true,
      silent: true,
      buttons: [
        { title: "Yes, still at it" },
        { title: "No, I drifted..." },
      ]
    });
  } catch (error) {
    console.error("Failed during reminder alarm handling", error);
  }
});

chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
  try {
    // Check if this is the initial reminder notification by looking for the unique prefix in the notification ID
    if (notificationId.startsWith("reminder-")) {

      // Remove the prefix to get the original task ID for follow-up actions
      const taskId = notificationId.replace("reminder-", "");
      await chrome.notifications.clear(notificationId);

      /*
       * If user clicks "Yes, still at it", extension shows a follow-up notification to confirm
       * if they have completed the task or not. If "No, I drifted..." is selected, 
       * extension simply encourages them to get back on track.
       */
      if (buttonIndex === 0) {
        const completionId = `completion-${taskId}`;
        await chrome.notifications.create(completionId, {
          type: "basic",
          iconUrl: ICON_PATH,
          title: "Are you done by any chance?",
          message: "If yes, let's get it off the list.",
          requireInteraction: true,
          silent: true,
          buttons: [
            { title: "Yes, all settled" },
            { title: "No, still working on it" },
          ]
        });
      } else {
        await extendTaskReminder(taskId, "drifted");
      }

      return;
    }

    /* Completion notification dialog response handler:
     * If user confirms completion, task is marked as completed and removed from active reminders. 
     * If not, reminder is extended with a more aggressive interval to encourage completion.
     */
    if (notificationId.startsWith("completion-")) {
      
      const taskId = notificationId.replace("completion-", "");
      await chrome.notifications.clear(notificationId);

      if (buttonIndex === 0) {
        await markTaskComplete(taskId);
      } else if (buttonIndex === 1) {
        await extendTaskReminder(taskId, "focused");
      }
    }
  } catch (error) {
    console.error("Failed handling notification button click", error);
  }
});

// If the user clicks on the notification itself (instead of the buttons), the notification is simply cleared and reminder extended
chrome.notifications.onClicked.addListener(async (notificationId) => {
  try {
    await chrome.notifications.clear(notificationId);
    // Clicking close on site change nag does not do anything
    // Button exists solely to ensure it gets triggered and to draw attention to it since it won't disappear until interacted with
    if (notificationId === SITE_CHANGE_NAG_NOTIFICATION_ID) {
      return;
    }
    const taskId = notificationId.substring(notificationId.indexOf("-") + 1);
    await extendTaskReminder(taskId, "focused");
  } catch (error) {
    console.error("Failed handling notification click", error);
  }
});

chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return;

  const nextHost = getHttpHost(details.url);
  if (!nextHost) return;

  const previousHost = lastCommittedHostByTab.get(details.tabId);
  lastCommittedHostByTab.set(details.tabId, nextHost);
  if (previousHost === nextHost) return;

  try {
    const data = await storageGet({
      [TASKS_KEY]: [],
      [SITE_CHANGE_NAG_ENABLED_KEY]: false,
      [SITE_CHANGE_NAG_LAST_AT_KEY]: 0,
    });
    if (data[SITE_CHANGE_NAG_ENABLED_KEY] !== true) return;

    // const tasks = Array.isArray(data[TASKS_KEY]) ? data[TASKS_KEY] : [];
    // If active task exists, do not bother the user with nags about switching sites
    if (hasActiveTask(data[TASKS_KEY])) return;

    const now = Date.now();
    const lastSiteChangeNagAt = Number(data[SITE_CHANGE_NAG_LAST_AT_KEY]) || 0;
    if (now - lastSiteChangeNagAt < SITE_CHANGE_NAG_COOLDOWN_MS) return;

    await chrome.notifications.create(SITE_CHANGE_NAG_NOTIFICATION_ID, {
      type: "basic",
      iconUrl: ICON_PATH,
      title: "No mission detected",
      message: "You just switched sites without an active mission. Declare one before you wander.",
      priority: 1,
      requireInteraction: true,
      silent: true,
    });
    await storageSet({ [SITE_CHANGE_NAG_LAST_AT_KEY]: now });
  } catch (error) {
    console.error("Failed during site-change nag handling", error);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  lastCommittedHostByTab.delete(tabId);
});

function findReminderTarget(tasks, reminderTaskId) {
  if (reminderTaskId) {
    const match = tasks.find((task) => task.id === reminderTaskId && getTaskStatus(task) === "in-progress");
    if (match) return match;
  }

  return tasks.find((task) => getTaskStatus(task) === "in-progress");
}

function getDelayMinutes(intervalMs) {
  return Math.max(0.25, intervalMs / 60000);
}

async function getInitialReminderMs() {
  try {
    const data = await storageGet({ [INITIAL_REMINDER_MINUTES_KEY]: INITIAL_REMINDER_MINUTES });
    const parsed = Number(data[INITIAL_REMINDER_MINUTES_KEY]);
    if (!Number.isInteger(parsed) || parsed < MIN_REMINDER_MINUTES || parsed > MAX_REMINDER_MINUTES) {
      return INITIAL_REMINDER_MINUTES * 60 * 1000;
    }
    return parsed * 60 * 1000;
  } catch (error) {
    console.error("Failed to load initial reminder minutes in background", error);
    return INITIAL_REMINDER_MINUTES * 60 * 1000;
  }
}

async function markTaskComplete(taskId) {
  try {
    const data = await storageGet({ [TASKS_KEY]: [], [REMINDER_KEY]: null });
    const tasks = Array.isArray(data[TASKS_KEY]) ? data[TASKS_KEY] : [];
    const updated = tasks.map((task) => {
      if (task.id !== taskId) return task;
      return {
        ...task,
        status: "completed",
        completedAt: Date.now(),
        reminderAt: null,
        reminderIntervalMs: null,
      };
    });

    await storageSet({ [TASKS_KEY]: updated, [REMINDER_KEY]: null });
    await chrome.alarms.clear(REMINDER_ALARM);
    await chrome.notifications.create({
      type: "basic",
      iconUrl: ICON_PATH,
      title: "Well done!",
      message: "Mission accomplished.",
      requireInteraction: false,
      silent: true
    });
  } catch (error) {
    console.error("Failed to mark task complete", error);
  }
}

async function extendTaskReminder(taskId, extensionType) {
  try {
    const data = await storageGet({ [TASKS_KEY]: [], [REMINDER_KEY]: null });
    const tasks = Array.isArray(data[TASKS_KEY]) ? data[TASKS_KEY] : [];
    const idx = tasks.findIndex((t) => t.id === taskId && t.status !== "completed");
    if (idx === -1) return;

    const current = tasks[idx];
    const initialReminderMs = await getInitialReminderMs();
    const prevInterval = current.reminderIntervalMs || initialReminderMs;
    // Drifting results in a more aggressive reminder interval than staying focused
    const nextInterval = extensionType === "focused" ? prevInterval * 3 : prevInterval * 2;
    const nextReminderAt = Date.now() + nextInterval;

    tasks[idx] = {
      ...current,
      reminderIntervalMs: nextInterval,
      reminderAt: nextReminderAt,
    };

    await storageSet({ [TASKS_KEY]: tasks, [REMINDER_KEY]: taskId });
    await chrome.alarms.clear(REMINDER_ALARM);
    await chrome.alarms.create(REMINDER_ALARM, { delayInMinutes: getDelayMinutes(nextInterval) });

    await chrome.notifications.create({
      type: "basic",
      iconUrl: ICON_PATH,
      title: "Keep going. I've refreshed the reminder.",
      message: `I'll check again in ${Math.ceil(nextInterval / 60000)} min. If you finish it before that, mark it complete so I don't annoy you.`,
      requireInteraction: false,
      silent: true
    });
  } catch (error) {
    console.error("Failed to extend task reminder", error);
  }
}

import { getTaskStatus, storageGet, storageSet, VALID_REMINDER_ID, isValidTask } from "./utilities.js";

const REMINDER_ALARM = "friction-tab-reminder";
const REMINDER_MINUTES = 5;
const BASE_REMINDER_MS = REMINDER_MINUTES * 60 * 1000;
const ICON_PATH = "icons/icon128.png"; // Notifications require PNG
const TASKS_KEY = "tasks";
const REMINDER_KEY = "reminderTaskId";

// All alarms are cleared on extension install to prevent orphaned alarms from previous versions
chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.alarms.clearAll();
  } catch (error) {
    console.error("Failed to clear alarms on install", error);
  }
});

// Validate data shape on every storage write; reset to defaults if corrupted
chrome.storage.local.onChanged.addListener(async (changes) => {
  const corrections = {};

  if (REMINDER_KEY in changes) {
    const val = changes[REMINDER_KEY].newValue;
    if (val !== null && (typeof val !== "string" || !VALID_REMINDER_ID.test(val))) {
      corrections[REMINDER_KEY] = null;
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
    const taskId = notificationId.substring(notificationId.indexOf("-") + 1);
    await extendTaskReminder(taskId, "focused");
  } catch (error) {
    console.error("Failed handling notification click", error);
  }
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
    const prevInterval = current.reminderIntervalMs || BASE_REMINDER_MS;
    // Drifting results in a more aggressive reminder interval than staying focused
    const nextInterval = extensionType === "focused" ? prevInterval * 3 : prevInterval * 1.5;
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

import { getTaskStatus } from "./utilities.js";

const REMINDER_ALARM = "friction-tab-reminder";
const REMINDER_MINUTES = 5;
const BASE_REMINDER_MS = REMINDER_MINUTES * 60 * 1000;
const ICON_PATH = "icons/icon128.png"; // Notifications require PNG
const TASKS_KEY = "tasks";
const REMINDER_KEY = "reminderTaskId";

// All alarms are cleared on extension install to prevent orphaned alarms from previous versions
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.clearAll();
});

// Whenever ANY alarm goes off, the extension checks if it is its reminder alarm. If so, it searches for the task details by using the
// task ID stored under reminderTaskId, and shows a notification to check on status of the task
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== REMINDER_ALARM) return;

  chrome.storage.local.get({ [TASKS_KEY]: [], [REMINDER_KEY]: null }, (data) => {
    const tasks = Array.isArray(data[TASKS_KEY]) ? data[TASKS_KEY] : [];
    const reminderTaskId = data[REMINDER_KEY];

    const entry = findReminderTarget(tasks, reminderTaskId);
    if (!entry) return;

    const notificationId = `reminder-${entry.id}`;
    chrome.notifications.create(notificationId, {
      type: "basic",
      iconUrl: ICON_PATH,
      title: "Still on that mission?",
      message: `You promised to work on: ${entry.task}`,
      priority: 2,
      requireInteraction: true,
      buttons: [
        { title: "Yes, still focused" },
        { title: "No, I drifted" },
      ]
    });
  });
});

chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  // Check if this is the initial reminder notification by looking for the unique prefix in the notification ID
  // Reminder -> completion check dialog
  if (notificationId.startsWith("reminder-")) {

    // Remove the prefix to get the original task ID for follow-up actions
    const taskId = notificationId.replace("reminder-", "");
    chrome.notifications.clear(notificationId);

    // If user clicks "Yes, still focused", extension shows a follow-up notification to confirm if they have completed the task or not.
    // If "No, I drifted", extension simply encourages them to get back on track.
    if (buttonIndex === 0) {
      const completionId = `completion-${taskId}`;
      chrome.notifications.create(completionId, {
        type: "basic",
        iconUrl: ICON_PATH,
        title: "Are you done?",
        message: "If yes, I'll mark it complete.",
        requireInteraction: true,
        buttons: [
          { title: "Yes, done" },
          { title: "Still working" },
        ]
      });
    } else {
      extendTaskReminder(taskId, "drifted");
    }

    return;
  }

  // Completion dialog responses
  if (notificationId.startsWith("completion-")) {
    
    const taskId = notificationId.replace("completion-", "");
    chrome.notifications.clear(notificationId);

    if (buttonIndex === 0) {
      markTaskComplete(taskId);
    } else if (buttonIndex === 1) {
      extendTaskReminder(taskId, "focused");
    }
  }
});

// If the user clicks on the notification itself (instead of the buttons), the notification is simply cleared and reminder extended
chrome.notifications.onClicked.addListener((notificationId) => {
  chrome.notifications.clear(notificationId);
  const taskId = notificationId.substring(notificationId.indexOf("-") + 1);
  extendTaskReminder(taskId, "focused");
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

function markTaskComplete(taskId) {
  chrome.storage.local.get({ [TASKS_KEY]: [], [REMINDER_KEY]: null }, (data) => {
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

    chrome.storage.local.set({ [TASKS_KEY]: updated, [REMINDER_KEY]: null }, () => {
      chrome.alarms.clear(REMINDER_ALARM);
      chrome.notifications.create({
        type: "basic",
        iconUrl: ICON_PATH,
        title: "Well done!",
        message: "Mission accomplished.",
        requireInteraction: false,
      });
    });
  });
}

function extendTaskReminder(taskId, extensionType) {
  chrome.storage.local.get({ [TASKS_KEY]: [], [REMINDER_KEY]: null }, (data) => {
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

    chrome.storage.local.set({ [TASKS_KEY]: tasks, [REMINDER_KEY]: taskId }, () => {
      chrome.alarms.clear(REMINDER_ALARM, () => {
        chrome.alarms.create(REMINDER_ALARM, { delayInMinutes: getDelayMinutes(nextInterval) });
      });

      chrome.notifications.create({
        type: "basic",
        iconUrl: ICON_PATH,
        title: "Stay focused.",
        message: `Time refreshed: I'll check again in ${Math.ceil(nextInterval / 60000)} min. If you finish it, mark it complete.`,
        requireInteraction: false,
      });
    });
  });
}

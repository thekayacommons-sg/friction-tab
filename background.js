const REMINDER_ALARM = "friction-tab-reminder";
const ICON_PATH = "icons/icon128.png";

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.clearAll();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== REMINDER_ALARM) return;

  chrome.storage.local.get("latestEntry", (data) => {
    const entry = data.latestEntry;
    if (!entry) return;

    const title = "Still on that mission?";
    const message = `You promised: ${entry.task}`;

    chrome.notifications.create({
      type: "basic",
      iconUrl: ICON_PATH,
      title,
      message,
      priority: 2,
      requireInteraction: true,
      buttons: [
        { title: "Yes, I am" },
        { title: "No, I drifted" }
      ]
    });
  });
});

chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  if (buttonIndex === 0) {
    chrome.notifications.update(notificationId, { title: "Good. Stay on target." });
  } else if (buttonIndex === 1) {
    chrome.notifications.update(notificationId, { title: "Course correct now." });
  }
});

chrome.notifications.onClicked.addListener((notificationId) => {
  chrome.notifications.clear(notificationId);
});

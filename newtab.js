const REMINDER_ALARM = "friction-tab-reminder";

const form = document.getElementById("intent-form");
const input = document.getElementById("intent");
const statusEl = document.getElementById("status");
const latestText = document.getElementById("latest-text");
const latestMeta = document.getElementById("latest-meta");
const reminderPill = document.getElementById("reminder-pill");
const notifyBtn = document.getElementById("notify-btn");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const value = input.value.trim();
  if (!value) {
    statusEl.textContent = "Give me something to nag you about.";
    return;
  }

  const permission = await ensureNotificationPermission();
  if (permission !== "granted") {
    statusEl.textContent = "Enable notifications so I can remind you.";
    updateNotifyCTA();
    return;
  }

  const createdAt = Date.now();
  const reminderAt = createdAt + 5 * 60 * 1000;
  const entry = { task: value, createdAt };

  chrome.storage.local.set({ latestEntry: entry, reminderAt }, () => {
    chrome.alarms.clear(REMINDER_ALARM, () => {
      chrome.alarms.create(REMINDER_ALARM, { delayInMinutes: 5 });
      statusEl.textContent = "Locked. I will tap your shoulder in 5 minutes.";
      input.value = "";
      renderLatest();
    });
  });
});

notifyBtn.addEventListener("click", async () => {
  await ensureNotificationPermission(true);
  updateNotifyCTA();
});

document.addEventListener("DOMContentLoaded", async () => {
  updateNotifyCTA();
  renderLatest();
});

function updateNotifyCTA() {
  if (!("Notification" in window)) {
    notifyBtn.textContent = "Notifications not supported in this browser.";
    notifyBtn.disabled = true;
    return;
  }
  if (Notification.permission === "granted") {
    notifyBtn.style.display = "none";
    statusEl.textContent = "Notifications ready. I will ping you in 5 minutes.";
  } else {
    notifyBtn.style.display = "block";
    notifyBtn.textContent = "Enable notifications";
  }
}

async function ensureNotificationPermission(forceRequest = false) {
  if (!("Notification" in window)) return "denied";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied" && !forceRequest) return "denied";
  const result = await Notification.requestPermission();
  return result;
}

function renderLatest() {
  chrome.storage.local.get(["latestEntry", "reminderAt"], (data) => {
    const entry = data.latestEntry;
    const reminderAt = data.reminderAt;

    if (!entry) {
      latestText.textContent = "No task captured yet.";
      latestMeta.textContent = "Tell me what this tab is for and I will police it.";
      reminderPill.textContent = "No timer";
      return;
    }

    latestText.textContent = entry.task;
    latestMeta.textContent = `Pinned at ${formatTime(entry.createdAt)}.`;

    if (reminderAt) {
      const minutes = Math.max(0, Math.round((reminderAt - Date.now()) / 60000));
      reminderPill.textContent = minutes > 0 ? `${minutes} min left` : "Reminder armed";
    } else {
      reminderPill.textContent = "No timer";
    }
  });
}

function formatTime(timestamp) {
  try {
    return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch (e) {
    return "unknown time";
  }
}

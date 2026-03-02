const REMINDER_ALARM = "friction-tab-reminder";
const BASE_REMINDER_MINUTES = 0.25;
const BASE_REMINDER_MS = BASE_REMINDER_MINUTES * 60 * 1000;
const TASKS_KEY = "tasks";
const REMINDER_KEY = "reminderTaskId";
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

const form = document.getElementById("intent-form");
const input = document.getElementById("intent");
const statusEl = document.getElementById("status");
const latestText = document.getElementById("latest-text");
const latestMeta = document.getElementById("latest-meta");
const reminderPill = document.getElementById("reminder-pill");
const notifyBtn = document.getElementById("notify-btn");
const taskListEl = document.getElementById("task-list");
const clearBtn = document.getElementById("clear-btn");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const value = input.value.trim();
  if (!value) {
    statusEl.textContent = "Give me something to nag you about.";
    return;
  }

  const existingTasks = await loadTasks();
  // If there is an active task, the extension won't allow creating a new one
  // This is to encourage focus on one task at a time
  if (hasActiveTask(existingTasks)) {
    statusEl.textContent = "One mission at a time. Finish the current one first.";
    return;
  }

  const permission = await ensureNotificationPermission();
  if (permission !== "granted") {
    statusEl.textContent = "Enable notifications so I can remind you.";
    refreshNotificationCTAResult();
    return;
  }

  const createdAt = Date.now();
  const reminderAt = createdAt + BASE_REMINDER_MS;
  const entry = {
    id: generateId(),
    task: value,
    createdAt,
    reminderAt,
    reminderIntervalMs: BASE_REMINDER_MS,
    status: "in-progress",
  };

  const tasks = existingTasks;
  const updatedTasks = sortTasks([entry, ...tasks]);
  await saveTasks(updatedTasks);
  await scheduleReminder(entry.id, entry.reminderIntervalMs);

  statusEl.textContent = "Locked. I will tap your shoulder in 5 minutes.";
  input.value = "";
  await refreshTasks(updatedTasks);
});

// If the user clicks the "Mark complete" button, it will mark the task as completed and clear any active reminders for that task
taskListEl.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action=complete]");
  if (!target) return;
  const taskId = target.dataset.id;
  if (!taskId) return;
  completeTask(taskId);
});

notifyBtn.addEventListener("click", async () => {
  await ensureNotificationPermission(true);
  refreshNotificationCTAResult();
});

if (clearBtn) {
  clearBtn.addEventListener("click", () => {
    clearAllTasks();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  init();
});

async function init() {
  await initializeTaskStore();
  refreshNotificationCTAResult();
  await refreshTasks();
}

async function initializeTaskStore() {
  const allTasks = await loadTasks();
  const prunedTasks = pruneCompletedTasks(allTasks);
  if (prunedTasks.length !== allTasks.length) {
    // Only update storage if there are tasks to prune to avoid unnecessary writes
    await saveTasks(prunedTasks);
  }
}

// Filter out completed tasks that were completed more than 2 days ago to keep the task list relevant and manageable
function pruneCompletedTasks(tasks) {
  const cutoff = Date.now() - TWO_DAYS_MS;
  return tasks.filter((task) => {
    if (getTaskStatus(task) !== "completed") return true;
    const completedAt = task.completedAt ?? task.reminderAt ?? task.createdAt;
    return completedAt >= cutoff;
  });
}

// Refreshes task list and headline with an optional pre-fetched task list to avoid redundant storage reads 
// when the caller already has the latest tasks
async function refreshTasks(prefetched) {
  const tasks = sortTasks(prefetched ?? (await loadTasks()));
  renderHeadline(tasks);
  renderTaskList(tasks);
}

// Populates the headline task HTML elements based on the most recent in-progress task
function renderHeadline(tasks) {
  if (!tasks.length) {
    latestText.textContent = "No task captured yet.";
    latestMeta.textContent = "Tell me what this tab is for and I will police it.";
    reminderPill.textContent = "No timer";
    return;
  }

  const newest = tasks[0];
  const newestState = getTaskStatus(newest);
  latestText.textContent = newest.task;
  latestMeta.textContent = `${formatStatus(newestState)} · Logged ${formatTime(newest.createdAt)}.`;

  const active = tasks.find((task) => getTaskStatus(task) === "in-progress");
  if (active?.reminderAt) {
    const minutes = Math.max(0, Math.ceil((active.reminderAt - Date.now()) / 60000));
    reminderPill.textContent = minutes > 0 ? `${minutes} min left` : "Reminder armed";
  } else if (active) {
    reminderPill.textContent = "Reminder armed";
  } else {
    reminderPill.textContent = "All tasks done";
  }
}

// Populates the task list with all tasks, showing their status and allowing the user to mark in-progress tasks as complete
function renderTaskList(tasks) {
  taskListEl.replaceChildren();

  if (!tasks.length) {
    const empty = document.createElement("li");
    empty.className = "task-item task-empty";
    empty.textContent = "No missions logged yet.";
    taskListEl.appendChild(empty);
    return;
  }

  tasks.forEach((task) => {
    const item = document.createElement("li");
    const state = getTaskStatus(task);
    item.className = `task-item ${state}`;

    const content = document.createElement("div");
    content.className = "task-content";

    const title = document.createElement("p");
    title.className = "task-title";
    title.textContent = task.task;

    const meta = document.createElement("p");
    meta.className = "task-meta";
    meta.textContent = buildTaskMeta(task);

    content.append(title, meta);
    item.appendChild(content);

    if (state === "in-progress") {
      const button = document.createElement("button");
      button.className = "task-action complete";
      button.dataset.action = "complete";
      button.dataset.id = task.id;
      button.textContent = "Mark complete";
      item.appendChild(button);
    } else {
      const label = document.createElement("span");
      label.className = "task-meta";
      label.textContent = "Done";
      item.appendChild(label);
    }

    taskListEl.appendChild(item);
  });
}

// Helper function that returns a string with the task metadata for display in the task list, 
// including creation time and completion time if applicable
function buildTaskMeta(task) {
  const created = formatTime(task.createdAt);
  if (getTaskStatus(task) === "completed") {
    const completedAt = task.completedAt ? formatTime(task.completedAt) : created;
    return `Completed · Logged ${created} · Wrapped ${completedAt}`;
  }
  return `In progress · Logged ${created}`;
}

function formatStatus(status) {
  return status === "completed" ? "Completed" : "In progress";
}

function getTaskStatus(task) {
  return task?.status === "completed" ? "completed" : "in-progress";
}

function hasActiveTask(tasks) {
  return Array.isArray(tasks) && tasks.some((task) => getTaskStatus(task) === "in-progress");
}

function formatTime(timestamp) {
  try {
    return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch (e) {
    return "unknown time";
  }
}

function generateId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function completeTask(taskId) {
  const tasks = await loadTasks();
  let changed = false;
  const updated = tasks.map((task) => {
    if (task.id !== taskId) return task;
    changed = true;
    return {
      ...task,
      status: "completed",
      completedAt: Date.now(),
      reminderAt: null,
    };
  });

  if (!changed) return;

  await saveTasks(updated);
  const { [REMINDER_KEY]: reminderTaskId } = await storageGet({ [REMINDER_KEY]: null });
  if (reminderTaskId === taskId) {
    await clearReminder();
  }

  statusEl.textContent = "Task marked complete. Proud of you.";
  await refreshTasks(updated);
}

async function clearAllTasks() {
  const tasks = await loadTasks();
  if (!tasks.length) {
    statusEl.textContent = "Nothing to clear. Stay targeted.";
    return;
  }

  await saveTasks([]);
  await clearReminder();
  statusEl.textContent = "Clean slate activated. Declare a new mission.";
  await refreshTasks([]);
}

async function loadTasks() {
  const data = await storageGet({ [TASKS_KEY]: [] });
  const tasks = Array.isArray(data[TASKS_KEY]) ? data[TASKS_KEY] : [];
  return sortTasks(tasks);
}

async function saveTasks(tasks) {
  await storageSet({ [TASKS_KEY]: sortTasks(tasks) });
}

function sortTasks(tasks) {
  return [...tasks].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function refreshNotificationCTAResult() {
  if (!("Notification" in window)) {
    notifyBtn.textContent = "Notifications not supported in this browser.";
    notifyBtn.disabled = true;
    return;
  }
  if (Notification.permission === "granted") {
    notifyBtn.style.display = "none";
    statusEl.textContent = "All permissions in place. We're ready to roll.";
  } else {
    notifyBtn.style.display = "block";
    notifyBtn.textContent = "Without notifications, I cannot remind you to stay on track.";
  }
}

// Force request permission set to false by default so if permission was previously denied, it won't prompt again
async function ensureNotificationPermission(forceRequest = false) {
  if (!("Notification" in window)) return "denied";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied" && !forceRequest) return "denied";
  // Else if permission is default or not yet requested, ask for permission
  const result = await Notification.requestPermission();
  return result;
}

async function scheduleReminder(taskId) {
  await storageSet({ [REMINDER_KEY]: taskId });
  await new Promise((resolve) => {
    chrome.alarms.clear(REMINDER_ALARM, () => {
      chrome.alarms.create(REMINDER_ALARM, { delayInMinutes: BASE_REMINDER_MINUTES });
      resolve();
    });
  });
}

async function clearReminder() {
  await storageSet({ [REMINDER_KEY]: null });
  await new Promise((resolve) => {
    chrome.alarms.clear(REMINDER_ALARM, resolve);
  });
}

function storageGet(keysWithDefaults) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keysWithDefaults, resolve);
  });
}

function storageSet(items) {
  return new Promise((resolve) => {
    chrome.storage.local.set(items, resolve);
  });
}

import {
  sortTasks,
  getTaskStatus,
  hasActiveTask,
  getActiveTask,
  formatTime,
  generateId,
  storageGet,
  storageSet,
} from "./utilities.js";

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
const latestActions = document.getElementById("latest-actions");
const latestCompleteBtn = document.getElementById("latest-complete");
const notifyBtn = document.getElementById("notify-btn");
const taskListEl = document.getElementById("task-list");
const clearBtn = document.getElementById("clear-btn");
const modalEl = document.getElementById("focus-modal");
const modalCompleteBtn = document.getElementById("modal-complete");
const modalDismissBtn = document.getElementById("modal-dismiss");
const modalTaskName = document.getElementById("modal-task-name");
let modalDismissed = false;

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

  // Do not nag with the modal immediately after creating a task; wait until the next tab load
  modalDismissed = true;
  if (modalEl) modalEl.hidden = true;

  statusEl.textContent = `Locked in. I will tap your shoulder in ${BASE_REMINDER_MINUTES} minutes.`;
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

if (latestCompleteBtn) {
  latestCompleteBtn.addEventListener("click", async () => {
    const tasks = await loadTasks();
    const active = getActiveTask(tasks);
    if (!active) {
      statusEl.textContent = "No active mission to complete.";
      return;
    }
    await completeTask(active.id);
  });
}

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
  promptActiveTaskModalIfPresent(tasks);
}

// Populates the headline task HTML elements based on the most recent task
function renderHeadline(tasks) {
  if (!tasks.length) {
    latestText.textContent = "No task captured yet.";
    latestMeta.textContent = "Once you're getting down to real work, tell me what you're up to and let's keep you honest.";
    reminderPill.textContent = "No timer";
    if (latestActions) latestActions.classList.remove("visible");
    if (latestCompleteBtn) latestCompleteBtn.disabled = true;
    return;
  }

  const newest = tasks[0];
  const newestState = getTaskStatus(newest);
  latestText.textContent = newest.task;
  latestMeta.textContent = buildTaskMeta(newest);

  const isNewestActive = newestState === "in-progress";
  if (latestActions) latestActions.classList.toggle("visible", isNewestActive);
  if (latestCompleteBtn) latestCompleteBtn.disabled = !isNewestActive;

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

  const visibleTasks = tasks.slice(1); // First task is displayed in the headline

  if (!visibleTasks.length) {
    taskListEl.style.display = "none"; // Hide whole task list if empty to avoid unnecessary padding and margin
    return;
  }

  taskListEl.style.display = "flex";

  visibleTasks.forEach((task) => {
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
  launchConfetti();
  await refreshTasks(updated);
}

async function clearAllTasks() {
  const tasks = await loadTasks();
  if (!tasks.length) {
    statusEl.textContent = "Nothing to clear.";
    return;
  }

  await saveTasks([]);
  await clearReminder();
  statusEl.textContent = "Clean slate activated. Declare a new mission whenever you're ready.";
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

function promptActiveTaskModalIfPresent(tasks) {
  if (!modalEl || modalDismissed) return;
  const active = getActiveTask(tasks);
  if (active) {
    if (modalTaskName) {
      modalTaskName.textContent = active.task;
    }
    modalEl.hidden = false;
  } else {
    if (modalTaskName) modalTaskName.textContent = "";
    modalEl.hidden = true;
  }
}

if (modalCompleteBtn) {
  modalCompleteBtn.addEventListener("click", async () => {
    const tasks = await loadTasks();
    const active = getActiveTask(tasks);
    if (!active) {
      modalEl.hidden = true;
      return;
    }
    await completeTask(active.id);
    modalEl.hidden = true;
    modalDismissed = true;
  });
}

if (modalDismissBtn) {
  modalDismissBtn.addEventListener("click", () => {
    modalEl.hidden = true;
    modalDismissed = true;
  });
}

function launchConfetti() {
  const layer = document.getElementById("confetti-layer");
  if (!layer) return;

  const colors = ["#eb5e28", "#7cf3c0", "#f8fafc", "#3b82f6", "#a855f7"];
  const pieces = 60;

  for (let i = 0; i < pieces; i += 1) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[i % colors.length];
    piece.style.animationDelay = `${Math.random() * 0.2}s`;
    piece.style.transform = `rotate(${Math.random() * 180}deg)`;
    layer.appendChild(piece);

    setTimeout(() => {
      piece.remove();
    }, 1200);
  }
}

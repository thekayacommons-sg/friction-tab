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
const INITIAL_REMINDER_MINUTES = 5;
const MIN_REMINDER_MINUTES = 1;
const MAX_REMINDER_MINUTES = 10;
const INITIAL_REMINDER_MINUTES_KEY = "initialReminderMinutes";
const SITE_CHANGE_NAG_ENABLED_KEY = "siteChangeNagEnabled";
const TASKS_KEY = "tasks";
const REMINDER_KEY = "reminderTaskId";
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
const SETTINGS_DROPDOWN_ANIMATION_MS = 170;
let initialReminderMinutes = INITIAL_REMINDER_MINUTES;

const form = document.getElementById("intent-form");
const input = document.getElementById("intent");
const statusEl = document.getElementById("status");
const settingsMenu = document.getElementById("settings-menu");
const settingsToggleBtn = document.getElementById("settings-toggle");
const settingsDropdown = document.getElementById("settings-dropdown");
const initialReminderDisplay = document.getElementById("initial-reminder-display");
const initialReminderInput = document.getElementById("initial-reminder-input");
const initialReminderEditBtn = document.getElementById("initial-reminder-edit");
const initialReminderSaveBtn = document.getElementById("initial-reminder-save");
const siteChangeNagToggle = document.getElementById("site-change-nag-toggle");
const latestText = document.getElementById("latest-text");
const latestMeta = document.getElementById("latest-meta");
const reminderPill = document.getElementById("reminder-pill");
const latestActions = document.getElementById("latest-actions");
const latestCompleteBtn = document.getElementById("latest-complete");
const notifyBtn = document.getElementById("notify-btn"); // notifyBtn is only shown when notification permission is not yet granted
const taskListEl = document.getElementById("task-list");
const clearBtn = document.getElementById("clear-btn");
const modalEl = document.getElementById("focus-modal");
const modalCompleteBtn = document.getElementById("modal-complete");
const modalDismissBtn = document.getElementById("modal-dismiss");
const modalTaskName = document.getElementById("modal-task-name");
let modalDismissed = false;
// Keeps a pending close timeout so the dropdown can finish its exit animation and prevents stale close timers when quickly reopening.
let settingsDropdownCloseTimer = null;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const value = input.value.trim();
  if (!value) {
    statusEl.textContent = "Give me something to nag you about.";
    return;
  }

  if (value.length > 70) {
    statusEl.textContent = "Let's keep it short and sweet. Condense that into 70 characters or less.";
    return;
  }

  const existingTasks = await loadAndSortTasksFromStorage();
  /*
   * If there is an active task, the extension won't allow creating a new one.
   * This is to encourage focus on one task at a time.
   */
  if (hasActiveTask(existingTasks)) {
    statusEl.textContent = "One mission at a time. Finish the current one first.";
    return;
  }

  const permission = await requestNotificationPermission();
  if (permission !== "granted") {
    statusEl.textContent = "Enable notifications so I can remind you.";
    renderNotificationPermissionStatus();
    return;
  }

  const reminderIntervalMs = initialReminderMinutes * 60 * 1000;
  const createdAt = Date.now();
  const reminderAt = createdAt + reminderIntervalMs;
  const entry = {
    id: generateId(),
    task: value,
    createdAt,
    reminderAt,
    reminderIntervalMs: reminderIntervalMs,
    status: "in-progress",
  };

  const tasks = existingTasks;
  const updatedTasks = sortTasks([entry, ...tasks]);
  await saveTasksToStorage(updatedTasks);
  await scheduleReminder(entry.id, entry.reminderIntervalMs);

  // Do not nag with the modal immediately after creating a task; wait until the next tab load
  modalDismissed = true;
  if (modalEl) modalEl.hidden = true;

  statusEl.textContent = `Locked in. I will tap your shoulder in ${initialReminderMinutes} minute${initialReminderMinutes === 1 ? "" : "s"}.`;
  input.value = "";
  await refreshTasksDisplay(updatedTasks);
});

// If the user clicks the "Mark complete" button, it will mark the task as completed and clear any active reminders for that task
if (latestCompleteBtn) {
  latestCompleteBtn.addEventListener("click", async () => {
    const tasks = await loadAndSortTasksFromStorage();
    const active = getActiveTask(tasks);
    if (!active) {
      statusEl.textContent = "No active mission to complete.";
      return;
    }
    await completeTask(active.id);
  });
}

notifyBtn.addEventListener("click", async () => {
  await requestNotificationPermission(true);
  renderNotificationPermissionStatus();
});

if (clearBtn) {
  clearBtn.addEventListener("click", () => {
    clearAllTasksAndReminder();
  });
}

if (initialReminderEditBtn) {
  initialReminderEditBtn.addEventListener("click", () => {
    setInitialReminderEditMode(true);
  });
}

if (initialReminderSaveBtn) {
  initialReminderSaveBtn.addEventListener("click", async () => {
    await saveInitialReminderMinutesFromInput();
  });
}

if (initialReminderInput) {
  initialReminderInput.addEventListener("keydown", async (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      await saveInitialReminderMinutesFromInput();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setInitialReminderEditMode(false);
    }
  });
}

if (siteChangeNagToggle) {
  siteChangeNagToggle.addEventListener("change", async () => {
    const isEnabled = siteChangeNagToggle.checked;
    try {
      await storageSet({ [SITE_CHANGE_NAG_ENABLED_KEY]: isEnabled });
      statusEl.textContent = isEnabled
        ? "Site-change nag is enabled. Wandering without a mission will be called out."
        : "Site-change nag is disabled. Regular mission reminders still work.";
    } catch (error) {
      console.error("Failed to save site-change nag setting", error);
      siteChangeNagToggle.checked = !isEnabled;
      statusEl.textContent = "Could not save site-change nag setting. Try again.";
    }
  });
}

// Toggle the settings dropdown when the gear is clicked
if (settingsToggleBtn && settingsDropdown) {
  settingsToggleBtn.addEventListener("click", () => {
    const willOpen = settingsDropdown.hidden;
    setSettingsDropdownOpen(willOpen);
  });
}

// Close the dropdown when clicking anywhere outside the settings menu
document.addEventListener("click", (event) => {
  if (!settingsMenu || settingsDropdown?.hidden) return;
  if (!settingsMenu.contains(event.target)) {
    setSettingsDropdownOpen(false);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setSettingsDropdownOpen(false);
  }
});

document.addEventListener("DOMContentLoaded", () => {
  init();
});

async function init() {
  await initializeTaskStore();
  await initializeInitialReminderMinutesSetting();
  await initializeSiteChangeNagSetting();
  renderNotificationPermissionStatus();
  await refreshTasksDisplay();
}

async function initializeTaskStore() {
  const allTasks = await loadAndSortTasksFromStorage();
  const prunedTasks = pruneCompletedTasks(allTasks);
  if (prunedTasks.length !== allTasks.length) {
    // Only update storage if there are tasks to prune to avoid unnecessary writes
    await saveTasksToStorage(prunedTasks);
  }
}

async function initializeInitialReminderMinutesSetting() {
  let shouldPersistNormalizedValue = false;

  try {
    const data = await storageGet({ [INITIAL_REMINDER_MINUTES_KEY]: INITIAL_REMINDER_MINUTES });
    const rawValue = data[INITIAL_REMINDER_MINUTES_KEY];
    const normalizedValue = normalizeReminderMinutes(rawValue);
    initialReminderMinutes = normalizedValue;
    shouldPersistNormalizedValue = rawValue !== normalizedValue;
  } catch (error) {
    console.error("Failed to load initial reminder minutes", error);
    initialReminderMinutes = INITIAL_REMINDER_MINUTES;
  }

  if (shouldPersistNormalizedValue) {
    try {
      await storageSet({ [INITIAL_REMINDER_MINUTES_KEY]: initialReminderMinutes });
    } catch (error) {
      console.error("Failed to normalize initial reminder minutes", error);
    }
  }

  renderInitialReminderSetting();
  setInitialReminderEditMode(false);
}

function normalizeReminderMinutes(value) {
  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue)) return INITIAL_REMINDER_MINUTES;
  const rounded = Math.round(parsedValue);
  return Math.min(MAX_REMINDER_MINUTES, Math.max(MIN_REMINDER_MINUTES, rounded));
}

function isValidReminderMinutesInput(value) {
  const parsedValue = Number(value);
  return Number.isInteger(parsedValue) && parsedValue >= MIN_REMINDER_MINUTES && parsedValue <= MAX_REMINDER_MINUTES;
}

function renderInitialReminderSetting() {
  if (initialReminderDisplay) {
    initialReminderDisplay.textContent = String(initialReminderMinutes);
  }
  if (initialReminderInput) {
    initialReminderInput.value = String(initialReminderMinutes);
  }
}

function setInitialReminderEditMode(isEditing) {
  if (initialReminderEditBtn) initialReminderEditBtn.hidden = isEditing;
  if (initialReminderSaveBtn) initialReminderSaveBtn.hidden = !isEditing;
  if (initialReminderInput) {
    initialReminderInput.hidden = !isEditing;
    if (isEditing) {
      initialReminderInput.value = String(initialReminderMinutes);
      initialReminderInput.focus();
      initialReminderInput.select();
    }
  }
}

// Function to open or close the settings dropdown with animation and proper cleanup of pending close timers to prevent bugs when quickly toggling the dropdown
// Note: setTimeout provides a delay before performing an action
function setSettingsDropdownOpen(isOpen) {
  if (!settingsDropdown || !settingsToggleBtn) return;

  if (settingsDropdownCloseTimer) {
    clearTimeout(settingsDropdownCloseTimer);
    settingsDropdownCloseTimer = null;
  }

  if (isOpen) {
    settingsDropdown.hidden = false;
    // Wait one frame so the browser applies the unhidden base state before adding the open class, which allows the transition to animate
    requestAnimationFrame(() => {
      settingsDropdown.classList.add("open");
    });
  } else {
    settingsDropdown.classList.remove("open");
    settingsDropdownCloseTimer = setTimeout(() => {
      settingsDropdown.hidden = true;
      settingsDropdownCloseTimer = null;
    }, SETTINGS_DROPDOWN_ANIMATION_MS);
  }

  settingsToggleBtn.setAttribute("aria-expanded", String(isOpen));
}

async function initializeSiteChangeNagSetting() {
  if (!siteChangeNagToggle) return;

  let isEnabled = true;
  let shouldPersistNormalizedValue = false;

  try {
    const data = await storageGet({ [SITE_CHANGE_NAG_ENABLED_KEY]: true });
    isEnabled = typeof data[SITE_CHANGE_NAG_ENABLED_KEY] === "boolean" ? data[SITE_CHANGE_NAG_ENABLED_KEY] : true;
    shouldPersistNormalizedValue = typeof data[SITE_CHANGE_NAG_ENABLED_KEY] !== "boolean";
  } catch (error) {
    console.error("Failed to load site-change nag setting", error);
  }

  siteChangeNagToggle.checked = isEnabled;

  if (shouldPersistNormalizedValue) {
    try {
      await storageSet({ [SITE_CHANGE_NAG_ENABLED_KEY]: isEnabled });
    } catch (error) {
      console.error("Failed to normalize site-change nag setting", error);
    }
  }
}

async function saveInitialReminderMinutesFromInput() {
  if (!initialReminderInput) return;

  const enteredValue = initialReminderInput.value.trim();
  if (!isValidReminderMinutesInput(enteredValue)) {
    statusEl.textContent = `Initial reminder must be a whole number between ${MIN_REMINDER_MINUTES} and ${MAX_REMINDER_MINUTES}.`;
    return;
  }

  const nextValue = normalizeReminderMinutes(enteredValue);
  const previousValue = initialReminderMinutes;
  initialReminderMinutes = nextValue;
  renderInitialReminderSetting();

  try {
    await storageSet({ [INITIAL_REMINDER_MINUTES_KEY]: nextValue });
    statusEl.textContent = `Initial reminder duration set to ${nextValue} minute${nextValue === 1 ? "" : "s"}.`;
    setInitialReminderEditMode(false);
  } catch (error) {
    console.error("Failed to save initial reminder minutes", error);
    initialReminderMinutes = previousValue;
    renderInitialReminderSetting();
    statusEl.textContent = "Could not save initial reminder setting. Try again.";
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

/*
 * Refreshes task list and headline with an optional pre-fetched task list to avoid redundant storage reads
 * when the caller already has the latest tasks
 */
async function refreshTasksDisplay(prefetched) {
  const tasks = sortTasks(prefetched ?? (await loadAndSortTasksFromStorage()));
  renderHeadlineTask(tasks);
  renderTaskList(tasks);
  promptActiveTaskModalIfPresent(tasks);
}

// Populates the headline task HTML elements based on the most recent task
function renderHeadlineTask(tasks) {
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

/*
 * Populates the task list with all tasks, showing their status and allowing the user to mark in-progress tasks as complete
 */
function renderTaskList(tasks) {
  taskListEl.replaceChildren();

  const visibleTasks = tasks.slice(1); // Remove first task since it is displayed in the headline

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
      /* 
       * For simplicity, only the most recent in-progress task (which is also shown in the headline) is actionable to avoid clutter.
       * The below code is left here for future extensibility if we want to allow multiple in-progress tasks.
      const button = document.createElement("button");
      button.className = "task-action complete";
      button.dataset.action = "complete";
      button.dataset.id = task.id;
      button.textContent = "Mark complete";
      item.appendChild(button);
      */
    } else {
      const label = document.createElement("span");
      label.className = "task-meta";
      label.textContent = "Done";
      item.appendChild(label);
    }

    taskListEl.appendChild(item);
  });
}

/*
 * Helper function that returns a string with the task metadata for display in the task list,
 * including creation time and completion time if applicable
 */
function buildTaskMeta(task) {
  const created = formatTime(task.createdAt);
  if (getTaskStatus(task) === "completed") {
    const completedAt = task.completedAt ? formatTime(task.completedAt) : created;
    return `Completed · Logged ${created} · Wrapped ${completedAt}`;
  }
  return `In progress · Logged ${created}`;
}

async function completeTask(taskId) {
  const tasks = await loadAndSortTasksFromStorage();
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

  await saveTasksToStorage(updated);
  try {
    const { [REMINDER_KEY]: reminderTaskId } = await storageGet({ [REMINDER_KEY]: null });
    if (reminderTaskId === taskId) {
      await clearReminder();
    }
  } catch (error) {
    console.error("Failed to check active reminder", error);
  }

  statusEl.textContent = "Task marked complete. Proud of you.";
  launchConfetti();
  await refreshTasksDisplay(updated);
}

async function clearAllTasksAndReminder() {
  const tasks = await loadAndSortTasksFromStorage();
  if (!tasks.length) {
    statusEl.textContent = "Nothing to clear.";
    return;
  }

  await saveTasksToStorage([]);
  await clearReminder();
  statusEl.textContent = "Clean slate activated. Declare a new mission whenever you're ready.";
  await refreshTasksDisplay([]);
}

async function loadAndSortTasksFromStorage() {
  try {
    const data = await storageGet({ [TASKS_KEY]: [] });
    const tasks = Array.isArray(data[TASKS_KEY]) ? data[TASKS_KEY] : [];
    return sortTasks(tasks);
  } catch (error) {
    console.error("Failed to load tasks from storage", error);
    statusEl.textContent = "I could not read tasks from storage.";
    return [];
  }
}

async function saveTasksToStorage(tasks) {
  try {
    await storageSet({ [TASKS_KEY]: sortTasks(tasks) });
  } catch (error) {
    console.error("Failed to save tasks to storage", error);
    statusEl.textContent = "I could not save your tasks. Try again.";
  }
}

function renderNotificationPermissionStatus() {
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
async function requestNotificationPermission(forceRequest = false) {
  if (!("Notification" in window)) return "denied";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied" && !forceRequest) return "denied";
  // Else if permission is default or not yet requested, ask for permission
  try {
    const result = await Notification.requestPermission();
    return result;
  } catch (error) {
    console.error("Notification permission request failed", error);
    return "denied";
  }
}

async function scheduleReminder(taskId, intervalMs) {
  try {
    await storageSet({ [REMINDER_KEY]: taskId });
    await new Promise((resolve) => {
      chrome.alarms.clear(REMINDER_ALARM, () => {
        const fallbackDelayMs = initialReminderMinutes * 60 * 1000;
        const delayMs = typeof intervalMs === "number" && Number.isFinite(intervalMs) ? intervalMs : fallbackDelayMs;
        const delayInMinutes = Math.max(MIN_REMINDER_MINUTES, delayMs / 60000);
        chrome.alarms.create(REMINDER_ALARM, { delayInMinutes });
        resolve();
      });
    });
  } catch (error) {
    console.error("Failed to schedule reminder", error);
    statusEl.textContent = "Could not schedule reminder. Please retry.";
  }
}

async function clearReminder() {
  try {
    await storageSet({ [REMINDER_KEY]: null });
    await new Promise((resolve) => {
      chrome.alarms.clear(REMINDER_ALARM, resolve);
    });
  } catch (error) {
    console.error("Failed to clear reminder", error);
    statusEl.textContent = "Could not clear reminder.";
  }
}

/*
 * If there is an active task when the user opens a new tab, the extension prompts them with a modal to
 * reminder the user in an in-your-face manner.
 */
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
    const tasks = await loadAndSortTasksFromStorage();
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

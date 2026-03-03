export function sortTasks(tasks = []) {
  return [...tasks].sort((a, b) => (b?.createdAt || 0) - (a?.createdAt || 0));
}

export function getTaskStatus(task) {
  return task?.status === "completed" ? "completed" : "in-progress";
}

export function hasActiveTask(tasks) {
  return Array.isArray(tasks) && tasks.some((task) => getTaskStatus(task) === "in-progress");
}

export function getActiveTask(tasks) {
  return Array.isArray(tasks) ? tasks.find((task) => getTaskStatus(task) === "in-progress") : null;
}

export function formatTime(timestamp) {
  try {
    return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch (error) {
    return "unknown time";
  }
}

export function generateId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function storageGet(keysWithDefaults) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keysWithDefaults, resolve);
  });
}

export function storageSet(items) {
  return new Promise((resolve) => {
    chrome.storage.local.set(items, resolve);
  });
}

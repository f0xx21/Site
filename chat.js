const CHAT_MESSAGE_LIMIT = 50;
const CHAT_MAX_TEXT_LENGTH = 500;
const CHAT_MAX_NICKNAME_LENGTH = 24;
const CHAT_NICKNAME_KEY = "chatNickname";
const CHAT_NOTIFICATIONS_KEY = "chatNotificationsEnabled";

const NICKNAME_COLORS = [
  "#f87171",
  "#fb923c",
  "#fbbf24",
  "#a3e635",
  "#34d399",
  "#2dd4bf",
  "#22d3ee",
  "#60a5fa",
  "#818cf8",
  "#a78bfa",
  "#c084fc",
  "#f472b6",
  "#fb7185",
];

let supabaseClient = null;
let chatChannel = null;
let chatInitialized = false;
let nicknameColumnSupported = null;
let chatBootstrapped = false;
let knownMessageIds = new Set();

const chatMessagesEl = document.getElementById("chatMessages");
const chatNicknameEl = document.getElementById("chatNickname");
const chatInputEl = document.getElementById("chatInput");
const chatSendBtn = document.getElementById("chatSendBtn");
const chatStatusEl = document.getElementById("chatStatus");
const chatNotifyBtn = document.getElementById("chatNotifyBtn");

function setChatStatus(message, type = "") {
  if (!chatStatusEl) return;
  chatStatusEl.textContent = message;
  chatStatusEl.className = "chat-status" + (type ? ` ${type}` : "");
}

function isMissingNicknameColumn(error) {
  const message = String(error?.message ?? "");
  return error?.code === "42703" || message.includes("nickname");
}

function getChatErrorMessage(error) {
  if (location.protocol === "file:") {
    return "Chat does not work via file:// — run start-server.bat and open http://localhost:3000";
  }

  if (isMissingNicknameColumn(error)) {
    return "Run supabase-migration-nicknames.sql in Supabase SQL Editor";
  }

  const message = String(error?.message ?? error ?? "");

  if (
    message.includes("Failed to fetch") ||
    message.includes("NetworkError") ||
    message.includes("Load failed")
  ) {
    return "Cannot reach Supabase — check your connection or open http://localhost:3000";
  }

  return "Failed to connect to chat";
}

function formatMessageTime(isoString) {
  try {
    const date = new Date(isoString);
    const month = date.toLocaleString("en-US", { month: "short" });
    const day = date.getDate();
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${month} ${day}, ${hours}:${minutes}`;
  } catch {
    return "";
  }
}

function displayNickname(value) {
  const nickname = normalizeNickname(value);
  if (!nickname || nickname === "Гость") return "Guest";
  return nickname;
}

function getNicknameInitial(nickname) {
  const name = displayNickname(nickname);
  const letter = name.charAt(0).toUpperCase();
  return letter || "?";
}

function getNicknameColor(nickname) {
  const name = displayNickname(nickname).toLowerCase();
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return NICKNAME_COLORS[hash % NICKNAME_COLORS.length];
}

function hexToRgba(hex, alpha) {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function applyNicknameColors(nicknameEl, avatarEl, nickname) {
  const color = getNicknameColor(nickname);
  nicknameEl.style.color = color;
  avatarEl.style.color = color;
  avatarEl.style.backgroundColor = hexToRgba(color, 0.22);
  avatarEl.style.borderColor = hexToRgba(color, 0.5);
}

function normalizeNickname(value) {
  return String(value ?? "").trim().slice(0, CHAT_MAX_NICKNAME_LENGTH);
}

function getNickname() {
  return normalizeNickname(chatNicknameEl?.value);
}

function saveNickname() {
  const nickname = getNickname();
  if (nickname) {
    localStorage.setItem(CHAT_NICKNAME_KEY, nickname);
  }
}

function loadSavedNickname() {
  if (!chatNicknameEl) return;
  const saved = localStorage.getItem(CHAT_NICKNAME_KEY);
  if (saved) {
    chatNicknameEl.value = normalizeNickname(saved);
  }
}

function scrollChatToBottom() {
  if (!chatMessagesEl) return;
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

function createMessageElement(message) {
  const nickname = displayNickname(message.nickname);

  const item = document.createElement("article");
  item.className = "chat-message";
  item.dataset.messageId = String(message.id);

  const avatarEl = document.createElement("div");
  avatarEl.className = "chat-message-avatar";
  avatarEl.setAttribute("aria-hidden", "true");
  avatarEl.textContent = getNicknameInitial(message.nickname);

  const bodyEl = document.createElement("div");
  bodyEl.className = "chat-message-body";

  const headerEl = document.createElement("div");
  headerEl.className = "chat-message-header";

  const nicknameEl = document.createElement("strong");
  nicknameEl.className = "chat-message-nickname";
  nicknameEl.textContent = nickname;

  applyNicknameColors(nicknameEl, avatarEl, message.nickname);

  const timeEl = document.createElement("time");
  timeEl.className = "chat-message-time";
  timeEl.dateTime = message.created_at;
  timeEl.textContent = formatMessageTime(message.created_at);

  headerEl.appendChild(nicknameEl);
  headerEl.appendChild(timeEl);

  const textEl = document.createElement("p");
  textEl.className = "chat-message-text";
  textEl.textContent = message.text;

  bodyEl.appendChild(headerEl);
  bodyEl.appendChild(textEl);

  item.appendChild(avatarEl);
  item.appendChild(bodyEl);
  return item;
}

function appendMessage(message, shouldScroll = true) {
  if (!chatMessagesEl || knownMessageIds.has(message.id)) return;

  knownMessageIds.add(message.id);
  chatMessagesEl.appendChild(createMessageElement(message));

  if (shouldScroll) {
    scrollChatToBottom();
  }
}

function clearChatMessages() {
  if (!chatMessagesEl) return;
  chatMessagesEl.innerHTML = "";
  knownMessageIds.clear();
}

function isChatConfigured() {
  const url = window.SUPABASE_URL?.trim();
  const key = window.SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return false;
  if (url === "https://xxxx.supabase.co") return false;
  if (key === "eyJ..." || key === "sb_publishable_...") return false;
  if (url.includes("/rest/v1")) return false;
  return true;
}

function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;

  if (!window.supabase?.createClient) {
    throw new Error("Supabase SDK not loaded");
  }

  if (!isChatConfigured()) {
    throw new Error("config.js is not configured");
  }

  supabaseClient = window.supabase.createClient(
    window.SUPABASE_URL,
    window.SUPABASE_ANON_KEY
  );

  return supabaseClient;
}

async function detectNicknameColumn(client) {
  if (nicknameColumnSupported !== null) {
    return nicknameColumnSupported;
  }

  const { error } = await client.from("messages").select("nickname").limit(1);
  nicknameColumnSupported = !isMissingNicknameColumn(error);
  return nicknameColumnSupported;
}

async function loadRecentMessages(client) {
  const hasNickname = await detectNicknameColumn(client);
  const query = client
    .from("messages")
    .select(hasNickname ? "id, nickname, text, created_at" : "id, text, created_at")
    .order("created_at", { ascending: false })
    .limit(CHAT_MESSAGE_LIMIT);

  const { data, error } = await query;
  if (error) throw error;

  clearChatMessages();

  const messages = (data ?? []).slice().reverse();
  messages.forEach((message) => {
    if (!hasNickname) {
      message.nickname = null;
    }
    appendMessage(message, false);
  });

  scrollChatToBottom();

  if (!hasNickname) {
    setChatStatus("Run supabase-migration-nicknames.sql to save nicknames", "error");
  }
}

function notificationsSupported() {
  return "Notification" in window;
}

function notificationsEnabled() {
  return (
    notificationsSupported() &&
    Notification.permission === "granted" &&
    localStorage.getItem(CHAT_NOTIFICATIONS_KEY) === "true"
  );
}

function isChatSectionActive() {
  return document.getElementById("section-chat")?.classList.contains("is-active");
}

function updateNotifyButton() {
  if (!chatNotifyBtn) return;

  if (!notificationsSupported()) {
    chatNotifyBtn.hidden = true;
    return;
  }

  chatNotifyBtn.hidden = false;
  chatNotifyBtn.classList.remove("is-active");
  chatNotifyBtn.disabled = false;

  if (Notification.permission === "granted" && localStorage.getItem(CHAT_NOTIFICATIONS_KEY) === "true") {
    chatNotifyBtn.textContent = "Notifications on";
    chatNotifyBtn.classList.add("is-active");
    return;
  }

  if (Notification.permission === "denied") {
    chatNotifyBtn.textContent = "Notifications blocked in browser";
    chatNotifyBtn.disabled = true;
    return;
  }

  chatNotifyBtn.textContent = "Enable notifications";
}

async function requestNotificationPermission() {
  if (!notificationsSupported()) return;

  if (Notification.permission === "granted") {
    localStorage.setItem(CHAT_NOTIFICATIONS_KEY, "true");
    updateNotifyButton();
    return;
  }

  if (Notification.permission === "denied") {
    updateNotifyButton();
    return;
  }

  const result = await Notification.requestPermission();
  if (result === "granted") {
    localStorage.setItem(CHAT_NOTIFICATIONS_KEY, "true");
  } else {
    localStorage.setItem(CHAT_NOTIFICATIONS_KEY, "false");
  }

  updateNotifyButton();
}

function shouldNotifyForMessage(message) {
  if (!notificationsEnabled()) return false;

  const author = displayNickname(message.nickname).toLowerCase();
  const self = getNickname().toLowerCase();
  if (author && self && author === self) return false;

  return document.hidden || !isChatSectionActive();
}

function showMessageNotification(message) {
  if (!shouldNotifyForMessage(message)) return;

  const nickname = displayNickname(message.nickname);
  const body = String(message.text ?? "").trim().slice(0, 120);

  const notification = new Notification(`${nickname} · Chat`, {
    body: body || "New message",
    tag: `chat-${message.id}`,
  });

  notification.onclick = () => {
    window.focus();
    notification.close();
    if (typeof window.goToSection === "function") {
      window.goToSection("chat");
    }
  };
}

function handleIncomingMessage(message) {
  if (chatInitialized && chatMessagesEl) {
    appendMessage(message);
  }
  showMessageNotification(message);
}

async function bootstrapChatConnection() {
  if (chatBootstrapped) return;
  if (!isChatConfigured() || location.protocol === "file:") return;

  chatBootstrapped = true;

  try {
    const client = getSupabaseClient();
    await detectNicknameColumn(client);

    if (chatChannel) return;

    chatChannel = client
      .channel("public:messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          if (payload.new) {
            handleIncomingMessage(payload.new);
          }
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED" && chatInitialized) {
          if (nicknameColumnSupported === false) {
            setChatStatus("Run supabase-migration-nicknames.sql to save nicknames", "error");
          } else {
            setChatStatus("Online");
          }
        } else if (status === "CHANNEL_ERROR" && chatInitialized) {
          setChatStatus("Connection error", "error");
        } else if (status === "TIMED_OUT" && chatInitialized) {
          setChatStatus("Connection timed out", "error");
        }
      });
  } catch (error) {
    console.error("Chat bootstrap error:", error);
    chatBootstrapped = false;
  }
}

async function sendMessage() {
  if (!chatInputEl || !chatSendBtn) return;

  const nickname = getNickname();
  if (!nickname) {
    setChatStatus("Enter a nickname before sending", "error");
    chatNicknameEl?.focus();
    return;
  }

  const text = chatInputEl.value.trim();
  if (!text) return;

  if (text.length > CHAT_MAX_TEXT_LENGTH) {
    setChatStatus(`Message must be ${CHAT_MAX_TEXT_LENGTH} characters or less`, "error");
    return;
  }

  saveNickname();
  chatSendBtn.disabled = true;
  setChatStatus("Sending…", "loading");

  try {
    const client = getSupabaseClient();
    const hasNickname = await detectNicknameColumn(client);

    if (hasNickname) {
      const { error } = await client.from("messages").insert({ nickname, text });
      if (error) throw error;
    } else {
      const { data, error } = await client
        .from("messages")
        .insert({ text })
        .select("id, text, created_at")
        .single();

      if (error) throw error;

      if (data) {
        appendMessage({ ...data, nickname });
      }
    }

    chatInputEl.value = "";
    setChatStatus(hasNickname ? "Online" : "Run supabase-migration-nicknames.sql to save nicknames", hasNickname ? "" : "error");
  } catch (error) {
    setChatStatus(getChatErrorMessage(error), "error");
  } finally {
    chatSendBtn.disabled = false;
    chatInputEl.focus();
  }
}

function bindChatEvents() {
  if (!chatSendBtn || !chatInputEl) return;

  chatSendBtn.addEventListener("click", sendMessage);

  chatInputEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });

  chatNicknameEl?.addEventListener("change", saveNickname);
  chatNicknameEl?.addEventListener("blur", saveNickname);

  chatNotifyBtn?.addEventListener("click", requestNotificationPermission);
}

async function initChat() {
  if (chatInitialized) return;
  if (!chatMessagesEl) return;

  loadSavedNickname();
  bindChatEvents();
  updateNotifyButton();
  chatInitialized = true;

  if (!isChatConfigured()) {
    setChatStatus(
      "config.js not found — add Supabase keys to the repository",
      "error"
    );
    chatSendBtn.disabled = true;
    chatInputEl.disabled = true;
    if (chatNicknameEl) chatNicknameEl.disabled = true;
    return;
  }

  if (location.protocol === "file:") {
    setChatStatus(getChatErrorMessage({}), "error");
    chatSendBtn.disabled = true;
    chatInputEl.disabled = true;
    if (chatNicknameEl) chatNicknameEl.disabled = true;
    return;
  }

  setChatStatus("Connecting…", "loading");

  try {
    const client = getSupabaseClient();
    await loadRecentMessages(client);
    await bootstrapChatConnection();

    if (chatChannel && nicknameColumnSupported !== false) {
      setChatStatus("Online");
    }
  } catch (error) {
    console.error("Chat init error:", error);
    setChatStatus(getChatErrorMessage(error), "error");
    chatSendBtn.disabled = true;
    chatInputEl.disabled = true;
    if (chatNicknameEl) chatNicknameEl.disabled = true;
  }
}

window.initChat = initChat;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrapChatConnection);
} else {
  bootstrapChatConnection();
}

const CHAT_MESSAGE_LIMIT = 50;
const CHAT_MAX_TEXT_LENGTH = 500;
const CHAT_MAX_NICKNAME_LENGTH = 24;
const CHAT_NICKNAME_KEY = "chatNickname";

let supabaseClient = null;
let chatChannel = null;
let chatInitialized = false;
let knownMessageIds = new Set();

const chatMessagesEl = document.getElementById("chatMessages");
const chatNicknameEl = document.getElementById("chatNickname");
const chatInputEl = document.getElementById("chatInput");
const chatSendBtn = document.getElementById("chatSendBtn");
const chatStatusEl = document.getElementById("chatStatus");

function setChatStatus(message, type = "") {
  if (!chatStatusEl) return;
  chatStatusEl.textContent = message;
  chatStatusEl.className = "chat-status" + (type ? ` ${type}` : "");
}

function getChatErrorMessage(error) {
  if (location.protocol === "file:") {
    return "Chat does not work via file:// — run start-server.bat and open http://localhost:3000";
  }

  const message = String(error?.message ?? error ?? "");
  const code = String(error?.code ?? "");

  if (message.includes("nickname") || code === "42703") {
    return "Run supabase-migration-nicknames.sql in the Supabase SQL Editor";
  }

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
    return new Date(isoString).toLocaleString("en-US", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
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

  const nicknameEl = document.createElement("span");
  nicknameEl.className = "chat-message-nickname";
  nicknameEl.textContent = displayNickname(message.nickname);

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

async function loadRecentMessages(client) {
  const { data, error } = await client
    .from("messages")
    .select("id, nickname, text, created_at")
    .order("created_at", { ascending: false })
    .limit(CHAT_MESSAGE_LIMIT);

  if (error) throw error;

  clearChatMessages();

  const messages = (data ?? []).slice().reverse();
  messages.forEach((message) => appendMessage(message, false));

  scrollChatToBottom();
}

function subscribeToMessages(client) {
  if (chatChannel) return;

  chatChannel = client
    .channel("public:messages")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      (payload) => {
        if (payload.new) {
          appendMessage(payload.new);
        }
      }
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        setChatStatus("Online");
      } else if (status === "CHANNEL_ERROR") {
        setChatStatus("Connection error", "error");
      } else if (status === "TIMED_OUT") {
        setChatStatus("Connection timed out", "error");
      }
    });
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
    const { error } = await client.from("messages").insert({ nickname, text });

    if (error) throw error;

    chatInputEl.value = "";
    setChatStatus("Online");
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
}

async function initChat() {
  if (chatInitialized) return;
  if (!chatMessagesEl) return;

  loadSavedNickname();
  bindChatEvents();
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
    subscribeToMessages(client);
  } catch (error) {
    console.error("Chat init error:", error);
    setChatStatus(getChatErrorMessage(error), "error");
    chatSendBtn.disabled = true;
    chatInputEl.disabled = true;
    if (chatNicknameEl) chatNicknameEl.disabled = true;
  }
}

window.initChat = initChat;

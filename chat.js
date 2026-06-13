const CHAT_MESSAGE_LIMIT = 50;
const CHAT_MAX_TEXT_LENGTH = 500;

let supabaseClient = null;
let chatChannel = null;
let chatInitialized = false;
let knownMessageIds = new Set();

const chatMessagesEl = document.getElementById("chatMessages");
const chatInputEl = document.getElementById("chatInput");
const chatSendBtn = document.getElementById("chatSendBtn");
const chatStatusEl = document.getElementById("chatStatus");

function setChatStatus(message, type = "") {
  if (!chatStatusEl) return;
  chatStatusEl.textContent = message;
  chatStatusEl.className = "chat-status" + (type ? ` ${type}` : "");
}

function formatMessageTime(isoString) {
  try {
    return new Date(isoString).toLocaleString("ru-RU", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function scrollChatToBottom() {
  if (!chatMessagesEl) return;
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

function createMessageElement(message) {
  const item = document.createElement("div");
  item.className = "chat-message";
  item.dataset.messageId = String(message.id);

  const textEl = document.createElement("p");
  textEl.className = "chat-message-text";
  textEl.textContent = message.text;

  const timeEl = document.createElement("time");
  timeEl.className = "chat-message-time";
  timeEl.dateTime = message.created_at;
  timeEl.textContent = formatMessageTime(message.created_at);

  item.appendChild(textEl);
  item.appendChild(timeEl);
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
    throw new Error("Supabase SDK не загружен");
  }

  if (!isChatConfigured()) {
    throw new Error("Не настроен config.js");
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
    .select("id, text, created_at")
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
        setChatStatus("Онлайн");
      } else if (status === "CHANNEL_ERROR") {
        setChatStatus("Ошибка подключения", "error");
      } else if (status === "TIMED_OUT") {
        setChatStatus("Таймаут подключения", "error");
      }
    });
}

async function sendMessage() {
  if (!chatInputEl || !chatSendBtn) return;

  const text = chatInputEl.value.trim();
  if (!text) return;

  if (text.length > CHAT_MAX_TEXT_LENGTH) {
    setChatStatus(`Сообщение не длиннее ${CHAT_MAX_TEXT_LENGTH} символов`, "error");
    return;
  }

  chatSendBtn.disabled = true;
  setChatStatus("Отправка…", "loading");

  try {
    const client = getSupabaseClient();
    const { error } = await client.from("messages").insert({ text });

    if (error) throw error;

    chatInputEl.value = "";
    setChatStatus("Онлайн");
  } catch {
    setChatStatus("Не удалось отправить сообщение", "error");
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
}

async function initChat() {
  if (chatInitialized) return;
  if (!chatMessagesEl) return;

  bindChatEvents();
  chatInitialized = true;

  if (!isChatConfigured()) {
    setChatStatus("Скопируйте config.example.js в config.js и укажите ключи Supabase", "error");
    chatSendBtn.disabled = true;
    chatInputEl.disabled = true;
    return;
  }

  setChatStatus("Подключение…", "loading");

  try {
    const client = getSupabaseClient();
    await loadRecentMessages(client);
    subscribeToMessages(client);
  } catch {
    setChatStatus("Не удалось подключиться к чату", "error");
    chatSendBtn.disabled = true;
    chatInputEl.disabled = true;
  }
}

window.initChat = initChat;

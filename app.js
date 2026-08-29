const STORAGE_KEY = "ollama-gc-v1";

const defaultState = {
  settings: { baseUrl: "http://localhost:11434" },
  users: [],
  chats: [],
  activeChatId: null
};

let state = loadState();
let installedModels = [];
let busy = false;

const $ = (id) => document.getElementById(id);
const els = {
  chatList: $("chatList"),
  chatTitle: $("chatTitle"),
  chatSubtitle: $("chatSubtitle"),
  emptyState: $("emptyState"),
  chatView: $("chatView"),
  messages: $("messages"),
  messageInput: $("messageInput"),
  sendBtn: $("sendBtn"),
  askAllBtn: $("askAllBtn"),
  typingBar: $("typingBar"),
  ollamaStatus: $("ollamaStatus"),
  editChatBtn: $("editChatBtn"),
  modalBackdrop: $("modalBackdrop"),
  modal: $("modal")
};

function uid(prefix = "id") {
  return prefix + "_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!parsed) return structuredClone(defaultState);
    return {
      ...structuredClone(defaultState),
      ...parsed,
      settings: { ...defaultState.settings, ...(parsed.settings || {}) },
      users: Array.isArray(parsed.users) ? parsed.users : [],
      chats: Array.isArray(parsed.chats) ? parsed.chats : []
    };
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getActiveChat() {
  return state.chats.find(c => c.id === state.activeChatId) || null;
}

function getUser(id) {
  return state.users.find(u => u.id === id) || null;
}

function initials(name) {
  return (name || "?").trim().split(/\s+/).map(x => x[0]).join("").slice(0, 2).toUpperCase();
}

function escapeHtml(text = "") {
  return text.replace(/[&<>"']/g, ch => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
  })[ch]);
}

function render() {
  renderChatList();
  renderActiveChat();
}

function renderChatList() {
  els.chatList.innerHTML = "";
  if (!state.chats.length) {
    els.chatList.innerHTML = '<div class="muted" style="padding:8px">No chats yet.</div>';
    return;
  }
  [...state.chats].sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)).forEach(chat => {
    const b = document.createElement("button");
    b.className = "chat-item" + (chat.id === state.activeChatId ? " active" : "");
    b.textContent = chat.name || "Untitled chat";
    b.onclick = () => {
      state.activeChatId = chat.id;
      saveState();
      render();
    };
    els.chatList.appendChild(b);
  });
}

function renderActiveChat() {
  const chat = getActiveChat();
  if (!chat) {
    els.emptyState.classList.remove("hidden");
    els.chatView.classList.add("hidden");
    els.editChatBtn.classList.add("hidden");
    els.chatTitle.textContent = "Ollama GC";
    els.chatSubtitle.textContent = "Create a chat to get started.";
    return;
  }

  els.emptyState.classList.add("hidden");
  els.chatView.classList.remove("hidden");
  els.editChatBtn.classList.remove("hidden");

  const members = chat.userIds.map(getUser).filter(Boolean);
  els.chatTitle.textContent = chat.name || "Untitled chat";
  els.chatSubtitle.textContent = members.length ? members.map(u => u.name).join(", ") : "No AI users in this chat";

  els.messages.innerHTML = "";
  (chat.messages || []).forEach(msg => {
    const row = document.createElement("div");
    row.className = "message" + (msg.role === "human" ? " me" : "");
    let name = "You";
    let avatar = "YOU";
    if (msg.role === "assistant") {
      const user = getUser(msg.userId);
      name = user?.name || msg.name || "AI";
      avatar = initials(name);
    }
    const time = msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"}) : "";
    row.innerHTML = \`
      <div class="avatar">\${escapeHtml(avatar)}</div>
      <div>
        <div class="message-head">
          <span class="message-name">\${escapeHtml(name)}</span>
          <span class="message-time">\${escapeHtml(time)}</span>
        </div>
        <div class="message-body">\${escapeHtml(msg.content || "")}</div>
      </div>
    \`;
    els.messages.appendChild(row);
  });
  requestAnimationFrame(() => els.messages.scrollTop = els.messages.scrollHeight);
}

function showModal(html) {
  els.modal.innerHTML = html;
  els.modalBackdrop.classList.remove("hidden");
}

function closeModal() {
  els.modalBackdrop.classList.add("hidden");
  els.modal.innerHTML = "";
}

els.modalBackdrop.addEventListener("click", e => {
  if (e.target === els.modalBackdrop) closeModal();
});

function ensureUsersBeforeChat() {
  if (state.users.length) return true;
  openUsersModal(true);
  return false;
}

function openUsersModal(forceCreate = false) {
  if (forceCreate || !state.users.length) return openUserEditor();

  showModal(\`
    <h2>AI users</h2>
    <div id="userCards"></div>
    <div class="modal-actions">
      <button class="ghost" id="closeUsers">Close</button>
      <button class="primary" id="addUser">+ Create user</button>
    </div>
  \`);

  const cards = $("userCards");
  state.users.forEach(user => {
    const card = document.createElement("div");
    card.className = "user-card";
    card.innerHTML = \`
      <div>
        <strong>\${escapeHtml(user.name)}</strong>
        <small>\${escapeHtml(user.model || "No model")} · \${(user.memory || []).length} memories</small>
      </div>
      <div class="row">
        <button class="ghost edit-user">Edit</button>
        <button class="ghost memory-user">Memory</button>
      </div>
    \`;
    card.querySelector(".edit-user").onclick = () => openUserEditor(user.id);
    card.querySelector(".memory-user").onclick = () => openMemoryModal(user.id);
    cards.appendChild(card);
  });

  $("closeUsers").onclick = closeModal;
  $("addUser").onclick = () => openUserEditor();
}

function modelOptions(selected = "") {
  const models = [...new Set([selected, ...installedModels].filter(Boolean))];
  if (!models.length) return '<option value="">No models detected yet</option>';
  return models.map(m => \`<option value="\${escapeHtml(m)}" \${m===selected?"selected":""}>\${escapeHtml(m)}</option>\`).join("");
}

function openUserEditor(userId = null) {
  const existing = userId ? getUser(userId) : null;
  showModal(\`
    <h2>\${existing ? "Edit user" : "Create AI user"}</h2>
    <div class="form-group">
      <label>Name</label>
      <input id="userName" maxlength="40" value="\${escapeHtml(existing?.name || "")}" placeholder="e.g. Max" />
    </div>
    <div class="form-group">
      <label>Ollama model</label>
      <select id="userModel">\${modelOptions(existing?.model || "")}</select>
    </div>
    <div class="form-group">
      <label>Personality</label>
      <textarea id="userPersonality" placeholder="Describe how this person acts, talks, what they care about, etc.">\${escapeHtml(existing?.personality || "")}</textarea>
    </div>
    <div class="modal-actions">
      \${existing ? '<button id="deleteUser" class="ghost danger">Delete</button>' : ""}
      <button id="cancelUser" class="ghost">Cancel</button>
      <button id="saveUser" class="primary">Save user</button>
    </div>
  \`);

  $("cancelUser").onclick = () => openUsersModal();
  $("saveUser").onclick = () => {
    const name = $("userName").value.trim();
    const model = $("userModel").value.trim();
    const personality = $("userPersonality").value.trim();
    if (!name) return alert("Give the user a name.");
    if (!model) return alert("Pick an Ollama model.");

    if (existing) {
      existing.name = name;
      existing.model = model;
      existing.personality = personality;
    } else {
      state.users.push({
        id: uid("user"),
        name,
        model,
        personality,
        memory: [],
        createdAt: Date.now()
      });
    }
    saveState();
    render();
    openUsersModal();
  };

  if (existing) {
    $("deleteUser").onclick = () => {
      if (!confirm("Delete " + existing.name + "? Their memory will also be deleted.")) return;
      state.users = state.users.filter(u => u.id !== existing.id);
      state.chats.forEach(c => c.userIds = c.userIds.filter(id => id !== existing.id));
      saveState();
      render();
      openUsersModal();
    };
  }
}

function openMemoryModal(userId) {
  const user = getUser(userId);
  if (!user) return;
  showModal(\`
    <h2>\${escapeHtml(user.name)}'s cross-chat memory</h2>
    <p class="muted">These memories are shared across every chat this AI appears in.</p>
    <div class="form-group">
      <label>Memory, one item per line</label>
      <textarea id="memoryText" style="min-height:260px">\${escapeHtml((user.memory || []).join("\\n"))}</textarea>
    </div>
    <div class="modal-actions">
      <button id="clearMemory" class="ghost danger">Clear</button>
      <button id="cancelMemory" class="ghost">Cancel</button>
      <button id="saveMemory" class="primary">Save memory</button>
    </div>
  \`);
  $("cancelMemory").onclick = () => openUsersModal();
  $("clearMemory").onclick = () => {
    if (confirm("Clear all memory for " + user.name + "?")) $("memoryText").value = "";
  };
  $("saveMemory").onclick = () => {
    user.memory = $("memoryText").value.split("\\n").map(x=>x.trim()).filter(Boolean).slice(-80);
    saveState();
    openUsersModal();
  };
}

function openChatEditor(chatId = null) {
  if (!ensureUsersBeforeChat()) return;
  const chat = chatId ? state.chats.find(c=>c.id===chatId) : null;

  showModal(\`
    <h2>\${chat ? "Edit chat" : "New chat"}</h2>
    <div class="form-group">
      <label>Chat name</label>
      <input id="chatName" maxlength="60" value="\${escapeHtml(chat?.name || "")}" placeholder="Group chat name" />
    </div>
    <div class="form-group">
      <label>AI users in this chat</label>
      <div id="memberList" class="pill-list"></div>
    </div>
    <div class="modal-actions">
      \${chat ? '<button id="deleteChat" class="ghost danger">Delete chat</button>' : ""}
      <button id="cancelChat" class="ghost">Cancel</button>
      <button id="saveChat" class="primary">\${chat ? "Save" : "Create chat"}</button>
    </div>
  \`);

  const memberList = $("memberList");
  state.users.forEach(user => {
    const label = document.createElement("label");
    label.className = "pill";
    const checked = chat?.userIds?.includes(user.id) ? "checked" : "";
    label.innerHTML = \`<input type="checkbox" value="\${user.id}" \${checked}> \${escapeHtml(user.name)}\`;
    memberList.appendChild(label);
  });

  $("cancelChat").onclick = closeModal;
  $("saveChat").onclick = () => {
    const name = $("chatName").value.trim() || "Untitled chat";
    const userIds = [...memberList.querySelectorAll("input:checked")].map(x=>x.value);
    if (!userIds.length) return alert("Add at least one AI user.");

    if (chat) {
      chat.name = name;
      chat.userIds = userIds;
      chat.updatedAt = Date.now();
    } else {
      const newChat = {
        id: uid("chat"),
        name,
        userIds,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      state.chats.push(newChat);
      state.activeChatId = newChat.id;
    }
    saveState();
    closeModal();
    render();
  };

  if (chat) {
    $("deleteChat").onclick = () => {
      if (!confirm("Delete this chat?")) return;
      state.chats = state.chats.filter(c => c.id !== chat.id);
      if (state.activeChatId === chat.id) state.activeChatId = state.chats[0]?.id || null;
      saveState();
      closeModal();
      render();
    };
  }
}

function openSettings() {
  showModal(\`
    <h2>Settings</h2>
    <div class="form-group">
      <label>Ollama URL</label>
      <input id="baseUrl" value="\${escapeHtml(state.settings.baseUrl)}" />
    </div>
    <p class="muted">Usually <b>http://localhost:11434</b>. The app talks directly to Ollama from your browser.</p>
    <div class="modal-actions">
      <button id="exportData" class="ghost">Export data</button>
      <button id="clearData" class="ghost danger">Clear all</button>
      <button id="testOllama" class="ghost">Test connection</button>
      <button id="saveSettings" class="primary">Save</button>
    </div>
  \`);

  $("saveSettings").onclick = async () => {
    state.settings.baseUrl = $("baseUrl").value.trim().replace(/\\/$/, "");
    saveState();
    closeModal();
    await checkOllama();
  };
  $("testOllama").onclick = async () => {
    state.settings.baseUrl = $("baseUrl").value.trim().replace(/\\/$/, "");
    saveState();
    const ok = await checkOllama();
    alert(ok ? "Connected to Ollama." : "Couldn't reach Ollama.");
  };
  $("exportData").onclick = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], {type:"application/json"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "ollama-gc-backup.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  $("clearData").onclick = () => {
    if (!confirm("Delete every local user, chat, message, and memory?")) return;
    localStorage.removeItem(STORAGE_KEY);
    state = structuredClone(defaultState);
    closeModal();
    render();
  };
}

async function checkOllama() {
  const url = state.settings.baseUrl.replace(/\\/$/, "");
  try {
    const res = await fetch(url + "/api/tags");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    installedModels = (data.models || []).map(m => m.name).filter(Boolean);
    els.ollamaStatus.textContent = installedModels.length ? "Ollama connected · " + installedModels.length + " models" : "Ollama connected";
    els.ollamaStatus.classList.remove("offline");
    return true;
  } catch (err) {
    installedModels = [];
    els.ollamaStatus.textContent = "Ollama offline";
    els.ollamaStatus.classList.add("offline");
    return false;
  }
}

function buildSystemPrompt(user, chat) {
  const people = chat.userIds.map(getUser).filter(Boolean).map(u => {
    if (u.id === user.id) return \`\${u.name} (you)\`;
    return u.name;
  }).join(", ");

  const memory = (user.memory || []).slice(-40);
  return [
    \`You are \${user.name}, a participant in a casual group chat.\`,
    user.personality ? \`Your personality:\\n\${user.personality}\` : "",
    \`People/AIs in this chat: \${people}.\`,
    \`The human participant is named "You" in the transcript.\`,
    \`Reply as \${user.name} only. Do not write dialogue for other participants. Do not prefix your reply with your name.\`,
    \`Act like a real group-chat participant: respond naturally to the latest conversation, and do not force a response to every single detail.\`,
    memory.length ? \`Cross-chat memory about things you previously learned:\\n- \${memory.join("\\n- ")}\` : ""
  ].filter(Boolean).join("\\n\\n");
}

function transcriptFor(user, chat) {
  const recent = (chat.messages || []).slice(-36);
  return recent.map(msg => {
    if (msg.role === "human") return { role:"user", content:\`You: \${msg.content}\` };
    const speaker = getUser(msg.userId)?.name || msg.name || "AI";
    // Ollama roles only support assistant/user/system. Other AI messages are contextual transcript.
    if (msg.userId === user.id) return { role:"assistant", content: msg.content };
    return { role:"user", content:\`\${speaker}: \${msg.content}\` };
  });
}

async function callOllama(user, chat, extraInstruction = "") {
  const body = {
    model: user.model,
    stream: false,
    messages: [
      { role:"system", content: buildSystemPrompt(user, chat) + (extraInstruction ? "\\n\\n" + extraInstruction : "") },
      ...transcriptFor(user, chat)
    ],
    options: { temperature: 0.85 }
  };

  const res = await fetch(state.settings.baseUrl.replace(/\\/$/, "") + "/api/chat", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(body)
  });
  if (!res.ok) throw new Error("Ollama returned HTTP " + res.status);
  const data = await res.json();
  return (data.message?.content || "").trim();
}

async function updateMemory(user, chat) {
  const recent = (chat.messages || []).slice(-12);
  if (recent.length < 2) return;

  const transcript = recent.map(m => {
    const speaker = m.role === "human" ? "You" : (getUser(m.userId)?.name || "AI");
    return \`\${speaker}: \${m.content}\`;
  }).join("\\n");

  const existing = (user.memory || []).slice(-50).join("\\n- ");
  const prompt = \`You maintain long-term memory for \${user.name}. Extract only durable, useful facts \${user.name} would reasonably remember from this conversation: names, preferences, ongoing projects, relationships, promises, recurring jokes/context, important events. Ignore trivial one-off wording. Do not invent anything. Return JSON only in this exact format: {"memories":["fact 1","fact 2"]}. Return an empty array if nothing is worth remembering.

Existing memory:
- \${existing || "(none)"}

Recent group chat:
\${transcript}\`;

  try {
    const res = await fetch(state.settings.baseUrl.replace(/\\/$/, "") + "/api/chat", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        model:user.model,
        stream:false,
        format:"json",
        messages:[{role:"user",content:prompt}],
        options:{temperature:0.1}
      })
    });
    if (!res.ok) return;
    const data = await res.json();
    const parsed = JSON.parse(data.message?.content || "{}");
    const additions = Array.isArray(parsed.memories) ? parsed.memories.map(String).map(x=>x.trim()).filter(Boolean) : [];
    if (!additions.length) return;

    const merged = [...(user.memory || [])];
    for (const item of additions) {
      if (!merged.some(old => old.toLowerCase() === item.toLowerCase())) merged.push(item);
    }
    user.memory = merged.slice(-80);
    saveState();
  } catch {
    // Memory extraction should never break the chat.
  }
}

function setTyping(text = "") {
  els.typingBar.textContent = text;
  els.typingBar.classList.toggle("hidden", !text);
}

async function sendHumanMessage(forceEveryone = false) {
  if (busy) return;
  const chat = getActiveChat();
  if (!chat) return;

  const content = els.messageInput.value.trim();
  if (!content && !forceEveryone) return;

  if (content) {
    chat.messages.push({
      id:uid("msg"),
      role:"human",
      content,
      createdAt:Date.now()
    });
    els.messageInput.value = "";
    autoResize();
    chat.updatedAt = Date.now();
    saveState();
    render();
  }

  const users = chat.userIds.map(getUser).filter(Boolean);
  if (!users.length) return;

  busy = true;
  els.sendBtn.disabled = true;
  try {
    for (const user of users) {
      setTyping(user.name + " is thinking…");
      try {
        const response = await callOllama(
          user,
          chat,
          forceEveryone && !content
            ? "The human pressed a button asking everyone to continue/respond. Add a natural message to the current conversation."
            : ""
        );
        if (response) {
          chat.messages.push({
            id:uid("msg"),
            role:"assistant",
            userId:user.id,
            name:user.name,
            content:response,
            createdAt:Date.now()
          });
          chat.updatedAt = Date.now();
          saveState();
          render();
        }
      } catch (err) {
        chat.messages.push({
          id:uid("msg"),
          role:"assistant",
          userId:user.id,
          name:user.name,
          content:\`[Couldn't reach Ollama: \${err.message}]\`,
          createdAt:Date.now()
        });
        saveState();
        render();
      }
    }

    // Update each participant's cross-chat memory after the visible replies are done.
    setTyping("Updating memory…");
    await Promise.all(users.map(user => updateMemory(user, chat)));
  } finally {
    busy = false;
    els.sendBtn.disabled = false;
    setTyping("");
  }
}

function autoResize() {
  els.messageInput.style.height = "auto";
  els.messageInput.style.height = Math.min(180, els.messageInput.scrollHeight) + "px";
}

$("newChatBtn").onclick = () => openChatEditor();
$("emptyNewChatBtn").onclick = () => openChatEditor();
$("manageUsersBtn").onclick = () => openUsersModal();
$("settingsBtn").onclick = openSettings;
$("editChatBtn").onclick = () => {
  const chat = getActiveChat();
  if (chat) openChatEditor(chat.id);
};
els.sendBtn.onclick = () => sendHumanMessage(false);
els.askAllBtn.onclick = () => sendHumanMessage(true);
els.messageInput.addEventListener("input", autoResize);
els.messageInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendHumanMessage(false);
  }
});

render();
checkOllama();

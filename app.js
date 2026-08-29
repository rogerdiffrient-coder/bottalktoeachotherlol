const STORAGE_KEY = "ollama-gc-v2";

const defaultState = {
  settings: { baseUrl: "http://localhost:11434" },
  users: [],
  chats: [],
  activeChatId: null
};

let state = loadState();
let installedModels = [];
let busy = false;

const $ = id => document.getElementById(id);
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

function clone(x) { return JSON.parse(JSON.stringify(x)); }
function uid(prefix="id") { return prefix + "_" + Math.random().toString(36).slice(2,10) + Date.now().toString(36); }
function esc(s="") { return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c])); }

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem("ollama-gc-v1");
    if (!raw) return clone(defaultState);
    const p = JSON.parse(raw);
    const next = {
      ...clone(defaultState),
      ...p,
      settings: { ...defaultState.settings, ...(p.settings || {}) },
      users: Array.isArray(p.users) ? p.users : [],
      chats: Array.isArray(p.chats) ? p.chats : []
    };
    next.users.forEach(u => {
      if (typeof u.overview !== "string") {
        u.overview = Array.isArray(u.memory) && u.memory.length ? u.memory.join(" ") : "";
      }
      delete u.memory;
    });
    return next;
  } catch (e) {
    console.error("Failed to load state", e);
    return clone(defaultState);
  }
}

function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function getUser(id) { return state.users.find(u => u.id === id) || null; }
function getChat(id) { return state.chats.find(c => c.id === id) || null; }
function activeChat() { return getChat(state.activeChatId); }
function initials(name) { return (name||"?").trim().split(/\s+/).map(x=>x[0]).join("").slice(0,2).toUpperCase(); }

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
    b.addEventListener("click", () => {
      state.activeChatId = chat.id;
      saveState();
      render();
    });
    els.chatList.appendChild(b);
  });
}

function renderActiveChat() {
  const chat = activeChat();
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

  const members = (chat.userIds||[]).map(getUser).filter(Boolean);
  els.chatTitle.textContent = chat.name || "Untitled chat";
  els.chatSubtitle.textContent = members.map(u=>u.name).join(", ") || "No AI users";

  els.messages.innerHTML = "";
  (chat.messages||[]).forEach(msg => {
    const row = document.createElement("div");
    row.className = "message" + (msg.role === "human" ? " me" : "");
    const user = msg.role === "assistant" ? getUser(msg.userId) : null;
    const name = msg.role === "human" ? "You" : (user?.name || msg.name || "AI");
    const avatar = msg.role === "human" ? "YOU" : initials(name);
    const time = msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"}) : "";
    row.innerHTML =
      '<div class="avatar">'+esc(avatar)+'</div>' +
      '<div><div class="message-head"><span class="message-name">'+esc(name)+'</span>' +
      '<span class="message-time">'+esc(time)+'</span></div>' +
      '<div class="message-body">'+esc(msg.content||"")+'</div></div>';
    els.messages.appendChild(row);
  });
  requestAnimationFrame(()=>els.messages.scrollTop = els.messages.scrollHeight);
}

function showModal(html) {
  els.modal.innerHTML = html;
  els.modalBackdrop.classList.remove("hidden");
}
function closeModal() {
  els.modalBackdrop.classList.add("hidden");
  els.modal.innerHTML = "";
}
els.modalBackdrop.addEventListener("click", e => { if (e.target === els.modalBackdrop) closeModal(); });

function modelOptions(selected="") {
  const models = [...new Set([selected, ...installedModels].filter(Boolean))];
  if (!models.length) return '<option value="">No models detected</option>';
  return models.map(m => '<option value="'+esc(m)+'"'+(m===selected?' selected':'')+'>'+esc(m)+'</option>').join("");
}

function openUserEditor(userId=null) {
  const u = userId ? getUser(userId) : null;
  showModal(
    '<h2>'+(u?'Edit user':'Create AI user')+'</h2>' +
    '<div class="form-group"><label>Name</label><input id="userName" maxlength="40" value="'+esc(u?.name||"")+'" placeholder="e.g. MiniMax"></div>' +
    '<div class="form-group"><label>Ollama model</label><select id="userModel">'+modelOptions(u?.model||"")+'</select></div>' +
    '<div class="form-group"><label>Personality</label><textarea id="userPersonality" placeholder="How should this user act and talk?">'+esc(u?.personality||"")+'</textarea></div>' +
    '<div class="modal-actions">'+(u?'<button id="deleteUser" class="ghost danger">Delete</button>':'')+
    '<button id="cancelUser" class="ghost">Cancel</button><button id="saveUser" class="primary">Save user</button></div>'
  );

  $("cancelUser").onclick = openUsersModal;
  $("saveUser").onclick = () => {
    const name = $("userName").value.trim();
    const model = $("userModel").value.trim();
    const personality = $("userPersonality").value.trim();
    if (!name) return alert("Give the user a name.");
    if (!model) return alert("Pick an Ollama model.");
    if (u) Object.assign(u,{name,model,personality});
    else state.users.push({id:uid("user"),name,model,personality,overview:"",createdAt:Date.now()});
    saveState(); render(); openUsersModal();
  };
  if (u) $("deleteUser").onclick = () => {
    if (!confirm("Delete "+u.name+"?")) return;
    state.users = state.users.filter(x=>x.id!==u.id);
    state.chats.forEach(c=>c.userIds=(c.userIds||[]).filter(id=>id!==u.id));
    saveState(); render(); openUsersModal();
  };
}

function openOverview(userId) {
  const u = getUser(userId);
  if (!u) return;
  showModal(
    '<h2>'+esc(u.name)+'\'s remembrance</h2>' +
    '<p class="muted">One rolling overview of this AI\'s conversations across all chats. The AI can also use Remember to search the raw history.</p>' +
    '<div class="form-group"><label>Overview</label><textarea id="overviewText" style="min-height:280px">'+esc(u.overview||"")+'</textarea></div>' +
    '<div class="modal-actions"><button id="cancelOverview" class="ghost">Cancel</button><button id="saveOverview" class="primary">Save</button></div>'
  );
  $("cancelOverview").onclick = openUsersModal;
  $("saveOverview").onclick = () => { u.overview=$("overviewText").value.trim(); saveState(); openUsersModal(); };
}

function openUsersModal() {
  if (!state.users.length) return openUserEditor();
  showModal('<h2>AI users</h2><div id="userCards"></div><div class="modal-actions"><button id="closeUsers" class="ghost">Close</button><button id="addUser" class="primary">+ Create user</button></div>');
  const root = $("userCards");
  state.users.forEach(u => {
    const card = document.createElement("div");
    card.className = "user-card";
    card.innerHTML = '<div><strong>'+esc(u.name)+'</strong><small>'+esc(u.model||"No model")+' · '+(u.overview?'has remembrance':'no remembrance yet')+'</small></div><div class="row"><button class="ghost overview">Remembrance</button><button class="ghost edit">Edit</button></div>';
    card.querySelector(".edit").onclick = ()=>openUserEditor(u.id);
    card.querySelector(".overview").onclick = ()=>openOverview(u.id);
    root.appendChild(card);
  });
  $("closeUsers").onclick = closeModal;
  $("addUser").onclick = ()=>openUserEditor();
}

function openChatEditor(chatId=null) {
  if (!state.users.length) return openUserEditor();
  const c = chatId ? getChat(chatId) : null;
  showModal(
    '<h2>'+(c?'Edit chat':'New chat')+'</h2>' +
    '<div class="form-group"><label>Chat name</label><input id="chatName" maxlength="60" value="'+esc(c?.name||"")+'" placeholder="Group chat name"></div>' +
    '<div class="form-group"><label>AI users</label><div id="memberList" class="pill-list"></div></div>' +
    '<div class="modal-actions">'+(c?'<button id="deleteChat" class="ghost danger">Delete chat</button>':'')+
    '<button id="cancelChat" class="ghost">Cancel</button><button id="saveChat" class="primary">'+(c?'Save':'Create chat')+'</button></div>'
  );
  const list = $("memberList");
  state.users.forEach(u => {
    const label = document.createElement("label");
    label.className = "pill";
    label.innerHTML = '<input type="checkbox" value="'+esc(u.id)+'"'+(c?.userIds?.includes(u.id)?' checked':'')+'> '+esc(u.name);
    list.appendChild(label);
  });
  $("cancelChat").onclick = closeModal;
  $("saveChat").onclick = () => {
    const name = $("chatName").value.trim() || "Untitled chat";
    const userIds = [...list.querySelectorAll("input:checked")].map(x=>x.value);
    if (!userIds.length) return alert("Add at least one AI user.");
    if (c) Object.assign(c,{name,userIds,updatedAt:Date.now()});
    else {
      const n={id:uid("chat"),name,userIds,messages:[],createdAt:Date.now(),updatedAt:Date.now()};
      state.chats.push(n); state.activeChatId=n.id;
    }
    saveState(); closeModal(); render();
  };
  if (c) $("deleteChat").onclick = () => {
    if (!confirm("Delete this chat?")) return;
    state.chats = state.chats.filter(x=>x.id!==c.id);
    if (state.activeChatId===c.id) state.activeChatId=state.chats[0]?.id||null;
    saveState(); closeModal(); render();
  };
}

function openSettings() {
  showModal(
    '<h2>Settings</h2><div class="form-group"><label>Ollama URL</label><input id="baseUrl" value="'+esc(state.settings.baseUrl)+'"></div>' +
    '<p class="muted">Usually http://localhost:11434</p>' +
    '<div class="modal-actions"><button id="clearData" class="ghost danger">Clear all</button><button id="testOllama" class="ghost">Test connection</button><button id="saveSettings" class="primary">Save</button></div>'
  );
  $("saveSettings").onclick = async()=>{ state.settings.baseUrl=$("baseUrl").value.trim().replace(/\/$/,""); saveState(); closeModal(); await checkOllama(); };
  $("testOllama").onclick = async()=>{ state.settings.baseUrl=$("baseUrl").value.trim().replace(/\/$/,""); saveState(); alert(await checkOllama() ? "Connected." : "Could not reach Ollama."); };
  $("clearData").onclick = ()=>{ if(confirm("Delete every local user, chat, message, and overview?")){ localStorage.removeItem(STORAGE_KEY); localStorage.removeItem("ollama-gc-v1"); state=clone(defaultState); closeModal(); render(); } };
}

async function checkOllama() {
  try {
    const r = await fetch(state.settings.baseUrl.replace(/\/$/,"")+"/api/tags");
    if (!r.ok) throw new Error("HTTP "+r.status);
    const d = await r.json();
    installedModels=(d.models||[]).map(m=>m.name).filter(Boolean);
    els.ollamaStatus.textContent="Ollama connected · "+installedModels.length+" models";
    els.ollamaStatus.classList.remove("offline");
    return true;
  } catch(e) {
    console.error(e);
    installedModels=[];
    els.ollamaStatus.textContent="Ollama offline";
    els.ollamaStatus.classList.add("offline");
    return false;
  }
}

function allTranscriptLines() {
  const lines=[];
  state.chats.forEach(c => (c.messages||[]).forEach(m => {
    const speaker = m.role==="human" ? "You" : (getUser(m.userId)?.name || m.name || "AI");
    lines.push({chat:c.name||"Untitled",speaker,text:m.content||"",at:m.createdAt||0});
  }));
  return lines.sort((a,b)=>a.at-b.at);
}

function searchAllChats(query, limit=24) {
  const terms = String(query||"").toLowerCase().split(/\s+/).filter(x=>x.length>2);
  const lines = allTranscriptLines();
  if (!terms.length) return lines.slice(-limit);
  return lines
    .map(x=>({x,score:terms.reduce((s,t)=>s+(x.text.toLowerCase().includes(t)?2:0)+(x.speaker.toLowerCase().includes(t)?1:0)+(x.chat.toLowerCase().includes(t)?1:0),0)}))
    .filter(o=>o.score>0)
    .sort((a,b)=>b.score-a.score || b.x.at-a.x.at)
    .slice(0,limit)
    .map(o=>o.x);
}

function buildSystem(u,c) {
  const participants=(c.userIds||[]).map(getUser).filter(Boolean).map(x=>x.id===u.id?x.name+" (you)":x.name).join(", ");
  return [
    "You are "+u.name+", a participant in a casual group chat.",
    u.personality ? "Your personality:\n"+u.personality : "",
    "Participants: "+participants+".",
    "Reply only as "+u.name+". Do not write dialogue for anyone else and do not prefix replies with your name.",
    "Your remembrance is a broad rolling overview, not a list of isolated facts:\n"+(u.overview||"(No overview yet.)"),
    "You have a Remember tool. If you need a specific detail from any earlier chat that is not clear in the overview, output exactly [[REMEMBER: search words]] and nothing else. The app will search all chats and give you matching history, then you can answer normally."
  ].filter(Boolean).join("\n\n");
}

function recentMessages(u,c) {
  return (c.messages||[]).slice(-32).map(m => {
    if (m.role==="human") return {role:"user",content:"You: "+m.content};
    const speaker=getUser(m.userId)?.name||m.name||"AI";
    return m.userId===u.id ? {role:"assistant",content:m.content} : {role:"user",content:speaker+": "+m.content};
  });
}

async function rawChat(model,messages,opts={}) {
  const r = await fetch(state.settings.baseUrl.replace(/\/$/,"")+"/api/chat", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({model,stream:false,messages,options:{temperature:opts.temperature ?? 0.8}, ...(opts.format?{format:opts.format}:{})})
  });
  if (!r.ok) throw new Error("HTTP "+r.status);
  const d=await r.json();
  return (d.message?.content||"").trim();
}

async function callUser(u,c,extra="") {
  let out=await rawChat(u.model,[{role:"system",content:buildSystem(u,c)+(extra?"\n\n"+extra:"")},...recentMessages(u,c)]);
  const match=out.match(/^\[\[REMEMBER:\s*(.*?)\s*\]\]$/i);
  if (match) {
    const found=searchAllChats(match[1],28);
    const memoryText=found.length ? found.map(x=>"["+x.chat+"] "+x.speaker+": "+x.text).join("\n") : "(No matching history found.)";
    out=await rawChat(u.model,[
      {role:"system",content:buildSystem(u,c)},
      ...recentMessages(u,c),
      {role:"user",content:"Remember search results for \""+match[1]+"\":\n"+memoryText+"\n\nNow answer the current conversation normally."}
    ]);
  }
  return out;
}

async function updateOverview(u) {
  const history = allTranscriptLines().filter(x => {
    const relevantChats=state.chats.filter(c=>(c.userIds||[]).includes(u.id)).map(c=>c.name||"Untitled");
    return relevantChats.includes(x.chat);
  }).slice(-80);
  if (!history.length) return;
  const transcript=history.map(x=>"["+x.chat+"] "+x.speaker+": "+x.text).join("\n");
  const prompt =
    "Rewrite "+u.name+"'s remembrance as ONE concise overview of their conversations so far. " +
    "It should summarize important people, ongoing topics/projects, relationships, preferences, recurring jokes, and notable events. " +
    "Do not make a bullet list of atomic facts. Keep useful context, drop trivial details, and do not invent anything.\n\n" +
    "Previous overview:\n"+(u.overview||"(none)")+"\n\nRecent conversation history:\n"+transcript;
  try {
    u.overview=await rawChat(u.model,[{role:"user",content:prompt}],{temperature:0.2});
    saveState();
  } catch(e) { console.warn("Overview update failed",e); }
}

function setTyping(t="") {
  els.typingBar.textContent=t;
  els.typingBar.classList.toggle("hidden",!t);
}

async function respondAll(extra="") {
  const c=activeChat();
  if (!c || busy) return;
  const users=(c.userIds||[]).map(getUser).filter(Boolean);
  if (!users.length) return;
  busy=true; els.sendBtn.disabled=true;
  try {
    for (const u of users) {
      setTyping(u.name+" is thinking…");
      try {
        const text=await callUser(u,c,extra);
        if (text) c.messages.push({id:uid("msg"),role:"assistant",userId:u.id,name:u.name,content:text,createdAt:Date.now()});
      } catch(e) {
        c.messages.push({id:uid("msg"),role:"assistant",userId:u.id,name:u.name,content:"[Ollama error: "+e.message+"]",createdAt:Date.now()});
      }
      c.updatedAt=Date.now(); saveState(); render();
    }
    setTyping("Updating remembrance…");
    await Promise.all(users.map(updateOverview));
  } finally {
    busy=false; els.sendBtn.disabled=false; setTyping("");
  }
}

async function sendMessage() {
  const c=activeChat();
  if (!c || busy) return;
  const text=els.messageInput.value.trim();
  if (!text) return;
  c.messages.push({id:uid("msg"),role:"human",content:text,createdAt:Date.now()});
  c.updatedAt=Date.now();
  els.messageInput.value="";
  autoResize();
  saveState(); render();
  await respondAll();
}

async function rememberNow() {
  const c=activeChat();
  if (!c || busy) return;
  const q=els.messageInput.value.trim() || (c.messages||[]).filter(m=>m.role==="human").slice(-1)[0]?.content || "";
  await respondAll("The human explicitly pressed Remember. Search across all chats if useful for this topic: "+q);
}

function autoResize() {
  els.messageInput.style.height="auto";
  els.messageInput.style.height=Math.min(180,els.messageInput.scrollHeight)+"px";
}

$("newChatBtn").onclick=()=>openChatEditor();
$("emptyNewChatBtn").onclick=()=>openChatEditor();
$("manageUsersBtn").onclick=openUsersModal;
$("settingsBtn").onclick=openSettings;
els.editChatBtn.onclick=()=>{ const c=activeChat(); if(c) openChatEditor(c.id); };
els.sendBtn.onclick=sendMessage;
els.askAllBtn.textContent="Remember";
els.askAllBtn.onclick=rememberNow;
els.messageInput.addEventListener("input",autoResize);
els.messageInput.addEventListener("keydown",e=>{ if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage();} });

render();
checkOllama();

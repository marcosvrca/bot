import { createManageController } from "./manage.js";

const STORAGE_KEY = "mvflow-dashboard-auth";

const els = {
  gate: document.getElementById("gate"),
  app: document.getElementById("app"),
  form: document.getElementById("login-form"),
  gateError: document.getElementById("gate-error"),
  slug: document.getElementById("slug"),
  secret: document.getElementById("secret"),
  tenantName: document.getElementById("tenant-name"),
  tenantMeta: document.getElementById("tenant-meta"),
  status: document.getElementById("status-line"),
  metrics: document.getElementById("metrics"),
  recentLeads: document.getElementById("recent-leads"),
  origins: document.getElementById("origins"),
  refreshBtn: document.getElementById("refresh-btn"),
  logoutBtn: document.getElementById("logout-btn"),
  channelBadge: document.getElementById("channel-badge"),
  channelConnectBtn: document.getElementById("channel-connect-btn"),
  channelDialog: document.getElementById("channel-dialog"),
  channelDialogStatus: document.getElementById("channel-dialog-status"),
  channelQr: document.getElementById("channel-qr"),
  channelQrEmpty: document.getElementById("channel-qr-empty"),
  channelRefreshQrBtn: document.getElementById("channel-refresh-qr-btn"),
  channelLogoutBtn: document.getElementById("channel-logout-btn"),
  channelCloseBtn: document.getElementById("channel-close-btn"),
  chatList: document.getElementById("chat-list"),
  chatSearch: document.getElementById("chat-search"),
  chatEmpty: document.getElementById("chat-empty"),
  chatActive: document.getElementById("chat-active"),
  chatTitle: document.getElementById("chat-title"),
  chatSubtitle: document.getElementById("chat-subtitle"),
  chatMode: document.getElementById("chat-mode"),
  chatTakeoverBtn: document.getElementById("chat-takeover-btn"),
  chatReleaseBtn: document.getElementById("chat-release-btn"),
  chatThread: document.getElementById("chat-thread"),
  chatCompose: document.getElementById("chat-compose"),
  chatInput: document.getElementById("chat-input"),
  chatSend: document.getElementById("chat-send"),
};

let auth = loadAuth();
let refreshTimer = null;
let chatPollTimer = null;
let channelPollTimer = null;
let conversations = [];
let selectedPhone = null;
let currentThread = null;
let activeTab = "overview";
let manage = null;

function loadAuth() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveAuth(next) {
  auth = next;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

function clearAuth() {
  auth = null;
  sessionStorage.removeItem(STORAGE_KEY);
}

function fmtDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function fmtTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function apiUrl(path) {
  return `/api/dashboard/${encodeURIComponent(auth.slug)}${path}`;
}

async function api(path, options = {}) {
  const res = await fetch(path.startsWith("/api/") ? path : apiUrl(path), {
    ...options,
    headers: {
      "x-webhook-secret": auth.secret,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.message || body.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

manage = createManageController({
  api,
  setStatus: (msg) => {
    els.status.textContent = msg;
  },
  fmtDate,
});

function showGate(message) {
  els.gate.hidden = false;
  els.app.hidden = true;
  document.body.classList.add("is-login");
  document.body.classList.remove("is-app");
  stopPolling();
  if (message) {
    els.gateError.hidden = false;
    els.gateError.textContent = message;
  } else {
    els.gateError.hidden = true;
    els.gateError.textContent = "";
  }
}

function showApp() {
  els.gate.hidden = true;
  els.app.hidden = false;
  document.body.classList.remove("is-login");
  document.body.classList.add("is-app");
  els.gateError.hidden = true;
}

function stopPolling() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  if (chatPollTimer) {
    clearInterval(chatPollTimer);
    chatPollTimer = null;
  }
  stopChannelPoll();
}

function stopChannelPoll() {
  if (channelPollTimer) {
    clearInterval(channelPollTimer);
    channelPollTimer = null;
  }
}

function renderChannelBadge(status) {
  const state = status?.state || "unknown";
  const labels = {
    open: "Canal: conectado",
    connecting: "Canal: aguardando QR",
    close: "Canal: desconectado",
    unknown: "Canal: offline",
  };
  els.channelBadge.textContent = labels[state] || labels.unknown;
  els.channelBadge.className = `channel-badge ${state}`;
  els.channelConnectBtn.textContent =
    state === "open" ? "Gerenciar canal" : "Conectar canal";
}

async function refreshChannelStatus(silent = false) {
  try {
    const status = await api("/channel");
    renderChannelBadge(status);
    return status;
  } catch (err) {
    renderChannelBadge({ state: "unknown" });
    if (!silent) els.status.textContent = `Canal: ${err.message}`;
    return null;
  }
}

function showQr(base64) {
  if (base64) {
    els.channelQr.src = base64;
    els.channelQr.hidden = false;
    els.channelQrEmpty.hidden = true;
  } else {
    els.channelQr.hidden = true;
    els.channelQrEmpty.hidden = false;
    els.channelQrEmpty.textContent = "QR indisponível no momento. Tente atualizar.";
  }
}

async function connectChannel() {
  els.channelDialogStatus.textContent = "Solicitando QR Code na Evolution…";
  showQr(null);
  els.channelQrEmpty.textContent = "Gerando QR…";
  els.channelDialog.showModal();

  try {
    const result = await api("/channel/connect", { method: "POST", body: "{}" });
    renderChannelBadge(result);

    if (result.state === "open") {
      els.channelDialogStatus.textContent = "WhatsApp já está conectado nesta instância.";
      showQr(null);
      els.channelQrEmpty.textContent = "Canal online.";
      stopChannelPoll();
      return;
    }

    if (result.qrcode) {
      els.channelDialogStatus.textContent =
        "Escaneie o QR Code com o WhatsApp. Atualizamos o status automaticamente.";
      showQr(result.qrcode);
    } else {
      els.channelDialogStatus.textContent =
        "Instância pronta, mas o QR ainda não veio. Clique em Atualizar QR.";
      showQr(null);
    }

    stopChannelPoll();
    channelPollTimer = setInterval(async () => {
      try {
        const status = await api("/channel");
        renderChannelBadge(status);
        if (status.state === "open") {
          els.channelDialogStatus.textContent = "Conectado com sucesso!";
          showQr(null);
          els.channelQrEmpty.textContent = "Canal online.";
          stopChannelPoll();
        } else if (status.state === "connecting") {
          // tenta renovar QR periodicamente
          const again = await api("/channel/connect", { method: "POST", body: "{}" });
          if (again.qrcode) showQr(again.qrcode);
        }
      } catch {
        /* ignore poll errors */
      }
    }, 4000);
  } catch (err) {
    els.channelDialogStatus.textContent = err.message;
    showQr(null);
    els.channelQrEmpty.textContent = "Falha ao obter QR.";
  }
}

async function logoutChannel() {
  if (!confirm("Desconectar o WhatsApp desta instância?")) return;
  try {
    const status = await api("/channel/logout", { method: "POST", body: "{}" });
    renderChannelBadge(status);
    els.channelDialogStatus.textContent = "WhatsApp desconectado.";
    showQr(null);
    els.channelQrEmpty.textContent = "Desconectado. Clique em Atualizar QR para reconectar.";
    stopChannelPoll();
  } catch (err) {
    els.channelDialogStatus.textContent = err.message;
  }
}

async function setTab(name) {
  activeTab = name;
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === name);
  });
  document.querySelectorAll(".panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `panel-${name}`);
  });

  try {
    if (name === "messages") {
      await refreshInbox();
      if (!chatPollTimer) {
        chatPollTimer = setInterval(() => {
          if (activeTab === "messages") refreshInbox(true);
        }, 5000);
      }
    } else if (name === "menu") {
      await manage.loadMenu();
    } else if (name === "catalog") {
      await manage.loadCatalog();
    } else if (name === "settings") {
      await manage.loadSettings();
    } else if (name === "leads") {
      const data = await api("/leads?limit=100");
      manage.renderLeads(data.leads || []);
    } else if (name === "appointments") {
      const data = await api("/appointments?limit=100");
      manage.renderAppointments(data.appointments || []);
    }
  } catch (err) {
    els.status.textContent = err.message;
  }
}

function renderMetrics(metrics) {
  const cards = [
    ["Leads hoje", metrics.leadsToday],
    ["Leads (7 dias)", metrics.leadsWeek],
    ["Leads total", metrics.leadsTotal],
    ["Mensagens (7 dias)", metrics.messagesWeek],
    ["Contatos (7 dias)", metrics.contactsWeek],
    ["Agenda futura", metrics.appointmentsUpcoming],
    ["Confirmados", metrics.appointmentsConfirmed],
    ["Itens no catálogo", metrics.catalogActive],
    ["Sessões (24h)", metrics.sessionsActive],
  ];
  els.metrics.innerHTML = cards
    .map(
      ([label, value]) =>
        `<article class="metric"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></article>`,
    )
    .join("");
}

function renderRecentLeads(items) {
  if (!items.length) {
    els.recentLeads.innerHTML = `<p class="empty">Nenhum lead ainda.</p>`;
    return;
  }
  els.recentLeads.innerHTML = items
    .map(
      (lead) => `
      <div class="row">
        <div>
          <strong>${escapeHtml(lead.name)}</strong><br />
          <span class="muted">${escapeHtml(lead.interest || "Sem interesse")} · ${escapeHtml(lead.phone)}</span>
        </div>
        <span class="muted">${escapeHtml(fmtDate(lead.createdAt))}</span>
      </div>`,
    )
    .join("");
}

function renderOrigins(items) {
  if (!items.length) {
    els.origins.innerHTML = `<p class="empty">Sem dados nos últimos 7 dias.</p>`;
    return;
  }
  els.origins.innerHTML = items
    .map(
      (row) => `
      <div class="row">
        <strong>${escapeHtml(row.origin)}</strong>
        <span>${escapeHtml(row.count)}</span>
      </div>`,
    )
    .join("");
}

function filteredConversations() {
  const q = (els.chatSearch.value || "").trim().toLowerCase();
  if (!q) return conversations;
  return conversations.filter((c) => {
    const hay = `${c.displayName} ${c.phone} ${c.lastMessage || ""} ${c.interest || ""}`.toLowerCase();
    return hay.includes(q);
  });
}

function renderChatList() {
  const items = filteredConversations();
  if (!items.length) {
    els.chatList.innerHTML = `<p class="empty" style="padding:1rem">Nenhuma conversa ainda.</p>`;
    return;
  }
  els.chatList.innerHTML = items
    .map((c) => {
      const active = c.phone === selectedPhone ? "active" : "";
      const pills = [
        c.humanTakeover
          ? `<span class="wa-pill human">Humano</span>`
          : `<span class="wa-pill">Bot</span>`,
      ].join("");
      return `
        <button type="button" class="wa-item ${active}" data-phone="${escapeHtml(c.phone)}">
          <div class="wa-item-top">
            <strong>${escapeHtml(c.displayName)}</strong>
            <time>${escapeHtml(fmtTime(c.lastAt))}</time>
          </div>
          <div class="wa-item-preview">${escapeHtml(c.lastMessage || "")}</div>
          <div class="wa-item-tags">${pills}</div>
        </button>`;
    })
    .join("");

  els.chatList.querySelectorAll(".wa-item").forEach((btn) => {
    btn.addEventListener("click", () => openConversation(btn.dataset.phone));
  });
}

function renderThread(thread) {
  currentThread = thread;
  const atBottom =
    els.chatThread.scrollHeight - els.chatThread.scrollTop - els.chatThread.clientHeight < 80;

  els.chatEmpty.hidden = true;
  els.chatActive.hidden = false;
  els.chatTitle.textContent = thread.displayName;
  const bits = [thread.phone];
  if (thread.lead?.interest) bits.push(thread.lead.interest);
  if (thread.model) bits.push(`modelo: ${thread.model}`);
  els.chatSubtitle.textContent = bits.join(" · ");

  const human = Boolean(thread.humanTakeover);
  els.chatMode.textContent = human ? "Atendimento humano" : "Bot ativo";
  els.chatMode.classList.toggle("human", human);
  els.chatTakeoverBtn.hidden = human;
  els.chatReleaseBtn.hidden = !human;

  els.chatThread.innerHTML = (thread.messages || [])
    .map((msg) => {
      const dir = msg.direction === "inbound" ? "in" : "out";
      return `
        <div class="wa-bubble ${dir}">
          ${escapeHtml(msg.body || "")}
          <time>${escapeHtml(fmtDate(msg.createdAt))}</time>
        </div>`;
    })
    .join("");

  if (atBottom || !els.chatThread.dataset.ready) {
    els.chatThread.scrollTop = els.chatThread.scrollHeight;
    els.chatThread.dataset.ready = "1";
  }
}

async function openConversation(phone) {
  selectedPhone = phone;
  renderChatList();
  const thread = await api(`/conversations/${encodeURIComponent(phone)}?limit=200`);
  renderThread(thread);
}

async function refreshInbox(silent = false) {
  if (!auth) return;
  const data = await api("/conversations?limit=60");
  conversations = data.conversations || [];
  renderChatList();
  if (selectedPhone && conversations.some((c) => c.phone === selectedPhone)) {
    const thread = await api(`/conversations/${encodeURIComponent(selectedPhone)}?limit=200`);
    renderThread(thread);
  }
  if (!silent) {
    els.status.textContent = `Inbox atualizado às ${fmtDate(new Date().toISOString())}`;
  }
}

async function setTakeover(enabled) {
  if (!selectedPhone) return;
  await api(`/conversations/${encodeURIComponent(selectedPhone)}/takeover`, {
    method: "POST",
    body: JSON.stringify({ enabled }),
  });
  await openConversation(selectedPhone);
  await refreshInbox(true);
  els.status.textContent = enabled
    ? "Você assumiu o atendimento. O bot está pausado neste contato."
    : "Bot reativado neste contato.";
}

async function sendReply(event) {
  event.preventDefault();
  if (!selectedPhone) return;
  const text = els.chatInput.value.trim();
  if (!text) return;
  els.chatSend.disabled = true;
  try {
    const result = await api(`/conversations/${encodeURIComponent(selectedPhone)}/reply`, {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    els.chatInput.value = "";
    if (result.thread) renderThread(result.thread);
    await refreshInbox(true);
    els.status.textContent = "Mensagem enviada.";
  } finally {
    els.chatSend.disabled = false;
    els.chatInput.focus();
  }
}

async function refresh() {
  if (!auth) return;
  els.status.textContent = "Atualizando…";
  try {
    const overview = await api("/overview");
    els.tenantName.textContent = overview.tenant.name;
    els.tenantMeta.textContent = `${overview.tenant.slug} · ${overview.tenant.instance || "sem instância"} · modelos: ${(overview.tenant.activeModels || []).join(", ")}`;
    renderMetrics(overview.metrics);
    renderRecentLeads(overview.recentLeads || []);
    renderOrigins(overview.leadsByOrigin || []);
    await refreshChannelStatus(true);

    if (activeTab === "messages") await refreshInbox(true);
    if (activeTab === "leads") {
      const data = await api("/leads?limit=100");
      manage.renderLeads(data.leads || []);
    }
    if (activeTab === "appointments") {
      const data = await api("/appointments?limit=100");
      manage.renderAppointments(data.appointments || []);
    }
    if (activeTab === "catalog") await manage.loadCatalog();

    els.status.textContent = `Atualizado às ${fmtDate(overview.generatedAt)}`;
  } catch (err) {
    if (err.status === 401 || err.status === 404) {
      clearAuth();
      showGate(err.status === 401 ? "Segredo inválido." : "Tenant não encontrado.");
      return;
    }
    els.status.textContent = `Erro ao atualizar: ${err.message}`;
  }
}

function startSession() {
  showApp();
  refresh();
  stopPolling();
  refreshTimer = setInterval(refresh, 30_000);
}

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const slug = els.slug.value.trim();
  const secret = els.secret.value.trim();
  if (!slug || !secret) return;
  saveAuth({ slug, secret });
  try {
    await api("/overview");
    startSession();
  } catch (err) {
    clearAuth();
    showGate(
      err.status === 401
        ? "Segredo inválido."
        : err.status === 404
          ? "Tenant não encontrado."
          : err.message,
    );
  }
});

els.refreshBtn.addEventListener("click", () => refresh());
els.logoutBtn.addEventListener("click", () => {
  clearAuth();
  selectedPhone = null;
  conversations = [];
  showGate();
});
els.channelConnectBtn.addEventListener("click", () =>
  connectChannel().catch((e) => {
    els.status.textContent = e.message;
  }),
);
els.channelRefreshQrBtn.addEventListener("click", () =>
  connectChannel().catch((e) => {
    els.channelDialogStatus.textContent = e.message;
  }),
);
els.channelLogoutBtn.addEventListener("click", () =>
  logoutChannel().catch((e) => {
    els.channelDialogStatus.textContent = e.message;
  }),
);
els.channelCloseBtn.addEventListener("click", () => {
  stopChannelPoll();
  els.channelDialog.close();
});
els.channelDialog.addEventListener("close", () => stopChannelPoll());

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => setTab(btn.dataset.tab));
});

els.chatSearch.addEventListener("input", () => renderChatList());
els.chatTakeoverBtn.addEventListener("click", () =>
  setTakeover(true).catch((e) => {
    els.status.textContent = e.message;
  }),
);
els.chatReleaseBtn.addEventListener("click", () =>
  setTakeover(false).catch((e) => {
    els.status.textContent = e.message;
  }),
);
els.chatCompose.addEventListener("submit", (e) =>
  sendReply(e).catch((err) => {
    els.status.textContent = err.message;
  }),
);
els.chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    els.chatCompose.requestSubmit();
  }
});

if (auth?.slug && auth?.secret) {
  els.slug.value = auth.slug;
  startSession();
}

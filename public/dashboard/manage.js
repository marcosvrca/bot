function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fmtMoney(cents) {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function createManageController({ api, setStatus, fmtDate }) {
  let menuFlow = { start: "root", nodes: {} };
  let selectedNodeId = null;
  let catalogItems = [];
  let leadsCache = [];

  const els = {
    menuStart: document.getElementById("menu-start"),
    menuNodeList: document.getElementById("menu-node-list"),
    menuForm: document.getElementById("menu-node-form"),
    menuEditingId: document.getElementById("menu-editing-id"),
    menuNodeId: document.getElementById("menu-node-id"),
    menuNodeType: document.getElementById("menu-node-type"),
    menuNodeTitle: document.getElementById("menu-node-title"),
    menuNodeBody: document.getElementById("menu-node-body"),
    menuNodeOptions: document.getElementById("menu-node-options"),
    menuNodeNext: document.getElementById("menu-node-next"),
    menuNodeModel: document.getElementById("menu-node-model"),
    menuNodeSeed: document.getElementById("menu-node-seed"),
    menuFieldsMenu: document.getElementById("menu-fields-menu"),
    menuFieldsMessage: document.getElementById("menu-fields-message"),
    menuFieldsModel: document.getElementById("menu-fields-model"),
    menuAddBtn: document.getElementById("menu-add-btn"),
    menuResetBtn: document.getElementById("menu-reset-btn"),
    menuSaveBtn: document.getElementById("menu-save-btn"),
    menuDeleteNodeBtn: document.getElementById("menu-delete-node-btn"),
    catalogForm: document.getElementById("catalog-form"),
    catalogId: document.getElementById("catalog-id"),
    catalogName: document.getElementById("catalog-name"),
    catalogPrice: document.getElementById("catalog-price"),
    catalogCategory: document.getElementById("catalog-category"),
    catalogSku: document.getElementById("catalog-sku"),
    catalogSort: document.getElementById("catalog-sort"),
    catalogActive: document.getElementById("catalog-active"),
    catalogDescription: document.getElementById("catalog-description"),
    catalogBody: document.getElementById("catalog-body"),
    catalogNewBtn: document.getElementById("catalog-new-btn"),
    catalogCancelBtn: document.getElementById("catalog-cancel-btn"),
    leadsBody: document.getElementById("leads-body"),
    appointmentsBody: document.getElementById("appointments-body"),
    settingsForm: document.getElementById("settings-form"),
    settingsName: document.getElementById("settings-name"),
    settingsInstance: document.getElementById("settings-instance"),
    settingsDefaultModel: document.getElementById("settings-default-model"),
    settingsWebhook: document.getElementById("settings-webhook"),
    settingsOwners: document.getElementById("settings-owners"),
    settingsModels: document.getElementById("settings-models"),
    leadDialog: document.getElementById("lead-dialog"),
    leadForm: document.getElementById("lead-form"),
    leadId: document.getElementById("lead-id"),
    leadName: document.getElementById("lead-name"),
    leadStatus: document.getElementById("lead-status"),
    leadEmail: document.getElementById("lead-email"),
    leadCity: document.getElementById("lead-city"),
    leadInterest: document.getElementById("lead-interest"),
    leadNotes: document.getElementById("lead-notes"),
    leadCancelBtn: document.getElementById("lead-cancel-btn"),
  };

  function syncTypeFields() {
    const type = els.menuNodeType.value;
    els.menuFieldsMenu.hidden = type !== "menu";
    els.menuFieldsMessage.hidden = type !== "message";
    els.menuFieldsModel.hidden = type !== "model";
  }

  function optionsToText(options = []) {
    return options.map((o) => `${o.key} | ${o.label} | ${o.next}`).join("\n");
  }

  function textToOptions(raw) {
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [key, label, next] = line.split("|").map((p) => p.trim());
        return { key, label, next };
      })
      .filter((o) => o.key && o.label && o.next);
  }

  function renderMenuStart() {
    const ids = Object.keys(menuFlow.nodes);
    els.menuStart.innerHTML = ids
      .map(
        (id) =>
          `<option value="${escapeHtml(id)}" ${id === menuFlow.start ? "selected" : ""}>${escapeHtml(id)}</option>`,
      )
      .join("");
  }

  function renderMenuList() {
    const ids = Object.keys(menuFlow.nodes);
    if (!ids.length) {
      els.menuNodeList.innerHTML = `<p class="empty">Nenhum nó. Clique em Novo nó.</p>`;
      return;
    }
    els.menuNodeList.innerHTML = ids
      .map((id) => {
        const node = menuFlow.nodes[id];
        const active = id === selectedNodeId ? "active" : "";
        return `
          <button type="button" class="node-item ${active}" data-id="${escapeHtml(id)}">
            <strong>${escapeHtml(id)}</strong>
            <span class="muted">${escapeHtml(node.type)} · ${escapeHtml(node.title)}</span>
          </button>`;
      })
      .join("");
    els.menuNodeList.querySelectorAll(".node-item").forEach((btn) => {
      btn.addEventListener("click", () => selectNode(btn.dataset.id));
    });
  }

  function selectNode(id) {
    const node = menuFlow.nodes[id];
    if (!node) return;
    selectedNodeId = id;
    els.menuEditingId.value = id;
    els.menuNodeId.value = node.id;
    els.menuNodeType.value = node.type;
    els.menuNodeTitle.value = node.title || "";
    els.menuNodeBody.value = node.body || "";
    els.menuNodeOptions.value = optionsToText(node.options || []);
    els.menuNodeNext.value = node.next || "";
    els.menuNodeModel.value = node.model || "leads";
    els.menuNodeSeed.value = node.seed ? JSON.stringify(node.seed) : "";
    syncTypeFields();
    renderMenuList();
  }

  function blankNode() {
    const id = `node_${Date.now().toString(36)}`;
    menuFlow.nodes[id] = {
      id,
      type: "message",
      title: "Novo nó",
      body: "Escreva a mensagem aqui.",
      next: menuFlow.start || id,
    };
    if (!menuFlow.start) menuFlow.start = id;
    renderMenuStart();
    selectNode(id);
  }

  function applyNodeForm(event) {
    event.preventDefault();
    const previousId = els.menuEditingId.value || els.menuNodeId.value.trim();
    const id = els.menuNodeId.value.trim();
    if (!id) return;

    let seed;
    if (els.menuNodeSeed.value.trim()) {
      try {
        seed = JSON.parse(els.menuNodeSeed.value.trim());
      } catch {
        setStatus("Seed JSON inválido.");
        return;
      }
    }

    const type = els.menuNodeType.value;
    let node;
    if (type === "menu") {
      const options = textToOptions(els.menuNodeOptions.value);
      if (!options.length) {
        setStatus("Informe ao menos uma opção (chave | rótulo | próximo).");
        return;
      }
      node = {
        id,
        type,
        title: els.menuNodeTitle.value.trim(),
        body: els.menuNodeBody.value.trim() || undefined,
        options,
      };
    } else if (type === "message") {
      node = {
        id,
        type,
        title: els.menuNodeTitle.value.trim(),
        body: els.menuNodeBody.value.trim(),
        next: els.menuNodeNext.value.trim() || undefined,
      };
    } else if (type === "handoff") {
      node = {
        id,
        type,
        title: els.menuNodeTitle.value.trim(),
        body: els.menuNodeBody.value.trim(),
      };
    } else {
      node = {
        id,
        type: "model",
        title: els.menuNodeTitle.value.trim(),
        body: els.menuNodeBody.value.trim() || undefined,
        model: els.menuNodeModel.value,
        seed,
      };
    }

    if (previousId && previousId !== id && menuFlow.nodes[previousId]) {
      delete menuFlow.nodes[previousId];
      if (menuFlow.start === previousId) menuFlow.start = id;
    }
    menuFlow.nodes[id] = node;
    selectedNodeId = id;
    els.menuEditingId.value = id;
    renderMenuStart();
    renderMenuList();
    setStatus(`Nó "${id}" aplicado no editor. Clique em Salvar menu para publicar.`);
  }

  async function loadMenu() {
    const data = await api("/menu");
    menuFlow = structuredClone(data.menuFlow);
    renderMenuStart();
    const first = menuFlow.start || Object.keys(menuFlow.nodes)[0];
    if (first) selectNode(first);
    else renderMenuList();
  }

  async function saveMenu() {
    menuFlow.start = els.menuStart.value || menuFlow.start;
    await api("/menu", { method: "PUT", body: JSON.stringify(menuFlow) });
    setStatus("Menu publicado no bot.");
    await loadMenu();
  }

  async function resetMenu() {
    if (!confirm("Restaurar o menu padrão? Isso substitui o menu atual.")) return;
    const data = await api("/menu/reset", { method: "POST", body: "{}" });
    menuFlow = structuredClone(data.menuFlow);
    renderMenuStart();
    selectNode(menuFlow.start);
    setStatus("Menu padrão restaurado.");
  }

  function clearCatalogForm() {
    els.catalogId.value = "";
    els.catalogForm.reset();
    els.catalogActive.checked = true;
    els.catalogSort.value = "0";
  }

  function fillCatalogForm(item) {
    els.catalogId.value = item.id;
    els.catalogName.value = item.name;
    els.catalogPrice.value = (item.priceCents / 100).toFixed(2);
    els.catalogCategory.value = item.category || "";
    els.catalogSku.value = item.sku || "";
    els.catalogSort.value = String(item.sortOrder ?? 0);
    els.catalogActive.checked = item.active !== false;
    els.catalogDescription.value = item.description || "";
  }

  function renderCatalog() {
    if (!catalogItems.length) {
      els.catalogBody.innerHTML = `<tr><td colspan="5" class="empty">Nenhum item. Crie o primeiro.</td></tr>`;
      return;
    }
    els.catalogBody.innerHTML = catalogItems
      .map(
        (item) => `
        <tr>
          <td>
            <strong>${escapeHtml(item.name)}</strong><br />
            <span class="muted">${escapeHtml(item.sku || "sem SKU")}</span>
          </td>
          <td>${escapeHtml(item.category || "—")}</td>
          <td>${escapeHtml(fmtMoney(item.priceCents))}</td>
          <td>${item.active ? "Ativo" : "Inativo"}</td>
          <td class="row-actions">
            <button type="button" class="ghost" data-edit="${escapeHtml(item.id)}">Editar</button>
            <button type="button" class="ghost danger" data-del="${escapeHtml(item.id)}">Excluir</button>
          </td>
        </tr>`,
      )
      .join("");

    els.catalogBody.querySelectorAll("[data-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = catalogItems.find((i) => i.id === btn.dataset.edit);
        if (item) fillCatalogForm(item);
      });
    });
    els.catalogBody.querySelectorAll("[data-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Excluir este item do catálogo?")) return;
        await api(`/catalog/${btn.dataset.del}`, { method: "DELETE" });
        setStatus("Item excluído.");
        await loadCatalog();
      });
    });
  }

  async function loadCatalog() {
    const data = await api("/catalog?all=1");
    catalogItems = data.items || [];
    renderCatalog();
  }

  async function saveCatalog(event) {
    event.preventDefault();
    const payload = {
      name: els.catalogName.value.trim(),
      price: Number(els.catalogPrice.value),
      category: els.catalogCategory.value.trim() || null,
      sku: els.catalogSku.value.trim() || null,
      sortOrder: Number(els.catalogSort.value || 0),
      active: els.catalogActive.checked,
      description: els.catalogDescription.value.trim() || null,
    };
    const id = els.catalogId.value;
    if (id) {
      await api(`/catalog/${id}`, { method: "PUT", body: JSON.stringify(payload) });
      setStatus("Item atualizado.");
    } else {
      await api("/catalog", { method: "POST", body: JSON.stringify(payload) });
      setStatus("Item criado.");
    }
    clearCatalogForm();
    await loadCatalog();
  }

  function renderLeads(items) {
    leadsCache = items;
    if (!items.length) {
      els.leadsBody.innerHTML = `<tr><td colspan="6" class="empty">Nenhum lead.</td></tr>`;
      return;
    }
    els.leadsBody.innerHTML = items
      .map(
        (lead) => `
        <tr>
          <td>${escapeHtml(lead.name)}</td>
          <td>
            ${escapeHtml(lead.phone)}<br />
            <span class="muted">${escapeHtml(lead.email || "—")}</span>
          </td>
          <td>${escapeHtml(lead.interest || "—")}</td>
          <td><span class="badge">${escapeHtml(lead.status)}</span></td>
          <td>${escapeHtml(fmtDate(lead.createdAt))}</td>
          <td class="row-actions">
            <button type="button" class="ghost" data-edit-lead="${escapeHtml(lead.id)}">Editar</button>
            <button type="button" class="ghost danger" data-del-lead="${escapeHtml(lead.id)}">Excluir</button>
          </td>
        </tr>`,
      )
      .join("");

    els.leadsBody.querySelectorAll("[data-edit-lead]").forEach((btn) => {
      btn.addEventListener("click", () => openLead(btn.dataset.editLead));
    });
    els.leadsBody.querySelectorAll("[data-del-lead]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Excluir este lead?")) return;
        await api(`/leads/${btn.dataset.delLead}`, { method: "DELETE" });
        setStatus("Lead excluído.");
        const data = await api("/leads?limit=100");
        renderLeads(data.leads || []);
      });
    });
  }

  function openLead(id) {
    const lead = leadsCache.find((l) => l.id === id);
    if (!lead) return;
    els.leadId.value = lead.id;
    els.leadName.value = lead.name;
    els.leadStatus.value = lead.status || "new";
    els.leadEmail.value = lead.email || "";
    els.leadCity.value = lead.city || "";
    els.leadInterest.value = lead.interest || "";
    els.leadNotes.value = lead.notes || "";
    els.leadDialog.showModal();
  }

  async function saveLead(event) {
    event.preventDefault();
    const id = els.leadId.value;
    await api(`/leads/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: els.leadName.value.trim(),
        status: els.leadStatus.value,
        email: els.leadEmail.value.trim() || null,
        city: els.leadCity.value.trim() || null,
        interest: els.leadInterest.value.trim() || null,
        notes: els.leadNotes.value.trim() || null,
      }),
    });
    els.leadDialog.close();
    setStatus("Lead atualizado.");
    const data = await api("/leads?limit=100");
    renderLeads(data.leads || []);
  }

  function renderAppointments(items) {
    if (!items.length) {
      els.appointmentsBody.innerHTML = `<tr><td colspan="5" class="empty">Nenhum compromisso.</td></tr>`;
      return;
    }
    els.appointmentsBody.innerHTML = items
      .map(
        (item) => `
        <tr>
          <td>${escapeHtml(item.title)}</td>
          <td>${escapeHtml(item.phone)}</td>
          <td>${escapeHtml(fmtDate(item.scheduledAt))}</td>
          <td><span class="badge ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span></td>
          <td class="row-actions">
            <button type="button" class="ghost danger" data-cancel="${escapeHtml(item.id)}">Cancelar</button>
          </td>
        </tr>`,
      )
      .join("");

    els.appointmentsBody.querySelectorAll("[data-cancel]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Cancelar este compromisso?")) return;
        await api(`/appointments/${btn.dataset.cancel}/cancel`, {
          method: "POST",
          body: "{}",
        });
        setStatus("Compromisso cancelado.");
        const data = await api("/appointments?limit=100");
        renderAppointments(data.appointments || []);
      });
    });
  }

  async function loadSettings() {
    const data = await api("/settings");
    els.settingsName.value = data.tenant.name;
    els.settingsInstance.value = data.config.evolutionInstance;
    els.settingsWebhook.value = data.config.leadsWebhookUrl || "";
    els.settingsOwners.value = (data.config.ownerPhones || []).join(", ");
    els.settingsDefaultModel.innerHTML = data.availableModels
      .map(
        (m) =>
          `<option value="${m}" ${m === data.config.defaultModel ? "selected" : ""}>${m}</option>`,
      )
      .join("");
    const active = new Set(data.config.activeModels || []);
    els.settingsModels.innerHTML = data.availableModels
      .map(
        (m) => `
        <label class="check">
          <input type="checkbox" name="model" value="${m}" ${active.has(m) ? "checked" : ""} />
          ${m}
        </label>`,
      )
      .join("");
  }

  async function saveSettings(event) {
    event.preventDefault();
    const activeModels = [...els.settingsModels.querySelectorAll("input:checked")].map(
      (el) => el.value,
    );
    const ownerPhones = (els.settingsOwners.value || "")
      .split(/[,;\s]+/)
      .map((p) => p.replace(/\D/g, ""))
      .filter(Boolean);
    await api("/settings", {
      method: "PUT",
      body: JSON.stringify({
        name: els.settingsName.value.trim(),
        defaultModel: els.settingsDefaultModel.value,
        activeModels,
        leadsWebhookUrl: els.settingsWebhook.value.trim() || null,
        ownerPhones,
      }),
    });
    setStatus("Configurações salvas.");
    await loadSettings();
  }

  function bind() {
    els.menuNodeType.addEventListener("change", syncTypeFields);
    els.menuForm.addEventListener("submit", applyNodeForm);
    els.menuAddBtn.addEventListener("click", blankNode);
    els.menuSaveBtn.addEventListener("click", () => saveMenu().catch((e) => setStatus(e.message)));
    els.menuResetBtn.addEventListener("click", () =>
      resetMenu().catch((e) => setStatus(e.message)),
    );
    els.menuDeleteNodeBtn.addEventListener("click", () => {
      const id = els.menuEditingId.value || selectedNodeId;
      if (!id || !menuFlow.nodes[id]) return;
      if (!confirm(`Remover o nó "${id}"?`)) return;
      delete menuFlow.nodes[id];
      if (menuFlow.start === id) {
        menuFlow.start = Object.keys(menuFlow.nodes)[0] || "";
      }
      selectedNodeId = menuFlow.start || null;
      renderMenuStart();
      if (selectedNodeId) selectNode(selectedNodeId);
      else {
        els.menuForm.reset();
        renderMenuList();
      }
    });
    els.menuStart.addEventListener("change", () => {
      menuFlow.start = els.menuStart.value;
    });

    els.catalogForm.addEventListener("submit", (e) =>
      saveCatalog(e).catch((err) => setStatus(err.message)),
    );
    els.catalogNewBtn.addEventListener("click", clearCatalogForm);
    els.catalogCancelBtn.addEventListener("click", clearCatalogForm);

    els.leadForm.addEventListener("submit", (e) =>
      saveLead(e).catch((err) => setStatus(err.message)),
    );
    els.leadCancelBtn.addEventListener("click", () => els.leadDialog.close());

    els.settingsForm.addEventListener("submit", (e) =>
      saveSettings(e).catch((err) => setStatus(err.message)),
    );

    syncTypeFields();
  }

  bind();

  return {
    loadMenu: () => loadMenu().catch((e) => setStatus(e.message)),
    loadCatalog: () => loadCatalog().catch((e) => setStatus(e.message)),
    loadSettings: () => loadSettings().catch((e) => setStatus(e.message)),
    renderLeads,
    renderAppointments,
  };
}

/* ═══════════════════════════════════════════════
   TRUFASPAY v2.0.0
   Sistema de controle de vendas fiadas de trufas
   Modelo: por cliente/WhatsApp | Storage: localStorage
   ═══════════════════════════════════════════════ */

'use strict';

/* ═══════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════ */
const APP_VERSION = '2.0.0';
const STORAGE_KEY = 'trufaspay_v2';
const UNIT_PRICE  = 3.33;

const STATUS = { PENDENTE: 'pendente', ATRASADO: 'atrasado', COBRADO: 'cobrado', PAGO: 'pago' };

const STATUS_LABEL = {
  pendente: 'Pendente',
  atrasado: 'Atrasado',
  cobrado:  'Cobrado',
  pago:     'Pago'
};

const STATUS_ICON = {
  pendente: '🕐',
  atrasado: '⚠️',
  cobrado:  '📤',
  pago:     '✅'
};

/* ═══════════════════════════════════════
   APPLICATION STATE
═══════════════════════════════════════ */
const state = {
  clients:            [],
  currentPage:        'dashboard',
  prevPage:           null,
  filter:             'all',
  selectedIds:        new Set(),
  editingId:          null,
  novaCompraClientId: null,
  queue:              null,
  installPrompt:      null
};

/* ═══════════════════════════════════════
   LOCAL STORAGE
═══════════════════════════════════════ */
function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state.clients = Array.isArray(parsed.clients) ? parsed.clients : [];
      fixDataIntegrity();
    } else {
      // Tenta migrar dados do formato antigo (v1)
      const oldRaw = localStorage.getItem('trufaspay_v1');
      if (oldRaw) {
        const oldData = JSON.parse(oldRaw);
        if (Array.isArray(oldData.sales) && oldData.sales.length > 0) {
          migrateSalesToClients(oldData.sales);
        }
      }
    }
  } catch (_) {
    state.clients = [];
  }
}

function fixDataIntegrity() {
  let changed = false;
  const now   = new Date().toISOString();

  state.clients = state.clients.map(c => {
    const st = normalizeStatus(c.status);

    if (st === STATUS.PAGO) {
      const needsFix = c.status !== 'pago'
        || Number(c.saldoPendente) !== 0
        || (c.historicoCompras || []).some(p => normalizeStatus(p.status) !== 'pago');

      if (needsFix) {
        changed = true;
        return {
          ...c,
          status:        'pago',
          saldoPendente: 0,
          historicoCompras: (c.historicoCompras || []).map(p => ({
            ...p,
            status:        'pago',
            dataPagamento: p.dataPagamento || c.dataPagamento || now
          }))
        };
      }
    } else if (c.status !== st) {
      changed = true;
      return { ...c, status: st };
    }

    return c;
  });

  if (changed) saveData();
}

function migrateSalesToClients(sales) {
  const byWa = {};
  sales.forEach(s => {
    const wa = String(s.whatsapp).replace(/\D/g, '');
    if (!byWa[wa]) byWa[wa] = [];
    byWa[wa].push(s);
  });

  state.clients = Object.values(byWa).map(group => {
    group.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const latest  = group[0];
    const pending = group.filter(s => s.status !== 'pago');
    const saldo   = pending.reduce((sum, s) => sum + s.totalValue, 0);

    return {
      id:               latest.id,
      nome:             latest.clientName,
      whatsapp:         String(latest.whatsapp).replace(/\D/g, ''),
      saldoPendente:    parseFloat(saldo.toFixed(2)),
      status:           pending.length > 0
                          ? (pending.some(s => s.status === 'cobrado') ? 'cobrado' : 'pendente')
                          : 'pago',
      dataCobranca:     latest.dueDate,
      ultimaCompra:     latest.createdAt,
      ultimaCobranca:   latest.lastChargedAt || null,
      dataPagamento:    pending.length === 0 ? (latest.paidAt || null) : null,
      observacao:       latest.observation || '',
      historicoCompras: group.map(s => ({
        id:            s.id,
        quantidade:    s.quantity,
        valorUnitario: s.unitPrice || UNIT_PRICE,
        valorTotal:    s.totalValue,
        dataCompra:    s.createdAt,
        dataCobranca:  s.dueDate,
        observacao:    s.observation || '',
        status:        s.status === 'pago' ? 'pago' : 'pendente'
      }))
    };
  });

  saveData();
  setTimeout(() => showToast(`${state.clients.length} clientes migrados do banco antigo!`, 'success'), 500);
}

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version:   APP_VERSION,
      updatedAt: new Date().toISOString(),
      clients:   state.clients
    }));
  } catch (_) {
    showToast('Erro: armazenamento cheio', 'error');
  }
}

/* ═══════════════════════════════════════
   UTILITIES
═══════════════════════════════════════ */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function fmtCurrency(val) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
}

function fmtPhone(digits) {
  const n = String(digits).replace(/\D/g, '');
  if (n.length === 11) return `(${n.slice(0,2)}) ${n.slice(2,7)}-${n.slice(7)}`;
  if (n.length === 10) return `(${n.slice(0,2)}) ${n.slice(2,6)}-${n.slice(6)}`;
  return digits || '—';
}

function buildWaLink(phone, message) {
  let n = String(phone).replace(/\D/g, '');
  if (!n.startsWith('55')) n = '55' + n;
  return `https://wa.me/${n}?text=${encodeURIComponent(message)}`;
}

function escHtml(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(str || ''));
  return d.innerHTML;
}

function initials(name) {
  return (name || '?').trim().charAt(0).toUpperCase();
}

function cleanWhatsApp(raw) {
  return String(raw).replace(/\D/g, '');
}

function normalizeStatus(status) {
  return String(status || '').trim().toLowerCase();
}

function isOverdue(client) {
  if (normalizeStatus(client.status) === STATUS.PAGO) return false;
  return client.dataCobranca && client.dataCobranca < todayISO();
}

/* ═══════════════════════════════════════
   STATUS COMPUTATION
═══════════════════════════════════════ */
function getStatus(client) {
  const s = normalizeStatus(client.status);
  if (s === STATUS.PAGO)    return STATUS.PAGO;
  if (s === STATUS.COBRADO) return STATUS.COBRADO;
  if (isOverdue(client))    return STATUS.ATRASADO;
  return STATUS.PENDENTE;
}

/* ═══════════════════════════════════════
   WHATSAPP MESSAGE
═══════════════════════════════════════ */
function buildMessage(client) {
  return `Oi, ${client.nome}! Tudo bem?\n\nPassando para lembrar que ficou pendente o valor de ${fmtCurrency(client.saldoPendente)} referente às trufas.\n\nQuando pagar, me avisa por aqui para eu dar baixa no sistema. 😊`;
}

/* ═══════════════════════════════════════
   BUSINESS LOGIC — CLIENTES / COMPRAS
═══════════════════════════════════════ */
function findClientByWhatsApp(whatsapp) {
  const wa = cleanWhatsApp(whatsapp);
  return state.clients.find(c => c.whatsapp === wa) || null;
}

function registerPurchase(data) {
  const wa    = cleanWhatsApp(data.whatsapp);
  const qty   = parseFloat(data.quantity) || 0;
  const total = parseFloat((qty * UNIT_PRICE).toFixed(2));
  const now   = new Date().toISOString();
  const obs   = (data.observation || '').trim();

  const purchase = {
    id:            uid(),
    quantidade:    qty,
    valorUnitario: UNIT_PRICE,
    valorTotal:    total,
    dataCompra:    now,
    dataCobranca:  data.dueDate,
    observacao:    obs,
    status:        'pendente'
  };

  const existing = findClientByWhatsApp(wa);

  if (existing) {
    existing.nome          = data.clientName.trim();
    existing.saldoPendente = parseFloat((existing.saldoPendente + total).toFixed(2));
    existing.status        = STATUS.PENDENTE;
    existing.dataCobranca  = data.dueDate;
    existing.ultimaCompra  = now;
    existing.dataPagamento = null;   // nova dívida: limpa data de pagamento anterior
    if (obs) existing.observacao = obs;
    existing.historicoCompras.unshift(purchase);
    // Move para o topo da lista
    state.clients = [existing, ...state.clients.filter(c => c.whatsapp !== wa)];
  } else {
    const client = {
      id:               uid(),
      nome:             data.clientName.trim(),
      whatsapp:         wa,
      saldoPendente:    total,
      status:           STATUS.PENDENTE,
      dataCobranca:     data.dueDate,
      ultimaCompra:     now,
      ultimaCobranca:   null,
      dataPagamento:    null,
      observacao:       obs,
      historicoCompras: [purchase]
    };
    state.clients.unshift(client);
  }

  saveData();
}

function updateClient(id, data) {
  const client = state.clients.find(c => c.id === id);
  if (!client) return false;

  const wa       = cleanWhatsApp(data.whatsapp);
  const conflict = state.clients.find(c => c.whatsapp === wa && c.id !== id);
  if (conflict) {
    showToast('Este WhatsApp já está cadastrado para outro cliente', 'error');
    return false;
  }

  client.nome       = data.clientName.trim();
  client.whatsapp   = wa;
  client.observacao = (data.observation || '').trim();
  saveData();
  return true;
}

function deleteClient(id) {
  state.clients = state.clients.filter(c => c.id !== id);
  state.selectedIds.delete(id);
  saveData();
}

function setClientStatus(id, newStatus) {
  const client = state.clients.find(c => c.id === id);
  if (!client) return;

  client.status = newStatus;

  if (newStatus === STATUS.COBRADO) {
    client.ultimaCobranca = new Date().toISOString();
  }

  if (newStatus === STATUS.PAGO) {
    const now            = new Date().toISOString();
    client.status        = 'pago';
    client.saldoPendente = 0;
    client.dataPagamento = now;
    if (!client.ultimaCobranca) client.ultimaCobranca = now;
    client.historicoCompras = (client.historicoCompras || []).map(p => ({
      ...p,
      status:        'pago',
      dataPagamento: p.dataPagamento || now
    }));
  }

  saveData();
}

/* ═══════════════════════════════════════
   STATS
═══════════════════════════════════════ */
function getStats() {
  const all       = state.clients.map(c => ({ ...c, _status: getStatus(c) }));
  const active    = all.filter(c => c._status !== STATUS.PAGO);
  const atrasados = all.filter(c => c._status === STATUS.ATRASADO);
  const pagos     = all.filter(c => c._status === STATUS.PAGO);

  const totalRecebido = state.clients
    .flatMap(c => c.historicoCompras)
    .filter(p => p.status === 'pago')
    .reduce((sum, p) => sum + p.valorTotal, 0);

  return {
    totalPendente:   active.reduce((a, c) => a + c.saldoPendente, 0),
    totalRecebido:   parseFloat(totalRecebido.toFixed(2)),
    clientesDevendo: active.length,
    totalAtrasados:  atrasados.length,
    qtdAtivos:       active.length,
    qtdPagos:        pagos.length,
    total:           all.length
  };
}

/* ═══════════════════════════════════════
   FILTERING
═══════════════════════════════════════ */
function getFiltered() {
  return state.clients
    .map(c => ({ ...c, _status: getStatus(c) }))
    .filter(c => state.filter === 'all' || c._status === state.filter);
}

function getCounts() {
  const counts = { all: state.clients.length, pendente: 0, atrasado: 0, cobrado: 0, pago: 0 };
  state.clients.forEach(c => { const st = getStatus(c); counts[st]++; });
  return counts;
}

/* ═══════════════════════════════════════
   NAVIGATION
═══════════════════════════════════════ */
function navigate(page, opts = {}) {
  state.prevPage    = state.currentPage;
  state.currentPage = page;

  if (opts.editId !== undefined) state.editingId = opts.editId;
  else if (page !== 'form')      state.editingId = null;

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

  const target = document.getElementById(`page-${page}`);
  if (target) { target.classList.add('active'); target.scrollTop = 0; }

  document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });

  updateHeader(page);

  const fab = document.getElementById('fab');
  if (fab) fab.classList.toggle('hidden', page === 'form');

  switch (page) {
    case 'dashboard': renderDashboard(); break;
    case 'lista':     renderLista();     break;
    case 'form':      renderForm();      break;
  }
}

function navigateBack() {
  navigate(state.prevPage || 'dashboard');
}

function updateHeader(page) {
  const titles = {
    dashboard: 'TrufasPAY',
    lista:     'Cobranças',
    form:      state.editingId ? 'Editar Cliente' : 'Nova Venda'
  };
  const titleEl = document.getElementById('header-title');
  const backBtn = document.getElementById('btn-back');
  const logoRow = document.getElementById('header-logo-row');

  if (titleEl) titleEl.textContent = titles[page] || 'TrufasPAY';
  if (backBtn)  backBtn.classList.toggle('hidden', page !== 'form');
  if (logoRow)  logoRow.classList.toggle('hidden', page === 'form');
}

/* ═══════════════════════════════════════
   RENDER — DASHBOARD
═══════════════════════════════════════ */
function renderDashboard() {
  const stats = getStats();

  setEl('stat-pendente',  fmtCurrency(stats.totalPendente));
  setEl('stat-recebido',  fmtCurrency(stats.totalRecebido));
  setEl('stat-clientes',  stats.clientesDevendo);
  setEl('stat-atrasados', stats.totalAtrasados);

  const btnAtrasados = document.getElementById('btn-cobrar-atrasados');
  if (btnAtrasados) {
    btnAtrasados.classList.toggle('hidden', stats.totalAtrasados === 0);
    const countSpan = btnAtrasados.querySelector('.atrasados-count');
    if (countSpan) countSpan.textContent = stats.totalAtrasados;
  }

  renderRecentSales();
}

function renderRecentSales() {
  const container = document.getElementById('recent-sales');
  if (!container) return;

  const recent = state.clients.slice(0, 5);
  if (recent.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🍫</div>
        <div class="empty-title">Nenhuma venda ainda</div>
        <div class="empty-text">Comece registrando sua primeira venda fiada.</div>
        <button class="btn btn-primary" onclick="navigate('form')">
          ${svgPlus()} Nova Venda
        </button>
      </div>`;
    return;
  }

  container.innerHTML = recent.map(client => {
    const st = getStatus(client);
    const n  = client.historicoCompras.length;
    return `
      <div class="sale-card-mini" onclick="navigate('lista')">
        <div class="mini-avatar">${escHtml(initials(client.nome))}</div>
        <div class="mini-info">
          <div class="mini-name">${escHtml(client.nome)}</div>
          <div class="mini-product">${n} compra${n !== 1 ? 's' : ''}</div>
        </div>
        <div class="mini-right">
          <div class="mini-value">${fmtCurrency(client.saldoPendente)}</div>
          <span class="status-badge badge-${st}">${STATUS_LABEL[st]}</span>
        </div>
      </div>`;
  }).join('');
}

/* ═══════════════════════════════════════
   RENDER — LIST
═══════════════════════════════════════ */
function renderLista() {
  renderFilterBar();
  renderBulkBar();
  renderSaleCards();
}

function renderFilterBar() {
  const counts  = getCounts();
  const filters = [
    { key: 'all',      label: 'Todos'     },
    { key: 'pendente', label: 'Pendentes' },
    { key: 'atrasado', label: 'Atrasados' },
    { key: 'cobrado',  label: 'Cobrados'  },
    { key: 'pago',     label: 'Pagos'     }
  ];

  const bar = document.getElementById('filter-bar');
  if (!bar) return;
  bar.innerHTML = filters.map(f => `
    <button class="filter-btn ${state.filter === f.key ? 'active' : ''}"
            onclick="setFilter('${f.key}')">
      ${f.label}
      <span class="f-count">${counts[f.key]}</span>
    </button>`).join('');
}

function renderBulkBar() {
  const bar   = document.getElementById('bulk-actions-bar');
  const label = document.getElementById('bulk-count-label');
  if (!bar) return;
  const n = state.selectedIds.size;
  bar.classList.toggle('hidden', n === 0);
  if (label) label.textContent = `${n} selecionado${n !== 1 ? 's' : ''}`;
}

function renderSaleCards() {
  const container = document.getElementById('sales-list');
  if (!container) return;

  const filtered = getFiltered();
  if (filtered.length === 0) {
    const filterName = state.filter === 'all' ? '' : STATUS_LABEL[state.filter];
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        <div class="empty-title">Nenhum cliente${filterName ? ' ' + filterName.toLowerCase() : ''}</div>
        <div class="empty-text">${state.filter === 'all' ? 'Registre sua primeira venda fiada.' : 'Nenhum resultado para este filtro.'}</div>
        ${state.filter === 'all' ? `<button class="btn btn-primary" onclick="navigate('form')">${svgPlus()} Nova Venda</button>` : ''}
      </div>`;
    return;
  }

  container.innerHTML = filtered.map(client => buildSaleCard(client)).join('');
}

function buildSaleCard(client) {
  const st      = client._status;
  const sel     = state.selectedIds.has(client.id);
  const overdue = st === STATUS.ATRASADO;
  // Usa normalizeStatus para ser imune a capitalização ("Pago", "PAGO", "pago")
  const isPago  = normalizeStatus(client.status) === STATUS.PAGO;

  // Cliente pago sempre exibe R$ 0,00, independente do que estiver em saldoPendente
  const saldo = isPago ? 0 : Math.max(0, Number(client.saldoPendente) || 0);

  const lastPurchase = client.historicoCompras[0];
  const extraCount   = client.historicoCompras.length - 1;

  const productLine = lastPurchase
    ? `🍫 <strong>Trufas</strong> · ${lastPurchase.quantidade} un × ${fmtCurrency(UNIT_PRICE)}`
      + (extraCount > 0 ? ` <span style="font-size:.75rem;opacity:.65">· +${extraCount} compra${extraCount !== 1 ? 's' : ''}</span>` : '')
    : '🍫 Trufas';

  const dueRow = `<div class="card-due ${overdue ? 'overdue' : ''}">
    ${svgIcon('calendar')} Cobrar em ${fmtDate(client.dataCobranca)}${overdue ? ' · Atrasado!' : ''}
  </div>`;

  let metaRow = '';
  if (client.ultimaCobranca) metaRow += `<div class="card-dates-meta">📤 Cobrado em ${fmtDateTime(client.ultimaCobranca)}</div>`;
  if (client.dataPagamento)  metaRow += `<div class="card-dates-meta">✅ Pago em ${fmtDateTime(client.dataPagamento)}</div>`;

  const obsRow = client.observacao
    ? `<div class="card-obs">💬 ${escHtml(client.observacao)}</div>`
    : '';

  const btnCobrar    = isPago ? '' : `<button class="btn btn-sm btn-whatsapp" onclick="openWhatsApp('${client.id}')">${svgWa()} Cobrar</button>`;
  const btnPago      = isPago ? '' : `<button class="btn btn-sm btn-success" onclick="confirmMarkPaid('${client.id}')">✓ Pago</button>`;
  const btnEditar    = `<button class="btn btn-sm btn-secondary" onclick="navigate('form',{editId:'${client.id}'})">${svgEdit()} Editar</button>`;
  const btnNovaComp  = `<button class="btn btn-sm btn-outline" onclick="openNovaCompraModal('${client.id}')">${svgPlus()} Nova compra</button>`;
  const actionsHtml  = btnCobrar + btnPago + btnEditar + btnNovaComp;

  return `
    <div class="sale-card ${sel ? 'selected' : ''} ${overdue ? 'overdue' : ''}" id="card-${client.id}">
      <div class="card-top">
        <div class="card-checkbox">
          <input type="checkbox" ${sel ? 'checked' : ''} onchange="toggleSelect('${client.id}', this.checked)" aria-label="Selecionar ${escHtml(client.nome)}">
        </div>
        <div class="card-main">
          <div class="card-name-row">
            <span class="client-name">${escHtml(client.nome)}</span>
            <span class="status-badge badge-${st}">${STATUS_ICON[st]} ${STATUS_LABEL[st]}</span>
          </div>
          <div class="card-phone">${svgIcon('phone')} ${fmtPhone(client.whatsapp)}</div>
        </div>
        <button class="card-delete" onclick="confirmDelete('${client.id}')" title="Excluir">
          ${svgTrash()}
        </button>
      </div>
      <div class="card-body">
        <div class="card-product">
          <div class="product-info">${productLine}</div>
          <div class="product-value">${fmtCurrency(saldo)}</div>
        </div>
        ${dueRow}
        ${obsRow}
        ${metaRow}
      </div>
      <div class="card-actions">${actionsHtml}</div>
    </div>`;
}

/* ═══════════════════════════════════════
   RENDER — FORM
═══════════════════════════════════════ */
function renderForm() {
  const form = document.getElementById('sale-form');
  if (!form) return;

  const isEditing = !!state.editingId;
  const client    = isEditing ? state.clients.find(c => c.id === state.editingId) : null;

  // Campos exclusivos de nova compra ficam visíveis só no modo novo
  const fgQty   = document.getElementById('fg-quantity');
  const fgDate  = document.getElementById('fg-dueDate');
  const qtyEl   = document.getElementById('f-quantity');
  const dateEl  = document.getElementById('f-dueDate');
  if (fgQty)  fgQty.classList.toggle('hidden', isEditing);
  if (fgDate) fgDate.classList.toggle('hidden', isEditing);
  if (qtyEl)  qtyEl.required  = !isEditing;
  if (dateEl) dateEl.required = !isEditing;

  const totalLabelEl = document.getElementById('f-total-label');

  if (client) {
    setVal('f-clientName',  client.nome);
    setVal('f-whatsapp',    fmtPhone(client.whatsapp));
    setVal('f-observation', client.observacao || '');
    setEl('f-total-display', fmtCurrency(client.saldoPendente));
    if (totalLabelEl) totalLabelEl.textContent = '💰 Saldo Pendente';
  } else {
    form.reset();
    setVal('f-dueDate',  todayISO());
    setVal('f-quantity', '1');
    if (totalLabelEl) totalLabelEl.textContent = '💰 Valor Total da Venda';
    calcTotal();
  }

  const submitBtn = document.getElementById('form-submit-btn');
  if (submitBtn) submitBtn.textContent = isEditing ? 'Salvar Alterações' : 'Registrar Venda';
}

function calcTotal() {
  const qty = parseFloat(getVal('f-quantity')) || 0;
  setEl('f-total-display', fmtCurrency(qty * UNIT_PRICE));
}

/* ═══════════════════════════════════════
   RENDER — CONFIG
═══════════════════════════════════════ */
function renderConfig() {
  const stats = getStats();
  setEl('cfg-total',  stats.total);
  setEl('cfg-ativos', stats.qtdAtivos);
  setEl('cfg-pagos',  stats.qtdPagos);
}

/* ═══════════════════════════════════════
   SELECTION
═══════════════════════════════════════ */
function toggleSelect(id, checked) {
  if (checked) state.selectedIds.add(id);
  else         state.selectedIds.delete(id);

  const card = document.getElementById(`card-${id}`);
  if (card) card.classList.toggle('selected', checked);

  renderBulkBar();
}

function selectAll() {
  getFiltered().forEach(c => state.selectedIds.add(c.id));
  renderLista();
}

function selectAtrasados() {
  state.selectedIds.clear();
  state.clients.filter(c => getStatus(c) === STATUS.ATRASADO)
               .forEach(c => state.selectedIds.add(c.id));
  renderLista();
}

function clearSelection() {
  state.selectedIds.clear();
  renderLista();
}

function setFilter(f) {
  state.filter = f;
  state.selectedIds.clear();
  renderLista();
}

/* ═══════════════════════════════════════
   OPEN WHATSAPP (individual)
═══════════════════════════════════════ */
function openWhatsApp(id) {
  const client = state.clients.find(c => c.id === id);
  if (!client) return;
  if (getStatus(client) === STATUS.PAGO || client.saldoPendente <= 0) {
    showToast('Este cliente não tem saldo pendente', 'info');
    return;
  }

  const msg  = buildMessage(client);
  const link = buildWaLink(client.whatsapp, msg);
  window.open(link, '_blank');

  setClientStatus(id, STATUS.COBRADO);
  if (state.currentPage === 'lista')     renderLista();
  if (state.currentPage === 'dashboard') renderDashboard();
  showToast('WhatsApp aberto! Envie a mensagem e aguarde o cliente responder.', 'info');
}

/* ═══════════════════════════════════════
   CHARGE QUEUE
═══════════════════════════════════════ */
function startQueue(ids) {
  const items = ids
    .map(id => state.clients.find(c => c.id === id))
    .filter(c => c && getStatus(c) !== STATUS.PAGO);

  if (items.length === 0) {
    showToast('Nenhuma cobrança elegível selecionada', 'warning');
    return;
  }

  state.queue = { items, index: 0 };
  renderQueue();
  document.getElementById('modal-queue').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function cobrarAtrasados() {
  const ids = state.clients
    .filter(c => getStatus(c) === STATUS.ATRASADO)
    .map(c => c.id);
  startQueue(ids);
}

function cobrarSelecionados() {
  if (state.selectedIds.size === 0) {
    showToast('Selecione ao menos um cliente', 'warning');
    return;
  }
  startQueue(Array.from(state.selectedIds));
}

function renderQueue() {
  const { items, index } = state.queue;
  const client = items[index];
  const total  = items.length;
  const isLast = index === total - 1;
  const pct    = Math.round(((index + 1) / total) * 100);
  const last   = client.historicoCompras[0];

  const msg  = buildMessage(client);
  const link = buildWaLink(client.whatsapp, msg);

  const modal = document.getElementById('modal-queue');
  modal.innerHTML = `
    <div class="modal-sheet">
      <div class="queue-handle"></div>

      <div class="queue-header-row">
        <span class="queue-title">Fila de Cobrança</span>
        <span class="queue-progress-text">${index + 1} de ${total}</span>
      </div>

      <div class="queue-progress-wrap">
        <div class="progress-bar">
          <div class="progress-fill" style="width:${pct}%"></div>
        </div>
      </div>

      <div class="queue-client-card">
        <div class="queue-avatar-row">
          <div class="queue-avatar">${escHtml(initials(client.nome))}</div>
          <div>
            <div class="queue-client-name">${escHtml(client.nome)}</div>
            <div class="queue-client-phone">📱 ${fmtPhone(client.whatsapp)}</div>
          </div>
        </div>
        <div class="queue-details-grid">
          <div class="queue-detail-item">
            <div class="queue-detail-label">Saldo devedor</div>
            <div class="queue-detail-value value-big">${fmtCurrency(client.saldoPendente)}</div>
          </div>
          <div class="queue-detail-item">
            <div class="queue-detail-label">Cobrar em</div>
            <div class="queue-detail-value">${fmtDate(client.dataCobranca)}</div>
          </div>
          <div class="queue-detail-item" style="grid-column:1/-1">
            <div class="queue-detail-label">Última compra</div>
            <div class="queue-detail-value">🍫 Trufas × ${last ? last.quantidade : '—'} · ${client.historicoCompras.length} compra${client.historicoCompras.length !== 1 ? 's' : ''} no total</div>
          </div>
        </div>
      </div>

      <div class="queue-message-box">
        <div class="message-box-label">Mensagem que será enviada</div>
        <div class="message-preview">${escHtml(msg)}</div>
      </div>

      <div class="queue-actions-wrap">
        <a href="${link}" target="_blank" class="btn btn-whatsapp btn-lg" rel="noopener noreferrer">
          ${svgWa()} Abrir no WhatsApp
        </a>
        <div class="queue-secondary-row">
          <button class="btn btn-success" onclick="queueMarkCharged()">
            ✓ Marcar Cobrado
          </button>
          <button class="btn btn-outline" onclick="${isLast ? 'queueFinish()' : 'queueNext()'}">
            ${isLast ? 'Concluir ✓' : 'Próximo ›'}
          </button>
        </div>
        <button class="btn btn-text-danger" onclick="queueCancel()">
          Cancelar Fila
        </button>
      </div>
    </div>`;
}

function queueMarkCharged() {
  const { items, index } = state.queue;
  setClientStatus(items[index].id, STATUS.COBRADO);

  if (index < items.length - 1) {
    state.queue.index++;
    renderQueue();
  } else {
    queueFinish();
  }
}

function queueNext() {
  if (state.queue.index < state.queue.items.length - 1) {
    state.queue.index++;
    renderQueue();
  } else {
    queueFinish();
  }
}

function queueFinish() {
  const total = state.queue.items.length;
  queueClose();
  showToast(`Fila concluída! ${total} cobrança${total !== 1 ? 's' : ''} processada${total !== 1 ? 's' : ''}.`, 'success');
}

function queueCancel() {
  queueClose();
  showToast('Fila cancelada', 'info');
}

function queueClose() {
  state.queue = null;
  document.getElementById('modal-queue').classList.add('hidden');
  document.body.style.overflow = '';

  if (state.currentPage === 'lista')     renderLista();
  if (state.currentPage === 'dashboard') renderDashboard();
}

/* ═══════════════════════════════════════
   NOVA COMPRA MODAL
═══════════════════════════════════════ */
function openNovaCompraModal(clientId) {
  state.novaCompraClientId = clientId;
  renderNovaCompraModal();
  document.getElementById('modal-nova-compra').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeNovaCompraModal() {
  state.novaCompraClientId = null;
  document.getElementById('modal-nova-compra').classList.add('hidden');
  document.body.style.overflow = '';
  if (state.currentPage === 'lista')     renderLista();
  if (state.currentPage === 'dashboard') renderDashboard();
}

function calcNovaCompraTotal() {
  const qty = parseFloat(document.getElementById('nc-qty')?.value) || 0;
  const el  = document.getElementById('nc-total');
  if (el) el.textContent = fmtCurrency(qty * UNIT_PRICE);
}

function submitNovaCompra() {
  const client = state.clients.find(c => c.id === state.novaCompraClientId);
  if (!client) return;

  const qty     = parseFloat(document.getElementById('nc-qty')?.value)  || 0;
  const dueDate = (document.getElementById('nc-date')?.value || '').trim();
  const obs     = (document.getElementById('nc-obs')?.value  || '').trim();

  if (qty < 1)  { showToast('Informe a quantidade de trufas', 'warning'); return; }
  if (!dueDate) { showToast('Informe a data de cobrança', 'warning');     return; }

  const totalStr = fmtCurrency(qty * UNIT_PRICE);

  registerPurchase({
    clientName:  client.nome,
    whatsapp:    client.whatsapp,
    quantity:    qty,
    dueDate,
    observation: obs
  });

  closeNovaCompraModal();
  showToast(`Nova compra de ${totalStr} lançada para ${client.nome}!`, 'success');
}

function renderNovaCompraModal() {
  const client = state.clients.find(c => c.id === state.novaCompraClientId);
  if (!client) return;

  const hasPendingBalance = client.saldoPendente > 0;

  document.getElementById('modal-nova-compra').innerHTML = `
    <div class="modal-sheet">
      <div class="queue-handle"></div>

      <div class="queue-header-row">
        <span class="queue-title">${svgPlus()} Nova Compra</span>
      </div>

      <div class="queue-client-card">
        <div class="queue-avatar-row">
          <div class="queue-avatar">${escHtml(initials(client.nome))}</div>
          <div>
            <div class="queue-client-name">${escHtml(client.nome)}</div>
            <div class="queue-client-phone">📱 ${fmtPhone(client.whatsapp)}</div>
          </div>
        </div>
        ${hasPendingBalance ? `
          <div class="queue-details-grid" style="margin-top:10px">
            <div class="queue-detail-item">
              <div class="queue-detail-label">Saldo em aberto atual</div>
              <div class="queue-detail-value">${fmtCurrency(client.saldoPendente)}</div>
            </div>
          </div>` : ''}
      </div>

      <div style="padding:0 20px 4px">

        <div class="form-group">
          <label class="form-label" for="nc-qty">
            Quantidade de trufas <span class="required">*</span>
          </label>
          <input id="nc-qty" type="number" class="form-control"
                 min="1" step="1" value="1" required oninput="calcNovaCompraTotal()">
          <div class="form-hint">Valor por trufa: R$ 3,33 (fixo)</div>
        </div>

        <div class="total-display" style="margin:0 0 16px">
          <div class="total-label">💰 Valor desta compra</div>
          <div class="total-value" id="nc-total">${fmtCurrency(UNIT_PRICE)}</div>
        </div>

        <div class="form-group">
          <label class="form-label" for="nc-date">
            Data de cobrança <span class="required">*</span>
          </label>
          <input id="nc-date" type="date" class="form-control" value="${todayISO()}" required>
          <div class="form-hint">Quando cobrar o novo valor.</div>
        </div>

        <div class="form-group">
          <label class="form-label" for="nc-obs">Observação</label>
          <textarea id="nc-obs" class="form-control form-control-textarea"
                    placeholder="Ex: entregue na porta, sabor especial..."></textarea>
        </div>

      </div>

      <div class="queue-actions-wrap">
        <button type="button" class="btn btn-primary btn-lg" onclick="submitNovaCompra()">
          ${svgPlus()} Registrar nova compra
        </button>
        <button type="button" class="btn btn-secondary" onclick="closeNovaCompraModal()">
          Cancelar
        </button>
      </div>
    </div>`;
}

/* ═══════════════════════════════════════
   FORM HANDLERS
═══════════════════════════════════════ */
function handleFormSubmit(e) {
  e.preventDefault();

  const isEditing = !!state.editingId;
  const data = {
    clientName:  getVal('f-clientName'),
    whatsapp:    getVal('f-whatsapp'),
    quantity:    getVal('f-quantity'),
    dueDate:     getVal('f-dueDate'),
    observation: getVal('f-observation')
  };

  if (!data.clientName || !data.whatsapp) {
    showToast('Preencha nome e WhatsApp', 'warning');
    return;
  }

  if (!isEditing && (!data.quantity || !data.dueDate)) {
    showToast('Preencha todos os campos obrigatórios', 'warning');
    return;
  }

  if (isEditing) {
    const ok = updateClient(state.editingId, data);
    if (ok !== false) {
      showToast('Cliente atualizado!', 'success');
      state.selectedIds.clear();
      navigate('lista');
    }
  } else {
    const wa          = cleanWhatsApp(data.whatsapp);
    const preExisting = findClientByWhatsApp(wa);
    registerPurchase(data);
    if (preExisting) {
      showToast(`Venda adicionada ao saldo de ${preExisting.nome}!`, 'success');
    } else {
      showToast('Venda registrada com sucesso!', 'success');
    }
    state.selectedIds.clear();
    navigate('lista');
  }
}

/* ═══════════════════════════════════════
   CONFIRM DIALOG
═══════════════════════════════════════ */
let _confirmCb   = null;
let _confirmIcon = '⚠️';

function showConfirm(title, message, onYes, icon = '⚠️') {
  _confirmCb   = onYes;
  _confirmIcon = icon;
  setEl('confirm-icon-inner', icon);
  setEl('confirm-title',      title);
  setEl('confirm-message',    message);
  document.getElementById('modal-confirm').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function confirmYes() {
  document.getElementById('modal-confirm').classList.add('hidden');
  document.body.style.overflow = '';
  if (_confirmCb) { _confirmCb(); _confirmCb = null; }
}

function confirmNo() {
  document.getElementById('modal-confirm').classList.add('hidden');
  document.body.style.overflow = '';
  _confirmCb = null;
}

function confirmDelete(id) {
  const c = state.clients.find(x => x.id === id);
  if (!c) return;
  showConfirm(
    'Excluir cliente',
    `Deseja excluir "${c.nome}" com saldo de ${fmtCurrency(c.saldoPendente)}? Todas as compras serão removidas. Esta ação não pode ser desfeita.`,
    () => {
      deleteClient(id);
      if (state.currentPage === 'lista')     renderLista();
      if (state.currentPage === 'dashboard') renderDashboard();
      showToast('Cliente excluído', 'success');
    }
  );
}

function confirmMarkPaid(id) {
  const c = state.clients.find(x => x.id === id);
  if (!c) return;
  showConfirm(
    'Confirmar pagamento',
    `Confirmar recebimento de ${fmtCurrency(c.saldoPendente)} de ${c.nome}? O saldo será zerado.`,
    () => {
      setClientStatus(id, STATUS.PAGO);
      if (state.currentPage === 'lista')     renderLista();
      if (state.currentPage === 'dashboard') renderDashboard();
      showToast('Marcado como pago! 🎉', 'success');
    },
    '✅'
  );
}

function confirmClearAll() {
  if (state.clients.length === 0) { showToast('Nenhum dado para limpar', 'info'); return; }
  showConfirm(
    'Limpar todos os dados',
    `Isso irá excluir TODOS os ${state.clients.length} clientes permanentemente. Esta ação não pode ser desfeita.`,
    () => {
      state.clients = [];
      state.selectedIds.clear();
      saveData();
      renderConfig();
      showToast('Todos os dados foram removidos', 'success');
    }
  );
}

/* ═══════════════════════════════════════
   TOAST NOTIFICATIONS
═══════════════════════════════════════ */
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast     = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  toast.innerHTML = `<span>${icons[type] || ''}</span> ${escHtml(message)}`;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

/* ═══════════════════════════════════════
   BACKUP & RESTORE
═══════════════════════════════════════ */
function exportData() {
  if (state.clients.length === 0) { showToast('Nenhum dado para exportar', 'warning'); return; }

  const payload = {
    app:        'TrufasPAY',
    version:    APP_VERSION,
    exportedAt: new Date().toISOString(),
    clients:    state.clients
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `trufaspay-backup-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`${state.clients.length} clientes exportados!`, 'success');
}

function triggerImport() {
  document.getElementById('import-file').click();
}

function handleImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';

  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!Array.isArray(data.clients)) throw new Error('invalid');

      showConfirm(
        'Importar backup',
        `Isso irá substituir os ${state.clients.length} clientes atuais por ${data.clients.length} do arquivo. Deseja continuar?`,
        () => {
          state.clients = data.clients;
          state.selectedIds.clear();
          saveData();
          renderConfig();
          showToast(`${data.clients.length} clientes importados!`, 'success');
        }
      );
    } catch (_) {
      showToast('Arquivo inválido ou corrompido', 'error');
    }
  };
  reader.readAsText(file);
}

/* ═══════════════════════════════════════
   PWA INSTALL PROMPT
═══════════════════════════════════════ */
function installApp() {
  if (!state.installPrompt) return;
  state.installPrompt.prompt();
  state.installPrompt.userChoice.then(result => {
    if (result.outcome === 'accepted') showToast('TrufasPAY instalado! 🎉', 'success');
    state.installPrompt = null;
    const banner = document.getElementById('install-banner');
    if (banner) banner.classList.add('hidden');
  });
}

/* ═══════════════════════════════════════
   INLINE SVG ICONS
═══════════════════════════════════════ */
function svgPlus() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>`;
}
function svgWa() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.125.557 4.122 1.527 5.855L0 24l6.335-1.502A11.955 11.955 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.897 0-3.67-.52-5.193-1.423l-.372-.22-3.861.915.978-3.772-.242-.388A9.955 9.955 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>`;
}
function svgEdit() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`;
}
function svgTrash() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`;
}
function svgIcon(name) {
  const icons = {
    calendar: `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z"/></svg>`,
    phone:    `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>`
  };
  return icons[name] || '';
}

/* ═══════════════════════════════════════
   DOM HELPERS
═══════════════════════════════════════ */
function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
function setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}
function getVal(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

/* ═══════════════════════════════════════
   EVENT LISTENERS SETUP
═══════════════════════════════════════ */
function setupListeners() {
  const form = document.getElementById('sale-form');
  if (form) form.addEventListener('submit', handleFormSubmit);

  const qtyEl = document.getElementById('f-quantity');
  if (qtyEl) qtyEl.addEventListener('input', calcTotal);

  const waInput = document.getElementById('f-whatsapp');
  if (waInput) {
    waInput.addEventListener('input', function () {
      let v = this.value.replace(/\D/g, '').slice(0, 11);
      if (v.length > 10) {
        v = `(${v.slice(0,2)}) ${v.slice(2,7)}-${v.slice(7)}`;
      } else if (v.length > 6) {
        v = `(${v.slice(0,2)}) ${v.slice(2,6)}-${v.slice(6)}`;
      } else if (v.length > 2) {
        v = `(${v.slice(0,2)}) ${v.slice(2)}`;
      } else if (v.length > 0) {
        v = `(${v}`;
      }
      this.value = v;
    });
  }

  const importInput = document.getElementById('import-file');
  if (importInput) importInput.addEventListener('change', handleImport);

  document.getElementById('btn-confirm-yes')?.addEventListener('click', confirmYes);
  document.getElementById('btn-confirm-no')?.addEventListener('click',  confirmNo);

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    state.installPrompt = e;
    const banner = document.getElementById('install-banner');
    if (banner) banner.classList.remove('hidden');
  });

  window.addEventListener('appinstalled', () => {
    const banner = document.getElementById('install-banner');
    if (banner) banner.classList.add('hidden');
    state.installPrompt = null;
  });

  const urlParams = new URLSearchParams(window.location.search);
  const initPage  = urlParams.get('page');
  if (initPage && ['dashboard','lista','form'].includes(initPage)) {
    navigate(initPage);
  }
}

/* ═══════════════════════════════════════
   SERVICE WORKER
═══════════════════════════════════════ */
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => {
        reg.addEventListener('updatefound', () => showToast('Atualizando o app…', 'info'));
      })
      .catch(() => {});
  }
}

/* ═══════════════════════════════════════
   INITIALIZATION
═══════════════════════════════════════ */
function init() {
  loadData();
  setupListeners();
  navigate('dashboard');
  registerSW();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

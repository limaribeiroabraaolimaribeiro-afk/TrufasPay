/* ═══════════════════════════════════════════════
   TRUFASPAY v1.0.0
   Sistema de controle de vendas fiadas de trufas
   Storage: localStorage | Offline: Service Worker
   ═══════════════════════════════════════════════ */

'use strict';

/* ═══════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════ */
const APP_VERSION = '1.0.0';
const STORAGE_KEY = 'trufaspay_v1';
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
  sales:       [],
  currentPage: 'dashboard',
  prevPage:    null,
  filter:      'all',
  selectedIds: new Set(),
  editingId:   null,
  queue:       null,   // { items: Sale[], index: number }
  installPrompt: null
};

/* ═══════════════════════════════════════
   LOCAL STORAGE
═══════════════════════════════════════ */
function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state.sales = Array.isArray(parsed.sales) ? parsed.sales : [];
    }
  } catch (_) {
    state.sales = [];
  }
}

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version:   APP_VERSION,
      updatedAt: new Date().toISOString(),
      sales:     state.sales
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

function isOverdue(sale) {
  return sale.dueDate && sale.dueDate < todayISO();
}

/* ═══════════════════════════════════════
   STATUS COMPUTATION
═══════════════════════════════════════ */
function getStatus(sale) {
  if (sale.status === STATUS.PAGO || sale.status === STATUS.COBRADO) return sale.status;
  if (isOverdue(sale)) return STATUS.ATRASADO;
  return STATUS.PENDENTE;
}

/* ═══════════════════════════════════════
   WHATSAPP MESSAGE
═══════════════════════════════════════ */
function buildMessage(sale) {
  const qty = sale.quantity || 1;
  return `Oi, ${sale.clientName}! Tudo bem?\n\nPassando para lembrar que ficou pendente o valor de ${fmtCurrency(sale.totalValue)} referente a ${qty} trufa${qty !== 1 ? 's' : ''}.\n\nQuando pagar, me avisa por aqui para eu dar baixa no sistema. 😊`;
}

/* ═══════════════════════════════════════
   BUSINESS LOGIC — CRUD
═══════════════════════════════════════ */
function createSale(data) {
  const qty   = parseFloat(data.quantity) || 0;
  const price = UNIT_PRICE;
  const sale  = {
    id:            uid(),
    clientName:    data.clientName.trim(),
    whatsapp:      data.whatsapp.replace(/\D/g, ''),
    product:       'Trufas',
    quantity:      qty,
    unitPrice:     price,
    totalValue:    parseFloat((qty * price).toFixed(2)),
    dueDate:       data.dueDate,
    observation:   (data.observation || '').trim(),
    status:        STATUS.PENDENTE,
    createdAt:     new Date().toISOString(),
    lastChargedAt: null,
    paidAt:        null
  };
  state.sales.unshift(sale);
  saveData();
  return sale;
}

function updateSale(id, data) {
  const idx = state.sales.findIndex(s => s.id === id);
  if (idx < 0) return null;
  const s     = state.sales[idx];
  const qty   = parseFloat(data.quantity) || 0;
  const price = UNIT_PRICE;
  Object.assign(s, {
    clientName:  data.clientName.trim(),
    whatsapp:    data.whatsapp.replace(/\D/g, ''),
    product:     'Trufas',
    quantity:    qty,
    unitPrice:   price,
    totalValue:  parseFloat((qty * price).toFixed(2)),
    dueDate:     data.dueDate,
    observation: (data.observation || '').trim()
  });
  saveData();
  return s;
}

function deleteSale(id) {
  state.sales = state.sales.filter(s => s.id !== id);
  state.selectedIds.delete(id);
  saveData();
}

function setSaleStatus(id, newStatus) {
  const s = state.sales.find(s => s.id === id);
  if (!s) return;
  s.status = newStatus;
  if (newStatus === STATUS.COBRADO) s.lastChargedAt = new Date().toISOString();
  if (newStatus === STATUS.PAGO) {
    s.paidAt = new Date().toISOString();
    if (!s.lastChargedAt) s.lastChargedAt = s.paidAt;
  }
  saveData();
}

/* ═══════════════════════════════════════
   STATS
═══════════════════════════════════════ */
function getStats() {
  const all = state.sales.map(s => ({ ...s, _status: getStatus(s) }));

  const active    = all.filter(s => s._status !== STATUS.PAGO);
  const atrasados = all.filter(s => s._status === STATUS.ATRASADO);
  const pagos     = all.filter(s => s._status === STATUS.PAGO);

  return {
    totalPendente:  active.reduce((a, s) => a + s.totalValue, 0),
    totalRecebido:  pagos.reduce((a, s) => a + s.totalValue, 0),
    clientesDevendo: new Set(active.map(s => s.clientName)).size,
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
  return state.sales
    .map(s => ({ ...s, _status: getStatus(s) }))
    .filter(s => state.filter === 'all' || s._status === state.filter);
}

function getCounts() {
  const counts = { all: state.sales.length, pendente: 0, atrasado: 0, cobrado: 0, pago: 0 };
  state.sales.forEach(s => { const st = getStatus(s); counts[st]++; });
  return counts;
}

/* ═══════════════════════════════════════
   NAVIGATION
═══════════════════════════════════════ */
function navigate(page, opts = {}) {
  state.prevPage  = state.currentPage;
  state.currentPage = page;

  if (opts.editId !== undefined) state.editingId = opts.editId;
  else if (page !== 'form')      state.editingId = null;

  // Hide all pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

  const target = document.getElementById(`page-${page}`);
  if (target) { target.classList.add('active'); target.scrollTop = 0; }

  // Update bottom nav active state
  document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });

  // Header: title + back button
  updateHeader(page);

  // FAB visibility
  const fab = document.getElementById('fab');
  if (fab) fab.classList.toggle('hidden', page === 'form');

  // Render
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
    form:      state.editingId ? 'Editar Venda' : 'Nova Venda'
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

  setEl('stat-pendente', fmtCurrency(stats.totalPendente));
  setEl('stat-recebido', fmtCurrency(stats.totalRecebido));
  setEl('stat-clientes', stats.clientesDevendo);
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

  const recent = state.sales.slice(0, 5);
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

  container.innerHTML = recent.map(sale => {
    const st = getStatus(sale);
    return `
      <div class="sale-card-mini" onclick="navigate('lista')">
        <div class="mini-avatar">${escHtml(initials(sale.clientName))}</div>
        <div class="mini-info">
          <div class="mini-name">${escHtml(sale.clientName)}</div>
          <div class="mini-product">Trufas × ${sale.quantity}</div>
        </div>
        <div class="mini-right">
          <div class="mini-value">${fmtCurrency(sale.totalValue)}</div>
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
  const counts = getCounts();
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
  if (label) {
    label.textContent = `${n} selecionado${n !== 1 ? 's' : ''}`;
  }
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
        <div class="empty-title">Nenhuma cobrança${filterName ? ' ' + filterName.toLowerCase() : ''}</div>
        <div class="empty-text">${state.filter === 'all' ? 'Registre sua primeira venda fiada.' : 'Nenhum resultado para este filtro.'}</div>
        ${state.filter === 'all' ? `<button class="btn btn-primary" onclick="navigate('form')">${svgPlus()} Nova Venda</button>` : ''}
      </div>`;
    return;
  }

  container.innerHTML = filtered.map(sale => buildSaleCard(sale)).join('');
}

function buildSaleCard(sale) {
  const st       = sale._status;
  const sel      = state.selectedIds.has(sale.id);
  const overdue  = st === STATUS.ATRASADO;
  const isPago   = st === STATUS.PAGO;

  let dueRow = `<div class="card-due ${overdue ? 'overdue' : ''}">
    ${svgIcon('calendar')} Vence ${fmtDate(sale.dueDate)}${overdue ? ' · Atrasado!' : ''}
  </div>`;

  let metaRow = '';
  if (sale.lastChargedAt) {
    metaRow += `<div class="card-dates-meta">📤 Cobrado em ${fmtDateTime(sale.lastChargedAt)}</div>`;
  }
  if (sale.paidAt) {
    metaRow += `<div class="card-dates-meta">✅ Pago em ${fmtDateTime(sale.paidAt)}</div>`;
  }

  const obsRow = sale.observation
    ? `<div class="card-obs">💬 ${escHtml(sale.observation)}</div>`
    : '';

  const actionsHtml = `
    <button class="btn btn-sm btn-whatsapp" onclick="openWhatsApp('${sale.id}')">
      ${svgWa()} Cobrar
    </button>
    ${!isPago ? `<button class="btn btn-sm btn-success" onclick="confirmMarkPaid('${sale.id}')">✓ Pago</button>` : ''}
    <button class="btn btn-sm btn-secondary" onclick="navigate('form', {editId:'${sale.id}'})">
      ${svgEdit()} Editar
    </button>`;

  return `
    <div class="sale-card ${sel ? 'selected' : ''} ${overdue ? 'overdue' : ''}" id="card-${sale.id}">
      <div class="card-top">
        <div class="card-checkbox">
          <input type="checkbox" ${sel ? 'checked' : ''} onchange="toggleSelect('${sale.id}', this.checked)" aria-label="Selecionar ${escHtml(sale.clientName)}">
        </div>
        <div class="card-main">
          <div class="card-name-row">
            <span class="client-name">${escHtml(sale.clientName)}</span>
            <span class="status-badge badge-${st}">${STATUS_ICON[st]} ${STATUS_LABEL[st]}</span>
          </div>
          <div class="card-phone">${svgIcon('phone')} ${fmtPhone(sale.whatsapp)}</div>
        </div>
        <button class="card-delete" onclick="confirmDelete('${sale.id}')" title="Excluir">
          ${svgTrash()}
        </button>
      </div>
      <div class="card-body">
        <div class="card-product">
          <div class="product-info">
            🍫 <strong>Trufas</strong>
            · ${sale.quantity} un × ${fmtCurrency(UNIT_PRICE)}
          </div>
          <div class="product-value">${fmtCurrency(sale.totalValue)}</div>
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

  const sale = state.editingId ? state.sales.find(s => s.id === state.editingId) : null;

  if (sale) {
    setVal('f-clientName',  sale.clientName);
    setVal('f-whatsapp',    fmtPhone(sale.whatsapp));
    setVal('f-quantity',    sale.quantity);
    setVal('f-dueDate',     sale.dueDate);
    setVal('f-observation', sale.observation || '');
  } else {
    form.reset();
    setVal('f-dueDate',  todayISO());
    setVal('f-quantity', '1');
  }

  calcTotal();

  const title = document.getElementById('form-submit-btn');
  if (title) title.textContent = state.editingId ? 'Salvar Alterações' : 'Registrar Venda';
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
  setEl('cfg-total',    stats.total);
  setEl('cfg-ativos',   stats.qtdAtivos);
  setEl('cfg-pagos',    stats.qtdPagos);
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
  getFiltered().forEach(s => state.selectedIds.add(s.id));
  renderLista();
}

function selectAtrasados() {
  state.selectedIds.clear();
  state.sales.filter(s => getStatus(s) === STATUS.ATRASADO)
             .forEach(s => state.selectedIds.add(s.id));
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
  const sale = state.sales.find(s => s.id === id);
  if (!sale) return;

  const msg  = buildMessage(sale);
  const link = buildWaLink(sale.whatsapp, msg);
  window.open(link, '_blank');

  setSaleStatus(id, STATUS.COBRADO);
  if (state.currentPage === 'lista')     renderLista();
  if (state.currentPage === 'dashboard') renderDashboard();
  showToast('WhatsApp aberto! Envie a mensagem e aguarde o cliente responder.', 'info');
}

/* ═══════════════════════════════════════
   CHARGE QUEUE
═══════════════════════════════════════ */
function startQueue(ids) {
  const items = ids
    .map(id => state.sales.find(s => s.id === id))
    .filter(s => s && getStatus(s) !== STATUS.PAGO);

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
  const ids = state.sales
    .filter(s => getStatus(s) === STATUS.ATRASADO)
    .map(s => s.id);
  startQueue(ids);
}

function cobrarSelecionados() {
  if (state.selectedIds.size === 0) {
    showToast('Selecione ao menos uma cobrança', 'warning');
    return;
  }
  startQueue(Array.from(state.selectedIds));
}

function renderQueue() {
  const { items, index } = state.queue;
  const sale   = items[index];
  const total  = items.length;
  const isLast = index === total - 1;
  const pct    = Math.round(((index + 1) / total) * 100);

  const msg  = buildMessage(sale);
  const link = buildWaLink(sale.whatsapp, msg);

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
          <div class="queue-avatar">${escHtml(initials(sale.clientName))}</div>
          <div>
            <div class="queue-client-name">${escHtml(sale.clientName)}</div>
            <div class="queue-client-phone">📱 ${fmtPhone(sale.whatsapp)}</div>
          </div>
        </div>
        <div class="queue-details-grid">
          <div class="queue-detail-item">
            <div class="queue-detail-label">Valor devido</div>
            <div class="queue-detail-value value-big">${fmtCurrency(sale.totalValue)}</div>
          </div>
          <div class="queue-detail-item">
            <div class="queue-detail-label">Vencimento</div>
            <div class="queue-detail-value">${fmtDate(sale.dueDate)}</div>
          </div>
          <div class="queue-detail-item" style="grid-column:1/-1">
            <div class="queue-detail-label">Produto</div>
            <div class="queue-detail-value">🍫 Trufas × ${sale.quantity}</div>
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
  setSaleStatus(items[index].id, STATUS.COBRADO);

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
   FORM HANDLERS
═══════════════════════════════════════ */
function handleFormSubmit(e) {
  e.preventDefault();

  const data = {
    clientName:  getVal('f-clientName'),
    whatsapp:    getVal('f-whatsapp'),
    quantity:    getVal('f-quantity'),
    dueDate:     getVal('f-dueDate'),
    observation: getVal('f-observation')
  };

  if (!data.clientName || !data.whatsapp || !data.quantity || !data.dueDate) {
    showToast('Preencha todos os campos obrigatórios', 'warning');
    return;
  }

  if (state.editingId) {
    updateSale(state.editingId, data);
    showToast('Venda atualizada com sucesso!', 'success');
  } else {
    createSale(data);
    showToast('Venda registrada com sucesso!', 'success');
  }

  state.selectedIds.clear();
  navigate('lista');
}

/* ═══════════════════════════════════════
   CONFIRM DIALOG
═══════════════════════════════════════ */
let _confirmCb = null;
let _confirmIcon = '⚠️';

function showConfirm(title, message, onYes, icon = '⚠️') {
  _confirmCb   = onYes;
  _confirmIcon = icon;
  setEl('confirm-icon-inner', icon);
  setEl('confirm-title',   title);
  setEl('confirm-message', message);
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
  const s = state.sales.find(x => x.id === id);
  if (!s) return;
  showConfirm(
    'Excluir cobrança',
    `Deseja excluir a cobrança de "${s.clientName}" no valor de ${fmtCurrency(s.totalValue)}? Esta ação não pode ser desfeita.`,
    () => {
      deleteSale(id);
      if (state.currentPage === 'lista')     renderLista();
      if (state.currentPage === 'dashboard') renderDashboard();
      showToast('Cobrança excluída', 'success');
    }
  );
}

function confirmMarkPaid(id) {
  const s = state.sales.find(x => x.id === id);
  if (!s) return;
  showConfirm(
    'Confirmar pagamento',
    `Confirmar recebimento de ${fmtCurrency(s.totalValue)} de ${s.clientName}?`,
    () => {
      setSaleStatus(id, STATUS.PAGO);
      if (state.currentPage === 'lista')     renderLista();
      if (state.currentPage === 'dashboard') renderDashboard();
      showToast('Marcado como pago! 🎉', 'success');
    },
    '✅'
  );
}

function confirmClearAll() {
  if (state.sales.length === 0) { showToast('Nenhum dado para limpar', 'info'); return; }
  showConfirm(
    'Limpar todos os dados',
    `Isso irá excluir TODOS os ${state.sales.length} registros permanentemente. Esta ação não pode ser desfeita.`,
    () => {
      state.sales = [];
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
  const toast = document.createElement('div');
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
  if (state.sales.length === 0) { showToast('Nenhum dado para exportar', 'warning'); return; }

  const payload = {
    app:        'TrufasPAY',
    version:    APP_VERSION,
    exportedAt: new Date().toISOString(),
    sales:      state.sales
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `trufaspay-backup-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`${state.sales.length} registros exportados!`, 'success');
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
      if (!Array.isArray(data.sales)) throw new Error('invalid');

      showConfirm(
        'Importar backup',
        `Isso irá substituir os ${state.sales.length} registros atuais por ${data.sales.length} registros do arquivo. Deseja continuar?`,
        () => {
          state.sales = data.sales;
          state.selectedIds.clear();
          saveData();
          renderConfig();
          showToast(`${data.sales.length} registros importados!`, 'success');
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
function svgHome() {
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>`;
}
function svgList() {
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>`;
}
function svgSettings() {
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>`;
}
function svgBack() {
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>`;
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
  // Form submit
  const form = document.getElementById('sale-form');
  if (form) form.addEventListener('submit', handleFormSubmit);

  // Auto-calc total (preço fixo R$ 3,33 — só depende da quantidade)
  const qtyEl = document.getElementById('f-quantity');
  if (qtyEl) qtyEl.addEventListener('input', calcTotal);

  // WhatsApp phone mask
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

  // Import file
  const importInput = document.getElementById('import-file');
  if (importInput) importInput.addEventListener('change', handleImport);

  // Confirm dialog
  document.getElementById('btn-confirm-yes')
    ?.addEventListener('click', confirmYes);
  document.getElementById('btn-confirm-no')
    ?.addEventListener('click', confirmNo);

  // PWA install
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

  // Handle ?page= query param
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
        reg.addEventListener('updatefound', () => {
          showToast('Atualizando o app…', 'info');
        });
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

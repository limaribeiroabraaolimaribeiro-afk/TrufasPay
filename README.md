# TrufasPAY 🍫

Sistema PWA para controle de vendas fiadas de trufas com cobrança via WhatsApp.

## Como Rodar

O TrufasPAY é um PWA (Progressive Web App) que roda 100% no navegador — sem backend, sem banco de dados externo, sem internet obrigatória.

### Opção 1 — Live Server (VS Code)

1. Instale a extensão **Live Server** no VS Code
2. Clique com o botão direito em `index.html`
3. Selecione **"Open with Live Server"**
4. O app abrirá automaticamente em `http://127.0.0.1:5500`

### Opção 2 — Node.js (npx serve)

```bash
npx serve .
```
Acesse: `http://localhost:3000`

### Opção 3 — Python (sem instalação extra)

```bash
# Python 3
python -m http.server 8080

# Python 2
python -m SimpleHTTPServer 8080
```
Acesse: `http://localhost:8080`

### Opção 4 — Deploy gratuito (recomendado para celular)

Faça upload da pasta no **Netlify Drop** (netlify.com/drop) ou **GitHub Pages** para usar no celular como PWA instalável.

---

## Funcionalidades

### Dashboard
- Total pendente e total recebido
- Quantidade de clientes devendo
- Cobranças atrasadas com botão de cobrança em lote
- Últimas 5 cobranças registradas

### Cadastro de Venda
- Nome do cliente
- Número do WhatsApp (com máscara automática)
- Produto, quantidade e valor unitário
- Valor total calculado automaticamente
- Data de cobrança
- Observação opcional

### Lista de Cobranças
- Filtros: Todos / Pendentes / Atrasados / Cobrados / Pagos
- Seleção individual e em lote
- Ações: Cobrar via WhatsApp, Marcar como Pago, Editar, Excluir
- Cobrança em lote com fila guiada

### Fila de Cobrança (Lote)
1. Selecione os clientes desejados (ou use "Cobrar Atrasados")
2. O sistema cria uma fila, mostrando um por vez
3. Clique **"Abrir no WhatsApp"** — o app abre o WhatsApp com a mensagem pronta
4. Envie manualmente no WhatsApp
5. Volte ao app e clique **"Marcar Cobrado"** ou **"Próximo"**

### Mensagem Padrão do WhatsApp
```
Oi, [Nome]! Tudo bem?

Passando para lembrar que ficou pendente o valor de R$ X,XX referente às trufas.

Quando pagar, me avisa por aqui para eu dar baixa no sistema. 😊
```

### Status das Cobranças
| Status    | Significado |
|-----------|-------------|
| 🕐 Pendente  | Ainda não venceu |
| ⚠️ Atrasado  | Data de cobrança ultrapassada |
| 📤 Cobrado   | Mensagem enviada via WhatsApp |
| ✅ Pago      | Pagamento confirmado |

### Backup e Restauração
- Exporte todos os dados como arquivo `.json`
- Importe para restaurar ou transferir para outro dispositivo

---

## Estrutura do Projeto

```
TrufasPay/
├── index.html          → App principal
├── manifest.json       → Configuração PWA
├── sw.js               → Service Worker (offline)
├── css/
│   └── style.css       → Todos os estilos
├── js/
│   └── app.js          → Toda a lógica da aplicação
├── icons/
│   └── icon.svg        → Ícone do app
└── README.md
```

## Tecnologias

- **HTML5 / CSS3 / JavaScript** — sem frameworks, sem dependências
- **localStorage** — dados salvos localmente no navegador
- **Service Worker** — funciona offline após o primeiro carregamento
- **PWA** — instalável no celular como um app nativo

## Instalar como App no Celular

### Android (Chrome)
1. Acesse o app pelo Chrome
2. Toque no menu (⋮) > **"Adicionar à tela inicial"**
3. Confirme a instalação

### iOS (Safari)
1. Acesse o app pelo Safari
2. Toque no botão de compartilhar (□↑)
3. Selecione **"Adicionar à Tela de Início"**

---

*TrufasPAY v1.0.0 · Sem servidor · Dados offline · Privacidade total*

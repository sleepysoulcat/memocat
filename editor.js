// editor.js — abas, editor Quill, barra de formatação, tópicos, salvar/carregar HTML.
// Globais usadas também pelo cloud.js e search.js: quillInstances, tabsData, currentTabId,
// isCloudConnected, initializeQuill, updateEditorUI, updateTopics, switchTab, activeQuill, getTabTitle, deltaText.

let quillInstances = {};
let tabsData = {};            // abas locais: id -> Delta
let currentTabId = 'cloud-tab';
let isCloudConnected = false;

const STORE = 'memocat:abas';
const NOMES = ["meow", "mew", "mrrow", "mrrp", "prrr", "nya", "nyan", "Nyanyame..."];
const nomeAleatorio = () => NOMES[Math.floor(Math.random() * NOMES.length)];

const activeQuill = () => quillInstances[currentTabId === 'cloud-tab' ? 'cloud-editor' : 'editor'];

// texto de um Delta; embeds (imagens) viram 1 espaço, assim os índices batem com os do Quill
function deltaText(d) {
    const ops = d && d.ops ? d.ops : (Array.isArray(d) ? d : []);
    return ops.map(o => (typeof o.insert === 'string' ? o.insert : ' ')).join('');
}

function getTabTitle(id) {
    const el = document.querySelector(`.tab[data-id="${id}"] .tab-title`);
    return el ? el.textContent : 'documento';
}

// ---------- persistência das abas locais (sobrevivem ao F5) ----------

let persistTimer = null;
function persistTabs() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
        try {
            const tabs = [...document.querySelectorAll('#tabs .tab:not(.fixed)')]
                .map(t => ({ id: t.dataset.id, title: getTabTitle(t.dataset.id) }));
            localStorage.setItem(STORE, JSON.stringify({ tabs, data: tabsData }));
        } catch (err) {
            console.warn('Não deu para guardar as abas localmente (muito grande?):', err);
        }
    }, 400);
}

// ---------- Quill ----------

function initializeQuill(elementId) {
    if (quillInstances[elementId]) return quillInstances[elementId];

    const quill = new Quill(`#${elementId}`, {
        theme: 'snow',
        modules: { toolbar: false },   // usamos a nossa barra
    });
    quillInstances[elementId] = quill;

    quill.on('text-change', (delta, old, source) => {
        refreshToolbar();
        if (source !== 'user') return;
        updateTopics();
        if (elementId === 'editor' && tabsData.hasOwnProperty(currentTabId)) {
            tabsData[currentTabId] = quill.getContents();
            persistTabs();
        }
    });
    quill.on('selection-change', refreshToolbar);

    // Ctrl+clique abre o link
    quill.root.addEventListener('click', (e) => {
        const a = e.target.closest('a');
        if ((e.ctrlKey || e.metaKey) && a) window.open(a.href, '_blank', 'noopener');
    });

    return quill;
}

function updateEditorUI() {
    const onCloud = currentTabId === 'cloud-tab';
    document.getElementById('editor').style.display = onCloud ? 'none' : 'block';
    document.getElementById('cloud-editor').style.display = (onCloud && isCloudConnected) ? 'block' : 'none';
    document.getElementById('cloud-sync-container').style.display = (onCloud && !isCloudConnected) ? 'block' : 'none';

    // a barra de formatação só aparece quando há um editor visível
    const podeEditar = !onCloud || isCloudConnected;
    document.querySelector('.itens-bar').style.display = podeEditar ? 'flex' : 'none';
    if (!podeEditar) document.getElementById('image-pop').hidden = true;
}

// ---------- abas ----------

function createTab(title = "Sem título", content = [], id = `tab-${Date.now()}`, activate = true) {
    tabsData[id] = content;

    const tabElem = document.createElement("div");
    tabElem.className = "tab";
    tabElem.dataset.id = id;

    const label = document.createElement("span");
    label.className = "tab-title";
    label.textContent = title;
    label.title = "Duplo clique para renomear";
    label.addEventListener("dblclick", () => {
        const novo = prompt("Nome da aba:", label.textContent);
        if (novo && novo.trim()) { label.textContent = novo.trim(); persistTabs(); }
    });

    const closeBtn = document.createElement("span");
    closeBtn.textContent = "×";
    closeBtn.className = "close-tab";
    closeBtn.addEventListener("click", (e) => { e.stopPropagation(); closeTab(id); });

    tabElem.append(label, closeBtn);
    tabElem.addEventListener("click", () => switchTab(id));
    document.getElementById("tabs").appendChild(tabElem);

    if (activate) switchTab(id);
    persistTabs();
}

function switchTab(tabId) {
    const current = quillInstances.editor;
    if (currentTabId !== 'cloud-tab' && tabsData.hasOwnProperty(currentTabId) && current) {
        tabsData[currentTabId] = current.getContents();
    }

    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    currentTabId = tabId;
    const el = document.querySelector(`.tab[data-id="${tabId}"]`);
    if (el) el.classList.add("active");

    updateEditorUI();

    if (tabId !== 'cloud-tab') {
        const quill = initializeQuill('editor');
        quill.setContents(tabsData[tabId] || [], 'silent');
        quill.history.clear();   // Ctrl+Z não "volta" para o conteúdo de outra aba
    }
    updateTopics();
    refreshToolbar();
}

function closeTab(tabId) {
    if (tabId === 'cloud-tab') return;
    if (deltaText(tabsData[tabId]).trim() && !confirm(`Fechar "${getTabTitle(tabId)}"? O conteúdo será perdido.`)) return;

    const tabElem = document.querySelector(`.tab[data-id="${tabId}"]`);
    const vizinha = tabElem && (tabElem.previousElementSibling || tabElem.nextElementSibling);
    delete tabsData[tabId];
    if (tabElem) tabElem.remove();
    persistTabs();

    if (currentTabId === tabId) switchTab(vizinha ? vizinha.dataset.id : 'cloud-tab');
}

function restoreTabs() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE)); } catch (_) {}
    if (saved && saved.tabs && saved.tabs.length) {
        saved.tabs.forEach(t => createTab(t.title, (saved.data || {})[t.id] || [], t.id, false));
        switchTab(saved.tabs[0].id);
    } else {
        createTab(nomeAleatorio());
    }
}

// ---------- tópicos (linhas que começam com "# ") ----------

function updateTopics() {
    const topicList = document.getElementById("topic-list");
    topicList.innerHTML = "";

    const quill = activeQuill();
    if (!quill) return;
    const prefix = currentTabId === 'cloud-tab' ? 'cloud' : 'local';

    let n = 0;
    quill.root.childNodes.forEach((node) => {
        if (node.nodeType !== 1) return;

        if (!node.textContent.trimStart().startsWith("# ")) {
            node.classList.remove('topic-heading');
            return;
        }
        node.classList.add('topic-heading');
        node.id = `${prefix}-topic-${n++}`;

        const link = document.createElement("a");
        link.href = `#${node.id}`;
        link.textContent = node.textContent.trim().substring(2) || '(sem título)';
        link.onclick = (e) => { e.preventDefault(); node.scrollIntoView({ behavior: "smooth", block: "start" }); };

        const li = document.createElement("li");
        li.appendChild(link);
        topicList.appendChild(li);
    });
}

// ---------- barra de formatação (vale para a aba local e para a cloud) ----------

const ACTIONS = {
    bold:       { fmt: 'bold', val: true },
    italic:     { fmt: 'italic', val: true },
    underline:  { fmt: 'underline', val: true },
    strike:     { fmt: 'strike', val: true },
    blockquote: { fmt: 'blockquote', val: true },
    list:       { fmt: 'list', val: 'bullet' },
    code:       { fmt: 'code-block', val: true },
    link:       { run: insertLink },
    image:      { run: toggleImagePop },
    clear:      { run: clearFormat }
};

function refreshToolbar() {
    const quill = activeQuill();
    const f = quill ? quill.getFormat() : {};
    document.querySelectorAll('.itens-bar [data-action]').forEach(btn => {
        const a = ACTIONS[btn.dataset.action];
        btn.classList.toggle('active', !!(a && a.fmt && f[a.fmt] === a.val));
    });
}

function insertLink(quill) {
    const r = quill.getSelection(true);
    const atual = quill.getFormat(r).link || '';
    let url = prompt('Endereço do link (deixe vazio para remover):', atual);
    if (url === null) return;
    url = url.trim();
    if (!url) { quill.format('link', false, 'user'); return; }
    if (!/^(https?:|mailto:)/i.test(url)) url = 'https://' + url;
    if (r.length === 0) quill.insertText(r.index, url, { link: url }, 'user');
    else quill.formatText(r.index, r.length, 'link', url, 'user');
}

function clearFormat(quill) {
    const r = quill.getSelection(true);
    let start = r.index, len = r.length;
    if (len === 0) { const [line] = quill.getLine(r.index); start = quill.getIndex(line); len = line.length(); }
    quill.removeFormat(start, len, 'user');
}

// ---------- imagem (por link ou arquivo) ----------

let imageRange = null;

function toggleImagePop(quill) {
    const pop = document.getElementById('image-pop');
    pop.hidden = !pop.hidden;
    if (!pop.hidden) {
        imageRange = quill.getSelection(true);
        document.getElementById('image-url').focus();
    }
}

function insertImage(src) {
    const quill = activeQuill();
    if (!quill) return;
    const index = imageRange ? imageRange.index : quill.getLength();
    quill.insertEmbed(index, 'image', src, 'user');
    quill.setSelection(index + 1, 0, 'silent');
    document.getElementById('image-pop').hidden = true;
    document.getElementById('image-url').value = '';
}

// reduz a imagem antes de embutir (o Firestore aceita ~1 MB por documento)
function fileToDataURL(file, max = 900) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            const s = Math.min(1, max / Math.max(img.width, img.height));
            const c = document.createElement('canvas');
            c.width = Math.round(img.width * s);
            c.height = Math.round(img.height * s);
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            URL.revokeObjectURL(url);
            resolve(c.toDataURL('image/jpeg', 0.75));
        };
        img.onerror = reject;
        img.src = url;
    });
}

function setupImagePop() {
    const urlInput = document.getElementById('image-url');
    const okUrl = () => {
        let url = urlInput.value.trim();
        if (!url) return;
        if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
        insertImage(url);
    };
    document.getElementById('image-url-ok').addEventListener('click', okUrl);
    urlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') okUrl();
        if (e.key === 'Escape') document.getElementById('image-pop').hidden = true;
    });
    document.getElementById('image-file').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        try {
            const data = await fileToDataURL(file);
            const quill = activeQuill();
            if (currentTabId === 'cloud-tab' && quill.root.innerHTML.length + data.length > 900000) {
                alert('Essa imagem deixaria a nota da nuvem grande demais (limite do Firestore ~1 MB). Use o link da imagem.');
                return;
            }
            insertImage(data);
        } catch (_) { alert('Não consegui abrir essa imagem.'); }
    });
}

// ---------- ajustes: tamanho da fonte (guardado no localStorage) ----------

const FS_DEFAULT = 18;
let fontSize = FS_DEFAULT;
try { fontSize = parseInt(localStorage.getItem('memocat:fs')) || FS_DEFAULT; } catch (_) {}

function aplicarFonte(n) {
    fontSize = Math.min(40, Math.max(10, Math.round(n)));
    document.documentElement.style.setProperty('--fs', fontSize + 'px');
    try { localStorage.setItem('memocat:fs', fontSize); } catch (_) {}
    const range = document.getElementById('fs-range');
    const label = document.getElementById('fs-value');
    if (range) range.value = fontSize;
    if (label) label.textContent = fontSize + 'px';
}

function setupSettings() {
    document.getElementById('fs-minus').addEventListener('click', () => aplicarFonte(fontSize - 1));
    document.getElementById('fs-plus').addEventListener('click', () => aplicarFonte(fontSize + 1));
    document.getElementById('fs-range').addEventListener('input', (e) => aplicarFonte(+e.target.value));
    document.getElementById('fs-reset').addEventListener('click', () => aplicarFonte(FS_DEFAULT));
    aplicarFonte(fontSize);   // sincroniza os controles com o valor salvo
}

// ---------- barra lateral: alterna entre Cadernos e Ajustes ----------

let sidebarView = 'cadernos';

function setupSidebar() {
    const sidebar = document.getElementById('sidebar');
    const btnCadernos = document.getElementById('toggle-sidebar-btn');
    const btnAjustes = document.getElementById('settings-btn');

    const render = () => {
        const aberta = !sidebar.classList.contains('closed');
        document.getElementById('sidebar-notebooks').hidden = sidebarView !== 'cadernos';
        document.getElementById('sidebar-settings').hidden = sidebarView !== 'ajustes';
        btnCadernos.classList.toggle('on', aberta && sidebarView === 'cadernos');
        btnAjustes.classList.toggle('on', aberta && sidebarView === 'ajustes');
    };
    // clicar no botão da seção já aberta fecha a barra; clicar no outro troca de seção
    const clicar = (view) => {
        if (!sidebar.classList.contains('closed') && sidebarView === view) sidebar.classList.add('closed');
        else { sidebar.classList.remove('closed'); sidebarView = view; }
        render();
    };
    btnCadernos.addEventListener('click', () => clicar('cadernos'));
    btnAjustes.addEventListener('click', () => clicar('ajustes'));
    render();
}

// ---------- inicialização ----------

document.addEventListener("DOMContentLoaded", () => {
    const bar = document.querySelector('.itens-bar');
    // mousedown com preventDefault: o clique no botão não tira o foco/seleção do texto
    bar.addEventListener('mousedown', (e) => e.preventDefault());
    bar.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        const quill = activeQuill();
        if (!btn || !quill) return;
        const a = ACTIONS[btn.dataset.action];
        if (a.run) a.run(quill);
        else {
            quill.focus();
            // source 'user' é essencial: sem isso a aba cloud não salva a formatação
            quill.format(a.fmt, quill.getFormat()[a.fmt] === a.val ? false : a.val, 'user');
        }
        refreshToolbar();
    });
    setupImagePop();
    setupSettings();
    setupSidebar();

    document.getElementById("new-tab-btn").addEventListener("click", () => createTab(nomeAleatorio()));
    document.querySelector(".tab[data-id='cloud-tab']").addEventListener("click", () => switchTab('cloud-tab'));

    // Ctrl+S salva o HTML
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            document.getElementById('save-btn').click();
        }
    });

    setupSaveLoad();
    updateEditorUI();
    restoreTabs();
});

// ---------- salvar / carregar HTML ----------

function setupSaveLoad() {
    const saveBtn = document.getElementById("save-btn");
    const loadBtn = document.getElementById("load-btn");
    const fileInput = document.getElementById("file-input");

    saveBtn.addEventListener("click", () => {
        const quill = activeQuill();
        if (!quill) { alert("Nenhum editor ativo para salvar."); return; }

        const fileName = currentTabId === 'cloud-tab' ? 'nuvem' : getTabTitle(currentTabId);
        const styles = `
            body { font-family: sans-serif; line-height: 1.6; padding: 2rem; max-width: 800px; margin: auto; }
            .topic-heading { font-size: 1.5em; font-weight: 600; color: #2c3e50; margin: 1em 0 .5em; }
            img { max-width: 100%; height: auto; }
            blockquote { border-left: 4px solid #ccc; margin: 0; padding-left: 1em; }
            pre { background: #f0f0f0; padding: 8px 12px; border-radius: 4px; white-space: pre-wrap; }
        `;
        const fullHTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>${fileName}</title>
<style>${styles}</style>
</head>
<body>
<div id="memocat-content">${quill.root.innerHTML}</div>
</body>
</html>`;

        const link = document.createElement("a");
        link.href = URL.createObjectURL(new Blob([fullHTML], { type: "text/html" }));
        link.download = `${fileName}.html`;
        link.click();
        URL.revokeObjectURL(link.href);
    });

    loadBtn.addEventListener("click", () => fileInput.click());

    fileInput.addEventListener("change", (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const doc = new DOMParser().parseFromString(e.target.result, "text/html");
                const box = doc.getElementById('memocat-content');
                const html = box ? box.innerHTML : doc.body.innerHTML;   // sem marcador: usa o <body>

                const naCloud = currentTabId === 'cloud-tab' && isCloudConnected;
                if (naCloud) {
                    if (!confirm('Substituir o conteúdo da nuvem pelo arquivo?')) return;
                } else {
                    // arquivo abre numa aba nova, sem apagar o que já está escrito
                    createTab(file.name.replace(/\.(html|txt)$/i, ''));
                }
                const quill = activeQuill();
                quill.setContents([], 'silent');
                quill.clipboard.dangerouslyPasteHTML(0, html, 'user');   // 'user' => salva local/nuvem
            } catch (error) {
                console.error("Erro ao carregar o arquivo:", error);
                alert("Não foi possível carregar o arquivo.");
            }
        };
        reader.readAsText(file);
        event.target.value = '';
    });
}

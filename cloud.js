// cloud.js — destrava o cofre com a senha, inicia o Firebase e conecta no documento.
// Precisa ser carregado DEPOIS de editor.js e cofre.js (scripts clássicos, sem type="module").

(() => {
    let firebaseApp = null;
    let db = null;
    let currentDocRef = null;
    let unsubscribeFromDoc = null;
    let debounceTimer = null;
    let cloudQuill = null;

    const SENHA_SALVA = 'memocat:senha';
    const enc = new TextEncoder();
    const dec = new TextDecoder();

    // ---------- util ----------

    function setStatus(message, status) {
        window.dispatchEvent(new CustomEvent('cloud:status', { detail: { message, status } }));
    }

    const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

    // ---------- criptografia (senha -> chave -> abre o cofre) ----------

    async function decryptPayload(password, payload) {
        const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
        const chave = await crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt: b64ToBytes(payload.salt), iterations: payload.iter, hash: 'SHA-256' },
            base,
            { name: 'AES-GCM', length: 256 },
            false,
            ['decrypt']
        );
        // Senha errada = o AES-GCM recusa (lança erro). Não existe "meio certo".
        const plano = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(payload.iv) }, chave, b64ToBytes(payload.data));
        return JSON.parse(dec.decode(plano)); // { firebaseConfig, docId }
    }

    /**
     * Abre o cofre com a senha, inicializa o Firebase e conecta no documento.
     */
    async function unlock(password, remember = false) {
        if (!window.crypto || !crypto.subtle) {
            setStatus('Criptografia indisponível: abra o site por https:// (ou localhost).', 'error');
            return false;
        }
        if (!window.COFRE) {
            setStatus('cofre.js não encontrado. Gere um em gerar-cofre.html.', 'error');
            return false;
        }

        setStatus('Destravando...', 'loading');

        let segredo;
        try {
            segredo = await decryptPayload(password, window.COFRE);
        } catch (err) {
            console.error('Falha ao abrir o cofre:', err);
            try { localStorage.removeItem(SENHA_SALVA); } catch (_) {}
            setStatus('Senha incorreta.', 'error');
            return false;
        }

        try {
            firebaseApp = firebase.apps.length ? firebase.app() : firebase.initializeApp(segredo.firebaseConfig);
            db = firebaseApp.firestore();
        } catch (err) {
            console.error('Erro ao inicializar Firebase:', err);
            setStatus('Erro ao inicializar Firebase.', 'error');
            return false;
        }

        if (remember) {
            try { localStorage.setItem(SENHA_SALVA, password); } catch (_) {}
        }

        connect(segredo.docId);
        return true;
    }

    // ---------- Firestore ----------

    function connect(docId) {
        if (!db) return console.error('Firestore não inicializado.');

        if (unsubscribeFromDoc) unsubscribeFromDoc();

        setStatus('Conectando...', 'loading');

        currentDocRef = db.collection('documentos').doc(docId);

        unsubscribeFromDoc = currentDocRef.onSnapshot(docSnap => {
            // eco local da nossa própria escrita: ignora para não bagunçar o cursor
            if (docSnap.metadata.hasPendingWrites) return;

            const content = docSnap.exists
                ? docSnap.data().conteudo
                : '<p># Documento não encontrado. Começando um novo!</p>';

            window.dispatchEvent(new CustomEvent('cloud:dataReceived', { detail: { content } }));
            setStatus(`Conectado a: ${docId}`, 'connected');
        }, error => {
            console.error('Erro no listener do Firestore: ', error);
            setStatus('Erro de conexão. Verifique o console.', 'error');
        });
    }

    function save(content) {
        if (!db || !currentDocRef) return;

        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            currentDocRef.set({ conteudo: content }, { merge: true })
                .catch(error => {
                    console.error('Erro ao salvar na nuvem: ', error);
                    setStatus('Erro ao salvar.', 'error');
                });
        }, 1000);
    }

    // ---------- ligação com o editor ----------

    // Chegou conteúdo da nuvem: cria o Quill da aba cloud (1ª vez) e preenche
    window.addEventListener('cloud:dataReceived', (event) => {
        if (!cloudQuill) {
            cloudQuill = initializeQuill('cloud-editor'); // vem do editor.js
            cloudQuill.on('text-change', (delta, oldDelta, source) => {
                if (source === 'user') {
                    window.dispatchEvent(new CustomEvent('cloud:save', {
                        detail: { content: cloudQuill.root.innerHTML }
                    }));
                }
            });
        }

        const recebido = event.detail.content || '';
        if (recebido !== cloudQuill.root.innerHTML) {
            cloudQuill.setContents([], 'silent');
            cloudQuill.clipboard.dangerouslyPasteHTML(0, recebido, 'silent');
        }

        isCloudConnected = true; // variável do editor.js
        updateEditorUI();        // troca o formulário de senha pelo editor da nuvem
        updateTopics();
    });

    window.addEventListener('cloud:status', (event) => {
        const el = document.getElementById('cloud-status');
        if (el) el.textContent = event.detail.message;
    });

    window.addEventListener('cloud:save', (event) => save(event.detail.content));

    // ---------- interface ----------

    const input = document.getElementById('cloud-password');
    const botao = document.getElementById('connect-cloud-btn');
    const lembrar = document.getElementById('remember-pw');

    function submeter() {
        if (!input.value) return;
        unlock(input.value, lembrar.checked);
    }

    botao.addEventListener('click', submeter);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submeter(); });

    // entra sozinho se a senha foi salva neste navegador
    document.addEventListener('DOMContentLoaded', () => {
        let salva = null;
        try { salva = localStorage.getItem(SENHA_SALVA); } catch (_) {}
        if (salva) unlock(salva);
    });
})();

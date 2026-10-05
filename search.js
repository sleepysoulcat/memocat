// search.js — pesquisa na barra superior: um ícone que expande pela barra inteira.
// Pesquisa em todas as abas locais e também na aba da nuvem (quando conectada).
(() => {
    const wrap = document.getElementById('search-wrap');
    const input = document.getElementById('search-input');
    const results = document.getElementById('search-results');
    const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const flat = (s) => s.replace(/\s+/g, ' ');

    function docs() {
        const list = Object.entries(tabsData).map(([id, d]) => ({ id, title: getTabTitle(id), text: deltaText(d) }));
        const cloud = quillInstances['cloud-editor'];
        if (cloud) list.push({ id: 'cloud-tab', title: '☁ Nuvem', text: deltaText(cloud.getContents()) });
        return list;
    }

    function render(query) {
        results.innerHTML = '';
        const q = query.trim().toLowerCase();
        results.classList.toggle('show', !!q);
        if (!q) return;

        let found = 0;
        docs().forEach((d) => {
            const pos = d.text.toLowerCase().indexOf(q);
            if (pos < 0 && !d.title.toLowerCase().includes(q)) return;
            found++;

            let snippet = '';
            if (pos >= 0) {
                const a = Math.max(0, pos - 30), b = Math.min(d.text.length, pos + q.length + 50);
                snippet = (a > 0 ? '…' : '') + esc(flat(d.text.slice(a, pos))) +
                    '<mark>' + esc(flat(d.text.slice(pos, pos + q.length))) + '</mark>' +
                    esc(flat(d.text.slice(pos + q.length, b))) + (b < d.text.length ? '…' : '');
            }
            const item = document.createElement('div');
            item.className = 'search-result';
            item.innerHTML = `<strong>${esc(d.title)}</strong><span>${snippet}</span>`;
            item.addEventListener('click', () => go(d.id, pos, q.length));
            results.appendChild(item);
        });

        if (!found) results.innerHTML = '<div class="search-empty">Nada encontrado.</div>';
    }

    function go(id, pos, len) {
        close();
        switchTab(id);
        const quill = activeQuill();
        if (quill && pos >= 0) quill.setSelection(pos, len);   // seleciona o trecho e rola até ele
    }

    function open() { wrap.classList.add('open'); input.focus(); input.select(); }
    function close() {
        wrap.classList.remove('open');
        input.value = '';
        results.innerHTML = '';
        results.classList.remove('show');
    }

    document.getElementById('search-toggle').addEventListener('click', () =>
        wrap.classList.contains('open') ? close() : open());
    input.addEventListener('input', () => render(input.value));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') close();
        if (e.key === 'Enter') { const first = results.querySelector('.search-result'); if (first) first.click(); }
    });
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); open(); }
    });
    document.addEventListener('mousedown', (e) => {
        if (wrap.classList.contains('open') && !wrap.contains(e.target)) close();
    });
})();

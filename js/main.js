document.addEventListener('DOMContentLoaded', () => {

    // ── DOM refs ──────────────────────────────────────────────
    const repoList = document.getElementById('repo-list');
    const blogList = document.getElementById('blog-list');
    const vimModal = document.getElementById('vim-modal');
    const vimContent = document.getElementById('vim-content');
    const vimFilename = document.getElementById('vim-filename');
    const vimClose = document.getElementById('vim-close');
    const statusMode = document.getElementById('status-mode');
    const statusInfo = document.getElementById('status-info');
    const tmuxClock = document.getElementById('tmux-clock');
    const username = 'proxydom';

    let allRepos = [];
    let blogPosts = [];

    // ── Clock ────────────────────────────────────────────────
    function updateClock() {
        const now = new Date();
        const h = String(now.getHours()).padStart(2, '0');
        const m = String(now.getMinutes()).padStart(2, '0');
        const s = String(now.getSeconds()).padStart(2, '0');
        tmuxClock.textContent = `${h}:${m}:${s}`;
    }
    updateClock();
    setInterval(updateClock, 1000);

    // ── Neofetch uptime (simulated from a fake boot epoch) ───
    const bootEpoch = new Date('2026-02-23T03:14:00').getTime();
    const uptimeEl = document.getElementById('nf-uptime');

    function updateUptime() {
        if (!uptimeEl) return;
        const diffMs = Date.now() - bootEpoch;
        const diffSec = Math.floor(diffMs / 1000);
        const hours = Math.floor(diffSec / 3600);
        const mins = Math.floor((diffSec % 3600) / 60);
        uptimeEl.textContent = `${hours} hours, ${mins} mins`;
    }
    updateUptime();
    setInterval(updateUptime, 60000);

    // ── Tab navigation ────────────────────────────────────────
    const tabs = document.querySelectorAll('.tmux-tab');
    const sections = document.querySelectorAll('.section');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    function switchTab(id) {
        tabs.forEach(t => t.classList.remove('active'));
        sections.forEach(s => s.classList.remove('active'));
        const target = document.querySelector(`.tmux-tab[data-tab="${id}"]`);
        if (target) target.classList.add('active');
        const section = document.getElementById(id);
        if (section) section.classList.add('active');
        setStatus('NORMAL', `:e ${id}/`);
    }

    // ── Status bar helper ─────────────────────────────────────
    function setStatus(mode, info) {
        statusMode.textContent = mode;
        statusInfo.textContent = info;
    }

    // ── Render Repos ──────────────────────────────────────────
    function renderRepos(repos) {
        repoList.innerHTML = '';

        const filtered = repos.filter(r =>
            r.name.toLowerCase() !== username.toLowerCase() && !r.fork
        );

        if (!filtered.length) {
            repoList.innerHTML = `<li class="file-row loading-row">
                <span class="file-perms">drwxr-xr-x</span>
                <span class="file-user">${username}</span>
                <span class="file-size">0</span>
                <span class="file-name dim">no public repos found</span>
            </li>`;
            return;
        }

        // Header line
        const header = document.createElement('li');
        header.style.cssText = 'color:var(--dim);font-size:.85em;padding:2px 4px;';
        header.textContent = `total ${filtered.length}`;
        repoList.appendChild(header);

        filtered.forEach(repo => {
            // Main row
            const li = document.createElement('li');
            li.className = 'file-row';
            li.setAttribute('tabindex', '0');
            li.setAttribute('role', 'button');
            li.setAttribute('aria-expanded', 'false');

            const sizeKb = repo.size ? `${repo.size}k` : '?k';
            const lang = repo.language ? repo.language.toLowerCase().slice(0, 3) : 'bin';

            li.innerHTML = `
                <span class="file-perms">drwxr-xr-x</span>
                <span class="file-user">${username}</span>
                <span class="file-size">${sizeKb}</span>
                <span class="file-name dir">${repo.name}/</span>
            `;

            // Detail row (hidden by default, shown on click)
            const detail = document.createElement('li');
            detail.className = 'file-detail';
            detail.innerHTML = `<span style="color:var(--warn)">[${lang.toUpperCase()}]</span> ${repo.description || 'No description available.'}
<a href="${repo.html_url}" target="_blank" rel="noopener">→ ${repo.html_url}</a>`;

            const toggle = () => {
                const open = detail.classList.toggle('open');
                li.setAttribute('aria-expanded', open);
                if (open) setStatus('INSERT', repo.name);
                else setStatus('NORMAL', `:e projects/`);
            };

            li.addEventListener('click', toggle);
            li.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
            });

            repoList.appendChild(li);
            repoList.appendChild(detail);
        });
    }

    // ── Fetch Repos ───────────────────────────────────────────
    function fetchRepos() {
        fetch(`https://api.github.com/users/${username}/repos?sort=updated&per_page=50`)
            .then(r => r.json())
            .then(data => {
                allRepos = data;
                renderRepos(data);
            })
            .catch(() => {
                repoList.innerHTML = `<li class="file-row loading-row">
                    <span class="file-perms">-r--------</span>
                    <span class="file-user">root</span>
                    <span class="file-size">0</span>
                    <span class="file-name" style="color:var(--err)">ERROR: github_api unreachable</span>
                </li>`;
            });
    }

    // ── Render Blog ───────────────────────────────────────────
    function renderBlog(posts) {
        blogList.innerHTML = '';

        if (!posts.length) {
            blogList.innerHTML = `<li class="file-row loading-row">
                <span class="file-perms">-rw-r--r--</span>
                <span class="file-user">${username}</span>
                <span class="file-size">0</span>
                <span class="file-name dim">no writeups found</span>
            </li>`;
            return;
        }

        posts.forEach(post => {
            const li = document.createElement('li');
            li.className = 'file-row';
            li.setAttribute('tabindex', '0');
            li.setAttribute('role', 'button');

            // estimate file size
            const sizeBytes = post.content ? `${Math.ceil(post.content.length / 1024)}k` : '?k';

            li.innerHTML = `
                <span class="file-perms">-rw-r--r--</span>
                <span class="file-user">${username}</span>
                <span class="file-size">${sizeBytes}</span>
                <span class="file-name exe"><span class="tag-badge">${post.tag || 'INFO'}</span>${post.filename || post.title}</span>
            `;

            const open = () => openVimModal(post);
            li.addEventListener('click', open);
            li.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
            });

            blogList.appendChild(li);
        });
    }

    // ── Fetch Blog ────────────────────────────────────────────
    function fetchBlog() {
        fetch('intel.json')
            .then(r => { if (!r.ok) throw r; return r.json(); })
            .then(data => { blogPosts = data; renderBlog(data); })
            .catch(() => {
                blogList.innerHTML = `<li class="file-row loading-row">
                    <span class="file-perms">-r--------</span>
                    <span class="file-user">root</span>
                    <span class="file-size">0</span>
                    <span class="file-name" style="color:var(--err)">ERROR: intel.json not found</span>
                </li>`;
            });
    }

    // ── Vim Modal ─────────────────────────────────────────────
    function openVimModal(post) {
        vimFilename.textContent = post.filename || (post.title + '.md');
        const md = typeof marked !== 'undefined'
            ? marked.parse(post.content || '')
            : `<pre>${post.content || ''}</pre>`;
        vimContent.innerHTML = md;
        vimContent.scrollTop = 0;
        vimModal.classList.add('active');
        setStatus('INSERT', `reading: ${vimFilename.textContent}`);
        vimClose.focus();

        // Push state to history so back button closes modal
        history.pushState({ modalOpen: true }, '');
    }

    function closeVimModal(isPopState = false) {
        if (!vimModal.classList.contains('active')) return;
        
        vimModal.classList.remove('active');
        setStatus('NORMAL', ':help for shortcuts');

        // If closed via button/:q!, go back in history to clear the state
        if (!isPopState) {
            history.back();
        }
    }

    vimClose.addEventListener('click', () => closeVimModal(false));
    
    // Listen for back button
    window.addEventListener('popstate', (e) => {
        closeVimModal(true);
    });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && vimModal.classList.contains('active')) closeVimModal(false);
    });

    // ── Init ──────────────────────────────────────────────────
    fetchRepos();
    fetchBlog();
    setStatus('NORMAL', ':help for shortcuts');
});

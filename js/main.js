document.addEventListener('DOMContentLoaded', () => {

    // ── DOM refs ──────────────────────────────────────────────
    const repoList = document.getElementById('repo-list');
    const blogList = document.getElementById('blog-list');
    const vimModal = document.getElementById('vim-modal');
    const vimContent = document.getElementById('vim-content');
    const vimFilename = document.getElementById('vim-filename');
    const vimCopyLink = document.getElementById('vim-copy-link');
    const vimClose = document.getElementById('vim-close');
    const statusMode = document.getElementById('status-mode');
    const statusInfo = document.getElementById('status-info');
    const tmuxClock = document.getElementById('tmux-clock');
    const username = 'proxydom';
    const repoCacheKey = 'proxydom.github.repos.v1';
    const repoCacheTtl = 6 * 60 * 60 * 1000;

    let allRepos = [];
    let blogPosts = [];

    // Browser title and favicon stay quiet enough to feel like terminal chrome.
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const favicon = document.getElementById('site-favicon');

    function startTitleBlink() {
        document.title = 'proxydom †';
        if (reducedMotion.matches) return;

        setInterval(() => {
            if (vimModal.classList.contains('active')) return;
            document.title = 'proxydom';
            setTimeout(() => {
                if (!vimModal.classList.contains('active')) document.title = 'proxydom †';
            }, 140);
        }, 2400);
    }

    function startFavicon() {
        if (!favicon || !window.Worker) return;

        const worker = new Worker('js/favicon_worker.js');
        worker.addEventListener('message', event => {
            if (event.data.type === 'frame') favicon.href = event.data.dataUrl;
        });
        worker.postMessage({ type: 'start', animate: !reducedMotion.matches });
    }

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
        const paths = {
            home: '/home/proxydom',
            projects: '/home/proxydom/projects',
            writeups: '/home/proxydom/writeups'
        };
        setStatus('NORMAL', `:e ${paths[id] || id}`);
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
                else setStatus('NORMAL', ':e /home/proxydom/projects');
            };

            li.addEventListener('click', toggle);
            li.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
            });

            repoList.appendChild(li);
            repoList.appendChild(detail);
        });
    }

    // ── GitHub repo cache ─────────────────────────────────────
    function normalizeRepos(repos) {
        return repos
            .filter(repo =>
                repo &&
                typeof repo.name === 'string' &&
                repo.name.toLowerCase() !== username.toLowerCase() &&
                repo.name.toLowerCase() !== `${username.toLowerCase()}.github.io` &&
                !repo.fork
            )
            .map(repo => ({
                name: repo.name,
                fork: false,
                size: Number.isFinite(repo.size) ? repo.size : 0,
                language: typeof repo.language === 'string' ? repo.language : null,
                description: typeof repo.description === 'string' ? repo.description : null,
                html_url: typeof repo.html_url === 'string' ? repo.html_url : ''
            }));
    }

    function readRepoCache() {
        try {
            const cached = JSON.parse(localStorage.getItem(repoCacheKey));
            if (!cached || !Array.isArray(cached.repos) || !Number.isFinite(cached.savedAt)) return null;
            const compact = {
                savedAt: cached.savedAt,
                repos: normalizeRepos(cached.repos)
            };
            localStorage.setItem(repoCacheKey, JSON.stringify(compact));
            return compact;
        } catch {
            return null;
        }
    }

    function writeRepoCache(repos) {
        try {
            localStorage.setItem(repoCacheKey, JSON.stringify({
                savedAt: Date.now(),
                repos
            }));
        } catch {
            // Storage can be unavailable in private or restricted contexts.
        }
    }

    function renderRepoError() {
        repoList.innerHTML = `<li class="file-row loading-row">
            <span class="file-perms">-r--------</span>
            <span class="file-user">root</span>
            <span class="file-size">0</span>
            <span class="file-name" style="color:var(--err)">ERROR: github_api unreachable</span>
        </li>`;
    }

    // ── Fetch Repos ───────────────────────────────────────────
    function fetchRepos() {
        const cached = readRepoCache();

        if (cached) {
            allRepos = cached.repos;
            renderRepos(cached.repos);

            if (Date.now() - cached.savedAt < repoCacheTtl) return;
        }

        fetch(`https://api.github.com/users/${username}/repos?sort=updated&per_page=50`, {
            headers: { Accept: 'application/vnd.github+json' }
        })
            .then(response => {
                if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
                return response.json();
            })
            .then(data => {
                if (!Array.isArray(data)) throw new Error('Unexpected GitHub API response');
                const repos = normalizeRepos(data);
                allRepos = repos;
                writeRepoCache(repos);
                renderRepos(repos);
            })
            .catch(() => {
                if (!cached) renderRepoError();
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

            const sizeBytes = post.size ? `${Math.ceil(post.size / 1024)}k` : '?k';
            const permalink = getPostUrl(post);

            li.innerHTML = `
                <span class="file-perms">-rw-r--r--</span>
                <span class="file-user">${username}</span>
                <span class="file-size">${sizeBytes}</span>
                <a class="file-name exe post-link" href="${permalink}"><span class="tag-badge">${post.tag || 'INFO'}</span>${post.filename || post.title}</a>
            `;

            const open = () => openVimModal(post, 'push');
            const link = li.querySelector('.post-link');

            link.addEventListener('click', event => {
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                open();
            });

            li.addEventListener('click', event => {
                if (!event.target.closest('a')) open();
            });
            li.addEventListener('keydown', e => {
                if ((e.key === 'Enter' || e.key === ' ') && e.target === li) {
                    e.preventDefault();
                    open();
                }
            });

            blogList.appendChild(li);
        });
    }

    // ── Fetch Blog ────────────────────────────────────────────
    function fetchBlog() {
        fetch('intel.json')
            .then(r => { if (!r.ok) throw r; return r.json(); })
            .then(data => {
                blogPosts = data;
                renderBlog(data);
                openPostFromLocation(true);
            })
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
    function renderMarkdown(markdown) {
        const body = markdown.replace(/^---\s*[\s\S]*?\s*---\s*/, '');
        return typeof marked !== 'undefined'
            ? marked.parse(body || '')
            : `<pre>${body || ''}</pre>`;
    }

    function getPostSlug(post) {
        return (post.filename || post.title).replace(/\.md$/i, '');
    }

    function getPostUrl(post) {
        return `?post=${encodeURIComponent(getPostSlug(post))}`;
    }

    function findPostBySlug(slug) {
        return blogPosts.find(post =>
            getPostSlug(post) === slug || post.filename === slug
        );
    }

    function openPostFromLocation(isInitialLoad = false) {
        const slug = new URLSearchParams(window.location.search).get('post');

        if (!slug) {
            closeVimModal(true);
            return;
        }

        const post = findPostBySlug(slug);
        if (!post) {
            switchTab('writeups');
            setStatus('NORMAL', `ERROR: writeup not found: ${slug}`);
            return;
        }

        switchTab('writeups');
        openVimModal(post, isInitialLoad ? 'direct' : 'none');
    }

    function openVimModal(post, historyMode = 'push') {
        const slug = getPostSlug(post);

        if (historyMode === 'push') {
            history.pushState({ modalOpen: true, directEntry: false, post: slug }, '', getPostUrl(post));
        } else if (historyMode === 'direct') {
            history.replaceState({ modalOpen: true, directEntry: true, post: slug }, '', window.location.href);
        }

        vimFilename.textContent = post.filename || (post.title + '.md');
        vimContent.innerHTML = '<pre>loading article...</pre>';
        vimContent.scrollTop = 0;
        vimModal.classList.add('active');
        document.title = `${post.title} // proxydom`;
        setStatus('INSERT', `reading: ${vimFilename.textContent}`);
        vimClose.focus();

        fetch(`posts/${encodeURIComponent(post.filename)}`)
            .then(r => { if (!r.ok) throw r; return r.text(); })
            .then(markdown => {
                if (vimFilename.textContent === (post.filename || (post.title + '.md'))) {
                    vimContent.innerHTML = renderMarkdown(markdown);
                    vimContent.scrollTop = 0;
                }
            })
            .catch(() => {
                vimContent.innerHTML = '<pre>ERROR: article not found</pre>';
                setStatus('NORMAL', `error: ${vimFilename.textContent}`);
            });
    }

    function closeVimModal(isPopState = false) {
        if (!vimModal.classList.contains('active')) return;

        vimModal.classList.remove('active');
        document.title = 'proxydom †';
        setStatus('NORMAL', ':e /home/proxydom/writeups');

        if (!isPopState) {
            if (history.state?.modalOpen && !history.state.directEntry) {
                history.back();
            } else {
                const url = new URL(window.location.href);
                url.searchParams.delete('post');
                history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
            }
        }
    }

    async function copyPostLink() {
        const url = window.location.href;

        try {
            await navigator.clipboard.writeText(url);
        } catch {
            const input = document.createElement('textarea');
            input.value = url;
            input.setAttribute('readonly', '');
            input.style.position = 'fixed';
            input.style.opacity = '0';
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            input.remove();
        }

        vimCopyLink.textContent = '[yanked]';
        setStatus('VISUAL', 'permalink copied to clipboard');
        setTimeout(() => {
            vimCopyLink.textContent = ':yank url';
            if (vimModal.classList.contains('active')) {
                setStatus('INSERT', `reading: ${vimFilename.textContent}`);
            }
        }, 1400);
    }

    vimClose.addEventListener('click', () => closeVimModal(false));
    vimCopyLink.addEventListener('click', copyPostLink);

    window.addEventListener('popstate', () => openPostFromLocation(false));

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && vimModal.classList.contains('active')) closeVimModal(false);
    });

    // ── Init ──────────────────────────────────────────────────
    startTitleBlink();
    startFavicon();
    fetchRepos();
    fetchBlog();
    setStatus('NORMAL', 'PROXYDOM // terminal online');
});

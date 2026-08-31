/* =====================================================
   PEN FIGHT — UNIVERSAL COMIC TOP NAVIGATION SCRIPT
   Theme: "Warm Comic Zine Arena"
   ===================================================== */

(function() {
  function initComicNav() {
    if (document.getElementById('pf-universal-nav')) return;

    const path = window.location.pathname.toLowerCase();
    const isArena = path === '/' || path.endsWith('/index.html') || path === '';
    const isPens = path.includes('pens.html');
    const isRules = path.includes('rules.html');

    let isMuted = localStorage.getItem('pf_sound_muted') === 'true';

    const nav = document.createElement('header');
    nav.id = 'pf-universal-nav';
    nav.className = 'pf-top-nav';

    nav.innerHTML = `
      <a href="/" class="pf-nav-brand">
        <span class="pf-nav-brand-text">⚡ PEN FIGHT</span>
      </a>

      <ul class="pf-nav-links" id="pf-nav-menu">
        <li class="pf-nav-item ${isArena ? 'active' : ''}">
          <a href="/index.html">🕹️ ARENA</a>
        </li>
        <li class="pf-nav-item">
          <a href="javascript:void(0)" onclick="if(window.showFriendSetup) window.showFriendSetup(); else location.href='/index.html?setup=multi';" style="color:var(--pf-orange); font-weight:700;">👥 MULTIPLAYER</a>
        </li>
        <li class="pf-nav-item ${isPens ? 'active' : ''}">
          <a href="/pens.html">🖊️ ARSENAL</a>
        </li>
        <li class="pf-nav-item ${isRules ? 'active' : ''}">
          <a href="/rules.html">📖 RULES</a>
        </li>
      </ul>

      <div class="pf-nav-actions">
        <button type="button" class="pf-sound-btn ${isMuted ? 'muted' : ''}" id="pf-sound-toggle" title="Toggle Sound">
          <span id="pf-sound-icon">${isMuted ? '🔇' : '🔊'}</span>
          <span id="pf-sound-label">${isMuted ? 'MUTED' : 'SOUND'}</span>
        </button>

        <button type="button" class="pf-nav-mobile-toggle" id="pf-mobile-toggle" aria-label="Toggle Menu">
          ☰
        </button>
      </div>
    `;

    document.body.prepend(nav);

    // Mobile Toggle
    const toggleBtn = document.getElementById('pf-mobile-toggle');
    const menu = document.getElementById('pf-nav-menu');
    if (toggleBtn && menu) {
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.toggle('open');
      });

      document.addEventListener('click', (e) => {
        if (!nav.contains(e.target)) {
          menu.classList.remove('open');
        }
      });
    }

    // Sound Toggle Logic
    const soundBtn = document.getElementById('pf-sound-toggle');
    const soundIcon = document.getElementById('pf-sound-icon');
    const soundLabel = document.getElementById('pf-sound-label');

    function applySoundState() {
      if (soundBtn) {
        soundBtn.classList.toggle('muted', isMuted);
      }
      if (soundIcon) soundIcon.textContent = isMuted ? '🔇' : '🔊';
      if (soundLabel) soundLabel.textContent = isMuted ? 'MUTED' : 'SOUND';

      // Control HTML5 Audio elements
      document.querySelectorAll('audio, video').forEach(el => {
        el.muted = isMuted;
      });

      // Control Web Audio Context if present
      if (window.__pf && window.__pf.audioCtx) {
        if (isMuted && window.__pf.audioCtx.state === 'running') {
          window.__pf.audioCtx.suspend();
        } else if (!isMuted && window.__pf.audioCtx.state === 'suspended') {
          window.__pf.audioCtx.resume();
        }
      }
    }

    if (soundBtn) {
      soundBtn.addEventListener('click', () => {
        isMuted = !isMuted;
        localStorage.setItem('pf_sound_muted', isMuted);
        applySoundState();
      });
    }

    applySoundState();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initComicNav);
  } else {
    initComicNav();
  }
})();

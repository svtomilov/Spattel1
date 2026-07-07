(function () {
  var prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function initContent() {
    // Editable copy lives in content.json (managed via /admin.html, which
    // commits to GitHub and re-deploys). The strings hardcoded in index.html
    // are the fallback: if the fetch fails (file://, JSON missing or broken),
    // the page simply keeps them.
    if (!window.fetch) return;
    fetch('content.json', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) {
        document.querySelectorAll('[data-field]').forEach(function (el) {
          var val = el.getAttribute('data-field').split('.').reduce(function (o, k) {
            return o == null ? o : o[k];
          }, data);
          if (typeof val !== 'string' || !val) return;
          // data-html is only for fields that legitimately carry markup
          // (the hero headline's <em>); everything else is plain text.
          if (el.hasAttribute('data-html')) el.innerHTML = val;
          else el.textContent = val;
        });
        var list = document.getElementById('faqList');
        if (list && Array.isArray(data.faq) && data.faq.length) {
          list.innerHTML = '';
          data.faq.forEach(function (item) {
            if (!item || !item.q || !item.a) return;
            var d = document.createElement('details');
            d.className = 'q';
            var s = document.createElement('summary');
            s.textContent = item.q;
            var p = document.createElement('p');
            p.textContent = item.a;
            d.appendChild(s);
            d.appendChild(p);
            list.appendChild(d);
          });
        }
      })
      .catch(function () { /* keep the HTML defaults */ });
  }

  function initReveal() {
    var targets = document.querySelectorAll('.reveal');
    if (prefersReduced || !window.gsap || !window.ScrollTrigger) {
      targets.forEach(function (el) { el.style.opacity = 1; el.style.transform = 'none'; });
      return;
    }
    gsap.registerPlugin(ScrollTrigger);
    targets.forEach(function (el) {
      gsap.to(el, {
        opacity: 1,
        y: 0,
        duration: 0.7,
        ease: 'power2.out',
        scrollTrigger: { trigger: el, start: 'top 88%', once: true }
      });
    });
  }

  function initHeroStage() {
    // Scroll-scrubs assets/hero-transform.mp4: scroll position within #hero3d
    // (a tall 300vh driver) maps to video.currentTime, so the flat-to-loft
    // transformation plays forward/backward as the user scrolls up/down.
    var section = document.getElementById('hero3d');
    var video = document.getElementById('stageVideo');
    var sticky = section && section.querySelector('.stage-sticky');
    var overlay = section && section.querySelector('.stage-overlay');
    var hint = overlay && overlay.querySelector('.so-hint');
    if (!section || !video) return;

    // If the video can't load at all, collapse the stage instead of leaving
    // a tall empty dark scroll — the visitor lands straight on the hero copy.
    var hideStage = function () { section.classList.add('hero-stage--hidden'); };
    if (video.error) { hideStage(); return; }
    video.addEventListener('error', hideStage);

    // Mobile browsers (notably iOS Safari) often decode and paint no frame at
    // all for a <video> that has never been played — setting currentTime alone
    // silently does nothing until playback has started at least once. A muted
    // video is allowed to play() without a user gesture, so "prime" it with an
    // immediate play/pause right after metadata loads: this unlocks the decoder
    // and makes programmatic seeking actually paint frames on scroll.
    var primed = false;
    function primeVideo() {
      if (primed) return;
      primed = true;
      var p = video.play();
      if (p && p.catch) p.catch(function () { /* ignored — seeking is attempted regardless */ });
      video.pause();
    }

    if (prefersReduced) {
      // Respect reduced motion: rest on the resolved "loft" end-state, no scrubbing.
      section.classList.add('hero-stage--static');
      var showEnd = function () {
        primeVideo();
        try { video.currentTime = Math.max(0, video.duration - 0.05); } catch (e) {}
      };
      if (video.readyState >= 1) showEnd();
      else video.addEventListener('loadedmetadata', showEnd, { once: true });
      return;
    }

    // The intro line ("Из убитой вторички…") starts at the BOTTOM EDGE of the
    // viewport at scroll 0 and rises to the vertical MIDDLE of the screen as
    // the scrub plays (eased, so the motion is perceptible from the very
    // first pixel of scroll). On mobile the sticky box is stretched below the
    // 16:9 video so its bottom edge lands right under the line's resting
    // spot — the hero section then pulls up close beneath the settled line.
    // On desktop the video fills the viewport under the header and the line
    // rises over it to the same mid-screen resting spot.
    var shiftStart = 0, shiftEnd = 0;
    function measureRise() {
      if (!overlay || !sticky) return;
      var head = document.querySelector('header');
      var headH = head ? head.offsetHeight : 0;
      var H = window.innerHeight;
      var overlayH = overlay.offsetHeight;
      if (window.matchMedia('(max-width:720px)').matches) {
        // Size the sticky so its bottom edge = the settled line's bottom
        // (mid-screen centre + half the line's height). The video keeps its
        // own aspect-ratio height at the top; the extra space below is the
        // same dark gradient the tall driver already paints.
        var videoH = video.offsetHeight;
        var stickyH = Math.max(videoH, Math.round(H / 2 + overlayH / 2 - headH));
        sticky.style.height = stickyH + 'px';
      } else {
        sticky.style.height = '';
      }
      var stickyBottom = headH + sticky.offsetHeight;
      // Resting spot: line vertically centred in the viewport (translate
      // relative to its CSS anchor at the sticky's bottom edge).
      shiftEnd = (H / 2 + overlayH / 2) - stickyBottom;
      // Start spot: line's bottom at the viewport's bottom edge — just above
      // the fixed mobile CTA bar when that is visible (offsetParent is always
      // null for fixed elements, so check computed display instead).
      var mcta = document.getElementById('mCta');
      var inset = 16;
      if (mcta && getComputedStyle(mcta).display !== 'none') inset = mcta.offsetHeight;
      shiftStart = (H - inset) - stickyBottom;
    }

    var duration = 0;
    function setDuration() {
      duration = video.duration || 0;
      primeVideo();
      onScroll(); // sync the frame to the current scroll position right away
    }
    // Metadata may already be available (cache/fast load) before this runs.
    if (video.readyState >= 1) setDuration();
    else video.addEventListener('loadedmetadata', setDuration, { once: true });

    // Seeking a compressed video is decode work, not a free property set —
    // firing it on every animation frame (~60/s) asks the decoder for more
    // seeks per second than it can actually service, especially on phones,
    // which is what reads as "jerky" rather than smooth. Thin the seeks out
    // to a fixed interval during active scrolling, then snap to the exact
    // frame once scrolling settles so it's still frame-accurate at rest.
    var SEEK_INTERVAL_MS = 90;
    var lastSeekAt = 0;
    var settleTimer = null;

    function seekTo(progress) {
      if (!duration) return;
      video.currentTime = Math.min(progress * duration, Math.max(0, duration - 0.05));
    }

    var ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        var rect = section.getBoundingClientRect();
        var scrollable = section.offsetHeight - window.innerHeight;
        var progress = scrollable > 0 ? Math.min(1, Math.max(0, -rect.top / scrollable)) : 0;

        var now = performance.now();
        if (now - lastSeekAt >= SEEK_INTERVAL_MS) {
          seekTo(progress);
          lastSeekAt = now;
        }
        clearTimeout(settleTimer);
        settleTimer = setTimeout(function () { seekTo(progress); }, SEEK_INTERVAL_MS + 40);

        // Intro line rises from the bottom edge toward mid-screen. Cubic
        // ease-out: it moves the moment scrolling begins and settles softly
        // (≈97% of the way by progress 0.7) while the scrub finishes.
        var eased = 1 - Math.pow(1 - progress, 3);
        if (overlay) overlay.style.transform = 'translateY(' + (shiftStart + (shiftEnd - shiftStart) * eased) + 'px)';
        // The "листайте" hint has done its job once scrolling starts.
        if (hint) hint.style.opacity = Math.max(0, 1 - progress / 0.35);
        ticking = false;
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', function () { measureRise(); onScroll(); }, { passive: true });
    // Re-measure once webfonts land — they change the overlay's height.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { measureRise(); onScroll(); });
    }
    measureRise();
    onScroll();
  }

  function initStickyCta() {
    var form = document.getElementById('zayavka');
    var cta = document.getElementById('mCta');
    if (!form || !cta) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { cta.style.display = e.isIntersecting ? 'none' : ''; });
    }, { threshold: 0.15 });
    io.observe(form);
  }

  function initForm() {
    var form = document.querySelector('#zayavka form');
    if (!form) return;
    // Native submit (button type="submit" + this handler) means Enter in any
    // field submits too — not only a pointer click on the button.
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var phone = document.getElementById('f-phone');
      var err = document.getElementById('f-phone-err');
      var digits = phone.value.replace(/\D/g, '');
      if (digits.length < 10) {
        phone.setAttribute('aria-invalid', 'true');
        if (err) err.hidden = false;
        phone.focus();
        return;
      }
      phone.removeAttribute('aria-invalid');
      if (err) err.hidden = true;
      // TODO: подключить отправку заявки в Telegram-бот / на почту / в CRM
      document.getElementById('formBody').style.display = 'none';
      var ok = document.getElementById('okMsg');
      ok.style.display = 'block';
      ok.setAttribute('tabindex', '-1');
      ok.focus();
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initContent();
    initReveal();
    initHeroStage();
    initStickyCta();
    initForm();
  });
})();

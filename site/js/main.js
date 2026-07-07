(function () {
  var prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
    var fadeOut = section && section.querySelector('.stage-fade-out');
    var overlay = section && section.querySelector('.stage-overlay');
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

    var duration = 0;
    function setDuration() {
      duration = video.duration || 0;
      primeVideo();
      onScroll(); // sync the frame to the current scroll position right away
    }
    // Metadata may already be available (cache/fast load) before this runs.
    if (video.readyState >= 1) setDuration();
    else video.addEventListener('loadedmetadata', setDuration, { once: true });

    var ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        var rect = section.getBoundingClientRect();
        var scrollable = section.offsetHeight - window.innerHeight;
        var progress = scrollable > 0 ? Math.min(1, Math.max(0, -rect.top / scrollable)) : 0;
        if (duration) video.currentTime = Math.min(progress * duration, Math.max(0, duration - 0.05));
        // Intro overlay text dissolves within the first ~12% of scroll.
        if (overlay) overlay.style.opacity = Math.max(0, 1 - progress / 0.12);
        // Blend the last ~18% of scroll into --sand so the section hands off
        // seamlessly into the hero copy below instead of cutting abruptly.
        if (fadeOut) fadeOut.style.opacity = Math.max(0, (progress - 0.82) / 0.18);
        ticking = false;
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
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
    initReveal();
    initHeroStage();
    initStickyCta();
    initForm();
  });
})();

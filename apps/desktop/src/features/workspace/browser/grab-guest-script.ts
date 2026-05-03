export const GRAB_GUEST_SCRIPT = `
(function() {
  if (window.__orchestraGrabActive) return;
  window.__orchestraGrabActive = true;

  // Full-page mouse capture — lets us track hover without blocking hit-testing
  const overlay = document.createElement('div');
  overlay.id = '__orchestra-grab-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:999997;cursor:crosshair;';
  document.body.appendChild(overlay);

  // Highlight box — positioned overlay instead of mutating target.style.outline
  // so that CSS resets (outline:none !important) cannot hide it.
  const highlight = document.createElement('div');
  highlight.id = '__orchestra-grab-highlight';
  highlight.style.cssText = [
    'position:fixed',
    'z-index:999998',
    'pointer-events:none',
    'box-sizing:border-box',
    'border:2px solid #89b4fa',
    'border-radius:2px',
    'background:rgba(137,180,250,0.08)',
    'display:none',
    'transition:top 0.04s,left 0.04s,width 0.04s,height 0.04s',
  ].join(';');
  document.body.appendChild(highlight);

  const label = document.createElement('div');
  label.id = '__orchestra-grab-label';
  label.style.cssText = 'position:fixed;z-index:999999;background:#1e1e2e;color:#cdd6f4;font-size:11px;font-family:monospace;padding:2px 6px;border-radius:3px;pointer-events:none;display:none;white-space:nowrap;border:1px solid rgba(137,180,250,0.3);';
  document.body.appendChild(label);

  let lastTarget = null;

  function getSelector(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    let path = el.tagName.toLowerCase();
    if (el.className && typeof el.className === 'string') {
      const classes = el.className.trim().split(/\\s+/).filter(Boolean);
      if (classes.length) path += '.' + classes.map(c => CSS.escape(c)).join('.');
    }
    return path;
  }

  function getAccessibility(el) {
    return {
      role: el.getAttribute('role') || el.tagName.toLowerCase(),
      ariaLabel: el.getAttribute('aria-label') || '',
      accessibleName: el.textContent?.trim().slice(0, 100) || '',
    };
  }

  function getStyles(el) {
    const cs = getComputedStyle(el);
    const props = ['display','position','width','height','color','backgroundColor',
      'fontSize','fontFamily','fontWeight','padding','margin','border',
      'borderRadius','opacity','overflow','textAlign'];
    const result = {};
    props.forEach(p => { result[p] = cs[p]; });
    return result;
  }

  function positionHighlight(el) {
    const rect = el.getBoundingClientRect();
    highlight.style.display = 'block';
    highlight.style.top = rect.top + 'px';
    highlight.style.left = rect.left + 'px';
    highlight.style.width = rect.width + 'px';
    highlight.style.height = rect.height + 'px';
  }

  overlay.addEventListener('mousemove', function(e) {
    overlay.style.pointerEvents = 'none';
    const target = document.elementFromPoint(e.clientX, e.clientY);
    overlay.style.pointerEvents = 'auto';
    if (!target || target === overlay || target === highlight || target === label) return;

    lastTarget = target;
    positionHighlight(target);

    const rect = target.getBoundingClientRect();
    label.textContent = getSelector(target) + '  ' + Math.round(rect.width) + '\\u00d7' + Math.round(rect.height);
    label.style.display = 'block';
    const lx = Math.min(e.clientX + 14, window.innerWidth - label.offsetWidth - 8);
    const ly = Math.max(e.clientY - 28, 4);
    label.style.left = lx + 'px';
    label.style.top = ly + 'px';
  });

  overlay.addEventListener('mouseleave', function() {
    highlight.style.display = 'none';
    label.style.display = 'none';
  });

  overlay.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();

    overlay.style.pointerEvents = 'none';
    const target = document.elementFromPoint(e.clientX, e.clientY);
    overlay.style.pointerEvents = 'auto';

    if (!target || target === overlay || target === highlight || target === label) return;

    const rect = target.getBoundingClientRect();
    const REDACT = /access.token|api.key|password|secret|credential/i;

    function safeAttrs(el) {
      const attrs = {};
      for (const a of el.attributes) {
        if (!REDACT.test(a.name) && !REDACT.test(a.value)) {
          attrs[a.name] = a.value.slice(0, 200);
        }
      }
      return attrs;
    }

    const payload = {
      page: {
        url: location.href.replace(/[?&](access_token|api_key|token|secret|key)=[^&]*/gi, ''),
        title: document.title,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      },
      target: {
        tag: target.tagName.toLowerCase(),
        selector: getSelector(target),
        text: (target.textContent || '').trim().slice(0, 200),
        html: target.outerHTML.slice(0, 4096),
        attributes: safeAttrs(target),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      },
      accessibility: getAccessibility(target),
      styles: getStyles(target),
    };

    // Clean up
    overlay.remove();
    highlight.remove();
    label.remove();
    window.__orchestraGrabActive = false;

    // Send payload back via console message (webview captures this)
    console.log('__ORCHESTRA_GRAB__' + JSON.stringify(payload));
  });

  // Escape to cancel
  document.addEventListener('keydown', function handler(e) {
    if (e.key === 'Escape') {
      overlay.remove();
      highlight.remove();
      label.remove();
      window.__orchestraGrabActive = false;
      document.removeEventListener('keydown', handler);
    }
  });
})();
`

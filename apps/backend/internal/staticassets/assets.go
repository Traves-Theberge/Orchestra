package staticassets

const DashboardHTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Orchestra Backend Dashboard</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; margin: 1.5rem; background: #f7fafc; color: #1a202c; }
    h1 { margin: 0 0 0.5rem; }
    p { margin: 0.25rem 0; }
    code { background: #edf2f7; padding: 0.1rem 0.3rem; border-radius: 4px; }
    .grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); margin-top: 1rem; }
    .card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.8rem; }
    .label { color: #4a5568; font-size: 0.85rem; margin-bottom: 0.25rem; }
    .value { font-size: 1.3rem; font-weight: 600; }
    table { width: 100%; border-collapse: collapse; margin-top: 0.4rem; }
    th, td { text-align: left; border-top: 1px solid #edf2f7; padding: 0.35rem 0.25rem; font-size: 0.9rem; vertical-align: top; }
    th { color: #4a5568; font-weight: 600; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .muted { color: #718096; }
  </style>
</head>
<body>
  <h1>Orchestra Backend</h1>
  <p class="muted">Live orchestrator snapshot from <code>/api/v1/state</code> and stream updates from <code>/api/v1/events</code>.</p>

  <div class="grid">
    <section class="card">
      <div class="label">Running</div>
      <div id="runningCount" class="value">0</div>
    </section>
    <section class="card">
      <div class="label">Retrying</div>
      <div id="retryingCount" class="value">0</div>
    </section>
    <section class="card">
      <div class="label">Token Total</div>
      <div id="tokenTotal" class="value">0</div>
    </section>
    <section class="card">
      <div class="label">Rate Limits</div>
      <div id="rateLimits" class="mono muted">-</div>
    </section>
  </div>

  <div class="grid">
    <section class="card">
      <h2>Running Issues</h2>
      <table>
        <thead>
          <tr><th>Issue</th><th>State</th><th>Turn</th><th>Last Event</th></tr>
        </thead>
        <tbody id="runningRows"><tr><td class="muted" colspan="4">No running issues.</td></tr></tbody>
      </table>
    </section>

    <section class="card">
      <h2>Retry Queue</h2>
      <table>
        <thead>
          <tr><th>Issue</th><th>Attempt</th><th>Due</th><th>Error</th></tr>
        </thead>
        <tbody id="retryRows"><tr><td class="muted" colspan="4">No retry entries.</td></tr></tbody>
      </table>
    </section>
  </div>

  <script>
    function text(value) {
      if (value === null || value === undefined || value === "") {
        return "-";
      }
      return String(value);
    }

    function row(cells) {
      return "<tr>" + cells.map(function(cell) { return "<td>" + cell + "</td>"; }).join("") + "</tr>";
    }

    function render(snapshot) {
      var counts = snapshot && snapshot.counts ? snapshot.counts : {};
      var totals = snapshot && snapshot.codex_totals ? snapshot.codex_totals : {};
      var rateLimits = snapshot ? snapshot.rate_limits : null;
      var running = snapshot && Array.isArray(snapshot.running) ? snapshot.running : [];
      var retrying = snapshot && Array.isArray(snapshot.retrying) ? snapshot.retrying : [];

      document.getElementById("runningCount").textContent = text(counts.running || 0);
      document.getElementById("retryingCount").textContent = text(counts.retrying || 0);
      document.getElementById("tokenTotal").textContent = text(totals.total_tokens || 0);
      document.getElementById("rateLimits").textContent = rateLimits ? JSON.stringify(rateLimits) : "-";

      var runningRows = document.getElementById("runningRows");
      if (running.length === 0) {
        runningRows.innerHTML = '<tr><td class="muted" colspan="4">No running issues.</td></tr>';
      } else {
        runningRows.innerHTML = running.map(function(entry) {
          return row([
            '<span class="mono">' + text(entry.issue_identifier) + '</span>',
            text(entry.state),
            text(entry.turn_count),
            text(entry.last_event)
          ]);
        }).join("");
      }

      var retryRows = document.getElementById("retryRows");
      if (retrying.length === 0) {
        retryRows.innerHTML = '<tr><td class="muted" colspan="4">No retry entries.</td></tr>';
      } else {
        retryRows.innerHTML = retrying.map(function(entry) {
          return row([
            '<span class="mono">' + text(entry.issue_identifier) + '</span>',
            text(entry.attempt),
            text(entry.due_at),
            text(entry.error)
          ]);
        }).join("");
      }
    }

    function loadSnapshot() {
      return fetch('/api/v1/state', { headers: { 'Accept': 'application/json' } })
        .then(function(res) { return res.json(); })
        .then(function(payload) {
          if (payload && payload.data) {
            render(payload.data);
          }
        })
        .catch(function() {});
    }

    loadSnapshot();

    if (typeof EventSource !== 'undefined') {
      var source = new EventSource('/api/v1/events');
      function tryRenderEventData(raw) {
        if (!raw) {
          return;
        }
        if (raw.counts || raw.running || raw.retrying || raw.codex_totals || raw.rate_limits) {
          render(raw);
          return;
        }
        if (raw.data && (raw.data.counts || raw.data.running || raw.data.retrying || raw.data.codex_totals || raw.data.rate_limits)) {
          render(raw.data);
        }
      }

      function handleEventFrame(evt) {
        try {
          var parsed = JSON.parse(evt.data);
          tryRenderEventData(parsed);
        } catch (_) {}
      }

      source.onmessage = handleEventFrame;
      source.addEventListener('snapshot', handleEventFrame);
      source.onerror = function() {
        setTimeout(loadSnapshot, 1000);
      };
    } else {
      setInterval(loadSnapshot, 2000);
    }
  </script>
</body>
</html>
`

const NotFoundHTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Not Found</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; margin: 2rem; color: #1a202c; background: #f7fafc; }
    h1 { margin-bottom: 0.4rem; }
    p { margin: 0.2rem 0; }
    code { background: #edf2f7; padding: 0.1rem 0.3rem; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>404 Not Found</h1>
  <p>The requested route does not exist.</p>
  <p>Try <code>/</code> for the dashboard or <code>/api/v1/state</code> for JSON status.</p>
</body>
</html>
`

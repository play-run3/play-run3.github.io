(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const els = {
    input:$('urlInput'), file:$('fileInput'), heroFile:$('heroFileInput'), count:$('urlCountLabel'), ready:$('readyText'),
    check:$('checkBtn'), clear:$('clearBtn'), concurrency:$('concurrency'), progress:$('progressBar'), percent:$('progressPercent'),
    progressLabel:$('progressLabel'), summary:$('summaryChips'), total:$('chipTotal'), ok:$('chipOk'), redir:$('chipRedir'),
    err:$('chipErr'), done:$('chipDone'), tableWrap:$('tableWrap'), download:$('downloadBtn'), search:$('resultSearch'),
    resultCount:$('resultCount'), rowsInfo:$('rowsInfo'), toast:$('toast'), confetti:$('confetti'), theme:$('themeBtn'),
    how:$('howBtn'), userAgent:$('userAgent'), method:$('method'), follow:$('follow'), timeout:$('timeout')
  };

  const state = { results: [], filter:'all', running:false, controller:null };
  const MAX_URLS = 10000;
  const SERVER_BATCH_SIZE = 2000;
  const parseUrls = text => String(text || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const statusClass = code => {
    const c = String(code ?? '');
    return c.startsWith('2') ? 's2' : c.startsWith('3') ? 's3' : c.startsWith('4') ? 's4' : c.startsWith('5') ? 's5' : 'err';
  };

  function updateCount() {
    const n = parseUrls(els.input.value).length;
    els.count.textContent = `${n.toLocaleString()} / ${MAX_URLS.toLocaleString()}`;
    els.ready.textContent = n ? `${n} URL${n === 1 ? '' : 's'} ready` : 'One URL per line';
    els.count.classList.toggle('over', n > MAX_URLS);
    els.check.disabled = state.running || n === 0 || n > MAX_URLS;
  }

  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => els.toast.classList.remove('show'), 2600);
  }

  function resetResults(message = 'Paste URLs above and hit Check Status.') {
    state.results = [];
    els.tableWrap.innerHTML = `<div class="empty-state"><div class="empty-icon">⚡</div><strong style="color:#fff">Nothing checked yet</strong><div style="margin-top:6px">${escapeHtml(message)}</div></div>`;
    els.progress.style.width = '0%';
    els.percent.textContent = '0%';
    els.done.textContent = '0%';
    els.progressLabel.textContent = 'Ready when you are.';
    els.summary.style.display = 'none';
    els.resultCount.textContent = '0';
    els.rowsInfo.textContent = '0–0 of 0';
    els.download.disabled = true;
  }

  function ensureTable() {
    if ($('resultsTable')) return;
    els.tableWrap.innerHTML = `<table id="resultsTable"><thead><tr><th>#</th><th>URL</th><th>Status</th><th>Final URL</th><th>Redirects</th><th>Time</th><th>Content-Type</th><th>Error</th></tr></thead><tbody id="resultsBody"></tbody></table>`;
  }

  function renderRows() {
    ensureTable();
    const body = $('resultsBody');
    body.innerHTML = '';
    [...state.results].sort((a,b) => Number(a.index) - Number(b.index)).forEach(r => {
      const tr = document.createElement('tr');
      tr.dataset.index = String(r.index);
      const cls = r.error ? 'err' : statusClass(r.statusCode);
      const badge = r.error ? '<span class="status-badge err">ERR</span>' : `<span class="status-badge ${cls}">${escapeHtml(r.statusCode)}</span>`;
      tr.innerHTML = `<td class="muted">${Number(r.index)+1}</td><td title="${escapeHtml(r.originalUrl)}">${escapeHtml(r.originalUrl)}</td><td>${badge}</td><td class="muted">${escapeHtml(r.finalUrl || '—')}</td><td class="muted">${Number(r.redirectCount)||0}</td><td class="muted">${r.responseTimeMs ? escapeHtml(r.responseTimeMs)+' ms' : '—'}</td><td class="muted">${escapeHtml((r.contentType||'').split(';')[0] || '—')}</td><td style="color:var(--red)">${escapeHtml(r.error || '')}</td>`;
      body.appendChild(tr);
    });
  }

  function refreshRows() {
    const body = $('resultsBody');
    if (!body) return;
    const q = els.search.value.trim().toLowerCase();
    let visible = 0;
    for (const tr of body.rows) {
      const r = state.results.find(x => String(x.index) === tr.dataset.index);
      if (!r) continue;
      const code = String(r.statusCode ?? '');
      const filterMatch = state.filter === 'all' ? true : state.filter === 'err' ? Boolean(r.error) : code.startsWith(state.filter);
      const searchMatch = !q || String(r.originalUrl || '').toLowerCase().includes(q) || String(r.finalUrl || '').toLowerCase().includes(q);
      const show = filterMatch && searchMatch;
      tr.hidden = !show;
      if (show) visible++;
    }
    els.resultCount.textContent = String(visible);
    els.rowsInfo.textContent = visible ? `1–${visible} of ${visible}` : '0–0 of 0';
  }

  function updateSummary() {
    const total = state.results.length;
    const ok = state.results.filter(r => String(r.statusCode).startsWith('2')).length;
    const redir = state.results.filter(r => String(r.statusCode).startsWith('3')).length;
    els.total.textContent = total;
    els.ok.textContent = ok;
    els.redir.textContent = redir;
    els.err.textContent = total - ok - redir;
    els.summary.style.display = 'grid';
  }

  function handleResult(result) {
    state.results.push(result);
    renderRows();
    updateSummary();
    const total = Number(result.total) || state.results.length;
    const pct = Math.min(100, Math.round(state.results.length / total * 100));
    els.progress.style.width = `${pct}%`;
    els.percent.textContent = `${pct}%`;
    els.done.textContent = `${pct}%`;
    els.progressLabel.textContent = `${state.results.length} / ${total} checked`;
    refreshRows();
  }

  async function checkUrls() {
    if (state.running) return;
    const urls = parseUrls(els.input.value);
    if (!urls.length) return toast('Add at least one URL first.');
    if (urls.length > MAX_URLS) return toast(`Maximum ${MAX_URLS.toLocaleString()} URLs per check.`);

    state.running = true;
    state.controller = new AbortController();
    resetResults('Checking — results will appear live…');
    els.check.disabled = true;
    els.clear.disabled = true;
    els.check.textContent = 'Checking…';

    try {
      let completed = 0;
      const totalInput = urls.length;

      for (let batchStart = 0; batchStart < totalInput; batchStart += SERVER_BATCH_SIZE) {
        if (state.controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const batch = urls.slice(batchStart, batchStart + SERVER_BATCH_SIZE);
        els.progressLabel.textContent = `Batch ${Math.floor(batchStart / SERVER_BATCH_SIZE) + 1} — checking ${batch.length.toLocaleString()} URLs`;

        const response = await fetch('/api/check', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({
            urls: batch,
            concurrency: Math.min(Number(els.concurrency.value) || 25, batch.length),
            userAgent: els.userAgent.value,
            method: els.method.value,
            followRedirects: els.follow.value === 'yes',
            timeoutMs: Math.min(Math.max(Number(els.timeout.value) || 20, 1), 30) * 1000
          }),
          signal: state.controller.signal
        });

        if (!response.ok || !response.body) {
          let message = `Server error (${response.status})`;
          try { const data = await response.json(); if (data?.error) message = data.error; } catch {}
          throw new Error(message);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const {done, value} = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, {stream:true});
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) if (line.trim()) {
            try {
              const result = JSON.parse(line);
              // Convert each batch's local index into the global input index.
              result.index = batchStart + Number(result.index);
              result.total = totalInput;
              handleResult(result);
              completed++;
              const pct = Math.min(100, Math.round(completed / totalInput * 100));
              els.progress.style.width = `${pct}%`;
              els.percent.textContent = `${pct}%`;
              els.done.textContent = `${pct}%`;
            } catch { console.warn('Invalid server result:', line); }
          }
        }
        if (buffer.trim()) {
          try {
            const result = JSON.parse(buffer);
            result.index = batchStart + Number(result.index);
            result.total = totalInput;
            handleResult(result);
            completed++;
          } catch {}
        }
      }

      els.progress.style.width = '100%';
      els.percent.textContent = '100%';
      els.done.textContent = '100%';
      els.progressLabel.textContent = `Done — ${state.results.length.toLocaleString()} URLs checked`;
      els.download.disabled = !state.results.length;
      toast(`⚡ Pulse complete — ${state.results.length.toLocaleString()} URLs checked`);
      if (state.results.length) confetti();
    } catch (err) {
      if (err.name === 'AbortError') toast('Check cancelled.');
      else { console.error(err); toast(err.message || 'Something went wrong.'); }
    } finally {
      state.running = false;
      state.controller = null;
      els.clear.disabled = false;
      els.check.textContent = '⚡ Check Status';
      updateCount();
    }
  }

  async function exportXlsx() {
    if (!state.results.length) return;
    els.download.disabled = true;
    try {
      if (!window.XLSX) {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
        await new Promise((resolve, reject) => { script.onload = resolve; script.onerror = reject; document.head.appendChild(script); });
      }
      const rows = [...state.results].sort((a,b)=>Number(a.index)-Number(b.index)).map(r => ({
        '#': Number(r.index)+1, URL:r.originalUrl, 'Status Code':r.statusCode, 'Final URL':r.finalUrl,
        Redirects:r.redirectCount, 'Redirect Chain':r.redirectChain, 'Response Time (ms)':r.responseTimeMs,
        'Content Type':r.contentType, Server:r.server, 'Content Length':r.contentLength, Error:r.error
      }));
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, 'URL Results');
      XLSX.writeFile(wb, `pulse-url-results-${new Date().toISOString().slice(0,10)}.xlsx`);
      toast('Excel export downloaded.');
    } catch (error) { console.error(error); toast('Export failed.'); }
    finally { els.download.disabled = false; }
  }

  function confetti() {
    const canvas = els.confetti, ctx = canvas.getContext('2d');
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr; ctx.scale(dpr,dpr);
    const colors = ['#ff3f9f','#22d3ee','#8b5cf6','#a3e635','#fb923c'];
    const pieces = Array.from({length:150}, (_,i) => ({x:innerWidth/2+(Math.random()-.5)*180,y:innerHeight*.35+(Math.random()-.5)*50,vx:(Math.random()-.5)*10,vy:-Math.random()*11-3,g:.28+Math.random()*.2,r:3+Math.random()*4,a:1,rot:Math.random()*6.28,vr:(Math.random()-.5)*.25,color:colors[i%colors.length]}));
    const start = performance.now();
    function frame(now) { ctx.clearRect(0,0,innerWidth,innerHeight); for(const p of pieces){p.x+=p.vx;p.vy+=p.g;p.y+=p.vy;p.rot+=p.vr;p.a-=.008;ctx.save();ctx.globalAlpha=Math.max(p.a,0);ctx.translate(p.x,p.y);ctx.rotate(p.rot);ctx.fillStyle=p.color;ctx.fillRect(-p.r,-p.r/2,p.r*2,p.r);ctx.restore();} if(now-start<3600) requestAnimationFrame(frame); else ctx.clearRect(0,0,innerWidth,innerHeight); }
    requestAnimationFrame(frame);
  }

  function bindFile(input) {
    input.addEventListener('change', () => {
      const file = input.files?.[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = e => { els.input.value = e.target.result; updateCount(); els.ready.textContent = file.name; toast(`${parseUrls(els.input.value).length} URLs imported`); };
      reader.readAsText(file);
    });
  }

  els.input.addEventListener('input', updateCount);
  els.check.addEventListener('click', checkUrls);
  els.clear.addEventListener('click', () => { if(state.running && state.controller) state.controller.abort(); els.input.value=''; updateCount(); resetResults(); toast('Cleared. Ready for the next pulse.'); });
  els.download.addEventListener('click', exportXlsx);
  els.search.addEventListener('input', refreshRows);
  document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => { document.querySelectorAll('.filter').forEach(x=>x.classList.remove('active')); button.classList.add('active'); state.filter=button.dataset.filter; refreshRows(); }));
  bindFile(els.file); bindFile(els.heroFile);
  els.how.addEventListener('click', () => toast('Paste up to 10,000 URLs. Pulse automatically sends them to Render in 2,000-URL batches.'));
  els.theme.addEventListener('click', () => { document.body.classList.toggle('alt'); toast(document.body.classList.contains('alt') ? 'Alternate theme enabled.' : 'Pulse theme enabled.'); });
  updateCount();
})();

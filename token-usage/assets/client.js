'use strict';

function createTokenUsageClient(overrides = {}) {
  const environment = typeof globalThis === 'undefined' ? {} : globalThis;
  const document = overrides.document || environment.document;
  const fetchData = overrides.fetch || environment.fetch?.bind(environment);
  const ResizeObserverClass = overrides.ResizeObserver || environment.ResizeObserver;
  const MutationObserverClass = overrides.MutationObserver || environment.MutationObserver;
  const requestFrame = overrides.requestAnimationFrame || environment.requestAnimationFrame?.bind(environment);
  const cancelFrame = overrides.cancelAnimationFrame || environment.cancelAnimationFrame?.bind(environment);
  const getElementStyle = overrides.getComputedStyle || environment.getComputedStyle?.bind(environment);
  const schedule = overrides.setTimeout || environment.setTimeout?.bind(environment);
  const cancel = overrides.clearTimeout || environment.clearTimeout?.bind(environment);
  const enqueue = overrides.queueMicrotask || environment.queueMicrotask?.bind(environment) || (callback => Promise.resolve().then(callback));
  const addWindowEventListener = overrides.addWindowEventListener || environment.addEventListener?.bind(environment);
  const removeWindowEventListener = overrides.removeWindowEventListener || environment.removeEventListener?.bind(environment);
  const loadRenderer = overrides.loadRenderer || defaultLoadRenderer;

  let activeRoot = null;
  let renderer = null;
  let rendererMounted = false;
  let resizeObserver = null;
  let resizeTimer = null;
  let pendingInit = null;
  let generation = 0;
  let lifecycleBound = false;
  let lastSuccessfulUpdate = '';
  let terminalFocusIntent = false;
  let terminalPointerListener = null;
  let terminalResizeListener = null;
  let restoreFocusAfterResize = false;
  let terminalFocusTarget = null;
  let terminalFocusInListener = null;
  let terminalFocusOutListener = null;
  let terminalMountObserver = null;
  let terminalMountFrame = null;
  let terminalMountSequence = 0;
  let terminalInitialFocusCancelled = false;

  function query(root, selector) {
    return root?.querySelector(selector) || null;
  }

  function setText(root, selector, value) {
    const element = query(root, selector);
    if (element) element.textContent = value;
  }

  function setStatus(root, state, value) {
    const element = query(root, '[data-token-status]');
    if (!element) return;
    element.setAttribute('data-token-status', state);
    element.textContent = value;
  }

  function numberValue(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function validateUsagePayload(data) {
    if (!isRecord(data)) throw new Error('Usage payload is invalid: expected an object.');
    if (!isRecord(data.overview)) throw new Error('Usage payload is invalid: overview must be an object.');
    if (!Array.isArray(data.models)) throw new Error('Usage payload is invalid: models must be an array.');
    if (!Array.isArray(data.daily)) throw new Error('Usage payload is invalid: daily must be an array.');
    if (!data.models.every(isRecord)) throw new Error('Usage payload is invalid: model entries must be objects.');
    if (!data.daily.every(isRecord)) throw new Error('Usage payload is invalid: daily entries must be objects.');
    return data;
  }

  function sourceDetails(value) {
    const displayUrl = String(value || '').trim() || 'not configured';
    try {
      const baseUrl = document?.location?.href || 'https://token-usage.invalid/';
      const url = new URL(displayUrl, baseUrl);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return { displayUrl, href: url.href };
      }
    } catch (_error) {
      // Invalid configured URLs are shown as inert text in the error state.
    }
    return { displayUrl, href: null };
  }

  function formatInteger(value) {
    return Math.round(numberValue(value)).toLocaleString('en-US');
  }

  function formatCompact(value) {
    const number = numberValue(value);
    const units = [
      [1e12, 'T'],
      [1e9, 'B'],
      [1e6, 'M'],
      [1e3, 'K']
    ];
    const unit = units.find(([threshold]) => Math.abs(number) >= threshold);
    if (!unit) return formatInteger(number);
    const compact = (number / unit[0]).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
    return `${compact}${unit[1]}`;
  }

  function formatCost(value) {
    return `$${numberValue(value).toFixed(2)}`;
  }

  function formatLedgerTokens(value) {
    const number = numberValue(value);
    const exact = formatInteger(number);
    const accessibleValue = `${exact} tokens`;
    return {
      text: Math.abs(number) >= 1e6 ? formatCompact(number) : exact,
      attributes: {
        title: accessibleValue,
        'aria-label': accessibleValue
      }
    };
  }

  function formatPercent(value) {
    return `${(numberValue(value) * 100).toFixed(1)}%`;
  }

  function formatUpdate(value) {
    if (!value) return 'time unavailable';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  }

  function appendTextElement(parent, tagName, value, attributes = {}) {
    const element = document.createElement(tagName);
    Object.entries(attributes).forEach(([name, attributeValue]) => {
      element.setAttribute(name, attributeValue);
    });
    element.textContent = value;
    parent.append(element);
    return element;
  }

  function buildTable(container, heading, columns, rows, emptyText) {
    const title = appendTextElement(container, 'h2', heading);
    const table = document.createElement('table');
    table.setAttribute('aria-label', heading);
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    columns.forEach(column => appendTextElement(headRow, 'th', column, { scope: 'col' }));
    head.append(headRow);
    table.append(head);

    const body = document.createElement('tbody');
    if (rows.length === 0) {
      const row = document.createElement('tr');
      appendTextElement(row, 'td', emptyText, { colspan: String(columns.length) });
      body.append(row);
    } else {
      rows.forEach(values => {
        const row = document.createElement('tr');
        values.forEach(value => {
          const cell = isRecord(value) && Object.hasOwn(value, 'text')
            ? value
            : { text: value, attributes: {} };
          appendTextElement(row, 'td', cell.text, cell.attributes);
        });
        body.append(row);
      });
    }
    table.append(body);
    container.replaceChildren(title, table);
  }

  function populateSummaries(root, data) {
    const overview = data && typeof data.overview === 'object' ? data.overview : {};
    const models = Array.isArray(data?.models) ? data.models : [];
    const daily = Array.isArray(data?.daily) ? data.daily : [];
    const dailyModelNames = Array.isArray(data?.dailyModels?.models)
      ? data.dailyModels.models.map(value => String(value))
      : [];
    const totalTokens = numberValue(overview.totalTokens);
    const activeDays = numberValue(overview.activeDays);

    setText(root, '[data-token-kpi-total]', formatCompact(totalTokens));
    setText(root, '[data-token-kpi-cost]', formatCost(overview.totalCost));
    setText(root, '[data-token-kpi-days]', formatInteger(activeDays));

    const modelTotal = models.reduce((sum, model) => sum + numberValue(model.totalTokens), 0);
    const modelRows = models
      .slice()
      .sort((left, right) => numberValue(right.totalTokens) - numberValue(left.totalTokens))
      .slice(0, 8)
      .map(model => [
        String(model.model || 'Unknown model'),
        formatPercent(modelTotal ? numberValue(model.totalTokens) / modelTotal : 0),
        formatLedgerTokens(model.totalTokens),
        formatCost(model.totalCost)
      ]);
    const modelSummary = query(root, '[data-token-model-summary]');
    if (modelSummary) {
      buildTable(
        modelSummary,
        'Model share',
        ['Model', 'Share', 'Tokens', 'Cost'],
        modelRows,
        'No model usage data.'
      );
    }

    const dailyRows = daily.slice(0, 7).map(day => [
      String(day.date || 'Unknown date'),
      formatLedgerTokens(day.tokens),
      formatCost(day.cost)
    ]);
    const dailySummary = query(root, '[data-token-daily-summary]');
    if (dailySummary) {
      buildTable(
        dailySummary,
        'Recent days',
        ['Date', 'Tokens', 'Cost'],
        dailyRows,
        'No daily usage data.'
      );
    }

    const updatedAt = overview.lastUpdated || data?.generatedAt || '';
    lastSuccessfulUpdate = updatedAt || lastSuccessfulUpdate;
    setText(
      root,
      '[data-token-summary-status]',
      `${formatInteger(totalTokens)} total tokens across ${formatInteger(activeDays)} active days. Last updated ${formatUpdate(updatedAt)}.`
    );
    setText(
      root,
      '[data-token-daily-models]',
      `Daily model series: ${dailyModelNames.length ? dailyModelNames.join(', ') : 'unavailable'}.`
    );

    const accessibleBody = query(root, '[data-token-summary-body]');
    if (accessibleBody) {
      const rows = models.map(model => {
        const row = document.createElement('tr');
        [
          String(model.model || 'Unknown model'),
          formatInteger(model.inputTokens),
          formatInteger(model.outputTokens),
          formatInteger(model.reasoningTokens),
          formatInteger(model.totalTokens)
        ].forEach(value => appendTextElement(row, 'td', value));
        return row;
      });
      accessibleBody.replaceChildren(...rows);
    }

    setText(root, '[data-token-status]', `Updated ${formatUpdate(updatedAt)}`);
  }

  function errorMessage(error) {
    if (error instanceof Error && error.message) return error.message;
    return String(error || 'Unknown error');
  }

  function renderTerminalMessage(root, title, error, source, readyState) {
    const state = query(root, '[data-token-terminal-state]');
    const window = query(root, '[data-token-window]');
    if (!state) return;

    const titleElement = appendTextElement(document.createElement('p'), 'strong', title);
    const titleLine = titleElement.parentNode;
    const detail = appendTextElement(document.createElement('p'), 'span', errorMessage(error));
    const detailLine = detail.parentNode;
    const updateLine = document.createElement('p');
    updateLine.textContent = lastSuccessfulUpdate
      ? `Last successful update: ${formatUpdate(lastSuccessfulUpdate)}`
      : 'Last successful update: unavailable';
    const retry = appendTextElement(document.createElement('p'), 'button', 'Retry', { type: 'button' });
    const retryLine = retry.parentNode;
    retry.addEventListener('click', () => initTokenUsagePage({ force: true }));
    const sourceLine = document.createElement('p');
    appendTextElement(sourceLine, 'span', 'Source: ');
    if (source.href) {
      appendTextElement(sourceLine, 'a', source.displayUrl, { href: source.href, rel: 'noopener' });
    } else {
      appendTextElement(sourceLine, 'span', source.displayUrl);
    }

    state.replaceChildren(titleLine, detailLine, updateLine, retryLine, sourceLine);
    state.hidden = false;
    window?.classList.add('is-unavailable');
    root.dataset.ready = readyState;
  }

  function showLoading(root) {
    setStatus(root, 'loading', 'Loading usage data...');
    const state = query(root, '[data-token-terminal-state]');
    if (state) {
      state.textContent = 'Loading usage data...';
      state.hidden = false;
    }
    query(root, '[data-token-window]')?.classList.remove('is-unavailable');
  }

  function rendererUrls(root) {
    let assetBase = String(root.dataset.assetBase || '').replace(/\/+$/, '');
    if (!assetBase) {
      const pathname = String(document?.location?.pathname || '/');
      assetBase = `${pathname.replace(/\/?$/, '/')}assets`;
    }
    return [
      `${assetBase}/tokscale_renderer.js`,
      `${assetBase}/tokscale_renderer_bg.wasm`
    ];
  }

  function configureTerminalGrid(root) {
    const terminal = query(root, '[data-token-terminal]');
    const grid = terminal?.children?.[0] || null;
    if (!grid) return null;
    grid.setAttribute('tabindex', '0');
    grid.setAttribute('aria-label', 'Interactive token usage terminal');
    grid.setAttribute('aria-describedby', 'token-window-hint');
    return grid;
  }

  function focusInitialTerminalGrid(root, run, entryFocus) {
    const gridIsVisible = grid => {
      const style = getElementStyle?.(grid);
      return !style || (style.visibility !== 'hidden' && style.display !== 'none');
    };
    const focusGrid = () => {
      if (!isCurrent(root, run)) return false;
      const terminal = query(root, '[data-token-terminal]');
      const activeElement = document?.activeElement;
      const focusMovedOutside = activeElement &&
        activeElement !== document?.body &&
        activeElement !== entryFocus &&
        !terminal?.contains?.(activeElement);
      if (terminalInitialFocusCancelled || focusMovedOutside) {
        terminalMountObserver?.disconnect();
        terminalMountObserver = null;
        return true;
      }
      const grid = configureTerminalGrid(root);
      if (!grid?.focus || !gridIsVisible(grid)) return false;
      grid.focus({ preventScroll: true });
      terminalMountObserver?.disconnect();
      terminalMountObserver = null;
      return true;
    };

    const focusStableGrid = () => {
      if (!requestFrame) {
        focusGrid();
        return;
      }
      terminalMountSequence += 1;
      const sequence = terminalMountSequence;
      if (terminalMountFrame !== null && cancelFrame) cancelFrame(terminalMountFrame);
      const focusOnVisibleFrame = () => {
        terminalMountFrame = requestFrame(() => {
          if (sequence !== terminalMountSequence) return;
          const grid = configureTerminalGrid(root);
          if (!grid) {
            terminalMountFrame = null;
            return;
          }
          if (!gridIsVisible(grid)) {
            focusOnVisibleFrame();
            return;
          }
          terminalMountFrame = null;
          focusGrid();
        });
      };
      terminalMountFrame = requestFrame(() => {
        if (sequence !== terminalMountSequence) return;
        focusOnVisibleFrame();
      });
    };

    if (focusGrid()) return;
    const terminal = query(root, '[data-token-terminal]');
    if (!terminal) return;
    if (MutationObserverClass) {
      terminalMountObserver?.disconnect();
      terminalMountObserver = new MutationObserverClass(focusStableGrid);
      terminalMountObserver.observe(terminal, { childList: true });
    }
    if (configureTerminalGrid(root)) focusStableGrid();
  }

  function installTerminalFocusTracking(root) {
    if (!document?.addEventListener) return;
    const terminal = query(root, '[data-token-terminal]');
    terminalInitialFocusCancelled = false;
    if (terminalFocusTarget && terminalFocusInListener && terminalFocusOutListener) {
      terminalFocusTarget.removeEventListener('focusin', terminalFocusInListener);
      terminalFocusTarget.removeEventListener('focusout', terminalFocusOutListener);
    }
    terminalFocusTarget = terminal;
    terminalFocusInListener = () => {
      terminalFocusIntent = true;
    };
    terminalFocusOutListener = event => {
      if (event.relatedTarget && event.relatedTarget !== document?.body) {
        const remainsInside = terminal?.contains?.(event.relatedTarget) === true;
        terminalFocusIntent = remainsInside;
        if (!remainsInside) restoreFocusAfterResize = false;
      }
    };
    terminal?.addEventListener?.('focusin', terminalFocusInListener);
    terminal?.addEventListener?.('focusout', terminalFocusOutListener);
    if (terminalPointerListener) {
      document.removeEventListener('pointerdown', terminalPointerListener, true);
    }
    terminalPointerListener = event => {
      const terminal = query(root, '[data-token-terminal]');
      if (!terminal?.contains?.(event.target)) {
        terminalInitialFocusCancelled = true;
        terminalFocusIntent = false;
        restoreFocusAfterResize = false;
      }
    };
    document.addEventListener('pointerdown', terminalPointerListener, true);
    if (addWindowEventListener) {
      if (terminalResizeListener && removeWindowEventListener) {
        removeWindowEventListener('resize', terminalResizeListener, true);
      }
      terminalResizeListener = () => {
        const terminal = query(root, '[data-token-terminal]');
        restoreFocusAfterResize = restoreFocusAfterResize || Boolean(
          terminal && document?.activeElement && terminal.contains?.(document.activeElement)
        );
      };
      addWindowEventListener('resize', terminalResizeListener, true);
    }
  }

  function isCurrent(root, run) {
    return activeRoot === root && generation === run;
  }

  function clearRenderer() {
    if (resizeTimer !== null && cancel) cancel(resizeTimer);
    resizeTimer = null;
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (renderer && rendererMounted) {
      try {
        renderer.destroy('tokscale-terminal');
      } catch (_error) {
        // Route cleanup must continue even when a renderer teardown fails.
      }
    }
    renderer = null;
    rendererMounted = false;
    terminalFocusIntent = false;
    restoreFocusAfterResize = false;
    if (terminalPointerListener && document?.removeEventListener) {
      document.removeEventListener('pointerdown', terminalPointerListener, true);
    }
    terminalPointerListener = null;
    if (terminalResizeListener && removeWindowEventListener) {
      removeWindowEventListener('resize', terminalResizeListener, true);
    }
    terminalResizeListener = null;
    if (terminalFocusTarget && terminalFocusInListener && terminalFocusOutListener) {
      terminalFocusTarget.removeEventListener('focusin', terminalFocusInListener);
      terminalFocusTarget.removeEventListener('focusout', terminalFocusOutListener);
    }
    terminalFocusTarget = null;
    terminalFocusInListener = null;
    terminalFocusOutListener = null;
    terminalMountObserver?.disconnect();
    terminalMountObserver = null;
    terminalInitialFocusCancelled = false;
    terminalMountSequence += 1;
    if (terminalMountFrame !== null && cancelFrame) cancelFrame(terminalMountFrame);
    terminalMountFrame = null;
  }

  function installResizeObserver(root, run) {
    if (!ResizeObserverClass || !schedule) return;
    const target = query(root, '.token-window-screen') || query(root, '[data-token-terminal]');
    if (!target) return;
    resizeObserver = new ResizeObserverClass(() => {
      if (resizeTimer !== null && cancel) cancel(resizeTimer);
      resizeTimer = schedule(() => {
        resizeTimer = null;
        if (!isCurrent(root, run) || !renderer || !rendererMounted) return;
        const terminal = query(root, '[data-token-terminal]');
        const restoreFocus = restoreFocusAfterResize || terminalFocusIntent || Boolean(
          terminal && document?.activeElement && terminal.contains?.(document.activeElement)
        );
        renderer.redraw('tokscale-terminal');
        const grid = configureTerminalGrid(root);
        if (restoreFocus && grid?.focus) grid.focus({ preventScroll: true });
        restoreFocusAfterResize = false;
      }, 120);
    });
    resizeObserver.observe(target);
  }

  async function runInitialization(root, run, entryFocus) {
    const source = sourceDetails(root.dataset.dataUrl);
    if (!source.href) {
      if (!isCurrent(root, run)) return false;
      setStatus(root, 'error', 'Usage data unavailable');
      renderTerminalMessage(
        root,
        'Unable to load usage data.',
        new Error('Invalid token usage data URL. Only http: and https: URLs are allowed.'),
        source,
        'error'
      );
      return false;
    }

    let data;
    try {
      if (!fetchData) throw new Error('Fetch is unavailable in this browser.');
      const response = await fetchData(source.href, { cache: 'no-store' });
      if (!response?.ok) {
        throw new Error(`Usage request failed (${response?.status || 'network error'}).`);
      }
      data = validateUsagePayload(await response.json());
    } catch (error) {
      if (!isCurrent(root, run)) return false;
      setStatus(root, 'error', 'Usage data unavailable');
      renderTerminalMessage(root, 'Unable to load usage data.', error, source, 'error');
      return false;
    }

    if (!isCurrent(root, run)) return false;
    populateSummaries(root, data);

    let loadedRenderer = null;
    try {
      const [scriptUrl, wasmUrl] = rendererUrls(root);
      loadedRenderer = await loadRenderer(scriptUrl, wasmUrl);
      if (!isCurrent(root, run)) return false;
      installTerminalFocusTracking(root);
      loadedRenderer.mount('tokscale-terminal', JSON.stringify(data));
      configureTerminalGrid(root);
      if (!isCurrent(root, run)) {
        loadedRenderer.destroy('tokscale-terminal');
        return false;
      }
      renderer = loadedRenderer;
      rendererMounted = true;
      const terminalState = query(root, '[data-token-terminal-state]');
      if (terminalState) terminalState.hidden = true;
      query(root, '[data-token-window]')?.classList.remove('is-unavailable');
      root.dataset.ready = 'true';
      setStatus(root, 'ready', `Updated ${formatUpdate(lastSuccessfulUpdate)}`);
      focusInitialTerminalGrid(root, run, entryFocus);
      installResizeObserver(root, run);
      return true;
    } catch (error) {
      if (!isCurrent(root, run)) return false;
      if (loadedRenderer) {
        try {
          loadedRenderer.destroy('tokscale-terminal');
        } catch (_destroyError) {
          // The HTML fallback remains usable even if partial cleanup fails.
        }
      }
      clearRenderer();
      setStatus(root, 'fallback', `Updated ${formatUpdate(lastSuccessfulUpdate)}; terminal unavailable`);
      renderTerminalMessage(root, 'Interactive terminal unavailable.', error, source, 'fallback');
      return false;
    }
  }

  function initTokenUsagePage(options = {}) {
    if (!document) return Promise.resolve(false);
    const root = document.querySelector('[data-token-usage-root]');
    if (!root) {
      if (activeRoot) destroyTokenUsagePage();
      return Promise.resolve(false);
    }

    if (!options.force && root.dataset.ready) {
      return pendingInit || Promise.resolve(root.dataset.ready === 'true');
    }

    if (activeRoot) destroyTokenUsagePage();
    activeRoot = root;
    document.body?.classList.add('token-usage-route');
    root.dataset.ready = 'loading';
    showLoading(root);
    const run = ++generation;
    const entryFocus = document.activeElement;
    const operation = runInitialization(root, run, entryFocus);
    pendingInit = operation.finally(() => {
      if (isCurrent(root, run)) pendingInit = null;
    });
    return pendingInit;
  }

  function destroyTokenUsagePage() {
    generation += 1;
    clearRenderer();
    if (activeRoot) delete activeRoot.dataset.ready;
    activeRoot = null;
    pendingInit = null;
    document?.body?.classList.remove('token-usage-route');
  }

  function bindLifecycle() {
    if (!document || lifecycleBound) return;
    lifecycleBound = true;
    const initialize = () => initTokenUsagePage();
    document.addEventListener('DOMContentLoaded', initialize);
    document.addEventListener('pjax:success', initialize);
    document.addEventListener('pjax:send', destroyTokenUsagePage);
    if (document.readyState !== 'loading') enqueue(initialize);
  }

  return {
    bindLifecycle,
    destroyTokenUsagePage,
    initTokenUsagePage
  };
}

async function defaultLoadRenderer(scriptUrl, wasmUrl) {
  const module = await import(scriptUrl);
  if (typeof module.default !== 'function') {
    throw new Error('Renderer initializer is unavailable.');
  }
  await module.default(wasmUrl);
  if (typeof module.mount !== 'function' || typeof module.redraw !== 'function' || typeof module.destroy !== 'function') {
    throw new Error('Renderer exports are incomplete.');
  }
  return module;
}

const exported = { createTokenUsageClient, defaultLoadRenderer };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = exported;
}

if (typeof window !== 'undefined' && window.document) {
  const globalKey = '__tokscaleTokenUsageClient';
  const isNewClient = !window[globalKey];
  const client = window[globalKey] || createTokenUsageClient();
  window[globalKey] = client;
  window.initTokenUsagePage = client.initTokenUsagePage;
  window.destroyTokenUsagePage = client.destroyTokenUsagePage;
  if (isNewClient) client.bindLifecycle();
  else client.initTokenUsagePage();
}

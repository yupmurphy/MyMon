/* MyMon — small shared UI helpers: money formatting, escaping, toasts and the
   hover tooltip used by the two charts. */
window.MyMon = window.MyMon || {};

(function (NS) {
  'use strict';

  /* ---------- money ----------
     An amount is stored as a plain number. The currency is only how that
     number is written down, which is why switching it relabels what is
     already saved and never converts it. */

  var CURRENCIES = [
    { code: 'USD', label: 'US dollar' },
    { code: 'EUR', label: 'Euro' },
    { code: 'MDL', label: 'Moldovan leu' },
    { code: 'RON', label: 'Romanian leu' },
    { code: 'GBP', label: 'British pound' },
    { code: 'UAH', label: 'Ukrainian hryvnia' }
  ];

  var DEFAULT_CURRENCY = 'USD';

  /* Which currency *new* expenses are recorded in. Old ones keep their own,
     which is why almost everything below takes a currency argument. */
  var code = DEFAULT_CURRENCY;

  function isKnownCurrency(value) {
    for (var i = 0; i < CURRENCIES.length; i++) {
      if (CURRENCIES[i].code === value) return true;
    }
    return false;
  }

  /* Anything unknown, empty or missing reads as the dollar the app shipped
     with, so a bad stored value can never leave an amount unreadable. */
  function cleanCurrency(value) {
    var wanted = String(value || '').trim().toUpperCase();
    return isKnownCurrency(wanted) ? wanted : DEFAULT_CURRENCY;
  }

  /* One formatter per currency and precision, built on first use and kept —
     they are not cheap to make, and a mixed month asks for several. */
  var formatters = {};

  function formatter(which, decimals) {
    var key = which + ':' + decimals;
    if (!formatters[key]) {
      formatters[key] = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: which,
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      });
    }
    return formatters[key];
  }

  /* Rather than keep a table of symbols, ask the formatter what it uses — it
     already knows, and it stays right for currencies added later. */
  function currencySymbol(which) {
    var target = cleanCurrency(which || code);
    var parts = formatter(target, 2).formatToParts(0);
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].type === 'currency') return parts[i].value;
    }
    return target;
  }

  /* Sets the currency new expenses are recorded in. */
  function setCurrency(value) {
    code = cleanCurrency(value);
    showSymbol(code);
    return code;
  }

  /* The sign in front of the amount field. The add dialog shows the current
     choice; the edit dialog shows whatever that expense was logged in. */
  function showSymbol(which) {
    var sign = currencySymbol(which);
    var slots = document.querySelectorAll('[data-currency-symbol]');
    Array.prototype.forEach.call(slots, function (slot) {
      slot.textContent = sign;
    });
  }

  /* $1,284.50 — in `which`, or in the current choice when left out */
  function money(value, which) {
    return formatter(cleanCurrency(which || code), 2).format(Number(value) || 0);
  }

  /* $1,285 — for headline figures where cents are noise */
  function moneyShort(value, which) {
    var n = Number(value) || 0;
    var target = cleanCurrency(which || code);
    return Math.round(n) === n
      ? formatter(target, 0).format(n)
      : formatter(target, 2).format(n);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /* ---------- toasts ---------- */

  function toastStack() {
    var stack = document.querySelector('.toast-stack');
    if (!stack) {
      stack = el('div', 'toast-stack');
      stack.setAttribute('role', 'status');
      stack.setAttribute('aria-live', 'polite');
      document.body.appendChild(stack);
    }
    return stack;
  }

  /* toast('Expense added')  ·  toast('Deleted', { action: 'Undo', onAction: fn }) */
  function toast(message, options) {
    options = options || {};
    var node = el('div', 'toast');
    node.appendChild(el('span', null, message));

    var timer;
    function dismiss() {
      window.clearTimeout(timer);
      if (node.parentNode) node.parentNode.removeChild(node);
    }

    if (options.action) {
      var button = el('button', null, options.action);
      button.type = 'button';
      button.addEventListener('click', function () {
        dismiss();
        if (options.onAction) options.onAction();
      });
      node.appendChild(button);
    }

    toastStack().appendChild(node);
    timer = window.setTimeout(dismiss, options.duration || 5000);
    return dismiss;
  }

  /* ---------- chart tooltip ----------
     Every mark that carries colour also carries a readable label on hover, so
     the categories never rely on colour alone. */

  var tip = null;

  function showTip(target, text) {
    if (!tip) {
      tip = el('div', 'viz-tip');
      document.body.appendChild(tip);
    }
    tip.textContent = text;
    tip.dataset.show = '1';
    var box = target.getBoundingClientRect();
    var width = tip.offsetWidth;
    var left = Math.min(
      Math.max(box.left + box.width / 2 - width / 2, 8),
      window.innerWidth - width - 8
    );
    tip.style.transform = 'translate(' + Math.round(left) + 'px, ' +
      Math.round(box.top - tip.offsetHeight - 8) + 'px)';
  }

  function hideTip() {
    if (tip) tip.dataset.show = '0';
  }

  /* Adds hover + keyboard-focus tooltips to any element carrying data-tip. */
  function bindTips(root) {
    var marks = root.querySelectorAll('[data-tip]');
    Array.prototype.forEach.call(marks, function (mark) {
      mark.addEventListener('mouseenter', function () { showTip(mark, mark.dataset.tip); });
      mark.addEventListener('focus', function () { showTip(mark, mark.dataset.tip); });
      mark.addEventListener('mouseleave', hideTip);
      mark.addEventListener('blur', hideTip);
    });
  }

  /* ---------- header ---------- */

  /* Marks the current page in the nav and fills in the signed-in user's chip. */
  /* ---------- light and dark ----------------------------------------------

     Three states, not two. Until somebody presses the button there is no
     choice stored and the page simply follows whatever the phone or the
     laptop is set to — the stylesheet does that part on its own, with a media
     query. Pressing the button writes a choice down, and from then on it is
     that choice, on this device, until it is pressed again.

     A matching line sits inline in every page's <head>. It has to: this file
     loads at the end of the body, and a page that reached the screen before
     the choice was read would show a white flash on its way to dark. */

  var THEME_KEY = 'mymon.theme';

  function systemWantsDark() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  /* localStorage throws rather than returning null in a private window with
     site data blocked, so every touch of it is wrapped. */
  function storedTheme() {
    try {
      var saved = window.localStorage.getItem(THEME_KEY);
      return saved === 'dark' || saved === 'light' ? saved : null;
    } catch (err) {
      return null;
    }
  }

  function currentTheme() {
    return storedTheme() || (systemWantsDark() ? 'dark' : 'light');
  }

  function setTheme(name) {
    document.documentElement.setAttribute('data-theme', name);
    try {
      window.localStorage.setItem(THEME_KEY, name);
    } catch (err) { /* nothing to remember it with; the page still changes */ }
    paintThemeButtons(name);
  }

  function toggleTheme() {
    setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  }

  /* The button shows where it will take you, not where you are: a moon to go
     dark, a sun to come back. The label says it in words, because an icon on
     its own is a guess. */
  function paintThemeButtons(theme) {
    var dark = theme === 'dark';
    var said = dark ? 'Switch to the light theme' : 'Switch to the dark theme';

    var buttons = document.querySelectorAll('[data-theme-toggle]');
    Array.prototype.forEach.call(buttons, function (button) {
      button.dataset.themeState = dark ? 'dark' : 'light';
      button.setAttribute('aria-label', said);
      button.setAttribute('title', said);
    });

    /* What colours the browser's own bar around the page on a phone. A green
       strip over a dark page looks like a bug. */
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#101613' : '#3d8a45');
  }

  function startTheme() {
    paintThemeButtons(currentTheme());

    var buttons = document.querySelectorAll('[data-theme-toggle]');
    Array.prototype.forEach.call(buttons, function (button) {
      button.addEventListener('click', toggleTheme);
    });

    /* Somebody who has never pressed the button is following the system, so
       the page keeps up when the system changes under it. Once they have
       chosen, their choice stands and this does nothing. */
    if (window.matchMedia) {
      var dark = window.matchMedia('(prefers-color-scheme: dark)');
      var follow = function () {
        if (!storedTheme()) paintThemeButtons(systemWantsDark() ? 'dark' : 'light');
      };
      if (dark.addEventListener) dark.addEventListener('change', follow);
      else if (dark.addListener) dark.addListener(follow);
    }
  }

  function mountHeader(options) {
    options = options || {};
    var page = options.page;

    /* The footer carries Home and About now, so it marks the current page
       the same way the header does. */
    var links = document.querySelectorAll('.site-nav a[data-page], .site-footer a[data-page]');
    Array.prototype.forEach.call(links, function (link) {
      if (link.dataset.page === page) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });

    var user = NS.session.get();

    /* The name can appear outside the chip too — the landing page greets you
       with it — so every marked slot gets filled, wherever it sits. */
    if (user) {
      var slots = document.querySelectorAll('[data-user-name]');
      Array.prototype.forEach.call(slots, function (slot) {
        slot.textContent = user.name;
      });
    }

    var signedIn = document.querySelectorAll('[data-when="signed-in"]');
    Array.prototype.forEach.call(signedIn, function (node) {
      node.classList.toggle('hidden', !user);
    });

    var signedOut = document.querySelectorAll('[data-when="signed-out"]');
    Array.prototype.forEach.call(signedOut, function (node) {
      node.classList.toggle('hidden', !!user);
    });
  }

  function year() {
    var nodes = document.querySelectorAll('[data-year]');
    Array.prototype.forEach.call(nodes, function (node) {
      node.textContent = new Date().getFullYear();
    });
  }

  /* Registering the worker is what makes the browser offer "install" and what
     keeps MyMon opening on a bad connection. It is harmless where it is not
     supported, and skipped entirely for a page opened off the file system. */
  function registerWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (window.location.protocol.indexOf('http') !== 0) return;

    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {
        /* No worker simply means no offline start; the app is fine without. */
      });
    });
  }

  registerWorker();

  /* The theme does not wait for the account: it is a property of this device,
     the button is in the header of every page including the ones you can read
     signed out, and this file is loaded at the end of the body, so the markup
     it wires up is already there. */
  startTheme();

  /* Every page loads this file after session.js and renders only once the
     session has settled, so the chosen currency is in place before the first
     amount is written. A sign-in or a change in Settings re-runs it. */
  if (NS.session) {
    NS.session.ready.then(function (user) { setCurrency(user && user.currency); });
    NS.session.onChange(function (user) { setCurrency(user && user.currency); });
  }

  NS.ui = {
    money: money,
    moneyShort: moneyShort,
    currencies: CURRENCIES,
    currencyCode: function () { return code; },
    currencySymbol: currencySymbol,
    cleanCurrency: cleanCurrency,
    setCurrency: setCurrency,
    showSymbol: showSymbol,
    escapeHtml: escapeHtml,
    el: el,
    toast: toast,
    bindTips: bindTips,
    hideTip: hideTip,
    mountHeader: mountHeader,
    currentTheme: currentTheme,
    setTheme: setTheme,
    toggleTheme: toggleTheme,
    year: year
  };
})(window.MyMon);

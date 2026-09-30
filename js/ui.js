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
  var code = DEFAULT_CURRENCY;
  var withCents = null;
  var whole = null;
  var symbol = '$';

  function isKnownCurrency(value) {
    for (var i = 0; i < CURRENCIES.length; i++) {
      if (CURRENCIES[i].code === value) return true;
    }
    return false;
  }

  /* Intl throws on a currency it does not know, so only vetted codes get here. */
  function buildFormatters() {
    function make(decimals) {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: code,
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      });
    }

    withCents = make(2);
    whole = make(0);

    /* Rather than keep a table of symbols, ask the formatter what it uses —
       it already knows, and it stays right for currencies added later. */
    symbol = code;
    var parts = withCents.formatToParts(0);
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].type === 'currency') { symbol = parts[i].value; break; }
    }
  }

  /* Anything unknown, empty or missing falls back to the dollar the app
     shipped with, so a bad stored value can never leave amounts unreadable. */
  function setCurrency(value) {
    var wanted = String(value || '').trim().toUpperCase();
    code = isKnownCurrency(wanted) ? wanted : DEFAULT_CURRENCY;
    buildFormatters();

    var slots = document.querySelectorAll('[data-currency-symbol]');
    Array.prototype.forEach.call(slots, function (slot) {
      slot.textContent = symbol;
    });

    return code;
  }

  /* $1,284.50 */
  function money(value) {
    return withCents.format(Number(value) || 0);
  }

  /* $1,285 — for headline figures where cents are noise */
  function moneyShort(value) {
    var n = Number(value) || 0;
    return Math.round(n) === n ? whole.format(n) : withCents.format(n);
  }

  buildFormatters();

  function percent(value) {
    var n = Number(value) || 0;
    if (n > 0 && n < 1) return '<1%';
    return Math.round(n) + '%';
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
  function mountHeader(options) {
    options = options || {};
    var page = options.page;

    var links = document.querySelectorAll('.site-nav a[data-page]');
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

    var chip = document.querySelector('[data-user-chip]');
    if (chip) {
      if (user) {
        chip.classList.remove('hidden');
        var avatar = chip.querySelector('.avatar');
        if (avatar) {
          /* Google usually gives us a picture; initials are the fallback. */
          if (user.avatar) {
            avatar.innerHTML = '';
            var img = new Image();
            img.src = user.avatar;
            img.alt = '';
            img.referrerPolicy = 'no-referrer';
            img.onerror = function () {
              avatar.textContent = NS.session.initials(user.name);
            };
            avatar.appendChild(img);
          } else {
            avatar.textContent = NS.session.initials(user.name);
          }
        }
      } else {
        chip.classList.add('hidden');
      }
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
    currencySymbol: function () { return symbol; },
    setCurrency: setCurrency,
    percent: percent,
    escapeHtml: escapeHtml,
    el: el,
    toast: toast,
    bindTips: bindTips,
    hideTip: hideTip,
    mountHeader: mountHeader,
    year: year
  };
})(window.MyMon);

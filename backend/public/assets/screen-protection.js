/**
 * Proteção Anti-Captura de Tela
 * Projeto desenvolvido pela Equipe de Planejamento
 * 
 * Bloqueia tentativas de captura de tela, impressão e cópia de conteúdo.
 * Exibe alerta ao usuário quando uma tentativa é detectada.
 */
(function () {
  'use strict';

  var WATERMARK_TEXT = 'Projeto desenvolvido pela Equipe de Planejamento';
  var alertShown = false;

  function isFormElement(el) {
    var tag = (el && el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || (el && el.isContentEditable);
  }

  function showProtectionAlert() {
    if (alertShown) return;
    alertShown = true;
    showOverlayWarning();
    setTimeout(function () { alertShown = false; }, 3000);
  }

  /* ---------- Overlay visual de alerta ---------- */
  function showOverlayWarning() {
    var existing = document.getElementById('screen-protection-overlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'screen-protection-overlay';
    overlay.style.cssText =
      'position:fixed;top:0;left:0;width:100vw;height:100vh;' +
      'background:rgba(0,0,0,0.92);z-index:2147483647;display:flex;' +
      'align-items:center;justify-content:center;flex-direction:column;' +
      'animation:spFadeIn .2s ease;';

    var icon = document.createElement('div');
    icon.textContent = '\uD83D\uDEE1\uFE0F';
    icon.style.cssText = 'font-size:64px;margin-bottom:20px;';

    var title = document.createElement('h2');
    title.textContent = 'Captura de tela bloqueada!';
    title.style.cssText =
      'color:#ff4444;font-family:sans-serif;font-size:28px;margin-bottom:12px;text-align:center;';

    var msg = document.createElement('p');
    msg.textContent = 'Este conte\u00FAdo \u00E9 protegido. A captura de tela n\u00E3o \u00E9 permitida.';
    msg.style.cssText =
      'color:#fff;font-family:sans-serif;font-size:16px;margin-bottom:8px;text-align:center;';

    var credit = document.createElement('p');
    credit.textContent = WATERMARK_TEXT;
    credit.style.cssText =
      'color:rgba(255,255,255,0.5);font-family:sans-serif;font-size:13px;margin-top:24px;text-align:center;';

    overlay.appendChild(icon);
    overlay.appendChild(title);
    overlay.appendChild(msg);
    overlay.appendChild(credit);
    document.body.appendChild(overlay);

    setTimeout(function () {
      if (overlay.parentNode) {
        overlay.style.animation = 'spFadeOut .3s ease forwards';
        setTimeout(function () { overlay.remove(); }, 300);
      }
    }, 2500);
  }

  /* ---------- CSS de proteção ---------- */
  function injectProtectionCSS() {
    var style = document.createElement('style');
    style.textContent =
      '@keyframes spFadeIn{from{opacity:0}to{opacity:1}}' +
      '@keyframes spFadeOut{from{opacity:1}to{opacity:0}}' +
      '@media print{body{display:none!important}html::after{content:"Conte\u00FAdo protegido \u2013 Equipe de Planejamento";' +
      'display:block;text-align:center;font-size:24px;padding:40px;color:#333;font-family:sans-serif}}' +
      '#screen-protection-watermark{position:fixed;bottom:8px;right:12px;z-index:2147483646;' +
      'font-family:sans-serif;font-size:11px;color:rgba(0,0,0,0.18);pointer-events:none;' +
      'user-select:none;-webkit-user-select:none;letter-spacing:0.3px}';
    document.head.appendChild(style);
  }

  /* ---------- Marca d'água sutil ---------- */
  function addWatermark() {
    var wm = document.createElement('div');
    wm.id = 'screen-protection-watermark';
    wm.textContent = WATERMARK_TEXT;
    document.body.appendChild(wm);
  }

  /* ---------- Bloqueio de teclas ---------- */
  function blockKeyboard(e) {
    // PrintScreen
    if (e.key === 'PrintScreen' || e.keyCode === 44) {
      e.preventDefault();
      showProtectionAlert();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText('').catch(function () {});
      }
      return false;
    }

    // Ctrl+Shift+S (captura de tela do navegador)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      showProtectionAlert();
      return false;
    }

    // Windows + Shift + S (Snipping Tool)
    if (e.shiftKey && e.key.toLowerCase() === 's' && (e.metaKey || e.getModifierState('OS'))) {
      e.preventDefault();
      showProtectionAlert();
      return false;
    }

    // Ctrl+Shift+I ou F12 (DevTools)
    if (e.key === 'F12' || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'i')) {
      e.preventDefault();
      showProtectionAlert();
      return false;
    }

    // Ctrl+P (imprimir) — apenas sem Shift
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      showProtectionAlert();
      return false;
    }

    // Ctrl+S (salvar) — apenas sem Shift
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      showProtectionAlert();
      return false;
    }

    // Ctrl+U (ver código-fonte) — apenas sem Shift
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'u') {
      e.preventDefault();
      showProtectionAlert();
      return false;
    }
  }

  /* ---------- Bloqueio do menu de contexto ---------- */
  function blockContextMenu(e) {
    if (isFormElement(e.target)) return;
    e.preventDefault();
    showProtectionAlert();
    return false;
  }

  /* ---------- Bloqueio de arrastar ---------- */
  function blockDrag(e) {
    e.preventDefault();
    return false;
  }

  /* ---------- Bloqueio de cópia ---------- */
  function blockCopy(e) {
    if (isFormElement(e.target)) return;
    e.preventDefault();
    showProtectionAlert();
    return false;
  }

  /* ---------- Inicialização ---------- */
  function init() {
    injectProtectionCSS();

    document.addEventListener('keydown', blockKeyboard, true);
    document.addEventListener('keyup', function (e) {
      if (e.key === 'PrintScreen' || e.keyCode === 44) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText('').catch(function () {});
        }
        showProtectionAlert();
      }
    }, true);

    document.addEventListener('contextmenu', blockContextMenu, true);
    document.addEventListener('dragstart', blockDrag, true);
    document.addEventListener('copy', blockCopy, true);

    document.body.style.userSelect = 'none';
    document.body.style.webkitUserSelect = 'none';
    document.body.style.msUserSelect = 'none';
    document.body.style.MozUserSelect = 'none';

    var style = document.createElement('style');
    style.textContent =
      'input,textarea,select,[contenteditable="true"]{user-select:text!important;-webkit-user-select:text!important}';
    document.head.appendChild(style);

    addWatermark();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

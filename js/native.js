'use strict';
// Мост к оболочке приложения. В браузере ничего не делает.
//  • Electron/Steam: window.OldGoldNative (desktop/preload.js) — ачивки в Steamworks, сохранения дублируются в «облачную» папку.
//  • Capacitor (iOS/Android): window.Capacitor — полноэкранный режим без строки состояния.
(function () {
  const N = window.OldGoldNative, C = window.Capacitor;
  if (C && C.isNativePlatform && C.isNativePlatform()) {
    document.documentElement.classList.add('native-app', 'native-' + C.getPlatform());
    try { C.Plugins.StatusBar.hide(); } catch (e) { /* плагин не подключён */ }
    const plugins = C.Plugins || {}, app = plugins.App;
    if (C.getPlatform() === 'android') {
      // true = written by Android, null = picker cancelled, false = write failed.
      window.OldGoldAndroid = {
        async saveFile(name, data) {
          try {
            const result = await plugins.OldGoldFiles.saveFile({ name, data });
            return result && result.cancelled ? null : !!(result && result.saved);
          } catch (e) { console.warn('native export failed', e); return false; }
        },
      };
    }
    const canSave = () => typeof Game !== 'undefined' && !Game.stress && Game.units && Game.units.length
      && !(typeof StartMenu !== 'undefined' && StartMenu.open)
      && !(Game.goal && Game.goal.over && Game.goal.over.res === 'lose');
    const save = () => { try { return !canSave() || (typeof saveGame === 'function' && saveGame('auto')); } catch (e) { return false; } };
    let background = null, leaving = false;
    if (app) {
      // A document picker can outlive this WebView process. Capacitor delivers
      // its eventual result here after recreating the app, not to the old Promise.
      Promise.resolve(app.addListener('appRestoredResult', result => {
        if (!result || result.pluginId !== 'OldGoldFiles' || result.methodName !== 'saveFile') return;
        if (result.success && result.data && result.data.cancelled) return;
        alert(t(result.success && result.data && result.data.saved === true ? 'Файл сохранён.' : 'Не удалось сохранить файл.'));
      })).catch(e => console.warn('native restored export listener', e));
      Promise.resolve(app.addListener('appStateChange', ({ isActive }) => {
        if (!isActive) {
          if (!background) {
            if (typeof saveOnLeave === 'function') saveOnLeave(); else save();
            background = { game: typeof Game !== 'undefined' ? Game : null, paused: typeof Game !== 'undefined' && Game.paused };
            if (background.game) background.game.paused = true;
          }
          if (typeof audioHide === 'function') audioHide();
        } else {
          if (background && background.game && typeof Game !== 'undefined' && Game === background.game) Game.paused = background.paused;
          background = null;
          if (typeof audioShow === 'function') audioShow();
        }
      })).catch(e => console.warn('native lifecycle listener', e));
      Promise.resolve(app.addListener('backButton', async () => {
        if (leaving || (typeof window.wmBack === 'function' && window.wmBack())) return;
        leaving = true;
        try {
          if (!confirm(t(canSave() ? 'Сохранить игру и выйти?' : 'Выйти из игры?'))) return;
          if (!save()) { alert(t('Не удалось сохранить игру. Освободите место и попробуйте снова.')); return; }
          if (typeof audioHide === 'function') audioHide();
          await app.exitApp();
        } catch (e) { console.warn('native exit failed', e); }
        finally { leaving = false; }
      })).catch(e => console.warn('native back listener', e));
    }
  }
  if (!N) return;
  document.documentElement.classList.add('native-app');
  if (typeof saveGame === 'function') {
    const orig = saveGame;
    saveGame = function (slot) {
      const r = orig.apply(this, arguments);
      try {
        const k = SAVE_KEY + (slot || 'manual'), d = localStorage.getItem(k), m = localStorage.getItem(k + '.meta');
        if (d) { N.cloudPut(k, d); if (m) N.cloudPut(k + '.meta', m); }
      } catch (e) { /* облако недоступно */ }
      return r;
    };
  }
})();

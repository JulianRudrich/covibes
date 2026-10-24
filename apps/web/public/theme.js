/* global window, document */
// Applies the theme chosen on this device before the app's first paint (spec 36a), so nothing
// flashes in the other theme. A plain file, not inline, because the CSP allows only own scripts.
(function () {
  var choice = null;
  try {
    choice = window.localStorage.getItem('covibes.theme');
  } catch {
    // Storage refused: follow the system.
  }
  var dark =
    choice === 'dark' ||
    (choice !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();

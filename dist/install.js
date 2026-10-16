(() => {
  const dialog = document.querySelector('#install-dialog');
  const installButton = document.querySelector('#native-install');
  const status = document.querySelector('#install-status');
  const standalone = window.matchMedia('(display-mode: standalone)');
  let installPrompt = null;
  let installed = standalone.matches || navigator.standalone === true;

  function render() {
    installButton.hidden = !installPrompt || installed;
    status.textContent = installed
      ? 'AGU is already running as an app or has been installed on this device.'
      : installPrompt
        ? 'Your browser supports installing this preview. Choose Install AGU preview to continue.'
        : 'Use your browser’s install option below when available.';
  }
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    render();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    installPrompt = null;
    render();
  });
  document.querySelectorAll('[data-install-agu]').forEach(button => {
    button.addEventListener('click', () => { render(); dialog.showModal(); });
  });
  dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  installButton.addEventListener('click', async () => {
    if (!installPrompt) return;
    const prompt = installPrompt;
    installPrompt = null;
    installButton.hidden = true;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (!installed) status.textContent = choice.outcome === 'accepted'
        ? 'Installation requested. Your browser will finish setting up the app.'
        : 'Installation dismissed. You can still explore AGU in your browser.';
    } catch {
      status.textContent = 'Use the browser menu to install the preview, following the instructions below.';
    }
  });
  document.querySelector('#copyright-year').textContent = new Date().getFullYear();

  // Cache only the lightweight preview shell. Hero videos are never precached.
  if ('serviceWorker' in navigator && window.isSecureContext) {
    const register = () => navigator.serviceWorker.register('./sw.js').catch(() => {
      // The website remains usable if offline support is unavailable.
    });
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }
})();

try {
  if (localStorage.getItem('paretomol-theme') === 'light') document.documentElement.classList.remove('dark');
} catch (e) {}

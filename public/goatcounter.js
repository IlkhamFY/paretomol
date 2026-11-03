if (location.hostname === 'paretomol.com') {
  window.goatcounter = { no_onload: true };
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://gc.zgo.at/count.js';
  s.dataset.goatcounter = 'https://paretomol.goatcounter.com/count';
  document.head.appendChild(s);
}

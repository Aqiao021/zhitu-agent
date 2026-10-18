/* Runs in <head> before the page paints: show the right view and tab straight away, so the first frame is never empty. */
(function () {
  var p = (location.hash || '').replace(/^#\/?/, '').split('?')[0].split('/'), d = document.documentElement;
  d.setAttribute('data-rv', p[0] === 'app' ? 'app' : p[0] === 'about' ? 'about' : 'home');
  d.setAttribute('data-rt', ['jobs', 'diagnose', 'plan', 'interview', 'ask'].indexOf(p[1]) >= 0 ? p[1] : 'jobs');
})();

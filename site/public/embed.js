/* Vis blogindlæg på et andet website:
 * <script src="https://blog.villadsclaes.dk/embed.js" data-site="longbets" data-limit="5" async></script>
 * Valgfrit: data-title="Fra bloggen" og data-target="#element-id". */
(function () {
  var s = document.currentScript;
  if (!s) return;
  var base = new URL(s.src).origin;
  var site = s.dataset.site || 'alle';
  var limit = Number(s.dataset.limit || 5);
  var box = s.dataset.target ? document.querySelector(s.dataset.target) : null;
  if (!box) { box = document.createElement('div'); s.parentNode.insertBefore(box, s); }
  box.className += ' vc-blog';
  fetch(base + '/feeds/' + encodeURIComponent(site) + '.json')
    .then(function (r) { return r.json(); })
    .then(function (feed) {
      var items = feed.items.slice(0, limit);
      if (!items.length) return;
      var h = document.createElement('h2');
      h.textContent = s.dataset.title || 'Fra bloggen';
      var ul = document.createElement('ul');
      items.forEach(function (it) {
        var li = document.createElement('li');
        var a = document.createElement('a');
        a.href = it.url; a.textContent = it.title;
        var d = document.createElement('small');
        d.textContent = ' · ' + new Date(it.date_published).toLocaleDateString('da-DK', { day: 'numeric', month: 'short', year: 'numeric' });
        li.appendChild(a); li.appendChild(d);
        if (it.summary) { var p = document.createElement('div'); p.textContent = it.summary; p.style.opacity = '.75'; li.appendChild(p); }
        ul.appendChild(li);
      });
      box.appendChild(h); box.appendChild(ul);
    })
    .catch(function () {});
})();

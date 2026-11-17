(function () {
  'use strict';

  var script = document.currentScript;
  var comments = document.querySelector('.writing-comments');
  if (!script || !comments) return;

  var started = false;

  function loadStylesheet(href) {
    return new Promise(function (resolve, reject) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.onload = resolve;
      link.onerror = reject;
      document.head.appendChild(link);
    });
  }

  function loadComments() {
    if (started) return;
    started = true;

    Promise.all([
      loadStylesheet(script.dataset.walineStylesheet),
      loadStylesheet(script.dataset.commentsStylesheet)
    ]).then(function () {
      return import(script.dataset.walineModule);
    }).then(function (waline) {
      waline.init({
        el: '#waline',
        serverURL: script.dataset.serverUrl,
        path: script.dataset.path,
        placeholder: script.dataset.placeholder,
        avatar: 'mm',
        meta: ['nick', 'mail', 'link'],
        pageSize: 10,
        lang: 'zh-CN'
      });
    }).catch(function (error) {
      console.error('Comments failed to load', error);
      var message = document.createElement('p');
      message.setAttribute('role', 'status');
      message.textContent = '评论加载失败，请刷新页面重试。';
      comments.appendChild(message);
    });
  }

  if (!('IntersectionObserver' in window)) {
    loadComments();
    return;
  }

  var observer = new IntersectionObserver(function (entries) {
    if (!entries.some(function (entry) { return entry.isIntersecting; })) return;
    observer.disconnect();
    loadComments();
  }, { rootMargin: '600px 0px' });

  observer.observe(comments);
})();

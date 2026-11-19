(function () {
  window.setTimeout(function () {
    const status = document.querySelector('[data-expense-boot]');
    if (status) status.textContent = '填单助手加载失败，请刷新页面或返回 OS 首页。';
  }, 15000);
})();

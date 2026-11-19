// Deliberately unbundled: this guard runs before the application module.
(function(){
 var state=document.getElementById('boot-state'),timer;
 function done(){clearTimeout(timer);if(state)state.hidden=true;}
 function fail(){clearTimeout(timer);var app=document.getElementById('app');if(app)app.hidden=true;if(state){state.hidden=false;state.querySelector('p').textContent='渲染图榜加载失败，请重试或打开旧版。';state.querySelector('[data-recovery]').hidden=false;}}
 window.__renderGalleryBoot={done:done,fail:fail};
 window.addEventListener('error',function(e){if(e.target&&e.target.tagName==='SCRIPT'||e.error)fail();},true);
 window.addEventListener('unhandledrejection',function(){/* API failures are handled by application UI. */});
 timer=setTimeout(fail,15000);
})();
